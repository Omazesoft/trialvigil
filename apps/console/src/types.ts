// Types matching the harness-service contract (http://localhost:3001).
// Do not invent fields here: the service is the source of truth.

export type RunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'paused'
  | 'killed'

export const TERMINAL_STATUSES: RunStatus[] = ['approved', 'rejected', 'killed']

export interface RunStep {
  name: string
  status: string
  detail?: string
  at?: string
}

export interface ToolCall {
  tool: string
  args?: unknown
  result?: unknown
  at?: string
}

export interface FieldEvidence {
  value: string
  sourceQuote?: string
}

// A draft-case field may arrive as {value, sourceQuote} or as a plain string.
export type DraftField = FieldEvidence | string

export interface DraftCase {
  fields?: Record<string, DraftField>
  // Some services flatten fields to the top level; keep this indexable.
  [key: string]: unknown
  valid?: boolean
  seriousness?: string
  duplicateCandidates?: unknown[]
  followUpQuestions?: string[]
}

export interface Run {
  id: string
  runId?: string
  workflow: string
  status: RunStatus
  createdAt?: string
  product?: string
  sourceText?: string
  steps?: RunStep[]
  toolCalls?: ToolCall[]
  draftCase?: DraftCase | null
  approval?: { by?: string; reason?: string; at?: string; decision?: string } | null
}

export interface AuditEntry {
  id?: string
  at?: string
  timestamp?: string
  runId?: string
  action?: string
  event?: string
  actor?: string
  by?: string
  detail?: string
  [key: string]: unknown
}

export interface DemoSample {
  id: string
  sampleId?: string
  product?: string
  title?: string
  description?: string
  sourceText?: string
  [key: string]: unknown
}

export const MINIMUM_CRITERIA = [
  'patient',
  'reporter',
  'product',
  'event',
] as const

export function fieldValue(f: DraftField | undefined): string {
  if (f == null) return ''
  return typeof f === 'string' ? f : f.value ?? ''
}

export function fieldQuote(f: DraftField | undefined): string {
  if (f == null || typeof f === 'string') return ''
  return f.sourceQuote ?? ''
}

/** Resolve a draft-case field by trying several likely key spellings. */
export function getField(
  draft: DraftCase | null | undefined,
  ...keys: string[]
): DraftField | undefined {
  if (!draft) return undefined
  const container = (draft.fields ?? draft) as Record<string, unknown>
  for (const k of keys) {
    if (container[k] != null) return container[k] as DraftField
    const lower = Object.keys(container).find(
      (ck) => ck.toLowerCase().replace(/[^a-z]/g, '') === k.toLowerCase().replace(/[^a-z]/g, ''),
    )
    if (lower) return container[lower] as DraftField
  }
  return undefined
}

/** The 4 minimum criteria for a valid case, evaluated from the draft. */
export function minimumCriteriaCheck(draft: DraftCase | null | undefined): {
  key: string
  label: string
  present: boolean
  value: string
}[] {
  const labels: Record<string, string> = {
    patient: 'Identifiable patient',
    reporter: 'Identifiable reporter',
    product: 'Suspect product',
    event: 'Adverse event / reaction',
  }
  return MINIMUM_CRITERIA.map((key) => {
    const aliases: Record<string, string[]> = {
      patient: ['patient', 'patientId', 'patientIdentifier'],
      reporter: ['reporter', 'reporterName', 'reporterContact'],
      product: ['product', 'suspectProduct', 'drug'],
      event: ['event', 'adverseEvent', 'reaction', 'adverseReaction'],
    }
    const v = fieldValue(getField(draft, ...(aliases[key] ?? [key])))
    return { key, label: labels[key], present: v.trim().length > 0, value: v }
  })
}
