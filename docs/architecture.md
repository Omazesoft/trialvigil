# TrialVigil — Architecture

> Status: MVP design. Anything marked **not yet implemented** does not exist
> in code yet — this document describes the intended architecture, not only
> what is built today.

## Overview

TrialVigil is a **private, human-supervised agent platform** for clinical
development and pharmacovigilance (PV), built on the **OpenWorker Agent
Harness SDK**. MVP scope is **PV intake & triage only** — it never makes
causality decisions and never submits anything to a regulator. Every
agent action that changes state requires a human approval; the audit log is
the record of what happened, who approved it, and when.

Deployment order: **GCP first, then AWS, then Azure**. Local mode
(Ollama, local data/audit) is first-class, not a demo afterthought.

## Components

| Component | What it is | Port / location |
|---|---|---|
| **Console** (`apps/console`) | React/Vite human UI: intake queue, case detail, approve/reject, audit view | 3000 |
| **Harness service** (`apps/harness-service`) | API + agent runtime on the OpenWorker Agent Harness SDK | 3001 |
| **Harness adapter** | Thin layer translating between the SDK's agent interface and TrialVigil domain types (cases, triage fields). Keeps the SDK replaceable. | inside harness-service |
| **Tool gateway** | The only way agents touch tools (extractor, search, store). Enforces allow-list, argument validation, and per-tool timeouts. Agents never call tools directly. | inside harness-service |
| **Approval service** | State machine for human review: `pending → approved | rejected`. No agent step can bypass it; approvals are recorded with actor + timestamp. | inside harness-service |
| **Audit store** | Append-only log of every intake, extraction, approval, and export (actor, action, payload hash, timestamp). Local MVP: file JSON store under `DATA_DIR`. | `data/` (local) / Cloud Storage (GCP) |
| **Deterministic extractor** | Rule-based field extractor (reporter, product, event, dates). The **default** — runs with no model at all. | inside harness-service |
| **Ollama (optional)** | Local LLM inference for extraction assistance. Optional; the demo works without it. | 11434 (profile `ollama`) |

## Run flow (PV intake & triage)

1. **Intake** — a report arrives (manual entry in the console, or file import). A case is created in `draft` state. Raw text is stored verbatim; nothing is auto-submitted anywhere.
2. **Extract** — the deterministic extractor pulls structured fields (reporter, product, adverse event, onset date, seriousness flags). If Ollama is configured, an LLM pass may *suggest* additional fields — suggestions are labelled as such and never overwrite extracted facts without review. **Not yet implemented:** the LLM suggestion pass.
3. **Triage** — the harness applies triage rules (seriousness, expectedness flags) and proposes a priority + next step. This is a *proposal*, not a decision. Causality assessment is out of scope and never performed.
4. **Human review** — an operator/reviewer opens the case in the console, sees extracted fields beside the source text, corrects anything wrong, and approves or rejects the triage proposal.
5. **Approve** — the approval service records the decision (actor, timestamp, rationale). Only approved cases move to `triaged`. Rejected cases return to draft with a note.
6. **Audit export** — the audit store can export the case's full history (intake → extraction → review → approval) as JSON. The export is the evidence trail; it is never a regulator submission.

```
intake → extract → triage (proposal) → human review → approve → audit export
              ↑ deterministic first        ↑ approval service     ↑ audit store
              └─ Ollama (optional)         └─ no bypass path     └─ append-only
```

## Harness adapter

The adapter sits between the OpenWorker Agent Harness SDK and the domain:

- It exposes SDK agents as typed steps (`intake`, `extract`, `triage`) with
  explicit inputs/outputs, so the SDK sees agents and the domain sees cases.
- It owns retries/timeouts and translates SDK errors into domain errors
  (e.g. `extraction_failed`, `tool_denied`).
- It is the seam where a future **A2A adapter** would plug in (open item —
  see `docs/marketplace.md`); the A2A adapter is **not yet implemented**.

## Tool gateway

- Allow-list only: the extractor, the case store, and (when configured) the
  Ollama client. No shell, no network fetch, no external API by default.
- Every tool call is validated, timed out, and written to the audit log.
- **Not yet implemented:** per-role tool scoping (today the gateway is
  allow-listed per deployment, not per user role).

## Approval service

- State machine: `draft → pending_review → triaged | returned_to_draft`.
- Transitions require an authenticated human actor and a rationale for
  rejection. The service rejects any transition attempted by an agent
  identity.
- **Not yet implemented:** multi-reviewer / four-eyes approval (single
  approver in the MVP).

## Audit store

- Append-only: records are never updated or deleted in place; corrections
  are new records that reference the old ones.
- Local MVP: JSON files under `DATA_DIR` (see `docs/decisions.md` ADR-05).
- Cloud: the same records mirrored to the private Cloud Storage bucket
  provisioned in `infra/terraform/gcp/` (bucket exists in Terraform;
  **the mirroring/sync itself is not yet implemented**).
- Every record carries actor, action, payload hash, and timestamp so an
  export can be verified.

## What this platform never does (MVP)

- No causality assessment. No regulator submission. No autonomous sending
  of anything outside the system. No model output is ever treated as a
  decision — only a human approval is.
