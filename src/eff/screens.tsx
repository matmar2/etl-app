/* EFF crew screens — Login, My Flights, Folder, Nav Log, Accept.
   Self-contained module (no external navigation lib): the tiny stack in App.tsx is replaced by
   the ETL navigator when this folder moves into the ETL app. Web-first trial build. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'react-native';
import { acceptFolder, api, fetchLogo, getFolder, getNavlog, isOnlineSync, listFlights, login, pendingCount, prefetchAll, prefetchDocs, purgeCaches, saveNavEntry, setToken, wxRefresh } from './api';
import { kvGet, kvSet } from './storage';
import SignaturePad from '../components/SignaturePad';   // cross-platform signer (WebView native / canvas web)
import { openInduction } from './help';
export const LOGO = require('../../assets/Fly2Sky-logo.png');
import { S, T, TY } from './theme';

/** Dynamic company logo — returns API logo or bundled fallback. */
export function useLogo() {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { fetchLogo().then((u) => { if (u) setUri(u); }); }, []);
  return uri ? { uri } : LOGO;
}

const s = {
  screen: { flex: 1, backgroundColor: T.bg } as const,
  pad: { padding: 18, maxWidth: 1240, width: '100%' as const, alignSelf: 'center' as const },
  h1: { ...TY.title } as const,
  sub: { color: T.sub, fontSize: 13 },
  card: { ...S.card, marginTop: 10 },
  input: { ...S.input, marginTop: 8 },
  btn: { ...S.btnPrimary, marginTop: 12 },
  btnTxt: S.btnPrimaryTxt,
  pill: (bg: string, fg: string) => ({ backgroundColor: bg, ...S.pill }),
  dateHead: { color: T.sub, fontSize: 12, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 1.1, marginTop: 20, marginBottom: 2 } as const,
};

// Focus-aware input — accent border while editing, uniform control look.
function FInput({ style, onFocus, onBlur, ...rest }: any) {
  const [foc, setFoc] = useState(false);
  return (
    <TextInput {...rest} style={[style, foc ? S.inputFocus : null]}
      onFocus={(e: any) => { setFoc(true); onFocus && onFocus(e); }}
      onBlur={(e: any) => { setFoc(false); onBlur && onBlur(e); }} />
  );
}

const STATUS: Record<string, [string, string, string]> = {
  empty: ['AWAITING OFP', '#14263f', '#9cc4e8'], partial: ['IN PREPARATION', '#3a2f10', '#f0d48a'],
  complete: ['FOLDER READY ✓', '#153524', '#9fd6ae'], accepted: ['ACCEPTED ✓', '#153524', '#9fd6ae'],
};

// Login styled to match the ETL app sign-in (white logo card, 30pt title, 360-wide panel
// fields, full-width green button) so crew see one familiar face across both apps.
const lg = {
  logoCard: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, marginBottom: 22 } as const,
  logo: { width: 240, height: 54, resizeMode: 'contain' } as const,
  title: { color: T.text, fontSize: 30, fontWeight: '800' as const },
  sub: { color: T.sub, marginBottom: 6 } as const,
  note: { color: T.sub, fontSize: 12, marginBottom: 22 } as const,
  input: { width: 360, maxWidth: '90%' as const, backgroundColor: T.panel, color: T.text,
    borderWidth: 1, borderColor: T.inBorder, borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16 },
  btn: { width: 360, maxWidth: '90%' as const, backgroundColor: T.green, borderRadius: 8, padding: 15,
    alignItems: 'center' as const, marginTop: 6 },
  btnTxt: { color: '#fff', fontWeight: '700' as const, fontSize: 16 },
};

export function LoginScreen({ onDone }: { onDone: (u: any) => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const logoSrc = useLogo();
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await login(u.trim(), p, otp.trim() || undefined); setToken(r.access_token); onDone(r.user); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <View style={[s.screen, { justifyContent: 'center', alignItems: 'center', overflow: 'hidden', padding: 24 }]}>
      {/* Subtle radial backdrop — plain Views, no libraries */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -340, alignSelf: 'center', width: 880, height: 880, borderRadius: 440, backgroundColor: '#13284a', opacity: 0.5 }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -300, right: -220, width: 640, height: 640, borderRadius: 320, backgroundColor: '#0e2b45', opacity: 0.4 }} />
      <View style={lg.logoCard}>
        <Image source={logoSrc} style={lg.logo as any} />
      </View>
      <Text style={lg.title}>Fly2Sky EFF</Text>
      <Text style={lg.sub}>Electronic Flight Folder</Text>
      <Text style={lg.note}>Sign in with your ETL account</Text>
      <FInput style={lg.input} placeholder="User ID" placeholderTextColor={T.sub} autoCapitalize="none"
        value={u} onChangeText={setU} returnKeyType="next" />
      <FInput style={lg.input} placeholder="Password" placeholderTextColor={T.sub} secureTextEntry
        autoCapitalize="none" autoCorrect={false} value={p} onChangeText={setP}
        returnKeyType="next" onSubmitEditing={() => { if (!busy) submit(); }} />
      <FInput style={lg.input} placeholder="6-digit MFA code" placeholderTextColor={T.sub} keyboardType="number-pad"
        value={otp} onChangeText={setOtp} returnKeyType="go" onSubmitEditing={() => { if (!busy) submit(); }} />
      {err ? <Text style={{ color: T.red, marginBottom: 8, fontSize: 13 }}>{err}</Text> : null}
      <TouchableOpacity style={lg.btn} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={lg.btnTxt}>Sign in</Text>}
      </TouchableOpacity>
      <Text style={{ color: T.sub, fontSize: 12, marginTop: 18 }}>Pilots sign in with their crew login and MFA.</Text>
    </View>
  );
}

export function FlightsScreen({ user, open, signOut }: { user: any; open: (f: any) => void; signOut: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);   // offline pre-cache progress
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});           // per-date collapse (today open by default)
  const aliveRef = useRef(true);
  const logoSrc = useLogo();
  useEffect(() => () => { aliveRef.current = false; }, []);
  // web→native: localStorage(eff_reg) → SecureStore via the adapter (async, so the persisted tail
  // loads in an effect rather than the useState initializer).
  const [reg, setReg] = useState<string>('ALL');
  useEffect(() => { kvGet('reg').then((v) => { if (v) setReg(v); }); }, []);
  const pickReg = (r: string) => { setReg(r); kvSet('reg', r); };
  const load = () => listFlights().then(async (r) => {
    setRows(r); purgeCaches(r.map((x: any) => x.id));
    // Offline briefing guarantee: while online, pull EVERY flight's folder + documents into the cache
    // so any flight opens with no connectivity — not only ones already opened online (the "this page
    // has not been cached yet" gap). Best-effort, background, sequential to stay gentle.
    if (isOnlineSync() && r.length) {
      if (aliveRef.current) setPrep({ done: 0, total: r.length });
      for (let i = 0; i < r.length; i++) {
        try { const folder = await getFolder(r[i].id); await prefetchDocs(r[i].id, folder?.docs || []); await getNavlog(r[i].id).catch(() => {}); } catch {}
        if (aliveRef.current) setPrep({ done: i + 1, total: r.length });
      }
      if (aliveRef.current) setPrep(null);
    }
  }).catch((e) => { if (/session expired/i.test(e.message)) { signOut(); return; } setErr(e.message); });
  useEffect(() => { load(); }, []);
  const regs = Array.from(new Set((rows || []).map((f) => f.registration).filter(Boolean))).sort();
  const shown = (rows || []).filter((f) => reg === 'ALL' || f.registration === reg);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Image source={logoSrc} style={{ width: 120, height: 28, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 6 } as any} />
        <Text style={s.h1}>My flights</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.sub}>{user?.full_name}</Text>
        <TouchableOpacity onPress={async () => { setErr(''); try { await prefetchAll(); } catch {} load(); }} style={{ marginLeft: 14, paddingVertical: 10, paddingHorizontal: 4 }}>
          <Text style={{ color: T.accent, fontWeight: '700' }}>⟳ Refresh</Text></TouchableOpacity>
        <TouchableOpacity onPress={openInduction} style={{ marginLeft: 14, paddingVertical: 10, paddingHorizontal: 4 }}><Text style={{ color: T.text, fontWeight: '700' }}>👋 Welcome & Quick Ref</Text></TouchableOpacity>
        <TouchableOpacity onPress={signOut} style={{ marginLeft: 14, paddingVertical: 10, paddingHorizontal: 4 }}><Text style={{ color: T.accent, fontWeight: '700' }}>Sign out</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {(() => { const off = !isOnlineSync(); const n = pendingCount();   // web→native: navigator.onLine → isOnlineSync()
          return (off || n) ? <Text style={{ color: off ? '#f0d48a' : '#9fd6ae', fontSize: 12 }}>{off ? '● Offline — cached flights shown' : '● Online'}{n ? ` — ${n} queued` : ''}</Text> : null; })()}
        {prep ? <Text style={{ color: '#9fd6ae', fontSize: 12, marginLeft: 12 }}>● Caching {prep.done}/{prep.total} flights for offline…</Text> : null}
      </View>
      <Text style={s.sub}>Folders build from Leon and fill automatically from PPS the moment dispatch files the plan.</Text>
      {err ? <Text style={{ color: T.red, marginTop: 10 }}>{err}</Text> : null}
      {/* Aircraft selector — same idea as the ETL tail picker; persists across sessions. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {['ALL', ...regs].map((r) => (
          <TouchableOpacity key={r} onPress={() => pickReg(r)}
            style={{ borderWidth: 1, borderColor: reg === r ? T.accent : T.line, backgroundColor: reg === r ? '#1c3050' : T.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: reg === r ? '#fff' : T.sub, fontWeight: '700', fontSize: 13 }}>{r === 'ALL' ? 'All aircraft' : r}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {rows === null ? <ActivityIndicator style={{ marginTop: 30 }} /> : (() => {
        // Group rows under date headers: "Today · 29 Jul", "Tomorrow · 30 Jul", else the date.
        const pad2 = (n: number) => String(n).padStart(2, '0');
        // Flights are keyed by their UTC date (Z schedule), so "today/tomorrow" must be UTC too —
        // otherwise a device behind UTC shows the wrong day as Today (30 Jul local vs 31 Jul UTC).
        const iso = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
        const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const nice = (ds: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ds || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]}` : (ds || ''); };
        const today = iso(new Date()); const tomorrow = iso(new Date(Date.now() + 86400000)); const yesterday = iso(new Date(Date.now() - 86400000));
        const dayLabel = (ds: string) => (ds === today ? `Today · ${nice(ds)}` : ds === yesterday ? `Yesterday · ${nice(ds)}`
          : ds === tomorrow ? `Tomorrow · ${nice(ds)}` : nice(ds)) + ' UTC';
        const groups: { date: string; items: any[] }[] = [];
        for (const f of shown) { const g = groups.find((x) => x.date === (f.date || '')); if (g) g.items.push(f); else groups.push({ date: f.date || '', items: [f] }); }
        return groups.map((g) => { const isOpen = openDates[g.date] ?? (g.date === today); return (
          <View key={g.date || 'undated'}>
            <TouchableOpacity onPress={() => setOpenDates((o) => ({ ...o, [g.date]: !isOpen }))} style={{ paddingVertical: 2 }}>
              <Text style={s.dateHead}>{isOpen ? '▾' : '▸'}  {g.date ? dayLabel(g.date) : 'Date TBA'}  · {g.items.length} flight{g.items.length === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
            {isOpen ? g.items.map((f) => {
              const departed = f.std && new Date(f.std) < new Date();
              const [label, bg, fg] = (departed && (f.folder_status === 'empty' || f.folder_status === 'partial'))
                ? ['DEPARTED · NO FOLDER IN EFF', '#1b2333', '#7d8ba1'] as [string, string, string]
                : (STATUS[f.folder_status] || STATUS.empty);
              return (
                <Pressable key={f.id} onPress={() => open(f)}
                  style={({ pressed, hovered }: any) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', minHeight: 56 },
                    (hovered || pressed) ? { backgroundColor: '#1b2d4d', borderColor: '#31517f' } : null]}>
                  <Text style={{ color: T.text, fontWeight: '700', fontSize: 16, fontVariant: ['tabular-nums'] }}>{f.flight_no}</Text>
                  <Text style={{ color: T.accent, fontSize: 14.5, fontWeight: '700', fontFamily: 'monospace' as any, letterSpacing: 0.5 }}>{f.dep || '—'} → {f.arr || '—'}</Text>
                  <Text style={s.sub}>STD {(f.std || '').slice(11, 16)}z · {f.registration}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={s.pill(bg, fg)}><Text style={{ color: fg, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4 }}>{label}</Text></View>
                </Pressable>
              );
            }) : null}
          </View>
        ); });
      })()}
    </ScrollView>
  );
}

export function FolderScreen({ flight, back, openNavlog }: { flight: any; back: () => void; openNavlog: () => void }) {
  const [d, setD] = useState<any>(null); const [msg, setMsg] = useState('');
  const load = () => getFolder(flight.id).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const f = d?.flight || flight;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <TouchableOpacity onPress={back}><Text style={{ color: T.accent, fontWeight: '700', paddingVertical: 10 }}>‹ My flights</Text></TouchableOpacity>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <Text style={s.h1}>{f.flight_no}</Text>
        <Text style={{ color: T.accent, fontSize: 17 }}>{f.dep} → {f.arr}</Text>
        <Text style={s.sub}>{f.registration} · {f.date} · STD {(f.std || '').slice(11, 16)}z</Text>
      </View>
      {msg ? <Text style={{ color: T.red, marginTop: 8 }}>{msg}</Text> : null}
      {d && !d.pps_configured ? <Text style={[s.sub, { marginTop: 6 }]}>PPS briefing link pending — OFP arrives via dispatch upload for now.</Text> : null}

      <View style={s.card}>
        <Text style={{ ...TY.section, borderBottomWidth: 1, borderBottomColor: T.line, paddingBottom: 8, marginBottom: 4 }}>Crew</Text>
        <Text style={{ color: T.text, marginTop: 8 }}>{(f.crew || []).map((c: any) => `${c.code || ''} ${c.name || ''}`.trim()).join(' · ') || '— from Leon closer to departure —'}</Text>
      </View>

      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: T.line, paddingBottom: 8, marginBottom: 4 }}>
          <Text style={TY.section}>Folder documents</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={{ paddingVertical: 8, paddingHorizontal: 4 }} onPress={async () => { setMsg(''); try { await wxRefresh(flight.id); load(); } catch (e: any) { setMsg(e.message); } }}>
            <Text style={{ color: T.accent, fontWeight: '700' }}>⟳ Refresh wx</Text></TouchableOpacity>
        </View>
        {(d?.docs || []).length === 0 ? <Text style={[s.sub, { marginTop: 8 }]}>Empty — refresh wx or wait for dispatch.</Text> :
          d.docs.map((doc: any) => (
            <View key={doc.id} style={{ borderTopWidth: 1, borderTopColor: T.line, paddingVertical: 8, marginTop: 8 }}>
              <Text style={{ color: T.text, fontWeight: '700' }}>{doc.kind.toUpperCase()} · {doc.title} <Text style={s.sub}>rev {doc.revision} · {doc.source} · {(doc.fetched_at || '').slice(0, 16)}z</Text></Text>
              {doc.wx ? Object.entries(doc.wx).map(([icao, w]: any) => (
                <View key={icao} style={{ marginTop: 6 }}>
                  <Text style={{ color: T.entry, fontWeight: '700' }}>{icao}</Text>
                  {w.metar ? <Text style={{ color: T.text, fontFamily: 'monospace' as any, fontSize: 12.5 }}>{w.metar}</Text> : null}
                  {w.taf ? <Text style={{ color: T.sub, fontFamily: 'monospace' as any, fontSize: 12.5 }}>{w.taf}</Text> : null}
                </View>
              )) : null}
            </View>
          ))}
      </View>

      <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center' }]} onPress={openNavlog}>
        <Text style={{ color: T.text, fontWeight: '800', fontSize: 16 }}>Nav log — fuel & time check</Text>
        <View style={{ flex: 1 }} /><Text style={{ color: T.accent, fontSize: 18 }}>›</Text>
      </TouchableOpacity>

      <AcceptCard flight={f} accepted={d?.acceptance} onDone={load} setMsg={setMsg} />
    </ScrollView>
  );
}

function AcceptCard({ flight, accepted, onDone, setMsg }: any) {
  // web→native: the web trial drew into a raw <canvas> (DOM PointerEvents, toDataURL) which does
  // not exist on native. Replaced with ETL's cross-platform SignaturePad (Modal → WebView on
  // native / HTML canvas on web) that returns the same base64 PNG data URI.
  const [signing, setSigning] = useState(false);
  if (accepted) return (
    <View style={s.card}><Text style={{ color: T.entry, fontWeight: '700' }}>✓ Folder accepted — {accepted.signer_name}{accepted.licence_no ? ` · ${accepted.licence_no}` : ''} · {(accepted.signed_at || '').slice(0, 16)}z</Text></View>
  );
  return (
    <View style={s.card}>
      <Text style={{ color: T.sub, fontSize: 13.5, lineHeight: 20 }}>By signing I acknowledge I have familiarised myself with the briefing(s), including Cat B/C aerodromes intended for this flight.</Text>
      <View style={{ alignItems: 'center', marginTop: 14, gap: 2 }}>
        <TouchableOpacity style={s.btn} onPress={() => { setMsg(''); setSigning(true); }}>
          <Text style={s.btnTxt}>Accept folder ✓</Text></TouchableOpacity>
      </View>
      <SignaturePad visible={signing} title="Accept flight folder" onClose={() => setSigning(false)}
        onDone={async (dataUrl: string) => {
          setSigning(false); setMsg('');
          try { await acceptFolder(flight.id, dataUrl); onDone(); }
          catch (e: any) { setMsg(e.message); }
        }} />
    </View>
  );
}

export function NavLogScreen({ flight, back, embedded }: { flight: any; back: () => void; embedded?: boolean }) {
  const [d, setD] = useState<any>(null); const [msg, setMsg] = useState('');
  const [draft, setDraft] = useState<Record<number, any>>({});
  const [route, setRoute] = useState<'main' | 'alt'>('main');
  useEffect(() => { getNavlog(flight.id).then(setD).catch((e) => setMsg(e.message)); }, []);
  const save = async (idx: number, body: any) => {
    try { await saveNavEntry(flight.id, idx, body); } catch (e: any) { setMsg(`Offline / error — retry: ${e.message}`); }
  };
  // Planned ETO at a waypoint = flight STD + accumulated minutes (used for the one-tap ATO accept).
  const planEto = (w: any): string | null => {
    if (w?.eto) { const s = String(w.eto).slice(11, 16) || String(w.eto).slice(0, 5); return /^\d{2}:\d{2}$/.test(s) ? s : null; }
    const std = String(flight?.std ?? '').slice(11, 16);
    if (!/^\d{2}:\d{2}$/.test(std) || w?.acc_min == null) return null;
    let m = ((+std.slice(0, 2) * 60 + +std.slice(3)) + Number(w.acc_min)) % 1440; if (m < 0) m += 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const acceptPlan = (idx: number, k: string, val: any) => {
    setDraft((p) => ({ ...p, [idx]: { ...p[idx], [k]: String(val) } }));
    save(idx, { [k]: k === 'fob_kg' ? (Number(val) || null) : String(val) });
  };
  const planChip = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} style={{ marginTop: 3, alignSelf: 'center', backgroundColor: '#122544', borderWidth: 1, borderColor: T.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: T.accent, fontSize: 10.5, fontWeight: '700' }}>= {label}</Text>
    </TouchableOpacity>
  );
  const cell = { color: T.text, fontSize: 13, paddingVertical: 9, paddingHorizontal: 8, fontVariant: ['tabular-nums'] as any };
  const head = { color: T.sub, fontSize: 10.5, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, paddingVertical: 9, paddingHorizontal: 8 };
  const hhmm = (v: string): string => {
    let x = (v || '').replace(/\D/g, '').slice(0, 4);
    if (x.length >= 2) { const h = Math.min(parseInt(x.slice(0, 2), 10), 23); x = String(h).padStart(2, '0') + x.slice(2); }
    if (x.length >= 4) { const m = Math.min(parseInt(x.slice(2, 4), 10), 59); x = x.slice(0, 2) + String(m).padStart(2, '0'); }
    return x.length <= 2 ? x : x.slice(0, 2) + ':' + x.slice(2);
  };
  const entry = (idx: number, k: string, w: number, ph: string, kb?: any) => {
    const isTime = k === 'ato';
    const cur = draft[idx]?.[k] ?? d?.entries?.[idx]?.[k === 'fob_kg' ? 'fob_kg' : k] ?? '';
    return <TextInput style={{ backgroundColor: T.inBg, borderColor: T.inBorder, borderWidth: 1, borderRadius: 8, color: T.entry, width: w, height: 38, paddingVertical: 0, paddingHorizontal: 7, fontSize: 13, textAlign: 'center' }}
      placeholder={ph} placeholderTextColor="#4a5f80" keyboardType={isTime ? 'numeric' : kb} maxLength={isTime ? 5 : undefined} value={String(cur ?? '')}
      onChangeText={(v) => setDraft((p) => ({ ...p, [idx]: { ...p[idx], [k]: isTime ? hhmm(v) : v } }))}
      onBlur={() => { const v = draft[idx]?.[k]; if (v !== undefined) save(idx, { [k]: k === 'fob_kg' ? (Number(v) || null) : v }); }} />;
  };
  const isMain = route === 'main';
  const W = (isMain ? d?.waypoints : d?.alt_waypoints) || [];
  // Column widths: base px values scale UP to fill the measured container, so on iPad landscape
  // every column is visible with no horizontal scrolling; below the base total the table falls
  // back to a horizontal scroll rather than crushing the entry inputs.
  const BASE_W = [86, 64, 46, 46, 78, 72, 84, 76, 70, 84, 100, 66];
  const BASE_TOTAL = BASE_W.reduce((a, b) => a + b, 0);
  const [tblW, setTblW] = useState(0);
  const fit = tblW >= BASE_TOTAL;
  const CW = fit ? BASE_W.map((w) => Math.floor(w * (tblW / BASE_TOTAL))) : BASE_W;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {embedded ? null : <TouchableOpacity onPress={back}><Text style={{ color: T.accent, fontWeight: '700', paddingVertical: 10 }}>‹ Folder</Text></TouchableOpacity>}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        <Text style={s.h1}>Nav log</Text>
        <Text style={{ color: T.accent }}>{flight.dep} → {flight.arr}</Text>
        {d?.source === 'demo' ? <View style={s.pill('#3a2f10', '#f0d48a')}><Text style={{ color: '#f0d48a', fontSize: 11, fontWeight: '700' }}>DEMO PLAN — awaiting PPS</Text></View> : null}
        {(d?.alt_waypoints || []).length ? (['main', 'alt'] as const).map((r2) => (
          <TouchableOpacity key={r2} onPress={() => setRoute(r2)}
            style={{ borderWidth: 1, borderColor: route === r2 ? T.accent : T.line, backgroundColor: route === r2 ? '#1c3050' : T.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: route === r2 ? '#fff' : T.sub, fontWeight: '700', fontSize: 12.5 }}>{r2 === 'main' ? `${flight.dep} → ${flight.arr}` : '→ ALTN'}</Text>
          </TouchableOpacity>
        )) : null}
        <View style={{ flex: 1 }} /><Text style={s.sub}>entries auto-save</Text>
      </View>
      {msg ? <Text style={{ color: T.red, marginTop: 8 }}>{msg}</Text> : null}
      {!d ? <ActivityIndicator style={{ marginTop: 30 }} /> : (
        <ScrollView horizontal={!fit} scrollEnabled={!fit} style={{ marginTop: 12 }}
          onLayout={(e) => setTblW(Math.floor(e.nativeEvent.layout.width))}>
          <View style={fit ? { width: '100%' } : undefined}>
            <View style={{ flexDirection: 'row', backgroundColor: T.panel, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 1, borderBottomColor: T.line }}>
              {['WPT', 'AWY', 'FL', 'MT', 'TAS/GS', 'W/V', 'LEG/ACC', 'FOB PLAN', 'MREQ', 'ATO ✎', 'FOB ACTUAL ✎', 'Δ FUEL'].map((h, i) => (
                <Text key={h} style={[head, { width: CW[i], color: h.includes('✎') ? T.entry : T.sub }]}>{h}</Text>
              ))}
            </View>
            {W.map((w: any, i: number) => {
              const e = d.entries?.[i] || {}; const dv = draft[i] || {};
              const fobA = Number(dv.fob_kg ?? e.fob_kg);
              const delta = fobA && w.fob_plan ? Math.round(fobA - w.fob_plan) : null;
              const below = fobA && w.mreq && fobA < w.mreq;
              const apt = i === 0 || i === W.length - 1;
              const rmk = String(dv.remark ?? e.remark ?? '');
              return (
                <View key={i}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: below ? '#3a1515' : apt ? '#122544' : i % 2 ? 'rgba(255,255,255,0.025)' : undefined, borderBottomWidth: rmk || isMain ? 0 : 1, borderBottomColor: '#1b2c49' }}>
                  <Text style={[cell, { width: CW[0], fontWeight: '700' }]}>{w.wpt}</Text>
                  <Text style={[cell, { width: CW[1], color: T.sub }]}>{w.awy ?? ''}</Text>
                  <Text style={[cell, { width: CW[2] }]}>{w.fl ?? ''}</Text>
                  <Text style={[cell, { width: CW[3] }]}>{w.mt ?? ''}</Text>
                  <Text style={[cell, { width: CW[4] }]}>{w.tas ? `${w.tas}/${w.gs}` : ''}</Text>
                  <Text style={[cell, { width: CW[5], color: T.sub }]}>{w.wv ?? ''}</Text>
                  <Text style={[cell, { width: CW[6], color: T.sub }]}>{w.leg_min != null ? `${String(w.leg_min).padStart(2, '0')}/` : ''}{w.acc_min != null ? `${Math.floor(w.acc_min / 60)}:${String(w.acc_min % 60).padStart(2, '0')}` : ''}</Text>
                  <Text style={[cell, { width: CW[7] }]}>{w.fob_plan ?? ''}</Text>
                  <Text style={[cell, { width: CW[8], color: T.sub }]}>{w.mreq ?? ''}</Text>
                  <View style={{ width: CW[9], padding: 3, alignItems: 'center' }}>{isMain ? (<>{entry(i, 'ato', CW[9] - 10, '--:--')}{(() => { const eto = planEto(w); return eto ? planChip(eto, () => acceptPlan(i, 'ato', eto)) : null; })()}</>) : <Text style={[cell, { color: T.sub }]}>—</Text>}</View>
                  <View style={{ width: CW[10], padding: 3, alignItems: 'center' }}>{isMain ? (<>{entry(i, 'fob_kg', CW[10] - 10, 'kg', 'numeric')}{w.fob_plan != null ? planChip(String(w.fob_plan), () => acceptPlan(i, 'fob_kg', w.fob_plan)) : null}</>) : <Text style={[cell, { color: T.sub }]}>—</Text>}</View>
                  <Text style={[cell, { width: CW[11], color: delta == null ? T.sub : delta >= 0 ? T.entry : '#f0a3a3' }]}>{delta == null ? '—' : (delta > 0 ? `+${delta}` : `${delta}`)}</Text>
                </View>
                {isMain ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingBottom: 4, paddingTop: 2, borderBottomWidth: 1, borderBottomColor: '#1b2c49', backgroundColor: below ? '#3a1515' : apt ? '#122544' : i % 2 ? 'rgba(255,255,255,0.025)' : undefined }}>
                    <Text style={{ color: T.sub, fontSize: 10.5, fontWeight: '700', marginRight: 8, width: 54 }}>REMARK</Text>
                    <TextInput style={{ backgroundColor: T.inBg, borderColor: T.inBorder, borderWidth: 1, borderRadius: 8, color: T.entry, flex: 1, minHeight: 32, paddingVertical: 4, paddingHorizontal: 7, fontSize: 13, maxWidth: 700 }} multiline
                      placeholder="Write a remark…" placeholderTextColor="#4a5f80" value={rmk}
                      onChangeText={(v) => setDraft((p) => ({ ...p, [i]: { ...p[i], remark: v } }))}
                      onBlur={() => { const v = draft[i]?.remark; if (v !== undefined) save(i, { remark: v }); }} />
                  </View>
                ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
      <Text style={[s.sub, { marginTop: 10 }]}>Green columns are yours: ATO, actual fuel on board, remark. Tap the blue <Text style={{ color: T.accent, fontWeight: '700' }}>= value</Text> chip to accept the plan, then amend if needed. A row turns red when actual FOB falls below MREQ.</Text>
    </ScrollView>
  );
}
