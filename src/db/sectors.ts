import { deleteServerSector, getServerSector, NetworkError, serverSectors, syncPush } from '../api/client';
import { db } from './schema';

export type Sector = {
  id: string;
  aircraft_id: string;
  flight_no?: string;
  flight_date: string;
  dep?: string;
  arr?: string;
  std?: string;
  sta?: string;
  source?: string;
  block_time_min?: number;
  landings?: number;
  airframe_hours?: number;
  flight_type?: string;      // OASES nature (Leon-sourced, editable on Departure)
  cancelled?: boolean;
  alternate_airport?: string;
  status?: string;
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function createSector(s: Omit<Sector, 'id' | 'status'>) {
  const d = await db();
  const row: Sector = { ...s, id: uuid(), status: 'draft' };
  await d.runAsync(
    `INSERT INTO sectors (id, aircraft_id, flight_no, flight_date, dep, arr,
       block_time_min, landings, airframe_hours, status, version, dirty, payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?)`,
    row.id, row.aircraft_id, row.flight_no ?? null, row.flight_date,
    row.dep ?? null, row.arr ?? null, row.block_time_min ?? null,
    row.landings ?? 1, row.airframe_hours ?? null, 'draft',
    JSON.stringify({ ...row, version: 1 }),
  );
  return row;
}

export async function listSectors(): Promise<Sector[]> {
  const d = await db();
  return d.getAllAsync<Sector>('SELECT * FROM sectors ORDER BY flight_date DESC');
}

// Remove one sector. Delete it on the server too so the next pull doesn't re-sync it
// back into the list. Offline → local-only (best effort). A 409 (released/signed) is
// re-thrown so the caller can offer "Force remove".
export async function deleteSector(id: string, force = false): Promise<void> {
  try {
    await deleteServerSector(id, force);
  } catch (e: any) {
    if (!(e instanceof NetworkError)) throw e;     // offline → fall through to local-only
  }
  const d = await db();
  await d.runAsync('DELETE FROM sectors WHERE id = ?', id);
}

// Clear the local "Your sectors" list. By default keeps rows not yet synced
// (dirty=1) so unsynced work isn't lost; pass true to clear everything.
export async function clearSectors(includeUnsynced = false): Promise<number> {
  const d = await db();
  const res = includeUnsynced
    ? await d.runAsync('DELETE FROM sectors')
    : await d.runAsync('DELETE FROM sectors WHERE dirty = 0');
  return res.changes ?? 0;
}

// Collapse any duplicate sectors (same aircraft+flight+date), keeping the earliest row.
export async function dedupeSectors(): Promise<number> {
  const d = await db();
  const res = await d.runAsync(
    `DELETE FROM sectors WHERE rowid NOT IN (
       SELECT MIN(rowid) FROM sectors GROUP BY aircraft_id, flight_no, flight_date)`);
  return res.changes ?? 0;
}

export async function getSector(id: string): Promise<any | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ payload: string }>('SELECT payload FROM sectors WHERE id = ?', id);
  return row ? JSON.parse(row.payload) : null;
}

export type LocalPrevFuel = { fuel_kg: number; source: string; flight_no?: string; date?: string;
  dep?: string; arr?: string; continuity_ok?: boolean | null };

// Previous-leg landing fuel from the LOCAL ETL sectors on this iPad — the ETL-first,
// works-offline source. The most recent earlier sector for this tail that has a
// recorded arrival fuel (diversion-aware). Returns null if none on this device.
export async function localPrevFuel(sectorId: string): Promise<LocalPrevFuel | null> {
  const d = await db();
  const cur = await getSector(sectorId);
  if (!cur) return null;
  const rows = await d.getAllAsync<{ payload: string }>('SELECT payload FROM sectors');
  const all = rows.map((r) => { try { return JSON.parse(r.payload); } catch { return null; } }).filter(Boolean) as any[];
  const curKey = String(cur.std || cur.flight_date || '');
  const cands = all.filter((s) => s && s.id !== cur.id && s.aircraft_id === cur.aircraft_id
    && s.fuel_remaining_kg != null && String(s.std || s.flight_date || '') < curKey);
  if (!cands.length) return null;
  cands.sort((a, b) => String(b.std || b.flight_date || '').localeCompare(String(a.std || a.flight_date || '')));
  const p = cands[0];
  const effArr = (p.diverted && p.diversion_airport) ? p.diversion_airport : p.arr;   // landed elsewhere if diverted
  const curDep = (cur.dep || '').trim().toUpperCase();
  const arrU = (effArr || '').trim().toUpperCase();
  return { fuel_kg: Math.round(Number(p.fuel_remaining_kg)), source: 'ETL · this iPad', flight_no: p.flight_no,
    date: p.flight_date || String(p.std || '').slice(0, 10), dep: p.dep, arr: effArr,
    continuity_ok: (arrU && curDep) ? (arrU === curDep) : null };
}

// Converge the sector list with the server (web ↔ iPad). Push local edits, then take
// the server's list for this tail as the source of truth, keeping any local rows that
// are still unsynced (dirty). Upserts server rows into local for offline use.
export async function pullSectorList(reg: string): Promise<Sector[]> {
  try {
    await syncPush().catch(() => {});
    const server = await serverSectors(reg);
    const d = await db();
    const dirty = (await d.getAllAsync<{ payload: string }>('SELECT payload FROM sectors WHERE dirty = 1')).map((r) => JSON.parse(r.payload));
    const dirtyIds = new Set(dirty.map((x: any) => x.id));
    for (const s of server as any[]) {
      if (dirtyIds.has(s.id)) continue;                // keep local unsynced version
      await d.runAsync(
        `INSERT OR REPLACE INTO sectors (id, aircraft_id, flight_no, flight_date, dep, arr, status, version, dirty, payload)
         VALUES (?,?,?,?,?,?,?,?,0,?)`,
        s.id, s.aircraft_id, s.flight_no ?? null, s.flight_date, s.dep ?? null, s.arr ?? null,
        s.status ?? 'draft', s.version ?? 1, JSON.stringify(s));
    }
    const serverIds = new Set((server as any[]).map((s) => s.id));
    const localOnly = dirty.filter((x: any) => !serverIds.has(x.id));   // not yet on the server
    return [...(server as any[]), ...localOnly];
  } catch {
    return listSectors();                              // offline → local view
  }
}

// Pull-on-open: when online, push local edits up first, then overwrite the local copy
// with the authoritative server state (status, signatures, off-block) so this iPad
// reflects acceptances/releases done on the web or another device. Offline → local copy.
export async function pullSector(id: string): Promise<any | null> {
  try {
    await syncPush().catch(() => {});                  // send pending local edits first
    const server = await getServerSector(id);          // authoritative
    if (!server) return getSector(id);
    const d = await db();
    const res = await d.runAsync(
      'UPDATE sectors SET status = ?, version = ?, dirty = 0, payload = ? WHERE id = ?',
      server.status ?? 'draft', server.version ?? 1, JSON.stringify(server), id);
    if (!res.changes) {                                // sector exists on server but not locally → add it
      await d.runAsync(
        `INSERT OR REPLACE INTO sectors (id, aircraft_id, flight_no, flight_date, dep, arr, status, version, dirty, payload)
         VALUES (?,?,?,?,?,?,?,?,0,?)`,
        server.id, server.aircraft_id, server.flight_no ?? null, server.flight_date,
        server.dep ?? null, server.arr ?? null, server.status ?? 'draft', server.version ?? 1, JSON.stringify(server));
    }
    return server;
  } catch {
    return getSector(id);                              // offline / error → fall back to local
  }
}

// Merge a patch into the sector's synced payload, bump version, mark dirty.
export async function updateSector(id: string, patch: Record<string, any>): Promise<any> {
  const d = await db();
  const row = await d.getFirstAsync<{ payload: string }>('SELECT payload FROM sectors WHERE id = ?', id);
  if (!row) throw new Error('sector not found');
  const cur = JSON.parse(row.payload);
  const next = { ...cur, ...patch, version: (cur.version ?? 1) + 1 };
  // keep the indexed status column in sync (listSectors / the open-sector rule read it)
  await d.runAsync('UPDATE sectors SET dirty = 1, version = ?, status = ?, payload = ? WHERE id = ?',
    next.version, next.status ?? cur.status ?? 'draft', JSON.stringify(next), id);
  return next;
}

export async function sectorExists(aircraftId: string, flightNo: string, flightDate: string): Promise<boolean> {
  const d = await db();
  const row = await d.getFirstAsync<{ id: string }>(
    'SELECT id FROM sectors WHERE aircraft_id = ? AND flight_no = ? AND flight_date = ?',
    aircraftId, flightNo, flightDate);
  return !!row;
}
