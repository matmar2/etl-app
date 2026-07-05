import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { acceptDispatch, aircraftUtilisation, appSettings, can, currentAircraft, listActiveDefects, publicConfig, role, signRecord, Utilisation } from '../api/client';
import ClockBanner from '../components/ClockBanner';
import IcaoHint from '../components/IcaoHint';
import TechLogPageModal from '../components/TechLogPageModal';
import { confirmAction } from '../util/confirm';
import { checkAirportGps } from '../util/geo';
import { theme } from '../theme';
import { fmtHM, hhmm, hm, num, numericOnly, OOOISection, schedule, sx, useSector } from './sectorShared';

export default function ArrivalScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, msg, save, stamp, setManual, clearTime } = useSector(sectorId);
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
    setLdg({ full_stop_ldgs: s.full_stop_ldgs, touch_go: s.touch_go, ldgs_before: s.ldgs_before, autoland_attempted: !!s.autoland_attempted, autoland_ok: !!s.autoland_ok });
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
  const thisLdgs = 1 + (Number(ldg.touch_go) || 0);   // one full-stop landing this flight + any touch-and-goes
  const legFh = s.flight_time_min != null ? Math.round((s.flight_time_min / 60) * 10) / 10 : null;   // this leg flight hours
  const newTsn = (oasesTsn != null && legFh != null) ? Math.round((oasesTsn + legFh) * 10) / 10 : null;
  const newCsn = oasesCsn != null ? oasesCsn + thisLdgs : null;

  const hasV = (v: any) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v));
  function computeMissing() {
    const m = mand || {}; const out: { key: string; label: string; sec: string }[] = [];
    const add = (key: string, label: string, sec: string, ok: boolean) => { if (m[key] && !ok) out.push({ key, label, sec }); };
    add('arr', 'Arrival airport', 'top', !!s.arr);
    add('takeoff', 'OFF (take-off)', 'oooi', !!s.takeoff);
    add('landing', 'ON (landing)', 'oooi', !!s.landing);
    add('on_block', 'IN (on-block)', 'oooi', !!s.on_block);
    add('landing_fuel_kg', 'Fuel at touch-down', 'fuel', hasV(lf));
    add('fuel_remaining_kg', 'Remaining fuel', 'fuel', hasV(rem));
    add('landings', 'Landings', 'ldg', true);   // one full-stop landing is implicit per flight
    add('diversion_airport', 'Diversion airport', 'oooi', !div.on || !!div.airport);   // required only when diverted
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
      <Text style={sx.title}>Arrival · {currentAircraft()?.registration || s.aircraft_id} · {s.flight_no} · {s.dep} → {s.arr}</Text>
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

      <Text style={sx.section} onLayout={(e) => { secY.current['oooi'] = e.nativeEvent.layout.y; }}>Times (OFF / ON / IN)</Text>
      <OOOISection s={s} fields={['takeoff', 'landing', 'on_block']} stamp={stamp} setManual={setManual} clear={(canOooiA && effDep) ? clearTime : undefined} disabled={!effDep || !canOooiA} />
      <Text style={sx.sub}>Block {hm(s.block_time_min)} · Flight {hm(s.flight_time_min)} (h:mm)</Text>

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
          : g.state === 'nogps' ? `GPS not available (${g.msg || 'no location'}).`
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
          <View style={{ width: 160 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4, minHeight: 34 }}>Fuel at touch-down (kg)</Text>
            <TextInput editable={canFuelA} style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, opacity: canFuelA ? 1 : 0.5 }}
              keyboardType="decimal-pad" value={lf == null ? '' : String(lf)} onChangeText={(v) => setLf(numericOnly(v))} />
          </View>
          <View style={{ width: 160 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4, minHeight: 34 }}>Remaining — Chocks ON (kg)</Text>
            <TextInput editable={canFuelA} style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('fuel_remaining_kg') ? 2 : 1, borderColor: badSet.has('fuel_remaining_kg') ? theme.red : theme.border, borderRadius: 8, padding: 10, opacity: canFuelA ? 1 : 0.5 }}
              keyboardType="decimal-pad" value={rem == null ? '' : String(rem)} onChangeText={(v) => setRem(numericOnly(v))} />
          </View>
        </View>
        <TouchableOpacity style={[sx.save, { marginTop: 4 }, (!effDep || !canFuelA) && { opacity: 0.4 }]} disabled={!effDep || !canFuelA} onPress={async () => { if (await confirmAction('Save arrival fuel?')) save({ landing_fuel_kg: num(lf), fuel_remaining_kg: num(rem) }); }}><Text style={sx.saveText}>Save fuel on arrival</Text></TouchableOpacity>
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['ldg'] = e.nativeEvent.layout.y; }}>Landings (cycles)</Text>
      <View style={sx.card}>
        <Text style={[sx.sub, { marginTop: 0, marginBottom: 10 }]}>One landing per flight. Switch Touch &amp; go on to add training landings; the totals update CSN / TSN from the OASES baseline.</Text>
        <View style={[sx.grid, { alignItems: 'flex-start' }]}>
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
        <View style={sx.switchRow}><Text style={{ color: theme.sub }}>Autoland attempted</Text><Switch value={ldg.autoland_attempted} disabled={!canLdgA} onValueChange={(v) => setLdg({ ...ldg, autoland_attempted: v })} /></View>
        <View style={sx.switchRow}><Text style={{ color: theme.sub }}>Autoland successful</Text><Switch value={ldg.autoland_ok} disabled={!canLdgA} onValueChange={(v) => setLdg({ ...ldg, autoland_ok: v })} /></View>
      </View>

      <TouchableOpacity style={[sx.save, { marginTop: 10 }, (!effDep || !canLdgA) && { opacity: 0.4 }]} disabled={!effDep || !canLdgA} onPress={async () => { if (!(await confirmAction('Save landings?'))) return; save({
        full_stop_ldgs: 1, touch_go: num(ldg.touch_go) || 0, ldgs_before: oasesCsn,
        this_flight_ldgs: thisLdgs, ldgs_fwd: (oasesCsn || 0) + thisLdgs,
        autoland_attempted: ldg.autoland_attempted, autoland_ok: ldg.autoland_ok,
      }); }}><Text style={sx.saveText}>Save landings</Text></TouchableOpacity>

      <Text style={sx.section}>Defects on arrival (MAREP)</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.red, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('ReportDefect', { sectorId, aircraftId: s.aircraft_id })}><Text style={sx.saveText}>+ Report defect</Text></TouchableOpacity>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('Defects', { aircraftId: s.aircraft_id })}><Text style={sx.saveText}>View defects / HIL</Text></TouchableOpacity>
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
      <TouchableOpacity disabled={!canAct} style={[sx.save, { backgroundColor: theme.accent, opacity: canAct ? 1 : 0.4 }]} onPress={accept}>
        <Text style={[sx.saveText, { color: '#1a1300' }]}>{!effDep ? 'Accept departure first' : !canAcceptA ? 'Not permitted' : (signMsg || 'Sign — close sector (arrival)')}</Text>
      </TouchableOpacity>
      {(s.status === 'closed' || s.status === 'exported') ? (
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => setShowTlp(true)}>
          <Text style={sx.saveText}>📄  View Tech Log page (goes to OASES)</Text>
        </TouchableOpacity>
      ) : null}
      {showTlp ? <TechLogPageModal sectorId={sectorId} onClose={() => setShowTlp(false)} /> : null}
    </ScrollView>
  );
}
