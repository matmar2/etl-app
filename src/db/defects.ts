import { getRef, setRef } from './reference';
import { db } from './schema';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type NewDefect = {
  sector_id: string | null;        // null = aircraft-level (e.g. a ground MAREP with no flight)
  aircraft_id: string;
  source: 'pirep' | 'marep' | 'cabin';
  area?: 'technical' | 'cabin';
  captain_clearable?: boolean;
  title?: string;
  description: string;
  ata_chapter?: string;
  reported_by_name?: string;
  reporter_signature?: string;
  reporter_licence?: string;
  blocks_serviceability?: boolean;
  mel_ref?: string;
  rect_interval?: string;
  due_date?: string;
};

// Local defects for a sector (offline TL print fallback).
export async function getSectorDefects(sectorId: string): Promise<any[]> {
  const dbc = await db();
  const rows = await dbc.getAllAsync<{ payload: string }>(
    'SELECT payload FROM defects WHERE sector_id = ?', sectorId);
  return rows.map((r) => JSON.parse(r.payload));
}

// Read one defect from the local mirror (offline). Returns the parsed payload or null.
export async function getLocalDefect(id: string): Promise<any | null> {
  const dbc = await db();
  const row = await dbc.getFirstAsync<{ payload: string }>('SELECT payload FROM defects WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

// Cache a server defect into the local mirror (dirty=0) so it opens offline next time.
export async function cacheDefect(defect: any): Promise<void> {
  if (!defect?.id) return;
  const dbc = await db();
  await dbc.runAsync(
    `INSERT OR REPLACE INTO defects (id, sector_id, aircraft_id, description, ata_chapter, category, status, version, dirty, payload)
     VALUES (?,?,?,?,?,?,?,?,COALESCE((SELECT dirty FROM defects WHERE id = ?),0),?)`,
    defect.id, defect.sector_id ?? null, defect.aircraft_id ?? '', defect.description ?? defect.title ?? '',
    defect.ata_chapter ?? null, defect.source ?? defect.category ?? 'defect', defect.status ?? 'open',
    defect.version ?? 1, defect.id, JSON.stringify(defect));
}

// Cache the whole aircraft's active + HIL defects (keyed by registration) so the Defects list
// and the release blocker check work offline, and cache each individually so it opens offline.
export async function cacheAircraftDefects(reg: string, defects: any[]): Promise<void> {
  await setRef(`defects:${reg.trim().toUpperCase()}`, defects);
  for (const d of defects) await cacheDefect(d).catch(() => {});
}
export async function getLocalAircraftDefects(reg: string): Promise<any[]> {
  const { data } = await getRef<any[]>(`defects:${reg.trim().toUpperCase()}`);
  return data || [];
}

// Optimistically apply an action to the LOCAL defect payload (for display offline) — the
// server call itself is queued in the outbox, so we do NOT touch the dirty flag here.
export async function appendLocalDefectAction(id: string, action: any, patch?: { status?: string }): Promise<void> {
  const cur = await getLocalDefect(id);
  if (!cur) return;
  cur.actions = [...(cur.actions || []), { ...action, at: action.at || new Date().toISOString(), pending: true }];
  if (patch?.status) cur.status = patch.status;
  const dbc = await db();
  await dbc.runAsync('UPDATE defects SET status = ?, payload = ? WHERE id = ?', cur.status ?? 'open', JSON.stringify(cur), id);
}

// Create a defect locally (offline) and queue it for sync.
export async function createDefect(d: NewDefect): Promise<string> {
  const dbc = await db();
  const id = uuid();
  const payload = { ...d, id, status: 'open', blocks_serviceability: d.blocks_serviceability ?? true, version: 1 };
  await dbc.runAsync(
    `INSERT INTO defects (id, sector_id, aircraft_id, description, ata_chapter, category, status, version, dirty, payload)
     VALUES (?,?,?,?,?,?,?,1,1,?)`,
    id, d.sector_id ?? null, d.aircraft_id, d.description, d.ata_chapter ?? null, d.source, 'open',
    JSON.stringify(payload));
  return id;
}
