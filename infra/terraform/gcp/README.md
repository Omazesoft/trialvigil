# TrialVigil — GCP Terraform (free-tier profile)

> **DO NOT APPLY without review. This is a template — `terraform plan` only.
> No deployment by the agent. A human must review the plan, confirm the
> billing account, and approve before any `terraform apply`.**

## What this provisions (region `us-central1`, free-tier profile)

| Resource | Notes |
|---|---|
| Cloud Run × 2 (console :3000, harness :3001) | Scale-to-zero (`min_instances = 0`), 1 vCPU, 512 MiB, max 2 instances. Ingress `INTERNAL_AND_CLOUD_LOAD_BALANCING` — not directly public. |
| Artifact Registry repo | Docker images for console + harness-service. |
| Cloud Storage bucket (private) | File store + audit exports. Uniform bucket-level access, public-access prevention enforced, versioning on. |
| Secret Manager secret (placeholder) | Name only — a human sets the value; never commit secrets. |
| VPC + private subnet + Serverless VPC Access connector | Private Google Access on; Cloud Run egress is private-ranges-only. |
| Billing budget + alerts (50% / 90% / 100%) | Guardrail only — it **alerts, it does not cap spend**. Created only when `billing_account_id` is set. |
| Cloud SQL | **Deliberately NOT provisioned** (see below). |

## Usage

```bash
cd infra/terraform/gcp
terraform init
terraform plan -var project_id=<your-project-id> \
               -var billing_account_id=<your-billing-account-id>
# Review the plan. Only then, with human approval:
terraform apply -var project_id=<your-project-id> \
                -var billing_account_id=<your-billing-account-id>
```

Images must be built and pushed to Artifact Registry before the Cloud Run
services can start (the services reference `:latest` by default — set
`image_tag` to a real tag). **Not yet implemented:** the CI/build step that
builds and pushes those images, and the internal load balancer / IAP-OIDC
front door that would make the console reachable. Until that front door
exists there is intentionally **no public invoker binding** — the services
are internal-only.

## Why no Cloud SQL

There is **no Always Free tier for Cloud SQL**. The smallest instance
(`db-f1-micro` / `db-g1-small`) is paid, so it is the **first paid
graduation item** when the pilot outgrows the local file store. For
evaluation only, Postgres runs in a container on the free VM (1 e2-micro)
alongside the local JSON store — see `docs/local-vs-cloud.md`. Do not add a
`google_sql_database_instance` here without a budget decision and a
human-approved cost review.

## Cost notes — what is free, what is not

**Free (within the stated limits, new accounts):**

- Cloud Run: 2M requests/month, 180,000 vCPU-seconds/month, 360,000 GiB-seconds/month free. Scale-to-zero means idle = $0.
- Compute Engine: 1 e2-micro instance in `us-central1` (720 hrs/month) — the free VM used for evaluation Postgres.
- Cloud Storage: 5 GB regional standard storage/month.
- Secret Manager: 6 active secret versions free.
- Artifact Registry: 0.5 GB storage free.
- New accounts: **$300 trial credit, 90 days** (new-account offer; check current terms at sign-up).

**NOT free:**

- **Hosted model inference.** There is no free hosted LLM in this stack. Default to **local Ollama** (free, runs on your machine / the free VM) or spend **trial credit under a budget cap** — the billing budget above is the guardrail, and it only alerts. Do not point the harness at a paid hosted model without a budget decision.
- Cloud SQL (any size), load balancer egress/bandwidth beyond free allowances, and anything above the free-tier quotas above.

Prices change; verify against the current GCP pricing page before committing.

## Files

- `main.tf` — resources (see header comment: plan-only template).
- `variables.tf` — inputs (`project_id` required; `billing_account_id` optional).
- `outputs.tf` — service URIs, repo, bucket, VPC, secret name.
