import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { acceptDispatch, addServicing, aircraftUtilisation, appSettings, can, currentAircraft, listActiveDefects, listServicing, publicConfig, role, signRecord, tokenIssuedAt, Utilisation } from '../api/client';
import ClockBanner from '../components/ClockBanner';
import IcaoHint from '../components/IcaoHint';
import OfflineFlash from '../components/OfflineFlash';
import RoBanner from '../components/RoBanner';
import TechLogPageModal from '../components/TechLogPageModal';
import { confirmAction } from '../util/confirm';
import { checkAirportGps } from '../util/geo';
import SyncBlock from '../components/SyncBlock';
import { theme } from '../theme';
import { fmtHM, hhmm, hm, num, numericOnly, OOOISection, schedule, sx, useSector } from './sectorShared';

export default function ArrivalScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, msg, syncing, save, stamp, setManual, clearTime } = useSector(sectorId);
  const [ldg, setLdg] = useState<any>({});
  const [rem, setRem] = useState<any>('');
  const [lf, setLf] = useState<any>('');
  const [signMsg, setSignMsg] = useState('');
  const [showTlp, setShowTlp] = useState(false);
  const [gps, setGps] = useState<{ state: 'idle' | 'checking' | 'ok' | 'far' | 'nogps' | 'error'; km?: number; name?: string; msg?: string }>({ state: 'idle' });
  const [mand, setMand] = useState<any>({});
  const [cabinPending, setCabinPending] = useState<any[]>([]);
  const [util, setUtil] = useState<Utilisation | null>(null);
  const [div, setDiv] = useState<{ on: boolean; airport: string }>({ on: false, airport: '' });
  const [badSet, setBadSet] = useState<Set<string>>(new Set());
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
  useEffect(() => { appSettings().then((x: any) => setMand(x.mandatory_fields?.arrival || {})).catch(() => {}); }, []);
  useEffect(() => { publicConfig().then((c: any) => setTesting(!!c.testing_mode)).catch(() => {}); }, []);

  async function checkGps(arr?: string) {
    const eff = (s?.diverted && s?.diversion_airport) ? s.diversion_airport : s?.arr;   // diverted → check the diversion airport
    const code = (arr || eff || '').trim();
    if (!code) return;
    setGps({ state: 'checking' });
    setGps(await checkAirportGps(code));
  }

  useEffect(() => {
    if (!s) return;
    setLdg({ full_stop: String(s.full_stop_ldgs ?? 1), touch_go: s.touch_go, ldgs_before: s.ldgs_before, autoland: s.autoland_ok ? 'ok' : (s.autoland_notes ? 'fail' : ''), autoland_notes: s.autoland_notes ?? '' });
    setRem(s.fuel_remaining_kg);
    setLf(s.landing_fuel_kg);
    setDiv({ on: !!s.diverted, airport: s.diversion_airport || '' });
    if (s.status !== 'draft') checkGps();   // verify the landing airport (diversion airport if diverted) against device GPS
    loadCabin();
    aircraftUtilisation(s.aircraft_id).then(setUtil).catch(() => {});   // OASES/CAMO CSN for total cycles
  }, [!!s]);
  function loadCabin() {
    const reg = s?.aircraft_id; if (!reg) return;
    listActiveDefects(reg).then((ds: any[]) => setCabinPending(ds.filter((d) => d.area === 'cabin' && d.dispatch_accepted == null && d.status !== 'closed'))).catch(() => {});
  }
  async function decideCabin(id: string, ok: boolean) { try { await acceptDispatch(id, ok); loadCabin(); } catch { /* offline */ } }

  if (!s) return <View style={sx.wrap}><Text style={sx.sub}>Loading…</Text></View>;
  const isCrew = role() === 'captain' || role() === 'pilot' || role() === 'admin';
  const canOooiA = can('arrival', 'oooi');         // arrival OFF/ON/IN times
  const canFuelA = can('arrival', 'fuel');         // fuel at touch-down / remaining
  const canLdgA = can('arrival', 'landings');      // landings / cycles / autoland
  const canDivA = can('arrival', 'diversion');     // diversion airport
  const canOilA = can('arrival', 'servicing');     // oil quantity on arrival — crew (per AMM) + mechanic at arrival station
  const canAcceptA = can('arrival', 'acceptance'); // post-flight acceptance / close
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
  const thisLdgs = (Number(ldg.full_stop) || 1) + (s?.flight_type === 'training' ? (Number(ldg.touch_go) || 0) : 0);   // landings entered + T&G (training only)
  const legFh = s.flight_time_min != null ? Math.round((s.flight_time_min / 60) * 10) / 10 : null;   // this leg flight hours
  const newTsn = oasesTsn != null ? Math.round((oasesTsn + (legFh || 0)) * 10) / 10 : null;   // baseline shows at once; leg FH folds in once takeoff+landing are stamped
  const newCsn = oasesCsn != null ? oasesCsn + thisLdgs : null;

  const hasV = (v: any) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v));
  function computeMissing() {
    const m = mand || {}; const out: { key: string; label: string; sec: string }[] = [];
    // force = always required to close a sector (independent of the admin mandatory-field config):
    // you cannot close on arrival without recording that you landed and are on blocks.
    const add = (key: string, label: string, sec: string, ok: boolean, force = false) => { if ((force || m[key]) && !ok) out.push({ key, label, sec }); };
    add('arr', 'Arrival airport', 'top', !!s.arr);
    add('off_block', 'OUT (off-block)', 'oooi', !!s.off_block);
    add('takeoff', 'OFF (take-off)', 'oooi', !!s.takeoff);
    add('landing', 'ON (landing)', 'oooi', !!s.landing, true);
    add('on_block', 'IN (on-block)', 'oooi', !!s.on_block, true);
    add('fuel_remaining_kg', 'Remaining fuel', 'fuel', hasV(rem));
    // Oil quantity on arrival (read 5–30 min after shutdown per AMM) — admin-toggleable
    // (Settings → Mandatory fields → Arrival → "Oil on arrival"); mandatory by default.
    const lmAttended = role() === 'mechanic' && (() => {
      const ia = tokenIssuedAt(); const sd = s.on_block || s.landing;
      return !!(ia && sd && ia > new Date(sd).getTime());
    })();
    const oilLm = (m.oil_arrival_lm ?? m.oil_arrival) && lmAttended;      // legacy key → LM knob
    const oilCrew = m.oil_arrival_crew && (role() === 'captain' || role() === 'pilot');
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
      return;
    }
    setBadSet(new Set());
    if (!(await confirmAction('Confirm post-flight acceptance and close this sector?', 'Post-flight acceptance'))) return;
    try {
      // Persist the (mandatory) arrival oil with the closure so a typed-but-unsaved value is never lost.
      const at = new Date().toISOString();
      for (const [sys, val] of [['eng1', oilArr.eng1], ['eng2', oilArr.eng2]] as const) {
        if (val) await addServicing({ sector_id: sectorId, system: sys, arrival_lt: +(Number(val) * QT_L).toFixed(2), arrival_at: at }).catch(() => {});
      }
      const r: any = await signRecord({ kind: 'postflight', sector_id: sectorId });
      await save({ status: 'closed' });            // reflect locally so the next flight can be opened
      setSignMsg(r?.queued ? 'Closed offline — will sync ✓' : (r.status === 'closed' ? 'Closed ✓' : 'Signed'));
    } catch (e: any) {
      const em = e?.message || '';
      setSignMsg(/complete|mandatory|required/i.test(em) ? em : 'Offline — queued');
    }
  }

  return (
    <ScrollView ref={scrollRef} style={sx.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <SyncBlock visible={syncing} />
      <Text style={sx.title}>After Departure closed / Arrival · {currentAircraft()?.registration || s.aircraft_id} · {s.flight_no} · {s.dep} → {s.arr}</Text>
      {(() => { const sc = schedule(s); return (
        <Text style={sx.sub}>STD {hhmm(s.std)} · STA {hhmm(s.sta)}{sc.eta ? ` · ${sc.arrived ? 'ATA' : 'ETA'} ${hhmm(sc.eta)}` : ''}{sc.delayMin > 0 ? `  (delay +${sc.delayMin}′)` : ''}</Text>
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
                checkGps(v && apt ? apt : s.arr);
              }} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 240 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Diversion airport (ICAO)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <TextInput editable={div.on && canDivA} autoCapitalize="characters" maxLength={4}
                style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, width: 90, textAlign: 'center', opacity: div.on ? 1 : 0.4 }}
                value={div.airport} placeholder={div.on ? 'LMML' : '—'} placeholderTextColor={theme.sub}
                onChangeText={(v) => setDiv({ ...div, airport: v.toUpperCase() })}
                onEndEditing={() => { save({ diversion_airport: div.airport || null }); if (div.on && div.airport) checkGps(div.airport); }} />
              {div.on && div.airport ? <IcaoHint code={div.airport} /> : null}
            </View>
          </View>
        </View>
        {div.on ? <Text style={{ color: theme.accent, fontSize: 11, marginTop: 8 }}>Diverted — landing, fuel &amp; times are at {div.airport || 'the diversion airport'} · planned destination {s.arr || '—'} · next leg starts from {div.airport || 'here'}.</Text>
          : (s.alternate_airport ? <Text style={{ color: theme.sub, fontSize: 11, marginTop: 8 }}>Planned alternate (Leon): {s.alternate_airport} — switch on Diverted to use it.</Text> : null)}
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['oooi'] = e.nativeEvent.layout.y; }}>Times (OUT / OFF / ON / IN)</Text>
      <OOOISection s={s} fields={['off_block', 'takeoff', 'landing', 'on_block']} stamp={stamp} setManual={setManual} clear={(canOooiA && effDep) ? clearTime : undefined} disabled={!effDep || !canOooiA} />
      <Text style={sx.sub}>{(() => {
        const mm = (a?: string | null, b?: string | null) => (a && b) ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;
        return `Block ${hm(mm(s.off_block, s.on_block) ?? s.block_time_min)} · Flight ${hm(mm(s.takeoff, s.landing) ?? s.flight_time_min)} (h:mm)`;
      })()}</Text>

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
          : 'Tap to verify the landing airport against device GPS.';
        return (
          <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bc, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: far ? theme.red : ok ? theme.green : theme.text, fontSize: 13, fontWeight: far ? '800' : '600' }}>{txt}</Text>
            <TouchableOpacity onPress={() => checkGps()} style={{ marginTop: 6 }}><Text style={{ color: theme.accent, fontWeight: '700', fontSize: 12 }}>{g.state === 'checking' ? '…' : 'Re-check GPS'}</Text></TouchableOpacity>
          </View>
        );
      })()}


      <Text style={sx.section} onLayout={(e) => { secY.current['fuel'] = e.nativeEvent.layout.y; }}>Fuel on arrival</Text>
      <View style={sx.card}>
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
          <View style={{ width: 200 }}>
            <Text numberOfLines={1} style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Remaining — Chocks ON (kg)</Text>
            <TextInput editable={canFuelA} style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('fuel_remaining_kg') ? 2 : 1, borderColor: badSet.has('fuel_remaining_kg') ? theme.red : theme.border, borderRadius: 8, padding: 10, opacity: canFuelA ? 1 : 0.5 }}
              keyboardType="decimal-pad" value={rem == null ? '' : String(rem)} onChangeText={(v) => setRem(numericOnly(v))} />
          </View>
        </View>
        <TouchableOpacity style={[sx.save, { marginTop: 4 }, (!effDep || !canFuelA) && { opacity: 0.4 }]} disabled={!effDep || !canFuelA} onPress={async () => { if (await confirmAction('Save arrival fuel?')) save({ fuel_remaining_kg: num(rem) }); }}><Text style={sx.saveText}>Save fuel on arrival</Text></TouchableOpacity>
      </View>

      {/* Oil quantity on arrival — read 5–30 min after engine shutdown (AMM). Pilots record it; a
          mechanic at the arrival station can fill it too. Entered in quarts, stored in litres. */}
      <Text style={sx.section} onLayout={(e) => { secY.current['oil'] = e.nativeEvent.layout.y; }}>Oil quantity on arrival (qt){(mand?.oil_arrival_lm ?? mand?.oil_arrival) && role() === 'mechanic' ? ' *' : mand?.oil_arrival_crew && role() !== 'mechanic' ? ' *' : ' — optional for crew; required when LM attends the arrival'}</Text>
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
          const at = new Date().toISOString();
          try {
            for (const [sys, val] of [['eng1', oilArr.eng1], ['eng2', oilArr.eng2]] as const) {
              if (val) await addServicing({ sector_id: sectorId, system: sys, arrival_lt: +(Number(val) * QT_L).toFixed(2), arrival_at: at });
            }
            setOilMsg('Oil on arrival saved ✓');
          } catch (e: any) { setOilMsg(e?.message || 'Could not save'); }
        }}><Text style={sx.saveText}>Save oil on arrival</Text></TouchableOpacity>
        {oilMsg ? <Text style={{ color: /saved/.test(oilMsg) ? theme.green : theme.red, fontSize: 12, marginTop: 6 }}>{oilMsg}</Text> : null}
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['ice'] = e.nativeEvent.layout.y; }}>Ice protection</Text>
      <View style={sx.card}>
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
          {s.flight_type === 'training' ? (<>
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

      <TouchableOpacity style={[sx.save, { marginTop: 10 }, (!effDep || !canLdgA) && { opacity: 0.4 }]} disabled={!effDep || !canLdgA} onPress={async () => {
        if (ldg.autoland === 'fail' && !(ldg.autoland_notes || '').trim()) { Alert.alert('Autoland', 'Enter the pilot notes explaining the unsuccessful autoland.'); return; }
        if (!(await confirmAction('Save landings?'))) return; save({
        full_stop_ldgs: Number(ldg.full_stop) || 1, touch_go: s.flight_type === 'training' ? (num(ldg.touch_go) || 0) : 0, ldgs_before: oasesCsn,
        this_flight_ldgs: thisLdgs, ldgs_fwd: (oasesCsn || 0) + thisLdgs,
        autoland_ok: ldg.autoland === 'ok', autoland_notes: ldg.autoland === 'fail' ? (ldg.autoland_notes || '').trim() : null,
      }); }}><Text style={sx.saveText}>Save landings</Text></TouchableOpacity>

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
        const missing = canAct ? computeMissing() : [];         // required arrival fields still empty
        const canSign = canAct && missing.length === 0;
        return (
          <>
            <TouchableOpacity disabled={!canSign} style={[sx.save, { backgroundColor: theme.accent, opacity: canSign ? 1 : 0.4 }]} onPress={accept}>
              <Text style={[sx.saveText, { color: '#1a1300' }]}>{!effDep ? 'Accept departure first' : !canAcceptA ? 'Not permitted' : (signMsg || 'Sign — close sector (arrival)')}</Text>
            </TouchableOpacity>
            {canAct && missing.length ? (
              <Text style={{ color: theme.sub, fontSize: 12, marginTop: 6 }}>Complete before signing: {missing.map((x) => x.label).join(', ')}</Text>
            ) : null}
          </>
        );
      })()}
      <OfflineFlash message={/offline|will sync|queued/i.test(signMsg) ? signMsg : null} />
      {(s.status === 'closed' || s.status === 'exported') ? (
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => setShowTlp(true)}>
          <Text style={sx.saveText}>📄  View Tech Log page (goes to OASES)</Text>
        </TouchableOpacity>
      ) : null}
      {showTlp ? <TechLogPageModal sectorId={sectorId} onClose={() => setShowTlp(false)} /> : null}
    </ScrollView>
  );
}
