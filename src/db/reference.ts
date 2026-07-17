// Offline cache of CAMO reference data (MEL items + AMP task cards) so the MEL and
// task-card pickers work with no signal. The full lists are downloaded when online
// and the pickers fall back to this cache (filtered locally) when the server is
// unreachable. Native only — on web (no SQLite) the cache is empty and the app is
// online anyway.
import { db } from './schema';

export async function setRef(key: string, data: any) {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO ref_cache (key, json, updated_at) VALUES (?,?,?)',
    key, JSON.stringify(data), new Date().toISOString());
}
export async function getRef<T>(key: string): Promise<{ data: T | null; updatedAt: string | null }> {
  const d = await db();
  const row = await d.getFirstAsync<{ json: string; updated_at: string }>('SELECT json, updated_at FROM ref_cache WHERE key = ?', key);
  if (!row) return { data: null, updatedAt: null };
  try { return { data: JSON.parse(row.json), updatedAt: row.updated_at }; } catch { return { data: null, updatedAt: null }; }
}

const has = (v: any, q: string) => String(v ?? '').toLowerCase().includes(q);

// Mirror the server's MEL filter: ata prefix; q over item/ata/remarks.
export async function localMel(q?: string, ata?: string): Promise<any[]> {
  const { data } = await getRef<any[]>('mel');
  let rows = data || [];
  if (ata) rows = rows.filter((m) => String(m.ata ?? '').toUpperCase().startsWith(ata.toUpperCase()));
  if (q) { const s = q.toLowerCase(); rows = rows.filter((m) => has(m.item, s) || has(m.ata, s) || has(m.remarks, s)); }
  return rows.slice(0, 200);
}

export async function localCdl(q?: string, ata?: string): Promise<any[]> {
  const { data } = await getRef<any[]>('cdl');
  let rows = data || [];
  if (ata) rows = rows.filter((c) => String(c.ata ?? '').toUpperCase().startsWith(ata.toUpperCase()));
  if (q) { const s = q.toLowerCase(); rows = rows.filter((c) => has(c.item, s) || has(c.system, s) || has(c.ata, s) || has(c.code, s) || has(c.ident, s)); }
  return rows.slice(0, 200);
}

// AMM task cards are per-aircraft — cached by registration (key `amm:<REG>`). Mirror the
// server filter: ata = first 2 digits; q over task_card_ref / title / description.
export async function localAmm(reg?: string, q?: string, ata?: string): Promise<any[]> {
  const { data } = await getRef<any[]>(`amm:${(reg ?? '').toUpperCase()}`);
  let rows = data || [];
  if (ata) rows = rows.filter((t) => String(t.ata ?? '').slice(0, 2) === ata);
  if (q) { const s = q.toLowerCase(); rows = rows.filter((t) => has(t.task_card_ref, s) || has(t.title, s) || has(t.description, s)); }
  return rows.slice(0, 200);
}
export async function localAmmFilters(reg?: string): Promise<{ ata: string[] }> {
  const { data } = await getRef<{ ata: string[] }>(`ammfilters:${(reg ?? '').toUpperCase()}`);
  return data || { ata: [] };
}

// Offline route maps: airport coords (key `apt:<CODE>`) + overview map tiles (key `tile:<z/x/y>`,
// value = data-URI). Tiles are deduplicated by their z/x/y key — stored once across all legs.
export type AptCoord = { lat: number; lon: number; iata?: string | null; name?: string | null };
export const setApt = (code: string, v: AptCoord) => setRef(`apt:${code.trim().toUpperCase()}`, v);
export async function getApt(code: string): Promise<AptCoord | null> {
  const { data } = await getRef<AptCoord>(`apt:${code.trim().toUpperCase()}`);
  return data;
}
export const setTile = (key: string, dataUri: string) => setRef(`tile:${key}`, dataUri);
export async function getTile(key: string): Promise<string | null> {
  const { data } = await getRef<string>(`tile:${key}`);
  return data;
}
export async function hasTile(key: string): Promise<boolean> {
  return !!(await getTile(key));
}
