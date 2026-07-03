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
