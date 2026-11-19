import type { DraftCase } from '../types'
import { fieldQuote, fieldValue, getField, minimumCriteriaCheck } from '../types'

function pretty(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** Evidence viewer: every extracted field with its source quote. */
export default function DraftCaseView({ draft }: { draft: DraftCase | null | undefined }) {
  if (!draft) {
    return (
      <div className="card">
        <h3>Draft case</h3>
        <p className="muted">No draft case yet — the run is still extracting, or extraction produced nothing.</p>
      </div>
    )
  }

  const criteria = minimumCriteriaCheck(draft)
  const missing = criteria.filter((c) => !c.present)
  const fields = (draft.fields ?? {}) as Record<string, unknown>
  // If fields are flattened on the draft itself, show the non-reserved keys.
  const reserved = new Set([
    'fields', 'valid', 'seriousness', 'duplicateCandidates', 'followUpQuestions',
  ])
  const flatEntries = Object.entries(draft).filter(([k]) => !reserved.has(k))
  const fieldEntries: [string, unknown][] =
    Object.keys(fields).length > 0 ? Object.entries(fields) : flatEntries

  const seriousness =
    typeof draft.seriousness === 'string' ? draft.seriousness : pretty(draft.seriousness)
  const duplicates = Array.isArray(draft.duplicateCandidates) ? draft.duplicateCandidates : []
  const questions = Array.isArray(draft.followUpQuestions) ? draft.followUpQuestions : []

  return (
    <div className="card">
      <div className="draft-banner" role="alert">
        DRAFT — NOT SUBMITTED. Causality NOT assessed.
      </div>

      <h3>Draft case</h3>
      <p className="muted">
        Validity: <strong>{draft.valid ? 'Valid (4 minimum criteria met)' : 'Not valid — minimum criteria missing'}</strong>
        {' · '}Seriousness: <strong>{seriousness || '—'}</strong>
      </p>

      <h4>Minimum criteria (4 required)</h4>
      <ul className="criteria">
        {criteria.map((c) => (
          <li key={c.key} className={c.present ? 'ok' : 'missing'}>
            <span aria-hidden>{c.present ? '✓' : '✗'}</span>{' '}
            {c.label}
            {c.present ? `: ${c.value}` : ' — MISSING'}
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="missing-note">
          Missing minimum criteria: {missing.map((m) => m.label).join(', ')}. This case cannot be
          submitted as valid until they are supplied.
        </p>
      )}

      <h4>Extracted fields &amp; evidence</h4>
      {fieldEntries.length === 0 ? (
        <p className="muted">No extracted fields.</p>
      ) : (
        <table className="evidence">
          <thead>
            <tr><th>Field</th><th>Value</th><th>Source quote</th></tr>
          </thead>
          <tbody>
            {fieldEntries.map(([key, raw]) => {
              const value = typeof raw === 'string' || raw == null ? pretty(raw) : fieldValue(raw as never)
              const quote = typeof raw === 'object' && raw !== null ? fieldQuote(raw as never) : ''
              return (
                <tr key={key}>
                  <td className="field-name">{key}</td>
                  <td>{value || '—'}</td>
                  <td className="quote">{quote ? `“${quote}”` : <span className="muted">No source quote</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h4>Seriousness</h4>
      <p>{seriousness || 'Not assessed'}</p>

      <h4>Duplicate candidates</h4>
      {duplicates.length === 0 ? (
        <p className="muted">No duplicate candidates found.</p>
      ) : (
        <ul>
          {duplicates.map((d, i) => (
            <li key={i}>{pretty(d)}</li>
          ))}
        </ul>
      )}

      <h4>Follow-up questions</h4>
      {questions.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ol>
          {questions.map((q, i) => (
            <li key={i}>{String(q)}</li>
          ))}
        </ol>
      )}
      {/* Keep the product field reachable even when flattened differently. */}
      <p className="muted small">
        Product (from draft): {fieldValue(getField(draft, 'product', 'suspectProduct', 'drug')) || '—'}
      </p>
    </div>
  )
}
