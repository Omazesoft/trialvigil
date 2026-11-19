# TrialVigil — IAM & VPC

> Status: design document. Role enforcement in the console/harness is
> **not yet implemented** — today the apps run as a single local user.
> Treat the roles below as the target model to implement before any pilot
> with real data.

## Roles

| Role | Can do | Cannot do |
|---|---|---|
| **Operator** | Create/intake cases, run extraction + triage, edit draft fields, export audit for own cases | Approve triage, manage users, change config |
| **Reviewer** | Everything an operator can, plus approve/reject triage proposals, return cases to draft | Manage users, change config, approve own intake (see separation of duties) |
| **Admin** | Manage cases + users, configure triage rules and tool allow-list | Approve cases (admin is not a reviewer), read audit as evidence — admin actions are themselves audited |
| **Auditor** | Read-only: full case history, audit store, exports | Create, edit, or approve anything; no write access at all |
| **Platform admin** | Cloud project / VPC / IAM bindings, secrets, budgets. No access to case data by default | Read case data, approve cases |

## Separation of duties

- **Intake ≠ approval.** The person who intakes a case cannot approve its
  triage. The approval service enforces this by actor identity.
- **Admin ≠ reviewer.** Admins configure the system; they do not approve
  cases. If an admin must also review, they hold a separate reviewer
  identity and the separation rule still applies per case.
- **Auditor is read-only and independent.** Auditors have no write path in
  any environment, and audit records are append-only — nobody, including
  platform admins, can edit history in place.
- **Platform admin ≠ data access.** Cloud-level admins manage infra; case
  data access is granted separately and is itself audited.

## Identity, OIDC & MFA

- **Local mode:** single local user (development/demo only). No real
  identity — do not use local mode with real patient data.
- **Cloud (target, not yet implemented):** Google Identity / OIDC via
  Identity-Aware Proxy (IAP) in front of Cloud Run; MFA enforced by the
  identity provider. Service accounts are per-service (console vs harness),
  least-privilege, no user credentials in code or env files.
- Secrets live in Secret Manager; the harness reads them at runtime with
  its own service-account identity. No secrets in Terraform, env files, or
  git.

## Scope checks

- Every API call carries the caller's role; the harness checks role +
  case ownership before acting (target — **not yet implemented**).
- The tool gateway allow-list is per deployment; per-role tool scoping is
  a follow-up (see `docs/architecture.md`).
- Audit exports are role-gated: auditors and reviewers can export;
  operators export only cases they handled.

## VPC design

### GCP (first — implemented in Terraform, `infra/terraform/gcp/`)

- One VPC, one private subnet (`10.10.0.0/24`), Private Google Access on.
- Serverless VPC Access connector for Cloud Run; egress
  `PRIVATE_RANGES_ONLY`.
- Cloud Run ingress `INTERNAL_AND_CLOUD_LOAD_BALANCING` — services are
  **not directly reachable from the public internet**. Public access goes
  through an internal load balancer + IAP/OIDC front door — **not yet
  implemented**, and until it exists there is intentionally no public
  invoker binding.
- Cloud Storage bucket: uniform bucket-level access, public-access
  prevention enforced, versioning on.
- No public IPs on any workload. No Cloud SQL in the free-tier profile
  (see `infra/terraform/gcp/README.md`).

### AWS / Azure equivalents (later — not provisioned)

| Concern | GCP (first) | AWS equivalent | Azure equivalent |
|---|---|---|---|
| Private network | VPC + private subnet | VPC + private subnets | VNet + private subnets |
| Serverless in VPC | Serverless VPC Access connector | Lambda/ECS in VPC + VPC endpoints | VNet integration for Container Apps |
| Private API access | Private Google Access | VPC endpoints (Gateway/Interface) | Private Link / service endpoints |
| Public front door + auth | Cloud Load Balancing + IAP/OIDC | ALB + Cognito / OIDC | Application Gateway + Entra ID |
| Secrets | Secret Manager | Secrets Manager / SSM Parameter Store | Key Vault |
| Object store | Cloud Storage (private) | S3 (Block Public Access) | Blob Storage (private) |
| Budget guardrail | Billing budget + alerts | AWS Budgets | Cost Management budgets |

The same role model and separation-of-duties rules apply unchanged on
AWS/Azure; only the enforcement mechanism differs (IAM roles / Entra ID
roles instead of GCP IAM + IAP).
