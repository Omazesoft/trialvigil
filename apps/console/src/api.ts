import type { AuditEntry, DemoSample, Run } from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      msg = (body as { error?: string; message?: string }).error ??
        (body as { message?: string }).message ?? msg
    } catch {
      // keep HTTP status text
    }
    throw new Error(msg)
  }
  // 204 / empty bodies
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

const unwrapRuns = (d: unknown): Run[] =>
  Array.isArray(d) ? (d as Run[]) : ((d as { runs?: Run[] }).runs ?? [])

const unwrapAudit = (d: unknown): AuditEntry[] =>
  Array.isArray(d) ? (d as AuditEntry[]) : ((d as { entries?: AuditEntry[]; audit?: AuditEntry[] }).entries ??
    (d as { audit?: AuditEntry[] }).audit ?? [])

const unwrapSamples = (d: unknown): DemoSample[] =>
  Array.isArray(d) ? (d as DemoSample[]) : ((d as { samples?: DemoSample[] }).samples ?? [])

export const api = {
  health: () => req<{ status?: string }>('/health'),
  listRuns: async (): Promise<Run[]> => unwrapRuns(await req('/api/runs')),
  getRun: (id: string) => req<Run>(`/api/runs/${encodeURIComponent(id)}`),
  createRun: (sourceText: string, product?: string) =>
    req<{ runId: string; status: string; draftCase?: unknown }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflow: 'pv-intake',
        sourceText,
        ...(product ? { product } : {}),
      }),
    }),
  pauseRun: (id: string) => req(`/api/runs/${encodeURIComponent(id)}/pause`, { method: 'POST', body: '{}' }),
  resumeRun: (id: string) => req(`/api/runs/${encodeURIComponent(id)}/resume`, { method: 'POST', body: '{}' }),
  killRun: (id: string) => req(`/api/runs/${encodeURIComponent(id)}/kill`, { method: 'POST', body: '{}' }),
  approveRun: (id: string, by: string, reason?: string) =>
    req(`/api/runs/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ by, ...(reason ? { reason } : {}) }),
    }),
  rejectRun: (id: string, by: string, reason: string) =>
    req(`/api/runs/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ by, reason }),
    }),
  listAudit: async (): Promise<AuditEntry[]> => unwrapAudit(await req('/api/audit')),
  exportAudit: async (): Promise<Blob> => {
    const res = await fetch('/api/audit/export')
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.blob()
  },
  seedDemo: () => req('/api/demo/seed', { method: 'POST', body: '{}' }),
  listSamples: async (): Promise<DemoSample[]> => unwrapSamples(await req('/api/demo/samples')),
  runSample: (sampleId: string) =>
    req<{ runId: string; status: string }>('/api/demo/run-sample', {
      method: 'POST',
      body: JSON.stringify({ sampleId }),
    }),
}
