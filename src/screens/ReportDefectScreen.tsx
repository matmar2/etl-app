import React, { useEffect, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ammIawLine, ammRevision, ampRevision, appSettings, can, CdlItem, iawText, MelItem, mpdIawLine, role, syncPush, taskLineWithHeader } from '../api/client';
import { ATA_CHAPTERS } from '../ata';
import MelPicker from '../components/MelPicker';
import CdlPicker from '../components/CdlPicker';
import TaskCardPicker from '../components/TaskCardPicker';
import MpdPicker from '../components/MpdPicker';
import AmmPicker from '../components/AmmPicker';
import SignaturePad from '../components/SignaturePad';
import { createDefect } from '../db/defects';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

const REQ_LABEL: Record<string, string> = { title: 'System / Title', description: 'Defect description', ata_chapter: 'ATA chapter', reporter_licence: 'Licence / auth no.' };

export default function ReportDefectScreen({ route, navigation }: any) {
  const { sectorId, aircraftId } = route.params;
  const forcedSource: string | undefined = route.params?.source;   // e.g. Ground Maintenance forces 'marep'
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [ata, setAta] = useState('');
  const [ataOpen, setAtaOpen] = useState(false);
  const [blocks, setBlocks] = useState(true);
  const [cabin, setCabin] = useState(forcedSource ? forcedSource === 'cabin' : role() === 'cabin');   // cabin crew default to a cabin defect
  const [busy, setBusy] = useState(false);
  const [melOpen, setMelOpen] = useState(false);
  const [cdlOpen, setCdlOpen] = useState(false);
  const [taskPick, setTaskPick] = useState(false);
  const [mpdOpen, setMpdOpen] = useState(false);
  const [ammOpen, setAmmOpen] = useState(false);
  const [lic, setLic] = useState('');
  const [signing, setSigning] = useState(false);
  const [required, setRequired] = useState<string[]>(['title', 'description', 'ata_chapter']);
  const [ampRev, setAmpRev] = useState('');
  const [ammRev, setAmmRev] = useState('');

  const [melRef, setMelRef] = useState<string | undefined>();
  const [rectInterval, setRectInterval] = useState<string | undefined>();
  const [dueDate, setDueDate] = useState<string | undefined>();
  const CAT_DAYS: Record<string, string> = { A: 'per remarks', B: '3 days', C: '10 days', D: '120 days' };

  function appendDesc(line: string) { setDesc((d) => (d ? d.replace(/\s+$/, '') + '\n\n' : '') + line); }
  function pickMel(m: MelItem) {
    if (m.ata && !ata.trim()) setAta(m.ata);
    appendDesc(`MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim());
    // capture the structured fields so MEL / Interval / Due populate on the HIL & Limitations
    const interval = m.rectification_interval || CAT_DAYS[m.category || ''] || '';
    setMelRef(m.ata || m.item || undefined);
    setRectInterval(m.category ? `Cat ${m.category}${interval ? ` · ${interval}` : ''}` : interval || undefined);
    const dm = interval.match(/(\d+)\s*day/i);
    if (dm) { const dd = new Date(); dd.setDate(dd.getDate() + parseInt(dm[1], 10)); setDueDate(dd.toISOString().slice(0, 10)); }
    setMelOpen(false);
  }
  function pickCdl(c: CdlItem) {
    if (c.ata && !ata.trim()) setAta(c.ata);
    appendDesc(`CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim());
    setCdlOpen(false);
  }
  const ataLabel = ATA_CHAPTERS.find((c) => c.code === (ata.split('-')[0] || ata));   // match chapter prefix of e.g. 21-21-01
  // Forced by caller (Ground Maintenance → MAREP); else by role: mechanic → MAREP, cabin → CABIN, flight crew → PIREP
  const source = (forcedSource || (role() === 'mechanic' ? 'marep' : role() === 'cabin' ? 'cabin' : 'pirep')) as 'cabin' | 'marep' | 'pirep';

  useEffect(() => {
    appSettings().then((s) => { if (s.defect_required_fields) setRequired(s.defect_required_fields); }).catch(() => {});
    ammRevision().then(setAmmRev).catch(() => {});
    ampRevision().then(setAmpRev).catch(() => {});
  }, []);

  const vals: Record<string, string> = { title: title.trim(), description: desc.trim(), ata_chapter: ata.trim() };
  const licRequired = role() === 'mechanic';          // certifying staff must record their licence/auth no.
  const missing = [...required.filter((f) => !vals[f]), ...(licRequired && !lic.trim() ? ['reporter_licence'] : [])];
  const canReport = can('defects', 'report');       // permission to raise a defect
  const canSubmit = missing.length === 0 && canReport;

  async function raise() {
    if (!canSubmit) return;
    const warn = blocks ? '\n\n⚠ This will make the aircraft UNSERVICEABLE until it is cleared or deferred.' : '';
    if (!(await confirmAction(`Raise this ${source.toUpperCase()} defect?${warn}`, 'Raise defect'))) return;
    setSigning(true);                                 // sign to attribute the report
  }
  async function submitWithSig(signature: string) {
    setBusy(true);
    try {
      await createDefect({
        sector_id: sectorId ?? null, aircraft_id: aircraftId, source,
        area: cabin ? 'cabin' : 'technical',
        // captain_clearable is decided server-side from the admin list
        title: title.trim() || undefined, description: desc.trim(),
        ata_chapter: ata.trim() || undefined, blocks_serviceability: blocks,
        reporter_signature: signature, reporter_licence: lic.trim() || undefined,
        mel_ref: melRef, rect_interval: rectInterval, due_date: dueDate,
      });
      syncPush().catch(() => {});
      navigation.goBack();
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>Report defect ({source.toUpperCase()})</Text>
      <Text style={styles.lbl}>System / title{required.includes('title') ? ' *' : ''}</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. VHF SYSTEM" placeholderTextColor={theme.sub} />
      <Text style={styles.lbl}>Defect description{required.includes('description') ? ' *' : ''}</Text>
      <TextInput style={[styles.input, { minHeight: Math.max(120, desc.split('\n').length * 22 + 40), textAlignVertical: 'top' }]} multiline value={desc} onChangeText={setDesc}
        placeholder="State the defect (or NIL)… MEL / task-card refs can be added below" placeholderTextColor={theme.sub} />
      <Text style={styles.lbl}>ATA chapter{required.includes('ata_chapter') ? ' *' : ''}</Text>
      <TouchableOpacity style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setAtaOpen(true)}>
        <Text style={{ color: ataLabel ? theme.text : theme.sub }}>{ataLabel ? `${ataLabel.code} — ${ataLabel.label}` : 'Select ATA chapter…'}</Text>
        <Text style={{ color: theme.sub }}>▾</Text>
      </TouchableOpacity>
      <TextInput style={[styles.input, { marginTop: 8 }]} value={ata} onChangeText={setAta} autoCapitalize="characters"
        placeholder="Full ATA ref — chapter‑section‑subject, e.g. 21‑21‑01" placeholderTextColor={theme.sub} />
      <Text style={{ color: theme.sub, fontSize: 11, marginTop: 4 }}>Pick the chapter above, then add the sub‑chapter / subject (e.g. 21 → 21‑21 → 21‑21‑01).</Text>

      <Text style={styles.lbl}>MEL / CDL / task-card references (optional)</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity style={styles.refBtn} onPress={() => setMelOpen(true)}><Text style={styles.refBtnTxt}>Pick from CAMO MEL ▾</Text></TouchableOpacity>
        <TouchableOpacity style={styles.refBtn} onPress={() => setCdlOpen(true)}><Text style={styles.refBtnTxt}>Pick from CAMO CDL ▾</Text></TouchableOpacity>
        <TouchableOpacity style={styles.refBtn} onPress={() => setTaskPick(true)}><Text style={styles.refBtnTxt}>＋ Task card (i.a.w)</Text></TouchableOpacity>
        <TouchableOpacity style={styles.refBtn} onPress={() => setMpdOpen(true)}><Text style={styles.refBtnTxt}>＋ Task Card2 (MPD)</Text></TouchableOpacity>
        <TouchableOpacity style={styles.refBtn} onPress={() => setAmmOpen(true)}><Text style={styles.refBtnTxt}>＋ Task Card3 (AMM)</Text></TouchableOpacity>
      </View>
      <Text style={{ color: theme.sub, fontSize: 11, marginTop: 4 }}>Selected MEL / task cards are added to the defect description above.</Text>
      <MelPicker visible={melOpen} ata={(ata || '').split('-')[0] || undefined} onClose={() => setMelOpen(false)} onPick={pickMel} />
      <CdlPicker visible={cdlOpen} ata={(ata || '').split('-')[0] || undefined} onClose={() => setCdlOpen(false)} onPick={pickCdl} />
      <TaskCardPicker visible={taskPick} defaultAta={(ata || '').split('-')[0] || undefined} onClose={() => setTaskPick(false)} onPick={(t) => { setDesc((d) => taskLineWithHeader(d, iawText(t), ampRev || t.revision || '', ammRev)); setTaskPick(false); }} />
      <MpdPicker visible={mpdOpen} defaultAta={(ata || '').split('-')[0] || undefined} onClose={() => setMpdOpen(false)} onPick={(m) => {
        const line = mpdIawLine(m);
        setDesc((d) => { const base = (d || '').trim(); return base ? `${line}\n\n${base}` : line; });   // description starts with the i.a.w AMM reference line
        if (m.reference && !ata.trim()) setAta(m.reference.slice(0, 2));
        setMpdOpen(false);
      }} />
      <AmmPicker visible={ammOpen} reg={aircraftId} defaultAta={(ata || '').split('-')[0] || undefined} onClose={() => setAmmOpen(false)} onPick={(m) => {
        const line = ammIawLine(m);
        setDesc((d) => { const base = (d || '').trim(); return base ? `${line}\n\n${base}` : line; });   // description starts with the AMM rev · i.a.w Task# line
        if (m.ata && !ata.trim()) setAta(m.ata.slice(0, 2));
        setAmmOpen(false);
      }} />

      <Modal visible={ataOpen} animationType="slide" transparent onRequestClose={() => setAtaOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.title}>ATA chapter</Text>
            <FlatList data={ATA_CHAPTERS} keyExtractor={(c) => c.code} style={{ maxHeight: 420 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.ataRow} onPress={() => { setAta(item.code); setAtaOpen(false); }}>
                  <Text style={styles.ataCode}>{item.code}</Text>
                  <Text style={styles.ataLabel}>{item.label}</Text>
                </TouchableOpacity>
              )} />
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.tile, marginTop: 10 }]} onPress={() => setAtaOpen(false)}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <View style={styles.switchRow}>
        <Text style={styles.lbl}>Cabin defect</Text>
        <Switch value={cabin} onValueChange={setCabin} />
      </View>
      {role() !== 'cabin' ? (
        <Text style={{ color: theme.sub, fontSize: 11, marginTop: -4, marginBottom: 6 }}>
          Use for an airworthiness / safety-related cabin item raised by flight crew or maintenance.
        </Text>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={styles.lbl}>Blocks serviceability (AOG)</Text>
        <Switch value={blocks} onValueChange={setBlocks} />
      </View>
      <Text style={styles.lbl}>Reporter licence / auth no.{licRequired ? ' *' : ' (optional)'}</Text>
      <TextInput style={styles.input} value={lic} onChangeText={setLic} placeholder="Your licence / authorisation number" placeholderTextColor={theme.sub} />
      {missing.length ? <Text style={styles.req}>Required: {missing.map((f) => REQ_LABEL[f] || f).join(', ')}</Text> : null}
      {!canReport ? <Text style={styles.req}>You do not have permission to raise defects.</Text> : null}
      <Text style={{ color: theme.sub, fontSize: 11, marginTop: 10 }}>You will confirm and sign to raise the defect{blocks ? '. This makes the aircraft unserviceable.' : '.'}</Text>
      <TouchableOpacity style={[styles.btn, !canSubmit && { opacity: 0.4 }]} onPress={raise} disabled={busy || !canSubmit}>
        <Text style={styles.btnText}>{busy ? 'Saving…' : 'Raise defect · sign'}</Text>
      </TouchableOpacity>
      <SignaturePad visible={signing} title="Sign defect report"
        onClose={() => setSigning(false)} onDone={(dataUrl) => { setSigning(false); submitWithSig(dataUrl); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 14 },
  lbl: { color: theme.sub, fontSize: 12, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, maxWidth: 340 },
  req: { color: theme.red, fontSize: 12, marginTop: 16 },
  refBtn: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  refBtnTxt: { color: theme.text, fontWeight: '800' },
  btn: { backgroundColor: theme.red, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 10, maxWidth: 340 },
  btnText: { color: '#fff', fontWeight: '700' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: theme.panel, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.border },
  ataRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border },
  ataCode: { color: theme.accent, fontWeight: '800', width: 36 },
  ataLabel: { color: theme.text },
});

