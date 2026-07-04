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

// Mirror the server's task-card filter: ata exact; sub over chapter/section; q over number/desc/card.
export async function localTaskCards(q?: string, ata?: string, sub?: string): Promise<any[]> {
  const { data } = await getRef<any[]>('taskcards');
  let rows = data || [];
  if (ata) rows = rows.filter((t) => t.ata_chapter === ata);
  if (sub) rows = rows.filter((t) => t.chapter === sub || t.section === sub);
  if (q) { const s = q.toLowerCase(); rows = rows.filter((t) => has(t.task_number, s) || has(t.description, s) || has(t.card_no, s)); }
  return rows.slice(0, 200);
}

export async function localTaskFilters(): Promise<{ ata: string[]; sub: Record<string, string[]> }> {
  const { data } = await getRef<{ ata: string[]; sub: Record<string, string[]> }>('taskfilters');
  return data || { ata: [], sub: {} };
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
