// TrialVigil service — Node + TypeScript, plain node:http, port 3001.
// No auth in the local MVP (see README: local MVP only, IAM added in cloud mode).
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as http from "node:http";
import {
  createAdapter,
  type HarnessAdapter,
} from "@trialvigil/harness-adapter";
import {
  checkDuplicates,
  checkMinimumCriteria,
  draftCase,
  extractFields,
  flagSeriousness,
  loadPriorCases,
  readIntakeReport,
} from "@trialvigil/pv-pack";
import {
  newId,
  nowIso,
  type AuditEntry,
  type DemoSample,
  type DraftCase,
  type RunRecord,
  type RunStatus,
  type ToolCallRecord,
} from "@trialvigil/shared";
import { appendAudit, loadAudit, loadRuns, saveRuns, seedFile } from "./store.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const STEP_DELAY_MS = 90;

const adapter: HarnessAdapter = createAdapter({ stateDir: ".openworker-state" });

// In-memory pause bookkeeping: what status a paused run resumes to.
const pausedFrom = new Map<string, RunStatus>();

let runs: RunRecord[] = loadRuns();

function persist(run: RunRecord): void {
  const i = runs.findIndex((r) => r.id === run.id);
  if (i >= 0) runs[i] = run;
  else runs.unshift(run);
  saveRuns(runs);
}

function audit(runId: string | null, actor: string, action: string, detail: string): AuditEntry {
  return appendAudit({ runId, actor, action, detail });
}

function loadSamples(): DemoSample[] {
  const raw = fs.readFileSync(seedFile("samples.json"), "utf8");
  return JSON.parse(raw) as DemoSample[];
}

// ---------------------------------------------------------------------------
// Run execution — step by step through the PV tools, via the adapter.
// "Synchronously-ish": the POST handler awaits the whole execution, so the
// response already carries the draft in status awaiting_approval.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitWhilePaused(run: RunRecord): Promise<boolean> {
  // Returns false if the run was killed while paused.
  while (run.status === "paused") {
    await sleep(100);
    const current = runs.find((r) => r.id === run.id);
    if (!current || current.status === "killed") return false;
  }
  return run.status !== "killed";
}

async function executeRun(run: RunRecord): Promise<void> {
  const step = (name: string, detail: string) => {
    run.steps.push({ name, status: "running", detail, at: nowIso() });
    persist(run);
  };
  const doneStep = (detail: string) => {
    const s = run.steps[run.steps.length - 1];
    if (s) {
      s.status = "done";
      s.detail = detail;
      s.at = nowIso();
    }
    persist(run);
  };
  const recordTool = (tool: string, args: Record<string, unknown>, result: unknown): void => {
    const rec: ToolCallRecord = { tool, args, result, at: nowIso() };
    run.toolCalls.push(rec);
    persist(run);
  };
  const stopped = async (): Promise<boolean> => {
    if (run.status === "killed") return true;
    return !(await waitWhilePaused(run));
  };

  try {
    // 1. read_intake_report
    if (await stopped()) return;
    step("read_intake_report", "Reading intake report");
    await sleep(STEP_DELAY_MS);
    const read = readIntakeReport(run.sourceText);
    recordTool("read_intake_report", { length: run.sourceText.length }, read);
    doneStep(`Read ${read.length} characters`);

    // 2. extract_fields
    if (await stopped()) return;
    step("extract_fields", "Extracting patient / reporter / drug / event / dates / dose");
    await sleep(STEP_DELAY_MS);
    const extraction = extractFields(read.text, run.product ?? undefined);
    recordTool("extract_fields", { productHint: run.product }, extraction);
    doneStep(
      `Extracted drug=${extraction.suspectDrug.value ?? "?"} event=${extraction.adverseEvent.value ?? "?"}`,
    );

    // 3. check_minimum_criteria
    if (await stopped()) return;
    step("check_minimum_criteria", "Checking the 4 minimum criteria");
    await sleep(STEP_DELAY_MS);
    const criteria = checkMinimumCriteria(extraction);
    recordTool("check_minimum_criteria", {}, criteria);
    doneStep(
      `patient=${criteria.identifiablePatient} reporter=${criteria.identifiableReporter} drug=${criteria.suspectDrug} event=${criteria.adverseEvent}`,
    );

    // 4. flag_seriousness
    if (await stopped()) return;
    step("flag_seriousness", "Flagging seriousness");
    await sleep(STEP_DELAY_MS);
    const serious = flagSeriousness(read.text);
    recordTool("flag_seriousness", {}, serious);
    doneStep(`Seriousness: ${serious.seriousness} (${serious.reasons.join("; ")})`);

    // 5. check_duplicates
    if (await stopped()) return;
    step("check_duplicates", "Checking duplicates against seeded prior cases");
    await sleep(STEP_DELAY_MS);
    const priors = loadPriorCases();
    const dups = checkDuplicates(extraction, priors);
    recordTool("check_duplicates", { priorCasesChecked: priors.length }, dups);
    doneStep(dups.length > 0 ? `Possible duplicate(s): ${dups.map((d) => d.priorCaseId).join(", ")}` : "No duplicate match");

    // 6. draft_case
    if (await stopped()) return;
    step("draft_case", "Drafting case (draft only — causality NOT assessed)");
    await sleep(STEP_DELAY_MS);
    const draft: DraftCase = draftCase(read.text, run.product ?? undefined, priors);
    recordTool("draft_case", { valid: draft.valid }, draft);
    run.draftCase = draft;
    doneStep(draft.summary);

    // 7. approval gate — the loop never approves itself.
    if (await stopped()) return;
    step("request_approval", "Requesting human approval");
    await sleep(STEP_DELAY_MS);
    const decision = await adapter.requestApproval({
      runId: run.id,
      summary: draft.summary,
      draft,
    });
    doneStep(
      decision === "pending"
        ? "Awaiting human approval (human decision required)"
        : `Adapter approval decision: ${decision}`,
    );

    run.status = "awaiting_approval";
    run.updatedAt = nowIso();
    persist(run);
    audit(run.id, "system", "run.awaiting_approval", `Draft ready (valid=${draft.valid}); awaiting human approval.`);
  } catch (err) {
    const s = run.steps[run.steps.length - 1];
    if (s && s.status === "running") {
      s.status = "failed";
      s.detail = err instanceof Error ? err.message : String(err);
    }
    run.status = "killed";
    run.updatedAt = nowIso();
    persist(run);
    audit(run.id, "system", "run.failed", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function createPvRun(sourceText: string, product?: string, reporter?: string): Promise<RunRecord> {
  const run: RunRecord = {
    id: newId("run"),
    workflow: "pv-intake",
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    product: product ?? null,
    reporter: reporter ?? null,
    sourceText,
    steps: [],
    toolCalls: [],
    draftCase: null,
    approval: null,
  };
  runs.unshift(run);
  saveRuns(runs);
  audit(run.id, "system", "run.created", `PV intake run created (product=${product ?? "—"}).`);
  await adapter.startRun({ workflow: "pv-intake", sourceText });
  await executeRun(run);
  return run;
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        });
        res.end();
        return;
      }

      // GET /health
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      // GET /api/runs (newest first)
      if (method === "GET" && path === "/api/runs") {
        const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        sendJson(res, 200, sorted);
        return;
      }

      // POST /api/runs
      if (method === "POST" && path === "/api/runs") {
        const body = await readBody(req);
        if (body.workflow !== "pv-intake") {
          sendError(res, 400, 'workflow must be "pv-intake"');
          return;
        }
        const sourceText = str(body.sourceText);
        if (!sourceText) {
          sendError(res, 400, "sourceText is required");
          return;
        }
        const run = await createPvRun(sourceText, str(body.product), str(body.reporter));
        sendJson(res, 201, { runId: run.id, status: run.status, draftCase: run.draftCase });
        return;
      }

      // GET /api/audit (newest first) / export
      if (method === "GET" && path === "/api/audit") {
        const entries = loadAudit().sort((a, b) => b.at.localeCompare(a.at));
        sendJson(res, 200, entries);
        return;
      }
      if (method === "GET" && path === "/api/audit/export") {
        const entries = loadAudit();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="audit-export.json"',
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(entries, null, 2));
        return;
      }

      // Demo: samples / seed / run-sample
      if (method === "GET" && path === "/api/demo/samples") {
        sendJson(res, 200, loadSamples());
        return;
      }
      if (method === "POST" && path === "/api/demo/seed") {
        const samples = loadSamples();
        audit(null, "system", "demo.seed", `Seeded ${samples.length} synthetic reports (FAKE data).`);
        sendJson(res, 200, samples);
        return;
      }
      if (method === "POST" && path === "/api/demo/run-sample") {
        const body = await readBody(req);
        const sampleId = str(body.sampleId);
        const sample = loadSamples().find((s) => s.id === sampleId);
        if (!sample) {
          sendError(res, 404, `sample not found: ${sampleId ?? ""}`);
          return;
        }
        const run = await createPvRun(sample.text, sample.product || undefined, sample.reporter || undefined);
        sendJson(res, 201, { runId: run.id, status: run.status, draftCase: run.draftCase });
        return;
      }

      // /api/runs/:id and sub-actions
      const runMatch = path.match(/^\/api\/runs\/([^/]+)(?:\/(pause|resume|kill|approve|reject))?$/);
      if (runMatch) {
        const id = decodeURIComponent(runMatch[1]);
        const action = runMatch[2] as "pause" | "resume" | "kill" | "approve" | "reject" | undefined;
        const run = runs.find((r) => r.id === id);
        if (!run) {
          sendError(res, 404, `run not found: ${id}`);
          return;
        }

        if (method === "GET" && !action) {
          sendJson(res, 200, run);
          return;
        }

        if (method === "POST" && action === "pause") {
          if (run.status !== "running" && run.status !== "awaiting_approval") {
            sendError(res, 409, `cannot pause a run in status ${run.status}`);
            return;
          }
          pausedFrom.set(run.id, run.status);
          run.status = "paused";
          run.updatedAt = nowIso();
          persist(run);
          audit(run.id, "system", "run.paused", `Run paused (was ${pausedFrom.get(run.id)}).`);
          sendJson(res, 200, { status: run.status });
          return;
        }

        if (method === "POST" && action === "resume") {
          if (run.status !== "paused") {
            sendError(res, 409, `cannot resume a run in status ${run.status}`);
            return;
          }
          run.status = pausedFrom.get(run.id) ?? (run.draftCase ? "awaiting_approval" : "running");
          pausedFrom.delete(run.id);
          run.updatedAt = nowIso();
          persist(run);
          audit(run.id, "system", "run.resumed", `Run resumed to ${run.status}.`);
          sendJson(res, 200, { status: run.status });
          return;
        }

        if (method === "POST" && action === "kill") {
          if (run.status === "approved" || run.status === "rejected" || run.status === "killed") {
            sendError(res, 409, `cannot kill a run in status ${run.status}`);
            return;
          }
          pausedFrom.delete(run.id);
          run.status = "killed";
          run.updatedAt = nowIso();
          persist(run);
          audit(run.id, "system", "run.killed", "Run killed by operator.");
          sendJson(res, 200, { status: run.status });
          return;
        }

        if (method === "POST" && (action === "approve" || action === "reject")) {
          const body = await readBody(req);
          const by = str(body.by);
          const reason = str(body.reason);
          if (!by) {
            sendError(res, 400, '"by" is required');
            return;
          }
          if (action === "reject" && !reason) {
            sendError(res, 400, '"reason" is required to reject');
            return;
          }
          if (run.status !== "awaiting_approval") {
            sendError(res, 409, `cannot ${action} a run in status ${run.status} (must be awaiting_approval)`);
            return;
          }
          const decision = action === "approve" ? "approved" : "rejected";
          run.status = decision;
          run.approval = { by, decision, reason: reason ?? null, at: nowIso() };
          run.updatedAt = nowIso();
          persist(run);
          audit(run.id, by, `run.${decision}`, reason ? `${decision} by ${by}: ${reason}` : `${decision} by ${by}.`);
          sendJson(res, 200, { status: run.status });
          return;
        }
      }

      sendError(res, 404, `not found: ${method} ${path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, message);
    }
  })();
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `TrialVigil service listening on http://${HOST}:${PORT} (adapter mode: ${adapter.mode}` +
      (adapter.sdkUnavailableReason ? `; ${adapter.sdkUnavailableReason}` : "") +
      `)`,
  );
});
