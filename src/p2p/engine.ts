import { db } from '../db/schema';

// Transport-agnostic onboard sync. The 4 iPads exchange these envelopes over a
// peer transport (MultipeerConnectivity / BT+Wi-Fi); the reconcile rule is
// last-writer-wins by record `version` — identical to the server sync strategy,
// so a peer-merged record still reconciles cleanly to the cloud later.

export type SyncEnvelope = {
  device: string;
  at: string;
  kind?: 'snapshot' | 'request' | 'join';   // request = master gather; join = a new iPad announcing itself
  reg?: string;                    // the aircraft the sender is working — lets a joining iPad detect it
  master?: boolean;                // sender is the master iPad for `reg`
  label?: string;                  // human label of a joining iPad (shown in the master's approve prompt)
  sectors: any[];
  defects: any[];
  attachments: any[];
};

const TABLES = ['sectors', 'defects', 'attachments'] as const;

// Everything this device holds (not just dirty) so a fresh peer catches up fully.
export async function snapshot(deviceId: string, opts?: { reg?: string; master?: boolean }): Promise<SyncEnvelope> {
  const dbc = await db();
  const out: any = { device: deviceId, at: new Date().toISOString(), kind: 'snapshot',
                     reg: opts?.reg, master: !!opts?.master };
  for (const tbl of TABLES) {
    const rows = await dbc.getAllAsync<{ payload: string }>(`SELECT payload FROM ${tbl}`);
    out[tbl] = rows.map((r) => JSON.parse(r.payload));
  }
  return out as SyncEnvelope;
}

function ver(rec: any): number {
  return typeof rec?.version === 'number' ? rec.version : 1;
}

// Merge a peer envelope. Returns how many records were applied per table.
export async function merge(env: SyncEnvelope): Promise<Record<string, number>> {
  const dbc = await db();
  const applied: Record<string, number> = { sectors: 0, defects: 0, attachments: 0 };
  for (const tbl of TABLES) {
    for (const incoming of env[tbl] ?? []) {
      if (!incoming?.id) continue;
      const local = await dbc.getFirstAsync<{ payload: string }>(
        `SELECT payload FROM ${tbl} WHERE id = ?`, incoming.id);
      const localRec = local ? JSON.parse(local.payload) : null;
      // closed/locked local records are authoritative — never overwritten by a peer
      if (localRec && ['closed', 'exported'].includes(localRec.status)) continue;
      if (localRec && ver(localRec) >= ver(incoming)) continue;
      // dirty=1 so the merged record is also pushed to the cloud on next online sync
      await dbc.runAsync(
        `INSERT OR REPLACE INTO ${tbl} (id, dirty, payload) VALUES (?,1,?)`,
        incoming.id, JSON.stringify(incoming)).catch(async () => {
          // sectors/defects tables have extra NOT NULL columns — fall back to a full upsert
          await upsertWide(tbl, incoming);
        });
      applied[tbl]++;
    }
  }
  return applied;
}

// sectors & defects carry indexed columns beyond (id, dirty, payload).
async function upsertWide(tbl: string, rec: any) {
  const dbc = await db();
  if (tbl === 'sectors') {
    await dbc.runAsync(
      `INSERT OR REPLACE INTO sectors (id, aircraft_id, flight_no, flight_date, dep, arr, status, version, dirty, payload)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      rec.id, rec.aircraft_id, rec.flight_no ?? null, rec.flight_date ?? '', rec.dep ?? null, rec.arr ?? null,
      rec.status ?? 'draft', ver(rec), JSON.stringify(rec));
  } else if (tbl === 'defects') {
    await dbc.runAsync(
      `INSERT OR REPLACE INTO defects (id, sector_id, aircraft_id, description, ata_chapter, category, status, version, dirty, payload)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      rec.id, rec.sector_id ?? null, rec.aircraft_id, rec.description ?? '', rec.ata_chapter ?? null,
      rec.source ?? 'pirep', rec.status ?? 'open', ver(rec), JSON.stringify(rec));
  }
}
