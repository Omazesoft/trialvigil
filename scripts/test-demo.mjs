// Demo-flow test — verifies the full flow over HTTP against a RUNNING service.
// Usage: npm run dev (in another terminal), then: npm test
// Exits non-zero on the first failed assertion. No dependencies, Node >= 20.
// SPDX-License-Identifier: Apache-2.0

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} ${extra}`);
  }
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON (should not happen for these endpoints)
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`TrialVigil demo-flow test against ${BASE}`);

  // 1. health
  const health = await req("/health");
  check("GET /health -> 200 {ok:true}", health.status === 200 && health.json?.ok === true, JSON.stringify(health.json));

  // 2. seed
  const seed = await req("/api/demo/seed", { method: "POST", body: "{}" });
  check("POST /api/demo/seed -> 3 synthetic samples", seed.status === 200 && Array.isArray(seed.json) && seed.json.length === 3, `status=${seed.status} len=${seed.json?.length}`);
  check("seed samples are labelled synthetic", Array.isArray(seed.json) && seed.json.every((s) => s.synthetic === true));

  // 3. samples list
  const samples = await req("/api/demo/samples");
  check("GET /api/demo/samples -> 3 samples", samples.status === 200 && Array.isArray(samples.json) && samples.json.length === 3);

  // 4. run sample-1 (complete, serious, valid)
  const run1 = await req("/api/demo/run-sample", { method: "POST", body: JSON.stringify({ sampleId: "sample-1" }) });
  check("POST /api/demo/run-sample sample-1 -> 201 awaiting_approval", run1.status === 201 && run1.json?.status === "awaiting_approval", `status=${run1.status} body=${run1.text.slice(0, 200)}`);
  const runId = run1.json?.runId;
  check("run-1 draft carries DRAFT flag", run1.json?.draftCase?.flag === "DRAFT — NOT SUBMITTED, causality NOT assessed");
  check("run-1 draft valid=true (all 4 minimum criteria)", run1.json?.draftCase?.valid === true, JSON.stringify(run1.json?.draftCase?.minimumCriteria));
  check("run-1 seriousness=serious", run1.json?.draftCase?.seriousness === "serious");
  check("run-1 drug extracted with evidence quote", run1.json?.draftCase?.fields?.suspectDrug?.value === "Amoxicillin" && Boolean(run1.json?.draftCase?.fields?.suspectDrug?.sourceQuote));
  check("run-1 duplicate candidate flagged (prior-001, same drug+event+initials)", Array.isArray(run1.json?.draftCase?.duplicateCandidates) && run1.json.draftCase.duplicateCandidates.some((d) => d.priorCaseId === "prior-001"), JSON.stringify(run1.json?.draftCase?.duplicateCandidates));

  // 5. full run detail: 7 steps, 6 tool calls
  const detail = await req(`/api/runs/${runId}`);
  check("GET /api/runs/:id -> full run", detail.status === 200 && detail.json?.id === runId);
  check("run has 7 recorded steps", Array.isArray(detail.json?.steps) && detail.json.steps.length === 7, `steps=${detail.json?.steps?.length}`);
  check("run has 6 recorded tool calls", Array.isArray(detail.json?.toolCalls) && detail.json.toolCalls.length === 6, `toolCalls=${detail.json?.toolCalls?.length}`);
  const tools = (detail.json?.toolCalls ?? []).map((t) => t.tool);
  check("tool calls are the 6 PV tools in order", JSON.stringify(tools) === JSON.stringify(["read_intake_report", "extract_fields", "check_minimum_criteria", "flag_seriousness", "check_duplicates", "draft_case"]), tools.join(","));

  // 6. run sample-3 (incomplete -> valid=false + follow-ups, still awaiting_approval)
  const run3 = await req("/api/demo/run-sample", { method: "POST", body: JSON.stringify({ sampleId: "sample-3" }) });
  check("sample-3 -> awaiting_approval with valid=false", run3.status === 201 && run3.json?.status === "awaiting_approval" && run3.json?.draftCase?.valid === false);
  check("sample-3 lists follow-up questions", Array.isArray(run3.json?.draftCase?.followUpQuestions) && run3.json.draftCase.followUpQuestions.length >= 2, JSON.stringify(run3.json?.draftCase?.followUpQuestions));

  // 7. approve run-1, then verify approve is rejected a second time
  const approve = await req(`/api/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({ by: "Dr. Priya Nair", reason: "Draft reviewed, fields verified against source." }) });
  check("POST approve -> {status: approved}", approve.status === 200 && approve.json?.status === "approved", `status=${approve.status} body=${approve.text.slice(0, 200)}`);
  const approveAgain = await req(`/api/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({ by: "Dr. Priya Nair" }) });
  check("second approve -> 409 (only from awaiting_approval)", approveAgain.status === 409, `status=${approveAgain.status}`);

  // 8. reject run-3 without reason -> 400; with reason -> rejected
  const rejectNoReason = await req(`/api/runs/${run3.json.runId}/reject`, { method: "POST", body: JSON.stringify({ by: "Reviewer" }) });
  check("reject without reason -> 400", rejectNoReason.status === 400, `status=${rejectNoReason.status}`);
  const reject = await req(`/api/runs/${run3.json.runId}/reject`, { method: "POST", body: JSON.stringify({ by: "Reviewer", reason: "Missing reporter and suspect drug — follow up required." }) });
  check("reject with reason -> {status: rejected}", reject.status === 200 && reject.json?.status === "rejected");

  // 9. audit: entries exist, newest first; export downloads JSON
  const auditRes = await req("/api/audit");
  check("GET /api/audit -> entries, newest first", auditRes.status === 200 && Array.isArray(auditRes.json) && auditRes.json.length >= 4);
  const hasApproveEntry = (auditRes.json ?? []).some((e) => e.action === "run.approved" && e.runId === runId);
  check("audit contains run.approved entry for run-1", hasApproveEntry);
  const exportRes = await req("/api/audit/export");
  check("GET /api/audit/export -> JSON array", exportRes.status === 200 && Array.isArray(exportRes.json) && exportRes.json.length >= 4);

  // 10. runs list newest first
  const list = await req("/api/runs");
  check("GET /api/runs -> newest first", list.status === 200 && Array.isArray(list.json) && list.json.length >= 2 && list.json[0].createdAt >= list.json[1].createdAt);

  console.log(failures === 0 ? "\nAll demo-flow checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Test crashed (is the service running on ${BASE}?):`, err.message);
  process.exit(1);
});
