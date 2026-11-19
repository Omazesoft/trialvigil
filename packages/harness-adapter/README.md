# @trialvigil/harness-adapter

One small interface over the agent loop, so the PV pack and the service never
depend directly on any one harness implementation:

```ts
interface HarnessAdapter {
  mode: "local" | "openworker-sdk" | "ollama-assisted";
  sdkUnavailableReason: string | null;
  startRun(input: { workflow: string; sourceText: string }): Promise<{ runId: string }>;
  callTool(tool: AdapterTool, args: Record<string, unknown>): Promise<unknown>;
  requestApproval(req: ApprovalRequest): Promise<"approved" | "rejected" | "pending">;
}
```

`createAdapter()` picks the backend. It never throws and never blocks the
demo: if the requested backend cannot start, it falls back to the local loop
and records why in `sdkUnavailableReason`.

## Backends

### `local` — the default (what the demo uses)

An in-process loop: tools run sequentially, every step and tool call is
recorded by the service, and the run stops at the approval gate.
`requestApproval()` always returns `"pending"` — the local loop never
approves itself. A human approves or rejects via
`POST /api/runs/:id/approve|reject`. No LLM, no keys, no network.

### `openworker-sdk` — opt-in only

Set `OPENWORKER_ENABLED=1`, `OPENAI_API_KEY`, and `OPENWORKER_MODEL`
(optionally `OPENWORKER_MODEL_URL`). Then `createAdapter()` wraps
`@openworkerai/harness-sdk` **0.1.0-beta.5** (installed as a dependency of
this package).

#### What the SDK actually provides (verified 2026-11-19, `node_modules/@openworkerai/harness-sdk`)

- `Harness.start({ stateDir, sandbox })` — starts the native Rust harness
  runtime (platform package, e.g. `@openworkerai/harness-runtime-linux-x64`,
  installed as an optional dependency). Requires Node >= 20, ESM.
- `harness.setModelProvider({ name: "OpenAI", api: "responses", baseUrl, credentials: { apiKeyEnv: "OPENAI_API_KEY", storage: "memory" } })`
- `harness.createAgent({ name, instructions, defaultModel, tools, planning, memory, scheduling })` — agent definitions are immutable in durable state; change the name when changing instructions/tools.
- `agent.newSession()` / `session.run(input)` / `session.runWith(input, handler)` / `session.runStreamed(...)` — `runWith` is the approval path: the handler receives `Interruption` objects (`kind: "approval"`) and returns a `Response`.
- `session.cancel()`, `session.resumeSession(reference)`, `session.snapshot()`, journal/observability APIs.

#### What the SDK does NOT provide (and why the local loop exists)

- **No usable agent loop without an LLM API key.** `Harness.start` +
  `setModelProvider` require `OPENAI_API_KEY` and an exact `OPENWORKER_MODEL`
  id available to that account. There is no local / keyless / deterministic
  mode. The PV demo must work with no LLM and no network, so the SDK cannot
  be the default.
- **No PV domain logic.** No intake, extraction, minimum-criteria, seriousness,
  duplicate, or case-drafting concepts — those live in `@trialvigil/pv-pack`.
  The SDK only owns the loop, session, and tool dispatch.
- **No human-approval REST API.** Approvals are in-process `Interruption`
  objects delivered to a `runWith` handler, not an HTTP endpoint. The service
  therefore keeps its own approval endpoints and audit log; the SDK path
  still routes approval decisions through them.
- **No local persistence of our runs/audit.** Durable state is the SDK's own
  session/journal state under `stateDir`; our runs and audit trail stay in
  the file store in `data/` (see the service README / root README).
- **No tool-result recording in our schema.** Tool calls made through the SDK
  are visible in its journal/observability stream, but the service records
  them in its own `toolCalls` array so the UI contract is identical in
  every mode.

#### What to swap later

When a cloud profile is built, replace only `tryCreateSdkAdapter()`:
wire the PV tools in as real SDK `ApplicationTool`s (Node callbacks),
handle approval `Interruption`s in `runWith` by calling the service's
approval endpoints, and read the SDK journal for observability. The
`HarnessAdapter` interface, the service routes, and the UI contract do not
change. The local loop stays as the offline fallback and the test backend.

> Verified against SDK 0.1.0-beta.5. This package was **not** run end-to-end
> against the live SDK in this MVP (that needs a real OpenAI key, which the
> local MVP deliberately does not require). The SDK wrapper code above is
> written against the SDK's published `dist/index.d.ts` types; treat it as
> the integration sketch to validate with a key before relying on it.

## `ollama-assisted` — opt-in only

Set both `OLLAMA_HOST` and `OLLAMA_MODEL`. The adapter mode becomes
`ollama-assisted`, but the loop is still the local one; `ollamaComplete()`
in `src/ollama.ts` is available for an optional free-text summary call.
Default OFF. Any Ollama failure returns `null` and the run continues
without it — the demo never depends on Ollama.
