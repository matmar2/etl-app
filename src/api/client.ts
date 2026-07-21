import Constants from 'expo-constants';
import * as SecureStore from './secureStore';
import { flushAttachments } from '../db/attachments';
import { setCachedFlights } from '../db/flights';
import { getApt, getRef, getTile, hasTile, localAmm, localAmmFilters, localCdl, localMel, setApt, setRef, setTile } from '../db/reference';
import { flushOutbox, queueRequest } from '../db/outbox';
import { geoapifyTileUrl, overviewTiles, tileKey } from '../util/tiles';
import { db } from '../db/schema';
import { generateTotp, sha1Hex, verifyTotp } from '../util/totp';

const BASE = (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? 'http://localhost:8000';

let _role: string | null = null;
export const role = () => _role;

let _name: string | null = null;
export const userName = () => _name;
let _username: string | null = null;   // the login ID — scopes per-user offline caches (e.g. feedback)
export const currentUsername = () => _username;
let _licence: string | null = null;
export const userLicence = () => _licence;   // certifying-staff auth / pilot licence, pre-fills sign forms

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
  try {
    _perms = await api('/auth/permissions');
    await _cacheSet('perms', _perms);                       // cache for offline
  } catch {
    // Offline: fall back to the last cached map, but ONLY if it's for this user's role
    // (never let one role inherit another's cached permissions).
    if (!_perms) {
      const c = await _cacheGet<AccessMap>('perms');
      if (c && (!_role || c.role === _role)) _perms = c;
    }
  }
  return _perms;
}
// Until permissions are loaded we FAIL CLOSED: no write, read-only access. The brief window
// (until loadPermissions resolves on sign-in) shows content read-only rather than flashing write
// controls the user isn't entitled to. The backend enforces regardless.
/** 'rw' if the role may write this page (or page.field); else read-only/none. */
export function can(page: string, field?: string): boolean {
  if (!_perms) return false;                       // fail-closed until loaded
  const v = field ? _perms.fields[`${page}.${field}`] ?? _perms.pages[page] : _perms.pages[page];
  return v === 'rw';
}
export function access(page: string, field?: string): string {
  if (!_perms) return 'ro';                         // fail-closed to read-only until loaded
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
    // Cache the TOTP secret whenever the account has one — during testing a user can have a
    // working authenticator while mfa_enabled is still False. Needed for offline real-code MFA
    // and offline password reset.
    try { secret = (await api('/auth/mfa/secret')).secret; } catch {}
    let testing = false, testMfa = true;
    try { const pc = await publicConfig(); testing = !!pc.testing_mode; testMfa = pc.test_mfa !== false; } catch {}   // mirror the server's testing MFA rule offline
    const salt = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    await SecureStore.setItem(offKey(username), JSON.stringify({
      username, salt, pwHash: sha1Hex(salt + password), secret,
      role: me.role, name: me.name, licence: me.licence ?? null, mfa_enabled: !!me.mfa_enabled, testing, test_mfa: testMfa,
      clearance: !!me.clearance_authorized, perms: _perms, token, at: Date.now(),
    }));
  } catch { /* best-effort */ }
}

const TEST_MFA_CODE = '123456';   // mirrors backend mfa.TEST_MFA_CODE (accepted while testing_mode is on)

// Stable per-install device id for the login/audit log — generated once, kept in the Keychain.
// Web browsers get a 'web-' prefix: they are sessions, not iPads — the server logs them for audit
// but does NOT enter them in the device registry (no self-registration/approval noise).
export async function deviceId(): Promise<string> {
  const { Platform } = require('react-native');
  const prefix = Platform.OS === 'web' ? 'web-' : 'ipad-';
  let id = await SecureStore.getItem('device_id');
  if (!id || (Platform.OS === 'web' && !id.startsWith('web-'))) {   // migrate old web ids
    id = prefix + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    await SecureStore.setItem('device_id', id);
  }
  return id;
}

// Offline login/logout events queue locally and flush to /auth/event once back online.
async function queueAuthEvent(kind: 'login' | 'logout', mfa?: string) {
  try {
    const raw = await SecureStore.getItem('auth_events');
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ kind, mode: 'offline', at: new Date().toISOString(), device_id: await deviceId(), ...(mfa ? { mfa } : {}) });
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

// One-time reclaim of the old, over-eager certificate-format CRS caches (defcrs_*) that could
// fill web localStorage. Web only (native SecureStore/SQLite isn't key-enumerable); runs once.
function cleanupStaleCaches() {
  try {
    const { Platform } = require('react-native');
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (window.localStorage.getItem('_cache_v2') === '1') return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('defcrs_')) window.localStorage.removeItem(k);
    window.localStorage.setItem('_cache_v2', '1');
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
  _cacheToken(json.access_token);
  _role = json.role ?? null;
  _username = username;
  _clearanceAuthorized = !!json.clearance_authorized;
  try { const me = await api('/auth/me'); _name = me.name ?? null; _licence = me.licence ?? null; } catch {}   // name + licence for header / sign forms
  await loadPermissions();
  cacheOfflineCred(username, password, json.access_token).catch(() => {});
  cleanupStaleCaches();                            // reclaim storage from old certificate-format CRS caches (once)
  flushAuthEvents().catch(() => {});               // report any offline logins now we're online
  syncPasswordResets().catch(() => {});            // propagate any queued offline password reset
  flushFeedback().catch(() => {});                 // send any feedback queued while offline
  prefetchOfflineFlights().catch(() => {});        // warm the offline Leon cache (all tails) for the next 72 h
  prefetchLogbooks().catch(() => {});              // warm the standard HIL/Cabin forms + completed-checks list (all tails)
  prefetchLastFuel().catch(() => {});              // warm previous-leg landing fuel (all tails, last 3 days)
  prefetchHelp().catch(() => {});                  // warm the offline User Guide + FAQ cache
  myFeedback().catch(() => {});                    // warm this user's feedback + replies for offline
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

// Warm the offline cache of the standard HIL / Cabin Defect Log forms, checks and sign-offs for
// the CURRENT tail. Best-effort, sequential, fire-and-forget.
export async function prefetchLogbooks(reg?: string): Promise<void> {
  const r = reg || currentAircraft()?.registration;
  if (!r) return;                                   // CURRENT tail only — warming all ~10 tails saturated the network
  await aircraftConfig(r).catch(() => {});          // fuel tanks/limits for offline Departure
  await aircraftUtilisation(r).catch(() => {});     // last-known TSN/CSN
  await hilHtml(r).catch(() => {});
  await cabinLogHtml(r).catch(() => {});
  await listClearedCabin(r).catch(() => {});        // closed cabin history — cabin crew review it offline
  await listActiveDefects(r).catch(() => {});
  await listHIL(r).catch(() => {});
  await listChecks(r).catch(() => {});              // check-record HTML caches lazily on view (avoids a request burst)
  await signoffsRecent(31, r).catch(() => {});      // Flight Sign Off list + sector Tech-Log/CRS docs for this tail
}

// Offline login: verify the password (cached verifier) and MFA code (cached TOTP
// secret) locally, then restore the cached session. Used only when the server is
// unreachable; the user must have logged in online at least once on this device.
export async function loginOffline(username: string, password: string, otp?: string) {
  const raw = await SecureStore.getItem(offKey(username));
  if (!raw) throw new Error('Offline: no saved session for this user — log in once online first.');
  const c = JSON.parse(raw);
  if (sha1Hex(c.salt + password) !== c.pwHash) throw new Error('Invalid username or password (offline).');
  // Mirror the server: MFA is required when the user has it enabled OR testing_mode is on,
  // and the test code 123456 is accepted while testing (real TOTP always is).
  let mfaMethod = 'none';
  if (c.mfa_enabled || c.testing || c.secret) {   // require MFA offline whenever the account has an authenticator
    if (!otp) throw new MfaRequired();
    const code = otp.trim();
    const testingBypass = c.testing && c.test_mfa !== false && code === TEST_MFA_CODE;   // honours the admin 123456 kill-switch offline
    const realOk = !!c.secret && verifyTotp(c.secret, code);
    if (!testingBypass && !realOk) throw new Error('Invalid MFA code (offline).');
    mfaMethod = testingBypass ? 'test_code' : 'authenticator';   // audited when the offline login syncs
  }
  await SecureStore.setItem('token', c.token || '');
  _role = c.role ?? null;
  _username = username;
  _name = c.name ?? null;
  _licence = c.licence ?? null;
  _clearanceAuthorized = !!c.clearance;
  _perms = c.perms ?? _perms;
  queueAuthEvent('login', mfaMethod).catch(() => {});   // recorded to the server (incl. 123456 use) when next online
  return { access_token: c.token, role: c.role, offline: true };
}

export const requestOtp = (username: string) =>
  fetch(`${BASE}/auth/otp/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  }).then((r) => r.json());

// ── Offline password reset (self-service, via authenticator) ────────────────────
// A crew member who forgot their password but has their authenticator can reset it
// with NO connectivity: we verify a live TOTP against the secret cached in the Keychain
// at their last online sign-in, rewrite the local password verifier so they can sign in
// and e-sign immediately, and queue the change. Once online it propagates to the server
// (authenticated by a fresh authenticator code). Only works on a device where the user
// has signed in online at least once; requires a REAL code (never the 123456 test code).
const PW_RESET_KEY = 'pw_reset_pending';

export async function offlineResetPassword(username: string, otp: string, newPassword: string): Promise<{ synced: boolean }> {
  const uname = username.trim();
  if ((newPassword || '').length < 6) throw new Error('New password must be at least 6 characters.');
  const raw = await SecureStore.getItem(offKey(uname));
  if (!raw) throw new Error('Reset with your authenticator needs a prior online sign-in on this iPad. Connect to the internet and use “Forgot password” for an email link.');
  const c = JSON.parse(raw);
  if (!c.secret) throw new Error('This account has no authenticator set up on this iPad. Sign in online once (so your authenticator is cached), then try again — or use an email reset link.');
  if (!verifyTotp(c.secret, (otp || '').trim())) throw new Error('Invalid authenticator code.');   // REAL TOTP only — no 123456 bypass
  c.pwHash = sha1Hex(c.salt + newPassword);                    // so offline sign-in + e-sign work right away
  c.at = Date.now();
  await SecureStore.setItem(offKey(uname), JSON.stringify(c));
  await SecureStore.setItem(PW_RESET_KEY, JSON.stringify({ username: uname, newPassword, at: Date.now() }));
  let synced = false;
  try { synced = await syncPasswordResets(); } catch { /* stays queued */ }
  return { synced };
}

// Propagate a queued offline password reset to the server. Authenticated by a fresh
// TOTP generated from the cached secret (the user already proved possession offline).
export async function syncPasswordResets(): Promise<boolean> {
  const raw = await SecureStore.getItem(PW_RESET_KEY);
  if (!raw) return false;
  const pend = JSON.parse(raw);
  const credRaw = await SecureStore.getItem(offKey(pend.username));
  if (!credRaw) return false;
  const secret = JSON.parse(credRaw).secret;
  if (!secret) return false;
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/reset-with-authenticator`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': await deviceId() },
      body: JSON.stringify({ username: pend.username, otp: generateTotp(secret), new_password: pend.newPassword }),
    });
  } catch { return false; }                          // still offline — keep the pending change
  if (res.ok) { await SecureStore.deleteItem(PW_RESET_KEY); return true; }
  return false;                                      // transient server rejection (e.g. clock drift) — retry next sync
}

export const hasPendingPasswordReset = () => SecureStore.getItem(PW_RESET_KEY).then((v) => !!v).catch(() => false);

export const mfaSetup = (): Promise<{ secret: string; otpauth_uri: string; issuer: string; account: string }> =>
  api('/auth/mfa/setup', { method: 'POST' });
// Verify enrolment; the server returns a full (non-enrol) token — swap it in so the
// just-enrolled user has full access without re-typing their password.
export async function mfaVerify(code: string) {
  const r = await api('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
  if (r?.access_token) { await SecureStore.setItem('token', r.access_token); _cacheToken(r.access_token); await loadPermissions(); }
  return r;
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST', headers: { 'X-Device-Id': await deviceId() } }); }
  catch { await queueAuthEvent('logout'); }        // offline -> report on next online
  await SecureStore.deleteItem('token');
  _role = null;
  _username = null;
  _name = null;
  _licence = null;
  _clearanceAuthorized = false;
  _perms = null;                                   // fail closed until the next user's perms load
}

async function authHeader() {
  const t = await SecureStore.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

let _devIdCache: string | null = null;
async function _devId(): Promise<string> { if (!_devIdCache) _devIdCache = await deviceId(); return _devIdCache; }

let _lastApiOk = 0;   // epoch ms of the last time a request actually reached the server (any status)

async function api(path: string, init: RequestInit = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': await _devId(), ...(await authHeader()), ...(init.headers ?? {}) };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
    _lastApiOk = Date.now();                          // the server responded (even a 4xx means we're online)
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
// Defect lists cache their server result per aircraft (SecureStore + SQLite) so the Defects,
// HIL and — importantly — CLOSED cabin lists survive offline. The local defect outbox only holds
// active items, so closed/cleared history needs its own cache. Offline: cached list, then the
// local outbox as a last resort.
async function cachedList(key: string, fetcher: () => Promise<any[]>, localFilter: (d: any) => boolean, aircraftId: string): Promise<any[]> {
  try {
    const r = await fetcher();
    _cacheSet(key, r).catch(() => {}); setRef(key, r).catch(() => {});
    return r;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const cached = (await _cacheGet<any[]>(key)) ?? (await getRef<any[]>(key)).data;
    if (cached) return cached;
    const { getLocalAircraftDefects } = require('../db/defects');
    const all = await getLocalAircraftDefects(aircraftId).catch(() => [] as any[]);
    return all.filter(localFilter);
  }
}
export const listActiveDefects = (aircraftId: string): Promise<any[]> =>
  cachedList(`defactive_${aircraftId.toUpperCase()}`, () => api(`/defects/active?aircraft_id=${encodeURIComponent(aircraftId)}`),
    (d) => ['open', 'troubleshooting', 'rectified'].includes(d.status), aircraftId);
export const listHIL = (aircraftId: string): Promise<any[]> =>
  cachedList(`defhil_${aircraftId.toUpperCase()}`, () => api(`/defects/hil?aircraft_id=${encodeURIComponent(aircraftId)}`),
    (d) => d.status === 'deferred', aircraftId);
// Cleared (closed) cabin defects — cabin crew can review their rectified/closed items.
export const listClearedCabin = (aircraftId: string): Promise<any[]> =>
  cachedList(`defcabinclosed_${aircraftId.toUpperCase()}`,
    async () => ((await api(`/defects?aircraft_id=${encodeURIComponent(aircraftId)}&status_=closed`)) || []).filter((d: any) => d.area === 'cabin'),
    (d) => d.area === 'cabin' && d.status === 'closed', aircraftId);
// Warm the offline defect cache for a tail — the aircraft's active + HIL defects, so the
// mechanic can see and rectify them (and the release check is accurate) with no signal.
export async function prefetchAircraftDefects(reg: string): Promise<void> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web' || !reg) return;
  try {
    const [active, hil] = await Promise.all([
      api(`/defects/active?aircraft_id=${encodeURIComponent(reg)}`),
      api(`/defects/hil?aircraft_id=${encodeURIComponent(reg)}`),
    ]);
    await require('../db/defects').cacheAircraftDefects(reg, [...(active || []), ...(hil || [])]);
  } catch { /* offline — keep existing cache */ }
}
// Count of items queued locally and not yet synced to the server (for the "pending sync" badge).
export async function pendingSyncCount(): Promise<number> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') return 0;
  try {
    const { db } = require('../db/schema');
    const d = await db();
    const n = async (sql: string) => ((await d.getFirstAsync(sql))?.n ?? 0) as number;
    const [ob, s, df, ch, at] = await Promise.all([
      n('SELECT COUNT(*) AS n FROM outbox'),
      n('SELECT COUNT(*) AS n FROM sectors WHERE dirty = 1'),
      n('SELECT COUNT(*) AS n FROM defects WHERE dirty = 1'),
      n('SELECT COUNT(*) AS n FROM checks WHERE dirty = 1'),
      n('SELECT COUNT(*) AS n FROM attachments WHERE dirty = 1'),
    ]);
    return ob + s + df + ch + at;
  } catch { return 0; }
}
// Mechanic actions (new / cleared defects) awaiting the commander's read-and-accept.
export const pendingAckDefects = (aircraftId: string): Promise<any[]> =>
  api(`/defects/pending-ack?aircraft_id=${encodeURIComponent(aircraftId)}`);
export const ackDefect = (defectId: string): Promise<{ acknowledged: boolean; ack_by?: string }> =>
  api(`/defects/${defectId}/ack`, { method: 'POST' });

// Next TLB page number (last used + 1). Cached per tail so it's pre-filled offline; always
// editable — the mechanic confirms it against the physical Tech Log Book page.
export async function nextTl(reg: string): Promise<{ next_tl: number }> {
  const key = `nexttl_${(reg ?? '').toUpperCase()}`;
  try {
    const r = await api(`/aircraft/${encodeURIComponent(reg)}/next-tl`);
    if (r && typeof r.next_tl === 'number') setRef(key, r).catch(() => {});
    return r;
  } catch (e) {
    const { data } = await getRef<{ next_tl: number }>(key);   // offline → last known next-TL
    if (data) return data;
    throw e;
  }
}

// Allocate the next TL page number for THIS tail from the cached counter and advance it locally,
// so a sector completed OFFLINE carries its full TL number for the printed Tech Log / CRS. The
// server honours a client-allocated number on sync (bumping only on a genuine collision). Returns
// null when we've never been online for this tail (no cache) — the server then assigns on sync.
export async function allocateTl(reg: string): Promise<number | null> {
  const key = `nexttl_${(reg ?? '').toUpperCase()}`;
  try { await nextTl(reg); } catch { /* offline → use the cached value below */ }
  const { data } = await getRef<{ next_tl: number }>(key);
  if (!data || typeof data.next_tl !== 'number') return null;
  const n = data.next_tl;
  await setRef(key, { next_tl: n + 1 }).catch(() => {});        // advance so the next offline sector increments
  return n;
}

// Release gate: the revision this iPad's channel is approved to run (null = stay on current).
// The actual OTA apply (expo-updates) is wired once EAS + the signed build are in place.
export const appRelease = (device?: string): Promise<{ revision: string | null; runtime_version?: string; force?: boolean; notes?: string; approved_at?: string }> =>
  api(`/app/release${device ? `?device=${encodeURIComponent(device)}` : ''}`);

export type MaintTask = { id: string; registration: string; title: string; description?: string; ata?: string; reference?: string; due_date?: string | null; audience: string; status: string; completed_by_name?: string | null; completed_at?: string | null; completed_note?: string | null; tlb_no?: string | null };
export async function maintTasks(reg: string): Promise<MaintTask[]> {
  const key = `mainttasks_${(reg ?? '').toUpperCase()}`;
  try {
    const t: MaintTask[] = await api(`/maint-tasks?aircraft_id=${encodeURIComponent(reg)}`);
    if (Array.isArray(t)) setRef(key, t).catch(() => {});
    return t;
  } catch (e) {
    const { data } = await getRef<MaintTask[]>(key);     // offline → cached planned tasks
    if (data) return data;
    throw e;
  }
}
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
// Past Leon flights for a tail in a date window (YYYY-MM-DD) — for "List previous flights".
// Live Leon query (online only); returns [] on error so the ETL history still renders.
export async function leonHistory(reg: string, start: string, end: string): Promise<LeonFlight[]> {
  try { return await api(`/leon/history?reg=${encodeURIComponent(reg)}&start=${start}&end=${end}`); }
  catch { return []; }
}

export const signRecord = (payload: {
  kind: string; sector_id?: string; defect_id?: string; signature_image?: string; device_id?: string;
}) => mutateOrQueue('/signatures', { method: 'POST', body: JSON.stringify(payload) });

// Component Change Report (CCR) — rows tied to a defect rectification or a ground maintenance log.
export type CcrRow = { id: string; seq?: number; description?: string; position?: string;
  pn_off?: string; sn_off?: string; pn_on?: string; sn_on?: string; cert_no?: string;
  has_cert_photo?: boolean; created_by?: string; emailed_at?: string | null; emailed_to?: string | null };
const _ccrQs = (s: { defectId?: string; sectorId?: string }) =>
  s.defectId ? `defect_id=${s.defectId}` : `sector_id=${s.sectorId}`;
export const listCcr = (s: { defectId?: string; sectorId?: string }): Promise<{ items: CcrRow[] }> =>
  api(`/component-changes?${_ccrQs(s)}`);
export const createCcr = (body: any) => api('/component-changes', { method: 'POST', body: JSON.stringify(body) });
export const updateCcr = (id: string, body: any) => api(`/component-changes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteCcr = (id: string) => api(`/component-changes/${id}`, { method: 'DELETE' });
export type CcrStockItem = { part_no: string; serial_no: string; batch?: string; condition?: string; serviceable?: boolean; description?: string };
export const ccrInventory = (q: string): Promise<{ items: CcrStockItem[] }> =>
  api(`/component-changes/inventory?q=${encodeURIComponent(q)}`);
export const ccrReport = (s: { defectId?: string; sectorId?: string }): Promise<{ html: string }> =>
  api(`/component-changes/report?${_ccrQs(s)}`);
export const sendCcrReport = (s: { defectId?: string; sectorId?: string }): Promise<{ ok: boolean; sent_to: string[] }> =>
  api(`/component-changes/send?${_ccrQs(s)}`, { method: 'POST' });

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
// Ground maintenance log: which rectified/closed defects THIS TL page claims (mechanic selects).
export type ClosingItem = { id: string; ref?: string; title?: string; description?: string; area: string; status: string; at?: string; selected: boolean };
export const closedDefects = (sectorId: string): Promise<{ items: ClosingItem[] }> => api(`/sectors/${sectorId}/closed-defects`);
export const setClosedDefects = (sectorId: string, ids: string[]) => api(`/sectors/${sectorId}/closed-defects`, { method: 'POST', body: JSON.stringify({ ids }) });

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
// Preview the Tech Log / CRS page a defect rectification will be recorded on, before signing (writes nothing).
// Cached ON VIEW so the VAW-ETL-01 CRS page you opened online re-opens offline. Online always
// fetches fresh (cachedHtml only returns the cache on NetworkError). Key bumped to defcrs2_ so the
// old certificate-format caches (pre-VAW-ETL-01) are ignored.
export const defectCrsPreview = (defectId: string): Promise<{ html: string }> => cachedHtml(`defcrs2_${defectId}`, `/defects/${defectId}/crs-preview`);
// Tech Log / CRS HTML with offline fallback: cache the rendered doc when online so the
// signed record can be opened with no signal. A signed/released sector is immutable.
export async function sectorTlHtmlCached(sectorId: string): Promise<{ html: string; cached?: boolean }> {
  try { const r = await sectorTlHtml(sectorId); if (r?.html) { setRef(`tl_${sectorId}`, r.html).catch(() => {}); _cacheSet(`tl_${sectorId}`, r.html).catch(() => {}); return r; } } catch { /* offline */ }
  const data = (await getRef<string>(`tl_${sectorId}`)).data ?? (await _cacheGet<string>(`tl_${sectorId}`));   // SQLite (native) or localStorage (web)
  if (data) return { html: data, cached: true };
  throw new Error('Offline — this Tech Log has not been cached on this iPad yet.');
}

// Server-rendered HTML that must survive offline in its EXACT standard format (paper HIL /
// Cabin Defect Log, signed check records): cache the last online render (SQLite for capacity +
// SecureStore for web) and return it when the fetch fails. Native SecureStore may reject large
// blobs — that's fine, getRef (SQLite) still has it. Kept fresh on every online view + on login.
// Cache any GET JSON per key (SecureStore + SQLite) and return it offline. For fairly static
// or last-known-good data the crew must still see with no signal (aircraft config, utilisation).
async function cachedJson<T>(key: string, path: string): Promise<T> {
  try { const r = await api(path); _cacheSet(key, r).catch(() => {}); setRef(key, r).catch(() => {}); return r as T; }
  catch (e) {
    const c = (await _cacheGet<T>(key)) ?? (await getRef<T>(key)).data;
    if (c != null) return c as T;
    throw e;
  }
}

async function cachedHtml(key: string, path: string): Promise<{ html: string }> {
  try {
    const r: { html: string } = await api(path);
    _cacheSet(key, r.html).catch(() => {}); setRef(key, r.html).catch(() => {});
    return r;
  } catch (e) {
    const c = (await _cacheGet<string>(key)) ?? (await getRef<string>(key)).data;
    if (c) return { html: c };
    throw e;
  }
}

// Paper Hold Item List / Cabin Defect Log forms (server-rendered) for view + print — cached for offline.
export const hilHtml = (reg: string, clearedDays?: number): Promise<{ html: string }> =>
  cachedHtml(`hilhtml_${reg.toUpperCase()}${clearedDays ? `_c${clearedDays}` : ''}`, `/logbooks/${encodeURIComponent(reg)}/hil${clearedDays ? `?cleared_days=${clearedDays}` : ''}`);
export const cabinLogHtml = (reg: string, clearedDays?: number): Promise<{ html: string }> =>
  cachedHtml(`cabinhtml_${reg.toUpperCase()}${clearedDays ? `_c${clearedDays}` : ''}`, `/logbooks/${encodeURIComponent(reg)}/cabin-log${clearedDays ? `?cleared_days=${clearedDays}` : ''}`);
// Single-item form (one HIL item / one cabin defect) for inline view/print — cached for offline.
export const hilHtmlOne = (defectId: string): Promise<{ html: string }> => cachedHtml(`hilhtml1_${defectId}`, `/logbooks/defect/${defectId}/hil`);
export const cabinLogHtmlOne = (defectId: string): Promise<{ html: string }> => cachedHtml(`cabinhtml1_${defectId}`, `/logbooks/defect/${defectId}/cabin-log`);
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
let _tokCache = '';
SecureStore.getItem('token').then((t) => { if (t) _tokCache = t; }).catch(() => {});
export const _cacheToken = (t: string) => { _tokCache = t; };
export const attachmentUrl = (id: string) => `${BASE}/attachments/${id}?t=${encodeURIComponent(_tokCache)}`;
export const deleteAttachment = (id: string): Promise<{ deleted: boolean }> =>
  api(`/attachments/${id}`, { method: 'DELETE' });

export const addServicing = (body: { sector_id: string; system: string; uplift_lt?: number; depart_lt?: number; arrival_lt?: number; arrival_at?: string }) =>
  mutateOrQueue('/servicing', { method: 'POST', body: JSON.stringify(body) });
export const listServicing = (sectorId: string): Promise<any[]> => api(`/servicing?sector_id=${sectorId}`);

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
  cachedJson(`accfg_${reg.toUpperCase()}`, `/aircraft/${encodeURIComponent(reg)}/config`);   // cached: fuel tanks/limits available offline for Departure

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

export type PrevFuel = { fuel_kg: number | null; source: string | null; flight_no?: string | null; date?: string | null; dep?: string | null; arr?: string | null; continuity_ok?: boolean | null; cached?: boolean;
  etl?: PrevFuel | null; leon?: PrevFuel | null };   // both source candidates, so the crew can compare/choose when they diverge

// Previous-leg landing fuel for the Departure screen. Online: ask the server, which returns BOTH
// the ETL and the Leon Journey Log value. Keeps a per-aircraft, per-source backup on the iPad so
// both remain available offline. The flat top-level fields stay ETL-preferred (backward compatible);
// `.etl` / `.leon` carry each candidate so the screen can prompt the pilot when they differ.
export async function prevFuelCached(sectorId: string, reg: string): Promise<PrevFuel> {
  const nk = _normReg(reg);
  const keyEtl = `lastfuel_etl_${nk}`, keyLeon = `lastfuel_leon_${nk}`;
  let localEtl: PrevFuel | null = null;
  try { const { localPrevFuel } = require('../db/sectors'); localEtl = await localPrevFuel(sectorId); } catch { /* web/no-op */ }
  let srvEtl: PrevFuel | null = null, srvLeon: PrevFuel | null = null;
  try {
    const r: any = await api(`/sectors/${sectorId}/prev-fuel`);          // server returns { ...primary, etl, leon }
    srvEtl = r?.etl?.fuel_kg != null ? r.etl : null;
    srvLeon = r?.leon?.fuel_kg != null ? r.leon : null;
    if (!srvEtl && !srvLeon && r?.fuel_kg != null) {                     // older backend (flat only) → bucket by source
      if (String(r.source || '').toUpperCase().startsWith('ETL')) srvEtl = r; else srvLeon = r;
    }
    if (srvEtl) await setRef(keyEtl, srvEtl).catch(() => {});
    if (srvLeon) await setRef(keyLeon, srvLeon).catch(() => {});
  } catch { /* offline — fall back to caches below */ }
  const etlCache = (await getRef<PrevFuel>(keyEtl).catch(() => ({ data: null }))).data;
  const leonCache = (await getRef<PrevFuel>(keyLeon).catch(() => ({ data: null }))).data;
  const cachedMark = (c: PrevFuel | null): PrevFuel | null =>
    c && c.fuel_kg != null ? { ...c, cached: true, source: `${c.source || 'cached'} · cached` } : null;
  // ETL: the not-yet-synced leg on THIS iPad wins, then the server value, then the cache.
  const etl: PrevFuel | null = (localEtl && localEtl.fuel_kg != null ? localEtl : null) || srvEtl || cachedMark(etlCache);
  const leon: PrevFuel | null = srvLeon || cachedMark(leonCache);
  const primary = etl || leon || { fuel_kg: null, source: null };
  return { ...primary, etl, leon };
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
        const r: any = await api(`/aircraft/${encodeURIComponent(a.registration)}/last-fuel`);   // { ...primary, etl, leon }
        if (r && r.fuel_kg != null) {
          const nk = _normReg(a.registration);
          if (r.etl?.fuel_kg != null) await setRef(`lastfuel_etl_${nk}`, r.etl);
          if (r.leon?.fuel_kg != null) await setRef(`lastfuel_leon_${nk}`, r.leon);
          if (r.etl == null && r.leon == null) {   // older backend (flat only)
            const isEtl = String(r.source || '').toUpperCase().startsWith('ETL');
            await setRef(isEtl ? `lastfuel_etl_${nk}` : `lastfuel_leon_${nk}`, r);
          }
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
  serviceable: boolean; blocking_defects: number; reasons: string[]; checks: CheckStatus[];
  next_tl?: string | null };
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
    // Trial bridge: an OASES-managed check's due-status follows the OASES record — an in-app
    // completion must NOT reset it (else menu pill and server disagree, flip-flopping the banner).
    if ((c as any).oases_managed) return c;
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

// Any screen that fetches a status also feeds subscribers (the header tint), so the
// serviceability shown on different pages can never disagree for the same aircraft.
let _statusListener: ((reg: string, st: AircraftStatus) => void) | null = null;
export function onAircraftStatus(cb: ((reg: string, st: AircraftStatus) => void) | null) { _statusListener = cb; }

export async function aircraftStatus(reg: string): Promise<AircraftStatus> {
  try {
    const st: AircraftStatus = await api(`/aircraft/${encodeURIComponent(reg)}/status`);
    try { await setRef(`status_${_normReg(reg)}`, st); } catch { /* best-effort cache */ }
    const merged = await _mergeLocalChecks(reg, st);
    _statusListener?.(reg, merged);
    return merged;
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
// The 2/10-day check FORM (tasks/sections to fill). Cached per kind+tail so the check can be
// opened and completed offline — completion is already offline-first (queueCheck).
export async function checkTemplate(kind: string, reg?: string): Promise<CheckTemplate> {
  const key = `checktpl_${kind}_${(reg ?? '').toUpperCase()}`;
  try {
    const t: CheckTemplate = await api(`/aircraft/checks/template/${kind}${reg ? `?reg=${encodeURIComponent(reg)}` : ''}`);
    setRef(key, t).catch(() => {});
    return t;
  } catch (e) {
    const { data } = await getRef<CheckTemplate>(key);   // offline → cached form
    if (data) return data;
    throw e;
  }
}
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
  cachedHtml(`checkhtml_${checkId}`, `/aircraft/checks/record/${checkId}/html`);
// An OASES-accomplished 2/10-day check → the Fly2Sky task list marked carried-out (Accomplished in OASES).
export const oasesCheckHtml = (defectId: string): Promise<{ html: string }> =>
  cachedHtml(`oaseschk_${defectId}`, `/aircraft/checks/oases-record/${defectId}/html`);
export const previewCheck = (reg: string, kind: string, body: any): Promise<{ html: string }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/checks/${kind}/preview`, { method: 'POST', body: JSON.stringify(body) });
export type CheckRecord = { id: string; kind: string; completed_at: string; signer_name?: string; licence_no?: string; insp_signer_name?: string; insp_licence_no?: string; tlb_no?: string; data?: any; amendable?: boolean };
// Completed 2/10-day checks — offline-capable. Cache the server list per tail, and merge in any
// checks signed on THIS iPad (the local outbox), so the completed-checks list is available with no
// connectivity. Server list de-duplicates a local check once it has synced (same kind + time).
export async function listChecks(reg: string, days?: number): Promise<CheckRecord[]> {
  const key = `checks_${reg.toUpperCase()}`;
  let server: CheckRecord[] = [];
  try {
    server = await api(`/aircraft/${encodeURIComponent(reg)}/checks${days ? `?days=${days}` : ''}`);
    _cacheSet(key, server).catch(() => {}); setRef(key, server).catch(() => {});
  } catch {
    server = (await _cacheGet<CheckRecord[]>(key)) ?? (await getRef<CheckRecord[]>(key)).data ?? [];
  }
  let local: CheckRecord[] = [];
  try { const { localCheckRecords } = require('../db/checks'); local = await localCheckRecords(reg); } catch { /* web / no SQLite */ }
  const near = (a?: string, b?: string) => !!a && !!b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 120_000;
  const localOnly = local.filter((l) => !server.some((s) => s.kind === l.kind && near(s.completed_at, l.completed_at)));
  return [...localOnly, ...server].sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
}
export const amendCheck = (reg: string, id: string, body: any) =>
  mutateOrQueue(`/aircraft/${encodeURIComponent(reg)}/checks/${id}/amend`, { method: 'POST', body: JSON.stringify(body) });

export type Utilisation = { registration: string; etl: { tsn_fh: number; csn_fc: number };
  camo: { tsn: number | null; csn: number | null } | null; configured: boolean;
  baseline: { tsn_fh: number | null; csn_fc: number | null; source: string | null; at: string | null } | null;
  pending_sectors: number; match: boolean | null; diff_fh: number | null; diff_fc: number | null; error: string | null;
  oases_lag?: { legs: number; fh: number; review: boolean; oases_tsn?: number; oases_csn?: number; at?: string } | null };
export const aircraftUtilisation = (reg: string): Promise<Utilisation> =>
  cachedJson(`util_${reg.toUpperCase()}`, `/aircraft/${encodeURIComponent(reg)}/utilisation`);   // cached: last-known TSN/CSN offline

// Per-aircraft iPads + master designation (sync precedence master → FO → Backup → Cabin).
export type Ipad = { id: string; label: string; role: string; role_label: string; is_master: boolean;
  this_device: boolean; last_sync: string | null; pending_count?: number; online?: boolean; synced?: boolean };
export const listIpads = (reg: string): Promise<{ registration: string; ipads: Ipad[] }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/ipads`);
export const setMaster = (reg: string, deviceId: string, unset = false): Promise<{ master: string | null; label: string }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/master`, { method: 'POST', body: JSON.stringify({ device_id: deviceId, unset }) });
// Master-initiated "sync all iPads": pushes this iPad's outbox, then asks the others to sync on their next heartbeat.
export const syncAllIpads = async (reg: string): Promise<{ registration: string; ipads: Ipad[] }> => {
  await syncPush().catch(() => {});                              // push our own outbox first
  return api(`/aircraft/${encodeURIComponent(reg)}/sync-all`, { method: 'POST', body: '{}' });
};
export const syncAllComplete = (reg: string, body: { synced: number; pending: number; pending_labels: string[]; timed_out?: boolean }): Promise<{ ok: boolean }> =>
  api(`/aircraft/${encodeURIComponent(reg)}/sync-all/complete`, { method: 'POST', body: JSON.stringify(body) });
export type Heartbeat = { you_are_master: boolean; auto_promoted: boolean; master: string | null; master_role: string | null; sync_now?: boolean; window_s: number };
function _appTelemetry() {
  try {
    const Constants = require('expo-constants').default;
    const ex = (Constants.expoConfig as any) || {};
    return { bundle: ex.extra?.commit || '', app_version: ex.version || '' };
  } catch { return { bundle: '', app_version: '' }; }
}
// Liveness ping — also reports the iPad's unsynced-entry count + running version, so the back office
// QA can confirm all crew/cabin/mechanic entries have reached the server.
export async function heartbeat(reg: string): Promise<Heartbeat> {
  let pending = 0;
  try { pending = await pendingSyncCount(); } catch { /* ignore */ }
  return api(`/aircraft/${encodeURIComponent(reg)}/heartbeat`, { method: 'POST', body: JSON.stringify({ pending, ..._appTelemetry() }) });
}
// Report a crash / malfunction / error from this iPad. Best-effort — never throws (it is called from
// the crash handler). The server records the cause and a recommended corrective action for QA.
export async function reportDeviceError(body: { kind?: 'crash' | 'malfunction' | 'error'; message: string; detail?: string; screen?: string; reg?: string }): Promise<void> {
  try {
    const reg = body.reg || currentAircraft()?.registration || undefined;
    await api('/aircraft/device-report', { method: 'POST', body: JSON.stringify({ ...body, reg, ..._appTelemetry() }) });
  } catch { /* best-effort: reporting must never crash the app */ }
}

// Device self-registration / approval state (first-login "aircraft or personal iPad" prompt + pending banner).
export type DeviceSelf = { enabled: boolean; known?: boolean; kind?: 'aircraft' | 'personal' | null;
  approval?: 'approved' | 'pending' | 'rejected'; needs_kind?: boolean; grace_days?: number;
  grace_days_left?: number | null; blocked?: boolean; reason?: string; label?: string };
export const deviceSelf = (): Promise<DeviceSelf> => api('/aircraft/device-self');
export const classifyDevice = (kind: 'aircraft' | 'personal'): Promise<DeviceSelf> =>
  api('/aircraft/device-classify', { method: 'POST', body: JSON.stringify({ kind }) });

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

// Fetch a server-rendered PDF (repeating header + Page N of X) for printing.
// Web → object URL for a new tab; iPad → downloaded to cache for Print.printAsync.
export async function fetchPdfLocal(path: string): Promise<string | null> {
  const t = await SecureStore.getItem('token');
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') {
    const res = await fetch(`${BASE}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('pdf')) return null;
    return URL.createObjectURL(await res.blob());
  }
  const FileSystem = require('expo-file-system/legacy');
  const dest = `${FileSystem.cacheDirectory}tl-print.pdf`;
  const r = await FileSystem.downloadAsync(`${BASE}${path}`, dest, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  return r.status === 200 ? r.uri : null;
}

export const sectorCheckOverride = (sectorId: string): Promise<{ ok: boolean; conditions: string[]; by: string; at: string }> =>
  api(`/sectors/${sectorId}/check-override`, { method: 'POST', body: JSON.stringify({ confirm: true }) });

export const createMaintenance = (body: { aircraft_id: string; station: string; wo_ref?: string; note?: string }): Promise<{ id: string; page_no: number; station: string }> =>
  api('/sectors/maintenance', { method: 'POST', body: JSON.stringify(body) });

export type SignOff = { id: string; kind: string; signer_name?: string; licence_no?: string; signed_at: string;
  registration?: string; sector_id?: string; defect_id?: string; check_id?: string; oases_check?: boolean; category?: string; defects_summary?: string; action_summary?: string; search_text?: string; flight_no?: string; flight_date?: string; dep?: string; arr?: string };

export type ClearedItem = { id: string; ref?: string; ata_chapter?: string; mel_ref?: string; cdl_ref?: string; approved_ref?: string; title?: string;
  description?: string; source?: string; action_taken?: string; closed_by?: string; raised_date?: string; closed_date?: string; registration?: string };
// Cleared (closed) Cabin defects OR cleared HIL items over the sign-off window — with offline cache.
export async function clearedItems(kind: 'cabin' | 'hil', days: number, reg?: string): Promise<{ items: ClearedItem[]; cached?: boolean }> {
  const key = `cleared_${kind}_${(reg || 'ALL').toUpperCase()}`;
  try {
    const r: { items: ClearedItem[] } = await api(`/signoffs/cleared?kind=${kind}&days=${days}${reg ? `&reg=${encodeURIComponent(reg)}` : ''}`);
    setRef(key, r).catch(() => {}); _cacheSet(key, r).catch(() => {});
    return r;
  } catch {
    let { data } = await getRef<{ items: ClearedItem[] }>(key);
    if (!data) data = await _cacheGet<{ items: ClearedItem[] }>(key);
    return data ? { items: data.items, cached: true } : { items: [], cached: true };
  }
}
// Recent sign-offs with offline fallback: cache the list, and warm the Tech Log/CRS
// cache for each signed sector so they can be opened offline too.
export async function signoffsRecent(days: number, reg?: string): Promise<{ days: number; signoffs: SignOff[]; categories?: string[]; cached?: boolean }> {
  const key = `signoffs_${(reg || 'ALL').toUpperCase()}`;   // per-tail cache so switching aircraft offline still works
  const scope = (list: SignOff[]) => reg ? list.filter((g) => (g.registration || '').toUpperCase() === reg.toUpperCase()) : list;
  try {
    const r: { days: number; signoffs: SignOff[]; categories?: string[] } = await api(`/signoffs/recent?days=${days}${reg ? `&reg=${encodeURIComponent(reg)}` : ''}`);
    setRef(key, r).catch(() => {}); setRef('signoffs', r).catch(() => {});   // per-tail + legacy (SQLite/native)
    _cacheSet(key, r).catch(() => {});                                        // localStorage so the web crew app also works offline
    // Do NOT bulk-warm every sign-off's CRS document — the full VAW-ETL-01 pages are ~65 KB each
    // and there can be hundreds (that overflowed storage). CRS docs cache lazily when opened.
    return r;
  } catch {
    let { data } = await getRef<{ days: number; signoffs: SignOff[]; categories?: string[] }>(key);
    if (!data) data = await _cacheGet<{ days: number; signoffs: SignOff[]; categories?: string[] }>(key);   // web localStorage
    if (!data) data = (await getRef<{ days: number; signoffs: SignOff[]; categories?: string[] }>('signoffs')).data;   // fall back to the fleet-wide cache
    return data ? { days: data.days, signoffs: scope(data.signoffs), categories: data.categories, cached: true } : { days, signoffs: [], cached: true };
  }
}

// Cache the public config so OFFLINE it keeps the last-known testing_mode. Without this, an offline
// fetch failure forced testing_mode=false, which hid the testing-only "Switch aircraft" dropdown.
export async function publicConfig(): Promise<{ testing_mode: boolean; test_mfa?: boolean; switch_aircraft?: boolean; trial_banner?: string; trial_login_note?: string }> {
  try {
    const did = await deviceId().catch(() => '');
    const c = await fetch(`${BASE}/auth/config${did ? `?device=${encodeURIComponent(did)}` : ''}`).then((r) => r.json());
    if (c && typeof c.testing_mode === 'boolean') { await _cacheSet('public_config', c); return c; }
    throw new Error('bad config');
  } catch {
    return (await _cacheGet<{ testing_mode: boolean; test_mfa?: boolean; switch_aircraft?: boolean; trial_banner?: string; trial_login_note?: string }>('public_config')) ?? { testing_mode: false };
  }
}

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
  // If a real request reached the server in the last 15 s we're definitely online — skip the
  // probe. This stops the pill flipping to OFFLINE when the network is momentarily saturated
  // (e.g. during "Preparing offline data" or an OTA download) and the light probe times out.
  if (Date.now() - _lastApiOk < 15000) return true;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${BASE}/auth/config`, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) _lastApiOk = Date.now();
    return res.ok;
  } catch { return false; }
}

export const appSettings = (): Promise<{ defect_required_fields: string[]; check_view_days?: number; signoff_view_days?: number; auto_logout_minutes?: number; leon_offline_flights?: number; amm_revision?: string }> =>
  api('/admin/settings');

export const deleteDefect = (id: string, approvedBy: string) =>
  mutateOrQueue(`/defects/${id}?approved_by=${encodeURIComponent(approvedBy)}`, { method: 'DELETE' });

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
    const [{ data: cachedVer }, { data: melCache }, { data: cdlCache }, ammCache] = await Promise.all([
      getRef('refversion'), getRef('mel'), getRef('cdl'),
      ammKey ? getRef(ammKey) : Promise.resolve({ data: null }),
    ]);
    const unchanged = cachedVer && JSON.stringify(cachedVer) === JSON.stringify(ver);
    const refMissing = !melCache || !cdlCache;             // any core reference piece absent (e.g. CDL never cached)
    const ammMissing = !!ammKey && !ammCache.data;         // this tail not cached yet (e.g. switched aircraft)
    if (unchanged && !refMissing && !ammMissing) return;   // nothing to do
    if (!unchanged || refMissing) {                        // version changed OR a core piece missing → re-pull MEL/CDL
      const [mel, cdl] = await Promise.all([
        api('/mel?limit=3000'), api('/cdl?limit=3000'),
      ]);
      await setRef('mel', mel); await setRef('cdl', cdl); await setRef('refversion', ver);
    }
    if (reg) await prefetchAmm(reg);                       // AMM task-card picker offline (per aircraft)
  } catch { /* offline — keep whatever cache we have */ }
}

// Cache the full AMM task-card list + filters for a tail so the picker works offline. Kept
// INDEPENDENT of the MEL/ref-version cache above (a failure there must never leave AMM
// uncached), and also called when the AMM picker itself opens online — so a single online
// open of the picker is enough to make it available offline, regardless of menu-load timing.
export async function prefetchAmm(reg?: string): Promise<number> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web' || !reg) return 0;
  try {
    const r = reg.toUpperCase();
    const ammf = await withTimeout(api(`/mel/amm/filters?reg=${encodeURIComponent(reg)}`), 15000);   // all ATA chapters
    const atas: string[] = (ammf?.ata || []).filter(Boolean);
    let amm: any[] = [];
    if (atas.length) {
      // Fetch per ATA and concatenate: the server caps /mel/amm at 3000 rows, and a tail has ~8250
      // cards, so a single call silently drops ~29 higher chapters. Each ATA has <700 cards, so
      // per-ATA never truncates → the full list (every ATA) is cached offline. Each call is
      // time-boxed so one stalled chapter can't hang the offline-prep bar.
      for (const ata of atas) {
        try {
          const rows = await withTimeout(api(`/mel/amm?reg=${encodeURIComponent(reg)}&ata=${encodeURIComponent(ata)}&limit=3000`), 15000);
          if (Array.isArray(rows)) amm = amm.concat(rows);
        } catch { /* skip this ATA on a blip/stall — retried next run */ }
      }
    } else {
      amm = await withTimeout(api(`/mel/amm?reg=${encodeURIComponent(reg)}&limit=20000`), 20000);     // fallback
    }
    if (Array.isArray(amm) && amm.length) {                // never clobber a good cache with an empty/blip response
      await setRef(`amm:${r}`, amm);
      await setRef(`ammfilters:${r}`, ammf);
      return amm.length;
    }
  } catch { /* offline — keep existing cache */ }
  return 0;
}
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
// Offline strategy (all instructions cached by DEFAULT): each card's HTML is stored per-ref with
// its ORIGINAL figure URLs, and every unique diagram is stored ONCE in a shared figure cache
// (fig:<hash>). At view time offline we assemble the two — so shared diagrams aren't duplicated
// across the ~3000 cards, keeping the whole tail's instructions to ~90 MB instead of ~1 GB.
export type AmmContent = { task_card_ref: string; title?: string; ata?: string; revision?: string; html: string };
const ammViewKey = (reg: string | undefined, ref: string) => `ammcontent:${(reg ?? '').toUpperCase()}:${ref}`;
const ammTextKey = (reg: string | undefined, ref: string) => `ammtext:${(reg ?? '').toUpperCase()}:${ref}`;
const figKey = (url: string) => `fig:${sha1Hex(url)}`;

function ammFigureUrls(html: string): { src: string; abs: string }[] {
  const base = (/(<base href=")([^"]+)"/i.exec(html)?.[2] || '').replace(/\/+$/, '');
  const out: { src: string; abs: string }[] = [];
  const seen = new Set<string>();
  const re = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (src.startsWith('data:') || seen.has(src)) continue;
    seen.add(src);
    out.push({ src, abs: /^https?:\/\//i.test(src) ? src : `${base}/${src.replace(/^\//, '')}` });
  }
  return out;
}

// Download & cache every diagram a card references, once each (shared across cards).
async function cacheAmmFigures(html: string): Promise<void> {
  for (const { abs } of ammFigureUrls(html)) {
    const key = figKey(abs);
    if ((await getRef(key)).data) continue;                        // already cached (shared)
    const uri = await withTimeout(tileToDataUri(abs), 15000).catch(() => null);   // time-boxed so a stalled figure can't hang
    if (uri) await setRef(key, uri).catch(() => {});
  }
}

// Rebuild an offline-ready HTML by swapping each figure URL for its cached data-URI.
async function assembleOfflineAmm(html: string): Promise<string> {
  let out = html;
  for (const { src, abs } of ammFigureUrls(html)) {
    const uri = (await getRef<string>(figKey(abs))).data;
    if (uri) out = out.split(`src="${src}"`).join(`src="${uri}"`);
  }
  return out;
}

const NO_INSTR_HTML = '<div style="padding:22px;font-family:-apple-system,sans-serif;color:#333;line-height:1.55;font-size:15px">No instruction is available for this task card.</div>';

export const ammContent = async (reg: string | undefined, ref: string): Promise<AmmContent> => {
  try {
    const r = await api(`/mel/amm/content?ref=${encodeURIComponent(ref)}${reg ? '&reg=' + encodeURIComponent(reg) : ''}`);
    if (r?.html) setRef(ammTextKey(reg, ref), r).catch(() => {});  // keep text (original fig URLs) for offline
    return r;
  } catch (e) {
    const t: any = (await getRef<any>(ammTextKey(reg, ref))).data;
    if (t?.empty) return { task_card_ref: ref, html: NO_INSTR_HTML };          // cached "no instruction" marker
    if (t?.html) return { ...t, html: await assembleOfflineAmm(t.html) };      // assemble diagrams from shared cache
    const viewed = (await getRef<AmmContent>(ammViewKey(reg, ref))).data;
    if (viewed) return viewed;
    throw e;                                                                   // genuinely not cached yet
  }
};

// Cache ONE card's instruction (text + its figures) for offline. Returns true when the card is
// resolved (cached OR confirmed to have no instruction); throws only on a network/server error so
// the caller can retry. A card with no instruction is marked with an {empty} sentinel so it counts
// as done and never re-fetches.
async function cacheOneAmm(reg: string | undefined, ref: string): Promise<boolean> {
  if ((await getRef(ammTextKey(reg, ref))).data) return true;      // resumable — already resolved
  let r: any;
  try {
    r = await withTimeout(api(`/mel/amm/content?ref=${encodeURIComponent(ref)}${reg ? '&reg=' + encodeURIComponent(reg) : ''}`), 20000);
  } catch (e: any) {
    if (/→ 404/.test(String(e?.message || ''))) { await setRef(ammTextKey(reg, ref), { task_card_ref: ref, empty: true }); return true; }
    throw e;                                                        // network / 5xx → retry on a later pass
  }
  if (!r?.html) { await setRef(ammTextKey(reg, ref), { task_card_ref: ref, empty: true }); return true; }
  await setRef(ammTextKey(reg, ref), r);
  await cacheAmmFigures(r.html);                                    // figures are best-effort (assembled at view)
  return true;
}

// Cache ALL instructions (text + deduped diagrams) for the tail's task cards — the default so a
// mechanic has every reachable instruction offline with no manual step. Progress reflects cards
// ACTUALLY cached (not attempts), and failed fetches are retried across several passes, so the bar
// only reaches 100% once every card is truly stored. Resumable across sessions; stops early (to
// resume later) if a whole pass makes no progress (offline). onProgress(cached, total).
export async function prefetchAllAmm(reg: string | undefined,
                                     onProgress?: (cached: number, total: number) => void): Promise<{ done: number; total: number }> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web' || !reg) return { done: 0, total: 0 };
  const list = (await getRef<any[]>(`amm:${reg.toUpperCase()}`)).data || [];
  const refs = list.map((c) => c.task_card_ref).filter(Boolean);
  const total = refs.length;
  const cached = new Set<string>();
  for (const ref of refs) if ((await getRef(ammTextKey(reg, ref))).data) cached.add(ref);   // seed from disk
  onProgress?.(cached.size, total);
  for (let pass = 0; pass < 6 && cached.size < total; pass++) {
    let progressed = false;
    for (const ref of refs) {
      if (cached.has(ref)) continue;
      try { if (await cacheOneAmm(reg, ref)) { cached.add(ref); progressed = true; onProgress?.(cached.size, total); } }
      catch { /* network — retry next pass */ }
    }
    if (!progressed) break;                                          // offline / stuck → resume next session
  }
  return { done: cached.size, total };
}

// How many of the tail's cards already have their instruction cached offline (list total + cached).
export async function ammInstrProgress(reg: string | undefined): Promise<{ cached: number; total: number }> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web' || !reg) return { cached: 0, total: 0 };
  const list = (await getRef<any[]>(`amm:${reg.toUpperCase()}`)).data || [];
  let cached = 0;
  for (const c of list) { if (c.task_card_ref && (await getRef(ammTextKey(reg, c.task_card_ref))).data) cached++; }
  return { cached, total: list.length };
}

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
  syncPasswordResets().catch(() => {});       // propagate any offline password reset now we're online
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

// Per-role login induction — cover email + role PPTX (slide images), shown once per user.
export type Induction = { role: string; version: number; email_subject?: string; email_body?: string; slides: string[] };
export async function pendingInduction(): Promise<Induction | null> {
  const ackedVer = await _cacheGet<number>('induction_acked');
  try {
    const r = await api('/induction/pending');
    if (r && r.role) { await _cacheSet('induction', r); return r; }   // server says: still owed
    await _cacheSet('induction', null);   // server says acknowledged/none — clear the stale cache so a
    return null;                          // later offline/blip fallback can NEVER resurrect an old deck
  } catch {
    // Offline → last cached, but only if NEWER than what was acknowledged (an equal/older cached
    // version after an ack must never re-show — that caused the repeat welcome on every page).
    const cached = await _cacheGet<Induction>('induction');
    return cached && Number(cached.version || 0) > Number(ackedVer || 0) ? cached : null;
  }
}
// Whether this role has a Welcome & Quick Reference at all (admin/CAMO don't) — the menu hides the
// tile when false. Offline: treat a previously-cached induction as "exists".
export async function inductionExists(): Promise<boolean> {
  try { const r = await api('/induction/exists'); return !!r?.exists; }
  catch { return !!((await _cacheGet<Induction>('induction_view')) || (await _cacheGet<Induction>('induction'))); }
}
export async function viewInduction(role?: string): Promise<Induction | null> {   // re-view on demand (ignores ack); admin/CAMO may preview any role
  const key = role ? `induction_view_${role}` : 'induction_view';
  try {
    const r = await api(`/induction/view${role ? `?role=${encodeURIComponent(role)}` : ''}`);
    if (r && r.role) { await _cacheSet(key, r); return r; }
    return null;
  } catch { return (await _cacheGet<Induction>(key)) || (role ? null : (await _cacheGet<Induction>('induction'))) || null; }
}
export async function ackInduction(version: number): Promise<void> {
  // Only ever RAISE the local acked marker (acking a stale re-shown deck must not lower it),
  // and drop the cached deck so the offline fallback can't re-show what was just acknowledged.
  const prev = Number((await _cacheGet<number>('induction_acked')) || 0);
  await _cacheSet('induction_acked', Math.max(prev, Number(version) || 0));
  await _cacheSet('induction', null);
  try { await api('/induction/ack', { method: 'POST', body: JSON.stringify({ version }) }); }
  catch {
    const q = (await _cacheGet<number[]>('induction_ack_queue')) || [];
    if (!q.includes(version)) { q.push(version); await _cacheSet('induction_ack_queue', q); }
  }
}
export async function flushInductionAcks(): Promise<void> {
  const q = (await _cacheGet<number[]>('induction_ack_queue')) || [];
  if (!q.length) return;
  const left: number[] = [];
  for (const v of q) { try { await api('/induction/ack', { method: 'POST', body: JSON.stringify({ version: v }) }); } catch { left.push(v); } }
  await _cacheSet('induction_ack_queue', left);
}

// Admin broadcasts — targeted pop-ups shown after login AND to already-active sessions (polled).
// Offline-aware: the pending list is cached so it still pops up with no signal, and an ack made
// offline is recorded locally (never re-shows) and queued to post when back online.
export type Broadcast = { id: string; title: string; body: string; severity: string; created_at: string; from?: string };

async function _bcastSeen(): Promise<Set<string>> { return new Set((await _cacheGet<string[]>('bcast_seen')) || []); }
async function _addBcastSeen(id: string) { const s = await _bcastSeen(); s.add(id); await _cacheSet('bcast_seen', [...s]); }

export async function pendingBroadcasts(reg?: string): Promise<Broadcast[]> {
  try {
    const r: Broadcast[] = await api(`/broadcasts/pending${reg ? `?reg=${encodeURIComponent(reg)}` : ''}`);
    await _cacheSet('bcast_pending', r);                       // cache so they still pop up offline
    // The server already excludes acknowledged ones, so anything it returns is un-acked for this
    // user — including a RESENT broadcast. Clear those from the local "seen" set so the resend
    // overrides the on-device suppression. Only queued (offline, unsynced) acks stay suppressed.
    const seen = await _bcastSeen();
    let changed = false;
    for (const b of r) if (seen.delete(b.id)) changed = true;
    if (changed) await _cacheSet('bcast_seen', [...seen]);
    const queued = new Set((await _cacheGet<string[]>('bcast_ack_queue')) || []);
    return r.filter((b) => !queued.has(b.id));
  } catch {
    const cached = (await _cacheGet<Broadcast[]>('bcast_pending')) || [];
    const seen = await _bcastSeen();
    return cached.filter((b) => !seen.has(b.id));             // offline → last cached, minus locally-acked
  }
}

export async function ackBroadcast(id: string): Promise<void> {
  await _addBcastSeen(id);                                     // never re-show, even offline
  try { await api(`/broadcasts/${id}/ack`, { method: 'POST' }); }
  catch {                                                      // offline → queue the ack for later
    const q = (await _cacheGet<string[]>('bcast_ack_queue')) || [];
    if (!q.includes(id)) { q.push(id); await _cacheSet('bcast_ack_queue', q); }
  }
}

export async function flushBroadcastAcks(): Promise<void> {
  const q = (await _cacheGet<string[]>('bcast_ack_queue')) || [];
  if (!q.length) return;
  const left: string[] = [];
  for (const id of q) { try { await api(`/broadcasts/${id}/ack`, { method: 'POST' }); } catch { left.push(id); } }
  await _cacheSet('bcast_ack_queue', left);
}

export type MyFeedback = { id: string; category: string; message: string; status: string; created_at: string; reply?: string | null; reply_by?: string | null; reply_at?: string | null };
// Per-user offline cache: the signed-in user's own feedback + replies survive offline,
// keyed by login ID so a shared iPad never shows one user's feedback to another.
export async function myFeedback(): Promise<MyFeedback[]> {
  const key = `feedback_mine_${_username || 'anon'}`;
  try {
    const rows = await api('/feedback/mine') as MyFeedback[];
    await _cacheSet(key, rows);
    return rows;
  } catch (e) {
    if (e instanceof NetworkError) return (await _cacheGet<MyFeedback[]>(key)) || [];
    throw e;
  }
}

// Read-only Tech Log page (what goes to OASES) + matching Leon flight-watch — crew review after close.
export const techlogPage = (sectorId: string): Promise<any> => api(`/sectors/${sectorId}/techlog-page`);

export const authMe = (): Promise<{ id: string; username: string; name?: string; role: string; email?: string }> => api('/auth/me');
export type FeedbackIn = { message: string; category: string; screen?: string; contact_email?: string; email_copy?: boolean; destination?: string };
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

// Orchestrate every "download for offline" job as ordered, labelled steps so the Main Menu can
// show a single progress bar and a clear "ready for offline" state. Each step is best-effort;
// a failure advances the bar rather than blocking. Does NOT fetch AMM instructions (opt-in via
// the picker's "Save these for offline"). onProgress(fraction 0..1, label).
// Cap a promise so a stalled network request can never freeze the caller (a fetch with no signal
// otherwise waits forever). On timeout it rejects; the dangling request resolves later harmlessly.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

export async function prepareOffline(reg: string | undefined,
                                     onProgress: (frac: number, label: string) => void): Promise<void> {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') { onProgress(1, 'Online'); return; }
  const steps: { label: string; ms: number; run: () => Promise<any> }[] = [
    { label: 'Maintenance reference (MEL, CDL, task cards, AMM)', ms: 45000, run: () => refreshReference() },
    { label: 'Flight schedule (next 72 h)', ms: 20000, run: () => prefetchOfflineFlights() },
    { label: 'Aircraft defects & HIL', ms: 15000, run: () => (reg ? prefetchAircraftDefects(reg) : Promise.resolve()) },
    { label: '2/10-day check forms & planned tasks', ms: 20000, run: async () => {
      if (!reg) return;
      await Promise.all([
        checkTemplate('2day', reg).catch(() => {}),
        checkTemplate('10day', reg).catch(() => {}),
        maintTasks(reg).catch(() => {}),
        nextTl(reg).catch(() => {}),
      ]);
    } },
    { label: 'HIL, Cabin, sign-offs & fuel config', ms: 25000, run: () => (reg ? prefetchLogbooks(reg) : Promise.resolve()) },
    { label: 'Previous-leg fuel', ms: 15000, run: () => prefetchLastFuel() },
    { label: 'User guide & assistant', ms: 20000, run: () => prefetchHelp() },
    { label: 'Route maps', ms: 30000, run: async () => { const f = reg ? await leonFlights(reg).catch(() => [] as LeonFlight[]) : []; await cacheRouteMaps(f); } },
  ];
  for (let i = 0; i < steps.length; i++) {
    onProgress(i / steps.length, steps[i].label);
    // Best-effort AND time-boxed per step, so one stalled request (common on the flaky offline→online
    // moment) advances the bar quickly instead of freezing it. Whatever didn't finish is re-tried
    // next session (all steps are resumable / skip-cached).
    try { await withTimeout(steps[i].run(), steps[i].ms); } catch { /* skip — keep going */ }
    onProgress((i + 1) / steps.length, steps[i].label);
  }
  onProgress(1, 'Ready for offline');
}
