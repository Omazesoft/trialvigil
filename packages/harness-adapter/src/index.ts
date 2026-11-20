// Harness adapter — one small interface, three backends.
// SPDX-License-Identifier: Apache-2.0
//
//   createAdapter() -> HarnessAdapter { mode, startRun, callTool, requestApproval }
//
// Backends, in priority order:
//   1. "local" (DEFAULT) — a clean in-process agent loop: runs the tool
//      sequence step by step, records every step/tool call, and pauses at
//      the approval gate. No LLM, no keys, no network. This is what the
//      demo uses and the only backend the MVP depends on.
//   2. "openworker-sdk" (OPT-IN, env OPENWORKER_ENABLED=1 + API key +
//      OPENWORKER_MODEL) — wraps @openworkerai/harness-sdk 0.1.0-beta.5.
//      The provider is configurable (see resolveProvider): OpenAI's
//      Responses API by default, or any OpenAI-compatible chat-completions
//      endpoint — including NVIDIA NIM's free tier
//      (OPENWORKER_API=chat-completions,
//       OPENWORKER_MODEL_URL=https://integrate.api.nvidia.com/v1,
//       NVIDIA_API_KEY). See README.md in this package for exactly what
//      the SDK provides and what it does not. If the SDK cannot start,
//      the adapter falls back to "local" and says so in `mode` /
//      `sdkUnavailableReason`.
//   3. "ollama-assisted" (OPT-IN, env OLLAMA_HOST + OLLAMA_MODEL) — the
//      local loop, plus an optional Ollama call the extractor may use for
//      a free-text summary. Default OFF; never required for the demo.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkDuplicates,
  checkMinimumCriteria,
  draftCase,
  extractFields,
  flagSeriousness,
  loadPriorCases,
  readIntakeReport,
  type Extraction,
} from "@trialvigil/pv-pack";

export interface AdapterTool {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ApprovalRequest {
  runId: string;
  summary: string;
  draft: unknown;
}

export type AdapterMode = "local" | "openworker-sdk" | "ollama-assisted";

/** What the OpenWorker SDK session did, when mode is "openworker-sdk". */
export interface SdkRunInfo {
  /** "completed" when the SDK loop finished; "interrupted" when it stopped
   *  on a deferred interruption (e.g. an agent question); never "failed"
   *  here — a failed SDK session throws instead, so the service can record it. */
  status: string;
  finalOutput: string | null;
  /** Approval interruptions raised by the SDK and answered by the adapter
   *  (read-only PV tool calls only — the draft approval is NOT here). */
  interruptions: Array<{ kind: string; tool?: string; detail: string }>;
  /** PV tool names the SDK loop actually invoked, in order. */
  toolCalls: string[];
}

export interface HarnessAdapter {
  mode: AdapterMode;
  /** Why the SDK was not used, when mode !== "openworker-sdk". */
  sdkUnavailableReason: string | null;
  startRun: (input: {
    workflow: string;
    sourceText: string;
  }) => Promise<{ runId: string; sdk?: SdkRunInfo }>;
  callTool: (tool: AdapterTool, args: Record<string, unknown>) => Promise<unknown>;
  requestApproval: (req: ApprovalRequest) => Promise<"approved" | "rejected" | "pending">;
}

export interface AdapterOptions {
  stateDir?: string;
  tools?: AdapterTool[];
}

function newRunId(): string {
  return `adapter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Local loop: sequential tool execution with an explicit approval gate. */
export function createLocalAdapter(_opts: AdapterOptions = {}): HarnessAdapter {
  return {
    mode: "local",
    sdkUnavailableReason:
      "Local loop is the default. The OpenWorker SDK is opt-in only (OPENWORKER_ENABLED=1 + API key + OPENWORKER_MODEL); see packages/harness-adapter/README.md.",
    startRun: async () => ({ runId: newRunId() }),
    callTool: async (tool, args) => tool.run(args),
    // In the local loop approval is a human decision made via the service
    // API (POST /api/runs/:id/approve|reject). The loop never approves
    // itself: it always returns "pending" and stops at the gate.
    requestApproval: async () => "pending",
  };
}

// ---------------------------------------------------------------------------
// OpenWorker SDK provider configuration.
// The SDK's ModelProvider accepts api "responses" | "chat-completions" |
// "anthropic" plus a baseUrl, so any OpenAI-compatible endpoint works.
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  api: "responses" | "chat-completions";
  baseUrl: string;
  /** Name of the env var holding the API key. */
  apiKeyEnv: string;
}

export function resolveProvider(): ProviderConfig {
  const api =
    process.env.OPENWORKER_API === "chat-completions" ? "chat-completions" : "responses";
  const baseUrl = process.env.OPENWORKER_MODEL_URL ?? "https://api.openai.com/v1";
  // Explicit override wins; otherwise the NVIDIA key is used automatically
  // when the base URL is NVIDIA's hosted endpoint.
  const apiKeyEnv =
    process.env.OPENWORKER_API_KEY_ENV ??
    (baseUrl.includes("integrate.api.nvidia.com") ? "NVIDIA_API_KEY" : "OPENAI_API_KEY");
  return { api, baseUrl, apiKeyEnv };
}

// The SDK is ESM-only and its "exports" map defines no "require"
// condition and no "./package.json" subpath, so every form of
// require.resolve() for it throws ERR_PACKAGE_PATH_NOT_EXPORTED even
// when it is installed. Find the entrypoint by walking up from this
// file to a node_modules/@openworkerai/harness-sdk/dist/index.js.
let sdkEntryCache: string | null | undefined;
function findSdkEntry(): string | null {
  if (sdkEntryCache !== undefined) return sdkEntryCache;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(
      dir,
      "node_modules",
      "@openworkerai",
      "harness-sdk",
      "dist",
      "index.js",
    );
    if (fs.existsSync(candidate)) {
      sdkEntryCache = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  sdkEntryCache = null;
  return null;
}
// chooses when to call each one); each tool executes locally as a Node
// callback into the deterministic pv-pack. The authoritative draft is
// still produced by the service's own deterministic pass — the SDK loop
// is a second, LLM-driven pass over the same report, and its tool calls
// and final output are recorded on the run for evidence.
// Runs are sequential in the service (one POST handler awaits the whole
// execution), so per-run state lives in this module-level object.
// ---------------------------------------------------------------------------

interface PvRunState {
  sourceText: string;
  extraction: Extraction | null;
  toolCalls: string[];
}

const pvState: PvRunState = { sourceText: "", extraction: null, toolCalls: [] };

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

type SdkTool = {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

function pvTools(): Record<string, SdkTool> {
  const noArgs = { type: "object", properties: {} };
  return {
    read_intake_report: {
      description: "Read the adverse-event intake report. Returns the report text and its length.",
      inputSchema: noArgs,
      execute: async () => {
        pvState.toolCalls.push("read_intake_report");
        return readIntakeReport(pvState.sourceText);
      },
    },
    extract_fields: {
      description:
        "Extract patient, reporter, suspect drug, adverse event, dates and dose from the report. Pass the report text as `report`.",
      inputSchema: {
        type: "object",
        properties: { report: { type: "string" }, productHint: { type: "string" } },
      },
      execute: async (args) => {
        pvState.toolCalls.push("extract_fields");
        const extraction = extractFields(
          strArg(args, "report") ?? pvState.sourceText,
          strArg(args, "productHint"),
        );
        pvState.extraction = extraction;
        return extraction;
      },
    },
    check_minimum_criteria: {
      description:
        "Check the 4 minimum validity criteria (identifiable patient, identifiable reporter, suspect drug, adverse event) for an extraction. Run extract_fields first.",
      inputSchema: {
        type: "object",
        properties: { extraction: { type: "object" } },
      },
      execute: async (args) => {
        pvState.toolCalls.push("check_minimum_criteria");
        const extraction = (args["extraction"] as Extraction | undefined) ?? pvState.extraction;
        if (!extraction) throw new Error("check_minimum_criteria needs an extraction: run extract_fields first.");
        return checkMinimumCriteria(extraction);
      },
    },
    flag_seriousness: {
      description: "Flag whether the adverse event is serious (death, hospitalisation, disability, birth defect, life-threatening).",
      inputSchema: noArgs,
      execute: async () => {
        pvState.toolCalls.push("flag_seriousness");
        return flagSeriousness(pvState.sourceText);
      },
    },
    check_duplicates: {
      description: "Check the extraction against seeded prior cases for possible duplicates. Run extract_fields first.",
      inputSchema: noArgs,
      execute: async () => {
        pvState.toolCalls.push("check_duplicates");
        if (!pvState.extraction) throw new Error("check_duplicates needs an extraction: run extract_fields first.");
        return checkDuplicates(pvState.extraction, loadPriorCases());
      },
    },
    draft_case: {
      description:
        "Draft the safety case from the report (draft only — causality NOT assessed, nothing submitted). Run extract_fields first.",
      inputSchema: {
        type: "object",
        properties: { productHint: { type: "string" } },
      },
      execute: async (args) => {
        pvState.toolCalls.push("draft_case");
        return draftCase(pvState.sourceText, strArg(args, "productHint"), loadPriorCases());
      },
    },
  };
}

// ---------------------------------------------------------------------------
// OpenWorker SDK wiring. Loaded lazily with require() so the adapter works
// on installs where the SDK (or its native runtime) is absent.
// Requires Node >= 22.12 for require(esm).
// ---------------------------------------------------------------------------

type SdkInterruption =
  | {
      kind: "approval";
      tool: string;
      qualified_name?: string;
      arguments: Record<string, unknown>;
    }
  | { kind: "question"; question: string; options: string[] }
  | { kind: "safety"; code: string };

type SdkSession = {
  runWith: (
    input: string,
    handler: (i: SdkInterruption) => Promise<{ decision: "once" | "session" | "deny" } | { answer: string } | { defer: true }>,
  ) => Promise<{
    status: string;
    finalOutput: string | null;
    interruptions: SdkInterruption[];
    failure?: string;
    providerError?: unknown;
  }>;
};

type SdkHarness = {
  setModelProvider: (p: unknown) => Promise<void>;
  registerTools: (r: unknown) => Promise<void>;
  createAgent: (d: unknown) => {
    newSession: () => Promise<SdkSession>;
  };
  shutdown: () => Promise<void>;
};

const PV_TOOL_NAMES = [
  "pv.read_intake_report",
  "pv.extract_fields",
  "pv.check_minimum_criteria",
  "pv.flag_seriousness",
  "pv.check_duplicates",
  "pv.draft_case",
];

/**
 * Try to start the real OpenWorker SDK loop.
 * Returns null (with a reason) when it cannot be used — the caller falls
 * back to the local loop. The SDK is loaded lazily with require() so the
 * adapter works on installs where the SDK (or its native runtime) is absent.
 */
export function tryCreateSdkAdapter(opts: AdapterOptions = {}): HarnessAdapter | null {
  const reason = sdkUnavailableReason();
  if (reason) return null;
  const provider = resolveProvider();
  const model = process.env.OPENWORKER_MODEL as string;

  let harnessPromise: Promise<{ harness: SdkHarness; agent: { newSession: () => Promise<SdkSession> } }> | null = null;
  const getAgent = (): Promise<{ newSession: () => Promise<SdkSession> }> => {
    if (!harnessPromise) {
      harnessPromise = (async () => {
        // ESM-only package (exports map has "import" only, no "require"):
        // require("@openworkerai/harness-sdk") fails with
        // ERR_PACKAGE_PATH_NOT_EXPORTED. Requiring the entrypoint by
        // absolute file path bypasses the exports map and works on
        // Node >= 22.12 (require(esm)).
        const entry = findSdkEntry();
        if (!entry) throw new Error("@openworkerai/harness-sdk entrypoint not found.");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sdk = require(entry) as {
          Harness: {
            start: (o: Record<string, unknown>) => Promise<SdkHarness>;
          };
        };
        const harness = await sdk.Harness.start({
          // The SDK validates that configuration paths are absolute;
          // a relative stateDir fails startup outright.
          stateDir: path.resolve(opts.stateDir ?? ".openworker-state"),
          sandbox: "off",
        });
        await harness.setModelProvider({
          name: "OpenAI",
          api: provider.api,
          baseUrl: provider.baseUrl,
          credentials: { apiKeyEnv: provider.apiKeyEnv, storage: "memory" },
        });
        // Register the PV tools (executed locally as Node callbacks).
        await harness.registerTools({ namespace: "pv", tools: pvTools() });
        const agent = harness.createAgent({
          name: "pv-intake-v1",
          instructions:
            "You are a pharmacovigilance intake assistant. Use the pv tools in order — read_intake_report, extract_fields, check_minimum_criteria, flag_seriousness, check_duplicates, draft_case — then write a short summary of the drafted case and stop. Never decide causality. Never submit anything to a regulator. Draft only; a human approves the case afterwards.",
          defaultModel: { provider: "OpenAI", name: model },
          tools: PV_TOOL_NAMES,
          // Every tool call raises an approval interruption, answered by the
          // adapter (see the runWith handler). The consequential approval —
          // the drafted case itself — is NOT decided here; it stays with
          // the service's human approval gate.
          approvals: { mode: "always" },
          limits: { maxModelCalls: 20, maxOutputTokens: 8192 },
          planning: false,
          memory: false,
          scheduling: false,
        });
        return { harness, agent };
      })();
    }
    return harnessPromise.then((h) => h.agent);
  };

  return {
    mode: "openworker-sdk",
    sdkUnavailableReason: null,
    startRun: async (input) => {
      pvState.sourceText = input.sourceText;
      pvState.extraction = null;
      pvState.toolCalls = [];
      const agent = await getAgent();
      const session = await agent.newSession();
      const interruptions: SdkRunInfo["interruptions"] = [];
      const result = await session.runWith(
        `PV intake report:\n${input.sourceText}\n\nUse the pv tools in order, then draft the case and stop for human approval.`,
        async (i) => {
          if (i.kind === "approval") {
            // Read-only PV tool calls only. Approving the tool call lets
            // the loop proceed; it does NOT approve the drafted case.
            interruptions.push({
              kind: "approval",
              tool: i.tool,
              detail: `approved once: ${i.tool}`,
            });
            return { decision: "once" };
          }
          // The agent was instructed not to ask questions. Deferring a
          // question/safety interruption ends the run "interrupted" and
          // is recorded below instead of being silently answered.
          interruptions.push({
            kind: i.kind,
            detail: i.kind === "question" ? `deferred question: ${i.question}` : `deferred safety: ${i.code}`,
          });
          return { defer: true };
        },
      );
      if (result.status === "failed" || result.status === "cancelled") {
        const detail =
          result.failure ?? (result.providerError ? JSON.stringify(result.providerError) : result.status);
        throw new Error(`OpenWorker run ${result.status}: ${detail}`);
      }
      return {
        runId: newRunId(),
        sdk: {
          status: result.status,
          finalOutput: result.finalOutput,
          interruptions,
          toolCalls: [...pvState.toolCalls],
        },
      };
    },
    callTool: async (tool, args) => tool.run(args),
    // Approval of the DRAFT is a human decision made via the service API
    // (POST /api/runs/:id/approve|reject). The SDK loop never approves it:
    // this always returns "pending" and the service stops at the gate.
    requestApproval: async () => "pending",
  };
}

/** Exact reason the SDK path is unavailable, or null when it is usable. */
export function sdkUnavailableReason(): string | null {
  if (process.env.OPENWORKER_ENABLED !== "1") {
    return "OPENWORKER_ENABLED is not '1' (SDK path is opt-in; local loop is the default).";
  }
  const provider = resolveProvider();
  if (!process.env[provider.apiKeyEnv]) {
    return `${provider.apiKeyEnv} is not set (required by the OpenWorker SDK for ${provider.baseUrl}).`;
  }
  if (!process.env.OPENWORKER_MODEL) return "OPENWORKER_MODEL is not set (required by the OpenWorker SDK).";
  if (!findSdkEntry()) return "@openworkerai/harness-sdk is not installed.";
  return null;
}

/** Factory used by the service. Never throws; falls back to the local loop. */
export function createAdapter(opts: AdapterOptions = {}): HarnessAdapter {
  if (process.env.OPENWORKER_ENABLED === "1") {
    const sdk = tryCreateSdkAdapter(opts);
    if (sdk) return sdk;
    const local = createLocalAdapter(opts);
    local.sdkUnavailableReason = `SDK requested but unavailable: ${sdkUnavailableReason() ?? "failed to start; see service log"}. Fell back to local loop.`;
    return local;
  }
  // Ollama-assisted mode is the local loop + optional Ollama (see ollama.ts).
  if (process.env.OLLAMA_HOST && process.env.OLLAMA_MODEL) {
    const local = createLocalAdapter(opts);
    return { ...local, mode: "ollama-assisted" };
  }
  return createLocalAdapter(opts);
}

export { ollamaAvailable, ollamaComplete } from "./ollama.js";
