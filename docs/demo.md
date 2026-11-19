# TrialVigil — Demo

## What the demo shows

PV intake & triage, end to end, on **synthetic data only**: seed a fake
adverse-event report → run extraction + triage → a human approves it →
export the audit trail. Nothing here touches real patient data, makes a
causality decision, or submits anything to a regulator.

## Synthetic data note

All demo cases are clearly synthetic (fictional reporter, fictional
product batch, obviously fake dates/identifiers). Never load real case
data into the demo; local mode has no OIDC/MFA and no access control
(see `docs/iam-vpc.md`). If you need a realistic-looking report, copy a
seed case and edit the fields — do not paste a real report.

## Run locally — step by step

### Option A: docker (recommended if docker is installed)

```bash
cp infra/.env.example infra/.env   # optional; defaults work as-is
docker compose -f infra/docker-compose.yml up --build
```

With local LLM (optional — the demo works without it):

```bash
docker compose -f infra/docker-compose.yml --profile ollama up --build
# then, inside the ollama container or on the host:
# ollama pull llama3.1:8b
```

### Option B: no docker (Node 24)

```bash
./infra/scripts/run-local.sh
# installs deps (npm install at repo root), then starts
# harness on :3001 and console on :3000. Ctrl-C stops both.
```

Then open **http://localhost:3000** (console) and confirm the harness
answers at **http://localhost:3001/health**.

## The demo script

1. **Seed** — in the console, create a case from a synthetic report
   (or load the bundled seed case, if present — **seed data is not yet
   implemented**; until then type a short synthetic report by hand, e.g.
   "Patient reported nausea after starting Drug X on 2026-11-01").
2. **Run** — run extraction, then triage. Check the extracted fields
   against the source text; the deterministic extractor's output is
   shown next to the original report.
3. **Approve** — as the reviewer, approve (or reject, with a rationale)
   the triage proposal. Note the actor + timestamp recorded on the case.
4. **Audit export** — export the case's audit history as JSON and confirm
   it contains intake → extraction → review → approval, in order, with
   actor and timestamp on each step. (**Audit export is not yet
   implemented** in the console UI; until then the audit log is the JSON
   files under `DATA_DIR`.)

## Expected result

A triaged case with a complete, ordered audit trail — and nothing else:
no decision made by the model, no external call, no submission. If any
step produces a model suggestion, it is labelled as a suggestion and the
human decision is what counts.

## Troubleshooting

- Console won't start: check Node 24+ (`node --version`) or that ports
  3000/3001 are free.
- Harness can't reach Ollama: expected when Ollama isn't running — the
  deterministic extractor is the fallback and the demo still works.
- `npm install` fails: delete `node_modules` and retry; the repo root
  install covers both apps.
