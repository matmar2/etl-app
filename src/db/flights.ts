import { LeonFlight } from '../api/client';
import { db } from './schema';

export async function getCachedFlights(reg: string): Promise<{ flights: LeonFlight[]; updatedAt: string | null }> {
  const d = await db();
  const row = await d.getFirstAsync<{ json: string; updated_at: string }>(
    'SELECT json, updated_at FROM flight_cache WHERE reg = ?', reg);
  if (!row) return { flights: [], updatedAt: null };
  try { return { flights: JSON.parse(row.json), updatedAt: row.updated_at }; }
  catch { return { flights: [], updatedAt: null }; }
}

export async function setCachedFlights(reg: string, flights: LeonFlight[]) {
  const d = await db();
  await d.runAsync(
    'INSERT OR REPLACE INTO flight_cache (reg, json, updated_at) VALUES (?,?,?)',
    reg, JSON.stringify(flights), new Date().toISOString());
}
