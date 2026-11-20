# @trialvigil/harness-adapter

One small interface over the agent loop, so the PV pack and the service never
depend directly on any one harness implementation:

```ts
interface HarnessAdapter {
  mode: "local" | "openworker-sdk" | "ollama-assisted";
  sdkUnavailableReason: string | null;
  startRun(input: { workflow: string; sourceText: string }): Promise<{ runId: string; sdk?: SdkRunInfo }>;
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

Set `OPENWORKER_ENABLED=1`, an API key, and `OPENWORKER_MODEL`.
Then `createAdapter()` wraps `@openworkerai/harness-sdk` **0.1.0-beta.5**
(installed as a dependency of this package). The provider is configurable:

| Env var | Meaning | Default |
| --- | --- | --- |
| `OPENWORKER_API` | `"responses"` (OpenAI) or `"chat-completions"` | `"responses"` |
| `OPENWORKER_MODEL_URL` | Model provider base URL | `https://api.openai.com/v1` |
| `OPENWORKER_API_KEY_ENV` | Name of the env var holding the key | `OPENAI_API_KEY`, or `NVIDIA_API_KEY` automatically when the base URL is `integrate.api.nvidia.com` |
| `OPENWORKER_MODEL` | Exact model id for that provider | (required, no default) |

#### NVIDIA NIM (free tier) — validated live 2026-11-19

No OpenAI key is needed. Generate a free key at build.nvidia.com
(email sign-up, no credit card; key starts `nvapi-`) and set:

```sh
OPENWORKER_ENABLED=1
OPENWORKER_API=chat-completions
OPENWORKER_MODEL_URL=https://integrate.api.nvidia.com/v1
OPENWORKER_MODEL=mistralai/mistral-large-4-1t-a52b
NVIDIA_API_KEY=<your nvapi- key>   # never commit this; infra/.env is gitignored
```

`infra/.env` (local only, gitignored) already holds these values and
`run-local.sh` sources it. Notes from the live validation:

- The free tier is **~40 requests/minute, prototyping only** — not for
  production traffic. Only synthetic demo data may ever go through it.
- The model id must come from the live catalog (`GET /v1/models`):
  `meta/llama-3.1-70b-instruct` was **not** in the catalog on 2026-11-19
  and would have failed. `mistralai/mistral-large-4-1t-a52b` was probed
  and does function calling correctly. Re-check the catalog before
  changing the model.
- Model choice matters: `nvidia/nemotron-3.5-lightning-30b-a3b` was tried
  first and does function calling via the raw API, but it is a reasoning
  model — it emits its thinking in `reasoning_content` with `content`
  null, and through the SDK it burned the whole output budget on
  reasoning without ever emitting a tool call. A non-reasoning model
  (Mistral Large) works through the SDK.
- **Sandbox networking note:** in this sandbox, egress goes through an
  authenticated MITM proxy that the SDK's native Rust runtime does not
  pick up (its requests fail with a `transport` provider error), while
  Node/curl honor the proxy env vars. Live validation here ran through
  a small local forward proxy (Node) on `127.0.0.1:8899` — that proxy is
  a validation shim only, not part of the product. On a normal network,
  point `OPENWORKER_MODEL_URL` directly at
  `https://integrate.api.nvidia.com/v1`.
- The SDK loop drives the tool calls: the six PV tools are registered
  with the harness (`harness.registerTools`, namespace `pv`) and the LLM
  chooses when to call each one; each tool executes locally as a Node
  callback into the deterministic `@trialvigil/pv-pack`. The authoritative
  draft is still produced by the service's own deterministic pass — the
  SDK session is a second, LLM-driven pass over the same report, and its
  status, final output, tool calls and interruptions are recorded on the
  run as the `openworker_sdk_session` step.
- **Approvals, honestly:** the agent is created with
  `approvals: { mode: "always" }`, so every tool call raises an approval
  `Interruption` delivered to the `runWith` handler. The adapter answers
  those with `{ decision: "once" }` — the PV tools are read-only
  extractions on synthetic data, so a per-call approval is not a
  consequential decision. The consequential approval — the drafted case
  itself — is **never** decided by the SDK: `requestApproval()` always
  returns `"pending"` and the run stops at the service's human approval
  gate (`POST /api/runs/:id/approve|reject`). Question/safety
  interruptions are deferred (`{ defer: true }`), which ends the SDK run
  `interrupted` and is recorded, not silently answered.

#### What the SDK actually provides (verified 2026-11-19, `node_modules/@openworkerai/harness-sdk`)

- `Harness.start({ stateDir, sandbox })` — starts the native Rust harness
  runtime (platform package, e.g. `@openworkerai/harness-runtime-linux-x64`,
  installed as an optional dependency). Requires Node >= 20, ESM.
- `harness.setModelProvider({ name: "OpenAI", api: "responses" | "chat-completions" | "anthropic", baseUrl, credentials: { apiKeyEnv, storage: "memory" } })`
- `harness.registerTools({ namespace, tools })` — `ApplicationTool`s with
  `description`, `inputSchema` and an `execute` Node callback.
- `harness.createAgent({ name, instructions, defaultModel, tools, approvals, planning, memory, scheduling })` — agent definitions are immutable in durable state; change the name when changing instructions/tools. `tools` are qualified registered names (`pv.extract_fields`, …).
- `agent.newSession()` / `session.run(input)` / `session.runWith(input, handler)` / `session.runStreamed(...)` — `runWith` is the approval path: the handler receives `Interruption` objects (`kind: "approval" | "question" | "safety"`) and returns a `Response` (`{ decision: "once" | "session" | "deny" }`, `{ answer }`, or `{ defer: true }`).
- `session.cancel()`, `session.resumeSession(reference)`, `session.snapshot()`, journal/observability APIs.

#### What the SDK does NOT provide (and why the local loop exists)

- **No usable agent loop without an LLM API key.** `Harness.start` +
  `setModelProvider` require an API key and an exact model id available
  to that account. There is no local / keyless / deterministic mode. The
  PV demo must work with no LLM and no network, so the SDK cannot be
  the default.
- **No PV domain logic.** No intake, extraction, minimum-criteria, seriousness,
  duplicate, or case-drafting concepts — those live in `@trialvigil/pv-pack`.
  The SDK only owns the loop, session, and tool dispatch; the PV tools
  are registered by this adapter as Node callbacks.
- **No human-approval REST API.** Approvals are in-process `Interruption`
  objects delivered to a `runWith` handler, not an HTTP endpoint. The service
  therefore keeps its own approval endpoints and audit log. The SDK path
  answers read-only tool-call interruptions in-process; the draft approval
  stays at the service's HTTP gate.
- **No local persistence of our runs/audit.** Durable state is the SDK's own
  session/journal state under `stateDir`; our runs and audit trail stay in
  the file store in `data/` (see the service README / root README).
- **No tool-result recording in our schema.** Tool calls made through the SDK
  are visible in its journal/observability stream, but the service records
  them in its own `toolCalls` array (including the `openworker_sdk_session`
  entry) so the UI contract is identical in every mode.

#### What to swap later

When a cloud profile is built, replace only `tryCreateSdkAdapter()`:
read the SDK journal for observability, and consider routing tool-call
approvals to a reviewer instead of auto-answering them. The
`HarnessAdapter` interface, the service routes, and the UI contract do not
change. The local loop stays as the offline fallback and the test backend.

> Verified against SDK 0.1.0-beta.5. The SDK path was run end-to-end
> against the live NVIDIA NIM free tier on 2026-11-19 (model
> `mistralai/mistral-large-4-1t-a52b`, via a local forward proxy — see
> the sandbox networking note above). Two validation runs on synthetic
> samples: run 1 (sample-1, amoxicillin/anaphylaxis) — the SDK loop
> called `read_intake_report` and answered 1 approval interruption,
> then a mid-stream transport error stopped it (the SDK charged the
> reserved output budget, so the turn ended after one tool); the
> deterministic pass still produced the valid draft, which stopped at
> the human gate and was approved via the service API. Run 2
> (sample-2, metformin/nausea) — the SDK loop called all six PV tools
> in order, answered 6 approval interruptions, completed with an
> accurate case summary, stopped at the human gate, and was approved
> via the service API with the audit entry recorded. The authoritative
> draft in both runs came from the deterministic pass; the SDK session
> is recorded on the run as the `openworker_sdk_session` step.

## `ollama-assisted` — opt-in only

Set both `OLLAMA_HOST` and `OLLAMA_MODEL`. The adapter mode becomes
`ollama-assisted`, but the loop is still the local one; `ollamaComplete()`
in `src/ollama.ts` is available for an optional free-text summary call.
Default OFF. Any Ollama failure returns `null` and the run continues
without it — the demo never depends on Ollama.
