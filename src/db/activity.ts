import { db } from './schema';

// Local activity buffer: records every user action (screen views, entity opens,
// document access) with the real timestamp so the server audit trail reflects
// when things actually happened — not when the iPad synced.
// Rows are flushed to /activity/batch on sync and purged immediately after.

const BATCH_SIZE = 200;
const DEDUP_MS = 2000;
let _lastKey = '';
let _lastAt = 0;

export async function trackActivity(
  action: string,
  entityType: string,
  entityId?: string,
  screen?: string,
  metadata?: Record<string, any>,
): Promise<void> {
  try {
    const key = `${action}:${entityType}:${entityId ?? ''}`;
    const now = Date.now();
    if (key === _lastKey && now - _lastAt < DEDUP_MS) return;
    _lastKey = key;
    _lastAt = now;
    const d = await db();
    await d.runAsync(
      'INSERT INTO activity_log (action, entity_type, entity_id, screen, metadata, created_at) VALUES (?,?,?,?,?,?)',
      action, entityType, entityId ?? null, screen ?? null,
      metadata ? JSON.stringify(metadata) : null,
      new Date().toISOString(),
    );
  } catch {
    // never let tracking failures break the app
  }
}

export async function activityCount(): Promise<number> {
  try {
    const d = await db();
    const r = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM activity_log WHERE synced = 0');
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

type ActivityRow = {
  id: number; action: string; entity_type: string; entity_id: string | null;
  screen: string | null; metadata: string | null; created_at: string;
};

export async function flushActivity(
  apiFn: (path: string, init: any) => Promise<any>,
): Promise<void> {
  const d = await db();
  const rows = await d.getAllAsync<ActivityRow>(
    `SELECT id, action, entity_type, entity_id, screen, metadata, created_at
     FROM activity_log WHERE synced = 0 ORDER BY id LIMIT ?`, BATCH_SIZE);
  if (!rows.length) return;

  const batch = rows.map(r => ({
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    screen: r.screen,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    at: r.created_at,
  }));

  try {
    await apiFn('/sync/activity/batch', { method: 'POST', body: JSON.stringify({ events: batch }) });
    const ids = rows.map(r => r.id);
    await d.runAsync(
      `DELETE FROM activity_log WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  } catch (e: any) {
    if (/→ 4\d\d/.test(String(e?.message || ''))) {
      // terminal client error — mark synced so we don't retry forever
      const ids = rows.map(r => r.id);
      await d.runAsync(
        `DELETE FROM activity_log WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    }
    // offline or 5xx → keep, retry next sync
  }
}
