// EFF api client — same-origin (/eff-api) on web; on native (ETL app) it targets the absolute
// ETL origin. Token + caches live in ETL's native storage layer via ./storage (SecureStore +
// SQLite ref_cache) instead of the web trial's localStorage/IndexedDB — OTA-safe, works offline.
import { Platform } from 'react-native';
import { blobGet, blobSet, isOnline, isOnlineSync, jsonGet, jsonSet, kvDel, kvGet, kvSet } from './storage';
// Raw ETL SecureStore (UNPREFIXED keys) — the ETL app keeps its own bearer under 'token'. This is
// deliberately NOT the eff: adapter above (which namespaces every key) so we read ETL's real token.
import * as ETLSecureStore from '../api/secureStore';

const BASE = Platform.OS === 'web' ? '/eff-api' : 'https://etl.avora.aero/eff-api';

// In-memory mirrors: several accessors below (currentToken, getEtlToken, pendingCount,
// getRequiredFields) are read synchronously during render, but the native store (SecureStore)
// is async. hydrate() loads them once at module start; setters update memory first, persist async.
let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
  // web→native: localStorage(eff_token) → SecureStore via kvSet/kvDel('token')
  if (t) kvSet('token', t); else kvDel('token');
  if (!t) setEtlToken(null);                          // sign-out / session expiry drops the ETL hand-off token too
}
// loadToken is now async (SecureStore) — the host awaits it on mount to pick the first screen.
export async function loadToken(): Promise<string | null> {
  try { token = await kvGet('token'); } catch {}
  return token;
}
export function currentToken(): string | null { return token; }

// Hydrate every sync mirror from the native store. Called once by the host before first render.
let _hydrated = false;
export async function hydrate(): Promise<void> {
  if (_hydrated) return;
  _hydrated = true;
  try {
    token = await kvGet('token');
    etlToken = await kvGet('etl_token');
    requiredMem = await jsonGet<Record<string, string[]>>(REQUIRED_KEY);
    outboxMem = (await jsonGet<any[]>(OUTBOX_KEY)) || [];
    helpMem = (await jsonGet<{ pages: GuidePage[]; faq: FaqItem[] }>(HELP_CACHE)) || { pages: [], faq: [] };
  } catch {}
}

// ---------- ETL cross-app -------------------------------------------------------------------
// The EFF login delegates to the ETL API, which returns the user's OWN ETL bearer token
// (etl_token). Kept for the "ETL" rail item (SSO hand-off) and the Overview aircraft-status
// card. On native the ETL crew-app URL for the hand-off comes from the server (/config →
// etl_app_url, admin-configurable); origins are not baked into the bundle.
const ETL_API = Platform.OS === 'web' ? '/api' : 'https://etl.avora.aero/api';

let _etlAppUrl = '';
export function setEtlAppUrl(u: string) { if (u) _etlAppUrl = u.replace(/\/+$/, ''); }
export function etlAppUrl(): string { return _etlAppUrl; }

let etlToken: string | null = null;              // in-memory mirror (read sync in render)
export function setEtlToken(t: string | null) {
  etlToken = t;
  // web→native: localStorage(eff_etl_token) → SecureStore via kvSet/kvDel('etl_token')
  if (t) kvSet('etl_token', t); else kvDel('etl_token');
}
export function getEtlToken(): string | null { return etlToken; }

// Live aircraft status + blocking defects + HIL from the ETL API, cached per reg for 5 min
// (in memory — a fresh flight open within the window reuses it, a reload refetches).
const _etlCache: Record<string, { at: number; data: EtlStatusBundle }> = {};
export type EtlStatusBundle = { status: any; defects: any[]; hil: any[] };
export async function etlAircraftStatus(reg: string): Promise<EtlStatusBundle> {
  const key = (reg || '').toUpperCase();
  const hit = _etlCache[key];
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const tok = getEtlToken();
  if (!tok) throw new Error('No ETL session token — sign out and in again');
  const get = async (path: string) => {
    const r = await fetch(`${ETL_API}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`ETL ${r.status}`);
    return r.json();
  };
  const enc = encodeURIComponent(reg);
  const [status, defects, hil] = await Promise.all([
    get(`/aircraft/${enc}/status`),
    get(`/defects/active?aircraft_id=${enc}`),
    get(`/defects/hil?aircraft_id=${enc}`),
  ]);
  const data = { status, defects, hil };
  _etlCache[key] = { at: Date.now(), data };
  return data;
}

// ---------- Offline layer -------------------------------------------------------------------
// GETs cache to the native store (large document payloads go to the SQLite blob store) so the
// folder keeps working with no connectivity; mutations that fail to REACH the server queue in an
// outbox and flush when the connection returns. Server rejections (4xx) are NOT queued.
const OUTBOX_KEY = 'eff_outbox';

let outboxMem: any[] = [];                        // in-memory mirror (read sync by pendingCount)
function outbox(): { path: string; method: string; body?: string; ts: number }[] { return outboxMem; }
function setOutbox(q: any[]) { outboxMem = q; jsonSet(OUTBOX_KEY, q); }  // web→native: localStorage → SecureStore
export function pendingCount() { return outboxMem.length; }

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  // Never flush without a session: a request sent with no token 401s, and a 401 is treated as
  // terminal below — which would DROP data the crew entered offline then signed out. Hold the
  // queue until a signed-in session flushes it (so offline entries always reach the server → ETL).
  if (!token) return;
  flushing = true;
  try {
    let q = outbox();
    while (q.length) {
      const it = q[0];
      try {
        const r = await fetch(`${BASE}${it.path}`, { method: it.method, body: it.body,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
        if (r.status === 401) return;                   // session expired — keep the queue, retry after re-login
        if (!r.ok && r.status >= 500) return;           // server trouble — retry later
      } catch { return; }                               // still offline — retry later
      q = q.slice(1); setOutbox(q);                     // 2xx/4xx(non-401) leave the queue (terminal)
    }
  } finally { flushing = false; }
}

// web→native: the web trial auto-flushed via window 'online' + setInterval(navigator.onLine).
// Native has no window; the host starts/stops this loop on mount so nothing runs at app boot.
let _flushTimer: any = null;
export function startAutoFlush() {
  if (_flushTimer) return;
  if (Platform.OS === 'web') { try { window.addEventListener('online', () => { flushOutbox(); }); } catch {} }
  _flushTimer = setInterval(() => { isOnline().then((on) => { if (on) flushOutbox(); }); }, 20000);
}
export function stopAutoFlush() { if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; } }

export async function api(path: string, init?: RequestInit, _retry = true): Promise<any> {
  const method = (init?.method || 'GET').toUpperCase();
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
    });
  } catch (e) {
    // Never reached the server. GET → serve the cached copy; mutation → queue for later.
    if (method === 'GET') {
      const c = await jsonGet<any>('c:' + path);        // web→native: localStorage('effc:'+path) → jsonGet
      if (c) return c;
      throw new Error('Offline — this page has not been cached yet');
    }
    setOutbox([...outbox(), { path, method, body: init?.body as string, ts: Date.now() }]);
    return { queued: true };
  }
  if (r.status === 401) {
    // The EFF token expired. The user's ETL session usually hasn't, so silently re-mint a fresh EFF
    // token from it and retry once — no bogus "Session expired" while the ETL login is still good.
    // Only if the re-exchange also fails (ETL token itself gone/expired) do we surface the expiry.
    if (_retry) {
      const ex = await sessionFromEtl();
      if (ex.ok && ex.reason !== 'offline') return api(path, init, false);
    }
    setToken(null);
    throw new Error('Session expired — sign in again');
  }
  if (!r.ok) throw new Error((await r.text()).slice(0, 300) || `${r.status}`);
  const data = await r.json();
  if (method === 'GET') {
    jsonSet('c:' + path, data);                         // web→native: localStorage → jsonGet/Set (docs go to blob below)
    flushOutbox();
  }
  return data;
}

// Document blob store (PDFs are megabytes) — web→native: IndexedDB('eff'/docs) → SQLite blob
// store (blobGet/blobSet in ./storage). Keyed by docId; the object is JSON-encoded into the blob.
async function docPut(docId: string, val: any) { try { await blobSet(docId, JSON.stringify(val)); } catch {} }
async function docGet(docId: string): Promise<any> {
  try { const s = await blobGet(docId); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function purgeCaches(_validFlightIds: string[]) {
  // web→native: the web trial pruned IndexedDB/localStorage keys by cursor/regex. The native
  // store (SecureStore keys aren't enumerable; ref_cache enumeration isn't exposed by the
  // adapter) has no equivalent primitive, so retention is left to the server /flights window.
  // No-op here (see M3 for a native ref_cache prune).
}

export const login = async (username: string, password: string, otp?: string) => {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, otp }) });
  setEtlToken(r?.etl_token ?? null);                  // the user's own ETL bearer — see ETL cross-app above
  return r;
};

// M3 auth reuse — mint an EFF session from the pilot's EXISTING ETL login so the crew never type a
// second password. Sends the ETL bearer (read from ETL's own unprefixed SecureStore key 'token') to
// the new POST /eff-api/auth/session, which is flight-crew only and returns an EFF access_token.
// The host maps each failure reason to UX: 'forbidden' (403, not crew) → short message; 'offline'/
// 'error'/'no-etl-token' → fall back to the manual EFF LoginScreen (never a hard block).
// Flat shape (not a discriminated union) so the host can read reason/user without narrowing.
export type SessionExchange = { ok: boolean; reason?: 'no-etl-token' | 'forbidden' | 'offline' | 'error'; user?: any; message?: string };
export async function sessionFromEtl(): Promise<SessionExchange> {
  let etl: string | null = null;
  try { etl = await ETLSecureStore.getItem('token'); } catch {}
  if (!etl) return { ok: false, reason: 'no-etl-token' };
  let r: Response;
  try {
    r = await fetch(`${BASE}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${etl}` },
      body: JSON.stringify({ etl_token: etl }),
    });
  } catch {
    // Offline. We already confirmed a valid ETL session exists (the `etl` token is present above), so
    // do NOT force a second login — proceed into the Folder on cached data. A fresh EFF token is minted
    // on the next online open. This is what makes the Flight Folder usable with no connectivity.
    setEtlToken(etl);
    return { ok: true, reason: 'offline' };
  }
  if (r.status === 403) return { ok: false, reason: 'forbidden', message: (await r.text().catch(() => '')).slice(0, 200) };
  if (!r.ok) return { ok: false, reason: 'error', message: `${r.status}` };
  const data = await r.json().catch(() => null);
  if (!data?.access_token) return { ok: false, reason: 'error' };
  setToken(data.access_token);                         // store as the EFF token (kvSet('token', …))
  setEtlToken(data.etl_token ?? etl);                  // stash the ETL bearer for Overview status + ETL rail
  return { ok: true, user: data.user };
}
// Admin-controlled "required before signing" map ({section: [field keys]}), delivered by
// /config and cached so the signing gate keeps working with no connectivity.
const REQUIRED_KEY = 'eff_required_fields';
let requiredMem: Record<string, string[]> | null = null;   // in-memory mirror (read sync in render)
export function setRequiredFields(m: any) {
  if (!m || typeof m !== 'object') return;
  requiredMem = m;
  jsonSet(REQUIRED_KEY, m);                            // web→native: localStorage → SecureStore
}
export function getRequiredFields(): Record<string, string[]> | null {
  return requiredMem && typeof requiredMem === 'object' ? requiredMem : null;
}

export const listFlights = async () => {
  const rows = await api('/flights');
  if (!_etlAppUrl) api('/config').then((c) => {
    setEtlAppUrl(c?.etl_app_url || '');
    setRequiredFields(c?.required_fields);
  }).catch(() => {});
  return rows;
};
export const getFolder = (id: string) => api(`/flights/${id}/folder`);
export const wxRefresh = (id: string) => api(`/flights/${id}/wx-refresh`, { method: 'POST' });
export const getNavlog = (id: string) => api(`/flights/${id}/navlog`);
export const saveNavEntry = (id: string, idx: number, body: any) =>
  api(`/flights/${id}/navlog/${idx}`, { method: 'POST', body: JSON.stringify(body) });
export const acceptFolder = (id: string, signature_image: string) =>
  api(`/flights/${id}/accept`, { method: 'POST', body: JSON.stringify({ signature_image }) });
export const acceptFolder2 = (id: string, signature_image: string, kind: string) =>
  api(`/flights/${id}/accept`, { method: 'POST', body: JSON.stringify({ signature_image, kind }) });
export const saveReport = (id: string, section: string, data: any) =>
  api(`/flights/${id}/report`, { method: 'PUT', body: JSON.stringify({ section, data }) });
export const uploadDoc = (id: string, body: any) =>
  api(`/flights/${id}/upload`, { method: 'POST', body: JSON.stringify(body) });
export async function getDoc(id: string, docId: string): Promise<any> {
  try {
    const d = await api(`/flights/${id}/doc/${docId}`);   // api() JSON-caches; docs go to the blob store
    (d as any)._flightId = id;
    kvDel('c:' + `/flights/${id}/doc/${docId}`);          // web→native: drop the small-store copy, keep the blob
    docPut(docId, d);
    return d;
  } catch (e) {
    const c = await docGet(docId);
    if (c) return c;
    throw e;
  }
}
// Prefetch a folder's documents into the blob store while online (offline briefing guarantee).
export async function prefetchDocs(id: string, docs: { id: string }[]) {
  for (const doc of docs) {
    if (await docGet(doc.id)) continue;
    try { const d = await api(`/flights/${id}/doc/${doc.id}`); kvDel('c:' + `/flights/${id}/doc/${doc.id}`); docPut(doc.id, d); } catch { return; }
  }
}
export const deleteDoc = (id: string, docId: string) => api(`/flights/${id}/doc/${docId}`, { method: 'DELETE' });

// ---------- Help: User Guide, AI Assistant, pilot induction --------------------------------
// Guide + FAQ are cached (native store) so the Help page works offline; the assistant falls back
// to the cached FAQ when there is no connectivity.
export type GuidePage = { slug: string; title: string; body_markdown: string; order: number };
export type FaqItem = { q: string; a: string };
export type AssistantReply = { answer: string; sources: { slug: string; title: string; snippet: string }[]; mode: string };
const HELP_CACHE = 'eff_help_cache';
let helpMem: { pages: GuidePage[]; faq: FaqItem[] } = { pages: [], faq: [] };  // in-memory mirror

function readHelpCache(): { pages: GuidePage[]; faq: FaqItem[] } {
  return { pages: helpMem.pages || [], faq: helpMem.faq || [] };
}
function writeHelpCache(patch: { pages?: GuidePage[]; faq?: FaqItem[] }) {
  helpMem = { ...readHelpCache(), ...patch };
  jsonSet(HELP_CACHE, helpMem);                         // web→native: localStorage → SecureStore
}

export async function helpGuide(): Promise<GuidePage[]> {
  try { const r = await api('/help/guide'); const pages = (r?.pages || []) as GuidePage[]; writeHelpCache({ pages }); return pages; }
  catch { return readHelpCache().pages; }
}
export async function helpFaq(): Promise<FaqItem[]> {
  try { const r = await api('/help/faq'); const faq = (r?.faq || []) as FaqItem[]; writeHelpCache({ faq }); return faq; }
  catch { return readHelpCache().faq; }
}

// On-device fallback when offline: same token-overlap FAQ match the server does.
function offlineAnswer(question: string): AssistantReply {
  const tok = (s: string) => new Set((s || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2) || []);
  const qt = tok(question);
  let best: { cov: number; a: string } | null = null;
  for (const f of readHelpCache().faq) {
    const ft = tok(f.q); if (!ft.size) continue;
    let overlap = 0; qt.forEach((w) => { if (ft.has(w)) overlap++; });
    const cov = overlap / ft.size;
    if (overlap >= 2 && cov >= 0.6 && (!best || cov > best.cov)) best = { cov, a: f.a };
  }
  if (best) return { answer: best.a, sources: [], mode: 'faq-offline' };
  return { answer: 'You are offline — I can only answer from the cached FAQ. Open the User Guide tab, or try again with connectivity.', sources: [], mode: 'offline' };
}

export async function askAssistant(question: string): Promise<AssistantReply> {
  try { return await api('/help/assistant', { method: 'POST', body: JSON.stringify({ question }) }); }
  catch { return offlineAnswer(question); }
}

export type Induction = { version: number; title?: string; cover_html?: string; slides: string[]; required?: boolean };
export const getInduction = (): Promise<Induction> => api('/help/induction');
export type InductionStatus = { version: number; required: boolean; acked: boolean; show: boolean };
export const inductionStatus = (): Promise<InductionStatus> => api('/help/induction/status');
export const ackInduction = (version: number) => api('/help/induction/ack', { method: 'POST', body: JSON.stringify({ version }) });

// Re-exported so screens/workspace can read online state without importing ./storage directly.
export { isOnlineSync, isOnline };
