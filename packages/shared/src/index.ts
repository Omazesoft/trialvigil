// Shared types for the TrialVigil MVP.
// SPDX-License-Identifier: Apache-2.0

export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "paused"
  | "killed"
  | "completed";

export interface RunStep {
  name: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail: string;
  at: string; // ISO timestamp
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  at: string; // ISO timestamp
}

/** One extracted field, always paired with the verbatim evidence it came from. */
export interface EvidenceField {
  value: string | null;
  sourceQuote: string | null;
}

export interface MinimumCriteria {
  identifiablePatient: boolean;
  identifiableReporter: boolean;
  suspectDrug: boolean;
  adverseEvent: boolean;
}

export interface DuplicateMatch {
  priorCaseId: string;
  drug: string;
  event: string;
  patientInitials: string | null;
  matchScore: number; // 0..1
  reason: string;
}

export interface DraftCase {
  /** Prominent safety flag — always present on every draft. */
  flag: "DRAFT — NOT SUBMITTED, causality NOT assessed";
  valid: boolean;
  workflow: string;
  product: string | null;
  fields: {
    patient: EvidenceField;
    reporter: EvidenceField;
    suspectDrug: EvidenceField;
    adverseEvent: EvidenceField;
    onsetDate: EvidenceField;
    drugStartDate: EvidenceField;
    dose: EvidenceField;
    patientAge: EvidenceField;
    patientSex: EvidenceField;
    /** Aliases so consumers using product/drug/event spellings resolve the same evidence. */
    product: EvidenceField;
    drug: EvidenceField;
    event: EvidenceField;
  };
  minimumCriteria: MinimumCriteria;
  seriousness: "serious" | "non-serious candidate" | "unknown";
  seriousnessReasons: string[];
  duplicateMatches: DuplicateMatch[];
  /** Alias of duplicateMatches — the console UI reads this name. */
  duplicateCandidates: DuplicateMatch[];
  followUpQuestions: string[];
  summary: string;
  disclaimer: string;
}

export interface ApprovalRecord {
  by: string;
  decision: "approved" | "rejected";
  reason: string | null;
  at: string; // ISO timestamp
}

export interface RunRecord {
  id: string;
  workflow: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  product: string | null;
  reporter: string | null;
  sourceText: string;
  steps: RunStep[];
  toolCalls: ToolCallRecord[];
  draftCase: DraftCase | null;
  approval: ApprovalRecord | null;
}

export interface AuditEntry {
  id: string;
  at: string; // ISO timestamp
  runId: string | null;
  actor: string;
  action: string;
  detail: string;
}

export interface DemoSample {
  id: string;
  label: string;
  /** SYNTHETIC / FAKE — no real patient data. */
  synthetic: true;
  product: string;
  reporter: string;
  text: string;
  /** Aliases the console UI reads (same values as label / text). */
  title: string;
  sourceText: string;
  description: string;
  /** What the demo expects the extractor to find (for the test script). */
  expectedValid: boolean;
  expectedSeriousness: DraftCase["seriousness"];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DRAFT_FLAG = "DRAFT — NOT SUBMITTED, causality NOT assessed" as const;
