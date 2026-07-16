import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ammIawLine, ammRevision, ampRevision, can, createMaintenance, currentAircraft, extendDefect, iawText, listActiveDefects, listHIL, mpdIawLine, NetworkError, serverSectors, syncPush, taskLineWithHeader, userName } from '../api/client';
import { createLocalMaintenance } from '../db/sectors';
import { fmtTl } from '../util/tl';
import CdlPicker from '../components/CdlPicker';
import MelPicker from '../components/MelPicker';
import RoBanner from '../components/RoBanner';
import TaskCardPicker from '../components/TaskCardPicker';
import MpdPicker from '../components/MpdPicker';
import AmmPicker from '../components/AmmPicker';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

export default function MaintenanceScreen({ route, navigation }: any) {
  const reg = route?.params?.aircraftId ?? currentAircraft()?.registration ?? 'LZ-FSA';
  const canDo = can('maintenance');
  const [station, setStation] = useState('');
  const [wo, setWo] = useState('');
  const [note, setNote] = useState('');
  const [taskPick, setTaskPick] = useState(false);
  const [mpdOpen, setMpdOpen] = useState(false);
  const [ammOpen, setAmmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [stationBad, setStationBad] = useState(false);
  const [extBad, setExtBad] = useState(false);
  const [ammRev, setAmmRev] = useState('');   // AMM revision (live from CAMO)
  const [ampRev, setAmpRev] = useState('');   // AMP issue/rev (live from CAMO) — shown once in the scope
  useEffect(() => {
    ammRevision().then(setAmmRev).catch(() => {});
    ampRevision().then(setAmpRev).catch(() => {});
  }, []);
  const [active, setActive] = useState<any[]>([]);
  const [hil, setHil] = useState<any[]>([]);
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
  }, [reg]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  async function start() {
    const st = station.trim().toUpperCase();
    if (st.length < 3) { setStationBad(true); setMsg('Enter the parking station (ICAO, 3–4 letters) to open the maintenance log.'); return; }
    setStationBad(false); setMsg(''); setBusy(true);
    try {
      // Avoid duplicate maintenance logs: if one is already open for this tail, offer to open it.
      const all = await serverSectors(reg).catch(() => [] as any[]);
      const open = (all || []).find((x: any) => x.page_kind === 'maintenance_only' && !['closed', 'exported'].includes(x.status));
      if (open) {
        const another = await confirmAction(
          `A maintenance log is already open for ${reg} (TL #${open.page_no != null ? fmtTl(open.page_no) : '—'} · ${open.dep ?? ''}, ${open.flight_date ?? ''}).\n\nOK = create ANOTHER log.  Cancel = open the existing one.`,
          'Maintenance log exists');
        if (!another) { navigation.navigate('Release', { sectorId: open.id }); return; }
      }
      let id: string;
      try {
        const r = await createMaintenance({ aircraft_id: reg, station: st, wo_ref: wo.trim() || undefined, note: note.trim() || undefined });
        id = r.id;
      } catch (e: any) {
        if (!(e instanceof NetworkError)) throw e;
        const r = await createLocalMaintenance(reg, st, wo.trim() || undefined, note.trim() || undefined, userName() ?? undefined);   // offline → local log, TL# assigned on sync
        id = r.id;
      }
      navigation.navigate('Release', { sectorId: id });     // work defects + issue CRS
    } catch (e: any) { setMsg(e.message || 'Could not open the maintenance log.'); }
    finally { setBusy(false); }
  }

  async function saveExtension(id: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extDate)) { setExtBad(true); setMsg('Enter the new due date as YYYY-MM-DD.'); return; }
    setExtBad(false); setMsg('');
    try {
      await extendDefect(id, { due_date: extDate, narrative: extNote.trim() || `Deferral extended to ${extDate}` });
      setExtId(null); setExtDate(''); setExtNote(''); load();
    } catch (e: any) { setMsg(e.message || 'Could not save the extension.'); }
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
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setTaskPick(true)}>
              <Text style={s.btnTxt}>＋ Task card (i.a.w)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setMpdOpen(true)}>
              <Text style={s.btnTxt}>＋ Task Card2 (MPD)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setAmmOpen(true)}>
              <Text style={s.btnTxt}>＋ Task Card3 (AMM)</Text>
            </TouchableOpacity>
          </View>
          <TaskCardPicker visible={taskPick} onClose={() => setTaskPick(false)}
            onPick={(t) => {
              const rev = ampRev || t.revision || '';           // live AMP rev; fall back to the card's own
              setNote((n) => taskLineWithHeader(n, iawText(t), rev, ammRev));
              setWo((w) => {                                  // task-card number(s) into the WO / task-card ref
                const nums = (w || '').split(',').map((x) => x.trim()).filter(Boolean);
                if (t.task_number && !nums.includes(t.task_number)) nums.push(t.task_number);
                return nums.join(', ');
              });
              setTaskPick(false);
            }} />
          <MpdPicker visible={mpdOpen} onClose={() => setMpdOpen(false)}
            onPick={(m) => {
              setNote((n) => { const line = mpdIawLine(m); const base = (n || '').trim(); return base ? `${line}\n\n${base}` : line; });
              setWo((w) => {                                  // AMM reference into the WO / task-card ref
                const nums = (w || '').split(',').map((x) => x.trim()).filter(Boolean);
                if (m.reference && !nums.includes(m.reference)) nums.push(m.reference);
                return nums.join(', ');
              });
              setMpdOpen(false);
            }} />
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
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={start}>
            <Text style={[s.btnTxt, { color: '#1a1300' }]}>{busy ? 'Opening…' : 'Open maintenance log & go to CRS'}</Text>
          </TouchableOpacity>
          {msg ? <Text style={s.err}>{msg}</Text> : null}
        </>
      )}

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
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{d.hil_no ? `HIL ${d.hil_no} · ` : ''}{d.title || d.description}</Text>
              <Text style={s.sub}>{d.mel_ref ? `MEL ${d.mel_ref} · ` : ''}{d.rect_interval ? `Cat ${d.rect_interval} · ` : ''}due {d.due_date || '—'}</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}><Text style={s.rectify}>rectify ›</Text></TouchableOpacity>
          </View>
          {canDo ? (extId === d.id ? (
            <View style={{ marginTop: 8 }}>
              <TextInput style={[s.input, extBad ? s.bad : null]} value={extDate} onChangeText={(v) => { setExtDate(v); if (extBad) setExtBad(false); if (msg) setMsg(''); }} placeholder="New due date (YYYY-MM-DD) *" placeholderTextColor={theme.sub} autoCapitalize="none" />
              {extBad && msg ? <Text style={[s.err, { marginTop: 4 }]}>{msg}</Text> : null}
              <TextInput style={[s.input, { marginTop: 8 }]} value={extNote} onChangeText={setExtNote} placeholder="Extension reason / authority (optional)" placeholderTextColor={theme.sub} />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.accent }]} onPress={() => saveExtension(d.id)}><Text style={[s.btnTxt, { color: '#1a1300' }]}>Save extension</Text></TouchableOpacity>
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

      <Text style={s.section}>MEL reference</Text>
      <Text style={s.sub}>Browse / search the MEL, view an item's full page (category, interval, M/O procedures, placard), then select it.</Text>
      <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setMelPick(true)}>
        <Text style={s.btnTxt}>Pick from CAMO MEL ▾</Text>
      </TouchableOpacity>
      <MelPicker visible={melPick} onClose={() => setMelPick(false)}
        onPick={(m) => {
          const ref = `MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim();
          setNote((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + ref);
          setMelPick(false);
        }} />

      <Text style={s.section}>CDL reference</Text>
      <Text style={s.sub}>Browse / search the CDL (applicable registrations &amp; dispatch conditions), then select an item.</Text>
      <TouchableOpacity style={[s.smallBtn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setCdlPick(true)}>
        <Text style={s.btnTxt}>Pick from CAMO CDL ▾</Text>
      </TouchableOpacity>
      <CdlPicker visible={cdlPick} onClose={() => setCdlPick(false)}
        onPick={(c) => {
          const ref = `CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim();
          setNote((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + ref);
          setCdlPick(false);
        }} />
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
