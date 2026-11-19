# TrialVigil — Local vs Cloud

## Shared (same in both modes)

- Same apps: console (3000) + harness service (3001), same codebase.
- Same run flow: intake → extract → triage proposal → human review →
  approve → audit export (see `docs/architecture.md`).
- Same default: deterministic extractor; Ollama optional in both modes.
- Same data model and audit record format — a case created locally is
  readable in the cloud, and vice versa, by design.
- Same rule: no causality decisions, no regulator submission, human
  approval required for every state change.

## What differs

| Area | Local mode | GCP cloud mode (target) |
|---|---|---|
| How it runs | `docker compose` or `infra/scripts/run-local.sh` (Node 24, no docker needed) | Cloud Run, scale-to-zero, min 0 |
| Data store | File JSON store under `DATA_DIR` / shared docker volume `trialvigil-data` | Private Cloud Storage bucket (Terraform) + local JSON store mirrored — **mirroring not yet implemented** |
| Database | None in MVP; Postgres in a container on the free VM for evaluation only | Cloud SQL deliberately **not** provisioned in the free tier — first paid graduation item |
| Identity | Single local user; no OIDC/MFA | IAP + OIDC, MFA enforced — **not yet implemented** |
| LLM | Ollama on the host (optional) | Ollama on the free VM, or hosted inference on trial credit under a budget cap — **not yet implemented** |
| Audit | Local JSON append-only log | Same log + bucket versioning — **bucket sync not yet implemented** |
| Network | localhost / docker network | Private VPC, internal-only Cloud Run ingress |
| Cost | $0 (own machine) | Free tier while inside quotas; hosted inference is the first real cost |

## Migration bundle (local → cloud)

To move a local pilot to GCP:

1. Export the audit + case data from `DATA_DIR` (the demo's audit-export
   step produces the same JSON the cloud store expects).
2. Build + push images to Artifact Registry (`:latest` is the default tag;
   the build/push step is **not yet implemented** — do it manually for now).
3. `terraform plan` in `infra/terraform/gcp/` (review only), then apply
   with human approval.
4. Import the exported JSON into the cloud bucket and verify a case's
   audit history round-trips (intake → approval) before pointing users
   at the cloud console.
5. Switch identity on: IAP/OIDC + MFA before any real user logs in
   (**not yet implemented** — do not run a real pilot without it).

The migration bundle format is the audit-export JSON itself — no separate
dump tool exists yet (**not yet implemented**).

## Air-gapped option

Local mode is the air-gapped mode: everything (apps, Ollama, data, audit)
runs on one machine with no network access required after `npm install`
and image pulls. The deterministic extractor needs no model at all, so
the demo and a fully offline pilot work with Ollama stopped. For a
strictly air-gapped deployment, pre-pull the `ollama/ollama` image and the
model on a connected machine, then move the machine/images offline; no
code changes are needed. Cloud features (IAP, Secret Manager, bucket
sync) are simply absent in this mode — that is the trade-off, and it is
intentional for the MVP.
