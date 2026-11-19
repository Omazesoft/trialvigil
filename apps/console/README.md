# TrialVigil — Operator Console

React + TypeScript + Vite operator UI for the TrialVigil MVP
(Omazesoft, Apache 2.0). Synthetic demo data only — no real patient data.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # tsc + vite build
```

The harness service must be running on `http://localhost:3001`.
The Vite dev server proxies `/api` and `/health` to it, so the UI makes
only same-origin calls (`fetch('/api/...')`).

## Screens

- **Run board** — all runs (status, product, created, seriousness), filter by
  status, product scope in the header, "Start demo run" (seed + run a
  synthetic sample) and "New intake" (paste report text + product).
- **Live run detail** — click any run: step plan, live tool-call log
  (polls every 2 s while non-terminal), pause / resume / kill (one click,
  disabled only when terminal), draft case view.
- **Approval inbox** — runs awaiting approval; approve / reject with approver
  name (never blank) and reason (required to reject); the recorded approval
  is shown on the run.
- **Evidence viewer** — in the draft case, every extracted field shows its
  source quote; missing minimum criteria are highlighted; seriousness and
  duplicate candidates are shown; a prominent
  "DRAFT — NOT SUBMITTED. Causality NOT assessed." banner is always present.
- **Audit** — audit entries with an export button (`GET /api/audit/export`).

The header always shows the product scope and a
"SYNTHETIC DEMO DATA ONLY — no real patient data" banner.

## API contract

Implemented by `apps/harness-service` on `http://localhost:3001`:
`GET /health`, `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`,
`POST /api/runs/:id/pause|resume|kill`,
`POST /api/runs/:id/approve|reject`, `GET /api/audit`,
`GET /api/audit/export`, `POST /api/demo/seed`,
`POST /api/demo/run-sample`, `GET /api/demo/samples`.
