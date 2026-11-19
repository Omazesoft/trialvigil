import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Run } from '../types'
import { TERMINAL_STATUSES } from '../types'
import DraftCaseView from './DraftCase'

function fmtTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

export default function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    try {
      setRun(await api.getRun(runId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
    // Live polling while the run is not terminal.
    const t = window.setInterval(() => {
      setRun((cur) => {
        if (cur && TERMINAL_STATUSES.includes(cur.status)) return cur
        void load()
        return cur
      })
    }, 2000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(`${label} recorded.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  if (error && !run) {
    return (
      <div>
        <button className="btn link" onClick={onBack}>← Back to runs</button>
        <p className="error">Could not load run {runId}: {error}</p>
      </div>
    )
  }
  if (!run) return <p className="muted">Loading run…</p>

  const terminal = TERMINAL_STATUSES.includes(run.status)
  const isPaused = run.status === 'paused'

  return (
    <div>
      <button className="btn link" onClick={onBack}>← Back to runs</button>
      <h2>Run {run.id ?? run.runId}</h2>
      <p className="muted">
        Workflow: {run.workflow} · Status: <span className={`status status-${run.status}`}>{run.status}</span>
        {' · '}Product: <strong>{run.product ?? '—'}</strong>
        {' · '}Created: {fmtTime(run.createdAt)}
      </p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="controls">
        <button
          className="btn"
          disabled={terminal || isPaused || !!busy}
          onClick={() => void act('Pause', () => api.pauseRun(run.id))}
        >
          {busy === 'Pause' ? 'Pausing…' : 'Pause'}
        </button>
        <button
          className="btn"
          disabled={terminal || !isPaused || !!busy}
          onClick={() => void act('Resume', () => api.resumeRun(run.id))}
        >
          {busy === 'Resume' ? 'Resuming…' : 'Resume'}
        </button>
        <button
          className="btn danger"
          disabled={terminal || !!busy}
          onClick={() => {
            if (window.confirm('Kill this run? This cannot be undone.')) {
              void act('Kill', () => api.killRun(run.id))
            }
          }}
        >
          {busy === 'Kill' ? 'Killing…' : 'Kill'}
        </button>
        <span className="muted small">
          {terminal
            ? 'Run is terminal — pause / resume / kill are disabled.'
            : 'Pause and kill are always one click while the run is active.'}
        </span>
      </div>

      {run.approval && (
        <p className="notice">
          Approval recorded: {run.approval.decision ?? run.status} by {run.approval.by ?? '—'}
          {run.approval.reason ? ` — “${run.approval.reason}”` : ''}
          {run.approval.at ? ` (${fmtTime(run.approval.at)})` : ''}
        </p>
      )}

      <div className="grid">
        <div className="card">
          <h3>Step plan</h3>
          {!run.steps?.length ? (
            <p className="muted">No steps reported yet.</p>
          ) : (
            <ol className="steps">
              {run.steps.map((s, i) => (
                <li key={i} className={`step-${s.status}`}>
                  <strong>{s.name}</strong> — <span className="muted">{s.status}</span>
                  {s.detail && <div className="muted small">{s.detail}</div>}
                  {s.at && <div className="muted small">{fmtTime(s.at)}</div>}
                </li>
              ))}
            </ol>
          )}

          <h3>Source text</h3>
          <pre className="source">{run.sourceText || '—'}</pre>
        </div>

        <div className="card">
          <h3>Live tool-call log</h3>
          {!run.toolCalls?.length ? (
            <p className="muted">No tool calls yet.</p>
          ) : (
            <ul className="toollog">
              {run.toolCalls.map((t, i) => (
                <li key={i}>
                  <strong>{t.tool}</strong>
                  {t.at && <span className="muted small"> · {fmtTime(t.at)}</span>}
                  {t.args !== undefined && (
                    <pre>{JSON.stringify(t.args, null, 2)}</pre>
                  )}
                  {t.result !== undefined && (
                    <pre className="result">{JSON.stringify(t.result, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <DraftCaseView draft={run.draftCase} />
    </div>
  )
}
