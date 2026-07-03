import * as SQLite from 'expo-sqlite';

// Local offline-first mirror. Records are created here first (client owns UUIDs),
// then pushed to the server. `dirty=1` marks rows pending sync.
let _db: SQLite.SQLiteDatabase | null = null;

export async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('etl.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sectors (
      id TEXT PRIMARY KEY,
      aircraft_id TEXT NOT NULL,
      flight_no TEXT,
      flight_date TEXT NOT NULL,
      dep TEXT, arr TEXT,
      block_time_min INTEGER,
      flight_time_min INTEGER,
      landings INTEGER DEFAULT 1,
      fuel_uplift REAL,
      airframe_hours REAL,
      airframe_cycles INTEGER,
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      dirty INTEGER DEFAULT 1,
      payload TEXT
    );
    CREATE TABLE IF NOT EXISTS defects (
      id TEXT PRIMARY KEY,
      sector_id TEXT,
      aircraft_id TEXT NOT NULL,
      description TEXT NOT NULL,
      ata_chapter TEXT,
      category TEXT DEFAULT 'defect',
      mel_ref TEXT,
      status TEXT DEFAULT 'open',
      version INTEGER DEFAULT 1,
      dirty INTEGER DEFAULT 1,
      payload TEXT
    );
    CREATE TABLE IF NOT EXISTS flight_cache (
      reg TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ref_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      dirty INTEGER DEFAULT 1,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      reg TEXT NOT NULL,
      kind TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      state TEXT DEFAULT 'pending',
      dirty INTEGER DEFAULT 1,
      payload TEXT NOT NULL
    );
  `);
  return _db;
}
