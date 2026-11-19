// PV intake pack — deterministic, rule-based extractor (the DEFAULT).
// Works with no LLM and no network. This is what the demo uses.
//
// Hard safety rules (never change without a human safety review):
// - NEVER decide causality. NEVER submit to a regulator.
// - NEVER auto-create a case in a safety database. Draft only.
// - Every extracted field carries {value, sourceQuote} evidence.
// - Every draft carries the flag "DRAFT — NOT SUBMITTED, causality NOT assessed".
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DRAFT_FLAG,
  type DraftCase,
  type DuplicateMatch,
  type EvidenceField,
  type MinimumCriteria,
} from "@trialvigil/shared";

export const PV_TOOLS = [
  "read_intake_report",
  "extract_fields",
  "check_minimum_criteria",
  "flag_seriousness",
  "check_duplicates",
  "draft_case",
] as const;

export type PvToolName = (typeof PV_TOOLS)[number];

// ---------------------------------------------------------------------------
// Vocabularies (rule-based; extend deliberately, never by guessing a drug)
// ---------------------------------------------------------------------------

const KNOWN_DRUGS = [
  "Amoxicillin", "Metformin", "Atorvastatin", "Lisinopril", "Paracetamol",
  "Ibuprofen", "Warfarin", "Insulin", "Omeprazole", "Sertraline",
  "Amlodipine", "Levothyroxine", "Aspirin", "Prednisolone", "Salbutamol",
  "Gabapentin", "Losartan", "Simvastatin", "Ramipril", "Doxycycline",
  "Azithromycin", "Ciprofloxacin", "Fluoxetine", "Citalopram", "Tramadol",
];

const KNOWN_EVENTS = [
  "anaphylaxis", "rash", "nausea", "vomiting", "diarrhoea", "diarrhea",
  "headache", "dizziness", "seizure", "bleeding", "liver injury",
  "Stevens-Johnson syndrome", "skin rash", "itching", "stomach upset",
  "difficulty breathing", "swelling", "chest pain", "fatigue",
  "hospitalisation", "hospitalization", "death",
];

const SERIOUS_TERMS: Array<{ term: RegExp; label: string }> = [
  { term: /\b(died|death|fatal)\b/i, label: "death mentioned" },
  { term: /hospitali[sz](ed|ation)/i, label: "hospitalisation mentioned" },
  { term: /\bdisab(ility|led)\b/i, label: "disability mentioned" },
  { term: /birth defect/i, label: "birth defect mentioned" },
  { term: /life[- ]threatening/i, label: "life-threatening mentioned" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceContaining(text: string, re: RegExp): string | null {
  for (const s of sentences(text)) {
    if (re.test(s)) return s;
  }
  return null;
}

function field(value: string | null, sourceQuote: string | null): EvidenceField {
  return { value, sourceQuote };
}

const DATE_RE =
  /\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})\b/i;

function findDate(text: string, contextRe: RegExp): EvidenceField {
  const quote = sentenceContaining(text, contextRe);
  if (quote) {
    const m = quote.match(DATE_RE);
    if (m) return field(m[1], quote);
  }
  return field(null, null);
}

// ---------------------------------------------------------------------------
// Tool implementations — each one is recorded as a toolCall by the service.
// ---------------------------------------------------------------------------

export interface PriorCase {
  id: string;
  drug: string;
  event: string;
  patientInitials: string | null;
  onsetDate: string | null;
}

export function loadPriorCases(): PriorCase[] {
  const candidates = [
    path.resolve(process.cwd(), "data/seed/prior-cases.json"),
    path.resolve(__dirname, "../../../../data/seed/prior-cases.json"),
    path.resolve(__dirname, "../../../data/seed/prior-cases.json"),
    path.resolve(__dirname, "../../data/seed/prior-cases.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8")) as PriorCase[];
      }
    } catch {
      // fall through to next candidate
    }
  }
  return [];
}

export interface Extraction {
  patient: EvidenceField;
  reporter: EvidenceField;
  suspectDrug: EvidenceField;
  adverseEvent: EvidenceField;
  onsetDate: EvidenceField;
  drugStartDate: EvidenceField;
  dose: EvidenceField;
  patientAge: EvidenceField;
  patientSex: EvidenceField;
}

/** Tool: read_intake_report — normalise the raw report text. */
export function readIntakeReport(sourceText: string): { text: string; length: number } {
  const text = (sourceText ?? "").trim();
  return { text, length: text.length };
}

/** Tool: extract_fields — every field carries {value, sourceQuote}. */
export function extractFields(sourceText: string, productHint?: string): Extraction {
  const text = sourceText;

  // --- patient: initials + age/sex ---
  let patient: EvidenceField = field(null, null);
  let age: EvidenceField = field(null, null);
  let sex: EvidenceField = field(null, null);

  const ageRe = /(\d{1,3})-year-old\s+(female|male|woman|man|girl|boy)/i;
  const ageM = text.match(ageRe);
  if (ageM) {
    const quote = sentenceContaining(text, ageRe);
    age = field(ageM[1], quote);
    const raw = ageM[2].toLowerCase();
    sex = field(raw === "female" || raw === "woman" || raw === "girl" ? "female" : "male", quote);
  }
  const initialsRe = /Patient\s+([A-Z]{2})\b/;
  const initM = text.match(initialsRe);
  if (initM) {
    const quote = sentenceContaining(text, initialsRe);
    const who = ageM ? `${initM[1]}, ${ageM[1]}-year-old ${sex.value ?? ""}`.trim() : initM[1];
    patient = field(who, quote);
  } else if (ageM) {
    patient = field(`${ageM[1]}-year-old ${ageM[2].toLowerCase()}`, sentenceContaining(text, ageRe));
  }

  // --- reporter: "reported by / submitted by / Reporter: X" ---
  // Terminators: " on <year>", ", GP/MD/…", or end of text. The capture must
  // NOT stop at the period in "Dr." — hence no bare "." terminator; a
  // trailing period is stripped afterwards instead.
  let reporter: EvidenceField = field(null, null);
  const repRe =
    /(?:reported|submitted|sent)\s+by\s+(.+?)(?:\s+on\s+\d{4}|\s*,\s*(?:GP|MD|PhD|pharmacist|doctor)\b|$)/i;
  const repM = text.match(repRe);
  if (repM) {
    reporter = field(repM[1].trim().replace(/[.]+$/, ""), sentenceContaining(text, repRe));
  } else {
    const repLabel = text.match(/Reporter:\s*([^\n.;]+)/i);
    if (repLabel) {
      reporter = field(repLabel[1].trim(), sentenceContaining(text, /Reporter:/i));
    }
  }

  // --- suspect drug: known drug name, else "started/taking/prescribed X" pattern ---
  let drug: EvidenceField = field(null, null);
  for (const d of KNOWN_DRUGS) {
    const re = new RegExp(`\\b${d}\\b`, "i");
    const quote = sentenceContaining(text, re);
    if (quote) {
      drug = field(d, quote);
      break;
    }
  }
  if (!drug.value) {
    const pat = /(?:prescribed|started|taking|took)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/;
    const m = text.match(pat);
    if (m && !/^(a|the|new|this)\b/i.test(m[1])) {
      drug = field(m[1], sentenceContaining(text, pat));
    }
  }
  if (!drug.value && productHint) drug = field(productHint, null);

  // --- adverse event: known event phrase ---
  let event: EvidenceField = field(null, null);
  for (const e of KNOWN_EVENTS) {
    const re = new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const quote = sentenceContaining(text, re);
    if (quote) {
      // Prefer the most specific event (anaphylaxis over rash) — known list
      // is ordered most-specific first for the serious terms.
      event = field(e, quote);
      break;
    }
  }
  if (!event.value) {
    const devRe = /developed\s+([^.,;]+)/i;
    const expRe = /experienced\s+([^.,;]+)/i;
    const m = text.match(devRe) ?? text.match(expRe);
    if (m) event = field(m[1].trim(), sentenceContaining(text, devRe) ?? sentenceContaining(text, expRe));
  }

  // --- dates & dose ---
  const onsetDate = findDate(text, /(developed|experienced|onset|occurred)/i);
  const drugStartDate = findDate(text, /(starting|started|prescribed).*on|from\s+20\d{2}-/i);
  let dose: EvidenceField = field(null, null);
  const doseRe = /(\d+(?:\.\d+)?\s*(?:mg|g|ml|IU|units?)(?:\s+(?:once|twice|three times)\s+daily)?)/i;
  const doseM = text.match(doseRe);
  if (doseM) dose = field(doseM[1].trim(), sentenceContaining(text, doseRe));

  return { patient, reporter, suspectDrug: drug, adverseEvent: event, onsetDate, drugStartDate, dose, patientAge: age, patientSex: sex };
}

/** Tool: check_minimum_criteria — the 4: patient, reporter, drug, event. */
export function checkMinimumCriteria(extraction: Extraction): MinimumCriteria {
  return {
    identifiablePatient: extraction.patient.value !== null,
    identifiableReporter: extraction.reporter.value !== null,
    suspectDrug: extraction.suspectDrug.value !== null,
    adverseEvent: extraction.adverseEvent.value !== null,
  };
}

/** Tool: flag_seriousness — keyword-based only; never a clinical judgement. */
export function flagSeriousness(sourceText: string): { seriousness: DraftCase["seriousness"]; reasons: string[] } {
  const reasons: string[] = [];
  for (const t of SERIOUS_TERMS) {
    if (t.term.test(sourceText)) reasons.push(t.label);
  }
  if (reasons.length > 0) return { seriousness: "serious", reasons };
  return { seriousness: "non-serious candidate", reasons: ["no seriousness keyword (death / hospitalisation / disability / birth defect / life-threatening) found"] };
}

/** Tool: check_duplicates — drug + event + patient initials/dates vs seeded priors. */
export function checkDuplicates(
  extraction: Extraction,
  priorCases: PriorCase[] = loadPriorCases(),
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const drug = extraction.suspectDrug.value?.toLowerCase() ?? "";
  const event = extraction.adverseEvent.value?.toLowerCase() ?? "";
  const initials = extraction.patient.value?.match(/^([A-Z]{2})\b/)?.[1] ?? null;
  const onset = extraction.onsetDate.value;
  for (const p of priorCases) {
    let score = 0;
    const reasons: string[] = [];
    if (drug && p.drug.toLowerCase() === drug) { score += 0.4; reasons.push("same suspect drug"); }
    if (event && p.event.toLowerCase() === event) { score += 0.3; reasons.push("same adverse event"); }
    if (initials && p.patientInitials === initials) { score += 0.2; reasons.push("same patient initials"); }
    if (onset && p.onsetDate === onset) { score += 0.1; reasons.push("same onset date"); }
    // Threshold 0.8: drug+event alone (0.7) is NOT enough — initials or
    // onset date must also agree, otherwise every repeat drug/event pair
    // would be flagged as a duplicate.
    if (score >= 0.8) {
      matches.push({
        priorCaseId: p.id,
        drug: p.drug,
        event: p.event,
        patientInitials: p.patientInitials,
        matchScore: Math.round(score * 100) / 100,
        reason: reasons.join("; "),
      });
    }
  }
  return matches;
}

/** Tool: draft_case — draft ONLY. Causality is never assessed here. */
export function draftCase(
  sourceText: string,
  productHint?: string,
  priorCases?: PriorCase[],
): DraftCase {
  const extraction = extractFields(sourceText, productHint);
  const minimumCriteria = checkMinimumCriteria(extraction);
  const { seriousness, reasons } = flagSeriousness(sourceText);
  const duplicateMatches = checkDuplicates(extraction, priorCases);
  const valid =
    minimumCriteria.identifiablePatient &&
    minimumCriteria.identifiableReporter &&
    minimumCriteria.suspectDrug &&
    minimumCriteria.adverseEvent;

  const followUpQuestions: string[] = [];
  if (!minimumCriteria.identifiablePatient) followUpQuestions.push("Who is the patient? (identifiable patient details are missing — e.g. initials, age, sex.)");
  if (!minimumCriteria.identifiableReporter) followUpQuestions.push("Who reported this? (identifiable reporter name and contact are missing.)");
  if (!minimumCriteria.suspectDrug) followUpQuestions.push("Which medicine is suspected? (suspect drug name is missing.)");
  if (!minimumCriteria.adverseEvent) followUpQuestions.push("What adverse event occurred? (adverse event description is missing.)");
  if (duplicateMatches.length > 0) {
    followUpQuestions.push(
      `Possible duplicate of prior case(s) ${duplicateMatches.map((d) => d.priorCaseId).join(", ")} — please confirm whether this is a new report or a follow-up to an existing case.`,
    );
  }

  const summary = valid
    ? `Draft PV intake: ${extraction.suspectDrug.value ?? "unknown drug"} / ${extraction.adverseEvent.value ?? "unknown event"} — ${seriousness}. Minimum criteria met.`
    : `Draft PV intake: minimum criteria NOT met (${Object.entries(minimumCriteria).filter(([, v]) => !v).map(([k]) => k).join(", ")} missing). Follow-up required before this can be considered a valid case.`;

  return {
    flag: DRAFT_FLAG,
    valid,
    workflow: "pv-intake",
    product: extraction.suspectDrug.value ?? productHint ?? null,
    fields: {
      patient: extraction.patient,
      reporter: extraction.reporter,
      suspectDrug: extraction.suspectDrug,
      adverseEvent: extraction.adverseEvent,
      onsetDate: extraction.onsetDate,
      drugStartDate: extraction.drugStartDate,
      dose: extraction.dose,
      patientAge: extraction.patientAge,
      patientSex: extraction.patientSex,
      // Aliases (same evidence) for consumers using product/drug/event spellings.
      product: extraction.suspectDrug,
      drug: extraction.suspectDrug,
      event: extraction.adverseEvent,
    },
    minimumCriteria,
    seriousness,
    seriousnessReasons: reasons,
    duplicateMatches,
    duplicateCandidates: duplicateMatches,
    followUpQuestions,
    summary,
    disclaimer:
      "DRAFT — NOT SUBMITTED, causality NOT assessed. This draft was produced by a deterministic rule-based extractor. It must be reviewed and approved by a qualified human before any case is created in a safety database or submitted to any regulator. No causality assessment has been made.",
  };
}

/** Run the full PV tool sequence, recording each tool call for the harness. */
export interface PvToolCall {
  tool: PvToolName;
  args: Record<string, unknown>;
  result: unknown;
}

export function runPvIntake(sourceText: string, productHint?: string): { draft: DraftCase; toolCalls: PvToolCall[] } {
  const toolCalls: PvToolCall[] = [];
  const record = <T>(tool: PvToolName, args: Record<string, unknown>, result: T): T => {
    toolCalls.push({ tool, args, result: result as unknown });
    return result;
  };

  const read = record("read_intake_report", { length: sourceText.length }, readIntakeReport(sourceText));
  const extraction = record(
    "extract_fields",
    { productHint: productHint ?? null },
    extractFields(read.text, productHint),
  );
  const criteria = record("check_minimum_criteria", {}, checkMinimumCriteria(extraction));
  const serious = record("flag_seriousness", {}, flagSeriousness(read.text));
  const priors = loadPriorCases();
  const dups = record("check_duplicates", { priorCasesChecked: priors.length }, checkDuplicates(extraction, priors));
  const draft = record(
    "draft_case",
    { valid: criteria.identifiablePatient && criteria.identifiableReporter && criteria.suspectDrug && criteria.adverseEvent },
    draftCase(read.text, productHint, priors),
  );
  void serious;
  void dups;
  return { draft, toolCalls };
}
