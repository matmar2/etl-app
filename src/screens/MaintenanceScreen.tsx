import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ammIawLine, ammRevision, can, createMaintenance, currentAircraft, extendDefect, listActiveDefects, listHIL, NetworkError, serverSectors, syncPush, userName } from '../api/client';
import { createLocalMaintenance, deleteSector } from '../db/sectors';
import { fmtTl } from '../util/tl';
import CdlPicker from '../components/CdlPicker';
import MelPicker from '../components/MelPicker';
import RoBanner from '../components/RoBanner';
import AmmPicker from '../components/AmmPicker';
import HilRemaining from '../components/HilRemaining';
import { confirmAction } from '../util/confirm';
import { trackActivity } from '../db/activity';
import { theme } from '../theme';

export default function MaintenanceScreen({ route, navigation }: any) {
  const reg = route?.params?.aircraftId ?? currentAircraft()?.registration ?? 'LZ-FSA';
  const canDo = can('maintenance');
  const [station, setStation] = useState('');
  const [wo, setWo] = useState('');
  const [note, setNote] = useState('');
  const [ammOpen, setAmmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [stationBad, setStationBad] = useState(false);
  const [extBad, setExtBad] = useState(false);
  const [ammRev, setAmmRev] = useState('');   // AMM revision (live from CAMO)
  useEffect(() => {
    ammRevision().then(setAmmRev).catch(() => {});
  }, []);
  const [active, setActive] = useState<any[]>([]);
  const [hil, setHil] = useState<any[]>([]);
  const [openLogs, setOpenLogs] = useState<any[]>([]);   // open (not-closed) maintenance Tech Logs to resume
  // inline "extend deferral"
  const [extId, setExtId] = useState<string | null>(null);
  const [extDate, setExtDate] = useState('');
  const [extNote, setExtNote] = useState('');
  // MEL / CDL reference pickers
  const [melPick, setMelPick] = useState(false);
  const [cdlPick, setCdlPick] = useState(false);

  const load = useCallback(async () => {
    await syncPush().catch(() => {});                 // push locally-created defects up first
    listActiveDefects(reg).then((d: any[]) => setActive(d || [])).catch(() => setActive([]));
    listHIL(reg).then((d: any[]) => setHil(d || [])).catch(() => setHil([]));
    serverSectors(reg).then((secs: any[]) => setOpenLogs((secs || [])
      .filter((x) => x.page_kind === 'maintenance_only' && !['closed', 'exported'].includes(x.status))
      .sort((a, b) => String(b.flight_date || '').localeCompare(String(a.flight_date || ''))))).catch(() => setOpenLogs([]));
  }, [reg]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  // Default the parking station to the aircraft's LAST KNOWN LOCATION — the arrival airport of the
  // most recent sector that has one (its diversion airport if it diverted). OOOI times may not be
  // recorded, so we rank by whatever timestamp exists. Editable; never overwrites operator input.
  useEffect(() => {
    serverSectors(reg).then((secs: any[]) => {
      const ts = (x: any) => String(x.on_block || x.landing || x.sta || x.std || x.created_at || x.flight_date || '');
      const located = (secs || []).filter((x) => x.arr).sort((a, b) => ts(b).localeCompare(ts(a)));
      const last = located[0];
      const loc = last ? ((last.diverted && last.diversion_airport) ? last.diversion_airport : last.arr) : null;
      if (loc) setStation((cur) => (cur ? cur : String(loc).toUpperCase()));
    }).catch(() => {});
  }, [reg]);

  async function start() {
    const st = station.trim().toUpperCase();
    if (st.length < 3) { setStationBad(true); setMsg('Enter the parking station (ICAO, 3–4 letters) to open the maintenance log.'); return; }
    setStationBad(false); setMsg(''); setBusy(true);
    try {
      // One open maintenance log per tail: the server RESUMES today's open page (no duplicate TL) and
      // applies the station / work-order details entered here onto it — so we always call it (never
      // bypass, or the WO ref / scope typed above would be dropped).
      let id: string; let resumed = false;
      try {
        const r = await createMaintenance({ aircraft_id: reg, station: st, wo_ref: wo.trim() || undefined, note: note.trim() || undefined });
        id = r.id; resumed = !!(r as any).resumed;
      } catch (e: any) {
        if (!(e instanceof NetworkError)) throw e;
        const r = await createLocalMaintenance(reg, st, wo.trim() || undefined, note.trim() || undefined, userName() ?? undefined);   // offline → local log, TL# assigned on sync
        id = r.id;
      }
      trackActivity('open', 'maintenance_log', id, 'Maintenance', { reg, station: st, resumed });
      navigation.navigate('Release', { sectorId: id, resumed });     // work defects + issue CRS
    } catch (e: any) { setMsg(e.message || 'Could not open the maintenance log.'); }
    finally { setBusy(false); }
  }

  async function saveExtension(id: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extDate)) { setExtBad(true); setMsg('Enter the new due date as YYYY-MM-DD.'); return; }
    setExtBad(false); setMsg('');
    try {
      await extendDefect(id, { due_date: extDate, narrative: extNote.trim() || `Deferral extended to ${extDate}` });
      trackActivity('extend', 'defect', id, 'Maintenance', { due_date: extDate });
      setExtId(null); setExtDate(''); setExtNote(''); load();
    } catch (e: any) { setMsg(e.message || 'Could not save the extension.'); }
  }

  // Discard an unsigned maintenance Tech Log opened by mistake / no longer required (double-confirm).
  async function discardLog(id: string, label: string) {
    if (!(await confirmAction(`Discard ${label}?\n\nIt was opened but not signed — this removes it entirely, including any draft work order and component-change entries on it.`, 'Discard Tech Log'))) return;
    if (!(await confirmAction('Confirm once more — permanently delete this Tech Log? This cannot be undone.', 'Confirm delete'))) return;
    setMsg('');
    try { await deleteSector(id); trackActivity('discard', 'techlog', id, 'Maintenance'); load(); }
    catch (e: any) {
      setMsg(/409|released|signed|closed/i.test(e?.message || '')
        ? 'This Tech Log is already signed/closed and can no longer be discarded — ask the back office.'
        : (e?.message || 'Could not discard the Tech Log.'));
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Ground Maintenance · {reg}</Text>
      <Text style={s.sub}>For maintenance with no crew onboard — after arrival or during a ground stay. Opens a maintenance-only Tech Log entry (Dep = Arr = parking station). Rectify defects / HIL items or defer under MEL, then issue the CRS.</Text>

      {canDo ? (
        <TouchableOpacity style={[s.btn, { backgroundColor: theme.red }]}
          onPress={() => navigation.navigate('ReportDefect', { aircraftId: reg, source: 'marep' })}>
          <Text style={s.btnTxt}>＋ Report defect (MAREP)</Text>
        </TouchableOpacity>
      ) : null}

      {!canDo ? <RoBanner text="only certifying staff (mechanic) may open a maintenance log" /> : (
        <>
          <Text style={s.section}>Open maintenance log</Text>
          <TextInput style={[s.input, stationBad ? s.bad : null]} autoCapitalize="characters" maxLength={4} value={station}
            onChangeText={(v) => { setStation(v); if (stationBad) setStationBad(false); if (msg) setMsg(''); }}
            placeholder="Parking station (ICAO) e.g. LBSF *" placeholderTextColor={theme.sub} />
          <TextInput style={[s.input, { marginTop: 8 }]} value={wo} onChangeText={setWo} placeholder="Work order / task card ref (optional)" placeholderTextColor={theme.sub} />
          <TextInput style={[s.input, { marginTop: 8, minHeight: Math.max(60, note.split('\n').length * 22 + 28), textAlignVertical: 'top' }]}
            value={note} onChangeText={setNote} placeholder="Scope of maintenance (optional)… add task cards below" placeholderTextColor={theme.sub} multiline />
          {/* Reference pickers for the work order — Task Card (AMM), MEL and CDL — sit together just
              above the open button; each selection is appended to the Scope of maintenance above. */}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setAmmOpen(true)}>
              <Text style={s.btnTxt}>＋ Task Card (AMM)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setMelPick(true)}>
              <Text style={s.btnTxt}>Pick from CAMO MEL ▾</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setCdlPick(true)}>
              <Text style={s.btnTxt}>Pick from CAMO CDL ▾</Text>
            </TouchableOpacity>
          </View>
          <AmmPicker visible={ammOpen} reg={reg} onClose={() => setAmmOpen(false)}
            onPick={(m) => {
              setNote((n) => { const line = ammIawLine(m); const base = (n || '').trim(); return base ? `${line}\n\n${base}` : line; });
              setWo((w) => {                                  // AMM Task # into the WO / task-card ref
                const nums = (w || '').split(',').map((x) => x.trim()).filter(Boolean);
                if (m.task_card_ref && !nums.includes(m.task_card_ref)) nums.push(m.task_card_ref);
                return nums.join(', ');
              });
              setAmmOpen(false);
            }} />
          <MelPicker visible={melPick} onClose={() => setMelPick(false)}
            onPick={(m) => {
              const ref = `MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim();
              setNote((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + ref);
              setMelPick(false);
            }} />
          <CdlPicker visible={cdlPick} onClose={() => setCdlPick(false)}
            onPick={(c) => {
              const ref = `CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim();
              setNote((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + ref);
              setCdlPick(false);
            }} />
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={start}>
            <Text style={[s.btnTxt, { color: theme.onAccent }]}>{busy ? 'Opening…' : 'Open maintenance log & go to CRS'}</Text>
          </TouchableOpacity>
          {msg ? <Text style={s.err}>{msg}</Text> : null}
        </>
      )}

      {/* Open maintenance Tech Logs — resume a not-closed page instead of opening a new one. */}
      {openLogs.length > 0 ? (
        <>
          <Text style={s.section}>Open maintenance Tech Logs — resume ({openLogs.length})</Text>
          {openLogs.map((l) => (
            <TouchableOpacity key={l.id} style={s.row2} onPress={() => navigation.navigate('Release', { sectorId: l.id, resumed: true })}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>TL #{l.page_no != null ? fmtTl(l.page_no) : '—'}{l.dep ? ` · ${l.dep}` : ''}{l.flight_date ? ` · ${String(l.flight_date).slice(0, 10)}` : ''}</Text>
                  <Text style={s.sub} numberOfLines={2}>{l.wo_ref || 'No work-order reference recorded yet'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Text style={s.rectify}>resume ›</Text>
                  {/* Discard this unsigned log (double-confirm) — opened by mistake / no longer needed. */}
                  <TouchableOpacity onPress={() => discardLog(l.id, `TL #${l.page_no != null ? fmtTl(l.page_no) : '—'}`)} hitSlop={12}>
                    <Text style={{ color: theme.red, fontWeight: '800', fontSize: 16 }}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <Text style={s.section}>Open defects — to rectify ({active.length})</Text>
      {active.length === 0 ? <Text style={s.sub}>No open defects.</Text> : active.map((d) => (
        <TouchableOpacity key={d.id} style={s.row} onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{d.title || d.description}</Text>
            <Text style={s.sub}>{d.ata_chapter ? `ATA ${d.ata_chapter} · ` : ''}{(d.source || '').toUpperCase()} · {d.status}{d.mel_ref ? ` · ${d.mel_ref}` : ''}</Text>
          </View>
          <Text style={s.rectify}>rectify ›</Text>
        </TouchableOpacity>
      ))}

      <Text style={s.section}>HIL — deferred items ({hil.length})</Text>
      {hil.length === 0 ? <Text style={s.sub}>No hold items.</Text> : hil.map((d) => (
        <View key={d.id} style={s.row2}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}>
              <Text style={s.rowTitle}>{d.hil_no ? `HIL ${d.hil_no} · ` : ''}{d.title || d.description}</Text>
              <Text style={s.sub}>{d.mel_ref ? `MEL ${d.mel_ref} · ` : ''}{d.rect_interval ? `Cat ${d.rect_interval} · ` : ''}due {d.due_date || '—'}{d.raised_at ? ` · raised ${String(d.raised_at).slice(0, 10)}` : ''}</Text>
            </TouchableOpacity>
            <HilRemaining item={d} style={{ minWidth: 168, marginHorizontal: 6, paddingHorizontal: 8, borderLeftWidth: 1, borderLeftColor: theme.border }} />
            <TouchableOpacity onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}><Text style={s.rectify}>rectify ›</Text></TouchableOpacity>
          </View>
          {canDo ? (extId === d.id ? (
            <View style={{ marginTop: 8 }}>
              <TextInput style={[s.input, extBad ? s.bad : null]} value={extDate} onChangeText={(v) => { setExtDate(v); if (extBad) setExtBad(false); if (msg) setMsg(''); }} placeholder="New due date (YYYY-MM-DD) *" placeholderTextColor={theme.sub} autoCapitalize="none" />
              {extBad && msg ? <Text style={[s.err, { marginTop: 4 }]}>{msg}</Text> : null}
              <TextInput style={[s.input, { marginTop: 8 }]} value={extNote} onChangeText={setExtNote} placeholder="Extension reason / authority (optional)" placeholderTextColor={theme.sub} />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.accent }]} onPress={() => saveExtension(d.id)}><Text style={[s.btnTxt, { color: theme.onAccent }]}>Save extension</Text></TouchableOpacity>
                <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => setExtId(null)}><Text style={s.btnTxt}>Cancel</Text></TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={{ marginTop: 8 }} onPress={() => { setExtId(d.id); setExtDate(d.due_date || ''); setExtNote(''); }}>
              <Text style={{ color: theme.accent, fontWeight: '700' }}>＋ Extend due date</Text>
            </TouchableOpacity>
          )) : null}
        </View>
      ))}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13, lineHeight: 18 },
  section: { color: theme.text, fontWeight: '800', fontSize: 13, marginTop: 18, marginBottom: 6, textTransform: 'uppercase' },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 },
  bad: { borderColor: theme.red, borderWidth: 2 },
  err: { color: theme.red, fontWeight: '700', fontSize: 13, marginTop: 8 },
  btn: { borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  smallBtn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  row2: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  rowTitle: { color: theme.text, fontWeight: '700' },
  rectify: { color: theme.accent, fontWeight: '800', marginLeft: 8 },
});
