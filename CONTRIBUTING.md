# Contributing to TrialVigil

TrialVigil is open source under the Apache License 2.0. Contributions are
welcome — please read this first.

## Ground rules

- **No real patient data, ever.** All examples, tests, and seed data must be
  synthetic and labelled `SYNTHETIC` / `FAKE`. Never paste a real patient
  report, real name, or real contact detail into an issue, PR, or test.
- **Safety invariants are not negotiable.** The PV pack must never decide
  causality, never submit to a regulator, and never auto-create a case in a
  safety database. Draft only; human approval required. Any change touching
  `packages/pv-pack/` must keep every extracted field paired with its
  `{ value, sourceQuote }` evidence and keep the
  `DRAFT — NOT SUBMITTED, causality NOT assessed` flag on every draft.
- **Do not weaken the approval gate.** A run may only leave
  `awaiting_approval` via an explicit human `approve` / `reject` call.
  The local loop and the adapters must never approve a run themselves.

## Workflow

1. Fork and branch from `main` (`feat/...`, `fix/...`).
2. `npm install && npm run build` — the build must pass (`tsc -b`).
3. `npm run dev` in one terminal, then `npm test` in another — the demo-flow
   test (seed → run sample → approve → audit entry) must pass.
4. Keep changes inside the ownership boundaries in the root README
   (this agent owns the service, `packages/*`, root files, and `data/seed/`).
5. Open a PR describing what changed, how you verified it (commands +
   results), and any safety-relevant behaviour.

## Code style

- TypeScript, `strict` mode. No `any` without a comment explaining why.
- Prefer plain Node APIs over new runtime dependencies; the service has no
  HTTP framework dependency by design (plain `node:http`).
- New endpoints must be added to the API contract table in the root README
  and covered by `scripts/test-demo.mjs` where they affect the demo flow.

## Reporting security issues

Do not open a public issue for a security vulnerability. Contact the
maintainers privately (see the repo's security contact in `docs/` when
published) with the details.
