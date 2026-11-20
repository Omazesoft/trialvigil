# TrialVigil

Human-in-the-loop agent harness for pharmacovigilance (PV) intake — an
open-source MVP by **Omazesoft**, licensed under the **Apache License 2.0**.

A report comes in as free text. A deterministic, rule-based agent pack
extracts the case fields, checks the 4 minimum criteria, flags seriousness,
checks duplicates, and drafts a case — then **stops**. A human reviews the
draft and approves or rejects it. Nothing is submitted to a regulator and no
case is created in a safety database without that human approval. Causality
is never assessed by the agent.

## What this is (MVP scope)

- **Harness service** (`apps/harness-service/`, Node + TypeScript, port **3001**):
  run lifecycle, steps, tool calls, human approval gate, append-only audit.
- **PV pack** (`packages/pv-pack/`): deterministic rule-based extractor.
  The default. Works with **no LLM and no network** — this is what the demo uses.
- **Harness adapter** (`packages/harness-adapter/`): one interface
  (`startRun`, `callTool`, `requestApproval`) over a local loop (default),
  the OpenWorker SDK (opt-in), and Ollama (opt-in).
- **Console UI**: `apps/console/` — owned by another agent; it consumes the
  API contract below.

## Quick start

```sh
npm install
npm run build
npm run dev        # starts the service on http://127.0.0.1:3001
npm test           # end-to-end demo flow check (needs the service running)
```

Demo flow (also what `npm test` does):

```sh
curl localhost:3001/health
curl -X POST localhost:3001/api/demo/seed
curl localhost:3001/api/demo/samples
curl -X POST localhost:3001/api/demo/run-sample -H 'Content-Type: application/json' \
  -d '{"sampleId":"sample-1"}'
# -> { runId, status: "awaiting_approval", draftCase }
curl localhost:3001/api/runs/<runId>
curl -X POST localhost:3001/api/runs/<runId>/approve -H 'Content-Type: application/json' \
  -d '{"by":"Dr. Priya Nair","reason":"Draft reviewed, fields verified against source."}'
curl localhost:3001/api/audit
```

## API contract (the console UI depends on this)

Base: `http://127.0.0.1:3001`. All JSON. **No auth in the local MVP**
(see *Security* below).

| Method & path | Description |
| --- | --- |
| `GET /health` | `{ ok: true }` |
| `POST /api/runs` | `{ workflow: "pv-intake", sourceText, product?, reporter? }` → `{ runId, status, draftCase }`. Runs extraction (small delays, each step/tool call recorded) and ends in `awaiting_approval`. |
| `GET /api/runs` | Array of runs, newest first. |
| `GET /api/runs/:id` | Full run: `{ id, workflow, status, createdAt, product, sourceText, steps: [{ name, status, detail, at }], toolCalls: [{ tool, args, result, at }], draftCase, approval?: { by, decision, reason, at } }`. |
| `POST /api/runs/:id/pause` \| `/resume` \| `/kill` | → `{ status }`. |
| `POST /api/runs/:id/approve` `{ by, reason? }` | Only from `awaiting_approval`. Records approval on the run + audit. → `{ status }`. |
| `POST /api/runs/:id/reject` `{ by, reason }` | Only from `awaiting_approval`. `reason` required. → `{ status }`. |
| `GET /api/audit` | Audit entries, newest first. |
| `GET /api/audit/export` | JSON download of all audit entries. |
| `POST /api/demo/seed` | Seeds the 3 synthetic reports; returns them. |
| `POST /api/demo/run-sample` `{ sampleId }` | Runs PV intake on that sample → `{ runId, status, draftCase }`. |
| `GET /api/demo/samples` | The 3 synthetic reports. |

Run statuses: `running` → `awaiting_approval` → `approved` | `rejected`;
`paused` (resumable), `killed` (terminal).

## PV intake — what the agent does and does not do

Tools, each recorded as a `toolCall` (`read_intake_report`,
`extract_fields`, `check_minimum_criteria`, `flag_seriousness`,
`check_duplicates`, `draft_case`):

- Extracts patient / reporter / suspect drug / adverse event / dates / dose.
  **Every extracted field carries `{ value, sourceQuote }`** — the verbatim
  sentence it came from.
- Checks the **4 minimum criteria** (identifiable patient, identifiable
  reporter, suspect drug, adverse event). Valid only if all 4 are present.
  If any is missing, `draftCase.valid` is `false`, the run still ends in
  `awaiting_approval`, and `followUpQuestions` lists what is missing.
- Flags **seriousness**: serious if death / hospitalisation / disability /
  birth defect / life-threatening is mentioned; otherwise a non-serious
  candidate. Keyword-based only — not a clinical judgement.
- Checks **duplicates** on drug + event + patient initials / dates against
  seeded prior cases in `data/seed/prior-cases.json`.
- Drafts the case with the prominent flag
  **`DRAFT — NOT SUBMITTED, causality NOT assessed`**.

It **never** decides causality, **never** submits to a regulator, and
**never** auto-creates a case in a safety database. Draft only; human
approval required.

## Storage

File-based JSON store in `data/` — `runs.json` (all runs) and `audit.jsonl`
(append-only; entries are never edited or deleted). **This is the MVP local
store. Postgres is the GCP profile** (see `infra/`, owned by another agent).
Swap the store behind `apps/harness-service/src/store.ts`; the API does not
change.

## Data

**No real patient data anywhere.** All seed data is synthetic and labelled
`SYNTHETIC` / `FAKE` (`data/seed/samples.json`, `data/seed/prior-cases.json`).
Do not paste real patient reports into the demo.

## Harness backends

The adapter (`packages/harness-adapter/`) exposes one interface
(`startRun`, `callTool`, `requestApproval`) with three backends:

- **`local` (default)** — in-process loop, no LLM, no keys, no network.
  The loop never approves itself; it always stops at the approval gate.
- **`openworker-sdk` (opt-in)** — set `OPENWORKER_ENABLED=1`,
  an API key, and `OPENWORKER_MODEL`. Wraps
  `@openworkerai/harness-sdk` 0.1.0-beta.5. The provider is
  configurable: OpenAI's Responses API by default, or any
  OpenAI-compatible chat-completions endpoint — including NVIDIA NIM's
  free tier (`OPENWORKER_API=chat-completions`,
  `OPENWORKER_MODEL_URL=https://integrate.api.nvidia.com/v1`,
  `NVIDIA_API_KEY`, model `mistralai/mistral-large-4-1t-a52b`),
  validated live 2026-11-19. See
  `packages/harness-adapter/README.md` for exactly what the SDK provides
  (LLM-driven agent loop with the PV tools registered, sessions,
  approval interruptions answered in-process for read-only tool calls)
  and what it does not (no keyless mode, no PV logic of its own, no
  approval REST API — the draft approval stays at the service's human
  gate, no run/audit store). If the SDK cannot start, the adapter falls
  back to `local` and says so.
- **`ollama-assisted` (opt-in)** — set `OLLAMA_HOST` + `OLLAMA_MODEL`.
  Still the local loop, plus an optional Ollama call. Default OFF; the demo
  works with no Ollama.

## Security

- **Local MVP only: no auth.** The service binds `127.0.0.1:3001` by
  default and trusts local callers. Do not expose it to a network.
- **IAM is added in cloud mode.** Any deployment (see `infra/`) must put
  authentication/authorisation in front of every `/api/*` route before
  handling real data; the local file store must be replaced by Postgres
  with per-tenant access control at the same time.
- Secrets (API keys) are read from the environment only, never committed.
  See `.env.example`.

## Repo layout

```
apps/harness-service/   Harness service (port 3001) — this agent's ownership
apps/console/           Console UI — owned by another agent
packages/shared/        Shared types (Run, DraftCase, AuditEntry, ...)
packages/pv-pack/       PV intake agent pack (deterministic extractor)
packages/harness-adapter/  Adapter: local loop / OpenWorker SDK / Ollama
data/seed/              Synthetic demo data (FAKE — no real patients)
infra/                  Deployment — owned by another agent
docs/                   Docs — owned by another agent
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build, then start the harness service on port 3001. |
| `npm run build` | Typecheck + build all owned packages (`tsc -b`). |
| `npm test` | `node scripts/test-demo.mjs` — verifies the demo flow over HTTP against a running service: seed → run sample → approve → audit entry exists. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
