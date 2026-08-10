import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { acceptDispatch, addServicing, aircraftUtilisation, appSettings, can, currentAircraft, listActiveDefects, listServicing, publicConfig, role, signRecord, tokenIssuedAt, Utilisation } from '../api/client';
import ClockBanner from '../components/ClockBanner';
import IcaoHint from '../components/IcaoHint';
import OfflineFlash from '../components/OfflineFlash';
import RoBanner from '../components/RoBanner';
import TechLogPageModal from '../components/TechLogPageModal';
import SignaturePad from '../components/SignaturePad';
import SignatureBlock from '../components/SignatureBlock';
import { confirmAction, notifyAction } from '../util/confirm';
import { speakFlightClosed, speakMissingFields } from '../util/voiceConfirm';
import { checkAirportGps } from '../util/geo';
import { trackActivity } from '../db/activity';
import SyncBlock from '../components/SyncBlock';
import { theme } from '../theme';
import { updateSector } from '../db/sectors';
import { effInputStyle, EffHint, EffLegend, fmtHM, hhmm, hm, num, numericOnly, OOOISection, RefreshButton, schedule, sx, useReadyPulse, useSector } from './sectorShared';

export default function ArrivalScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, msg, syncing, save, stamp, setManual, clearTime, syncRefresh } = useSector(sectorId);
  const [ldg, setLdg] = useState<any>({});
  // Fields still holding their EFF-imported value (rendered blue). Seeded from sector.eff_fields;
  // editing one prunes its key and persists the pruned list so it stays manual after reload.
  const [effFields, setEffFields] = useState<Set<string>>(new Set());
  const [rem, setRem] = useState<any>('');
  const [lf, setLf] = useState<any>('');
  const [signMsg, setSignMsg] = useState('');
  const [acceptSigning, setAcceptSigning] = useState(false);   // post-flight acceptance signature pad
  const [showTlp, setShowTlp] = useState(false);
  const [gps, setGps] = useState<{ state: 'idle' | 'checking' | 'ok' | 'far' | 'nogps' | 'error'; km?: number; name?: string; msg?: string }>({ state: 'idle' });
  type FieldConf = Record<string, { visible?: boolean; required?: boolean; label?: string }>;
  const [fc, setFc] = useState<FieldConf>({});
  const [cabinPending, setCabinPending] = useState<any[]>([]);
  const [util, setUtil] = useState<Utilisation | null>(null);
  const [div, setDiv] = useState<{ on: boolean; airport: string }>({ on: false, airport: '' });
  const [badSet, setBadSet] = useState<Set<string>>(new Set());
  const readyPulse = useReadyPulse(badSet);
  const scrollRef = useRef<ScrollView>(null);
  const secY = useRef<Record<string, number>>({});
  const [testing, setTesting] = useState(false);
  const [oilArr, setOilArr] = useState<{ eng1: string; eng2: string }>({ eng1: '', eng2: '' });   // oil qty on arrival (qt)
  const [oilMsg, setOilMsg] = useState('');
  const QT_L = 0.946353;                                  // US quart -> litre (oil stored canonically in litres)
  useEffect(() => { listServicing(sectorId).then((rows: any[]) => {
    const g = (sys: string) => { const r = (rows || []).find((x) => x.system === sys && x.arrival_lt != null); return r ? String(Math.round((r.arrival_lt / QT_L) * 10) / 10) : ''; };
    setOilArr({ eng1: g('eng1'), eng2: g('eng2') });
  }).catch(() => {}); }, [sectorId]);
  const noteShown = useRef(false);
  useEffect(() => { appSettings().then((x: any) => {
    const raw = x.field_config?.arrival;
    if (raw) { setFc(raw); } else {
      const mf = x.mandatory_fields?.arrival || {};
      const d: FieldConf = {}; for (const [k, v] of Object.entries(mf)) d[k] = { visible: true, required: !!v }; setFc(d);
    }
  }).catch(() => {}); }, []);
  useEffect(() => { publicConfig().then((c: any) => setTesting(!!c.testing_mode)).catch(() => {}); }, []);

  async function checkGps(arr?: string) {
    if (!s?.landing) return;   // the airport check runs only once ON (landing) is entered
    const eff = (s?.diverted && s?.diversion_airport) ? s.diversion_airport : s?.arr;   // diverted → check the diversion airport
    const code = (arr || eff || '').trim();
    if (!code) return;
    setGps({ state: 'checking' });
    setGps(await checkAirportGps(code));
  }

  useEffect(() => {
    if (!s) return;
    setLdg({ full_stop: String(s.full_stop_ldgs ?? 1), touch_go: s.touch_go, ldgs_before: s.ldgs_before, autoland: s.autoland_ok ? 'ok' : (s.autoland_notes ? 'fail' : ''), autoland_notes: s.autoland_notes ?? '' });
    setEffFields(new Set(Array.isArray(s.eff_fields) ? s.eff_fields : []));
    setRem(s.fuel_remaining_kg);
    setLf(s.landing_fuel_kg);
    setDiv({ on: !!s.diverted, airport: s.diversion_airport || '' });
    loadCabin();
    aircraftUtilisation(s.aircraft_id).then(setUtil).catch(() => {});   // OASES/CAMO CSN for total cycles
  }, [!!s]);
  // Auto-persist arrival fuel to SQLite so data survives app restart.
  // Web skips this — web has no SQLite; saves go directly to the server via useSector.save().
  const isWeb = require('react-native').Platform.OS === 'web';
  const remReady = useRef(false);
  const remTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!isWeb && s && !remReady.current) { const t = setTimeout(() => { remReady.current = true; }, 2000); return () => clearTimeout(t); } }, [!!s]);
  useEffect(() => {
    if (isWeb || !remReady.current) return;
    if (remTimer.current) clearTimeout(remTimer.current);
    remTimer.current = setTimeout(() => { updateSector(sectorId, { fuel_remaining_kg: num(rem) }).catch(() => {}); }, 1500);
    return () => { if (remTimer.current) clearTimeout(remTimer.current); };
  }, [rem]);
  // Run the landing-airport GPS check automatically the moment ON (landing) is entered,
  // and re-run it when the diversion state or airport changes — the target is the
  // destination airport, or the diversion airport when the flight diverted.
  useEffect(() => { if (s?.landing) checkGps(); }, [s?.landing, s?.diverted, s?.diversion_airport]);
  function loadCabin() {
    const reg = s?.aircraft_id; if (!reg) return;
    listActiveDefects(reg).then((ds: any[]) => setCabinPending(ds.filter((d) => d.area === 'cabin' && d.dispatch_accepted == null && d.status !== 'closed'))).catch(() => {});
  }
  async function decideCabin(id: string, ok: boolean) { try { await acceptDispatch(id, ok); loadCabin(); } catch { /* offline */ } }

  // Proactive red borders: highlight empty mandatory fields immediately, not only on sign-off failure.
  // MUST be before the if(!s) early return — hooks must run in the same order every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (s && Object.keys(fc).length) setBadSet(new Set(computeMissing().map((x) => x.key))); },
    [fc, s, s?.arr, s?.off_block, s?.takeoff, s?.landing, s?.on_block, s?.ice_protect, rem, oilArr, div]);

  if (!s) return <View style={sx.wrap}><Text style={sx.sub}>Loading…</Text></View>;
  const isCrew = role() === 'captain' || role() === 'pilot' || role() === 'admin';
  const canOooiA = can('arrival', 'oooi');         // arrival OFF/ON/IN times
  const canFuelA = can('arrival', 'fuel');         // fuel at touch-down / remaining
  const canLdgA = can('arrival', 'landings');      // landings / cycles / autoland
  const canDivA = can('arrival', 'diversion');     // diversion airport
  const canOilA = can('arrival', 'servicing');     // oil quantity on arrival — crew (per AMM) + mechanic at arrival station
  const canAcceptA = can('arrival', 'acceptance'); // post-flight acceptance / close
  // EFF-import highlight: OOOI times (off/off/on/in) + arrival fuel imported from the flight folder
  // show blue until edited. pruneEff persists the pruned list (SectorIn accepts eff_fields).
  const EFF_ARR_KEYS = ['off_block', 'takeoff', 'landing', 'on_block', 'fuel_remaining_kg'];
  const anyEffArr = EFF_ARR_KEYS.some((k) => effFields.has(k));
  function pruneEff(key: string) {
    if (!effFields.has(key)) return;
    const n = new Set(effFields); n.delete(key);
    setEffFields(n);
    save({ eff_fields: Array.from(n) });
  }
  const depAccepted = s.status !== 'draft';        // commander accepted the departure (preflight signed)
  // Testing: Arrival is accessible without completing Departure (a note explains the go-live rule).
  const effDep = depAccepted || testing;
  const canAct = canAcceptA && effDep;
  if (testing && !depAccepted && !noteShown.current) {
    noteShown.current = true;
    const title = 'Testing mode — Arrival open';
    const body = 'Arrival is accessible for testing without completing Departure.\n\nOnce live, Arrival will be accessible only after completing (commander acceptance of) the Departure.';
    setTimeout(() => {
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(`${title}\n\n${body}`); }
      else Alert.alert(title, body);
    }, 0);
  }
  const oasesCsn = util?.camo?.csn ?? util?.etl?.csn_fc ?? null;   // total cycles (OASES; ETL fallback)
  const oasesTsn = util?.camo?.tsn ?? util?.etl?.tsn_fh ?? null;   // total hours (OASES; ETL fallback)
  const thisLdgs = (Number(ldg.full_stop) || 1) + ((s?.flight_type || '').toLowerCase() === 'training' ? (Number(ldg.touch_go) || 0) : 0);   // landings entered + T&G (training only)
  const legFh = s.flight_time_min != null ? Math.round((s.flight_time_min / 60) * 10) / 10 : null;   // this leg flight hours
  const newTsn = oasesTsn != null ? Math.round((oasesTsn + (legFh || 0)) * 10) / 10 : null;   // baseline shows at once; leg FH folds in once takeoff+landing are stamped
  const newCsn = oasesCsn != null ? oasesCsn + thisLdgs : null;

  const hasV = (v: any) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v));
  const isVis = (k: string) => fc[k]?.visible !== false;
  function computeMissing() {
    const out: { key: string; label: string; sec: string }[] = [];
    const add = (key: string, label: string, sec: string, ok: boolean, force = false) => { if ((force || fc[key]?.required) && !ok) out.push({ key, label: fc[key]?.label || label, sec }); };
    add('arr', 'Arrival airport', 'top', !!s.arr);
    add('off_block', 'OUT (off-block)', 'oooi', !!s.off_block);
    add('takeoff', 'OFF (take-off)', 'oooi', !!s.takeoff);
    add('landing', 'ON (landing)', 'oooi', !!s.landing, true);
    add('on_block', 'IN (on-block)', 'oooi', !!s.on_block, true);
    add('fuel_remaining_kg', 'Remaining fuel', 'fuel', hasV(rem));
    const lmAttended = role() === 'mechanic' && (() => {
      const ia = tokenIssuedAt(); const sd = s.on_block || s.landing;
      return !!(ia && sd && ia > new Date(sd).getTime());
    })();
    const oilLm = (fc.oil_arrival_lm?.required ?? fc.oil_arrival?.required) && lmAttended;
    const oilCrew = fc.oil_arrival_crew?.required && (role() === 'captain' || role() === 'pilot');
    if (oilLm || oilCrew) {
      // Oil on arrival binds LINE MAINTENANCE only when the mechanic signed IN to the iPad
      // AFTER engine shutdown (LM attended this arrival). Crew — and a mechanic whose session
      // predates the arrival — may close the flight without it.
      add('oil_eng1', 'Eng 1 oil on arrival', 'oil', hasV(oilArr.eng1), true);
      add('oil_eng2', 'Eng 2 oil on arrival', 'oil', hasV(oilArr.eng2), true);
    }
    add('landings', 'Landings', 'ldg', true);   // one full-stop landing is implicit per flight
    add('ice', 'Ice protection (de-icing details when used)', 'ice', !s.ice_protect || !!(s.deice && (s.deice as any).code));
    add('diversion_airport', 'Diversion airport', 'oooi', !div.on || !!div.airport, div.on);   // required when diverted
    return out;
  }
  async function accept() {
    const miss = computeMissing();
    if (miss.length) {
      setBadSet(new Set(miss.map((x) => x.key)));
      const y = secY.current[miss[0].sec]; if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 70), animated: true });
      setSignMsg('Complete before signing: ' + miss.map((x) => x.label).join(', '));
      // The scroll jumps away from the sign button, so also LIST the gaps in a dialog the
      // captain sees regardless of scroll position.
      notifyAction(miss.map((x) => `• ${x.label}`).join('\n'), 'Complete before signing');
      speakMissingFields(miss.map((x) => x.label));
      return;
    }
    setBadSet(new Set());
    if (!(await confirmAction('Confirm post-flight acceptance and close this sector?', 'Post-flight acceptance'))) return;
    setAcceptSigning(true);   // open the signature pad — the drawn signature closes the sector
  }
  async function finishAccept(signature: string) {
    setAcceptSigning(false);
    try {
      // Persist the (mandatory) arrival oil with the closure so a typed-but-unsaved value is never lost.
      const at = new Date().toISOString();
      for (const [sys, val] of [['eng1', oilArr.eng1], ['eng2', oilArr.eng2]] as const) {
        if (val) await addServicing({ sector_id: sectorId, system: sys, arrival_lt: +(Number(val) * QT_L).toFixed(2), arrival_at: at }).catch(() => {});
      }
      // Flush the typed-but-debounced arrival fuel into the sector row FIRST — computeMissing()
      // reads the input state, but the row only gets the value after a 1.5 s debounce, so a quick
      // sign carried a stale row and the server rejected AFTER the signature pad (crew report 09 Aug).
      const fresh = await save({ fuel_remaining_kg: num(rem) });
      // OFFLINE-FIRST: the sign request carries the sector's local row — the server applies it
      // before validating, so the sign never races the background push (see DepartureScreen).
      const r: any = await signRecord({ kind: 'postflight', sector_id: sectorId, signature_image: signature, sector: fresh ?? s });
      await save({ status: 'closed' });            // reflect locally so the next flight can be opened
      trackActivity('sign', 'postflight', sectorId, 'Arrival', { flight: s.flight_no, queued: !!r?.queued });
      setSignMsg(r?.queued ? 'Closed offline — will sync ✓' : (r.status === 'closed' ? 'Closed ✓' : 'Signed'));
      speakFlightClosed();
    } catch (e: any) {
      const em = e?.message || '';
      if (/complete|mandatory|required/i.test(em)) {
        setSignMsg(em);
        // Server-side mandatory-field rejection → same pop-up as the client-side check, so the
        // captain always sees WHY the flight didn't close (V71806 28 Jul: silent 400).
        notifyAction(em, 'Complete before signing');
      } else setSignMsg('Offline — queued');
    }
  }

  return (
    <ScrollView ref={scrollRef} style={sx.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <SyncBlock visible={syncing} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[sx.title, { flex: 1 }]}>After Captain Sign off / Departure / Arrival · {currentAircraft()?.registration || s.aircraft_id} · {s.flight_no} · {s.dep} → {s.arr}</Text>
        <RefreshButton onRefresh={syncRefresh} syncing={syncing} />
      </View>
      {(() => { const sc = schedule(s); return (
        <Text style={sx.sub}>{s.flight_date} · STD {hhmm(s.std)} · STA {hhmm(s.sta)}{sc.eta ? ` · ${sc.arrived ? 'ATA' : 'ETA'} ${hhmm(sc.eta)}` : ''}{sc.delayMin > 0 ? `  (delay +${sc.delayMin}′)` : ''}</Text>
      ); })()}
      {msg ? <Text style={sx.msg}>{msg}</Text> : null}
      <ClockBanner />

      {!depAccepted ? (
        testing ? (
          <View style={{ backgroundColor: '#3a2e0e', borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 10, marginTop: 8 }}>
            <Text style={{ color: theme.accent, fontWeight: '800' }}>Testing — Arrival open without Departure</Text>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>Once live, Arrival will be accessible only after completing (commander acceptance of) the Departure.</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#3a1111', borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 10, marginTop: 8 }}>
            <Text style={{ color: theme.red, fontWeight: '800' }}>Accept the Departure first</Text>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>Arrival times, fuel, landings and post-flight acceptance unlock once the commander has accepted the departure.</Text>
          </View>
        )
      ) : null}

      <Text style={sx.section} onLayout={(e) => { secY.current['oooi'] = e.nativeEvent.layout.y; }}>Times (OUT / OFF / ON / IN)</Text>
      <EffLegend show={anyEffArr} />
      <OOOISection s={s} fields={['off_block', 'takeoff', 'landing', 'on_block']} stamp={stamp} setManual={setManual} clear={(canOooiA && effDep) ? clearTime : undefined} disabled={!effDep || !canOooiA} effSet={effFields} onEdit={pruneEff} badSet={badSet} />
      <Text style={sx.sub}>{(() => {
        const mm = (a?: string | null, b?: string | null) => { if (!a || !b) return null; return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)); };
        const blk = mm(s.off_block, s.on_block) ?? s.block_time_min;
        const flt = mm(s.takeoff, s.landing) ?? s.flight_time_min;
        const schedBlk = mm(s.std, s.sta);
        const delta = blk != null && schedBlk != null ? blk - schedBlk : null;
        const warn = delta != null && Math.abs(delta!) > 15;
        return <>{'Block ' + hm(blk)}{warn ? <Text style={{ color: Math.abs(delta!) > 60 ? theme.red : theme.accent }}>{` (${delta! > 0 ? '+' : ''}${delta}′ vs sched ${hm(schedBlk)})`}</Text> : null}{` · Flight ${hm(flt)} (h:mm)`}</>;
      })()}</Text>

      {role() !== 'mechanic' ? (<>
      <Text style={sx.section} onLayout={(e) => { secY.current['ice'] = e.nativeEvent.layout.y; }}>Ice protection</Text>
      <View style={[sx.card, badSet.has('ice') ? { borderWidth: 2, borderColor: theme.red } : null]}>
        <View style={sx.switchRow}><Text style={{ color: theme.sub }}>De/anti-icing applied</Text>
          <Switch value={!!s.ice_protect} disabled={!effDep} onValueChange={async (v) => {
            await save({ ice_protect: v });
            if (v) navigation.navigate('Deicing', { sectorId });
          }} /></View>
        {s.ice_protect ? (
          <View style={{ marginTop: 8 }}>
            {s.deice?.code ? <Text style={{ color: theme.text, fontWeight: '700' }}>Anti-icing code: {s.deice.code}</Text> : <Text style={sx.sub}>No de-icing data entered yet.</Text>}
            <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => navigation.navigate('Deicing', { sectorId })}>
              <Text style={sx.saveText}>{s.deice?.code ? 'Edit de-icing data' : 'Enter de-icing data'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Take-off thrust — FLEX assumed temperature (°C) or TOGA. Pilot entry; prints in the
          TL's T/O THRUST box. */}
      {isVis('takeoff_thrust') ? <>
      <Text style={sx.section}>TO FLEX/TOGA</Text>
      <View style={sx.card}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['FLEX', 'TOGA'] as const).map((m) => {
            const cur = String(s.takeoff_thrust || '');
            const on = m === 'TOGA' ? cur === 'TOGA' : cur.startsWith('FLEX');
            return (
              <TouchableOpacity key={m} disabled={!effDep} onPress={async () => {
                await save({ takeoff_thrust: m === 'TOGA' ? 'TOGA' : 'FLEX' });
              }} style={{ borderWidth: 1, borderColor: on ? theme.green : theme.border, backgroundColor: on ? theme.tile : undefined, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6, opacity: effDep ? 1 : 0.5 }}>
                <Text style={{ color: on ? theme.green : theme.sub, fontWeight: '800' }}>{m}</Text>
              </TouchableOpacity>
            );
          })}
          {String(s.takeoff_thrust || '').startsWith('FLEX') ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, width: 90, textAlign: 'center', opacity: effDep ? 1 : 0.5 }}
                keyboardType="numbers-and-punctuation" placeholder="°C" placeholderTextColor={theme.sub}
                editable={effDep}
                defaultValue={String(s.takeoff_thrust || '').replace(/[^0-9.-]/g, '')}
                onEndEditing={async (e) => {
                  const v = e.nativeEvent.text.replace(/[^0-9.-]/g, '');
                  await save({ takeoff_thrust: v ? `FLEX ${v}` : 'FLEX' });
                }} />
              <Text style={{ color: theme.sub }}>°C (FLEX assumed temperature)</Text>
            </View>
          ) : null}
        </View>
      </View>
      </> : null}
      </>) : null}

      <Text style={sx.section}>Diversion</Text>
      <View style={sx.card}>
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
          <View style={{ minWidth: 110 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Diverted</Text>
            <View style={{ minHeight: 44, justifyContent: 'center' }}>
              <Switch value={div.on} disabled={!canDivA} onValueChange={(v) => {
                const apt = v ? (div.airport || s.alternate_airport || '') : div.airport;   // default to Leon alternate
                setDiv({ on: v, airport: apt });
                save({ diverted: v, diversion_airport: v ? (apt || null) : null });
              }} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 240 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Diversion airport (ICAO)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <TextInput editable={div.on && canDivA} autoCapitalize="characters" maxLength={4}
                style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('diversion_airport') ? 2 : 1, borderColor: badSet.has('diversion_airport') ? theme.red : theme.border, borderRadius: 8, padding: 10, width: 90, textAlign: 'center', opacity: div.on ? 1 : 0.4 }}
                value={div.airport} placeholder={div.on ? 'LMML' : '—'} placeholderTextColor={theme.sub}
                onChangeText={(v) => setDiv({ ...div, airport: v.toUpperCase() })}
                onEndEditing={() => save({ diversion_airport: div.airport || null })} />
              {div.on && div.airport ? <IcaoHint code={div.airport} /> : null}
            </View>
          </View>
        </View>
        {div.on ? <Text style={{ color: theme.accent, fontSize: 11, marginTop: 8 }}>Diverted — landing, fuel &amp; times are at {div.airport || 'the diversion airport'} · planned destination {s.arr || '—'} · next leg starts from {div.airport || 'here'}.</Text>
          : (s.alternate_airport ? <Text style={{ color: theme.sub, fontSize: 11, marginTop: 8 }}>Planned alternate (Leon): {s.alternate_airport} — switch on Diverted to use it.</Text> : null)}
      </View>

      <Text style={sx.section}>Landing airport check (GPS){div.on ? ' — diverted' : ''}</Text>
      {(() => {
        const g = gps;
        const landApt = (div.on && div.airport) ? div.airport : s.arr;   // diversion airport if diverted
        const far = g.state === 'far';
        const ok = g.state === 'ok';
        const bg = far ? '#3a1111' : ok ? '#11351d' : theme.tile;
        const bc = far ? theme.red : ok ? theme.green : theme.border;
        const txt = g.state === 'checking' ? 'Checking GPS…'
          : ok ? `✓ GPS confirms landing at ${landApt} — ${g.km} km from ${g.name}`
          : far ? `⚠ GPS is ${g.km} km from ${landApt} (${g.name}) — landing airport looks incorrect. If diverted, switch on Diversion above and enter the airport.`
          : g.state === 'nogps' ? `ⓘ Optional GPS cross-check skipped — the iPad has no position fix (${g.msg || 'offline or indoors'}). The landing airport is not affected.`
          : g.state === 'error' ? `Cannot verify — ${g.msg}.`
          : 'Checks automatically against device GPS once ON (landing) is entered.';
        return (
          <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bc, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: far ? theme.red : ok ? theme.green : theme.text, fontSize: 13, fontWeight: far ? '800' : '600' }}>{txt}</Text>
            {s.landing ? <TouchableOpacity onPress={() => checkGps()} style={{ marginTop: 6 }}><Text style={{ color: theme.accent, fontWeight: '700', fontSize: 12 }}>{g.state === 'checking' ? '…' : 'Re-check GPS'}</Text></TouchableOpacity> : null}
          </View>
        );
      })()}


      <Text style={sx.section} onLayout={(e) => { secY.current['fuel'] = e.nativeEvent.layout.y; }}>Fuel on arrival</Text>
      <View style={sx.card}>
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
          <View style={{ width: 200 }}>
            <Text numberOfLines={1} style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Remaining — Chocks ON (kg)<EffHint on={effFields.has('fuel_remaining_kg')} /></Text>
            <TextInput editable={canFuelA} style={[{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('fuel_remaining_kg') ? 2 : 1, borderColor: badSet.has('fuel_remaining_kg') ? theme.red : theme.border, borderRadius: 8, padding: 10, opacity: canFuelA ? 1 : 0.5 }, effFields.has('fuel_remaining_kg') && !badSet.has('fuel_remaining_kg') ? effInputStyle : null]}
              keyboardType="decimal-pad" value={rem == null ? '' : String(rem)} onChangeText={(v) => { setRem(numericOnly(v)); pruneEff('fuel_remaining_kg'); }} />
          </View>
        </View>
        <TouchableOpacity style={[sx.save, { marginTop: 4 }, (!effDep || !canFuelA) && { opacity: 0.4 }]} disabled={!effDep || !canFuelA} onPress={async () => { if (await confirmAction('Save arrival fuel?')) { save({ fuel_remaining_kg: num(rem) }); trackActivity('save', 'fuel', sectorId, 'Arrival', { flight: s.flight_no, fuel_remaining_kg: num(rem) }); } }}><Text style={sx.saveText}>Save fuel on arrival</Text></TouchableOpacity>
      </View>

      {/* Oil quantity on arrival — read 5–30 min after engine shutdown (AMM). Pilots record it; a
          mechanic at the arrival station can fill it too. Entered in quarts, stored in litres. */}
      <Text style={sx.section} onLayout={(e) => { secY.current['oil'] = e.nativeEvent.layout.y; }}>Oil quantity on arrival (qt){(fc.oil_arrival_lm?.required ?? fc.oil_arrival?.required) && role() === 'mechanic' ? ' *' : fc.oil_arrival_crew?.required && role() !== 'mechanic' ? ' *' : ' — optional for crew; required when LM attends the arrival'}</Text>
      <View style={sx.card}>
        <Text style={{ color: theme.accent, fontSize: 12, marginBottom: 8 }}>ⓘ Per AMM, read the oil quantity between 5 and 30 minutes after engine shutdown.</Text>
        {!canOilA ? <RoBanner text="oil on arrival is recorded by flight crew or the mechanic at the arrival station" /> : null}
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
          <View style={{ width: 160 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Eng 1 oil (qt)</Text>
            <TextInput editable={canOilA} style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('oil_eng1') ? 2 : 1, borderColor: badSet.has('oil_eng1') ? theme.red : theme.border, borderRadius: 8, padding: 10, opacity: canOilA ? 1 : 0.5 }}
              keyboardType="decimal-pad" value={oilArr.eng1} onChangeText={(v) => setOilArr({ ...oilArr, eng1: numericOnly(v) })} />
          </View>
          <View style={{ width: 160 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Eng 2 oil (qt)</Text>
            <TextInput editable={canOilA} style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('oil_eng2') ? 2 : 1, borderColor: badSet.has('oil_eng2') ? theme.red : theme.border, borderRadius: 8, padding: 10, opacity: canOilA ? 1 : 0.5 }}
              keyboardType="decimal-pad" value={oilArr.eng2} onChangeText={(v) => setOilArr({ ...oilArr, eng2: numericOnly(v) })} />
          </View>
        </View>
        <TouchableOpacity disabled={!canOilA} style={[sx.save, { marginTop: 4 }, !canOilA && { opacity: 0.4 }]} onPress={async () => {
          if (!oilArr.eng1 && !oilArr.eng2) { setOilMsg('Enter Eng 1 and/or Eng 2 oil quantity.'); return; }
          if (!(await confirmAction('Save oil quantity on arrival? (read 5–30 min after shutdown)', 'Oil on arrival'))) return;
          setOilMsg('Oil on arrival saved ✓');
          const at = new Date().toISOString();
          for (const [sys, val] of [['eng1', oilArr.eng1], ['eng2', oilArr.eng2]] as const) {
            if (val) addServicing({ sector_id: sectorId, system: sys, arrival_lt: +(Number(val) * QT_L).toFixed(2), arrival_at: at }).catch(() => {});
          }
        }}><Text style={sx.saveText}>Save oil on arrival</Text></TouchableOpacity>
        {oilMsg ? <Text style={{ color: /saved/.test(oilMsg) ? theme.green : theme.red, fontSize: 12, marginTop: 6 }}>{oilMsg}</Text> : null}
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['ldg'] = e.nativeEvent.layout.y; }}>Landings (cycles)</Text>
      <View style={sx.card}>
        <Text style={[sx.sub, { marginTop: 0, marginBottom: 10 }]}>One landing per flight — after a go-around with touchdown, enter the actual number of landings. Touch &amp; go applies to TRAINING flights only. Totals update CSN / TSN from the OASES baseline.</Text>
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
          <View style={{ width: 130 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Landings (No.)</Text>
            <TextInput editable={canLdgA} keyboardType="numeric"
              style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, opacity: canLdgA ? 1 : 0.5 }}
              value={String(ldg.full_stop ?? '1')} onChangeText={(v) => setLdg({ ...ldg, full_stop: numericOnly(v, false) })} />
          </View>
          {(s.flight_type || '').toLowerCase() === 'training' ? (<>
          <View style={{ minWidth: 110 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Touch &amp; go</Text>
            <View style={{ minHeight: 44, justifyContent: 'center' }}>
              <Switch value={Number(ldg.touch_go) > 0} disabled={!canLdgA} onValueChange={(v) => setLdg({ ...ldg, touch_go: v ? (Number(ldg.touch_go) || 1) : 0 })} />
            </View>
          </View>
          <View style={{ width: 130 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>No. of touch &amp; go</Text>
            <TextInput editable={Number(ldg.touch_go) > 0} keyboardType="numeric"
              style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, opacity: Number(ldg.touch_go) > 0 ? 1 : 0.4 }}
              value={Number(ldg.touch_go) > 0 ? String(ldg.touch_go) : ''} placeholder="—" placeholderTextColor={theme.sub}
              onChangeText={(v) => setLdg({ ...ldg, touch_go: numericOnly(v, false) })} />
          </View>
          </>) : null}
          <View style={{ width: 130 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Total CSN (FC)</Text>
            <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              <Text style={{ color: theme.green, fontWeight: '800', fontSize: 15 }}>{newCsn ?? '—'}</Text>
            </View>
          </View>
          <View style={{ width: 150 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Total TSN (h:mm)</Text>
            <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              <Text style={{ color: theme.green, fontWeight: '800', fontSize: 15 }}>{fmtHM(newTsn)}</Text>
            </View>
          </View>
        </View>
        <Text style={{ color: theme.sub, fontSize: 10, marginTop: 6 }}>{util?.camo ? 'Baseline from OASES' : 'OASES pending — ETL baseline'} · this flight {thisLdgs} cycle(s) (1 landing{Number(ldg.touch_go) > 0 ? ` + ${Number(ldg.touch_go)} touch & go` : ''}) · leg {legFh ?? '—'} h. Posted to CAMO on close.</Text>
      </View>

      {role() !== 'mechanic' && isVis('autoland') ? (<>
      <Text style={sx.section}>Autoland</Text>
      <View style={sx.card}>
        <Text style={sx.sub}>Record only when an autoland was flown to touchdown. A manual take-over (aborted autoland) is NOT recorded.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {([['ok', 'Successful'], ['fail', 'Unsuccessful']] as const).map(([k, lbl]) => (
            <TouchableOpacity key={k} disabled={!canLdgA} onPress={() => setLdg({ ...ldg, autoland: ldg.autoland === k ? '' : k })}
              style={{ borderWidth: 2, borderColor: ldg.autoland === k ? (k === 'ok' ? theme.green : theme.red) : theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.tile }}>
              <Text style={{ color: ldg.autoland === k ? (k === 'ok' ? theme.green : theme.red) : theme.sub, fontWeight: '800' }}>{ldg.autoland === k ? '✓ ' : ''}{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {ldg.autoland === 'fail' ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Pilot notes — why unsuccessful *</Text>
            <TextInput editable={canLdgA} multiline style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, minHeight: 60 }}
              value={ldg.autoland_notes ?? ''} onChangeText={(v) => setLdg({ ...ldg, autoland_notes: v })} placeholder="e.g. AP disconnect at 200 ft — crosswind gust" placeholderTextColor={theme.sub} />
          </View>
        ) : null}
      </View>

      </>) : null}
      <TouchableOpacity style={[sx.save, { marginTop: 10 }, (!effDep || !canLdgA) && { opacity: 0.4 }]} disabled={!effDep || !canLdgA} onPress={async () => {
        if (ldg.autoland === 'fail' && !(ldg.autoland_notes || '').trim()) { Alert.alert('Autoland', 'Enter the pilot notes explaining the unsuccessful autoland.'); return; }
        if (!(await confirmAction('Save landings?'))) return; save({
        full_stop_ldgs: Number(ldg.full_stop) || 1, touch_go: (s.flight_type || '').toLowerCase() === 'training' ? (num(ldg.touch_go) || 0) : 0, ldgs_before: oasesCsn,
        this_flight_ldgs: thisLdgs, ldgs_fwd: (oasesCsn || 0) + thisLdgs,
        tsn_before: oasesTsn, tsn_fwd: newTsn,
        autoland_ok: ldg.autoland === 'ok', autoland_notes: ldg.autoland === 'fail' ? (ldg.autoland_notes || '').trim() : null,
      }); trackActivity('save', 'landings', sectorId, 'Arrival', { flight: s.flight_no, ldgs: thisLdgs }); }}><Text style={sx.saveText}>Save landings</Text></TouchableOpacity>

      <Text style={sx.section}>Defects on arrival ({role() === 'mechanic' ? 'MAREP' : 'PIREP'})</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.red, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('ReportDefect', { sectorId, aircraftId: s.aircraft_id })}><Text style={sx.saveText}>+ Report defect</Text></TouchableOpacity>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('Defects', { aircraftId: currentAircraft()?.registration || s.aircraft_id })}><Text style={sx.saveText}>View defects / HIL</Text></TouchableOpacity>
      </View>

      {isCrew && cabinPending.length ? (
        <>
          <Text style={sx.section}>Cabin defects — your decision ({cabinPending.length})</Text>
          <View style={sx.card}>
            <Text style={[sx.sub, { marginTop: 0, marginBottom: 4 }]}>Accept each cabin defect as dispatchable, or hold the aircraft.</Text>
            {cabinPending.map((d: any) => (
              <View key={d.id} style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, marginTop: 10 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{d.title || d.description}</Text>
                <Text style={sx.sub}>CABIN · ATA {d.ata_chapter || '—'}{d.title && d.description ? ` · ${d.description}` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <TouchableOpacity style={[sx.save, { backgroundColor: theme.green, flex: 1, minWidth: 150, maxWidth: undefined, marginTop: 0 }]} onPress={() => decideCabin(d.id, true)}><Text style={sx.saveText}>Accept — dispatchable</Text></TouchableOpacity>
                  <TouchableOpacity style={[sx.save, { backgroundColor: theme.red, flex: 1, minWidth: 150, maxWidth: undefined, marginTop: 0 }]} onPress={() => decideCabin(d.id, false)}><Text style={sx.saveText}>Not dispatchable — hold</Text></TouchableOpacity>
                  <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, flex: 1, minWidth: 100, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}><Text style={sx.saveText}>Details</Text></TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Text style={sx.section}>Acceptance (post-flight)</Text>
      {(() => {
        // Button is always tappable when the user has permission and departure is accepted —
        // accept() shows a popup listing any missing fields instead of silently disabling.
        return (
          <>
            <Animated.View style={{ transform: [{ scale: readyPulse.scale }] }}>
            <TouchableOpacity disabled={!canAct} style={[sx.save, { backgroundColor: theme.accent, opacity: canAct ? 1 : 0.4 }]} onPress={accept}>
              <Text style={[sx.saveText, { color: theme.onAccent }]}>{!effDep ? 'Accept departure first' : !canAcceptA ? 'Not permitted' : 'Sign — close sector (arrival)'}</Text>
            </TouchableOpacity>
            </Animated.View>
            {signMsg ? (
              <Text style={{ color: /Complete|Could not/.test(signMsg) ? theme.red : theme.sub, fontSize: 12, marginTop: 6 }}>{signMsg}</Text>
            ) : null}
          </>
        );
      })()}
      <OfflineFlash message={/offline|will sync|queued/i.test(signMsg) ? signMsg : null} />
      {(s.status === 'closed' || s.status === 'exported') ? (
        <>
          <SignatureBlock label="Post-flight acceptance — signed" sig={(s as any).signatures?.find((g: any) => g.kind === 'postflight')} style={{ marginBottom: 8 }} />
          <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => setShowTlp(true)}>
            <Text style={sx.saveText}>📄  View Tech Log page (goes to OASES)</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {showTlp ? <TechLogPageModal sectorId={sectorId} onClose={() => setShowTlp(false)} /> : null}
      <SignaturePad visible={acceptSigning} title="Sign — Post-flight acceptance"
        onClose={() => setAcceptSigning(false)}
        onDone={(sig) => finishAccept(sig)} />
    </ScrollView>
  );
}
