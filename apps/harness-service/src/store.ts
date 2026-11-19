// File-based JSON store — the MVP local store.
// data/runs.json holds all runs; data/audit.jsonl is append-only (one JSON
// object per line, never rewritten). The GCP profile replaces this with
// Postgres; the service API does not change.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as path from "node:path";
import { newId, nowIso, type AuditEntry, type RunRecord } from "@trialvigil/shared";

function dataDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "data"),
    path.resolve(__dirname, "../../../data"),
    path.resolve(__dirname, "../../../../data"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "seed"))) return p;
  }
  const fallback = candidates[0];
  fs.mkdirSync(path.join(fallback, "seed"), { recursive: true });
  return fallback;
}

const DIR = dataDir();
const RUNS_FILE = path.join(DIR, "runs.json");
const AUDIT_FILE = path.join(DIR, "audit.jsonl");

export function seedFile(name: string): string {
  return path.join(DIR, "seed", name);
}

export function loadRuns(): RunRecord[] {
  try {
    if (!fs.existsSync(RUNS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(RUNS_FILE, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: RunRecord[]): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2) + "\n", "utf8");
}

export function loadAudit(): AuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    return fs
      .readFileSync(AUDIT_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}

/** Append-only: audit entries are never edited or deleted. */
export function appendAudit(entry: Omit<AuditEntry, "id" | "at"> & { at?: string }): AuditEntry {
  const full: AuditEntry = {
    id: newId("audit"),
    at: entry.at ?? nowIso(),
    runId: entry.runId,
    actor: entry.actor,
    action: entry.action,
    detail: entry.detail,
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(full) + "\n", "utf8");
  return full;
}
