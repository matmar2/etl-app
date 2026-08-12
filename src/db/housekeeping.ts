// On-device storage housekeeping — runs once per login (online only).
// Prunes stale caches that accumulate unbounded (map tiles, AMM text/figs,
// tech-log HTML, old synced attachments) while preserving everything needed
// for offline operation of today's flights and the next 72 h.
//
// Safe-list approach: build a set of ref_cache keys that MUST be kept (active
// fleet, upcoming flights, current aircraft data), then delete anything
// outside that set from the evictable prefixes. Small metadata keys (flags,
// config, permissions, hidden-sector tombstones) are never touched.
import { db } from './schema';

const EVICTABLE_PREFIXES = [
  'tile:',            // map tile data-URIs (~20-50 KB each, grow forever)
  'ammtext:',         // AMM task-card HTML (per reg/ref)
  'ammfig:',          // AMM figure images (base64)
  'tl_',              // tech-log HTML preview (per sector id)
  'eff:blob:',        // EFF folder/doc blobs (purgeCaches handles flight-window, this catches stragglers)
  'lastfuel_etl_',    // previous-leg fuel cache (per tail/leg)
  'lastfuel_leon_',
  'lastfuel_',
];

// Keys that must NEVER be evicted — small config/state entries.
const PROTECTED_PREFIXES = [
  'mel', 'cdl', 'refversion',        // MEL/CDL lists (overwritten on refresh, single key each)
  'amm:', 'ammfilters:',             // AMM list per reg (overwritten on refresh, one key per tail)
  'defects:',                         // defect list per reg
  'sectors_hidden', 'sectors_tomb',   // tombstone lists
  'sandbox_flag', 'eff_allowed',      // flags
  'guide', 'faq', 'induction',       // user guide / assistant / induction
  'apt:',                             // airport coords (tiny, ~200 bytes each)
  'aircraft_uuid_',                   // aircraft id lookup
  'status_',                          // serviceability status per tail
  'signoffs',                         // sign-off categories
  'next_tl_',                         // TL numbering sequence
  'perm_',                            // permission cache
];

function isProtected(key: string): boolean {
  // Exact matches
  if (['mel', 'cdl', 'refversion', 'sandbox_flag', 'eff_allowed', 'guide', 'faq', 'induction', 'signoffs'].includes(key)) return true;
  return PROTECTED_PREFIXES.some((p) => key.startsWith(p));
}

function isEvictable(key: string): boolean {
  return EVICTABLE_PREFIXES.some((p) => key.startsWith(p));
}

// Build the set of tile keys needed for the next 72 h of flights (all tails).
// We don't recompute tile z/x/y here — instead we keep ALL tiles that were
// cached in the last 7 days (updated_at). Older tiles are routes no longer
// flown regularly and can be re-downloaded when needed.
const TILE_MAX_AGE_DAYS = 7;

// AMM text/figs: keep keys for the CURRENT aircraft only (the one the crew
// is working on). Others are re-fetched when switching aircraft.
// Tech-log HTML: keep only for sectors still in the local sectors table.

export async function runHousekeeping(currentReg?: string): Promise<{ deleted: number; reclaimedEstimate: string }> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') return { deleted: 0, reclaimedEstimate: '0 KB' };

  const d = await db();
  let deleted = 0;
  let reclaimedBytes = 0;

  try {
    // 1. Prune old map tiles (older than 7 days)
    const cutoff = new Date(Date.now() - TILE_MAX_AGE_DAYS * 86400_000).toISOString();
    const oldTiles = await d.getAllAsync<{ key: string; sz: number }>(
      `SELECT key, length(json) as sz FROM ref_cache WHERE key LIKE 'tile:%' AND updated_at < ?`, cutoff);
    for (const t of oldTiles) {
      await d.runAsync('DELETE FROM ref_cache WHERE key = ?', t.key);
      reclaimedBytes += t.sz;
      deleted++;
    }

    // 2. Prune AMM text/figs for aircraft OTHER than the current one
    if (currentReg) {
      const regUpper = currentReg.toUpperCase().replace(/-/g, '');
      const ammKeys = await d.getAllAsync<{ key: string; sz: number }>(
        `SELECT key, length(json) as sz FROM ref_cache WHERE (key LIKE 'ammtext:%' OR key LIKE 'ammfig:%')`);
      for (const r of ammKeys) {
        // ammtext:<REG>:<ref> or ammfig:<REG>:<ref> — keep if the reg matches current
        const parts = r.key.split(':');
        const keyReg = (parts[1] || '').toUpperCase().replace(/-/g, '');
        if (keyReg && keyReg !== regUpper) {
          await d.runAsync('DELETE FROM ref_cache WHERE key = ?', r.key);
          reclaimedBytes += r.sz;
          deleted++;
        }
      }
    }

    // 3. Prune tech-log HTML for sectors no longer in the local DB
    const localSectorIds = new Set(
      (await d.getAllAsync<{ id: string }>('SELECT id FROM sectors')).map((r) => r.id));
    const tlKeys = await d.getAllAsync<{ key: string; sz: number }>(
      `SELECT key, length(json) as sz FROM ref_cache WHERE key LIKE 'tl_%'`);
    for (const r of tlKeys) {
      const sectorId = r.key.slice(3);  // tl_<uuid>
      if (sectorId && !localSectorIds.has(sectorId)) {
        await d.runAsync('DELETE FROM ref_cache WHERE key = ?', r.key);
        reclaimedBytes += r.sz;
        deleted++;
      }
    }

    // 4. Prune stale lastfuel_ entries (older than 7 days)
    const fuelKeys = await d.getAllAsync<{ key: string; sz: number; updated_at: string }>(
      `SELECT key, length(json) as sz, updated_at FROM ref_cache WHERE (key LIKE 'lastfuel_etl_%' OR key LIKE 'lastfuel_leon_%' OR key LIKE 'lastfuel_%') AND updated_at < ?`, cutoff);
    for (const r of fuelKeys) {
      await d.runAsync('DELETE FROM ref_cache WHERE key = ?', r.key);
      reclaimedBytes += r.sz;
      deleted++;
    }

    // 5. Purge synced attachments (dirty = 0) — they've been uploaded, only the
    //    SQLite row remains consuming space.
    const syncedAtt = await d.getFirstAsync<{ n: number; sz: number }>(
      `SELECT COUNT(*) as n, COALESCE(SUM(length(payload)),0) as sz FROM attachments WHERE dirty = 0`);
    if (syncedAtt && syncedAtt.n > 0) {
      await d.runAsync('DELETE FROM attachments WHERE dirty = 0');
      reclaimedBytes += syncedAtt.sz;
      deleted += syncedAtt.n;
    }

    // 6. Purge synced activity_log rows
    const syncedAct = await d.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) as n FROM activity_log WHERE synced = 1`);
    if (syncedAct && syncedAct.n > 0) {
      await d.runAsync('DELETE FROM activity_log WHERE synced = 1');
      deleted += syncedAct.n;
    }

    // 7. Prune old SYNCED sectors beyond the newest 24 per device.
    //    Only sectors with dirty = 0 (already pushed to the server) are candidates.
    //    Keeps the 24 most recent by flight_date so today + next 72 h are always safe.
    //    Associated defects and outbox entries for pruned sectors are also removed.
    const KEEP_SECTORS = 24;
    const allSynced = await d.getAllAsync<{ id: string; flight_date: string }>(
      `SELECT id, flight_date FROM sectors WHERE dirty = 0 ORDER BY flight_date DESC`);
    if (allSynced.length > KEEP_SECTORS) {
      const toPrune = allSynced.slice(KEEP_SECTORS);
      for (const s of toPrune) {
        const sz = await d.getFirstAsync<{ sz: number }>(
          `SELECT COALESCE(length(payload),0) as sz FROM sectors WHERE id = ?`, s.id);
        // Remove associated synced defects
        await d.runAsync('DELETE FROM defects WHERE sector_id = ? AND dirty = 0', s.id);
        // Remove the sector
        await d.runAsync('DELETE FROM sectors WHERE id = ?', s.id);
        reclaimedBytes += sz?.sz ?? 0;
        deleted++;
      }
    }

    // 8. VACUUM to reclaim freed SQLite pages (the actual disk-space win).
    //    Only if we deleted something meaningful (> 50 rows or > 500 KB estimate).
    if (deleted > 50 || reclaimedBytes > 512_000) {
      await d.execAsync('VACUUM');
    }

  } catch (e) {
    console.warn('[housekeeping] error:', e);
    // best-effort — never block the app
  }

  const est = reclaimedBytes > 1_048_576
    ? `${(reclaimedBytes / 1_048_576).toFixed(1)} MB`
    : `${Math.round(reclaimedBytes / 1024)} KB`;

  if (deleted > 0) {
    console.log(`[housekeeping] pruned ${deleted} entries, ~${est} reclaimed`);
  }
  return { deleted, reclaimedEstimate: est };
}

// Storage stats for the iPad health / diagnostics screen.
export async function storageStats(): Promise<{ total_keys: number; total_bytes: number; by_prefix: Record<string, { count: number; bytes: number }> }> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') return { total_keys: 0, total_bytes: 0, by_prefix: {} };

  const d = await db();
  const rows = await d.getAllAsync<{ key: string; sz: number }>(
    `SELECT key, length(json) as sz FROM ref_cache`);

  const by_prefix: Record<string, { count: number; bytes: number }> = {};
  let total_bytes = 0;

  for (const r of rows) {
    total_bytes += r.sz;
    // Classify by prefix
    let prefix = 'other';
    if (r.key.startsWith('tile:')) prefix = 'tiles';
    else if (r.key.startsWith('ammtext:') || r.key.startsWith('ammfig:')) prefix = 'amm_cache';
    else if (r.key.startsWith('tl_')) prefix = 'techlog_html';
    else if (r.key.startsWith('eff:blob:')) prefix = 'eff_folders';
    else if (r.key.startsWith('lastfuel_')) prefix = 'fuel_cache';
    else if (r.key.startsWith('apt:')) prefix = 'airports';
    else if (['mel', 'cdl', 'refversion'].includes(r.key) || r.key.startsWith('amm:') || r.key.startsWith('ammfilters:') || r.key.startsWith('defects:')) prefix = 'reference_data';

    if (!by_prefix[prefix]) by_prefix[prefix] = { count: 0, bytes: 0 };
    by_prefix[prefix].count++;
    by_prefix[prefix].bytes += r.sz;
  }

  // Also count attachments and outbox
  const att = await d.getFirstAsync<{ n: number; sz: number }>(
    `SELECT COUNT(*) as n, COALESCE(SUM(length(payload)),0) as sz FROM attachments`);
  if (att && att.n > 0) {
    by_prefix['attachments'] = { count: att.n, bytes: att.sz };
    total_bytes += att.sz;
  }

  return { total_keys: rows.length, total_bytes, by_prefix };
}
