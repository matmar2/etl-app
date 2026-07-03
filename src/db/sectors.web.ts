// Web build: no local SQLite — the sector list/create/read/update talk to the
// server directly (via the normal sync endpoint + sector GETs). Mirrors the
// native db/sectors.ts API so the screens are identical across platforms.
import { deleteServerSector, getServerSector, pushSector, serverSectors } from '../api/client';

export type Sector = {
  id: string; aircraft_id: string; flight_no?: string; flight_date: string;
  dep?: string; arr?: string; std?: string; sta?: string; source?: string;
  block_time_min?: number; landings?: number; airframe_hours?: number; status?: string;
  [k: string]: any;
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function createSector(s: Omit<Sector, 'id' | 'status'>): Promise<Sector> {
  const row: Sector = { ...(s as any), id: uuid(), page_kind: 'flow', status: 'draft', version: 1 };
  await pushSector(row);
  return row;
}

export async function listSectors(): Promise<Sector[]> {
  try { return await serverSectors(); } catch { return []; }
}

// Web is already server-live; converging the list is just fetching this tail's sectors.
export async function pullSectorList(reg: string): Promise<Sector[]> {
  try { return await serverSectors(reg); } catch { return []; }
}

export async function getSector(id: string): Promise<any | null> {
  try { return await getServerSector(id); } catch { return null; }
}

// Web already reads the server live on every open, so pull-on-open is just a re-fetch.
export async function pullSector(id: string): Promise<any | null> {
  return getSector(id);
}

// Web has no local SQLite sectors — the server prev-fuel (ETL-then-Leon) covers it.
export async function localPrevFuel(_sectorId: string): Promise<any | null> { return null; }

export async function updateSector(id: string, patch: Record<string, any>): Promise<any> {
  const cur = await getServerSector(id);
  const next = { ...cur, ...patch, version: (cur?.version ?? 1) + 1 };
  await pushSector(next);
  return next;
}

export async function deleteSector(id: string, force = false): Promise<void> {
  await deleteServerSector(id, force);    // server rejects (409) if released/signed unless force
}
export async function clearSectors(_includeUnsynced = false): Promise<number> { return 0; }
export async function dedupeSectors(): Promise<number> { return 0; }

export async function sectorExists(_aircraftId: string, flightNo: string, flightDate: string): Promise<boolean> {
  const all = await listSectors().catch(() => [] as Sector[]);
  return all.some((x) => x.flight_no === flightNo && String(x.flight_date) === flightDate);
}
