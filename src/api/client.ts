import Constants from 'expo-constants';
import * as SecureStore from './secureStore';
import { flushAttachments } from '../db/attachments';
import { setCachedFlights } from '../db/flights';
import { getApt, getRef, getTile, hasTile, localAmm, localAmmFilters, localCdl, localMel, localTaskCards, localTaskFilters, setApt, setRef, setTile } from '../db/reference';
import { flushOutbox, queueRequest } from '../db/outbox';
import { geoapifyTileUrl, overviewTiles, tileKey } from '../util/tiles';
import { db } from '../db/schema';
import { sha1Hex, verifyTotp } from '../util/totp';

const BASE = (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? 'http://localhost:8000';

let _role: string | null = null;
export const role = () => _role;

let _name: string | null = null;
export const userName = () => _name;

// Display label for a backend role. 'pilot' is shown as First Officer / Co-pilot.
export function roleLabel(r: string | null = _role): string {
  switch (r) {
    case 'captain': return 'Captain';
    case 'pilot': return 'First Officer';
    case 'mechanic': return 'Mechanic';
    case 'cabin': return 'Cabin Crew';
    case 'camo': return 'CAMO';
    case 'admin': return 'Administrator';
    default: return r || '';
  }
}

let _clearanceAuthorized = false;
export const clearanceAuthorized = () => _clearanceAuthorized;

// Effective read/write access for this user's role (admin-configurable).
export type AccessMap = { role: string; pages: Record<string, string>; fields: Record<string, string> };
let _perms: AccessMap | null = null;
export async function loadPermissions(): Promise<AccessMap | null> {
  try { _perms = await api('/auth/permissions'); } catch { _perms = null; }
  return _perms;
}
/** 'rw' if the role may write this page (or page.field); else read-only/none. */
export function can(page: string, field?: string): boolean {
  if (!_perms) return true;                       // fail-open until loaded; backend still enforces
  const v = field ? _perms.fields[`${page}.${field}`] ?? _perms.pages[page] : _perms.pages[page];
  return v === 'rw';
}
export function access(page: string, field?: string): string {
  if (!_perms) return 'rw';
  return (field ? _perms.fields[`${page}.${field}`] ?? _perms.pages[page] : _perms.pages[page]) ?? 'ro';
}

export class MfaRequired extends Error {
  constructor() { super('MFA code required'); this.name = 'MfaRequired'; }
}

export class NetworkError extends Error {
  constructor() { super('No connection'); this.name = 'NetworkError'; }
}

const offKey = (u: string) => `offline_${u.trim().toLowerCase()}`;

// Has this user logged in online on this device, so offline login (incl. MFA) will work?
export async function hasOfflineSession(username: string): Promise<boolean> {
  if (!username.trim()) return false;
  try { return !!(await SecureStore.getItem(offKey(username))); } catch { return false; }
}

// Cache an offline credential after a successful ONLINE login, so the same user can
// log in (incl. MFA) with no signal: a salted password verifier, the TOTP secret
// (already in their authenticator) and the resolved role/permissions, in the Keychain.
async function cacheOfflineCred(username: string, password: string, token: string) {
  try {
    const me = await api('/auth/me');
    let secret: string | null = null;
    if (me.mfa_enabled) { try { secret = (await api('/auth/mfa/secret')).secret; } catch {} }
    const salt = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    await SecureStore.setItem(offKey(username), JSON.stringify({
      username, salt, pwHash: sha1Hex(salt + password), secret,
      role: me.role, name: me.name, mfa_enabled: !!me.mfa_enabled,
      clearance: !!me.clearance_authorized, perms: _perms, token, at: Date.now(),
    }));
  } catch { /* best-effort */ }
}

// Stable per-install device id for the login/audit log — generated once, kept in the Keychain.
export async function deviceId(): Promise<string> {
  let id = await SecureStore.getItem('device_id');
  if (!id) {
    id = 'ipad-' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    await SecureStore.setItem('device_id', id);
  }
  return id;
}

// Offline login/logout events queue locally and flush to /auth/event once back online.
async function queueAuthEvent(kind: 'login' | 'logout') {
  try {
    const raw = await SecureStore.getItem('auth_events');
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ kind, mode: 'offline', at: new Date().toISOString(), device_id: await deviceId() });
    await SecureStore.setItem('auth_events', JSON.stringify(arr.slice(-50)));
  } catch { /* best-effort */ }
}
export async function flushAuthEvents() {
  try {
    const raw = await SecureStore.getItem('auth_events');
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!arr.length) return;
    const left: any[] = [];
    for (const ev of arr) {
      try { await api('/auth/event', { method: 'POST', body: JSON.stringify(ev) }); } catch { left.push(ev); }
    }
    await SecureStore.setItem('auth_events', JSON.stringify(left));
  } catch { /* best-effort */ }
}

export async function login(username: string, password: string, otp?: string) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Device-Id': await deviceId() },
      body: new URLSearchParams(otp ? { username, password, otp } : { username, password }).toString(),
    });
  } catch { throw new NetworkError(); }            // server unreachable -> caller tries offline
  if (!res.ok) {
    let detail = 'Login failed';
    try { detail = (await res.json()).detail || detail; } catch {}
    if (res.status === 401 && /mfa/i.test(detail) && !otp) throw new MfaRequired();
    throw new Error(detail);
  }
  const json = await res.json();
  await SecureStore.setItem('token', json.access_token);
  _role = json.role ?? null;
  _clearanceAuthorized = !!json.clearance_authorized;
  try { _name = (await api('/auth/me')).name ?? null; } catch {}   // full name for the page header
  await loadPermissions();
  cacheOfflineCred(username, password, json.access_token).catch(() => {});
  flushAuthEvents().catch(() => {});               // report any offline logins now we're online
  flushFeedback().catch(() => {});                 // send any feedback queued while offline
  prefetchOfflineFlights().catch(() => {});        // warm the offline Leon cache (all tails) for the next 72 h
  prefetchLastFuel().catch(() => {});              // warm previous-leg landing fuel (all tails, last 3 days)
  prefetchHelp().catch(() => {});                  // warm the offline User Guide + FAQ cache
  return json as { access_token: string; role: string; mfa_enrollment_required?: boolean };
}

// Warm the offline flight cache on login so the next 72 h of schedule (Admin
// leon_offline_hours) is available before anyone opens Flight Details — fetch every
// fleet tail and store it locally. Best-effort and fire-and-forget; never blocks login.
export async function prefetchOfflineFlights(): Promise<number> {
  let n = 0;
  try {
    const fleet = await fleetList();
    await Promise.all(fleet.map(async (a) => {
      try { const fl = await leonFlights(a.registration); await setCachedFlights(a.registration, fl); n += fl.length; }
      catch { /* per-tail best effort */ }
    }));
  } catch { /* offline or no fleet — keep whatever cache we have */ }
  return n;
}

// Offline login: verify the password (cached verifier) and MFA code (cached TOTP
// secret) locally, then restore the cached session. Used only when the server is
// unreachable; the user must have logged in online at least once on this device.
export async function loginOffline(username: string, password: string, otp?: string) {
  const raw = await SecureStore.getItem(offKey(username));
  if (!raw) throw new Error('Offline: no saved session for this user — log in once online first.');
  const c = JSON.parse(raw);
  if (sha1Hex(c.salt + password) !== c.pwHash) throw new Error('Invalid username or password (offline).');
  if (c.mfa_enabled) {
    if (!otp) throw new MfaRequired();
    if (!c.secret || !verifyTotp(c.secret, otp)) throw new Error('Invalid MFA code (offline).');
  }
  await SecureStore.setItem('token', c.token || '');
  _role = c.role ?? null;
  _name = c.name ?? null;
  _clearanceAuthorized = !!c.clearance;
  _perms = c.perms ?? _perms;
  queueAuthEvent('login').catch(() => {});         // recorded to the server when next online
  return { access_token: c.token, role: c.role, offline: true };
}

export const requestOtp = (username: string) =>
  fetch(`${BASE}/auth/otp/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  }).then((r) => r.json());

export const mfaSetup = (): Promise<{ secret: string; otpauth_uri: string; issuer: string; account: string }> =>
  api('/auth/mfa/setup', { method: 'POST' });
// Verify enrolment; the server returns a full (non-enrol) token — swap it in so the
// just-enrolled user has full access without re-typing their password.
export async function mfaVerify(code: string) {
  const r = await api('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
  if (r?.access_token) { await SecureStore.setItem('token', r.access_token); await loadPermissions(); }
  return r;
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST', headers: { 'X-Device-Id': await deviceId() } }); }
  catch { await queueAuthEvent('logout'); }        // offline -> report on next online
  await SecureStore.deleteItem('token');
  _role = null;
  _name = null;
  _clearanceAuthorized = false;
}

async function authHeader() {
  const t = await SecureStore.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

let _devIdCache: string | null = null;
async function _devId(): Promise<string> { if (!_devIdCache) _devIdCache = await deviceId(); return _devIdCache; }

async function api(path: string, init: RequestInit = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': await _devId(), ...(await authHeader()), ...(init.headers ?? {}) };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new NetworkError();                         // offline / server unreachable → callers fall back to local
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* non-JSON body */ }
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.status === 204 ? null : res.json();
}

// Run a mutating request; if OFFLINE, queue it for replay and return { queued:true } instead
// of throwing, so the caller completes locally and shows "Saved offline — will sync". Online
// behaviour is unchanged. Use only for fire-and-forget mutations (caller doesn't need the body).
async function mutateOrQueue(path: string, init: RequestInit): Promise<any> {
  try { return await api(path, init); }
  catch (e) {
    if (e instanceof NetworkError) {
      await queueRequest((init.method as string) || 'POST', path, init.body as string | undefined);
      return { queued: true };
    }
    throw e;
  }
}

export const listOpenDefects = (aircraftId: string) =>
  api(`/defects/open?aircraft_id=${encodeURIComponent(aircraftId)}`);
export const listActiveDefects = (aircraftId: string) =>
  api(`/defects/active?aircraft_id=${encodeURIComponent(aircraftId)}`);
export const listHIL = (aircraftId: string) =>
  api(`/defects/hil?aircraft_id=${encodeURIComponent(aircraftId)}`);
// Mechanic actions (new / cleared defects) awaiting the commander's read-and-accept.
export const pendingAckDefects = (aircraftId: string): Promise<any[]> =>
  api(`/defects/pending-ack?aircraft_id=${encodeURIComponent(aircraftId)}`);
export const ackDefect = (defectId: string): Promise<{ acknowledged: boolean; ack_by?: string }> =>
  api(`/defects/${defectId}/ack`, { method: 'POST' });

export const nextTl = (reg: string): Promise<{ next_tl: number }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/next-tl`);

// Release gate: the revision this iPad's channel is approved to run (null = stay on current).
// The actual OTA apply (expo-updates) is wired once EAS + the signed build are in place.
export const appRelease = (device?: string): Promise<{ revision: string | null; runtime_version?: string; force?: boolean; notes?: string; approved_at?: string }> =>
  api(`/app/release${device ? `?device=${encodeURIComponent(device)}` : ''}`);

export type MaintTask = { id: string; registration: string; title: string; description?: string; ata?: string; reference?: string; due_date?: string | null; audience: string; status: string; completed_by_name?: string | null; completed_at?: string | null; completed_note?: string | null; tlb_no?: string | null };
export const maintTasks = (reg: string): Promise<MaintTask[]> =>
  api(`/maint-tasks?aircraft_id=${encodeURIComponent(reg)}`);
export const completeMaintTask = (id: string, body: { signer_name?: string; note?: string; tlb_no?: string; signature_image?: string }) =>
  mutateOrQueue(`/maint-tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(body) });

export type Notice = { id: string; title: string; body: string; severity: string; audience: string; created_at: string; read: boolean };
export const myNotices = (): Promise<Notice[]> => api('/notices');
export const markNoticeRead = (id: string): Promise<{ status: string }> => api(`/notices/${id}/read`, { method: 'POST' });

export type LeonFlight = {
  leon_nid: string; flight_no: string; registration: string;
  dep?: string; arr?: string; alternate?: string; std?: string; sta?: string; commander?: string; airborne: boolean;
  flight_type?: string; cancelled?: boolean;
};
export const leonFlights = (reg: string): Promise<LeonFlight[]> =>
  api(`/leon/flights?reg=${encodeURIComponent(reg)}`);

export const signRecord = (payload: {
  kind: string; sector_id?: string; defect_id?: string; signature_image?: string; device_id?: string;
}) => mutateOrQueue('/signatures', { method: 'POST', body: JSON.stringify(payload) });

export const getDefect = (id: string) => api(`/defects/${id}`);
export const addDefectAction = (id: string, body: any) =>
  mutateOrQueue(`/defects/${id}/actions`, { method: 'POST', body: JSON.stringify(body) });
export const extendDefect = (id: string, body: { due_date: string; rect_interval?: string; mel_ref?: string; narrative?: string }) =>
  mutateOrQueue(`/defects/${id}/actions`, { method: 'POST', body: JSON.stringify({ kind: 'extension', ...body }) });
export const closeDefect = (id: string) => mutateOrQueue(`/defects/${id}/close`, { method: 'POST' });
export const reverseRectification = (id: string): Promise<{ status: string }> =>
  mutateOrQueue(`/defects/${id}/reverse-rectification`, { method: 'POST' });
export const acceptDispatch = (id: string, dispatchable: boolean) =>
  mutateOrQueue(`/defects/${id}/accept-dispatch?dispatchable=${dispatchable}`, { method: 'POST' });

export type DefectBrief = {
  id: string; title?: string; description: string; ata_chapter?: string;
  source: string; area: string; status: string; mel_ref?: string;
  blocks_serviceability: boolean; dispatch_accepted: boolean | null;
};
export type ReleaseStatus = {
  serviceable: boolean; blockers: DefectBrief[]; deferred: DefectBrief[]; cabin_pending: DefectBrief[];
  released: boolean; release: { by?: string; at?: string; kind?: string; serviceable?: boolean; note?: string };
  reset_request?: { status: string; reason?: string; by?: string; at?: string; review_note?: string; reviewed_by?: string } | null;
};
export const releaseStatus = (sectorId: string): Promise<ReleaseStatus> =>
  api(`/sectors/${sectorId}/release-status`);
export async function releaseSector(sectorId: string, body: { note?: string; signer_name?: string; licence_no?: string; signature_image?: string; otp?: string; device_id?: string }) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/sectors/${sectorId}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    });
  } catch {                                             // offline → queue the CRS with an offline flag
    await queueRequest('POST', `/sectors/${sectorId}/release`, JSON.stringify({ ...body, offline: true }));
    return { queued: true };
  }
  if (!res.ok) {
    let detail = `release → ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch {}
    if (res.status === 401 && /mfa/i.test(detail) && !body.otp) throw new MfaRequired();
    throw new Error(detail);
  }
  return res.json();
}
export const sectorDetail = (sectorId: string) => api(`/sectors/${sectorId}/detail`);
export const getServerSector = (sectorId: string): Promise<any> => api(`/sectors/${sectorId}`);
export const serverSectors = (aircraftId?: string): Promise<any[]> =>
  api(`/sectors${aircraftId ? `?aircraft_id=${encodeURIComponent(aircraftId)}` : ''}`);
// Push one sector through the normal sync endpoint (used by the web build, which has no local SQLite).
export const pushSector = (sector: any): Promise<any> =>
  api('/sync/push', { method: 'POST', body: JSON.stringify({ sectors: [sector], defects: [] }) });
export const pushDefect = (defect: any): Promise<any> =>
  api('/sync/push', { method: 'POST', body: JSON.stringify({ sectors: [], defects: [defect] }) });
export const serverSectorDefects = (sectorId: string): Promise<any[]> =>
  api(`/sectors/${sectorId}/detail`).then((r: any) => r.defects || []).catch(() => []);
export const deleteServerSector = (id: string, force = false): Promise<any> =>
  api(`/sectors/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
export const revokeAcceptance = (sectorId: string): Promise<{ status: string }> =>
  mutateOrQueue(`/sectors/${sectorId}/revoke-acceptance`, { method: 'POST' });
export const requestCrsReset = (sectorId: string, reason: string): Promise<{ status: string; id: string }> =>
  mutateOrQueue(`/sectors/${sectorId}/crs-reset-request`, { method: 'POST', body: JSON.stringify({ reason }) });

export type Correction = { id: string; field?: string; old_value?: string; new_value?: string; reason: string; raised_by_name?: string; raised_at: string; status: string };
export const listCorrections = (sectorId: string): Promise<Correction[]> => api(`/sectors/${sectorId}/corrections`);
export const raiseCorrection = (sectorId: string, body: { field?: string; old_value?: string; new_value?: string; reason: string; signature_image?: string }): Promise<{ id: string }> =>
  mutateOrQueue(`/sectors/${sectorId}/corrections`, { method: 'POST', body: JSON.stringify(body) });
export const sectorTlHtml = (sectorId: string): Promise<{ html: string }> => api(`/sectors/${sectorId}/tl`);
// Tech Log / CRS HTML with offline fallback: cache the rendered doc when online so the
// signed record can be opened with no signal. A signed/released sector is immutable.
export async function sectorTlHtmlCached(sectorId: string): Promise<{ html: string; cached?: boolean }> {
  try { const r = await sectorTlHtml(sectorId); if (r?.html) { await setRef(`tl_${sectorId}`, r.html); return r; } } catch { /* offline */ }
  const { data } = await getRef<string>(`tl_${sectorId}`);
  if (data) return { html: data, cached: true };
  throw new Error('Offline — this Tech Log has not been cached on this iPad yet.');
}

// Paper Hold Item List / Cabin Defect Log forms (server-rendered) for view + print.
export const hilHtml = (reg: string): Promise<{ html: string }> => api(`/logbooks/${encodeURIComponent(reg)}/hil`);
export const cabinLogHtml = (reg: string): Promise<{ html: string }> => api(`/logbooks/${encodeURIComponent(reg)}/cabin-log`);
// Single-item form (one HIL item / one cabin defect) for inline view/print.
export const hilHtmlOne = (defectId: string): Promise<{ html: string }> => api(`/logbooks/defect/${defectId}/hil`);
export const cabinLogHtmlOne = (defectId: string): Promise<{ html: string }> => api(`/logbooks/defect/${defectId}/cabin-log`);
export const setTlNumber = (sectorId: string, page_no: number, reason?: string) =>
  api(`/sectors/${sectorId}/tl-number`, { method: 'POST', body: JSON.stringify({ page_no, reason }) });

export type Attachment = { id: string; kind: string; filename?: string; caption?: string; content_type: string; created_at: string };
export const uploadAttachment = (body: {
  id?: string; kind: string; defect_id?: string; sector_id?: string;
  filename?: string; content_type?: string; data_b64: string; caption?: string;
}) => api('/attachments', { method: 'POST', body: JSON.stringify(body) });
export const listAttachments = (q: { defect_id?: string; sector_id?: string }): Promise<Attachment[]> => {
  const p = new URLSearchParams();
  if (q.defect_id) p.set('defect_id', q.defect_id);     // never send the string "undefined"
  if (q.sector_id) p.set('sector_id', q.sector_id);
  return api(`/attachments?${p.toString()}`);
};
export const attachmentUrl = (id: string) => `${BASE}/attachments/${id}`;

export const addServicing = (body: { sector_id: string; system: string; uplift_lt?: number; depart_lt?: number }) =>
  mutateOrQueue('/servicing', { method: 'POST', body: JSON.stringify(body) });

export type Fleet = { registration: string; type: string; msn?: string };
export const fleetList = (): Promise<Fleet[]> => api('/aircraft');

// Currently-selected aircraft (replaces the old hardcoded LZ-FSA), persisted.
let _aircraft: Fleet | null = null;
export const currentAircraft = () => _aircraft;
export async function setCurrentAircraft(a: Fleet) {
  _aircraft = a; await SecureStore.setItem('aircraft', JSON.stringify(a));
}
export async function loadCurrentAircraft(): Promise<Fleet | null> {
  if (_aircraft) return _aircraft;
  try { const j = await SecureStore.getItem('aircraft'); if (j) _aircraft = JSON.parse(j); } catch {}
  return _aircraft;
}

export type Tank = { field: string; label: string; max: number };
export const aircraftConfig = (reg: string): Promise<{ registration: string; type: string; tanks: Tank[]; min_fuel_kg?: number | null; fuel_capacity_kg?: number | null; fuel_ref?: string | null; fuel_density_ref?: number | null; oil_min_qt?: number | null; oil_max_qt?: number | null; oil_consumption_qt_h?: number | null; hyd_min_green_l?: number | null; hyd_min_blue_l?: number | null; hyd_min_yellow_l?: number | null; oil_hyd_ref?: string | null }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/config`);

export type Airport = { valid: boolean; icao: string; iata?: string | null; name?: string | null; city?: string | null; country?: string | null; lat?: number | null; lon?: number | null };
export const airportLookup = (code: string): Promise<Airport> =>
  api(`/leon/airport/${encodeURIComponent(code.trim().toUpperCase())}`);

// Fetch one map tile and return it as a base64 data-URI for offline storage.
async function tileToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Pre-cache the overview route map (airport coords + tiles) for upcoming flights so the Sector
// "Map view" works offline. Tiles are deduplicated by z/x/y (stored once, shared across legs)
// and skipped if already cached; a per-run download budget bounds the work. Native-only.
export async function cacheRouteMaps(flights: LeonFlight[]): Promise<void> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web' || !flights?.length) return;
  const aptCoord = async (code?: string | null) => {
    if (!code) return null;
    const cached = await getApt(code);
    if (cached?.lat != null) return cached;
    try {
      const a = await airportLookup(code);
      if (a?.lat != null && a?.lon != null) {
        const v = { lat: a.lat, lon: a.lon, iata: a.iata, name: a.name };
        await setApt(code, v); return v;
      }
    } catch { /* offline */ }
    return null;
  };
  let budget = 500;                                    // hard cap on tile downloads per run
  const seen = new Set<string>();
  for (const f of flights) {
    if (budget <= 0) break;
    if (!f.dep || !f.arr || f.dep === f.arr) continue;
    const d = await aptCoord(f.dep), a = await aptCoord(f.arr);
    if (!d || !a) continue;
    const { tiles } = overviewTiles(d.lat, d.lon, a.lat, a.lon);
    for (const t of tiles) {
      if (budget <= 0) break;
      const k = tileKey(t);
      if (seen.has(k)) continue; seen.add(k);          // dedup within this run
      if (await hasTile(k)) continue;                  // dedup across runs (already stored)
      const uri = await tileToDataUri(geoapifyTileUrl(t.z, t.x, t.y));
      if (uri) { await setTile(k, uri); budget--; }
    }
  }
}

export type PrevFuel = { fuel_kg: number | null; source: string | null; flight_no?: string | null; date?: string | null; dep?: string | null; arr?: string | null; continuity_ok?: boolean | null; cached?: boolean };

// Previous-leg landing fuel for the Departure screen. Online: ask the server (ETL → Leon JL)
// and keep a per-aircraft backup on the iPad. Offline: use that backup. Survives sync.
export async function prevFuelCached(sectorId: string, reg: string): Promise<PrevFuel> {
  // Precedence: ETL first (offline on this iPad, or online from the server), then Leon
  // (cached offline, or online). ETL is the authoritative operator record; Leon is the fallback.
  const nk = _normReg(reg);
  const keyEtl = `lastfuel_etl_${nk}`, keyLeon = `lastfuel_leon_${nk}`;
  let localEtl: PrevFuel | null = null;
  try { const { localPrevFuel } = require('../db/sectors'); localEtl = await localPrevFuel(sectorId); } catch { /* web/no-op */ }
  try {
    const r: PrevFuel = await api(`/sectors/${sectorId}/prev-fuel`);      // server does ETL-then-Leon
    if (r && r.fuel_kg != null) {
      const isEtl = String(r.source || '').toUpperCase().startsWith('ETL');
      try { await setRef(isEtl ? keyEtl : keyLeon, r); } catch { /* ignore */ }
      if (isEtl) return r;                       // ETL on the server (synced, authoritative)
      if (localEtl) return localEtl;             // server had only Leon, but this iPad holds an ETL leg → ETL wins
      return r;                                  // Leon
    }
  } catch { /* offline — apply the precedence below against local + cache */ }
  if (localEtl) return { ...localEtl, cached: true };                            // 1a. ETL, this iPad (offline)
  const etlC = await getRef<PrevFuel>(keyEtl).catch(() => ({ data: null }));
  if (etlC.data?.fuel_kg != null) return { ...etlC.data, cached: true, source: `${etlC.data.source || 'ETL'} · cached` };   // 1b. ETL cached
  const leonC = await getRef<PrevFuel>(keyLeon).catch(() => ({ data: null }));
  if (leonC.data?.fuel_kg != null) return { ...leonC.data, cached: true, source: `${leonC.data.source || 'Leon'} · cached` }; // 2. Leon cached
  const legacy = await getRef<PrevFuel>(`lastfuel_${nk}`).catch(() => ({ data: null }));   // prefetch fallback
  if (legacy.data?.fuel_kg != null) return { ...legacy.data, cached: true, source: `${legacy.data.source || 'last leg'} · cached` };
  return { fuel_kg: null, source: null };
}

// Warm the per-aircraft previous-leg landing fuel cache for the whole fleet, so the
// Departure screen has it offline even on a brand-new sector. Server pulls ETL first,
// else Leon JL over the last 3 days. Best-effort; called on login alongside the flight prefetch.
export async function prefetchLastFuel(): Promise<number> {
  let n = 0;
  try {
    const fleet = await fleetList();
    await Promise.all(fleet.map(async (a) => {
      try {
        const r: PrevFuel = await api(`/aircraft/${encodeURIComponent(a.registration)}/last-fuel`);
        if (r && r.fuel_kg != null) {
          const nk = _normReg(a.registration);
          const isEtl = String(r.source || '').toUpperCase().startsWith('ETL');
          await setRef(isEtl ? `lastfuel_etl_${nk}` : `lastfuel_leon_${nk}`, r);
          await setRef(`lastfuel_${nk}`, r);
          n++;
        }
      } catch { /* per-tail best effort */ }
    }));
  } catch { /* offline — keep whatever is cached */ }
  return n;
}

export type CheckStatus = { kind: string; label: string; baseline: boolean; expired: boolean;
  last: string | null; due: string | null; days_left: number | null; hours_left: number | null };
export type AircraftStatus = { registration: string; type: string; dispatchable: boolean;
  serviceable: boolean; blocking_defects: number; reasons: string[]; checks: CheckStatus[] };
const _normReg = (r: string) => (r || '').replace(/[-\s]/g, '').toUpperCase();

// Fold locally-signed (not-yet-synced) 2/10-day checks into a status so the banner
// clears the 'check overdue/not recorded' reason instantly and offline. Only check
// reasons are cleared — AOG/defect/cabin reasons are never auto-cleared.
async function _mergeLocalChecks(reg: string, st: AircraftStatus): Promise<AircraftStatus> {
  let done: Record<string, string> = {};
  try { const { localCompletedChecks } = require('../db/checks'); done = await localCompletedChecks(reg); } catch { /* web/no-op */ }
  if (!done || !Object.keys(done).length) return st;
  const now = Date.now();
  const checks = (st.checks || []).map((c) => {
    const ca = done[c.kind];
    if (!ca) return c;
    const compl = new Date(ca).getTime();
    if (compl <= new Date(c.last || 0).getTime()) return c;            // server already has a newer completion
    const intervalMs = (c.due && c.last) ? (new Date(c.due).getTime() - new Date(c.last).getTime())
      : (c.kind === '2day' ? 2 : 10) * 86400000;
    const due = compl + intervalMs;
    return { ...c, baseline: true, last: new Date(compl).toISOString(), due: new Date(due).toISOString(),
      expired: due < now, days_left: Math.floor((due - now) / 86400000), hours_left: Math.round((due - now) / 360000) / 10 };
  });
  const stillExpired = new Set(checks.filter((c) => c.expired).map((c) => c.label));
  const reasons = (st.reasons || []).filter((r) => {
    if (!/ (overdue|not recorded)$/.test(r)) return true;               // not a check reason — keep
    return [...stillExpired].some((lbl) => r.startsWith(lbl));
  });
  const serviceable = reasons.length === 0;
  return { ...st, checks, reasons, serviceable, dispatchable: serviceable };
}

export async function aircraftStatus(reg: string): Promise<AircraftStatus> {
  try {
    const st: AircraftStatus = await api(`/aircraft/${encodeURIComponent(reg)}/status`);
    try { await setRef(`status_${_normReg(reg)}`, st); } catch { /* best-effort cache */ }
    return _mergeLocalChecks(reg, st);
  } catch (e) {
    const { data } = await getRef<AircraftStatus>(`status_${_normReg(reg)}`);    // offline → last known status
    if (data) return _mergeLocalChecks(reg, data);
    throw e;
  }
}

export type CheckTask = { id: string; text: string; insp?: boolean; note?: string; fields?: { key: string; label: string }[] };
export type CheckTemplate = { kind: string; title: string; rev: string; validity_days: number;
  description?: string; reason?: string; header_notes?: { label: string; text: string }[];
  sections: { title: string; tasks: CheckTask[] }[] };
export const checkTemplate = (kind: string, reg?: string): Promise<CheckTemplate> =>
  api(`/aircraft/checks/template/${kind}${reg ? `?reg=${encodeURIComponent(reg)}` : ''}`);
// Local-first on the iPad: record the signed check immediately (countdown + serviceability
// update with no delay, works offline) and let syncPush replay it to the server. On web
// (no local DB) it posts directly.
export async function completeCheck(reg: string, kind: string, body: any): Promise<any> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') {
    return api(`/aircraft/${encodeURIComponent(reg)}/checks/${kind}/complete`, { method: 'POST', body: JSON.stringify(body) });
  }
  const { queueCheck } = require('../db/checks');
  const { id, completed_at } = await queueCheck(reg, kind, body);
  syncPush().catch(() => {});                          // send now if online; otherwise on the next connectivity
  return { id, completed_at, queued: true };
}
export const checkHtml = (checkId: string): Promise<{ html: string }> =>
  api(`/aircraft/checks/record/${checkId}/html`);
export const previewCheck = (reg: string, kind: string, body: any): Promise<{ html: string }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/checks/${kind}/preview`, { method: 'POST', body: JSON.stringify(body) });
export type CheckRecord = { id: string; kind: string; completed_at: string; signer_name?: string; licence_no?: string; tlb_no?: string; data?: any; amendable?: boolean };
export const listChecks = (reg: string, days?: number): Promise<CheckRecord[]> =>
  api(`/aircraft/${encodeURIComponent(reg)}/checks${days ? `?days=${days}` : ''}`);
export const amendCheck = (reg: string, id: string, body: any) =>
  mutateOrQueue(`/aircraft/${encodeURIComponent(reg)}/checks/${id}/amend`, { method: 'POST', body: JSON.stringify(body) });

export type Utilisation = { registration: string; etl: { tsn_fh: number; csn_fc: number };
  camo: { tsn: number | null; csn: number | null } | null; configured: boolean;
  baseline: { tsn_fh: number | null; csn_fc: number | null; source: string | null; at: string | null } | null;
  pending_sectors: number; match: boolean | null; diff_fh: number | null; diff_fc: number | null; error: string | null };
export const aircraftUtilisation = (reg: string): Promise<Utilisation> =>
  api(`/aircraft/${encodeURIComponent(reg)}/utilisation`);

// Per-aircraft iPads + master designation (sync precedence master → FO → Backup → Cabin).
export type Ipad = { id: string; label: string; role: string; role_label: string; is_master: boolean;
  this_device: boolean; last_sync: string | null };
export const listIpads = (reg: string): Promise<{ registration: string; ipads: Ipad[] }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/ipads`);
export const setMaster = (reg: string, deviceId: string, unset = false): Promise<{ master: string | null; label: string }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/master`, { method: 'POST', body: JSON.stringify({ device_id: deviceId, unset }) });
export type Heartbeat = { you_are_master: boolean; auto_promoted: boolean; master: string | null; master_role: string | null; window_s: number };
export const heartbeat = (reg: string): Promise<Heartbeat> =>
  api(`/aircraft/${encodeURIComponent(reg)}/heartbeat`, { method: 'POST' });

export type DocItem = { id: string; title: string; filename: string; content_type: string; size?: number; audience?: string; created_at: string };
export const documentsList = (kind: 'document' | 'form' = 'document'): Promise<DocItem[]> =>
  api(`/documents?kind=${kind}`);
export async function openDocument(id: string) {
  const t = await SecureStore.getItem('token');
  const res = await fetch(`${BASE}/documents/${id}/file`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`Open failed (${res.status})`);
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
  } else {
    throw new Error('Open documents from the web app for now.');
  }
}

export const createMaintenance = (body: { aircraft_id: string; station: string; wo_ref?: string; note?: string }): Promise<{ id: string; page_no: number; station: string }> =>
  api('/sectors/maintenance', { method: 'POST', body: JSON.stringify(body) });

export type SignOff = { id: string; kind: string; signer_name?: string; licence_no?: string; signed_at: string;
  registration?: string; sector_id?: string; defect_id?: string; defects_summary?: string; flight_no?: string; flight_date?: string; dep?: string; arr?: string };
// Recent sign-offs with offline fallback: cache the list, and warm the Tech Log/CRS
// cache for each signed sector so they can be opened offline too.
export async function signoffsRecent(days: number): Promise<{ days: number; signoffs: SignOff[]; cached?: boolean }> {
  try {
    const r: { days: number; signoffs: SignOff[] } = await api(`/signoffs/recent?days=${days}`);
    await setRef('signoffs', r);
    const ids = Array.from(new Set(r.signoffs.map((g) => g.sector_id).filter(Boolean))) as string[];
    Promise.all(ids.map((id) => sectorTlHtmlCached(id).catch(() => {}))).catch(() => {});   // warm offline docs
    return r;
  } catch {
    const { data } = await getRef<{ days: number; signoffs: SignOff[] }>('signoffs');
    return data ? { ...data, cached: true } : { days, signoffs: [], cached: true };
  }
}

export const publicConfig = (): Promise<{ testing_mode: boolean }> =>
  fetch(`${BASE}/auth/config`).then((r) => r.json()).catch(() => ({ testing_mode: false }));

export const forgotPassword = (username: string): Promise<{ status: string; message: string }> =>
  fetch(`${BASE}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }).then((r) => r.json());

// Offset (seconds) between the server's UTC and this device's clock (server − device,
// round-trip corrected). Positive = device is behind UTC. null when offline.
export async function clockOffsetSeconds(): Promise<number | null> {
  try {
    const t0 = Date.now();
    const j = await fetch(`${BASE}/auth/time`).then((r) => r.json());
    const deviceAtServer = t0 + (Date.now() - t0) / 2;     // estimate device time when the server replied
    return Math.round((j.epoch_ms - deviceAtServer) / 1000);
  } catch { return null; }
}

// Quick "can we reach the server?" probe for the login screen (online vs offline).
export async function serverReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${BASE}/auth/config`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

export const appSettings = (): Promise<{ defect_required_fields: string[]; check_view_days?: number; signoff_view_days?: number; auto_logout_minutes?: number; leon_offline_flights?: number; amm_revision?: string }> =>
  api('/admin/settings');

export const deleteDefect = (id: string) => mutateOrQueue(`/defects/${id}`, { method: 'DELETE' });

export type MelItem = {
  id: string; ata: string; item: string; category?: string;
  rectification_interval?: string; qty_installed?: string; qty_required?: string;
  placard?: string; remarks?: string; maintenance_proc?: string; ops_proc?: string;
  applicability?: string; revision?: string;
};
// MEL + task-card pickers fall back to the offline cache (db/reference) when the
// server is unreachable; refreshReference() tops up the cache whenever online.
export const melSearch = async (q: string, ata?: string): Promise<MelItem[]> => {
  try { return await api(`/mel?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}${ata ? `&ata=${encodeURIComponent(ata)}` : ''}`); }
  catch { return localMel(q, ata); }
};

export type CdlItem = {
  id: string; ata: string; system?: string; code?: string; item?: string; ident?: string;
  criteria?: string; qty_installed?: string; dispatch?: string; maintenance_proc?: string;
  performance?: string; detail?: string; applicability?: string; revision?: string; registrations?: string[];
};
export const cdlSearch = async (q: string, ata?: string): Promise<CdlItem[]> => {
  try { return await api(`/cdl?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}${ata ? `&ata=${encodeURIComponent(ata)}` : ''}`); }
  catch { return localCdl(q, ata); }
};

export type TaskCard = { task_number: string; card_no?: string; ata_chapter?: string; section?: string;
  chapter?: string; source?: string; src_ref?: string; job_type?: string; threshold?: string; interval?: string;
  interval_unit?: string; effectivity?: string; description?: string; title?: string; revision?: string };
export const taskCardFilters = async (): Promise<{ ata: string[]; sub: Record<string, string[]> }> => {
  try { return await api('/mel/task-cards/filters'); } catch { return localTaskFilters(); }
};
export const taskCards = async (q?: string, ata?: string, sub?: string): Promise<TaskCard[]> => {
  try { return await api(`/mel/task-cards?limit=80${q ? `&q=${encodeURIComponent(q)}` : ''}${ata ? `&ata=${encodeURIComponent(ata)}` : ''}${sub ? `&sub=${encodeURIComponent(sub)}` : ''}`); }
  catch { return localTaskCards(q, ata, sub); }
};

// Append an i.a.w task-card line to a scope/narrative, inserting the AMP·AMM revision header ONCE.
export function taskLineWithHeader(existing: string, line: string, ampRev: string, ammRev: string): string {
  let base = (existing || '').replace(/\s+$/, '');
  const header = [ampRev ? `AMP ${ampRev}` : '', ammRev ? `AMM ${ammRev}` : ''].filter(Boolean).join(' · ');
  if (header && !base.includes(header)) base = base ? `${header}\n\n${base}` : header;
  return base ? `${base}\n\n${line}` : line;
}

// Current active AMP issue/revision as 'Iss X Rev Y TR Z' (from CAMO, via /mel/ref-version).
export async function ampRevision(): Promise<string> {
  try {
    const v: any = await api('/mel/ref-version');
    const a = v?.amp || {};
    return [a.issue ? `Iss ${a.issue}` : '', a.rev ? `Rev ${a.rev}` : '', a.tr ? `TR ${a.tr}` : ''].filter(Boolean).join(' ');
  } catch { return ''; }
}

// Current AMM revision string (from CAMO, via /mel/ref-version). Falls back to the
// cached ref-version so it still resolves offline. No manual entry — CAMO is the source.
export async function ammRevision(): Promise<string> {
  try {
    const v: any = await api('/mel/ref-version');
    if (v && 'amm' in v) return String(v.amm || '');
  } catch { /* offline — fall through to cached ref-version */ }
  try {
    const { data } = await getRef('refversion');
    if (data && (data as any).amm) return String((data as any).amm);
  } catch { /* no cache */ }
  return '';
}

// Checked whenever the iPad is online: a tiny version probe, and the full MEL +
// task-card lists are re-downloaded only when CAMO has changed (or no cache yet).
export async function refreshReference() {
  try {
    flushAuthEvents().catch(() => {});                     // report any offline logins now we're online
    const ver = await api('/mel/ref-version');             // tiny — runs every time online
    const reg = currentAircraft()?.registration;
    // Cache AMM on every iPad so any device works offline for a mechanic (only ~1.9 MB/tail).
    // (A per-device "maintenance iPad" scope is under review with the team — see AMM-offline notes.)
    const ammKey = reg ? `amm:${reg.toUpperCase()}` : null;
    const [{ data: cachedVer }, { data: melCache }, ammCache] = await Promise.all([
      getRef('refversion'), getRef('mel'), ammKey ? getRef(ammKey) : Promise.resolve({ data: null }),
    ]);
    const unchanged = melCache && cachedVer && JSON.stringify(cachedVer) === JSON.stringify(ver);
    const ammMissing = !!ammKey && !ammCache.data;         // this tail not cached yet (e.g. switched aircraft)
    if (unchanged && !ammMissing) return;                  // nothing to do
    if (!unchanged) {                                      // fleet reference changed → re-pull MEL/CDL/AMP
      const [mel, cards, filters, cdl] = await Promise.all([
        api('/mel?limit=3000'), api('/mel/task-cards?limit=3000'), api('/mel/task-cards/filters'), api('/cdl?limit=3000'),
      ]);
      await setRef('mel', mel); await setRef('taskcards', cards);
      await setRef('taskfilters', filters); await setRef('cdl', cdl); await setRef('refversion', ver);
    }
    if (ammKey && reg) {                                   // AMM task-card picker offline (per aircraft)
      const [amm, ammf] = await Promise.all([
        api(`/mel/amm?reg=${encodeURIComponent(reg)}&limit=20000`),
        api(`/mel/amm/filters?reg=${encodeURIComponent(reg)}`),
      ]);
      await setRef(ammKey, amm); await setRef(`ammfilters:${reg.toUpperCase()}`, ammf);
    }
  } catch { /* offline — keep whatever cache we have */ }
}
// "i.a.w <task no> <summary>" — the rectification narrative the mechanic edits.
// Some AMP cards have a blank description in CAMO (text leaked into chapter/section);
// fall back to those so the line is never bare. The mechanic can edit it.
export const taskSummary = (t: TaskCard): string =>
  (t.description || t.title || t.chapter || t.section || '').replace(/\s+/g, ' ').trim();
export const iawText = (t: TaskCard): string =>
  `i.a.w ${t.task_number} ${taskSummary(t) || '(no description in AMP — refer to task card)'}`.trim();

// CAMO MPD task — `reference` is the AMM reference.
export type MpdCard = { reference: string; description?: string; task_number?: string;
  section?: string; source_task_reference?: string; zone?: string; task_code?: string };
export const mpdFilters = async (): Promise<{ ata: string[] }> => {
  try { return await api('/mel/mpd/filters'); } catch { return { ata: [] }; }
};
export const mpdSearch = async (q?: string, ata?: string): Promise<MpdCard[]> => {
  try { return await api(`/mel/mpd?limit=200${q ? '&q=' + encodeURIComponent(q) : ''}${ata ? '&ata=' + encodeURIComponent(ata) : ''}`); }
  catch { return []; }
};
export const mpdSummary = (m: MpdCard): string =>
  (m.description || m.section || '').replace(/\s+/g, ' ').trim();
// "i.a.w AMM <reference> — <summary>" — starts the defect description; the mechanic edits it.
export const mpdIawLine = (m: MpdCard): string =>
  `i.a.w AMM ${m.reference}${mpdSummary(m) ? ' — ' + mpdSummary(m) : ''}`.trim();

// CAMO AMM task card (separate AMM DB) — applicable per aircraft (registration).
export type AmmCard = { task_card_ref: string; title?: string; description?: string; ata?: string; revision?: string };
export const ammFilters = async (reg?: string): Promise<{ ata: string[] }> => {
  try { return await api(`/mel/amm/filters${reg ? '?reg=' + encodeURIComponent(reg) : ''}`); }
  catch { return localAmmFilters(reg); }                 // offline → cached AMM filters for this tail
};
export const ammSearch = async (reg?: string, q?: string, ata?: string): Promise<AmmCard[]> => {
  try {
    const p = [reg ? 'reg=' + encodeURIComponent(reg) : '', q ? 'q=' + encodeURIComponent(q) : '', ata ? 'ata=' + encodeURIComponent(ata) : '', 'limit=200'].filter(Boolean).join('&');
    return await api(`/mel/amm?${p}`);
  } catch { return localAmm(reg, q, ata); }               // offline → cached AMM task cards for this tail
};
export const ammSummary = (m: AmmCard): string =>
  (m.description || m.title || '').replace(/\s+/g, ' ').trim();
// "i.a.w AMM Rev <rev> · <task#> — <description>" — starts the description; editable.
export const ammIawLine = (m: AmmCard): string =>
  `i.a.w AMM Rev ${m.revision || '—'} · ${m.task_card_ref}${ammSummary(m) ? ' — ' + ammSummary(m) : ''}`.trim();
// Full HTML instruction (with diagrams) for one AMM task card — for the in-app viewer.
export type AmmContent = { task_card_ref: string; title?: string; ata?: string; revision?: string; html: string };
export const ammContent = async (reg: string | undefined, ref: string): Promise<AmmContent> =>
  api(`/mel/amm/content?ref=${encodeURIComponent(ref)}${reg ? '&reg=' + encodeURIComponent(reg) : ''}`);

// Push every dirty local row, then clear the dirty flag on success.
// Replay locally-signed 2/10-day checks to the server. Network errors leave them
// queued for the next attempt; a 400 (server-side incompleteness) marks them rejected
// so the mechanic is prompted to re-do the check.
async function flushChecks() {
  let pend: any[] = [];
  try { const { pendingChecks } = require('../db/checks'); pend = await pendingChecks(); } catch { return; }
  const { markCheckSynced, markCheckRejected } = require('../db/checks');
  for (const c of pend) {
    try {
      await api(`/aircraft/${encodeURIComponent(c.reg)}/checks/${c.kind}/complete`, { method: 'POST', body: JSON.stringify(c.payload) });
      await markCheckSynced(c.id);
    } catch (e: any) {
      if (/\b400\b/.test(e?.message || '')) await markCheckRejected(c.id);   // invalid — surface for re-do
      // otherwise a network error → leave dirty, retry next sync
    }
  }
}

export async function syncPush() {
  flushAttachments().catch(() => {});         // best-effort photo upload
  flushChecks().catch(() => {});              // best-effort check replay
  await flushOutbox(api).catch(() => {});     // replay queued offline mutations (defect actions, signatures, …)
  const d = await db();
  const sectors = await d.getAllAsync<any>('SELECT payload FROM sectors WHERE dirty = 1');
  const defects = await d.getAllAsync<any>('SELECT payload FROM defects WHERE dirty = 1');
  const batch = {
    sectors: sectors.map((r) => JSON.parse(r.payload)),
    defects: defects.map((r) => JSON.parse(r.payload)),
  };
  if (!batch.sectors.length && !batch.defects.length) return { skipped: true };
  const results = await api('/sync/push', { method: 'POST', body: JSON.stringify(batch) });
  for (const [id, outcome] of Object.entries(results.sectors ?? {}))
    if (outcome !== 'stale') await d.runAsync('UPDATE sectors SET dirty = 0 WHERE id = ?', id);
  for (const [id, outcome] of Object.entries(results.defects ?? {}))
    if (outcome !== 'stale') await d.runAsync('UPDATE defects SET dirty = 0 WHERE id = ?', id);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Guide, Assistant & Feedback (offline-capable)
// ─────────────────────────────────────────────────────────────────────────────
function _appVersion(): string { return (Constants.expoConfig as any)?.version || '0.0.0'; }

export type GuidePage = { slug: string; section: string; title: string; body: string; version?: number };

// Fetch the full User Guide (pages + bodies) and cache it for offline reading.
// On failure, return the cached copy.
// Assistant cache uses SecureStore (localStorage on web, Keychain on native) so the
// offline guide + FAQ survive a reload on BOTH surfaces — the SQLite cache is a no-op on web.
async function _cacheSet(key: string, val: any) { try { await SecureStore.setItem(key, JSON.stringify(val)); } catch { /* best-effort */ } }
async function _cacheGet<T>(key: string): Promise<T | null> { try { const r = await SecureStore.getItem(key); return r ? JSON.parse(r) as T : null; } catch { return null; } }

export async function guidePages(): Promise<{ pages: GuidePage[]; cached: boolean }> {
  try {
    const idx: any[] = await api('/manual');
    const pages: GuidePage[] = await Promise.all(idx.map(async (p) => {
      const full = await api(`/manual/${p.slug}`);
      return { slug: full.slug, section: full.section, title: full.title, body: full.body, version: full.version };
    }));
    await _cacheSet('asst_guide', pages); await setRef('guide', pages);
    return { pages, cached: false };
  } catch {
    const pages = (await _cacheGet<GuidePage[]>('asst_guide')) || (await getRef<GuidePage[]>('guide')).data || [];
    return { pages, cached: true };
  }
}

export type Faq = { q: string; a: string };
export async function assistantFaq(): Promise<Faq[]> {
  try { const r = await api('/assistant/faq'); await _cacheSet('asst_faq', r.faq); await setRef('faq', r.faq); return r.faq; }
  catch { return (await _cacheGet<Faq[]>('asst_faq')) || (await getRef<Faq[]>('faq')).data || []; }
}

export type AssistSource = { slug: string; title: string; section: string; snippet: string };
export type AssistAnswer = { answer: string; sources: AssistSource[]; mode: string };

// Ask the assistant. Online → server (Claude when keyed, else guide retrieval).
// Offline → on-device retrieval over the cached guide + FAQ.
export async function assistantAsk(question: string): Promise<AssistAnswer> {
  try { return await api('/assistant', { method: 'POST', body: JSON.stringify({ question }) }); }
  catch { return localAssist(question); }
}

const _tok = (s: string): Set<string> => new Set((String(s || '').toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w: string) => w.length > 2));
const _inter = (a: Set<string>, b: Set<string>): number => { let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return n; };

async function localAssist(question: string): Promise<AssistAnswer> {
  const qt = _tok(question);
  if (!qt.size) return { answer: 'Ask me how to do something in the app — e.g. “how do I defer a defect?”.', sources: [], mode: 'empty' };
  const faq = (await _cacheGet<Faq[]>('asst_faq')) || (await getRef<Faq[]>('faq')).data || [];
  // FAQ first: if the question closely matches a FAQ *question*, answer it directly.
  let bestFaq: { cov: number; a: string } | null = null;
  for (const f of faq) {
    const ft = _tok(f.q); if (!ft.size) continue;
    const overlap = _inter(qt, ft); const cov = overlap / ft.size;
    if (overlap >= 2 && cov >= 0.6 && (!bestFaq || cov > bestFaq.cov)) bestFaq = { cov, a: f.a };
  }
  if (bestFaq) return { answer: bestFaq.a, sources: [], mode: 'offline-faq' };
  const pages = (await _cacheGet<GuidePage[]>('asst_guide')) || (await getRef<GuidePage[]>('guide')).data || [];
  const scored = pages.map((p) => ({ p, sc: _inter(qt, _tok(p.title)) * 3 + _inter(qt, _tok(p.body || '')) }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3);
  const sources: AssistSource[] = scored.map(({ p }) => ({ slug: p.slug, title: p.title, section: p.section, snippet: (p.body || '').trim().slice(0, 700) }));
  if (sources.length) return { answer: 'Offline — here’s the closest User Guide section:', sources, mode: 'offline-guide' };
  return { answer: 'You’re offline and I couldn’t match a guide section. Open the User Guide, or send Feedback.', sources: [], mode: 'offline-none' };
}

export type MyFeedback = { id: string; category: string; message: string; status: string; created_at: string; reply?: string | null; reply_by?: string | null; reply_at?: string | null };
export const myFeedback = (): Promise<MyFeedback[]> => api('/feedback/mine');

// Read-only Tech Log page (what goes to OASES) + matching Leon flight-watch — crew review after close.
export const techlogPage = (sectorId: string): Promise<any> => api(`/sectors/${sectorId}/techlog-page`);

export const authMe = (): Promise<{ id: string; username: string; name?: string; role: string; email?: string }> => api('/auth/me');
export type FeedbackIn = { message: string; category: string; screen?: string; contact_email?: string; email_copy?: boolean };
export async function submitFeedback(f: FeedbackIn): Promise<{ queued: boolean }> {
  const body = { ...f, app_version: _appVersion() };
  try { await api('/feedback', { method: 'POST', body: JSON.stringify(body) }); return { queued: false }; }
  catch { await _queueFeedback(body); return { queued: true }; }
}
async function _queueFeedback(body: any) {
  const raw = await SecureStore.getItem('feedback_queue'); const arr = raw ? JSON.parse(raw) : [];
  arr.push(body); await SecureStore.setItem('feedback_queue', JSON.stringify(arr.slice(-50)));
}
export async function flushFeedback() {
  const raw = await SecureStore.getItem('feedback_queue'); if (!raw) return;
  const arr = JSON.parse(raw); const left: any[] = [];
  for (const f of arr) { try { await api('/feedback', { method: 'POST', body: JSON.stringify(f) }); } catch { left.push(f); } }
  await SecureStore.setItem('feedback_queue', JSON.stringify(left));
}

// Warm the offline help cache (guide + FAQ) on login.
export async function prefetchHelp(): Promise<void> {
  try { await guidePages(); } catch { /* keep cache */ }
  try { await assistantFaq(); } catch { /* keep cache */ }
}
