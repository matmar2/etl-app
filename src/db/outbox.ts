import { db } from './schema';

// Generic offline outbox: server mutations that fail while offline are queued here and
// replayed in order by syncPush() when connectivity returns, so no entry is ever lost.
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export async function queueRequest(method: string, path: string, bodyStr?: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO outbox (id, method, path, body, created_at) VALUES (?,?,?,?,?)',
    uid(), method, path, bodyStr ?? null, new Date().toISOString());
}

export async function outboxCount(): Promise<number> {
  const d = await db();
  const r = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return r?.n ?? 0;
}

// Sector ids that still have a queued DELETE waiting to reach the server. Used by the
// sector-list reconcile to decide whether a tombstone is still pending vs. resolved.
export async function pendingSectorDeleteIds(): Promise<Set<string>> {
  const d = await db();
  const rows = await d.getAllAsync<{ path: string }>(
    "SELECT path FROM outbox WHERE method = 'DELETE' AND path LIKE '/sectors/%'");
  const ids = new Set<string>();
  for (const r of rows) {
    const m = /^\/sectors\/([^/?]+)/.exec(r.path);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// Replay queued mutations oldest-first. Delete on success or on a terminal HTTP 4xx
// (retrying a client error would loop forever). Stop on offline / 5xx to retry next sync.
export async function flushOutbox(apiFn: (path: string, init: any) => Promise<any>): Promise<void> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: string; method: string; path: string; body: string | null }>(
    'SELECT id, method, path, body FROM outbox ORDER BY created_at');
  for (const r of rows) {
    try {
      await apiFn(r.path, { method: r.method, ...(r.body ? { body: r.body } : {}) });
      await d.runAsync('DELETE FROM outbox WHERE id = ?', r.id);
    } catch (e: any) {
      if (/→ 4\d\d/.test(String(e?.message || ''))) {           // 4xx client error → terminal, drop it
        await d.runAsync('DELETE FROM outbox WHERE id = ?', r.id);
        continue;
      }
      return;                                                    // offline (NetworkError) or 5xx → keep, retry later
    }
  }
}
