import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { AuditEntry, DemoSample, Run, RunStatus } from './types'
import RunDetail from './components/RunDetail'
import DraftCaseView from './components/DraftCase'

type View = 'runs' | 'inbox' | 'audit'

const ALL_STATUSES: RunStatus[] = [
  'running',
  'awaiting_approval',
  'approved',
  'rejected',
  'paused',
  'killed',
]

function fmtTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

function seriousnessOf(r: Run): string {
  const s = r.draftCase?.seriousness
  return typeof s === 'string' ? s : s == null ? '—' : String(s)
}

export default function App() {
  const [view, setView] = useState<View>('runs')
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all')
  const [scopeProduct, setScopeProduct] = useState<string>('all')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [harnessUp, setHarnessUp] = useState<boolean | null>(null)

  // New intake form
  const [sourceText, setSourceText] = useState('')
  const [product, setProduct] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Demo run
  const [samples, setSamples] = useState<DemoSample[]>([])
  const [sampleId, setSampleId] = useState('')
  const [demoBusy, setDemoBusy] = useState(false)

  // Audit
  const [audit, setAudit] = useState<AuditEntry[]>([])

  // Approval inbox: per-run approver name + reason
  const [approver, setApprover] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const [approvalBusy, setApprovalBusy] = useState('')
  const [approvalError, setApprovalError] = useState('')

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api.listRuns())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadAudit = useCallback(async () => {
    try {
      setAudit(await api.listAudit())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void api
      .health()
      .then(() => setHarnessUp(true))
      .catch(() => setHarnessUp(false))
      .finally(() => setLoading(false))
    void loadRuns()
    void loadAudit()
    const t = window.setInterval(() => {
      void loadRuns()
      if (view === 'audit') void loadAudit()
    }, 5000)
    return () => window.clearInterval(t)
  }, [loadRuns, loadAudit, view])

  const products = useMemo(() => {
    const set = new Set<string>()
    runs.forEach((r) => {
      if (r.product) set.add(r.product)
    })
    return [...set].sort()
  }, [runs])

  const filteredRuns = runs.filter(
    (r) =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      (scopeProduct === 'all' || r.product === scopeProduct),
  )
  const awaiting = runs.filter((r) => r.status === 'awaiting_approval')

  const startDemoRun = async () => {
    setDemoBusy(true)
    setError('')
    setNotice('')
    try {
      await api.seedDemo()
      const list = await api.listSamples()
      setSamples(list)
      const id = sampleId || list[0]?.id || list[0]?.sampleId
      if (!id) throw new Error('No demo samples returned by /api/demo/samples after seeding.')
      setSampleId(id)
      const res = await api.runSample(id)
      setNotice(`Demo run started: ${res.runId ?? id}.`)
      await loadRuns()
      if (res.runId) setSelectedRunId(res.runId)
    } catch (e) {
      setError(`Demo run failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDemoBusy(false)
    }
  }

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sourceText.trim()) {
      setError('Paste the report text before submitting.')
      return
    }
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const res = await api.createRun(sourceText.trim(), product.trim() || undefined)
      setNotice(`Intake run started: ${res.runId}.`)
      setSourceText('')
      await loadRuns()
      if (res.runId) setSelectedRunId(res.runId)
    } catch (err) {
      setError(`New intake failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const decide = async (run: Run, decision: 'approve' | 'reject') => {
    const by = (approver[run.id] ?? '').trim()
    const rsn = (reason[run.id] ?? '').trim()
    if (!by) {
      setApprovalError('Approver name cannot be blank.')
      return
    }
    if (decision === 'reject' && !rsn) {
      setApprovalError('A reason is required to reject.')
      return
    }
    setApprovalError('')
    setApprovalBusy(`${decision}:${run.id}`)
    try {
      if (decision === 'approve') await api.approveRun(run.id, by, rsn || undefined)
      else await api.rejectRun(run.id, by, rsn)
      setNotice(`${decision === 'approve' ? 'Approval' : 'Rejection'} recorded for run ${run.id} by ${by}.`)
      await loadRuns()
      await loadAudit()
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : String(err))
    } finally {
      setApprovalBusy('')
    }
  }

  const exportAudit = async () => {
    setError('')
    try {
      const blob = await api.exportAudit()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trialvigil-audit-${new Date().toISOString().slice(0, 10)}.${blob.type.includes('json') ? 'json' : 'csv'}`
      a.click()
      URL.revokeObjectURL(url)
      setNotice('Audit export downloaded.')
    } catch (err) {
      setError(`Audit export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>TrialVigil — Operator Console</h1>
          <p className="muted">Omazesoft · open source (Apache 2.0) · pv-intake workflow</p>
        </div>
        <div className="header-right">
          <label>
            Scope (product):{' '}
            <select value={scopeProduct} onChange={(e) => setScopeProduct(e.target.value)}>
              <option value="all">All products</option>
              {products.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <span className={`health ${harnessUp === true ? 'up' : harnessUp === false ? 'down' : ''}`}>
            Harness: {harnessUp === true ? 'up' : harnessUp === false ? 'unreachable (localhost:3001)' : 'checking…'}
          </span>
        </div>
      </header>

      <div className="demo-banner" role="note">
        SYNTHETIC DEMO DATA ONLY — no real patient data
      </div>

      <nav className="nav">
        <button className={view === 'runs' && !selectedRunId ? 'active' : ''} onClick={() => { setView('runs'); setSelectedRunId(null) }}>
          Run board ({runs.length})
        </button>
        <button className={view === 'inbox' ? 'active' : ''} onClick={() => { setView('inbox'); setSelectedRunId(null) }}>
          Approval inbox ({awaiting.length})
        </button>
        <button className={view === 'audit' ? 'active' : ''} onClick={() => { setView('audit'); setSelectedRunId(null); void loadAudit() }}>
          Audit
        </button>
      </nav>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {loading && <p className="muted">Loading…</p>}

      {selectedRunId ? (
        <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      ) : view === 'runs' ? (
        <main>
          <section className="card">
            <h2>Start a run</h2>
            <div className="controls">
              <button className="btn primary" disabled={demoBusy} onClick={() => void startDemoRun()}>
                {demoBusy ? 'Starting demo run…' : 'Start demo run'}
              </button>
              {samples.length > 0 && (
                <label>
                  Sample:{' '}
                  <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
                    {samples.map((s) => (
                      <option key={s.id ?? s.sampleId} value={s.id ?? s.sampleId}>
                        {(s.title ?? s.id ?? s.sampleId) + (s.product ? ` — ${s.product}` : '')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="muted small">Seeds demo data, then runs a synthetic sample through pv-intake.</span>
            </div>
          </section>

          <section className="card">
            <h2>New intake</h2>
            <form onSubmit={submitIntake}>
              <label>
                Product (optional)
                <input
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="e.g. DrugX 10 mg"
                />
              </label>
              <label>
                Report text
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Paste the adverse-event report text here…"
                  rows={5}
                  required
                />
              </label>
              <button className="btn primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit intake'}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Run board</h2>
            <label>
              Filter by status:{' '}
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RunStatus)}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {filteredRuns.length === 0 ? (
              <p className="muted">No runs match. Start a demo run or submit a new intake.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Run</th><th>Status</th><th>Product</th><th>Seriousness</th><th>Created</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredRuns.map((r) => (
                    <tr key={r.id ?? r.runId} onClick={() => setSelectedRunId(r.id ?? r.runId ?? '')} className="clickable">
                      <td>{r.id ?? r.runId}</td>
                      <td><span className={`status status-${r.status}`}>{r.status}</span></td>
                      <td>{r.product ?? '—'}</td>
                      <td>{seriousnessOf(r)}</td>
                      <td>{fmtTime(r.createdAt)}</td>
                      <td><button className="btn" onClick={(e) => { e.stopPropagation(); setSelectedRunId(r.id ?? r.runId ?? '') }}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      ) : view === 'inbox' ? (
        <main>
          <section className="card">
            <h2>Approval inbox</h2>
            <p className="muted">
              Runs awaiting a human decision. Approving / rejecting records the approver, the
              decision and the reason in the audit log. Nothing here submits a case — drafts stay
              drafts until approved.
            </p>
            {approvalError && <p className="error">{approvalError}</p>}
            {awaiting.length === 0 ? (
              <p className="muted">No runs awaiting approval.</p>
            ) : (
              awaiting.map((r) => (
                <article key={r.id} className="inbox-item">
                  <h3>
                    Run {r.id} · {r.product ?? '—'} · {fmtTime(r.createdAt)}
                  </h3>
                  <label>
                    Approver name (required)
                    <input
                      value={approver[r.id] ?? ''}
                      onChange={(e) => setApprover({ ...approver, [r.id]: e.target.value })}
                      placeholder="Your name"
                    />
                  </label>
                  <label>
                    Reason {r.status === 'awaiting_approval' ? '(required to reject)' : ''}
                    <input
                      value={reason[r.id] ?? ''}
                      onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })}
                      placeholder="Reason for this decision"
                    />
                  </label>
                  <div className="controls">
                    <button
                      className="btn primary"
                      disabled={approvalBusy !== ''}
                      onClick={() => void decide(r, 'approve')}
                    >
                      {approvalBusy === `approve:${r.id}` ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      className="btn danger"
                      disabled={approvalBusy !== ''}
                      onClick={() => void decide(r, 'reject')}
                    >
                      {approvalBusy === `reject:${r.id}` ? 'Rejecting…' : 'Reject'}
                    </button>
                    <button className="btn" onClick={() => setSelectedRunId(r.id)}>View draft case</button>
                  </div>
                  <DraftCaseView draft={r.draftCase} />
                </article>
              ))
            )}
          </section>
        </main>
      ) : (
        <main>
          <section className="card">
            <h2>Audit</h2>
            <div className="controls">
              <button className="btn primary" onClick={() => void exportAudit()}>Export audit</button>
              <button className="btn" onClick={() => void loadAudit()}>Refresh</button>
              <span className="muted small">Export downloads GET /api/audit/export.</span>
            </div>
            {audit.length === 0 ? (
              <p className="muted">No audit entries yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>When</th><th>Run</th><th>Action / event</th><th>Actor</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={a.id ?? i}>
                      <td>{fmtTime(a.at ?? a.timestamp)}</td>
                      <td>{String(a.runId ?? '—')}</td>
                      <td>{String(a.action ?? a.event ?? '—')}</td>
                      <td>{String(a.actor ?? a.by ?? '—')}</td>
                      <td>{String(a.detail ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      )}

      <footer className="footer muted small">
        TrialVigil Operator Console · Synthetic demo data only — no real patient data · Drafts are
        not submitted and causality is not assessed.
      </footer>
    </div>
  )
}
