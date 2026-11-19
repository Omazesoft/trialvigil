# TrialVigil — Decisions (ADRs)

Architectural Decision Records. Status is `Accepted` unless noted.
Anything an ADR depends on that is not yet built is called out in the ADR.

## ADR-01 — Apache 2.0 licence

- **Status:** Accepted
- **Decision:** TrialVigil is open source under the Apache License 2.0.
- **Context:** Omazesoft wants a permissively licensed, auditable codebase
  that pharma customers and contributors can use commercially without
  copyleft obligations.
- **Consequences:** Patent grant included; attribution required; anyone
  may fork. The licence file itself lives at the repo root (owned by the
  repo, not this infra/docs work).

## ADR-02 — GCP first, then AWS, then Azure

- **Status:** Accepted
- **Decision:** Build the cloud deployment for GCP first; AWS and Azure
  follow in that order.
- **Context:** GCP's free tier (Cloud Run scale-to-zero, 1 e2-micro,
  5 GB storage, $300/90-day trial credit for new accounts) lets the pilot
  run at ~$0 while the design is validated; the team also has the most
  GCP familiarity.
- **Consequences:** Terraform in `infra/terraform/gcp/` is the reference
  cloud module. AWS/Azure equivalents are documented as a table
  (`docs/iam-vpc.md`) and built later — no AWS/Azure infra exists yet.

## ADR-03 — PV intake & triage first (pilot scope)

- **Status:** Accepted
- **Decision:** The MVP and first pilot cover PV intake & triage only.
- **Context:** Intake + triage is the highest-volume, lowest-risk PV
  workflow and the easiest to validate with a human in the loop.
- **Consequences:** The platform **never** makes causality decisions and
  **never** submits to a regulator in the MVP. Those are explicit
  non-goals; adding them later needs new ADRs, new review, and new
  validation — not a config change.

## ADR-04 — Deterministic extractor is the default; LLM is optional

- **Status:** Accepted
- **Decision:** A rule-based deterministic extractor is the default
  extraction path. LLM inference (local Ollama) is an optional,
  clearly-labelled suggestion pass.
- **Context:** Deterministic output is testable, reproducible, and works
  with no model at all — essential for a regulated-adjacent workflow and
  for air-gapped use. Generated/LLM output must never be mistaken for a
  decision.
- **Consequences:** The demo works with Ollama stopped. The LLM
  suggestion pass is **not yet implemented**; until it is, extraction is
  deterministic only. No hosted model is the default — hosted inference
  is a paid, budget-capped option, never the silent default.

## ADR-05 — File JSON store for the local MVP

- **Status:** Accepted (MVP only — revisit before any production pilot)
- **Decision:** Local mode stores cases + audit records as JSON files
  under `DATA_DIR` (shared docker volume `trialvigil-data`).
- **Context:** Zero-dependency, inspectable, trivially exportable — the
  audit export *is* the file format, which makes local→cloud migration
  a file move rather than a database migration.
- **Consequences:** No concurrent-write guarantees, no query engine, no
  encryption at rest beyond disk/filesystem. Cloud SQL is the first paid
  graduation item when the pilot outgrows files (see
  `infra/terraform/gcp/README.md`); the migration path is the
  audit-export JSON. Do not put real patient data on the file store
  without the identity + access controls in `docs/iam-vpc.md`, which are
  **not yet implemented**.

## ADR-06 — Local mode is first-class

- **Status:** Accepted
- **Decision:** Local mode (docker compose or `run-local.sh`, Node 24, no
  docker required) is a supported deployment, not a dev convenience.
- **Context:** Pilots, air-gapped evaluation, and demos all need to run
  without a cloud account or spend.
- **Consequences:** Every feature must work locally first; cloud-only
  features (IAP, Secret Manager, bucket sync) are additive and must not
  be required for the core flow.
