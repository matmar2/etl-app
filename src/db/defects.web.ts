// Web build: no local SQLite — defects are created on / read from the server directly,
// mirroring db/defects.ts so the screens are identical across platforms.
import { pushDefect, serverSectorDefects } from '../api/client';

export type NewDefect = {
  sector_id: string;
  aircraft_id: string;
  source: 'pirep' | 'marep' | 'cabin';
  area?: 'technical' | 'cabin';
  captain_clearable?: boolean;
  title?: string;
  description: string;
  ata_chapter?: string;
  reported_by_name?: string;
  blocks_serviceability?: boolean;
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getSectorDefects(sectorId: string): Promise<any[]> {
  return serverSectorDefects(sectorId);
}

export async function createDefect(d: NewDefect): Promise<string> {
  const id = uuid();
  await pushDefect({ ...d, id, status: 'open', blocks_serviceability: d.blocks_serviceability ?? true, version: 1 });
  return id;
}
