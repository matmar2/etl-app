import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CcrRow, ccrReport, createCcr, deleteCcr, listCcr, sendCcrReport, updateCcr } from '../api/client';
import { printHtml } from '../print';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

// Component Change Report (CCR) — mirrors the paper tech log component-change grid:
// № · Description · P/N OFF · P/N ON · S/N OFF · S/N ON, plus position and the installed part's
// EASA Form 1 / CoC certificate № with a photo of the certificate. Rows are sealed once emailed.
export default function ComponentChangeScreen({ route }: any) {
  const { defectId, sectorId } = route.params || {};
  const scope = { defectId, sectorId };
  const [rows, setRows] = useState<CcrRow[]>([]);
  const [editing, setEditing] = useState<CcrRow | null>(null);   // row being edited (id '' = new)
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await listCcr(scope); setRows(r.items || []); }
    catch (e: any) { setMsg(e?.message || 'Could not load — connection needed.'); }
  }, [defectId, sectorId]);
  useEffect(() => { load(); }, [load]);

  const blank: CcrRow = { id: '', description: '', position: '', pn_off: '', sn_off: '', pn_on: '', sn_on: '', cert_no: '' };
  const [certPhoto, setCertPhoto] = useState<string | null>(null);
  const sealed = rows.some((r) => r.emailed_at);

  async function snapCert(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets?.[0]?.base64) setCertPhoto(`data:image/jpeg;base64,${res.assets[0].base64}`);
  }

  async function save() {
    if (!editing) return;
    setBusy(true); setMsg('');
    try {
      const body: any = { ...scope, defect_id: defectId, sector_id: sectorId,
        description: editing.description, position: editing.position,
        pn_off: editing.pn_off, sn_off: editing.sn_off, pn_on: editing.pn_on, sn_on: editing.sn_on,
        cert_no: editing.cert_no, cert_photo: certPhoto || undefined };
      if (editing.id) await updateCcr(editing.id, body); else await createCcr(body);
      setEditing(null); setCertPhoto(null); await load();
    } catch (e: any) { setMsg(e?.message || 'Save failed.'); }
    finally { setBusy(false); }
  }

  async function remove(r: CcrRow) {
    if (!(await confirmAction(`Remove component-change row "${r.description || ''}"?`, 'Remove'))) return;
    try { await deleteCcr(r.id); await load(); } catch (e: any) { setMsg(e?.message || 'Delete failed.'); }
  }

  async function preview() {
    try { const { html } = await ccrReport(scope); if (html) await printHtml(html); }
    catch (e: any) { setMsg(e?.message || 'Preview needs a connection.'); }
  }

  async function send() {
    if (!(await confirmAction('Email the Component Change Report (with certificate photos) to the configured recipients?\n\nAfter sending, the rows are sealed.', 'Send report'))) return;
    setBusy(true); setMsg('');
    try { const r = await sendCcrReport(scope); setMsg(`✓ Sent to ${r.sent_to.join(', ')}`); await load(); }
    catch (e: any) { setMsg(e?.message || 'Send failed.'); }
    finally { setBusy(false); }
  }

  // Plain function (NOT a component) — a nested component would remount its TextInput on every
  // keystroke and drop the keyboard focus.
  const F = (k: keyof CcrRow, ph: string, w = 150) => (
    <TextInput style={[s.input, { width: w }]} value={(editing?.[k] as string) || ''} placeholder={ph} placeholderTextColor={theme.sub}
      onChangeText={(t) => setEditing((e) => (e ? { ...e, [k]: t } : e))} />
  );

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Component Change (CCR)</Text>
      <Text style={s.sub}>One row per removed / installed component — as on the paper tech log. The installed part needs its EASA Form 1 / CoC certificate № and a photo of the certificate.</Text>
      {msg ? <Text style={[s.sub, { color: msg.startsWith('✓') ? theme.green : theme.red, fontWeight: '700' }]}>{msg}</Text> : null}

      {rows.map((r) => (
        <View key={r.id} style={s.card}>
          <Text style={s.rowTitle}>{r.seq}. {r.description || '—'}{r.position ? `  ·  ${r.position}` : ''}</Text>
          <Text style={s.meta}>OFF  P/N {r.pn_off || '—'} · S/N {r.sn_off || '—'}      ON  P/N {r.pn_on || '—'} · S/N {r.sn_on || '—'}</Text>
          <Text style={s.meta}>Cert № {r.cert_no || '—'}{r.has_cert_photo ? '  ·  📷 certificate photo' : ''}{r.emailed_at ? `  ·  ✉ sent ${String(r.emailed_at).slice(0, 16)}` : ''}</Text>
          {!r.emailed_at ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <TouchableOpacity onPress={() => { setEditing(r); setCertPhoto(null); }}><Text style={{ color: theme.accent, fontWeight: '700' }}>✎ Edit</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => remove(r)}><Text style={{ color: theme.red, fontWeight: '700' }}>✕ Remove</Text></TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}
      {!rows.length ? <Text style={[s.sub, { marginTop: 8 }]}>No component changes recorded yet.</Text> : null}

      {editing ? (
        <View style={[s.card, { borderColor: theme.accent }]}>
          <Text style={s.rowTitle}>{editing.id ? 'Edit row' : 'New component change'}</Text>
          <View style={s.row}>{F('description', 'Component description *', 300)}{F('position', 'Position (e.g. ENG 1)')}</View>
          <Text style={s.lbl}>Removed (OFF)</Text>
          <View style={s.row}>{F('pn_off', 'Part № OFF')}{F('sn_off', 'Serial № OFF')}</View>
          <Text style={s.lbl}>Installed (ON)</Text>
          <View style={s.row}>{F('pn_on', 'Part № ON')}{F('sn_on', 'Serial № ON')}</View>
          <View style={s.row}>{F('cert_no', 'Certificate № (Form 1 / CoC)', 220)}</View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            <TouchableOpacity style={s.btn2} onPress={() => snapCert(true)}><Text style={s.btn2t}>📷 Photo of certificate</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn2} onPress={() => snapCert(false)}><Text style={s.btn2t}>🖼 Library</Text></TouchableOpacity>
            {certPhoto ? <Text style={[s.sub, { alignSelf: 'center' }]}>✓ photo attached</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity style={[s.btn, { backgroundColor: theme.green }]} disabled={busy} onPress={save}><Text style={s.btnT}>Save row</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn2} onPress={() => { setEditing(null); setCertPhoto(null); }}><Text style={s.btn2t}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      ) : !sealed ? (
        <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent, marginTop: 10 }]} onPress={() => { setEditing(blank); setCertPhoto(null); }}>
          <Text style={[s.btnT, { color: '#1a1300' }]}>+ Add component change</Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <TouchableOpacity style={s.btn2} onPress={preview}><Text style={s.btn2t}>👁 Preview / print report</Text></TouchableOpacity>
        {rows.length && !sealed ? (
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.green }]} disabled={busy} onPress={send}>
            <Text style={s.btnT}>✉ Send report to recipients</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[s.sub, { marginTop: 8 }]}>Recipients are set by Admin (Settings → Component Change Report). At go-live the off/on component records will also synchronise to OASES Aircraft Monitoring.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4 },
  lbl: { color: theme.sub, fontSize: 12, fontWeight: '700', marginTop: 8 },
  card: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 10 },
  rowTitle: { color: theme.text, fontWeight: '800' },
  meta: { color: theme.sub, marginTop: 3, fontSize: 13 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  input: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, color: theme.text, paddingHorizontal: 10, paddingVertical: 8 },
  btn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  btnT: { color: '#fff', fontWeight: '800' },
  btn2: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border },
  btn2t: { color: theme.text, fontWeight: '700' },
});
