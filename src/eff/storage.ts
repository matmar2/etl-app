// EFF storage adapter (M2) — maps the merged EFF module's web storage onto ETL's cross-platform
// native layer (SecureStore + SQLite ref_cache), OTA-safe (no new native library).
import { serverReachable } from '../api/client';
import * as SecureStore from '../api/secureStore';
import { delRef, getRef, refKeysLike, setRef } from '../db/reference';
const P = 'eff:';
export async function kvGet(key: string): Promise<string | null> { try { return await SecureStore.getItem(P + key); } catch { return null; } }
export async function kvSet(key: string, value: string): Promise<void> { try { await SecureStore.setItem(P + key, value); } catch {} }
export async function kvDel(key: string): Promise<void> { try { await SecureStore.deleteItem(P + key); } catch {} }
export async function jsonGet<T>(key: string): Promise<T | null> { const s = await kvGet(key); if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } }
export async function jsonSet(key: string, val: unknown): Promise<void> { await kvSet(key, JSON.stringify(val)); }
export async function blobGet(key: string): Promise<string | null> { try { const r = await getRef<string>(`${P}blob:${key}`); return r.data ?? null; } catch { return null; } }
export async function blobSet(key: string, b64: string): Promise<void> { try { await setRef(`${P}blob:${key}`, b64); } catch {} }
export async function blobDel(key: string): Promise<void> { try { await delRef(`${P}blob:${key}`); } catch {} }
// Full-key enumerate/read/delete (keys already carry the eff:blob: prefix) — for cache pruning.
export async function blobKeysLike(prefix: string): Promise<string[]> { try { return await refKeysLike(`${P}blob:${prefix}%`); } catch { return []; } }
export async function blobGetFull(fullKey: string): Promise<string | null> { try { const r = await getRef<string>(fullKey); return r.data ?? null; } catch { return null; } }
export async function blobDelFull(fullKey: string): Promise<void> { try { await delRef(fullKey); } catch {} }
let _online = true;
export function isOnlineSync(): boolean { return _online; }
export async function isOnline(): Promise<boolean> { try { _online = await serverReachable(); } catch { _online = false; } return _online; }
