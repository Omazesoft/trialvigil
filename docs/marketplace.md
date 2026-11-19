# TrialVigil — Marketplace Roadmap

> Status: plan only. No marketplace listing exists yet, and no partner
> application has been filed. Everything below is the intended sequence,
> not a commitment or a date.

## Order

1. **Pilot first.** The MVP (PV intake & triage, local + GCP free tier)
   is piloted with a small group before any listing is attempted. No
   listing before the pilot validates the human-in-the-loop flow.
2. **GCP Marketplace first** — a Kubernetes app listing, after the pilot.
3. **Professional-services listing** — alongside / after the GCP listing
   (implementation + validation help for customers).
4. **SaaS later** — a hosted multi-tenant offering only once the
   single-tenant GCP deployment, identity (IAP/OIDC + MFA), and audit
   story are proven.
5. **AWS / Azure marketplaces later** — after GCP, in deployment order
   (GCP → AWS → Azure). No work on those listings has started.

## GCP Marketplace — requirements (Kubernetes app)

A GCP Marketplace Kubernetes app listing requires, in brief:

- **Production-ready:** the app deploys cleanly from the listing, with
  documented install/upgrade/backup steps and no manual hacks. (Today:
  **not yet** — the cloud deploy path is a Terraform template with
  manual image push and no load-balancer/IAP front door.)
- **Partner Network:** enrolment in the Google Cloud Partner Network /
  Partner Advantage programme and acceptance of the Marketplace terms.
- **Primarily hosted on GCP:** the listed app must run primarily on GCP
  (Cloud Run / GKE). The local mode stays available, but the listing is
  the GCP deployment.
- Listings review: packaging, security, and documentation review by
  Google before publishing. Budget time for review cycles.

## Open items

- **A2A adapter — open item.** An Agent-to-Agent (A2A) protocol adapter
  for inter-agent communication is on the roadmap but **not yet
  implemented** and not designed in detail. It is not a blocker for the
  GCP Marketplace listing, but it is a blocker for any claim of A2A
  interoperability — do not claim it until it exists.
- **Pricing:** not decided. The free-tier story (local mode free;
  GCP free tier while in quota) is the pilot story, not a price list.
- **SaaS multi-tenancy:** not designed. The MVP is single-tenant by
  design (one deployment per customer/pilot).

## What not to claim

Do not describe TrialVigil in any listing draft as: A2A-compatible,
multi-tenant SaaS, regulator-submission-ready, or causality-capable. The
MVP is PV intake & triage with human approval, single-tenant, GCP first.
