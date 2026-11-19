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
//   2. "openworker-sdk" (OPT-IN, env OPENWORKER_ENABLED=1 + OPENAI_API_KEY +
//      OPENWORKER_MODEL) — wraps @openworkerai/harness-sdk 0.1.0-beta.5.
//      See README.md in this package for exactly what the SDK provides
//      and what it does not. If the SDK cannot start, the adapter falls
//      back to "local" and says so in `mode` / `fallbackReason`.
//   3. "ollama-assisted" (OPT-IN, env OLLAMA_HOST + OLLAMA_MODEL) — the
//      local loop, plus an optional Ollama call the extractor may use for
//      a free-text summary. Default OFF; never required for the demo.

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

export interface HarnessAdapter {
  mode: AdapterMode;
  /** Why the SDK was not used, when mode !== "openworker-sdk". */
  sdkUnavailableReason: string | null;
  startRun: (input: { workflow: string; sourceText: string }) => Promise<{ runId: string }>;
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
      "Local loop is the default. The OpenWorker SDK is opt-in only (OPENWORKER_ENABLED=1 + OPENAI_API_KEY + OPENWORKER_MODEL); see packages/harness-adapter/README.md.",
    startRun: async () => ({ runId: newRunId() }),
    callTool: async (tool, args) => tool.run(args),
    // In the local loop approval is a human decision made via the service
    // API (POST /api/runs/:id/approve|reject). The loop never approves
    // itself: it always returns "pending" and stops at the gate.
    requestApproval: async () => "pending",
  };
}

/**
 * Try to start the real OpenWorker SDK loop.
 * Returns null (with a reason) when it cannot be used — the caller falls
 * back to the local loop. The SDK is loaded lazily with require() so the
 * adapter works on installs where the SDK (or its native runtime) is absent.
 * Requires Node >= 22.12 for require(esm).
 */
export function tryCreateSdkAdapter(opts: AdapterOptions = {}): HarnessAdapter | null {
  const reason = sdkUnavailableReason();
  if (reason) return null;
  try {
    // Lazy load: importing the SDK also resolves its native runtime package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("@openworkerai/harness-sdk") as {
      Harness: {
        start: (o: Record<string, unknown>) => Promise<{
          setModelProvider: (p: unknown) => Promise<void>;
          createAgent: (d: unknown) => {
            newSession: () => Promise<{ run: (input: string) => Promise<{ status: string }> }>;
          };
          shutdown: () => Promise<void>;
        }>;
      };
    };
    const model = process.env.OPENWORKER_MODEL as string;
    const harnessPromise = sdk.Harness.start({
      stateDir: opts.stateDir ?? ".openworker-state",
      sandbox: "off",
    }).then(async (harness) => {
      await harness.setModelProvider({
        name: "OpenAI",
        api: "responses",
        baseUrl: process.env.OPENWORKER_MODEL_URL ?? "https://api.openai.com/v1",
        credentials: { apiKeyEnv: "OPENAI_API_KEY", storage: "memory" },
      });
      return harness;
    });
    // Wrap the SDK session run behind the same interface. The PV tools are
    // still executed locally (Node callbacks); the SDK owns the agent loop,
    // session, and its approval interruptions (handled via runWith by the
    // caller — see README.md). If the harness fails to start, startRun
    // throws and the service falls back to the local loop.
    return {
      mode: "openworker-sdk",
      sdkUnavailableReason: null,
      startRun: async (input) => {
        const harness = await harnessPromise;
        const agent = harness.createAgent({
          name: "pv-intake-v1",
          instructions:
            "You are a pharmacovigilance intake assistant. Extract fields from the report using the provided tools, draft a case, and STOP at the approval gate. Never decide causality. Never submit to a regulator. Draft only.",
          defaultModel: { provider: "OpenAI", name: model },
          tools: (opts.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: { type: "object", properties: {} },
          })),
          planning: false,
          memory: false,
          scheduling: false,
        });
        const session = await agent.newSession();
        const result = await session.run(
          `PV intake report:\n${input.sourceText}\n\nUse the tools, then draft the case and stop for human approval.`,
        );
        if (result.status !== "completed") {
          throw new Error(`OpenWorker run ended with status: ${result.status}`);
        }
        return { runId: newRunId() };
      },
      callTool: async (tool, args) => tool.run(args),
      requestApproval: async () => "pending",
    };
  } catch (err) {
    // SDK present but unusable (e.g. native runtime missing for platform).
    // Recorded by the caller via sdkUnavailableReason(); return null so the
    // local loop is used instead of blocking the demo.
    void err;
    return null;
  }
}

/** Exact reason the SDK path is unavailable, or null when it is usable. */
export function sdkUnavailableReason(): string | null {
  if (process.env.OPENWORKER_ENABLED !== "1") {
    return "OPENWORKER_ENABLED is not '1' (SDK path is opt-in; local loop is the default).";
  }
  if (!process.env.OPENAI_API_KEY) return "OPENAI_API_KEY is not set (required by the OpenWorker SDK).";
  if (!process.env.OPENWORKER_MODEL) return "OPENWORKER_MODEL is not set (required by the OpenWorker SDK).";
  try {
    require.resolve("@openworkerai/harness-sdk");
  } catch {
    return "@openworkerai/harness-sdk is not installed.";
  }
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
