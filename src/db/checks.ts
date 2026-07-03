// Offline outbox for Planned-Maintenance (2/10-day) check completions. A signed
// check is recorded locally first (so the countdown/serviceability update with no
// delay and no connectivity), then replayed to the server by syncPush. Native only —
// on web the SQLite stub no-ops and completeCheck talks to the server directly.
import { db } from './schema';

const norm = (r: string) => (r || '').replace(/[-\s]/g, '').toUpperCase();

export type LocalCheck = { id: string; reg: string; kind: string; completed_at: string; state: string; payload: any };

export async function queueCheck(reg: string, kind: string, body: any): Promise<{ id: string; completed_at: string }> {
  const d = await db();
  const id = 'lc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const completed_at = new Date().toISOString();
  const payload = { ...body, completed_at };          // the server accepts completed_at → true due window
  await d.runAsync('INSERT OR REPLACE INTO checks (id, reg, kind, completed_at, state, dirty, payload) VALUES (?,?,?,?,?,1,?)',
    id, norm(reg), kind, completed_at, 'pending', JSON.stringify(payload));
  return { id, completed_at };
}

export async function pendingChecks(): Promise<LocalCheck[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>("SELECT id, reg, kind, completed_at, state, payload FROM checks WHERE dirty = 1 AND state = 'pending'");
  return rows.map((r) => ({ id: r.id, reg: r.reg, kind: r.kind, completed_at: r.completed_at, state: r.state, payload: JSON.parse(r.payload) }));
}

export async function markCheckSynced(id: string) {
  const d = await db();
  await d.runAsync("UPDATE checks SET dirty = 0, state = 'synced' WHERE id = ?", id);
}

export async function markCheckRejected(id: string) {
  const d = await db();
  await d.runAsync("UPDATE checks SET dirty = 0, state = 'rejected' WHERE id = ?", id);
}

// kind -> latest local completed_at, for tails with a still-unsuperseded local sign.
// Used to optimistically clear the 'check overdue' serviceability reason on the iPad.
export async function localCompletedChecks(reg: string): Promise<Record<string, string>> {
  const d = await db();
  // 'pending' (not yet on the server) always counts; 'synced' only as a short smoothing
  // buffer (24 h) between the sync and the next server status fetch, to avoid resurrecting a stale value.
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await d.getAllAsync<any>(
    "SELECT kind, completed_at FROM checks WHERE reg = ? AND (state = 'pending' OR (state = 'synced' AND completed_at > ?)) ORDER BY completed_at DESC",
    norm(reg), cutoff);
  const out: Record<string, string> = {};
  for (const r of rows) if (!out[r.kind]) out[r.kind] = r.completed_at;
  return out;
}

// Checks the server rejected on sync (e.g. incomplete) — surfaced so the mechanic re-does them.
export async function rejectedChecks(reg?: string): Promise<LocalCheck[]> {
  const d = await db();
  const rows = reg
    ? await d.getAllAsync<any>("SELECT id, reg, kind, completed_at, state, payload FROM checks WHERE state = 'rejected' AND reg = ?", norm(reg))
    : await d.getAllAsync<any>("SELECT id, reg, kind, completed_at, state, payload FROM checks WHERE state = 'rejected'");
  return rows.map((r) => ({ id: r.id, reg: r.reg, kind: r.kind, completed_at: r.completed_at, state: r.state, payload: JSON.parse(r.payload) }));
}

export async function clearRejected(id: string) {
  const d = await db();
  await d.runAsync('DELETE FROM checks WHERE id = ?', id);
}
