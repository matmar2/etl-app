/* Flight workspace — the full left-hand phase rail (EFBOne parity):
   Flight › Overview | Briefing › Folder | Before T/O › Pre-flight report, ATIS/Clearance,
   Sign pre-flight | In flight › Off block, RVSM, Nav log, Enroute | After landing ›
   Post-flight report, Sign post-flight. Section forms save via PUT /report (shallow merge). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import PdfViewer from './PdfViewer';                     // OFP/PDF viewer — platform split (native file:// WebView, web <iframe>)
import * as Print from 'expo-print';                     // native print fallback (window.open/print on web)
// M3 native camera — OTA crash rule (see CLAUDE.md / BarcodeScanner.tsx): expo-camera must NOT be a
// static top-level import; a pre-1.0.2 binary lacking the native module would abort NATIVELY at load
// (uncatchable) and crash-loop until expo-updates rolls back. requireOptionalNativeModule asks the
// native registry safely (null when absent); only then is the JS library require()d. Web keeps the
// <input capture> picker, so the module is loaded on native only.
import { requireOptionalNativeModule } from 'expo';
let ExpoCamera: any = null;
if (Platform.OS !== 'web' && requireOptionalNativeModule('ExpoCamera')) {
  try { ExpoCamera = require('expo-camera'); } catch { ExpoCamera = null; }
}
const cameraAvailable = !!(ExpoCamera && ExpoCamera.CameraView);
import { LOGO, useLogo } from './screens';
import { acceptFolder2, api, deleteDoc, etlAircraftStatus, etlAppUrl, gendecHtml, getDeepLinks, getDelayCodes, getDoc, getEtlToken, getFolder, getRequiredFields, isOnlineSync, pendingCount, ppsRefresh, prefetchDocs, saveReport, uploadDoc, wxRefresh } from './api';
import { HelpPage, openInduction } from './help';
import type { EtlStatusBundle } from './api';
import { NavLogScreen } from './screens';
import SignaturePad from '../components/SignaturePad';   // cross-platform signer (WebView native / canvas web)
import { fleetList, setCurrentAircraft } from '../api/client';   // ETL app hub — for the in-app "Open ETL" hand-off
import { createSector, pullSectorList } from '../db/sectors';    // find/create the Tech Log sector for this flight (platform-split)
import { ELEV, R, S, T, TY } from './theme';

const st = {
  input: { ...S.input, marginTop: 6 } as const,
  // Field label — matches the Overview labeled-field-grid (small caps, letterspaced).
  lbl: { color: T.sub, fontSize: 11.5, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 } as const,
  card: { ...S.card, marginTop: 12 } as const,
  // Card header — uppercase title with a hairline separator below.
  h: { ...TY.section, borderBottomWidth: 1, borderBottomColor: T.line, paddingBottom: 8, marginBottom: 4 } as const,
  // Header-row variant (title + actions on one line) — hairline sits on the row.
  hRow: { flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: T.line, paddingBottom: 8, marginBottom: 4 },
  hIn: { ...TY.section } as const,
  btn: { ...S.btnPrimary, marginTop: 14 },
  btnTxt: S.btnPrimaryTxt,
  btnSec: { ...S.btnSecondary, marginTop: 14 },
  btnSecTxt: S.btnSecondaryTxt,
  btnDanger: { ...S.btnDanger, marginTop: 14 },
  btnDangerTxt: S.btnDangerTxt,
};

// Required fields per section → rail badge counts (EFBOne's orange numbers).
const REQUIRED: Record<string, { key: string; label: string }[]> = {
  pre: [
    { key: 'ground_check', label: 'On-ground altimeter check (±75 ft)' },
    { key: 'uplift_l', label: 'Fuel uplift in fuel slip(s) (L)' },
    { key: 'block_fuel', label: 'Actual block fuel (kg)' },
    { key: 'pax_m', label: 'Pax — male/adults' }, { key: 'pax_f', label: 'Pax — female' },
    { key: 'pax_c', label: 'Pax — children' }, { key: 'pax_i', label: 'Pax — infants' },
  ],
  atisdep: [{ key: 'atis', label: 'ATIS (departure)' }, { key: 'clearance', label: 'ATC clearance' }],
  atisarr: [{ key: 'atis_dest', label: 'ATIS (destination)' }, { key: 'clearance', label: 'Clearance' }],
  offblock: [{ key: 'off_block', label: 'OFF block time' }, { key: 'takeoff', label: 'Take-off time' }],
  rvsm: [1, 2, 3, 4].map((i) => ({ key: `q${i}`, label: `RVSM item ${i}` })),
  post: [
    { key: 'landing', label: 'Landing time' }, { key: 'on_block', label: 'ON block time' },
    { key: 'pf', label: 'Pilot flying' }, { key: 'pm', label: 'Pilot monitoring' },
    { key: 'parking_fuel', label: 'Parking fuel (kg)' },
  ],
};
// Admin-controlled labels come from the built-in list where known, else the humanised key.
const humanise = (k: string) => { const s = k.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
// Auto-format a time entry as HH:MM — digits only, colon inserted after the hour, HH≤23 / MM≤59.
const _hhmm = (v: string): string => {
  let d = (v || '').replace(/\D/g, '').slice(0, 4);
  if (d.length >= 1) { const h = Math.min(parseInt(d.slice(0, 2) || '0', 10), 23); if (d.length >= 2) d = String(h).padStart(2, '0') + d.slice(2); }
  if (d.length >= 3) { const m = Math.min(parseInt(d.slice(2, 4), 10), 59); d = d.slice(0, 2) + String(m).padStart(d.length >= 4 ? 2 : 1, '0'); }
  return d.length <= 2 ? d : d.slice(0, 2) + ':' + d.slice(2);
};
// Which fields gate this section: the admin map from /config (cached for offline), falling
// back to the built-in REQUIRED above until the device has ever reached the server.
const requiredFor = (sec: string): { key: string; label: string }[] => {
  const cfg = getRequiredFields();
  const built = REQUIRED[sec] || [];
  if (!cfg) return built;
  return (cfg[sec] || []).map((k) => ({ key: k, label: built.find((b) => b.key === k)?.label || humanise(k) }));
};
const missing = (rep: any, sec: string) => requiredFor(sec).filter((f) => {
  const v = (rep?.[sec] || {})[f.key];
  return v === undefined || v === null || v === '';
});

// Fixed briefing tab set (EFBOne parity) — tabs stay visible even while empty.
const BRIEF_TABS: [string, string][] = [
  ['ofp', 'OFP'], ['wx_pdf', 'WX'], ['notam', 'NOTAMs'], ['atc', 'ATC'],
  ['charts', 'Weather'], ['other', 'Additional'], ['wx_live', 'Live WX'],
];
const docsFor = (d: any, k: string) => (d?.docs || []).filter((x: any) =>
  k === 'other' ? !['ofp', 'atc', 'wx_pdf', 'notam', 'charts', 'wx'].includes(x.kind)
  : k === 'wx_live' ? x.kind === 'wx' : x.kind === k);
// Latest revision per title. PPS re-issues each document on every re-plan, so a flight accumulates
// many revisions of the same doc (AH4002: 30 chart docs = 9 distinct charts x up to 4 revisions).
// The tab badge and the document list both key on this, so "(N)" matches the charts actually shown.
const uniqDocs = (docs: any[]) => { const m: Record<string, any> = {}; for (const x of docs) m[x.title] = x; return Object.values(m); };

// Icons follow the ETL back-office style (emoji, fixed-width column).
const RAIL: { group?: string; key: string; label: string; icon: string }[] = [
  { group: 'Flight', key: 'overview', label: 'Overview', icon: '✈️' },
  { group: 'Briefing', key: 'briefing', label: 'Folder — OFP & documents', icon: '📂' },
  { key: 'wxnotams', label: 'WX & NOTAMs', icon: '🌦️' },
  { group: 'Before take-off', key: 'pre', label: 'Pre-flight report', icon: '📋' },
  { key: 'etl', label: 'ETL', icon: '🛠️' },
  { key: 'atisdep', label: 'ATIS / Clearance (dep)', icon: '📻' },
  { key: 'signpre', label: 'Sign pre-flight', icon: '✍️' },
  { group: 'In flight', key: 'offblock', label: 'Off block', icon: '⏱️' },
  { key: 'rvsm', label: 'RVSM check', icon: '📐' },
  { key: 'navlog', label: 'Nav log — fuel & time', icon: '🗺️' },
  { key: 'enroute', label: 'Enroute / notes', icon: '📓' },
  { key: 'atisarr', label: 'ATIS / Clearance / Notes', icon: '📻' },
  { group: 'After landing', key: 'post', label: 'Post-flight report', icon: '📋' },
  { key: 'signpost', label: 'Sign post-flight', icon: '✍️' },
  { group: 'Help', key: 'help', label: 'User Guide & AI Assistant', icon: '📖' },
];

// "Open ETL" — EFF is now a module INSIDE the ETL app, so hand off IN-APP instead of opening the web
// build in a browser: select the flight's tail and go straight to its Departure page (or Flight
// Details if the sector isn't started yet), mirroring the web SSO deep-link (LoginScreen). No browser,
// no re-login. Falls back to the legacy SSO-URL hand-off only if no navigator is present (defensive).
async function openEtlInApp(f: any, navigation: any, tok: string | null, setMsg: (m: string) => void) {
  const reg = (f.registration || '').toUpperCase();
  const flightNo = (f.flight_no || '').toUpperCase();
  const flightDate = (f.date || '').trim();
  if (!navigation) {
    const baseUrl = etlAppUrl() || (Platform.OS === 'web' ? '/app' : 'https://etl.avora.aero/app');
    const url = `${baseUrl}/?sso=${encodeURIComponent(tok || '')}&reg=${encodeURIComponent(reg)}&flight=${encodeURIComponent(flightNo)}&date=${encodeURIComponent(flightDate)}`;
    if (Platform.OS === 'web') window.open(url, '_blank'); else Linking.openURL(url).catch(() => {});
    return;
  }
  const date = flightDate || String(f.std || '').slice(0, 10);
  // Push onto the existing stack (Menu → Flight Folder → here) rather than reset — so the ETL back
  // arrow returns to the EFF Flight Folder the crew came from, while the Menu button still goes to the
  // ETL main menu. (reset wiped the EFF screen, which sent Back to the ETL menu.)
  const toDeparture = (sectorId: string) => navigation.navigate('Departure', { sectorId });
  const toFlightDetails = () => navigation.navigate('Sectors', { aircraftId: reg });
  try {
    // Select the tail. Offline this call can't reach the server — keep whatever tail is already
    // selected rather than aborting; the Sectors/Departure screen still gets the reg via params.
    let ac: any = null;
    try {
      if (reg) { ac = (await fleetList()).find((x: any) => (x.registration || '').toUpperCase() === reg); if (ac) await setCurrentAircraft(ac); }
    } catch { /* offline — proceed with the current aircraft */ }
    if (!(reg && flightNo)) { toFlightDetails(); return; }
    // pullSectorList reads the LOCAL sector mirror, so it works offline.
    let sectors: any[] = [];
    try { sectors = await pullSectorList(reg); } catch { sectors = []; }
    const existing = sectors.find((x: any) => (x.flight_no || '').toUpperCase() === flightNo && (!date || x.flight_date === date));
    if (existing) { toDeparture(existing.id); return; }           // already started → its Departure
    // Not started yet. One-open-flight rule: don't auto-create while another flight is open — send the
    // crew to Flight Details to close the current one first.
    const openOne = sectors.find((x: any) => ['draft', 'open', 'preflight_signed'].includes(x.status || ''));
    if (openOne) { toFlightDetails(); setMsg(`Close ${openOne.flight_no} first, then Open ETL for ${flightNo}.`); return; }
    // Start the sector straight from the EFF/PPS flight. EFF folders come from PPS, so ACMI / off-Leon
    // legs (e.g. AH6940, which Leon doesn't carry) aren't in ETL's Leon list to pick — create the
    // sector here from the briefing's own flight details so it opens directly, pre-filled.
    if (ac) {
      const row: any = await createSector({ aircraft_id: reg, flight_no: flightNo, flight_date: date,
                                            dep: f.dep, arr: f.arr, std: f.std, sta: f.sta, source: 'eff' } as any);
      toDeparture(row.id);
      return;
    }
    toFlightDetails();                                            // no tail resolved (offline first run) → let them pick there
  } catch (e: any) { setMsg(`Could not open the Tech Log — ${e?.message || e}`); }
}

// Cross-platform document picker — a select-style trigger that opens a modal list (replaces the chip
// row). Uses Modal, which works on iOS and react-native-web, so there is no native picker module and
// it stays OTA-safe.
function DocDropdown({ list, shown, onPick }: { list: any[]; shown: any; onPick: (d: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.line, backgroundColor: T.inBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minHeight: 42, minWidth: 260, maxWidth: 460 }}>
        <Text style={{ color: T.text, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>
          {shown?.title}{shown?.revision != null ? ` — rev ${shown.revision}` : ''}
        </Text>
        <Text style={{ color: T.sub, fontSize: 12, marginLeft: 8 }}>{list.length} ▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.line, width: '100%', maxWidth: 520, maxHeight: '80%' as any, overflow: 'hidden' }}>
            <Text style={{ color: T.sub, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>SELECT DOCUMENT</Text>
            <ScrollView>
              {list.map((doc: any) => { const on = shown?.id === doc.id; return (
                <TouchableOpacity key={doc.id} onPress={() => { onPick(doc); setOpen(false); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1b2c49', backgroundColor: on ? '#1c3050' : undefined }}>
                  <Text style={{ color: on ? '#fff' : T.text, fontWeight: on ? '800' : '600', fontSize: 13.5, flex: 1 }} numberOfLines={2}>{doc.title}</Text>
                  <Text style={{ color: T.sub, fontSize: 11.5, marginLeft: 10 }}>rev {doc.revision}</Text>
                  {on ? <Text style={{ color: T.accent, marginLeft: 8, fontWeight: '800' }}>✓</Text> : null}
                </TouchableOpacity>); })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function Workspace({ flight, back, signOut, navigation }: { flight: any; back: () => void; signOut?: () => void; navigation?: any }) {
  const [d, setD] = useState<any>(null);
  const [rep, setRep] = useState<any>({});
  const [sec, setSec] = useState('overview');
  const [railOpen, setRailOpen] = useState(true);        // collapsible left phase-rail (more room for the OFP/charts)
  const [preTab, setPreTab] = useState<'form' | 'security' | 'gendec'>('form');
  const [briefTab, setBriefTab] = useState('ofp');
  const [wxTab, setWxTab] = useState('dep');
  const [wxCat, setWxCat] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [wxBusy, setWxBusy] = useState(false);
  const [wxDecode, setWxDecode] = useState(false);
  const [atisArrTab, setAtisArrTab] = useState('dest');
  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[] | null>(null);
  const [goPage, setGoPage] = useState<number | null>(null);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [msg, _setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(false);
  const setMsg = (m: string, ok = false) => { _setMsg(m); setMsgOk(ok); };
  const logoSrc = useLogo();
  const load = () => getFolder(flight.id).then((x) => {
    const rep0 = x.report || {};
    // Density defaults to 0.785 (accepted unless the crew changes it) so it satisfies the sign
    // gate without re-entry and carries to ETL. Seed it once when the folder has none.
    if (((rep0.pre || {}).density ?? '') === '') {
      rep0.pre = { ...(rep0.pre || {}), density: '0.785' };
      saveReport(flight.id, 'pre', { density: '0.785' }).catch(() => {});
    }
    setD(x); setRep(rep0);
    prefetchDocs(flight.id, x.docs || []);              // briefing PDFs → IndexedDB for offline
  }).catch((e) => { if (/session expired/i.test(e.message) && signOut) { signOut(); return; } setMsg(e.message); });
  useEffect(() => { load(); }, []);
  const doWxRefresh = useCallback(async () => {
    setWxBusy(true); setMsg('');
    try { await wxRefresh(flight.id); load(); setMsg('Weather updated.', true); }
    catch (e: any) { setMsg(e.message); }
    finally { setWxBusy(false); }
  }, [flight.id, load]);
  const f = d?.flight || flight;

  // Post-sign amend window (admin-set minutes). While open, the crew may still edit; after it, the
  // signed folder is a fixed record (forms + photos lock). Ticks so the UI locks without a reload.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 20000); return () => clearInterval(t); }, []);
  const amendMin = d?.amend_minutes ?? 30;
  const lastSignedAt = d?.acceptance_post?.signed_at || d?.acceptance?.signed_at || null;
  const amendMsLeft = (() => {
    if (!lastSignedAt) return null;
    const t = Date.parse(lastSignedAt); if (isNaN(t)) return null;
    return (t + amendMin * 60000) - Date.now();
  })();
  const locked = !!d?.locked || (amendMsLeft != null && amendMsLeft <= 0);
  const lockedRef = useRef(false); lockedRef.current = locked;

  // Live aircraft status from the ETL API for the Overview card — fetched once per flight open,
  // cached per reg for 5 min in api.ts. Failure only hides the live data, never the Overview.
  const [etl, setEtl] = useState<EtlStatusBundle | null>(null);
  const [etlErr, setEtlErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const reg = flight.registration || (d?.flight || {}).registration;
    if (!reg) { setEtlErr(true); return; }
    etlAircraftStatus(reg)
      .then((r) => { if (alive) { setEtl(r); setEtlErr(false); } })
      .catch(() => { if (alive) setEtlErr(true); });
    return () => { alive = false; };
  }, [flight.registration]);

  // repRef holds the latest report so the STABLE handlers/components below read current values
  // without being recreated each render (recreating F remounted every TextInput → focus was lost
  // after each keystroke). Assigned during render so children see the up-to-date value.
  const repRef = useRef<any>(rep); repRef.current = rep;
  const set = useCallback((section: string, key: string, v: any) =>
    setRep((p: any) => ({ ...p, [section]: { ...(p[section] || {}), [key]: v } })), []);
  const persist = useCallback(async (section: string, key: string) => {
    try { await saveReport(flight.id, section, { [key]: repRef.current?.[section]?.[key] ?? null }); setMsg(''); }
    catch (e: any) { setMsg(`Save failed — ${e.message}`); }
  }, [flight.id]);
  // Stable identity (useCallback []) → React keeps the same TextInput instance across renders, so
  // focus survives typing. Value comes from repRef (latest), not a stale closure.
  const F = useCallback(({ s: section, k, label, ph, kb, w, time }: any) => {
    const isReq = requiredFor(section).some((f) => f.key === k);
    const val = repRef.current?.[section]?.[k];
    const empty = val === undefined || val === null || val === '';
    return (
    <View style={{ width: w || 220, minWidth: 100, maxWidth: '100%', marginRight: 16 }}>
      <Text style={st.lbl}>{isReq ? <Text style={{ color: T.red }}>* </Text> : null}{label}</Text>
      <TextInput style={[st.input, lockedRef.current ? { opacity: 0.55 } : null, isReq && empty ? { borderColor: T.red } : null]} editable={!lockedRef.current}
        placeholder={ph || ''} placeholderTextColor="#4a5f80" keyboardType={time ? 'numeric' : kb}
        value={String(val ?? '')} maxLength={time ? 5 : undefined}
        onChangeText={(v) => set(section, k, time ? _hhmm(v) : v)} onBlur={() => persist(section, k)} />
    </View>);
  }, [set, persist]);
  const YN = ({ s: section, k, label }: any) => {
    const v = rep?.[section]?.[k];
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={{ color: T.text, fontSize: 14 }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['YES', 'NO'] as const).map((o) => (
            <TouchableOpacity key={o} onPress={async () => { set(section, k, o); try { await saveReport(flight.id, section, { [k]: o }); } catch {} }}
              style={{ borderWidth: 1, borderColor: v === o ? (o === 'YES' ? T.green : T.red) : T.line, backgroundColor: v === o ? (o === 'YES' ? '#153524' : '#3a1515') : T.inBg, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: v === o ? (o === 'YES' ? '#9fd6ae' : '#f0a3a3') : T.sub, fontWeight: '700' }}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const body = () => {
    switch (sec) {
      case 'overview': return (() => {
        const Fld = ({ label, value }: any) => (
          <View style={{ minWidth: 130, marginRight: 22, marginTop: 10 }}>
            <Text style={{ color: T.sub, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] as any }}>{value ?? '—'}</Text>
          </View>);
        const st2 = { th: { color: T.sub, fontSize: 11.5, textTransform: 'uppercase' as const, letterSpacing: 0.6, paddingVertical: 6 },
                      td: { color: T.text, fontSize: 15, paddingVertical: 7 } };
        return (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 }}>
              <Text style={{ color: T.sub, fontSize: 12 }}>
                Plan updated {f.pps_plan_ts ? `${String(f.pps_plan_ts).slice(0, 16).replace('T', ' ')}z` : '—'}
              </Text>
              <TouchableOpacity disabled={refreshing} onPress={async () => {
                setRefreshing(true); setMsg('');
                try { await ppsRefresh(flight.id); load(); setMsg('Flight data refreshed from PPS.', true); }
                catch (e: any) { setMsg(e.message); }
                finally { setRefreshing(false); }
              }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: T.accent, borderRadius: 999, opacity: refreshing ? 0.5 : 1 }}>
                <Text style={{ color: T.accent, fontWeight: '700', fontSize: 13 }}>{refreshing ? '⟳ Refreshing…' : '⟳ Refresh from PPS'}</Text>
              </TouchableOpacity>
            </View>
            <View style={st.card}><Text style={st.h}>Schedule (Leon)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Fld label="Flight" value={f.flight_no} />
                <Fld label="Date" value={f.date} />
                <Fld label="From" value={f.dep} />
                <Fld label="To" value={f.arr} />
                <Fld label="STD" value={f.std ? `${String(f.std).slice(11, 16)}z` : null} />
                <Fld label="STA" value={f.sta ? `${String(f.sta).slice(11, 16)}z` : null} />
                <Fld label="Aircraft" value={f.registration} />
                <Fld label="Folder" value={(f.folder_status || '').toUpperCase()} />
              </View>
            </View>
            <View style={st.card}><Text style={st.h}>Crew (Leon)</Text>
              {(f.crew || []).length ? (
                <View style={{ marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: T.line }}>
                    <Text style={[st2.th, { width: 70 }]}>Pos</Text>
                    <Text style={[st2.th, { width: 80 }]}>Code</Text>
                    <Text style={[st2.th, { flex: 1 }]}>Name</Text>
                  </View>
                  {(f.crew || []).map((c: any, i2: number) => (
                    <View key={i2} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1b2c49', backgroundColor: i2 % 2 ? '#14223a' : undefined }}>
                      <Text style={[st2.td, { width: 70, color: T.accent, fontWeight: '800' }]}>{c.role}</Text>
                      <Text style={[st2.td, { width: 80, fontFamily: 'monospace' as any }]}>{c.code || '—'}</Text>
                      <Text style={[st2.td, { flex: 1 }]}>{c.name}</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={{ color: T.sub, marginTop: 8 }}>No crew assignment received from Leon for this flight yet.</Text>}
            </View>
            <View style={st.card}><Text style={st.h}>Aircraft status — {f.registration}</Text>
              {!etl && !etlErr ? <ActivityIndicator style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
              {etlErr && !etl ? <Text style={{ color: T.sub, fontSize: 12.5, marginTop: 10 }}>{getEtlToken() ? 'ETL status unavailable' : 'Sign out and sign in again to link your ETL session — the maintenance status will then appear here.'}</Text> : null}
              {etl ? (() => {
                const sv = !!etl.status?.serviceable;
                // An airborne aircraft was released for flight — a grounded verdict while flying
                // means the rectifying action (extension / deferral / CRS) awaits OASES import.
                const flying = !sv && !!etl.status?.in_flight;
                const reasons: string[] = etl.status?.reasons || [];
                // Blocking (not-deferred) technical/cabin items + the Hold Item List, one table.
                const rows = [
                  ...(etl.defects || []).filter((x: any) => x.blocks_serviceability !== false),
                  ...(etl.hil || []),
                ];
                const daysLeft = (x: any): number | null => {
                  if (typeof x.remaining_days === 'number') return x.remaining_days;      // HIL rows carry it
                  if (!x.due_date) return null;
                  const t = new Date(); t.setUTCHours(0, 0, 0, 0);
                  return Math.round((Date.parse(String(x.due_date).slice(0, 10)) - t.getTime()) / 86400000);
                };
                const dayColor = (n: number | null) => n == null ? T.sub : n <= 2 ? '#f0a3a3' : n <= 7 ? '#f0d48a' : T.text;
                return (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                      <View style={{ backgroundColor: sv ? '#153524' : flying ? '#33290f' : '#3a1515', borderWidth: 1, borderColor: sv ? T.green : flying ? T.amber : T.red, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 }}>
                        <Text style={{ color: sv ? '#9fd6ae' : flying ? '#f0d48a' : '#f0a3a3', fontWeight: '800', fontSize: 15, letterSpacing: 0.6 }}>{sv ? '● SERVICEABLE' : flying ? '✈ OPERATING — AIRBORNE' : '▲ UNSERVICEABLE'}</Text>
                      </View>
                      {etl.status?.next_tl ? <Text style={{ color: T.sub, fontSize: 12.5 }}>Next TL {etl.status.next_tl}</Text> : null}
                    </View>
                    {reasons.length ? (
                      <View style={{ marginTop: 8 }}>
                        {reasons.map((r2, i2) => <Text key={i2} style={{ color: flying ? '#f0d48a' : '#f0a3a3', fontSize: 13, lineHeight: 19 }}>• {r2}</Text>)}
                        {flying ? <Text style={{ color: T.sub, fontSize: 12.5, marginTop: 6, lineHeight: 18 }}>Aircraft is airborne, so it was released for flight — the items above are most likely rectified/deferred in OASES but not yet imported into the ETL (auto-sync runs hourly). Check OASES for the maintenance action.</Text> : null}
                      </View>) : null}
                    {rows.length ? (
                      <View style={{ marginTop: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: T.line }}>
                          <Text style={[st2.th, { width: 92 }]}>Ref / TL</Text>
                          <Text style={[st2.th, { width: 46 }]}>ATA</Text>
                          <Text style={[st2.th, { flex: 1 }]}>Description</Text>
                          <Text style={[st2.th, { width: 112 }]}>Status</Text>
                          <Text style={[st2.th, { width: 46 }]}>MEL</Text>
                          <Text style={[st2.th, { width: 92 }]}>Due date</Text>
                          <View style={{ width: 180 }}>
                            <Text style={[st2.th, { textAlign: 'center', paddingVertical: 0, paddingBottom: 3 }]}>Remaining</Text>
                            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: T.line }}>
                              <Text style={[st2.th, { width: 60, paddingVertical: 3, textAlign: 'center' }]}>Days</Text>
                              <Text style={[st2.th, { width: 60, paddingVertical: 3, textAlign: 'center' }]}>FH</Text>
                              <Text style={[st2.th, { width: 60, paddingVertical: 3, textAlign: 'center' }]}>FC</Text>
                            </View>
                          </View>
                        </View>
                        {rows.map((x: any, i2: number) => {
                          const days = daysLeft(x);
                          return (
                            <View key={x.id || i2} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1b2c49', backgroundColor: i2 % 2 ? '#14223a' : undefined }}>
                              <Text style={[st2.td, { width: 92, fontSize: 13, fontFamily: 'monospace' as any }]}>{x.hil_no || x.transfer_tl_no || x.oases_tl_page || '—'}</Text>
                              <Text style={[st2.td, { width: 46, fontSize: 13 }]}>{x.ata_chapter || '—'}</Text>
                              <Text style={[st2.td, { flex: 1, fontSize: 13, paddingRight: 8 }]} numberOfLines={1}>{x.title ? `${x.title} — ${x.description || ''}` : (x.description || '—')}</Text>
                              <Text style={[st2.td, { width: 112, fontSize: 12.5, color: x.status === 'deferred' ? '#f0d48a' : T.text, textTransform: 'uppercase' as any }]}>{(x.status || '').replace('_', ' ')}</Text>
                              <Text style={[st2.td, { width: 46, fontSize: 13, fontWeight: '700' as any }]}>{x.rect_interval || '—'}</Text>
                              <Text style={[st2.td, { width: 92, fontSize: 13, fontVariant: ['tabular-nums'] as any }]}>{x.due_date ? String(x.due_date).slice(0, 10) : '—'}</Text>
                              <Text style={[st2.td, { width: 60, fontSize: 13, fontWeight: '700' as any, color: dayColor(days), fontVariant: ['tabular-nums'] as any, textAlign: 'center' as any }]}>{days == null ? '—' : days}</Text>
                              <Text style={[st2.td, { width: 60, fontSize: 13, fontVariant: ['tabular-nums'] as any, textAlign: 'center' as any }]}>{x.remaining_fh != null ? x.remaining_fh : '—'}</Text>
                              <Text style={[st2.td, { width: 60, fontSize: 13, fontVariant: ['tabular-nums'] as any, textAlign: 'center' as any }]}>{x.remaining_cycles != null ? x.remaining_cycles : '—'}</Text>
                            </View>);
                        })}
                      </View>
                    ) : <Text style={{ color: '#9fd6ae', fontSize: 13, marginTop: 12 }}>No open blocking defects or hold items.</Text>}
                  </View>);
              })() : null}
            </View>
          </View>);
      })();
      case 'briefing': return (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 4 }} disabled={wxBusy} onPress={doWxRefresh}>
              <Text style={{ color: T.accent, fontWeight: '700' }}>{wxBusy ? '⟳ Fetching…' : '⟳ Refresh weather'}</Text></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {BRIEF_TABS.map(([k, label]) => {
              const n = uniqDocs(docsFor(d, k)).length;   // distinct documents, not raw revisions
              return (
                <TouchableOpacity key={k} onPress={() => setBriefTab(k)}
                  style={{ borderWidth: 1, borderColor: briefTab === k ? T.accent : T.line, backgroundColor: briefTab === k ? '#1c3050' : T.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, justifyContent: 'center', opacity: n ? 1 : 0.55 }}>
                  <Text style={{ color: briefTab === k ? '#fff' : T.sub, fontWeight: '700', fontSize: 13 }}>{label}{n > 1 ? ` (${n})` : ''}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <TextInput style={[st.input, { marginTop: 0, flex: 1, maxWidth: 420 }]} placeholder="Search all briefing documents (e.g. LFPG, RWY, CB, MEL)…"
              placeholderTextColor="#4a5f80" value={q}
              onChangeText={(v) => { setQ(v); if (!v) setHits(null); }}
              onSubmitEditing={async () => {
                if (q.trim().length < 2) { setHits(null); return; }
                try { setHits(await api(`/flights/${flight.id}/doc-search?q=${encodeURIComponent(q.trim())}`)); }
                catch (e: any) { setMsg(e.message); }
              }} />
            <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 4 }} onPress={async () => {
              if (q.trim().length < 2) { setHits(null); return; }
              try { setHits(await api(`/flights/${flight.id}/doc-search?q=${encodeURIComponent(q.trim())}`)); }
              catch (e: any) { setMsg(e.message); }
            }}><Text style={{ color: T.accent, fontWeight: '700' }}>🔍 Search</Text></TouchableOpacity>
            {hits ? <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 4 }} onPress={() => { setHits(null); setQ(''); }}><Text style={{ color: T.sub }}>✕ clear</Text></TouchableOpacity> : null}
          </View>
          {hits ? (
            <View style={[st.card, { paddingVertical: 8 }]}>
              {hits.length === 0 ? <Text style={{ color: T.sub }}>No matches in this flight's documents.</Text> :
                hits.map((h: any, i: number) => (
                  <TouchableOpacity key={i} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: '#1b2c49' }}
                    onPress={() => {
                      const tab = ['ofp', 'atc', 'wx_pdf', 'notam', 'charts'].includes(h.kind) ? h.kind : 'other';
                      setBriefTab(tab);
                      const doc = (d?.docs || []).find((x: any) => x.id === h.doc_id);
                      if (doc) setViewDoc(doc);
                      setGoPage(h.page);
                    }}>
                    <Text style={{ color: T.text, fontSize: 13 }}>
                      <Text style={{ color: T.entry, fontWeight: '700' }}>{h.title} · p{h.page}</Text>  <Text style={{ color: T.sub }}>…{h.snippet}…</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          ) : null}
          {f.atc_route && (briefTab === 'ofp' || briefTab === 'atc') ? (
            <View style={[st.card, { paddingVertical: 10 }]}>
              <View style={st.hRow}>
                <Text style={st.hIn}>ATC route</Text><View style={{ flex: 1 }} />
                {/* web→native: navigator.clipboard exists only on web; no clipboard native module is
                    in the OTA-safe set, so native shows a hint instead of copying. */}
                <TouchableOpacity style={{ paddingVertical: 6, paddingHorizontal: 4 }} onPress={() => {
                  if (Platform.OS === 'web') { try { (navigator as any).clipboard.writeText(f.atc_route); setMsg(''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setMsg('Copy not available in this browser'); } }
                  else { setMsg('Copy to clipboard is available in the web app.'); }
                }}>
                  <Text style={{ color: copied ? T.green : T.accent, fontWeight: '700' }}>{copied ? '✓ Copied' : '⧉ Copy to clipboard'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: T.text, fontFamily: 'monospace' as any, fontSize: 13, marginTop: 6 }}>{f.atc_route}</Text>
            </View>
          ) : null}
          {(() => {
            const docs = docsFor(d, briefTab);
            if (briefTab === 'wx_live') {
              if (!docs.length) return <Text style={{ color: T.sub, marginTop: 14 }}>No live wx snapshot yet — tap ⟳ Live wx.</Text>;
              return docs.slice(-1).map((doc: any) => (
                <View key={doc.id} style={st.card}>
                  <Text style={{ color: T.text, fontWeight: '700' }}>{doc.title} <Text style={{ color: T.sub }}>{(doc.fetched_at || '').slice(0, 16)}z</Text></Text>
                  {doc.wx ? Object.entries(doc.wx).map(([icao, w]: any) => (
                    <View key={icao} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#1b2c49', paddingTop: 8 }}>
                      <Text style={{ color: T.entry, fontWeight: '700' }}>{icao}</Text>
                      {w.metar ? <Text style={{ color: T.text, fontFamily: 'monospace' as any, fontSize: 12.5, lineHeight: 18, marginTop: 3 }}>{w.metar}</Text> : null}
                      {w.taf ? <Text style={{ color: T.sub, fontFamily: 'monospace' as any, fontSize: 12.5, lineHeight: 18, marginTop: 3 }}>{w.taf}</Text> : null}
                    </View>)) : null}
                </View>));
            }
            if (!docs.length) return (
              <Text style={{ color: T.sub, marginTop: 14 }}>
                {briefTab === 'charts' ? 'No weather charts for this flight yet — they appear when dispatch generates them in PPS.'
                  : 'Not received from PPS yet — arrives automatically when dispatch files/updates the plan.'}
              </Text>);
            const list = uniqDocs(docs) as any[];
            const shown = viewDoc && list.some((x: any) => x.id === viewDoc.id) ? viewDoc : list[list.length - 1];
            return (
              <View>
                {list.length > 1 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    <Text style={{ color: T.sub, fontSize: 12 }}>Document</Text>
                    <DocDropdown list={list} shown={shown} onPick={setViewDoc} />
                    <Text style={{ color: T.sub, fontSize: 12 }}>{String(shown?.fetched_at || '').slice(0, 16)}z</Text>
                  </View>
                ) : (
                  <Text style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{shown?.title} · rev {shown?.revision} · {String(shown?.fetched_at || '').slice(0, 16)}z</Text>
                )}
                {shown ? <PdfViewer flightId={flight.id} doc={shown} setMsg={setMsg} page={goPage} /> : null}
              </View>);
          })()}
          {/* Flight Plan card — EFBOne parity: update timestamps + prominent Update button */}
          <View style={[st.card, { paddingVertical: 12 }]}>
            <Text style={st.h}>Flight Plan</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: T.sub, fontSize: 14 }}>Last updated (PPS)</Text>
              <Text style={{ color: T.entry, fontSize: 14, fontWeight: '600' }}>{f.pps_plan_ts ? `${String(f.pps_plan_ts).slice(0, 16).replace('T', ' ')}z` : '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: T.sub, fontSize: 14 }}>Last edit</Text>
              <Text style={{ color: T.entry, fontSize: 14, fontWeight: '600' }}>{f.pps_edit_ts ? `${String(f.pps_edit_ts).slice(0, 16).replace('T', ' ')}z` : '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: T.sub, fontSize: 14 }}>Last fetched</Text>
              <Text style={{ color: T.entry, fontSize: 14, fontWeight: '600' }}>{f.pps_fetched_at ? `${String(f.pps_fetched_at).slice(0, 16).replace('T', ' ')}z` : '—'}</Text>
            </View>
            <TouchableOpacity style={st.btn} disabled={refreshing} onPress={async () => {
              setRefreshing(true); setMsg('');
              try { const r = await api(`/flights/${flight.id}/pps-refresh`, { method: 'POST' });
                setMsg(''); load();
                if (!r.docs && !r.revised) setMsg('Flight plan is already up to date.', true);
              } catch (e: any) { setMsg(e.message); }
              finally { setRefreshing(false); }
            }}>
              <Text style={st.btnTxt}>{refreshing ? 'Updating…' : 'Update Flight Plan'}</Text>
            </TouchableOpacity>
          </View>
        </View>);
      case 'wxnotams': return (() => {
        const wn = f.wx_notams || {};
        const marks = rep?.wx_bookmarks || {};
        const nkey = (n: any) => `${n.icao || n.fir || ''}·${n.number || (n.text || '').slice(0, 18)}`;
        const toggleMark = async (n: any) => {
          const k = nkey(n); const v = marks[k] ? undefined : true;
          set('wx_bookmarks', k, v);
          try { await saveReport(flight.id, 'wx_bookmarks', { [k]: v ?? null }); } catch {}
        };
        // Q-code → EFBOne-style category
        const cat = (n: any) => { const q = (n.qcode || '').toUpperCase();
          if (q.startsWith('QMR')) return 'Runway';
          if (q.startsWith('QMX') || q.startsWith('QMK') || q.startsWith('QMN')) return 'Taxiway';
          if (q.startsWith('QI') || q.startsWith('QN')) return 'Approach';
          if (q.startsWith('QF') || q.startsWith('QL') || q.startsWith('QM')) return 'Airport';
          if (q.startsWith('QA') || q.startsWith('QR')) return 'Airspace';
          if (q.startsWith('QS') || q.startsWith('QC')) return 'ATC';
          if (q.startsWith('QW')) return 'Hazards';
          return 'Other'; };
        const CATS = ['all', 'Runway', 'Taxiway', 'Approach', 'Airport', 'Airspace', 'ATC', 'Hazards', 'Other'];
        const cnt = (k: string) => (wn[k]?.notams || []).length;
        const nMarks = [...['dep', 'dest', 'alt1', 'alt2', 'alt3', 'add1', 'add2'].flatMap((k) => (wn[k]?.notams || [])), ...(wn.fir_notams || [])]
          .filter((n) => marks[nkey(n)]).length;
        const TABS: [string, string, number][] = [
          ['dep', `DEP${wn.dep ? ` ${wn.dep.icao}` : ''} (${cnt('dep')})`, cnt('dep')],
          ['dest', `DEST${wn.dest ? ` ${wn.dest.icao}` : ''} (${cnt('dest')})`, cnt('dest')],
          ['alt1', `ALT1${wn.alt1 ? ` ${wn.alt1.icao}` : ''} (${cnt('alt1')})`, cnt('alt1')]];
        // Real 2nd/3rd destination alternates only appear when the plan carries them.
        if (wn.alt2) TABS.push(['alt2', `ALT2 ${wn.alt2.icao} (${cnt('alt2')})`, cnt('alt2')]);
        if (wn.alt3) TABS.push(['alt3', `ALT3 ${wn.alt3.icao} (${cnt('alt3')})`, cnt('alt3')]);
        // Additional / planning alternates (weather only; airport NOTAMs sit in the FIR set).
        if (wn.add1) TABS.push(['add1', `ADDL ${wn.add1.icao} (${cnt('add1')})`, cnt('add1')]);
        if (wn.add2) TABS.push(['add2', `ADDL ${wn.add2.icao} (${cnt('add2')})`, cnt('add2')]);
        TABS.push(['fir', `FIR (${(wn.fir_notams || []).length})`, (wn.fir_notams || []).length]);
        TABS.push(['marks', `🔖 Bookmarks (${nMarks})`, nMarks]);
        // Border-only card (no shadow) — FIR lists can run 200+ items.
        const notamCard = (n: any) => (
          <Pressable key={nkey(n)}
            style={({ hovered }: any) => [{ backgroundColor: T.card, borderWidth: 1, borderColor: hovered ? '#31517f' : T.line,
              borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
              <Text style={{ color: T.text, fontWeight: '800', fontSize: 14.5, flex: 1, paddingRight: 8 }}>{n.number || '—'}{n.abbrev ? <Text style={{ color: T.sub, fontWeight: '400', fontSize: 13 }}>  · {n.abbrev}</Text> : null}</Text>
              {n.new ? <View style={{ backgroundColor: '#153524', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginRight: 10, alignSelf: 'center' }}><Text style={{ color: '#9fd6ae', fontSize: 11, fontWeight: '800' }}>New</Text></View> : null}
              <TouchableOpacity onPress={() => toggleMark(n)}
                style={{ minWidth: 44, minHeight: 40, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1,
                         alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
                         borderColor: marks[nkey(n)] ? T.green : T.line,
                         backgroundColor: marks[nkey(n)] ? '#153524' : 'transparent' }}>
                <Text style={{ fontSize: 15, opacity: marks[nkey(n)] ? 1 : 0.45 }}>🔖{marks[nkey(n)] ? ' ✓' : ''}</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: T.sub, fontSize: 11.5, marginTop: 1 }}>From {String(n.from || '').slice(0, 16).replace('T', ' ')} — to {String(n.to || '').startsWith('9999') ? 'PERM' : String(n.to || '').slice(0, 16).replace('T', ' ')}</Text>
            <Text style={{ color: T.text, fontFamily: 'monospace' as any, fontSize: 12.5, lineHeight: 18, marginTop: 7, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#233a5e' }}>{n.text || n.ecode}</Text>
          </Pressable>);
        const wxCap = { color: T.sub, fontSize: 10.5, fontWeight: '800' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const };
        // Validity captions parsed from the raw text: METAR observation time (ddhhmmZ) and the
        // TAF validity group (ddhh/ddhh, first occurrence after "TAF"). Absent → no caption.
        const metarObs = (raw: string) => {
          const m = /\b(\d{2})(\d{2})(\d{2})Z\b/.exec(raw || '');
          return m ? `OBS day ${m[1]} ${m[2]}:${m[3]}Z` : null;
        };
        const tafValidity = (raw: string) => {
          const s = raw || ''; const i = s.indexOf('TAF');
          const m = /\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/.exec(i >= 0 ? s.slice(i) : s);
          return m ? `VALID day ${m[1]} ${m[2]}:00Z → day ${m[3]} ${m[4]}:00Z` : null;
        };
        const wxSubCap = { color: T.sub, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase' as const };
        // --------------- METAR / TAF human-readable decode ---------------
        const _WX_CODES: Record<string, string> = {
          MI: 'shallow', PR: 'partial', BC: 'patches', DR: 'drifting', BL: 'blowing',
          SH: 'showers', TS: 'thunderstorm', FZ: 'freezing',
          DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals',
          PL: 'ice pellets', GR: 'hail', GS: 'small hail', UP: 'unknown precip',
          FG: 'fog', BR: 'mist', HZ: 'haze', VA: 'volcanic ash', DU: 'dust',
          SA: 'sand', FU: 'smoke', PY: 'spray', PO: 'dust whirls', SQ: 'squall',
          FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
        };
        const _CLD: Record<string, string> = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast' };
        const decodeWx = (raw: string): string[] => {
          if (!raw) return [];
          const out: string[] = [];
          // Wind: dddffGggKT or dddffKT or VRB
          const wm = /\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/.exec(raw);
          if (wm) {
            const dir = wm[1] === 'VRB' ? 'variable' : `${wm[1]}°`;
            const spd = Number(wm[2]);
            const gust = wm[4] ? ` gusting ${wm[4]} kt` : '';
            out.push(`Wind ${dir} at ${spd} kt${gust}`);
          }
          // Variable wind direction
          const vw = /\b(\d{3})V(\d{3})\b/.exec(raw);
          if (vw) out.push(`Wind varying ${vw[1]}°–${vw[2]}°`);
          // Visibility
          const vm = /\b(\d{4})\b/.exec(raw.replace(/\b\d{6}Z\b/, '').replace(/\b\d{3}\d{2,3}(G\d{2,3})?KT\b/, ''));
          if (vm && vm[1] !== '0000') {
            const v = Number(vm[1]);
            out.push(v >= 9999 ? 'Visibility 10 km or more' : `Visibility ${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + ' km' : v + ' m'}`);
          }
          if (/\bCAVOK\b/.test(raw)) out.push('CAVOK (ceiling and visibility OK)');
          // Weather phenomena
          const wxr = raw.match(/(?:^|\s)([+-]?)(?:VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|HZ|VA|DU|SA|FU|PY|PO|SQ|FC|SS|DS)+)(?:\s|$)/g);
          if (wxr) for (const w of wxr) {
            const s = w.trim();
            const int = s.startsWith('+') ? 'heavy ' : s.startsWith('-') ? 'light ' : '';
            const code = s.replace(/^[+-]/, '').replace('VC', '');
            const parts: string[] = [];
            for (let i = 0; i < code.length; i += 2) { const c = code.slice(i, i + 2); if (_WX_CODES[c]) parts.push(_WX_CODES[c]); }
            if (parts.length) out.push(`Weather: ${int}${parts.join(' ')}`);
          }
          // Clouds
          const cm = raw.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g);
          for (const c of cm) {
            const alt = Number(c[2]) * 100;
            const typ = c[3] === 'CB' ? ' cumulonimbus' : c[3] === 'TCU' ? ' towering cumulus' : '';
            out.push(`Cloud: ${_CLD[c[1]]} at ${alt} ft${typ}`);
          }
          if (/\bNSC\b/.test(raw)) out.push('No significant cloud');
          if (/\bNCD\b/.test(raw)) out.push('No cloud detected');
          if (/\bVV(\d{3})\b/.test(raw)) { const vv = raw.match(/\bVV(\d{3})\b/); if (vv) out.push(`Vertical visibility ${Number(vv[1]) * 100} ft`); }
          // Temp / dewpoint
          const tm = /\b(M?\d{2})\/(M?\d{2})\b/.exec(raw);
          if (tm) {
            const t = tm[1].replace('M', '-'), d = tm[2].replace('M', '-');
            out.push(`Temperature ${t}°C / Dewpoint ${d}°C`);
          }
          // QNH
          const qm = /\bQ(\d{4})\b/.exec(raw);
          if (qm) out.push(`QNH ${qm[1]} hPa`);
          const am = /\bA(\d{4})\b/.exec(raw);
          if (am) out.push(`Altimeter ${(Number(am[1]) / 100).toFixed(2)} inHg`);
          // NOSIG / TEMPO / BECMG
          if (/\bNOSIG\b/.test(raw)) out.push('No significant change expected');
          return out;
        };
        // -----------------------------------------------------------------
        const wxCard = (a: any) => (a.metar || a.taf) ? (
          <View style={st.card}>
            <View style={st.hRow}>
              <Text style={st.hIn}>Weather — {a.icao}</Text><View style={{ flex: 1 }} />
              <TouchableOpacity style={{ paddingVertical: 6, paddingHorizontal: 8, backgroundColor: wxDecode ? T.accent + '22' : 'transparent', borderRadius: 6, marginRight: 6 }} onPress={() => setWxDecode(d => !d)}>
                <Text style={{ color: wxDecode ? T.accent : T.sub, fontWeight: '700', fontSize: 12 }}>{wxDecode ? '✓ Decoded' : '⚡ Decode'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ paddingVertical: 6, paddingHorizontal: 4 }} disabled={wxBusy} onPress={doWxRefresh}>
                <Text style={{ color: T.accent, fontWeight: '700', fontSize: 13 }}>{wxBusy ? '⟳ Fetching…' : '⟳ Refresh WX'}</Text>
              </TouchableOpacity>
            </View>
            {a.metar ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={wxCap}>METAR</Text>
                  {metarObs(a.metar) ? <Text style={wxSubCap}>{metarObs(a.metar)}</Text> : null}
                </View>
                <Text style={{ color: T.entry, fontFamily: 'monospace' as any, fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 3 }}>{a.metar}</Text>
                {wxDecode ? <View style={{ marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: T.accent + '44' }}>
                  {decodeWx(a.metar).map((line, i) => <Text key={i} style={{ color: T.text, fontSize: 12, lineHeight: 18 }}>{line}</Text>)}
                </View> : null}
              </View>) : null}
            {a.taf ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={wxCap}>TAF</Text>
                  {tafValidity(a.taf) ? <Text style={wxSubCap}>{tafValidity(a.taf)}</Text> : null}
                </View>
                <Text style={{ color: T.text, fontFamily: 'monospace' as any, fontSize: 12.5, lineHeight: 18, marginTop: 3 }}>{a.taf}</Text>
                {wxDecode ? <View style={{ marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: T.accent + '44' }}>
                  {decodeWx(a.taf).map((line, i) => <Text key={i} style={{ color: T.text, fontSize: 12, lineHeight: 18 }}>{line}</Text>)}
                </View> : null}
              </View>) : null}
          </View>) : null;
        let items: any[] = []; let head: any = null;
        if (wxTab === 'marks') {
          const all = [...['dep', 'dest', 'alt1', 'alt2', 'alt3', 'add1', 'add2'].flatMap((k) => (wn[k]?.notams || [])), ...(wn.fir_notams || [])];
          items = all.filter((n) => marks[nkey(n)]);
        } else if (wxTab === 'fir') {
          items = wn.fir_notams || [];
        } else {
          const a = wn[wxTab];
          head = a ? (
            <View>
              {a.additional ? <Text style={{ color: T.amber, fontSize: 12, marginTop: 12, lineHeight: 18 }}>Additional / planning alternate — not a destination alternate. The plan carries routing only; weather is shown from live data and airport NOTAMs are covered by the FIR tab.</Text> : null}
              {wxCard(a)}
              {!a.metar && !a.taf ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <Text style={{ color: T.sub, fontSize: 13 }}>No live weather for {a.icao} yet.</Text>
                  <TouchableOpacity disabled={wxBusy} onPress={doWxRefresh}>
                    <Text style={{ color: T.accent, fontWeight: '700', fontSize: 13 }}>{wxBusy ? '⟳ Fetching…' : '⟳ Refresh WX'}</Text>
                  </TouchableOpacity>
                </View>) : null}
            </View>
          ) : (
            <Text style={{ color: T.sub, marginTop: 14 }}>No {wxTab.toUpperCase()} alternate in this flight plan.</Text>);
          items = a?.notams || [];
        }
        const counts: Record<string, number> = {};
        for (const n of items) counts[cat(n)] = (counts[cat(n)] || 0) + 1;
        const shown = items.filter((n) => wxCat === 'all' || cat(n) === wxCat);
        if (!wn.dep && !wn.dest) return (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: T.sub }}>WX & NOTAMs arrive with the PPS flight plan — none received for this flight yet.</Text>
            <TouchableOpacity style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 4 }} disabled={wxBusy} onPress={doWxRefresh}>
              <Text style={{ color: T.accent, fontWeight: '700', fontSize: 14 }}>{wxBusy ? '⟳ Fetching weather…' : '⟳ Refresh WX now'}</Text>
            </TouchableOpacity>
          </View>);
        return (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#1c3050', borderRadius: 999, borderWidth: 1, borderColor: T.accent, opacity: wxBusy ? 0.6 : 1 }}
                disabled={wxBusy} onPress={doWxRefresh}>
                {wxBusy ? <ActivityIndicator size="small" color={T.accent} /> : null}
                <Text style={{ color: T.accent, fontWeight: '800', fontSize: 13 }}>{wxBusy ? 'Fetching weather…' : '⟳ Refresh WX'}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {TABS.map(([k, label, n]) => { const on = wxTab === k;
                return (
                  <TouchableOpacity key={k} onPress={() => { setWxTab(k); setWxCat('all'); }}
                    style={{ borderWidth: 1, borderColor: on ? T.accent : T.line, backgroundColor: on ? T.accent : T.card,
                             borderRadius: 999, paddingHorizontal: 15, minHeight: 40, justifyContent: 'center',
                             opacity: on || n ? 1 : 0.5 }}>
                    <Text style={{ color: on ? '#0b1526' : T.sub, fontWeight: on ? '800' : '700', fontSize: 13 }}>{label}</Text>
                  </TouchableOpacity>); })}
            </View>
            {wxTab !== 'marks' ? (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                {CATS.map((c) => { const n = c === 'all' ? items.length : (counts[c] || 0); const on = wxCat === c;
                  return (
                    <TouchableOpacity key={c} disabled={!n && c !== 'all'} onPress={() => setWxCat(c)}
                      style={{ borderWidth: 1, borderColor: on ? T.accent : '#1e3151', backgroundColor: on ? 'rgba(74,163,223,0.14)' : 'transparent',
                               borderRadius: 999, paddingHorizontal: 11, minHeight: 40, justifyContent: 'center', opacity: n || c === 'all' ? 1 : 0.35 }}>
                      <Text style={{ color: on ? T.accent : T.sub, fontSize: 12, fontWeight: on ? '700' : '600' }}>{c === 'all' ? 'All' : c}{n ? ` (${n})` : ''}</Text>
                    </TouchableOpacity>); })}
              </View>) : null}
            {head}
            {shown.length ? shown.map(notamCard) : <Text style={{ color: T.sub, marginTop: 14 }}>{wxTab === 'marks' ? 'No bookmarked NOTAMs — tap 🏷️ on any NOTAM to bookmark it.' : 'No NOTAMs in this category.'}</Text>}
          </View>);
      })();
      case 'pre': return (
        <View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {(['form', 'security', 'gendec'] as const).map((t2) => (
              <TouchableOpacity key={t2} onPress={() => setPreTab(t2)}
                style={{ borderWidth: 1, borderColor: preTab === t2 ? T.accent : T.line, backgroundColor: preTab === t2 ? '#1c3050' : T.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                <Text style={{ color: preTab === t2 ? '#fff' : T.sub, fontWeight: '700', fontSize: 13 }}>{t2 === 'form' ? 'Pre-flight' : t2 === 'security' ? 'Security' : 'GEN DEC'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {preTab === 'security' ? (
            <View>
              <View style={st.card}><Text style={st.h}>Previous departure airport</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <F s="security" k="prev_dep" label="Previous departure airport" ph="ICAO" w={180} />
                  <TouchableOpacity style={[st.btn, { marginTop: 0, marginBottom: 2 }]} onPress={async () => {
                    const upd: any = {};
                    if (f.prev_dep) upd.prev_dep = f.prev_dep;
                    if (f.prev_fuel_kg != null) upd.landing_fuel = String(Math.round(f.prev_fuel_kg));
                    if (!Object.keys(upd).length) { setMsg('Nothing to retrieve from Leon yet', true); return; }
                    setRep((p: any) => ({ ...p, security: { ...(p.security || {}), ...upd },
                      pre: { ...(p.pre || {}), before_fuel: upd.landing_fuel ?? (p.pre || {}).before_fuel } }));
                    try { await saveReport(flight.id, 'security', upd);
                      if (upd.landing_fuel) await saveReport(flight.id, 'pre', { before_fuel: upd.landing_fuel }); setMsg(''); }
                    catch (e: any) { setMsg(e.message); }
                  }}><Text style={st.btnTxt}>⟳ Retrieve previous departure airport and landing fuel</Text></TouchableOpacity>
                </View>
              </View>
              <View style={st.card}><Text style={st.h}>Interior</Text>
                {[['int_overhead', 'Overhead bins'],
                  ['int_cupboard', 'Cupboard and storage compartments, including crew storage areas'],
                  ['int_toilet', 'Toilet compartments'],
                  ['int_galley', 'Galley areas'],
                  ['int_seat_pockets', 'Seat pockets'],
                  ['int_under_seats', 'Areas under seats, between seats and between the seat and the wall'],
                  ['int_flight_deck', 'Flight deck, if left unattended'],
                  ['int_lifejackets', 'Between 5% and 10% of lifejacket pouches']].map(([k2, label]) => (
                  <View key={k2} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <Text style={{ color: T.text, fontSize: 14, flex: 1, paddingRight: 12 }}>{label}</Text>
                    <TouchableOpacity onPress={async () => { const v = rep?.security?.[k2] === 'YES' ? '' : 'YES'; set('security', k2, v); try { await saveReport(flight.id, 'security', { [k2]: v }); } catch {} }}
                      style={{ width: 52, height: 28, borderRadius: 14, backgroundColor: rep?.security?.[k2] === 'YES' ? '#153524' : T.inBg, borderWidth: 1, borderColor: rep?.security?.[k2] === 'YES' ? T.green : T.line, justifyContent: 'center' }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: rep?.security?.[k2] === 'YES' ? T.green : '#4a5f80', marginLeft: rep?.security?.[k2] === 'YES' ? 26 : 3 }} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={[st.card, { zIndex: 30 }]}><Text style={st.h}>Aircraft security search</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {['Security Search performed', 'Not performed'].map((o) => (
                    <TouchableOpacity key={o} onPress={async () => { set('security', 'search_type', o); try { await saveReport(flight.id, 'security', { search_type: o }); } catch {} }}
                      style={{ borderWidth: 1, borderColor: rep?.security?.search_type === o ? (o === 'Not performed' ? T.amber : T.accent) : T.line, backgroundColor: rep?.security?.search_type === o ? (o === 'Not performed' ? '#33290f' : '#1c3050') : T.inBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                      <Text style={{ color: rep?.security?.search_type === o ? '#fff' : T.sub, fontSize: 13, fontWeight: '700' }}>{o}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: T.sub, fontSize: 13, marginTop: 12 }}>{rep?.security?.search_type === 'Not performed'
                  ? 'Recorded as NOT performed. State the reason in the remarks/security form and brief the commander.'
                  : 'By signing this Aircraft Security Search, the Commander certifies that the appropriate security search has been performed without findings.'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <F s="security" k="signed_time" label="Signed time (UTC, HH:MM)" ph="--:--" w={170} />
                  <TouchableOpacity style={[st.btnSec, { marginTop: 0, marginBottom: 2 }]} onPress={async () => {
                    const t = new Date().toISOString().slice(11, 16); set('security', 'signed_time', t);
                    try { await saveReport(flight.id, 'security', { signed_time: t }); } catch {}
                  }}><Text style={st.btnSecTxt}>now</Text></TouchableOpacity>
                  <CodeCombo label="3-letter code" width={150} required
                    value={String(rep?.security?.code3 ?? '')}
                    options={Array.from(new Set((f.crew || []).map((c: any) => c.code).filter(Boolean)))}
                    onSet={(v: string) => set('security', 'code3', v)}
                    onSave={async (v: string) => { try { await saveReport(flight.id, 'security', { code3: v }); } catch {} }} />
                </View>
              </View>
              <View style={st.card}><Text style={st.h}>Security form photo</Text>
                <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="security_form" label="Security form photo (if a paper form was completed)" />
              </View>
            </View>
          ) : preTab === 'gendec' ? (
            <GendecTab flight={f} d={d} load={load} setRep={setRep} setMsg={setMsg} locked={locked} />
          ) : (
          <View>
          <View style={st.card}><Text style={st.h}>Alternates</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <F s="pre" k="alt1" label="Alternate 1" ph="ICAO" w={140} /><F s="pre" k="alt2" label="Alternate 2" ph="ICAO" w={140} /><F s="pre" k="to_alt" label="Take-off alternate" ph="ICAO" w={160} />
            </View></View>
          <View style={st.card}><Text style={st.h}>On-ground check</Text>
            <YN s="pre" k="ground_check" label="With the latest QNH set, maximum altimeter difference is within 75 ft" /></View>
          <View style={st.card}><Text style={st.h}>Planned fuel (kg) — from the OFP</Text>
            <Text style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Auto-filled once the PPS briefing connects; until then dispatch/crew may type from the OFP.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <F s="planned" k="trip" label="Trip" kb="numeric" w={110} />
              <F s="planned" k="contingency" label="Contingency" kb="numeric" w={120} />
              <F s="planned" k="alt1" label="Primary alternate" kb="numeric" w={140} />
              <F s="planned" k="alt2" label="Secondary alternate" kb="numeric" w={150} />
              <F s="planned" k="final_res" label="Final reserve" kb="numeric" w={120} />
              <F s="planned" k="additional" label="Additional" kb="numeric" w={110} />
              <F s="planned" k="extra" label="Extra" kb="numeric" w={110} />
              <F s="planned" k="discretionary" label="Discretionary" kb="numeric" w={125} />
              <F s="planned" k="taxi" label="Taxi" kb="numeric" w={110} />
              <F s="planned" k="block" label="Planned block" kb="numeric" w={130} />
              <F s="planned" k="min_req_land" label="Min req land" kb="numeric" w={130} />
            </View></View>
          <View style={st.card}><Text style={st.h}>Fuel</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <F s="pre" k="before_fuel" label="Before fuelling (kg)" kb="numeric" w={170} />
              <View style={{ marginRight: 14, marginBottom: 2 }}>
                <TouchableOpacity style={[st.btnSec, { marginTop: 0 }]} onPress={async () => {
                  if (f.prev_fuel_kg == null) { setMsg('No previous-flight landing fuel in Leon yet'); return; }
                  set('pre', 'before_fuel', String(Math.round(f.prev_fuel_kg)));
                  try { await saveReport(flight.id, 'pre', { before_fuel: String(Math.round(f.prev_fuel_kg)) }); setMsg(''); } catch (e: any) { setMsg(e.message); }
                }}><Text style={st.btnSecTxt}>⟳ From previous flight{f.prev_fuel_kg != null ? ` (${Math.round(f.prev_fuel_kg)} kg · Leon)` : ''}</Text></TouchableOpacity>
              </View>
              <F s="pre" k="uplift_l" label="Fuel uplift in slip(s) (L)" kb="numeric" w={170} />
              <F s="pre" k="density" label="Density" ph="0.785" kb="numeric" w={100} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <View style={{ marginRight: 14 }}>
                <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} />
              </View>
              <F s="pre" k="fuel_slip_no" label="Fuel slip №" ph="auto from photo" w={160} />
              <F s="pre" k="supplier" label="Fuel supplier" ph="auto from photo" w={180} />
              <F s="pre" k="block_fuel" label="Actual block fuel (kg)" kb="numeric" w={170} />
            </View>
            {(() => { const p = rep?.pre || {}; const calc = (Number(p.before_fuel) || 0) + (Number(p.uplift_l) || 0) * (Number(p.density) || 0.785);
              const diff = p.block_fuel ? Math.round(Number(p.block_fuel) - calc) : null;
              const plannedBlock = Number(rep?.planned?.block);
              const extraKg = plannedBlock && p.block_fuel ? Math.round(Number(p.block_fuel) - plannedBlock) : null;
              return (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                  <View style={{ width: 200, marginRight: 14 }}>
                    <Text style={st.lbl}>Calculated block fuel (kg)</Text>
                    <Text style={{ color: T.text, fontWeight: '800', fontSize: 17, marginTop: 4, fontVariant: ['tabular-nums'] as any }}>{Math.round(calc)}</Text>
                  </View>
                  <View style={{ width: 220 }}>
                    <Text style={st.lbl}>Difference in block fuel (kg)</Text>
                    <Text style={{ color: diff == null ? T.sub : Math.abs(diff) > 200 ? '#f0a3a3' : '#9fd6ae', fontWeight: '800', fontSize: 17, marginTop: 4, fontVariant: ['tabular-nums'] as any }}>{diff == null ? '—' : diff > 0 ? `+${diff}` : diff}</Text>
                  </View>
                </View>); })()}
            {(() => { const plannedBlock = Number(rep?.planned?.block); const extraKg = plannedBlock && rep?.pre?.block_fuel ? Math.round(Number(rep.pre.block_fuel) - plannedBlock) : null;
              return extraKg != null && extraKg > 100 && !rep?.pre?.extra_reason ? (
                <Text style={{ color: '#f0d48a', marginTop: 10, fontWeight: '700' }}>Block fuel is {extraKg} kg above the planned block — select the reason for the extra fuel below.</Text>
              ) : null; })()}
            <Text style={st.lbl}>Reason for extra fuel</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {['WX', 'ATC', 'Alternate', 'Tankering', 'De-/anti-icing', 'Technical', 'Commander decision', 'Other', 'None'].map((o) => (
                <TouchableOpacity key={o} onPress={async () => { set('pre', 'extra_reason', o); try { await saveReport(flight.id, 'pre', { extra_reason: o }); } catch {} }}
                  style={{ borderWidth: 1, borderColor: rep?.pre?.extra_reason === o ? T.accent : T.line, backgroundColor: rep?.pre?.extra_reason === o ? '#1c3050' : T.inBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                  <Text style={{ color: rep?.pre?.extra_reason === o ? '#fff' : T.sub, fontSize: 13, fontWeight: '700' }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {rep?.pre?.extra_reason === 'Other' ? (
              <F s="pre" k="extra_reason_note" label="Reason for extra fuel — specify" ph="type the reason" w={420} />
            ) : null}
          </View>
          <View style={st.card}><Text style={st.h}>Passengers & bags</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <F s="pre" k="pax_m" label="Male / adults" kb="numeric" w={120} /><F s="pre" k="pax_f" label="Female" kb="numeric" w={120} />
              <F s="pre" k="pax_c" label="Children" kb="numeric" w={120} /><F s="pre" k="pax_i" label="Infants" kb="numeric" w={120} />
              {(() => { const p = rep?.pre || {};
                const total = ['pax_m', 'pax_f', 'pax_c', 'pax_i'].reduce((a, k) => a + (Number(p[k]) || 0), 0);
                const any = ['pax_m', 'pax_f', 'pax_c', 'pax_i'].some((k) => p[k] != null && p[k] !== '');
                return (
                  <View style={{ width: 120, marginRight: 16 }}>
                    <Text style={st.lbl}>Total (incl. infants)</Text>
                    <View style={[st.input, { justifyContent: 'center', backgroundColor: '#0e1a30', borderColor: T.line }]}>
                      <Text style={{ color: T.text, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] as any }}>{any ? total : '—'}</Text>
                    </View>
                  </View>); })()}
              <F s="pre" k="bags" label="Number of bags" kb="numeric" w={130} />
            </View></View>
          <View style={st.card}><Text style={st.h}>Document photos</Text>
            <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="to_perf" label="Take-off performance" />
            <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="loadsheet" label="Final loadsheet" />
            <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="notoc" label="NOTOC (if carried)" />
            <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="other1" label="Other document 1" />
            <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="other2" label="Other document 2" />
          </View>
          </View>)}
        </View>);
      case 'etl': return (() => {
        const tok = getEtlToken();
        return (
          <View style={st.card}><Text style={st.h}>Electronic Tech Log</Text>
            <Text style={{ color: T.sub, fontSize: 13.5, lineHeight: 20, marginTop: 10 }}>
              Opens the Electronic Tech Log on {f.registration} at this flight — {f.flight_no} {f.date}. It goes straight to the
              Departure page, starting the sector from this briefing if it hasn&apos;t been opened yet (so ACMI legs not in Leon
              still open directly). If another flight is already open, it takes you to Flight Details to close that one first.
            </Text>
            {tok ? (
              <TouchableOpacity style={[st.btn, { alignSelf: 'flex-start' }]}
                onPress={() => openEtlInApp(f, navigation, tok, setMsg)}>
                <Text style={st.btnTxt}>🛠️ Open ETL — {f.registration}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: '#f0d48a', fontSize: 13, lineHeight: 19, marginTop: 12 }}>
                No ETL session on this device — sign out and sign in again to enable the ETL hand-off.
              </Text>
            )}
          </View>);
      })();
      case 'atisdep': return (
        <View style={st.card}><Text style={st.h}>ATIS / Clearance — departure</Text>
          <F s="atisdep" k="atis" label="ATIS information" w={640} />
          <F s="atisdep" k="clearance" label="ATC clearance" w={640} />
          <F s="atisdep" k="notes" label="Notes" w={640} />
        </View>);
      case 'signpre': return <SignCard kind="preflight" flight={f} done={d?.acceptance} rep={rep} secs={['pre', 'atisdep']} onDone={load} setMsg={setMsg} setRep={setRep} />;
      case 'offblock': {
        const dcList = getDelayCodes();
        const DCPick = ({ n }: { n: number }) => {
          const mk = `delay${n}_code`;
          const cur = rep?.offblock?.[mk] ?? '';
          const label = cur ? dcList.find((d) => d.code === cur) : null;
          const [open, setOpen] = useState(false);
          return (
            <View style={{ marginBottom: 8 }}>
              <TouchableOpacity onPress={() => setOpen(!open)}
                style={{ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: T.inBorder, backgroundColor: T.inBg, minWidth: 200 }}>
                <Text style={{ color: cur ? T.text : T.sub, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
                  {label ? `${label.code} — ${label.description}` : '— delay code —'}</Text>
                <Text style={{ color: T.sub, fontSize: 10 }}>{open ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {open ? (
                <ScrollView style={{ maxHeight: 220, borderWidth: 1, borderColor: T.inBorder, borderRadius: 6, marginTop: 2, backgroundColor: T.card }}>
                  <TouchableOpacity onPress={() => { set('offblock', mk, ''); saveReport(f.id, 'offblock', { [mk]: '' }).catch(() => {}); setOpen(false); }}
                    style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: T.line }}>
                    <Text style={{ color: T.sub, fontSize: 12.5 }}>— none —</Text>
                  </TouchableOpacity>
                  {dcList.map((d) => (
                    <TouchableOpacity key={d.code} onPress={() => { set('offblock', mk, d.code); saveReport(f.id, 'offblock', { [mk]: d.code }).catch(() => {}); setOpen(false); }}
                      style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: d.code === cur ? T.accent + '22' : 'transparent' }}>
                      <Text style={{ color: T.text, fontSize: 12.5 }}>{d.code} — {d.description}</Text>
                      {d.category ? <Text style={{ color: T.sub, fontSize: 10 }}>{d.category}</Text> : null}
                    </TouchableOpacity>))}
                </ScrollView>) : null}
            </View>);
        };
        return (
          <View>
            <View style={st.card}><Text style={st.h}>Times (UTC)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <F s="offblock" k="off_block" label="OFF block (HH:MM)" ph="--:--" w={150} time />
                <F s="offblock" k="takeoff" label="Take-off (HH:MM)" ph="--:--" w={150} time />
              </View>
            </View>
            <View style={st.card}><Text style={st.h}>Delays</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                {[1, 2, 3].map((n) => (
                  <View key={n} style={{ minWidth: 120 }}>
                    <F s="offblock" k={`delay${n}`} label={`Delay ${n} (min)`} kb="numeric" w={110} />
                    <DCPick n={n} />
                  </View>))}
              </View>
            </View>
            <View style={st.card}><Text style={st.h}>De- / anti-icing</Text>
              <YN s="offblock" k="deice" label="De-/anti-icing applied" />
              {rep?.offblock?.deice === 'YES' ? <YN s="offblock" k="manual_hot" label="Manual holdover time" /> : null}
            </View>
          </View>); }
      case 'rvsm': return (
        <View style={st.card}><Text style={st.h}>Prior entering RVSM airspace (FCOM-PRO-SPO-50)</Text>
          <YN s="rvsm" k="q1" label="Two primary altimeters within limits, cross-checked" />
          <YN s="rvsm" k="q2" label="One automatic altitude-keeping system operative" />
          <YN s="rvsm" k="q3" label="Primary altimeters are scanned during flight in RVSM airspace" />
          <YN s="rvsm" k="q4" label="Altitude-alerting system operative" />
        </View>);
      case 'navlog': return <NavLogScreen flight={f} back={() => setSec('briefing')} embedded onSetRail={setRailOpen} />;
      case 'enroute': return (
        <View>
          <View style={st.card}><Text style={st.h}>Enroute · Weather · Notes</Text>
            <F s="enroute" k="enroute" label="Enroute notes" w={640} />
          </View>
          <PhotoBox flight={f} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="ldg_perf" label="Landing performance" />
        </View>);
      case 'atisarr': {
        // ICAO Doc 8168 low-temperature altitude correction
        // ISA at elevation = 15 - (elev_ft × 0.0019812)
        // Correction = (published_alt - elev) × (ISA - OAT) / (273 + OAT)
        const lt = rep?.atisarr || {};
        const oat = lt.lt_temp !== undefined && lt.lt_temp !== '' ? Number(lt.lt_temp) : null;
        const elev = lt.lt_elev !== undefined && lt.lt_elev !== '' ? Number(lt.lt_elev) : null;
        const isa = elev != null ? Math.round((15 - elev * 0.0019812) * 10) / 10 : null;
        const corr = (pub: string | undefined) => {
          const p = pub !== undefined && pub !== '' ? Number(pub) : null;
          if (p == null || oat == null || elev == null || isa == null) return '-';
          const c = (p - elev) * (isa - oat) / (273 + oat);
          return `${Math.round(p + c)} ft (+${Math.round(c)} ft)`;
        };
        const LTF = ({ k, label: lb }: { k: string; label: string }) => (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: T.sub, fontSize: 12.5, marginBottom: 3 }}>{lb}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TextInput style={[st.input, { width: 120 }]} value={lt[k] ?? ''} placeholder="ft" placeholderTextColor={T.sub}
                keyboardType="numeric"
                onChangeText={(v) => set('atisarr', k, v.replace(/[^0-9]/g, ''))}
                onBlur={() => { const v = lt[k]; if (v !== undefined) saveReport(f.id, 'atisarr', { [k]: v }).catch(() => {}); }} />
              <Text style={{ color: T.entry, fontWeight: '700', fontSize: 13 }}>{corr(lt[k])}</Text>
            </View>
          </View>
        );
        const ATABS: [string, string][] = [['dest', 'ATIS Dest'], ['alt', 'ATIS Alt'], ['clr', 'Clearance'], ['lt', 'LT Alt Corr']];
        const atN = (k: string) => { if (k === 'dest') return !lt.atis_dest ? 1 : 0; if (k === 'alt') return !lt.atis_alt ? 1 : 0; if (k === 'clr') return !lt.clearance ? 1 : 0; return 0; };
        return (
          <View style={st.card}>
            <Text style={st.h}>ATIS / Clearance / Notes</Text>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: T.inBorder, marginBottom: 10, gap: 4 }}>
              {ATABS.map(([k, lb]) => { const on = atisArrTab === k; const n = atN(k); return (
                <TouchableOpacity key={k} onPress={() => setAtisArrTab(k)}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: on ? T.accent : 'transparent' }}>
                  <Text style={{ color: on ? T.accent : T.sub, fontWeight: on ? '700' : '500', fontSize: 13 }}>{lb}{n ? ` ❶` : ''}</Text>
                </TouchableOpacity>); })}
            </View>
            {atisArrTab === 'dest' ? <F s="atisarr" k="atis_dest" label="ATIS — destination" w={640} /> : null}
            {atisArrTab === 'alt' ? <F s="atisarr" k="atis_alt" label="ATIS — alternate" w={640} /> : null}
            {atisArrTab === 'clr' ? <F s="atisarr" k="clearance" label="Clearance" w={640} /> : null}
            {atisArrTab === 'lt' ? (
              <View>
                <Text style={{ color: T.text, fontWeight: '700', fontSize: 14, marginBottom: 6 }}>Low Temperature Altitude Correction</Text>
                <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
                  <View>
                    <Text style={{ color: T.sub, fontSize: 12.5, marginBottom: 3 }}>Ground Air Temperature (°C)</Text>
                    <TextInput style={[st.input, { width: 120 }]} value={lt.lt_temp ?? ''} placeholder="°C" placeholderTextColor={T.sub}
                      keyboardType="numbers-and-punctuation"
                      onChangeText={(v) => set('atisarr', 'lt_temp', v.replace(/[^0-9\-\.]/g, ''))}
                      onBlur={() => { const v = lt.lt_temp; if (v !== undefined) saveReport(f.id, 'atisarr', { lt_temp: v }).catch(() => {}); }} />
                  </View>
                  <View>
                    <Text style={{ color: T.sub, fontSize: 12.5, marginBottom: 3 }}>Airport Elevation (ft)</Text>
                    <TextInput style={[st.input, { width: 120 }]} value={lt.lt_elev ?? ''} placeholder="ft" placeholderTextColor={T.sub}
                      keyboardType="numeric"
                      onChangeText={(v) => set('atisarr', 'lt_elev', v.replace(/[^0-9]/g, ''))}
                      onBlur={() => { const v = lt.lt_elev; if (v !== undefined) saveReport(f.id, 'atisarr', { lt_elev: v }).catch(() => {}); }} />
                  </View>
                  <View>
                    <Text style={{ color: T.sub, fontSize: 12.5, marginBottom: 3 }}>ISA</Text>
                    <Text style={{ color: T.entry, fontWeight: '700', fontSize: 15, paddingVertical: 8 }}>{isa != null ? `${isa}°C` : '-'}</Text>
                  </View>
                </View>
                <LTF k="lt_faf" label="FAF" />
                <LTF k="lt_om" label="OM / NDB or Equivalent" />
                <LTF k="lt_dadh" label="DA / DH" />
                <LTF k="lt_mdamdh" label="MDA / MDH" />
                <LTF k="lt_circuit" label="Circuit" />
              </View>
            ) : null}
          </View>); }
      case 'post': return (
        <View>
          <View style={st.card}><Text style={st.h}>Times (UTC)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <F s="post" k="landing" label="Landing (HH:MM)" ph="--:--" w={150} time />
              <F s="post" k="on_block" label="ON block (HH:MM)" ph="--:--" w={150} time />
            </View>
            {(() => { const ob = rep?.offblock || {}, po = rep?.post || {};
              const mins = (a?: string, b?: string) => { if (!a || !b || !/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return null;
                let m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3)); if (m < 0) m += 1440; return m; };
              const blk = mins(ob.off_block, po.on_block), air = mins(ob.takeoff, po.landing);
              const hm = (m: number | null) => m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
              return <Text style={{ color: T.sub, marginTop: 8 }}>Block <Text style={{ color: T.text, fontWeight: '700' }}>{hm(blk)}</Text> · airborne <Text style={{ color: T.text, fontWeight: '700' }}>{hm(air)}</Text></Text>; })()}
          </View>
          <View style={st.card}><Text style={st.h}>Handling</Text>
            {(() => {
              const pilots: any[] = (f.crew || []).filter((c: any) => c.role === 'CPT' || c.role === 'FO').length
                ? (f.crew || []).filter((c: any) => c.role === 'CPT' || c.role === 'FO')
                : [{ code: 'CPT', name: 'Captain', role: 'CPT' }, { code: 'FO', name: 'First Officer', role: 'FO' }];
              const idOf = (c: any) => c.code || c.role;
              // Two-pilot crew: picking one role auto-assigns the other pilot to the opposite role.
              const pick = async (k2: 'pf' | 'pm', c: any) => {
                const other = k2 === 'pf' ? 'pm' : 'pf';
                const mate = pilots.find((p) => idOf(p) !== idOf(c));
                const patch: any = { [k2]: idOf(c) };
                set('post', k2, idOf(c));
                if (pilots.length === 2 && mate) { patch[other] = idOf(mate); set('post', other, idOf(mate)); }
                try { await saveReport(flight.id, 'post', patch); } catch {}
              };
              return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(['pf', 'pm'] as const).map((k2) => {
                const picked = rep?.post?.[k2];
                const missing = !picked;
                return (
                <View key={k2} style={{ marginRight: 18 }}>
                  <Text style={st.lbl}>{missing ? <Text style={{ color: T.red }}>* </Text> : null}{k2 === 'pf' ? 'Pilot flying' : 'Pilot monitoring'}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    {pilots.map((c: any) => (
                      <TouchableOpacity key={c.code + c.role} onPress={() => pick(k2, c)}
                        style={{ borderWidth: 1, borderColor: picked === idOf(c) ? T.accent : missing ? T.red : T.line, backgroundColor: picked === idOf(c) ? '#1c3050' : T.inBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                        <Text style={{ color: picked === idOf(c) ? '#fff' : T.sub, fontSize: 13, fontWeight: '700' }}>{c.role} {c.code || ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>);
              })}
              <F s="post" k="landings" label="Landings" kb="numeric" ph="1" w={100} />
              <F s="post" k="diversion" label="Diversion (or NIL)" ph="NIL" w={150} />
            </View>); })()}
            <YN s="post" k="lvo" label="LVO" /><YN s="post" k="autoland" label="Automatic landing" />
          </View>
          <View style={st.card}><Text style={st.h}>Fuel</Text>
            <F s="post" k="parking_fuel" label="Parking fuel (kg)" kb="numeric" w={170} />
            {(() => { const blk = Number(rep?.pre?.block_fuel), park = Number(rep?.post?.parking_fuel);
              return blk && park ? <Text style={{ color: T.sub, marginTop: 8 }}>Fuel used: <Text style={{ color: T.text, fontWeight: '700' }}>{Math.round(blk - park)} kg</Text></Text> : null; })()}
          </View>
        </View>);
      case 'signpost': return <SignCard kind="postflight" flight={f} done={d?.acceptance_post} rep={rep} secs={['offblock', 'rvsm', 'post']} onDone={load} setMsg={setMsg} setRep={setRep} />;
      case 'help': return <HelpPage />;
    }
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, flexDirection: 'row' }}>
      {railOpen ? (
      <ScrollView style={{ width: 248, minWidth: 248, maxWidth: 248, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: T.line, backgroundColor: '#101c33' } as any} contentContainerStyle={{ padding: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Image source={logoSrc} style={{ width: 120, height: 26, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 6, marginLeft: 6 } as any} />
          <TouchableOpacity onPress={() => setRailOpen(false)} style={{ padding: 6 }} accessibilityLabel="Collapse menu"><Text style={{ color: T.sub, fontSize: 18 }}>⟨</Text></TouchableOpacity>
        </View>
        <TouchableOpacity onPress={back}><Text style={{ color: T.accent, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 10 }}>‹ My flights</Text></TouchableOpacity>
        <OfflineBadge />
        <Text style={{ color: T.text, fontWeight: '800', paddingHorizontal: 6, fontSize: 15 }}>{f.flight_no}</Text>
        <Text style={{ color: T.accent, paddingHorizontal: 6, fontSize: 13 }}>{f.dep} → {f.arr} · {f.registration}</Text>
        <Text style={{ color: T.sub, paddingHorizontal: 6, fontSize: 12.5, marginBottom: 4 }}>{f.date}{f.std ? ` · STD ${String(f.std).slice(11, 16)}z` : ''}</Text>
        {RAIL.map((r) => {
          const n = r.key === 'signpre' ? (d?.acceptance ? 0 : 1) : r.key === 'signpost' ? (d?.acceptance_post ? 0 : 1) : missing(rep, r.key).length;
          const done = n === 0 && (requiredFor(r.key).length > 0 || r.key === 'signpre' || r.key === 'signpost');
          return (
            <View key={r.key}>
              {r.group ? <Text style={{ color: T.sub, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 14, marginBottom: 4, marginLeft: 10 }}>{r.group}</Text> : null}
              <TouchableOpacity onPress={() => setSec(r.key)}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 9, marginBottom: 1,
                         backgroundColor: sec === r.key ? '#1c3050' : undefined,
                         borderLeftWidth: 3, borderLeftColor: sec === r.key ? T.accent : 'transparent' }}>
                <Text style={{ width: 26, fontSize: 14, textAlign: 'center' }}>{r.icon}</Text>
                <Text style={{ color: sec === r.key ? '#fff' : T.text, fontSize: 13, flex: 1, fontWeight: sec === r.key ? '700' : '400' }}>{r.label}</Text>
                {n > 0 ? <View style={{ backgroundColor: T.amber, borderRadius: 9, minWidth: 18, alignItems: 'center', paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: '#111', fontSize: 10.5, fontWeight: '800' }}>{n}</Text></View>
                  : done ? <Text style={{ color: T.green, fontWeight: '800' }}>✓</Text> : null}
              </TouchableOpacity>
            </View>);
        })}
        {/* EFB deep links: open Flysmart+ / Jepp FD Pro. iPad-only (custom URL schemes).
            On web, show the buttons as disabled with a note.
            URLs are admin-set (Back office → Settings). */}
        {(() => {
          const dl = getDeepLinks();
          if (!dl.flysmart && !dl.jepp) return null;
          const isWeb = Platform.OS === 'web';
          const openEfb = async (kind: string) => {
            if (isWeb) { setMsg('EFB apps are available on iPad only.'); return; }
            let url = dl[kind];
            if (url && !url.includes('://')) url += '://';
            if (kind === 'jepp') {
              const route = String(f?.atc_route || '').trim();
              if (route) { try { (require('react-native') as any).Clipboard?.setString?.(route); setMsg('ATC route copied — paste it into FliteDeck.'); } catch {} }
            }
            try { await Linking.openURL(url); } catch { setMsg('Could not open — is the app installed on this iPad?'); }
          };
          const row = (kind: string, icon: string, label: string, sub?: string) => (
            <TouchableOpacity key={kind} onPress={() => openEfb(kind)} disabled={isWeb}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 9, marginBottom: 1, borderLeftWidth: 3, borderLeftColor: 'transparent', opacity: isWeb ? 0.45 : 1 }}>
              <Text style={{ width: 26, fontSize: 14, textAlign: 'center' }}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: T.text, fontSize: 13 }}>{label} <Text style={{ color: T.sub, fontSize: 11 }}>↗</Text></Text>
                {sub ? <Text style={{ color: T.sub, fontSize: 10.5 }}>{sub}</Text> : null}
              </View>
            </TouchableOpacity>
          );
          return (
            <View>
              <Text style={{ color: T.sub, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 14, marginBottom: 4, marginLeft: 10 }}>EFB apps</Text>
              {dl.flysmart ? row('flysmart', '✈️', 'Flysmart+') : null}
              {dl.jepp ? row('jepp', '🗺️', 'Jepp FD Pro', f?.atc_route ? 'copies the ATC route for pasting' : undefined) : null}
              {isWeb ? <Text style={{ color: T.sub, fontSize: 10.5, marginLeft: 10, marginTop: 2 }}>iPad only — not available in web version</Text> : null}
            </View>
          );
        })()}
        {/* Rail legend — mirrors the amber badge and green tick above. */}
        <View style={{ marginTop: 16, marginBottom: 8, marginHorizontal: 4, padding: 10, borderWidth: 1, borderColor: T.line, borderRadius: 8, backgroundColor: T.card }}>
          <Text style={{ color: T.sub, fontSize: 11.5, lineHeight: 19 }}>
            <Text style={{ color: T.amber, fontWeight: '800' }}>●</Text> n  items to complete{'\n'}
            <Text style={{ color: T.green, fontWeight: '800' }}>✓</Text>  section complete
          </Text>
        </View>
        <TouchableOpacity onPress={openInduction}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginTop: 6, marginHorizontal: 4, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9 }}>
          <Text style={{ width: 22, fontSize: 14, textAlign: 'center' }}>👋</Text>
          <Text style={{ color: T.text, fontSize: 13, fontWeight: '600' }}>Welcome & Quick Ref</Text>
        </TouchableOpacity>
        {signOut ? (
          <TouchableOpacity onPress={signOut}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginTop: 4, marginHorizontal: 4, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: '#5c2626', backgroundColor: '#2a1414' }}>
            <Text style={{ width: 22, fontSize: 14, textAlign: 'center' }}>⎋</Text>
            <Text style={{ color: '#f0a3a3', fontSize: 13, fontWeight: '700' }}>Sign out</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingTop: 18, maxWidth: sec === 'navlog' ? undefined : 1000, width: '100%', alignSelf: 'center' } as any}>
        {!railOpen ? (
          <TouchableOpacity onPress={() => setRailOpen(true)} style={{ alignSelf: 'flex-start', backgroundColor: '#1c3050', borderWidth: 1, borderColor: T.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontSize: 15 }}>☰</Text>
            <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>Menu</Text>
          </TouchableOpacity>
        ) : null}
        {(() => { const r = RAIL.find((x) => x.key === sec); return r && sec !== 'navlog' ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <Text style={{ fontSize: 18 }}>{r.icon}</Text>
            <Text style={{ color: T.text, fontSize: 20, fontWeight: '800' }}>{r.label}</Text>
            <Text style={{ color: T.sub, fontSize: 13 }}>{f.flight_no} · {f.dep} → {f.arr} · {f.date}{f.std ? ` · STD ${String(f.std).slice(11, 16)}z` : ''}</Text>
          </View>
        ) : null; })()}
        {msg ? <Text style={{ color: msgOk ? '#22c55e' : T.red }}>{msg}</Text> : null}
        {d?.acceptance || d?.acceptance_post ? (
          locked ? (
            <View style={{ marginTop: 6, marginBottom: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: T.line, backgroundColor: '#122036', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14 }}>🔒</Text>
              <Text style={{ color: T.sub, fontSize: 12.5, flex: 1 }}>Folder signed — the amend window has closed. It is now a fixed record. Contact the back office if a correction is needed.</Text>
            </View>
          ) : amendMsLeft != null ? (
            <View style={{ marginTop: 6, marginBottom: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: T.amber, backgroundColor: '#33290f', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14 }}>✎</Text>
              <Text style={{ color: '#f0d48a', fontSize: 12.5, flex: 1 }}>Signed — still amendable for <Text style={{ fontWeight: '800' }}>{Math.ceil(amendMsLeft / 60000)} min</Text> (admin-set {amendMin}-min window). After that the folder locks.</Text>
            </View>
          ) : null
        ) : null}
        {!d ? <ActivityIndicator style={{ marginTop: 30 }} /> : body()}
      </ScrollView>
    </View>
  );
}

// 3-letter code combo — pick a crew member's code from the dropdown or type any other code.
function CodeCombo({ label, width, value, options, onSet, onSave, required }: any) {
  const [open, setOpen] = useState(false);
  const empty = required && (!value || !value.trim());
  const opts: string[] = Array.from(new Set(options || [])).filter(Boolean) as string[];
  return (
    <View style={{ width: width || 150, marginRight: 16, zIndex: 20 }}>
      <Text style={st.lbl}>{required ? <Text style={{ color: T.red }}>* </Text> : null}{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        <TextInput style={[st.input, { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }, empty ? { borderColor: T.red } : null]}
          value={value} placeholder="e.g. TLC" placeholderTextColor="#4a5f80" autoCapitalize="characters"
          onChangeText={(v) => onSet((v || '').toUpperCase())} onBlur={() => onSave(value)} />
        <TouchableOpacity onPress={() => setOpen((o) => !o)} disabled={!opts.length}
          style={{ width: 34, borderWidth: 1, borderLeftWidth: 0, borderColor: T.inBorder, borderTopRightRadius: R.control, borderBottomRightRadius: R.control, backgroundColor: T.inBg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: opts.length ? T.accent : T.line, fontSize: 12 }}>▼</Text>
        </TouchableOpacity>
      </View>
      {open && opts.length ? (
        <View style={{ position: 'absolute', top: 66, left: 0, right: 0, backgroundColor: T.card, borderRadius: 8, overflow: 'hidden', ...ELEV }}>
          {opts.map((o) => (
            <TouchableOpacity key={o} onPress={() => { onSet(o); onSave(o); setOpen(false); }}
              style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1b2c49' }}>
              <Text style={{ color: value === o ? '#fff' : T.text, fontWeight: value === o ? '800' : '600', fontSize: 14 }}>{o}</Text>
            </TouchableOpacity>
          ))}
          <Text style={{ color: T.sub, fontSize: 11, paddingHorizontal: 12, paddingVertical: 6 }}>or type another code above</Text>
        </View>
      ) : null}
    </View>
  );
}

function SignCard({ kind, flight, done, rep, secs, onDone, setMsg, setRep }: any) {
  // web→native: the web trial signed into a raw <canvas> (DOM PointerEvents, toDataURL) absent on
  // native. Replaced with ETL's cross-platform SignaturePad returning the same base64 PNG data URI.
  const [signing, setSigning] = useState(false);
  if (done) return <View style={st.card}><Text style={{ color: T.entry, fontWeight: '700' }}>✓ Signed — {done.signer_name}{done.licence_no ? ` · ${done.licence_no}` : ''} · {(done.signed_at || '').slice(0, 16)}z</Text></View>;
  const gaps = secs.flatMap((s2: string) => missing(rep, s2));
  return (
    <View style={[st.card, { zIndex: 20 }]}>
      <Text style={{ color: T.sub, fontSize: 13.5, lineHeight: 20 }}>By signing I acknowledge I have familiarised myself with the briefing(s), including Cat B/C aerodromes intended for this flight.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
        <CodeCombo label="3-letter code" width={150} required
          value={String(kind === 'preflight' ? (rep?.signpre?.code3 ?? '') : (rep?.signpost?.code3 ?? ''))}
          options={Array.from(new Set((flight.crew || []).map((c: any) => c.code).filter(Boolean)))}
          onSet={(v: string) => {
            const key = kind === 'preflight' ? 'signpre' : 'signpost';
            setRep?.((p: any) => ({ ...p, [key]: { ...(p[key] || {}), code3: v } }));
          }}
          onSave={async (v: string) => {
            const key = kind === 'preflight' ? 'signpre' : 'signpost';
            try { await saveReport(flight.id, key, { code3: v }); } catch {}
          }} />
      </View>
      {gaps.length ? <Text style={{ color: '#f0d48a', marginTop: 8, lineHeight: 20 }}>Complete before signing:{'\n'}{gaps.map((g: any) => `• ${g.label}`).join('\n')}</Text> : null}
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <TouchableOpacity style={[st.btn, { minWidth: 240 }]} onPress={() => {
          setMsg('');
          if (gaps.length) { setMsg('Complete the listed items first'); return; }
          setSigning(true);
        }}><Text style={st.btnTxt}>{kind === 'preflight' ? 'Sign pre-flight ✓' : 'Sign post-flight ✓'}</Text></TouchableOpacity>
      </View>
      <SignaturePad visible={signing} title={kind === 'preflight' ? 'Sign pre-flight' : 'Sign post-flight'} onClose={() => setSigning(false)}
        onDone={async (dataUrl: string) => {
          setSigning(false); setMsg('');
          try { await acceptFolder2(flight.id, dataUrl, kind); onDone(); }
          catch (e: any) { setMsg(e.message); }
        }} />
    </View>
  );
}


// GENDEC tab — server-rendered ICAO General Declaration with preview, print, and photo capture.
function GendecTab({ flight, d, load, setRep, setMsg, locked }: any) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchGendec = useCallback(async () => {
    setLoading(true);
    try {
      const h = await gendecHtml(flight.id);
      setHtml(h);
    } catch (e: any) {
      // Offline or error — fall back to the inline summary
      setHtml(null);
      setMsg(e.message);
    } finally { setLoading(false); }
  }, [flight.id]);
  useEffect(() => { fetchGendec(); }, [fetchGendec]);

  const doPrint = () => {
    const content = html || _fallbackGendecHtml(flight);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(content);
      w.document.close();
      w.print();
    } else {
      Print.printAsync({ html: content }).catch((e: any) => setMsg(e.message));
    }
  };

  return (
    <View>
      <View style={st.card}>
        <Text style={st.h}>General Declaration (GENDEC)</Text>
        <Text style={{ color: T.sub, marginTop: 6, fontSize: 13 }}>
          ICAO Annex 9 — auto-filled from Leon. Print or photograph the signed copy if the station requires one.
        </Text>
        <Text style={{ color: T.text, marginTop: 10, fontWeight: '700' }}>
          {flight.flight_no} · {flight.dep} → {flight.arr} · {flight.date} · {flight.registration}
        </Text>
        {(flight.crew || []).map((c: any, i2: number) => (
          <Text key={i2} style={{ color: T.text, marginTop: 3 }}>
            {i2 + 1}.  <Text style={{ color: T.accent, fontWeight: '700' }}>{c.role}</Text>  {c.code || ''}  {c.name}
          </Text>
        ))}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <TouchableOpacity style={[st.btn, { marginTop: 0 }]} onPress={doPrint}>
            <Text style={st.btnTxt}>🖨 Print GEN DEC</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.btnSec, { marginTop: 0 }]} onPress={fetchGendec} disabled={loading}>
            <Text style={st.btnSecTxt}>{loading ? '⟳ Loading…' : '⟳ Refresh'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {html && Platform.OS === 'web' ? (
        <View style={[st.card, { padding: 0, overflow: 'hidden' }]}>
          <Text style={[st.h, { paddingHorizontal: 12, paddingTop: 10 }]}>Preview</Text>
          <iframe srcDoc={html} style={{ width: '100%', height: 700, border: 'none', backgroundColor: '#fff' } as any} />
        </View>
      ) : null}
      <View style={st.card}>
        <Text style={st.h}>Signed GEN DEC photo</Text>
        <PhotoBox flight={flight} d={d} reload={load} setRep={setRep} setMsg={setMsg} signed={locked} kind="gendec" label="Signed GEN DEC photo (if required)" />
      </View>
    </View>
  );
}

// Fallback HTML for offline / error (same as the old inline version)
function _fallbackGendecHtml(f: any): string {
  const rows = (f.crew || []).map((c: any, i: number) =>
    `<tr><td>${i + 1}</td><td>${c.role || ''}</td><td>${c.code || ''}</td><td>${c.name || ''}</td><td></td><td></td><td></td><td></td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#000;margin:16px}
    h2{font-size:16px;text-align:center} table{border-collapse:collapse;width:100%;margin-top:12px}
    td,th{border:1px solid #000;padding:5px 8px} th{background:#f0f0f0;text-align:left;font-size:10px}
  </style></head><body>
  <h2>GENERAL DECLARATION</h2>
  <p><b>${f.flight_no || ''}</b> · ${f.dep || ''} → ${f.arr || ''} · ${f.date || ''} · ${f.registration || ''} · Operator: Fly2Sky (VAW)</p>
  <table><tr><th>#</th><th>Duty</th><th>Code</th><th>Name</th><th>M/F</th><th>Nationality</th><th>Passport</th><th>Expiry</th></tr>${rows}</table>
  <p style="margin-top:30px">Signature of authorised agent / crew member: ____________________</p>
  </body></html>`;
}


function PhotoBox({ flight, d, reload, setRep, setMsg, signed, kind = 'fuel_slip', label = 'Fuel slip photo — supplier + receipt № are read off it automatically' }: any) {
  const [view, setView] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slip = (d?.docs || []).find((x: any) => x.kind === kind);
  const inputRef = useRef<any>(null);

  const [camOpen, setCamOpen] = useState(false);

  // Shared uploader — the captured/selected image becomes the SAME base64 payload the web path
  // already uploaded, so the server-side upload + OCR extraction path is unchanged.
  const doUpload = async (b64: string, contentType: string, filename: string) => {
    setBusy(true); setMsg('');
    try {
      if (slip) await deleteDoc(flight.id, slip.id).catch(() => {});            // replace = new in, old out
      const r = await uploadDoc(flight.id, { kind, filename, title: label.split(' — ')[0], content_type: contentType, data_b64: b64 });
      if (r?.extracted) {
        setRep((p: any) => ({ ...p, pre: { ...(p.pre || {}), ...r.extracted } }));
        setMsg('');
      }
      reload();
    } catch (e: any) { setMsg(`Photo failed — ${e.message}`); }
    finally { setBusy(false); }
  };

  // web: <input type=file capture> picker (camera on iPad Safari). native: the OTA-safe expo-camera
  // capture modal when the module is in this binary, else a clear "update the app" hint. View /
  // Replace / Delete of already-uploaded photos work on both regardless.
  const pick = () => {
    if (Platform.OS === 'web') { inputRef.current?.click(); return; }
    if (cameraAvailable) { setMsg(''); setCamOpen(true); return; }
    setMsg('Camera arrives with the next app update — this build doesn’t include the camera module yet.');
  };
  const onFile = async (ev: any) => {
    const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return;
    const b64: string = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });
    doUpload(b64, file.type || 'image/jpeg', file.name || `${kind}.jpg`);
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: T.sub, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      {/* web-only hidden file input (camera on iPad Safari via capture). createElement avoids the
          RN JSX.IntrinsicElements type error; not rendered at all on native. */}
      {Platform.OS === 'web'
        ? React.createElement('input', { ref: inputRef, type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' }, onChange: onFile })
        : null}
      {/* native camera capture — only mounted when the native module is present (hooks inside run
          only then), so an OTA to a binary without expo-camera never touches camera code. */}
      {Platform.OS !== 'web' && cameraAvailable ? (
        <CameraCapture visible={camOpen} onClose={() => setCamOpen(false)} setMsg={setMsg}
          onCapture={(b64: string, ct: string, fn: string) => { setCamOpen(false); doUpload(b64, ct, fn); }} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {!slip ? (
          <TouchableOpacity style={[st.btn, { marginTop: 0 }]} disabled={busy} onPress={pick}>
            <Text style={st.btnTxt}>{busy ? 'Uploading…' : '📷 Take photo'}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[st.btnSec, { marginTop: 0 }]} onPress={async () => {
              try { const doc = await getDoc(flight.id, slip.id); setView(`data:${doc.content_type || 'image/jpeg'};base64,${doc.data_b64}`); }
              catch (e: any) { setMsg(e.message); }
            }}><Text style={st.btnSecTxt}>👁 View</Text></TouchableOpacity>
            <TouchableOpacity style={[st.btnSec, { marginTop: 0 }]} disabled={busy} onPress={pick}>
              <Text style={st.btnSecTxt}>{busy ? '…' : '↻ Replace'}</Text></TouchableOpacity>
            {!signed ? (
              <TouchableOpacity style={[st.btnDanger, { marginTop: 0 }]} onPress={async () => {
                try { await deleteDoc(flight.id, slip.id); reload(); } catch (e: any) { setMsg(e.message); }
              }}><Text style={st.btnDangerTxt}>🗑 Delete</Text></TouchableOpacity>
            ) : null}
          </>
        )}
      </View>
      {view ? (
        <TouchableOpacity onPress={() => setView(null)} style={{ marginTop: 10 }}>
          {/* web→native: <img> → RN <Image> (base64 data URI) */}
          <Image source={{ uri: view }} style={{ width: 480, maxWidth: '100%', height: 320, borderRadius: 10 } as any} resizeMode="contain" />
          <Text style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>tap to close</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}


// Native document camera (expo-camera, loaded OTA-safely above). Rendered only when the module is
// present. takePictureAsync({ base64: true }) yields the raw base64 the upload path expects — same
// shape as the web FileReader result, so PhotoBox.doUpload and the server OCR are format-agnostic.
function CameraCapture({ visible, onClose, onCapture, setMsg }: {
  visible: boolean; onClose: () => void; onCapture: (b64: string, contentType: string, filename: string) => void; setMsg: (m: string) => void;
}) {
  const CameraView = ExpoCamera.CameraView;
  const [perm, requestPerm] = ExpoCamera.useCameraPermissions();
  const camRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const shoot = async () => {
    if (busy || !camRef.current) return;
    setBusy(true);
    try {
      const photo = await camRef.current.takePictureAsync({ base64: true, quality: 0.6, skipProcessing: true });
      if (photo?.base64) onCapture(photo.base64, 'image/jpeg', `${Date.now()}.jpg`);
      else { setMsg('Camera returned no image — try again.'); onClose(); }
    } catch (e: any) { setMsg(`Camera failed — ${e.message}`); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {!perm?.granted ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: T.text, fontSize: 15, textAlign: 'center', marginBottom: 16 }}>Camera access is needed to photograph this document.</Text>
            <TouchableOpacity style={S.btnPrimary} onPress={() => requestPerm()}><Text style={S.btnPrimaryTxt}>Allow camera</Text></TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 16 }} onPress={onClose}><Text style={{ color: T.sub, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
            <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
              <TouchableOpacity disabled={busy} onPress={shoot}
                style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: '#fff', borderWidth: 4, borderColor: T.accent, alignItems: 'center', justifyContent: 'center' }}>
                {busy ? <ActivityIndicator color="#000" /> : null}
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={{ marginTop: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 26 }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}


export function OfflineBadge() {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 4000); return () => clearInterval(t); }, []);
  const off = !isOnlineSync();   // web→native: navigator.onLine → isOnlineSync()
  const n = pendingCount();
  if (!off && !n) return null;
  return (
    <Text style={{ color: off ? '#f0d48a' : '#9fd6ae', fontSize: 12, paddingHorizontal: 6, paddingBottom: 4 }}>
      {off ? '● Offline' : '● Online'}{n ? ` — ${n} entr${n === 1 ? 'y' : 'ies'} queued` : ' — all synced'}
    </Text>
  );
}
