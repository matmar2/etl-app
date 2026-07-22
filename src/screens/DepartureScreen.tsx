import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { acceptDispatch, addServicing, aircraftConfig, sectorCheckOverride, aircraftStatus, AircraftStatus, aircraftUtilisation, allocateTl, appSettings, can, currentAircraft, listActiveDefects, listAttachments, PrevFuel, prevFuelCached, publicConfig, revokeAcceptance, signRecord, Tank, userName, Utilisation } from '../api/client';
import ClockBanner from '../components/ClockBanner';
import IcaoHint from '../components/IcaoHint';
import OfflineFlash from '../components/OfflineFlash';
import PhotoCapture from '../components/PhotoCapture';
import RoBanner from '../components/RoBanner';
import SignaturePad from '../components/SignaturePad';
import WalkaroundModal from '../components/WalkaroundModal';
import { confirmAction } from '../util/confirm';
import { checkAirportGps, GpsState } from '../util/geo';
import SyncBlock from '../components/SyncBlock';
import { theme } from '../theme';
import { fmt, fmtHM, hhmm, NumField, num, numericOnly, OOOISection, round1, schedule, sx, useSector } from './sectorShared';

export default function DepartureScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, msg, syncing, save, stamp, setManual, clearTime, refresh } = useSector(sectorId);
  const [fuel, setFuel] = useState<any>({});
  const [serv, setServ] = useState<any>({});
  const [servBad, setServBad] = useState(false);      // mandatory total-oil validation
  const [servMsg, setServMsg] = useState('');
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [signMsg, setSignMsg] = useState('');
  const [pfiMsg, setPfiMsg] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => { publicConfig().then((c: any) => setTesting(!!c.testing_mode)).catch(() => {}); }, []);
  const [upliftUnit, setUpliftUnit] = useState<'KG' | 'LB' | 'IG' | 'L'>('KG');
  const [upliftManual, setUpliftManual] = useState(false);   // total uplift entered by hand → overrides Σ tanks
  const [upliftText, setUpliftText] = useState('');          // raw text in the box (current unit) — preserves decimals while typing
  const [bowserUnit, setBowserUnit] = useState<'KG' | 'LB' | 'IG' | 'L'>('L');
  const [bowserText, setBowserText] = useState('');
  const [bowserUnitOpen, setBowserUnitOpen] = useState(false);   // unit dropdown expanded
  const [util, setUtil] = useState<Utilisation | null>(null);
  const [routeEdit, setRouteEdit] = useState<any>({});
  const [minFuel, setMinFuel] = useState<number | null>(null);
  const [prevF, setPrevF] = useState<PrevFuel | null>(null);
  const [receiptN, setReceiptN] = useState<number | null>(null);   // fuel-receipt photos on this sector (null = unknown/offline)
  const [prevChoice, setPrevChoice] = useState<'etl' | 'leon' | null>(null);   // pilot's pick when ETL and Leon disagree
  const [servMin, setServMin] = useState<any>(null);
  const [tankEntry, setTankEntry] = useState(false);   // admin: per-tank boxes on the iPad (crew default = total only)
  const [pfiName, setPfiName] = useState(userName() || '');   // pre-filled with the signed-in user, editable
  const [pfiSigning, setPfiSigning] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);   // FCOM walkaround page shown before signing the PFI
  const [acSt, setAcSt] = useState<AircraftStatus | null>(null);
  const [cabinPending, setCabinPending] = useState<any[]>([]);
  const [depGps, setDepGps] = useState<GpsState>({ state: 'idle' });
  const [mand, setMand] = useState<any>({});                 // admin mandatory-fields config (departure)
  const [badSet, setBadSet] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const secY = useRef<Record<string, number>>({});
  const [fuelTol, setFuelTol] = useState(2);   // bowser-vs-uplift cross-check tolerance % (admin-set)
  const [gradeDef, setGradeDef] = useState('Jet A-1');   // admin-set fuel grade prefill (editable)
  const [ovEnabled, setOvEnabled] = useState(false);     // admin toggle: per-leg commander check-confirmation
  const [ovOpen, setOvOpen] = useState(false);           // conditions list expanded
  const gradeDefRef = useRef('Jet A-1');
  useEffect(() => { appSettings().then((x: any) => { setMand(x.mandatory_fields?.departure || {}); const t = Number(x.fuel_cross_tolerance_pct); if (t > 0) setFuelTol(t); if (x.fuel_grade_default) { setGradeDef(String(x.fuel_grade_default)); gradeDefRef.current = String(x.fuel_grade_default); } setTankEntry(!!x.departure_tank_entry); setOvEnabled(!!(x as any).check_override?.enabled); }).catch(() => {}); }, []);
  // Show the DEFAULT SG (editable) instead of an empty box — reference density from Fleet.
  useEffect(() => {
    if (servMin && (fuel.fuel_density == null || fuel.fuel_density === '')) {
      setFuel((f: any) => (f.fuel_density == null || f.fuel_density === '') ? { ...f, fuel_density: String(Number(servMin.fuel_density_ref) || 0.785) } : f);
    }
  }, [servMin]);
  // Fuel grade defaults from admin Settings (editable per sector).
  useEffect(() => {
    setFuel((f: any) => (f && (f.fuel_grade == null || f.fuel_grade === '') ? { ...f, fuel_grade: gradeDef } : f));
  }, [gradeDef, s?.id]);
  async function checkDepGps() { if (s?.dep) { setDepGps({ state: 'checking' }); setDepGps(await checkAirportGps(s.dep)); } }
  const refreshStatus = useCallback(() => {
    const reg = currentAircraft()?.registration || s?.aircraft_id;
    if (!reg) return;
    aircraftStatus(reg).then(setAcSt).catch(() => {});
    listActiveDefects(reg).then((ds: any[]) => setCabinPending(ds.filter((d) => d.area === 'cabin' && d.dispatch_accepted == null && d.status !== 'closed'))).catch(() => {});
  }, [s?.aircraft_id]);
  async function decideCabin(id: string, ok: boolean) { try { await acceptDispatch(id, ok); refreshStatus(); } catch { /* offline */ } }
  useFocusEffect(useCallback(() => {           // refresh serviceability, cabin decisions + GPS each time
    refreshStatus();
    if (s?.dep && !s?.off_block) checkAirportGps(s.dep).then(setDepGps).catch(() => {});   // confirm departure airport before push-back
  }, [refreshStatus, s?.dep, s?.off_block]));

  useEffect(() => {
    if (!s) return;
    aircraftUtilisation(s.aircraft_id).then(setUtil).catch(() => {});
    setPrevChoice(null);
    prevFuelCached(sectorId, currentAircraft()?.registration || s.aircraft_id).then(setPrevF).catch(() => {});   // returns both ETL + Leon candidates
    listAttachments({ sector_id: sectorId }).then((a) => setReceiptN(a.filter((x) => x.kind === 'receipt').length)).catch(() => setReceiptN(null));
    setRouteEdit({ flight_no: s.flight_no, dep: s.dep, arr: s.arr });
    setFuel({ fuel_planned_kg: s.fuel_planned_kg, fuel_uplift_kg: s.fuel_uplift_kg, fuel_density: s.fuel_density,
      fuel_supplier: s.fuel_supplier, dep_fuel_kg: s.dep_fuel_kg, taxi_fuel_kg: s.taxi_fuel_kg, fuel_found_kg: s.fuel_found_kg,
      bowser_uplift_lt: s.bowser_uplift_lt, fuel_grade: s.fuel_grade || gradeDefRef.current, nil_oils_fluids: !!s.nil_oils_fluids });
    setBowserText(s.bowser_uplift_lt == null || s.bowser_uplift_lt === '' ? '' : String(round1(Number(s.bowser_uplift_lt))));   // L (default unit)
    aircraftConfig(s.aircraft_id).then((c) => {
      setTanks(c.tanks);
      setMinFuel(c.min_fuel_kg ?? null);
      setServMin(c);
      setFuel((p: any) => { const n = { ...p }; c.tanks.forEach((t) => (n[t.field] = s[t.field])); return n; });
      const savedTankSum = c.tanks.reduce((a, t) => a + (Number(s[t.field]) || 0), 0);   // legacy: saved uplift equal to Σ tanks ⇒ auto
      if (Number(s.fuel_uplift_kg) > 0 && Math.round(Number(s.fuel_uplift_kg)) !== Math.round(savedTankSum)) {
        setUpliftManual(true);
        setUpliftText(String(round1(Number(s.fuel_uplift_kg))));   // KG (default unit)
      }
    }).catch(() => {});
  }, [!!s]);

  if (!s) return <View style={sx.wrap}><Text style={sx.sub}>Loading…</Text></View>;
  const QT_L = 0.946353;                                  // US quart -> litre; oil stored canonically in L
  // Engine oil is measured in QUARTS (Airbus oil-quantity indication); stored canonically in litres.
  const oilToL = (v: string) => +(((Number(v) || 0) * QT_L).toFixed(2));
  const oilShown = (lv: any) => { if (lv === '' || lv == null) return ''; return String(Math.round((Number(lv) / QT_L) * 10) / 10); };
  const qtOf = (l: number) => Math.round((l / QT_L) * 10) / 10;           // FCOM litre minimum -> quarts (display)
  // Tanks hold the INDICATED CONTENTS after refuelling. Actual Total uplift (auto) =
  // Σ tanks − (fuel before refuelling, else previous-leg landing fuel). Manual override allowed.
  const tankVals = tanks.map((t) => Number(fuel[t.field])).filter((n) => !isNaN(n) && n > 0);
  const tankSumKg = tankVals.reduce((a, b) => a + b, 0);
  // Two previous-leg sources: ETL (operator record) and Leon JL. If they disagree, the pilot
  // must pick which to use before the departure-fuel calculation runs.
  const etlC = prevF?.etl && prevF.etl.fuel_kg != null ? prevF.etl : null;
  const leonC = prevF?.leon && prevF.leon.fuel_kg != null ? prevF.leon : null;
  const prevDiverge = !!etlC && !!leonC && Math.abs(Number(etlC.fuel_kg) - Number(leonC.fuel_kg)) >= 1;
  const prevResolved: PrevFuel | null = prevDiverge
    ? (prevChoice === 'etl' ? etlC : prevChoice === 'leon' ? leonC : null)   // paused until a source is chosen
    : (prevF && prevF.fuel_kg != null ? prevF : null);
  const prevKg = prevResolved?.fuel_kg ?? null;
  // Fuel remaining before refueling — the actual on-board fuel read before uplift. It can be LESS
  // than the previous leg's landing fuel when maintenance ran the APU or did an engine run in
  // between. When entered it becomes the base for the departure-fuel fallback (else the prev-leg fuel).
  const fuelFoundKg: number | null = (fuel.fuel_found_kg === '' || fuel.fuel_found_kg == null || isNaN(Number(fuel.fuel_found_kg))) ? null : Number(fuel.fuel_found_kg);
  const fuelFoundDiff: number | null = (fuelFoundKg != null && prevKg != null) ? Math.round((fuelFoundKg - prevKg) * 10) / 10 : null;   // – = used by APU/engine run
  const baseKg = fuelFoundKg != null ? fuelFoundKg : prevKg;
  // auto uplift = Σ tank contents − starting fuel (no base yet → Σ tanks, first record)
  const autoUpliftKg = tankVals.length ? round1(tankSumKg - (baseKg || 0)) : 0;
  const upliftKg = upliftManual ? (Number(fuel.fuel_uplift_kg) || 0) : autoUpliftKg;
  const depCalc: number | null = tankVals.length ? Math.round(tankSumKg)
    : baseKg != null ? Math.round(baseKg + upliftKg) : null;   // departure fuel = Σ tank contents (else base + uplift)
  const depCalcSrc = tankVals.length
    ? `Σ tank contents ${fmt(round1(tankSumKg))} kg (uplift ${fmt(round1(upliftKg))} kg over ${fuelFoundKg != null ? 'fuel before refuelling' : 'prev landing'} ${fmt(round1(baseKg || 0))})`
    : `${fuelFoundKg != null ? 'fuel before refuelling' : 'prev landing'} ${fmt(round1(baseKg || 0))} + total uplift ${fmt(round1(upliftKg))} kg`;
  const depEff: number | null = depCalc != null ? depCalc : (fuel.dep_fuel_kg === '' || fuel.dep_fuel_kg == null ? null : Number(fuel.dep_fuel_kg));
  const oilUnitLbl = 'qt';
  const oilMinU = servMin?.oil_min_qt ?? null;
  // Fuel kg-limits are based on the aircraft reference density; a tank holds a fixed VOLUME,
  // so its kg max (and the min-fuel limit) scale with the actual SG the crew enters.
  const refDens = Number(servMin?.fuel_density_ref) || 0.785;
  const actualSG = num(fuel.fuel_density) || refDens;
  const sgFactor = actualSG / refDens;
  const maxFuelKg = servMin?.fuel_capacity_kg != null ? Math.round(Number(servMin.fuel_capacity_kg) * sgFactor) : null;
  const sgAdj = Math.abs(actualSG - refDens) > 0.0005;
  const effMin = minFuel != null ? Math.round(minFuel * sgFactor) : null;
  // Per-field authorisation (admin-configurable in back office → Permissions).
  // Each falls back to the page-level 'departure' access when unset.
  const canFuel = can('departure', 'fuel');
  const canOooi = can('departure', 'oooi');
  const canRoute = can('departure', 'route');
  const canFlightType = can('departure', 'flight_type');
  const canPfi = can('departure', 'pfi');
  const canCabinDec = can('departure', 'cabin_decision');
  const canAccept = can('departure', 'acceptance');
  const canDep = canFuel;                                // fuel section (kept name for existing refs)
  const canServ = can('departure', 'servicing');         // servicing — mechanic
  const canIce = can('departure', 'ice');
  const isCrew = canAccept;

  const hasV = (v: any) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v));
  function computeMissing() {
    const m = mand || {}; const out: { key: string; label: string; sec: string }[] = [];
    const add = (key: string, label: string, sec: string, ok: boolean) => { if (m[key] && !ok) out.push({ key, label, sec }); };
    add('dep', 'Departure airport', 'route', !!s.dep);
    add('arr', 'Arrival airport', 'route', !!s.arr);
    add('flight_type', 'Flight type', 'route', !!s.flight_type);
    add('fuel_density', 'Specific gravity', 'fuel', num(fuel.fuel_density) > 0);
    add('fuel_planned_kg', 'Planned fuel', 'fuel', hasV(fuel.fuel_planned_kg));
    add('dep_fuel_kg', 'Departure fuel', 'fuel', depEff != null);
    add('taxi_fuel_kg', 'Taxi fuel', 'fuel', hasV(fuel.taxi_fuel_kg));
    add('tanks', 'Tank entries (all)', 'fuel', tanks.length > 0 && tanks.every((t) => hasV(fuel[t.field])));
    add('bowser_uplift_lt', 'Fuel Uplifted', 'fuel', hasV(fuel.bowser_uplift_lt));
    add('fuel_grade', 'Fuel grade', 'fuel', !!fuel.fuel_grade);
    add('fuel_uplift_kg', 'Actual total uplift', 'fuel', upliftKg > 0);
    add('fuel_found_kg', 'Fuel remaining before refuelling', 'fuel', hasV(fuel.fuel_found_kg));
    add('fuel_receipt', 'Fuel receipt photo', 'fuel', receiptN == null ? true : receiptN > 0);   // lenient when offline/unknown
    add('pfi', 'PFI', 'pfi', !!(s.pfi_signature || s.pfi_at));
    add('servicing', 'Servicing (oil / Nil)', 'serv', !!fuel.nil_oils_fluids || hasV(serv.eng1) || hasV(serv.eng2) || hasV(serv.hyd_green) || hasV(serv.hyd_blue) || hasV(serv.hyd_yellow));
    return out;
  }
  async function accept() {
    const miss = computeMissing();
    if (miss.length) {
      setBadSet(new Set(miss.map((x) => x.key)));
      const y = secY.current[miss[0].sec];
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 70), animated: true });
      setSignMsg('Complete before accepting: ' + miss.map((x) => x.label).join(', '));
      return;
    }
    setBadSet(new Set());
    // TESTING PHASE: delayed-OASES conditions without the mechanic's CRS — tell the commander
    // the normal order before letting them accept (server allows it only while testing mode is on).
    const lagOnly = (acSt?.reasons || []).length > 0 && (acSt.reasons || []).every((r: string) => r.includes('Check'))
      && (acSt?.blocking_defects === 0) && !s.check_override?.mechanic_by;
    if (lagOnly) {
      const list = (acSt.reasons || []).join('\n• ');
      if (!(await confirmAction(`Delayed OASES update — TESTING PHASE\n\nUnder normal circumstances the mechanic must confirm these conditions and sign the CRS FIRST:\n\n• ${list}\n\nDuring the testing phase your acceptance is allowed without it. By continuing you sign off accepting the aircraft for this flight.`, 'Testing phase — acceptance allowed'))) return;
    }
    if (testing && !s.released_at && !lagOnly) {
      if (!(await confirmAction('TESTING PHASE — no maintenance CRS on this Tech Log page.\n\nOnce live, maintenance signs the CRS first and the commander accepts on it. During the testing phase your acceptance is allowed without it.', 'Testing phase — acceptance allowed'))) return;
    }
    if (!(await confirmAction('Commander acceptance — I confirm the aircraft is SERVICEABLE: all defects are rectified or properly deferred, all due maintenance tasks and checks are completed, and the fuel and oil onboard are as required. Sign to accept the aircraft for this flight.', 'Commander acceptance'))) return;
    try {
      // Committing the departure makes this an active TL page — allocate its number now (works offline)
      // so the completed sector prints its full TL # even before it syncs.
      if (!s.page_no) { const n = await allocateTl(currentAircraft()?.registration || s.aircraft_id); if (n) await save({ page_no: n }); }
      const r: any = await signRecord({ kind: 'preflight', sector_id: sectorId }); setSignMsg(r?.queued ? 'Accepted offline — will sync ✓' : (r.record_hash ? 'Accepted ✓' : 'Accepted'));
    }
    catch (e: any) { setSignMsg(e?.message || 'Could not accept — try again'); return; }
    refresh().catch(() => {});   // a refresh hiccup must never read as a failed acceptance
  }

  // Delayed-OASES trial path visible in the RENDER too: check-only reasons + no blocking
  // defects → the acceptance button is offered (the popup + server decide the rest).
  const lagOnlyR = !!acSt && (acSt.reasons || []).length > 0 && (acSt.reasons || []).every((r: string) => r.includes('Check'))
    && acSt.blocking_defects === 0 && !s?.check_override?.mechanic_by;

  async function undoAccept() {
    if (!(await confirmAction('Undo the commander acceptance for this departure?', 'Undo acceptance'))) return;
    try { await revokeAcceptance(sectorId); setSignMsg('Acceptance undone'); refresh(); }
    catch (e: any) { setSignMsg(e?.message?.includes('409') ? 'Cannot undo — flight is airborne' : (e.message || 'Failed')); }
  }

  return (
    <ScrollView ref={scrollRef} style={sx.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <SyncBlock visible={syncing} />
      <Text style={sx.title}>Departure · {currentAircraft()?.registration || s.aircraft_id} · {s.flight_no} · {s.dep} → {s.arr}</Text>
      {(() => { const sc = schedule(s); return (
        <Text style={sx.sub}>STD {hhmm(s.std)} · STA {hhmm(s.sta)}{sc.eta ? ` · ${sc.arrived ? 'ATA' : 'ETA'} ${hhmm(sc.eta)}` : ''}{sc.delayMin > 0 ? `  (delay +${sc.delayMin}′)` : ''}</Text>
      ); })()}
      <ClockBanner />
      {msg ? <Text style={sx.msg}>{msg}</Text> : null}

      {util ? (() => {
        const mismatch = util.match === false;
        const bg = mismatch ? theme.red : (util.match ? '#14361f' : theme.tile);
        return (
          <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: mismatch ? theme.red : theme.border, borderRadius: 8, padding: 10, marginTop: 8 }}>
            <Text style={{ color: theme.text, fontWeight: '800' }}>Airframe FH/FC {mismatch ? '— ⚠ MISMATCH vs OASES' : util.match ? '✓ matches OASES' : ''}</Text>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>{util.baseline ? `${String(util.baseline.source || 'Leon').split(' ')[0]} + ETL sectors` : 'ETL'}: {fmtHM(util.etl.tsn_fh)} (h:mm) · {fmt(util.etl.csn_fc)} FC{util.pending_sectors ? `  (${util.pending_sectors} sector(s) pending sync)` : ''}</Text>
            {util.camo ? <Text style={{ color: theme.sub, fontSize: 12 }}>OASES/CAMO: {fmtHM(util.camo.tsn)} (h:mm) · {util.camo.csn ?? '—'} FC</Text>
              : util.baseline ? <Text style={{ color: theme.sub, fontSize: 12 }}>Baseline {fmtHM(util.baseline.tsn_fh)} (h:mm) · {fmt(util.baseline.csn_fc)} FC ({util.baseline.source || 'seed'}{util.baseline.at ? `, ${String(util.baseline.at).slice(0, 10)}` : ''}) + sectors since — OASES interface pending</Text>
              : <Text style={{ color: theme.sub, fontSize: 12 }}>{util.configured ? (util.error || 'OASES baseline unavailable') : 'OASES not configured (showing ETL totals)'}</Text>}
            {mismatch ? <Text style={{ color: theme.text, fontSize: 12, marginTop: 2 }}>Δ {util.diff_fh} FH · {util.diff_fc} FC — report to CAMO before departure.</Text> : null}
            {util.oases_lag ? <Text style={{ color: util.oases_lag.review ? theme.red : theme.accent, fontSize: 12, marginTop: 2, fontWeight: '700' }}>
              {util.oases_lag.review
                ? `⚠ OASES ahead by ${util.oases_lag.legs} leg(s) — under review`
                : `OASES behind by ${util.oases_lag.legs} leg(s) / ${fmtHM(util.oases_lag.fh)} — ETL figures in use`}</Text> : null}
          </View>
        );
      })() : null}

      {canRoute ? (
        <>
          <Text style={sx.section} onLayout={(e) => { secY.current['route'] = e.nativeEvent.layout.y; }}>Route — amend if changed</Text>
          <Text style={sx.sub}>Last‑minute diversion / new airport relayed by phone/radio (Leon needs internet to update). Editable offline; syncs when back online.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {[['Flight', 'flight_no', 'AH1234'], ['Dep (ICAO)', 'dep', 'DAAG'], ['Arr (ICAO)', 'arr', 'DAUB']].map(([lbl, key, ph]) => (
              <View key={key} style={{ flex: 1 }}>
                <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>{lbl}</Text>
                <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}
                  autoCapitalize="characters" value={routeEdit[key] ?? ''} onChangeText={(v) => setRouteEdit({ ...routeEdit, [key]: v })} placeholder={ph} placeholderTextColor={theme.sub} />
                {key !== 'flight_no' ? <IcaoHint code={routeEdit[key]} /> : null}
              </View>
            ))}
          </View>
          <TouchableOpacity style={sx.save} onPress={async () => {
            const newDep = (routeEdit.dep || '').trim().toUpperCase();
            const newArr = (routeEdit.arr || '').trim().toUpperCase();
            const newFlt = (routeEdit.flight_no || '').trim();
            const depChanged = !!newDep && newDep !== (s.dep || '').toUpperCase();
            const arrChanged = !!newArr && newArr !== (s.arr || '').toUpperCase();
            if (depChanged || arrChanged) {
              const lines = [
                depChanged ? `Departure: ${s.dep || '—'} → ${newDep}` : '',
                arrChanged ? `Diversion — destination: ${s.arr || '—'} → ${newArr}` : '',
              ].filter(Boolean).join('\n');
              if (!(await confirmAction(`You are changing the Leon schedule:\n\n${lines}\n\nContinue?`, 'Change route'))) return;
              if (!(await confirmAction('CONFIRM — this overrides the planned departure/destination. Proceed?', 'Confirm route change'))) return;
            } else {
              if (!(await confirmAction('Save the route?'))) return;
            }
            save({ flight_no: newFlt || null, dep: newDep || null, arr: newArr || null });
          }}><Text style={sx.saveText}>Save route</Text></TouchableOpacity>
        </>
      ) : null}

      <Text style={sx.section}>Flight type &amp; status</Text>
      <View pointerEvents={canFlightType ? 'auto' : 'none'} style={canFlightType ? undefined : { opacity: 0.55 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {['Scheduled', 'Training', 'Ferry', 'Positioning', 'Test'].map((t) => {
          const on = (s.flight_type || '') === t;
          return (
            <TouchableOpacity key={t} onPress={() => save({ flight_type: t })}
              style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
                borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accent : theme.tile }}>
              <Text style={{ color: on ? '#fff' : theme.text, fontWeight: on ? '800' : '600', fontSize: 13 }}>{t}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {s.source === 'leon' && s.flight_type ? <Text style={{ color: theme.sub, fontSize: 11, marginTop: 4 }}>From Leon — tap to override.</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <Switch value={!!s.cancelled} onValueChange={(v) => save({ cancelled: v })} />
        <Text style={{ color: theme.text, fontSize: 14 }}>Flight cancelled</Text>
      </View>
      </View>

      <Text style={sx.section}>Departure airport check (GPS)</Text>
      {(() => {
        const g = depGps;
        const far = g.state === 'far', ok = g.state === 'ok';
        const bg = far ? '#3a1111' : ok ? '#11351d' : theme.tile;
        const bc = far ? theme.red : ok ? theme.green : theme.border;
        const txt = g.state === 'checking' ? 'Checking GPS…'
          : ok ? `✓ GPS confirms ${s.dep} — ${g.km} km from ${g.name}`
          : far ? `⚠ GPS is ${g.km} km from ${s.dep} (${g.name}) — departure airport looks incorrect. If repositioned/diverted, amend the route above.`
          : g.state === 'nogps' ? `ⓘ Optional GPS cross-check skipped — the iPad has no position fix (${g.msg || 'offline or indoors'}). The departure airport is not affected.`
          : g.state === 'error' ? `Cannot verify — ${g.msg}.`
          : 'Tap to verify the departure airport against device GPS.';
        return (
          <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bc, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: far ? theme.red : ok ? theme.green : theme.text, fontSize: 13, fontWeight: far ? '800' : '600' }}>{txt}</Text>
            <TouchableOpacity onPress={checkDepGps} style={{ marginTop: 6 }}><Text style={{ color: theme.accent, fontWeight: '700', fontSize: 12 }}>{g.state === 'checking' ? '…' : 'Re-check GPS'}</Text></TouchableOpacity>
          </View>
        );
      })()}


      {!canDep ? <RoBanner text="fuel and acceptance are entered by flight crew" /> : null}
      <Text style={sx.section} onLayout={(e) => { secY.current['fuel'] = e.nativeEvent.layout.y; }}>Departure fuel</Text>
      {prevDiverge ? (
        <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <Text style={{ color: theme.red, fontSize: 13, fontWeight: '800' }}>⚠ Previous-leg fuel differs — choose the value to use</Text>
          <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>
            ETL and Leon disagree by {fmt(round1(Math.abs(Number(etlC!.fuel_kg) - Number(leonC!.fuel_kg))))} kg. Confirm which source is correct for this departure.
          </Text>
          {([['etl', etlC!], ['leon', leonC!]] as const).map(([k, c]) => (
            <TouchableOpacity key={k} disabled={!canDep} onPress={() => setPrevChoice(k)}
              style={{ marginTop: 8, borderWidth: 2, borderColor: prevChoice === k ? theme.green : theme.border, borderRadius: 8, padding: 10, backgroundColor: theme.panel }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: theme.text, fontWeight: '800' }}>{prevChoice === k ? '✓ ' : ''}{c.source}</Text>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>{fmt(round1(Number(c.fuel_kg)))} kg</Text>
              </View>
              <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>
                {c.flight_no || 'prev leg'}{c.date ? ` · ${c.date}` : ''}{(c.dep || c.arr) ? ` · ${c.dep || '?'} → ${c.arr || '?'}` : ''}
              </Text>
              {c.continuity_ok === false ? (
                <Text style={{ color: theme.red, fontSize: 11, marginTop: 2, fontWeight: '800' }}>⚠ dest {c.arr} ≠ this departure {s.dep}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
          {prevChoice == null ? (
            <Text style={{ color: theme.red, fontSize: 11, marginTop: 6, fontWeight: '700' }}>Departure-fuel calculation is paused until you pick a source.</Text>
          ) : null}
          {/* The actual on-board reading is independent of which source is right — always enterable. */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <View style={{ width: 170 }}>
              <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Fuel remaining before refuelling (kg)</Text>
              <TextInput editable={canFuel} style={{ backgroundColor: theme.panel, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, opacity: canFuel ? 1 : 0.5 }}
                keyboardType="decimal-pad" value={fuel.fuel_found_kg == null ? '' : String(fuel.fuel_found_kg)}
                onChangeText={(v) => setFuel({ ...fuel, fuel_found_kg: numericOnly(v) })} />
            </View>
            <View style={{ width: 170 }}>
              <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Difference vs previous leg (kg)</Text>
              <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
                <Text style={{ color: fuelFoundDiff == null ? theme.sub : (fuelFoundDiff < 0 ? theme.red : theme.text), fontWeight: '800' }}>
                  {fuelFoundDiff == null ? '—' : `${fuelFoundDiff > 0 ? '+' : ''}${fmt(fuelFoundDiff)}${fuelFoundDiff < 0 ? '  (used)' : ''}`}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : prevResolved?.fuel_kg != null ? (
        <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: prevResolved.continuity_ok === false ? theme.red : theme.border, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <Text style={{ color: theme.sub, fontSize: 12 }}>Previous leg fuel on landing · {prevResolved.source} (reference){etlC && leonC ? ' · ETL = Leon ✓' : ''}</Text>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>{fmt(round1(Number(prevResolved.fuel_kg)))} kg</Text>
          <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>
            {prevResolved.flight_no || 'prev leg'}{prevResolved.date ? ` · ${prevResolved.date}` : ''}{(prevResolved.dep || prevResolved.arr) ? ` · ${prevResolved.dep || '?'} → ${prevResolved.arr || '?'}` : ''}
          </Text>
          {prevResolved.continuity_ok === false ? (
            <Text style={{ color: theme.red, fontSize: 11, marginTop: 3, fontWeight: '800' }}>⚠ Previous destination {prevResolved.arr} ≠ this departure {s.dep} — check continuity</Text>
          ) : null}
          {/* Fuel remaining before refuelling (may be less than the previous leg on landing if
              maintenance ran the APU / did an engine run) + the difference vs the previous leg. */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <View style={{ width: 170 }}>
              <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Fuel remaining before refuelling (kg)</Text>
              <TextInput editable={canFuel} style={{ backgroundColor: theme.panel, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, opacity: canFuel ? 1 : 0.5 }}
                keyboardType="decimal-pad" value={fuel.fuel_found_kg == null ? '' : String(fuel.fuel_found_kg)}
                onChangeText={(v) => setFuel({ ...fuel, fuel_found_kg: numericOnly(v) })} />
            </View>
            <View style={{ width: 170 }}>
              <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Difference vs previous leg (kg)</Text>
              <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
                <Text style={{ color: fuelFoundDiff == null ? theme.sub : (fuelFoundDiff < 0 ? theme.red : theme.text), fontWeight: '800' }}>
                  {fuelFoundDiff == null ? '—' : `${fuelFoundDiff > 0 ? '+' : ''}${fmt(fuelFoundDiff)}${fuelFoundDiff < 0 ? '  (used)' : ''}`}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          {/* No previous-leg record resolved (first leg / re-opened flight) — the reading must still be enterable. */}
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Fuel remaining before refuelling (kg)</Text>
          <TextInput editable={canFuel} style={{ backgroundColor: theme.panel, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, width: 170, opacity: canFuel ? 1 : 0.5 }}
            keyboardType="decimal-pad" value={fuel.fuel_found_kg == null ? '' : String(fuel.fuel_found_kg)}
            onChangeText={(v) => setFuel({ ...fuel, fuel_found_kg: numericOnly(v) })} />
        </View>
      )}
      <View style={[sx.card, canDep ? null : { opacity: 0.55 }]} pointerEvents={canDep ? 'auto' : 'none'}>
      <Text style={sx.subhead}>Planned</Text>
      <View style={sx.grid}>
        <NumField label="Planned (kg)" bad={badSet.has('fuel_planned_kg')} value={fuel.fuel_planned_kg} onChange={(v: string) => setFuel({ ...fuel, fuel_planned_kg: v })} />
      </View>
      {tankEntry ? (<>
      <Text style={sx.subhead}>Tanks (kg)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {tanks.length === 0 ? <Text style={sx.sub}>— no tank configuration</Text> : null}
          {tanks.map((t) => {
            const maxKg = Math.round(t.max * sgFactor);
            const empty = fuel[t.field] === '' || fuel[t.field] == null;
            const over = !empty && Number(fuel[t.field]) > maxKg;
            const tankBad = over || (badSet.has('tanks') && empty);
            return (
              <View key={t.field} style={{ width: 124 }}>
                <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>{t.label.length > 2 ? t.label : `Tank ${t.label}`} (≤{fmt(maxKg)} kg)</Text>
                <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: tankBad ? 2 : 1, borderColor: tankBad ? theme.red : theme.border, borderRadius: 8, padding: 10 }}
                  keyboardType="decimal-pad" value={fuel[t.field] == null ? '' : String(fuel[t.field])} onChangeText={(v) => setFuel({ ...fuel, [t.field]: numericOnly(v) })} />
              </View>
            );
          })}
      </View>
      </>) : (
        maxFuelKg != null ? <Text style={[sx.sub, { marginTop: 4 }]}>Max fuel (usable, this aircraft): {fmt(maxFuelKg)} kg at SG {num(fuel.fuel_density) || 0.785}</Text> : null
      )}

      <View style={[sx.grid, { alignItems: 'flex-start' }]}>
      {(() => {
        const IG_L = 4.54609, LB_KG = 0.453592;
        const dens = num(fuel.fuel_density) || 0.8;                       // kg/L (specific gravity)
        const toKg = (v: string) => { const n = Number(v) || 0;
          return upliftUnit === 'LB' ? n * LB_KG : upliftUnit === 'IG' ? n * IG_L * dens : upliftUnit === 'L' ? n * dens : n; };
        const fromKgU = (kg: number, u: typeof upliftUnit) =>
          u === 'LB' ? kg / LB_KG : u === 'IG' ? kg / (IG_L * dens) : u === 'L' ? kg / dens : kg;
        const shown = upliftManual ? upliftText : (tankVals.length ? String(round1(fromKgU(autoUpliftKg, upliftUnit))) : '');
        const changeUnit = (u: typeof upliftUnit) => {
          if (upliftManual && fuel.fuel_uplift_kg !== '' && fuel.fuel_uplift_kg != null) setUpliftText(String(round1(fromKgU(Number(fuel.fuel_uplift_kg), u))));
          setUpliftUnit(u);
        };
        return (
          <View style={{ marginTop: 4 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Actual Total uplift ({upliftUnit})</Text>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, width: 150 }}
                keyboardType="decimal-pad" value={shown}
                onChangeText={(raw) => { const v = numericOnly(raw); setUpliftManual(true); setUpliftText(v); setFuel({ ...fuel, fuel_uplift_kg: v === '' ? '' : toKg(v) }); }} />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['KG', 'LB', 'IG', 'L'] as const).map((u) => (
                  <TouchableOpacity key={u} onPress={() => changeUnit(u)}
                    style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: upliftUnit === u ? theme.accent : theme.border, backgroundColor: upliftUnit === u ? theme.accent : theme.tile }}>
                    <Text style={{ color: upliftUnit === u ? '#1a1300' : theme.text, fontWeight: '800', fontSize: 12 }}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={{ color: theme.sub, fontSize: 11, marginTop: 4 }}>
              {upliftManual ? `Manual override = ${fmt(round1(Number(fuel.fuel_uplift_kg) || 0))} kg` : `= Σ tanks ${fmt(round1(tankSumKg))} − ${fuelFoundKg != null ? 'fuel before refuelling' : 'prev leg'} ${fmt(round1(baseKg || 0))} kg`}{(upliftUnit === 'IG' || upliftUnit === 'L') ? ` (SG ${dens})` : ''}
            </Text>
            {upliftManual ? (
              <TouchableOpacity onPress={() => { setUpliftManual(false); setUpliftText(''); setFuel({ ...fuel, fuel_uplift_kg: autoUpliftKg }); }}>
                <Text style={{ color: theme.accent, fontSize: 11, marginTop: 2, fontWeight: '700' }}>Use calculated (Σ tanks − start fuel = {fmt(round1(autoUpliftKg))} kg)</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })()}
      </View>
      <Text style={sx.subhead}>Fuel uplifted, grade &amp; receipt</Text>
      <View style={[sx.grid, { alignItems: 'flex-start' }]}>
        {(() => {
          const IG_L = 4.54609, LB_KG = 0.453592;
          const dens = num(fuel.fuel_density) || 0.8;                       // kg/L (specific gravity)
          const toLt = (v: string) => { const n = Number(v) || 0;
            return bowserUnit === 'IG' ? n * IG_L : bowserUnit === 'KG' ? n / dens : bowserUnit === 'LB' ? n * LB_KG / dens : n; };
          const fromLtU = (lt: number, u: typeof bowserUnit) =>
            u === 'IG' ? lt / IG_L : u === 'KG' ? lt * dens : u === 'LB' ? lt * dens / LB_KG : lt;
          const changeUnit = (u: typeof bowserUnit) => {
            if (fuel.bowser_uplift_lt !== '' && fuel.bowser_uplift_lt != null) setBowserText(String(round1(fromLtU(Number(fuel.bowser_uplift_lt), u))));
            setBowserUnit(u);
          };
          return (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Fuel Uplifted ({bowserUnit})</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, width: 90 }}
                  keyboardType="decimal-pad" value={bowserText} onChangeText={(raw) => { const v = numericOnly(raw); setBowserText(v); setFuel({ ...fuel, bowser_uplift_lt: v === '' ? '' : round1(toLt(v)) }); }} />
                {/* unit dropdown (default L) — compact so photo buttons share the line */}
                <View>
                  <TouchableOpacity onPress={() => setBowserUnitOpen((o) => !o)}
                    style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.tile, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Text style={{ color: theme.text, fontWeight: '800', fontSize: 12 }}>{bowserUnit}</Text>
                    <Text style={{ color: theme.sub, fontSize: 10 }}>▾</Text>
                  </TouchableOpacity>
                  {bowserUnitOpen ? (
                    <View style={{ position: 'absolute', top: 42, left: 0, zIndex: 30, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, width: 64 }}>
                      {(['L', 'KG', 'LB', 'IG'] as const).map((u) => (
                        <TouchableOpacity key={u} onPress={() => { changeUnit(u); setBowserUnitOpen(false); }} style={{ paddingVertical: 8, paddingHorizontal: 12 }}>
                          <Text style={{ color: bowserUnit === u ? theme.accent : theme.text, fontWeight: '800', fontSize: 12 }}>{u}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
              <Text style={{ color: theme.sub, fontSize: 11, marginTop: 4 }}>= {fmt(round1(Number(fuel.bowser_uplift_lt) || 0))} L stored{(bowserUnit === 'KG' || bowserUnit === 'LB') ? ` (SG ${dens})` : ''}</Text>
            </View>
          );
        })()}
        <View style={{ width: 120, marginBottom: 10 }}>
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Specific gravity</Text>
          <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('fuel_density') ? 2 : 1, borderColor: badSet.has('fuel_density') ? theme.red : theme.border, borderRadius: 8, padding: 10 }}
            keyboardType="decimal-pad" value={fuel.fuel_density == null || fuel.fuel_density === '' ? '' : String(fuel.fuel_density)}
            onChangeText={(v) => setFuel({ ...fuel, fuel_density: numericOnly(v) })} />
          <Text style={{ color: theme.sub, fontSize: 10, marginTop: 3 }}>default {refDens}</Text>
        </View>
        <View style={{ width: 150, marginBottom: 10 }}>
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>Fuel grade / type</Text>
          <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('fuel_grade') ? 2 : 1, borderColor: badSet.has('fuel_grade') ? theme.red : theme.border, borderRadius: 8, padding: 10 }} value={fuel.fuel_grade ?? ''} onChangeText={(v) => setFuel({ ...fuel, fuel_grade: v })} placeholder="Jet A-1" placeholderTextColor={theme.sub} />
        </View>
        <View style={{ minWidth: 230, flex: 1, marginBottom: 10 }}>
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 6 }}>Fuel receipt (bowser)</Text>
          <PhotoCapture sectorId={s.id} kind="receipt" label="" />
        </View>
      </View>
      {(() => {
        const sg = num(fuel.fuel_density) || 0.8;
        const gauge = upliftKg;
        const bowserKg = (Number(fuel.bowser_uplift_lt) || 0) * sg;
        if (!(gauge > 0 && bowserKg > 0)) return null;
        const diff = ((gauge - bowserKg) / bowserKg) * 100;
        const off = Math.abs(diff) > fuelTol;
        return <Text style={{ color: off ? theme.red : theme.green, fontSize: 11, marginTop: 2, fontWeight: off ? '800' : '600' }}>Fuel uplifted {fmt(round1(bowserKg))} kg (SG {sg}) vs total uplift {fmt(round1(gauge))} kg — diff {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%{off ? ' ⚠ check' : ' ✓'}</Text>;
      })()}

      <Text style={sx.subhead}>Departure &amp; taxi fuel</Text>
      <View style={[sx.grid, { alignItems: 'flex-start' }]}>
        <View style={{ width: 150, marginBottom: 10 }}>
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4, minHeight: 32 }}>Departure fuel (kg){depCalc != null ? ' — calculated' : ''}</Text>
          {depCalc != null ? (
            <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{fmt(depCalc)}</Text>
            </View>
          ) : (
            <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('dep_fuel_kg') ? 2 : 1, borderColor: badSet.has('dep_fuel_kg') ? theme.red : theme.border, borderRadius: 8, padding: 10 }}
              keyboardType="decimal-pad" value={fuel.dep_fuel_kg == null ? '' : String(fuel.dep_fuel_kg)} onChangeText={(v) => setFuel({ ...fuel, dep_fuel_kg: numericOnly(v) })} />
          )}
        </View>
        <View style={{ width: 150, marginBottom: 10 }}>
          <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4, minHeight: 32 }}>Taxi fuel (kg)</Text>
          <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: badSet.has('taxi_fuel_kg') ? 2 : 1, borderColor: badSet.has('taxi_fuel_kg') ? theme.red : theme.border, borderRadius: 8, padding: 10 }}
            keyboardType="decimal-pad" value={fuel.taxi_fuel_kg == null ? '' : String(fuel.taxi_fuel_kg)} onChangeText={(v) => setFuel({ ...fuel, taxi_fuel_kg: numericOnly(v) })} />
        </View>
      </View>
      {depCalc != null ? <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>= {depCalcSrc}</Text> : null}
      {(() => {
        if (effMin == null) return null;
        const adj = sgAdj ? ` — adjusted for SG ${actualSG} (ref ${refDens})` : '';
        const v = depEff;
        if (v == null || isNaN(v) || v <= 0) return <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>Absolute minimum departure fuel {fmt(effMin)} kg (FCOM LIM‑FUEL P 3/4){adj}</Text>;
        return v < effMin
          ? <Text style={{ color: theme.red, fontSize: 12, marginTop: 2, fontWeight: '800' }}>⚠ Departure fuel {fmt(round1(v))} kg is BELOW the absolute minimum {fmt(effMin)} kg (FCOM LIM‑FUEL P 3/4){adj}</Text>
          : <Text style={{ color: theme.green, fontSize: 11, marginTop: 2 }}>✓ ≥ minimum {fmt(effMin)} kg (FCOM LIM‑FUEL P 3/4){adj}</Text>;
      })()}
      {canDep ? <TouchableOpacity style={sx.save} onPress={async () => {
        if (!(await confirmAction('Save departure fuel figures?'))) return;
        const p: any = { fuel_planned_kg: num(fuel.fuel_planned_kg), fuel_uplift_kg: upliftKg, fuel_density: num(fuel.fuel_density), fuel_supplier: fuel.fuel_supplier, dep_fuel_kg: depEff, taxi_fuel_kg: num(fuel.taxi_fuel_kg), fuel_found_kg: num(fuel.fuel_found_kg), bowser_uplift_lt: num(fuel.bowser_uplift_lt), fuel_grade: fuel.fuel_grade || null, nil_oils_fluids: !!fuel.nil_oils_fluids };
        tanks.forEach((t) => (p[t.field] = num(fuel[t.field]))); save(p);
      }}><Text style={sx.saveText}>Save departure fuel</Text></TouchableOpacity> : null}
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['serv'] = e.nativeEvent.layout.y; }}>Servicing — oil &amp; hydraulic uplift</Text>
      <View style={sx.card}>
      {!canServ ? <RoBanner text="servicing is recorded by maintenance (mechanic)" /> : null}
      <View style={sx.switchRow}>
        <Text style={{ color: theme.sub }}>Nil oils / fluids uplift</Text>
        <Switch value={!!fuel.nil_oils_fluids} onValueChange={(v) => setFuel({ ...fuel, nil_oils_fluids: v })} />
      </View>
      {!fuel.nil_oils_fluids && !serv.eng1 && !serv.eng2 && !serv.hyd_green && !serv.hyd_blue && !serv.hyd_yellow ? (
        <Text style={{ color: theme.accent, fontSize: 11, marginTop: -2, marginBottom: 8 }}>
          Record an oil / hydraulic uplift below, or tick &ldquo;Nil oils / fluids&rdquo; — required before release.
        </Text>
      ) : null}
      {servMin?.oil_consumption_qt_h != null ? (
        <Text style={{ color: theme.sub, fontSize: 11, marginBottom: 6 }}>FCOM minimums shown per field below · oil avg consumption {servMin.oil_consumption_qt_h} qt/h (LIM‑ENG / PRO‑ABN‑HYD)</Text>
      ) : null}
      <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 6 }}>Engine oil and hydraulic in quarts (qt)</Text>
      {(() => {
        const oilLbl = { color: theme.sub, fontSize: 12, marginBottom: 4 } as const;
        // reserve 2 lines so the boxes align under the wrapping Hyd label, but bottom-align the
        // label text so single-line labels sit right above their box (no gap).
        const topWrap = { minHeight: 32, justifyContent: 'flex-end' as const };
        const oilInput = { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 } as const;
        const need = !fuel.nil_oils_fluids;                          // totals mandatory unless Nil oils / fluids
        const badE1 = servBad && need && !hasV(serv.eng1_total);
        const badE2 = servBad && need && !hasV(serv.eng2_total);
        const redB = { borderColor: theme.red, borderWidth: 2 };
        return (
          <View style={{ gap: 12 }}>
            {/* Row 1 — engine oil UPLIFT */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([['eng1', 'Eng 1'], ['eng2', 'Eng 2']] as const).map(([key, label]) => (
                <View key={key} style={{ width: 190 }}>
                  <Text style={oilLbl} numberOfLines={1}>{`${label} oil uplift (${oilUnitLbl})${oilMinU != null ? ` · min ${oilMinU}` : ''}`}</Text>
                  <TextInput style={oilInput} keyboardType="decimal-pad" value={oilShown(serv[key])} onChangeText={(raw) => { const v = numericOnly(raw); setServ({ ...serv, [key]: v === '' ? '' : oilToL(v) }); }} />
                </View>
              ))}
            </View>
            {/* Row 2 — hydraulic uplift G/B/Y together (quarts like the oil; FCOM minimum shown) */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([['hyd_green', 'G', servMin?.hyd_min_green_l], ['hyd_blue', 'B', servMin?.hyd_min_blue_l], ['hyd_yellow', 'Y', servMin?.hyd_min_yellow_l]] as const).map(([key, label, minL]) => (
                <View key={key} style={{ width: 190 }}>
                  <Text style={oilLbl} numberOfLines={1}>{`Hyd ${label} uplift (${oilUnitLbl})${minL != null ? ` · min ${qtOf(minL)}` : ''}`}</Text>
                  <TextInput style={oilInput} keyboardType="decimal-pad" value={oilShown(serv[key])} onChangeText={(raw) => { const v = numericOnly(raw); setServ({ ...serv, [key]: v === '' ? '' : oilToL(v) }); }} />
                </View>
              ))}
            </View>
            {/* Row 3 — TOTAL engine oil (mandatory) */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 190 }}>
                <Text style={oilLbl} numberOfLines={1}>Total Eng 1 oil (qt) *</Text>
                <TextInput style={[oilInput, badE1 ? redB : null]} keyboardType="decimal-pad" value={serv.eng1_total ?? ''} onChangeText={(v) => setServ({ ...serv, eng1_total: numericOnly(v) })} />
              </View>
              <View style={{ width: 190 }}>
                <Text style={oilLbl} numberOfLines={1}>Total Eng 2 oil (qt) *</Text>
                <TextInput style={[oilInput, badE2 ? redB : null]} keyboardType="decimal-pad" value={serv.eng2_total ?? ''} onChangeText={(v) => setServ({ ...serv, eng2_total: numericOnly(v) })} />
              </View>
            </View>
          </View>
        );
      })()}
      {servMsg ? <Text style={{ color: theme.red, fontSize: 12, marginTop: 6 }}>{servMsg}</Text> : null}
      {canServ ? <TouchableOpacity style={sx.save} onPress={async () => {
        if (!fuel.nil_oils_fluids && (!hasV(serv.eng1_total) || !hasV(serv.eng2_total))) {
          setServBad(true); setServMsg('Enter Total Eng 1 oil and Total Eng 2 oil — mandatory (or tick “Nil oils / fluids”).'); return;
        }
        setServBad(false); setServMsg('');
        if (!(await confirmAction('Save servicing uplifts?'))) return;
        const rows = [
          { system: 'eng1', up: serv.eng1, totQt: serv.eng1_total },   // total in quarts (Airbus oil qty)
          { system: 'eng2', up: serv.eng2, totQt: serv.eng2_total },
          { system: 'hyd_green', up: serv.hyd_green, totQt: undefined as any },
          { system: 'hyd_blue', up: serv.hyd_blue, totQt: undefined as any },
          { system: 'hyd_yellow', up: serv.hyd_yellow, totQt: undefined as any },
        ];
        for (const r of rows) {
          const up = num(r.up);
          const tqt = r.totQt != null ? num(r.totQt) : null;
          const totL = tqt != null ? +(tqt * QT_L).toFixed(2) : null;   // store quarts → litres in depart_lt
          if (up != null || totL != null) try { await addServicing({ sector_id: sectorId, system: r.system, uplift_lt: up ?? undefined, depart_lt: totL ?? undefined }); } catch {}
        }
        setServMsg('Servicing saved ✓');
      }}><Text style={sx.saveText}>Save servicing</Text></TouchableOpacity> : null}
      </View>

      <Text style={sx.section} onLayout={(e) => { secY.current['pfi'] = e.nativeEvent.layout.y; }}>Pre-Flight Inspection (PFI)</Text>
      {s.pfi_at ? (
        <View style={{ backgroundColor: '#11351d', borderWidth: 1, borderColor: theme.green, borderRadius: 8, padding: 10 }}>
          <Text style={{ color: theme.green, fontWeight: '800' }}>✓ PFI completed {hhmm(s.pfi_at)}z by {s.pfi_by}</Text>
          {canPfi ? <TouchableOpacity onPress={() => save({ pfi_at: null, pfi_by: null, pfi_signature: null })}><Text style={{ color: theme.accent, fontSize: 12, marginTop: 4 }}>Clear / redo PFI</Text></TouchableOpacity> : null}
        </View>
      ) : (
        <View>
          <Text style={sx.sub}>Walkaround / pre-flight inspection — open the FCOM exterior walkaround, then accept &amp; sign (mechanic or crew).</Text>
          <TextInput style={{ backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, marginTop: 6 }} value={pfiName} onChangeText={setPfiName} placeholder="Name PFI performed by" placeholderTextColor={theme.sub} />
          <TouchableOpacity style={[sx.save, { backgroundColor: theme.green, marginTop: 8 }]} onPress={() => { if (!pfiName.trim()) { setPfiMsg('Enter the name of who performs the PFI.'); return; } setPfiMsg(''); setWalkOpen(true); }}>
            <Text style={sx.saveText}>Open walkaround &amp; sign PFI</Text>
          </TouchableOpacity>
          {pfiMsg ? <Text style={{ color: theme.red, fontSize: 12, marginTop: 6 }}>{pfiMsg}</Text> : null}
        </View>
      )}

      <Text style={sx.section}>Defects (PIREP)</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.red, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('ReportDefect', { sectorId, aircraftId: s.aircraft_id })}><Text style={sx.saveText}>+ Report defect</Text></TouchableOpacity>
        <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, flex: 1, minWidth: 160, maxWidth: undefined, marginTop: 0 }]} onPress={() => navigation.navigate('Defects', { aircraftId: currentAircraft()?.registration || s.aircraft_id })}><Text style={sx.saveText}>View defects / HIL</Text></TouchableOpacity>
      </View>

      {canCabinDec && cabinPending.length ? (
        <>
          <Text style={sx.section}>Cabin defects — your decision ({cabinPending.length})</Text>
          <View style={sx.card}>
            <Text style={[sx.sub, { marginTop: 0, marginBottom: 4 }]}>Accept each cabin defect as dispatchable, or hold the aircraft — required before departure.</Text>
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

      {/* MAINTENANCE RELEASE (CRS) — its own section; it gates and PRECEDES commander acceptance.
          Maintenance can sign it even with NO defect and NO servicing (the Tech Log shows NIL). */}
      {s.status !== 'preflight_signed' ? (
        <>
          <Text style={sx.section}>Maintenance release (CRS)</Text>
          {s.check_override ? (
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
              ✓ Commander confirmed for this leg by {s.check_override.by} at {String(s.check_override.at).slice(0, 16)}z — {(s.check_override.conditions || []).join('; ')} (delayed OASES update)
            </Text>
          ) : null}
          {(acSt && !acSt.serviceable && !(s.check_override && acSt.blocking_defects === 0)) ? (
            <View style={{ backgroundColor: '#3a1111', borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 12 }}>
              {/* State the REAL grounding reasons — open defects AND/OR overdue / not-recorded checks. */}
              <Text style={{ color: theme.red, fontWeight: '800' }}>▲ Aircraft UNSERVICEABLE — {acSt.reasons?.length ? acSt.reasons.join(' · ') : `${acSt.blocking_defects} open defect(s)`}</Text>
              <Text style={{ color: theme.sub, fontSize: 12, marginTop: 4 }}>Rectify (CRS) or defer every open defect under the MEL, and complete any overdue / not-recorded 2/10-day check, before the release. The Tech Log keeps the entered information.</Text>
              {acSt.blocking_defects > 0 ? (
                <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 8 }]} onPress={() => navigation.navigate('Defects', { aircraftId: currentAircraft()?.registration || s.aircraft_id })}>
                  <Text style={sx.saveText}>View / clear defects</Text>
                </TouchableOpacity>
              ) : null}
              {(acSt.checks || []).filter((c) => c.expired).map((c) => (
                <TouchableOpacity key={c.kind} style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 8 }]}
                  onPress={() => navigation.navigate('Planned', { aircraftId: currentAircraft()?.registration || s.aircraft_id, kind: c.kind })}>
                  <Text style={sx.saveText}>Open {c.label} {c.baseline ? '(overdue)' : '(not recorded)'} ›</Text>
                </TouchableOpacity>
              ))}
              {/* TEMPORARY trial bridge (mechanic-led): certifying staff confirm the delayed-OASES
                  conditions and issue the CRS on the Release page; the commander then signs the
                  acceptance on the strength of that CRS. This card only informs the crew. */}
              {ovEnabled && acSt.blocking_defects === 0
                && (acSt.reasons || []).length > 0 && (acSt.reasons || []).every((r: string) => r.includes('Check')) ? (
                <View style={{ borderTopWidth: 1, borderTopColor: theme.border, marginTop: 10, paddingTop: 10 }}>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>Delayed OASES update</Text>
                  <Text style={[sx.sub, { marginTop: 4 }]}>The following show UNSERVICEABLE only because the OASES posting is behind:</Text>
                  {(acSt.reasons || []).map((r: string) => (
                    <Text key={r} style={{ color: theme.red, fontSize: 13, fontWeight: '700', marginTop: 4 }}>  • {r}</Text>
                  ))}
                  {s.check_override?.mechanic_by ? (
                    <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700', marginTop: 8 }}>✓ Certifying staff ({s.check_override.mechanic_by}) confirmed the conditions and the CRS — you may sign the acceptance below.</Text>
                  ) : (
                    <Text style={[sx.sub, { marginTop: 8 }]}>Normally Line Maintenance confirms these and signs the CRS first (Release page). During the TESTING PHASE you may sign the acceptance without it — you will be prompted.</Text>
                  )}
                </View>
              ) : null}
              {/* CRS while unserviceable: open defects → locked. Check-lag only (delayed OASES) →
                  clickable: the Release page shows the conditions and takes the certifying staff's
                  DOUBLE confirmation before the CRS (mirror of the captain's note). */}
              {can('release', 'crs') ? (
                (acSt.blocking_defects === 0 && (acSt.reasons || []).length > 0 && (acSt.reasons || []).every((r: string) => r.includes('Check'))) ? (
                  <TouchableOpacity style={[sx.save, { backgroundColor: theme.green, marginTop: 8 }]} onPress={() => navigation.navigate('Release', { sectorId })}>
                    <Text style={sx.saveText}>🔧 Maintenance — sign CRS (confirm delayed OASES conditions) ›</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity disabled style={[sx.save, { backgroundColor: theme.green, marginTop: 8, opacity: 0.4 }]}>
                    <Text style={sx.saveText}>🔧 Maintenance — sign CRS (clear defects first)</Text>
                  </TouchableOpacity>
                )
              ) : null}
            </View>
          ) : !s.released_at ? (
            <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 }}>
              <Text style={{ color: theme.text, fontWeight: '800' }}>Maintenance release (CRS) required</Text>
              <Text style={{ color: theme.sub, fontSize: 12, marginTop: 4 }}>
                Commander acceptance unlocks once maintenance has signed the CRS — signed even with no defect and no servicing (the Tech Log shows NIL).
              </Text>
              {can('release', 'crs') ? (
                <TouchableOpacity style={[sx.save, { backgroundColor: theme.green, marginTop: 8 }]} onPress={() => navigation.navigate('Release', { sectorId })}>
                  <Text style={sx.saveText}>🔧 Maintenance — sign CRS</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={{ color: theme.green, fontSize: 12, fontWeight: '700' }}>
              ✓ Maintenance release (CRS) signed{s.release_kind === 'nil' ? ' · NIL' : ''}
            </Text>
          )}
        </>
      ) : null}

      {(() => null)()}
      <Text style={sx.section}>Commander acceptance</Text>
      {s.status === 'preflight_signed' ? (
        <>
          <TouchableOpacity disabled style={[sx.save, { backgroundColor: theme.accent }]}>
            <Text style={[sx.saveText, { color: '#1a1300' }]}>Accepted ✓</Text>
          </TouchableOpacity>
          {isCrew && !s.takeoff ? (
            <TouchableOpacity style={[sx.save, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, marginTop: 8 }]} onPress={undoAccept}>
              <Text style={[sx.saveText, { color: theme.red }]}>Undo acceptance (before take-off)</Text>
            </TouchableOpacity>
          ) : null}
          {s.takeoff ? <Text style={[sx.sub, { color: theme.sub, marginTop: 8 }]}>Aircraft airborne — acceptance can no longer be undone.</Text> : null}
        </>
      ) : (acSt && !acSt.serviceable && !(((s.check_override?.mechanic_by) || lagOnlyR) && acSt.blocking_defects === 0)) ? (
        <Text style={sx.sub}>Available once the aircraft is serviceable and maintenance has signed the CRS above.</Text>
      ) : (
        <>
          <Text style={sx.sub}>I certify the fuel and oil onboard at departure is as required and the aircraft is acceptable for service.</Text>
          <TouchableOpacity disabled={!isCrew || (!s.released_at && !lagOnlyR && !testing)} style={[sx.save, { backgroundColor: theme.accent, opacity: (isCrew && (s.released_at || lagOnlyR || testing)) ? 1 : 0.4 }]} onPress={accept}>
            <Text style={[sx.saveText, { color: '#1a1300' }]}>{signMsg || (!s.released_at && !lagOnlyR && !testing ? 'Awaiting maintenance CRS' : 'Sign — accept aircraft (departure)')}</Text>
          </TouchableOpacity>
          <OfflineFlash message={/offline|will sync|queued/i.test(signMsg) ? signMsg : null} />
        </>
      )}
      <WalkaroundModal visible={walkOpen} inspector={pfiName.trim()}
        onClose={() => setWalkOpen(false)}
        onAccept={() => { setWalkOpen(false); setPfiSigning(true); }} />
      <SignaturePad visible={pfiSigning} title="Sign Pre-Flight Inspection"
        onClose={() => setPfiSigning(false)}
        onDone={(sig) => { setPfiSigning(false); save({ pfi_at: new Date().toISOString(), pfi_by: pfiName.trim(), pfi_signature: sig }); }} />
    </ScrollView>
  );
}
