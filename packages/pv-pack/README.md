# @trialvigil/pv-pack

Deterministic, rule-based PV (pharmacovigilance) intake extractor — the
**default** agent pack for the TrialVigil MVP. Works with no LLM and no
network.

## Tools (each recorded as a `toolCall` by the harness service)

| Tool | What it does |
| --- | --- |
| `read_intake_report` | Normalises the raw report text. |
| `extract_fields` | Patient, reporter, suspect drug, adverse event, dates, dose. Every field carries `{ value, sourceQuote }` evidence — the verbatim sentence it came from. |
| `check_minimum_criteria` | The 4 minimum criteria: identifiable patient, identifiable reporter, suspect drug, adverse event. Valid only if all 4 are present. |
| `flag_seriousness` | Serious if death / hospitalisation / disability / birth defect / life-threatening is mentioned; otherwise a non-serious candidate. Keyword-based only — never a clinical judgement. |
| `check_duplicates` | Matches drug + event + patient initials / dates against seeded prior cases in `data/seed/prior-cases.json`. A match needs drug + event **plus** initials or onset date (score >= 0.8). |
| `draft_case` | Drafts the case. Always carries the flag `DRAFT — NOT SUBMITTED, causality NOT assessed`. |

## Hard safety rules

- **NEVER decide causality.** The extractor does not assess causality, ever.
- **NEVER submit to a regulator.** Nothing in this pack contacts any regulator.
- **NEVER auto-create a case in a safety database.** Output is a draft only;
  a qualified human must approve it via `POST /api/runs/:id/approve` first.
- If any minimum criterion is missing, `draftCase.valid` is `false`, the run
  still ends in `awaiting_approval`, and `followUpQuestions` lists exactly
  what is missing.

## Usage

```ts
import { runPvIntake } from "@trialvigil/pv-pack";

const { draft, toolCalls } = runPvIntake(sourceText, productHint);
```

`runPvIntake` runs the six tools in order and returns the draft plus the
tool-call records (arguments + results) for the harness to store.
