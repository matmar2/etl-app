import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CcrRow, ccrInventory, ccrReport, CcrStockItem, createCcr, deleteCcr, listCcr, sendCcrReport, updateCcr } from '../api/client';
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

  // CAMO inventory picker (online only — offline stays manual entry): fills P/N + S/N of one side.
  const [invSide, setInvSide] = useState<'off' | 'on' | null>(null);
  const [invQ, setInvQ] = useState('');
  const [invItems, setInvItems] = useState<CcrStockItem[] | null>(null);
  const [invMsg, setInvMsg] = useState('');
  async function invSearch(q: string) {
    setInvQ(q); setInvMsg('');
    if (q.trim().length < 2) { setInvItems(null); return; }
    try { const r = await ccrInventory(q.trim()); setInvItems(r.items); }
    catch (e: any) { setInvItems([]); setInvMsg(e?.message?.includes('Network') ? 'CAMO inventory needs a connection — enter the part manually.' : (e?.message || 'Inventory unavailable — enter manually.')); }
  }
  function invPick(it: CcrStockItem) {
    setEditing((e) => {
      if (!e) return e;
      const upd: any = { ...e };
      if (invSide === 'off') { upd.pn_off = it.part_no; upd.sn_off = it.serial_no; }
      else { upd.pn_on = it.part_no; upd.sn_on = it.serial_no; }
      if (!upd.description && it.description) upd.description = it.description;
      return upd;
    });
    setInvSide(null); setInvQ(''); setInvItems(null);
  }

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
          <View style={s.row}>{F('pn_off', 'Part № OFF')}{F('sn_off', 'Serial № OFF')}
            <TouchableOpacity style={s.btn2} onPress={() => { setInvSide('off'); setInvQ(''); setInvItems(null); setInvMsg(''); }}><Text style={s.btn2t}>▾ CAMO inventory</Text></TouchableOpacity>
          </View>
          <Text style={s.lbl}>Installed (ON)</Text>
          <View style={s.row}>{F('pn_on', 'Part № ON')}{F('sn_on', 'Serial № ON')}
            <TouchableOpacity style={s.btn2} onPress={() => { setInvSide('on'); setInvQ(''); setInvItems(null); setInvMsg(''); }}><Text style={s.btn2t}>▾ CAMO inventory</Text></TouchableOpacity>
          </View>
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

      {/* CAMO inventory search — rotable stock (P/N · S/N · batch · condition) from the OASES mirror. */}
      <Modal visible={invSide != null} transparent animationType="none" onRequestClose={() => setInvSide(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.panel, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.border, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.rowTitle}>CAMO inventory — {invSide === 'off' ? 'removed (OFF)' : 'installed (ON)'} part</Text>
              <TouchableOpacity onPress={() => setInvSide(null)}><Text style={{ color: theme.accent, fontWeight: '800' }}>Close</Text></TouchableOpacity>
            </View>
            <TextInput style={[s.input, { marginTop: 10 }]} value={invQ} onChangeText={invSearch} autoFocus
              placeholder="Search part №, serial № or description (min 2 chars)" placeholderTextColor={theme.sub} />
            {invMsg ? <Text style={[s.sub, { color: theme.red }]}>{invMsg}</Text> : null}
            <ScrollView style={{ marginTop: 8 }}>
              {(invItems || []).map((it, i) => (
                <TouchableOpacity key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border }} onPress={() => invPick(it)}>
                  <Text style={{ color: theme.text, fontWeight: '700' }}>{it.part_no}  ·  S/N {it.serial_no || '—'}{it.serviceable === false ? '  ·  UNSVC' : ''}</Text>
                  <Text style={s.meta}>{it.description || '—'}{it.batch ? `  ·  batch ${it.batch}` : ''}{it.condition ? `  ·  ${it.condition}` : ''}</Text>
                </TouchableOpacity>
              ))}
              {invItems && !invItems.length && !invMsg ? <Text style={[s.sub, { marginTop: 8 }]}>No matches in stock.</Text> : null}
            </ScrollView>
            <Text style={[s.sub, { marginTop: 8 }]}>Online only — with no connection, enter the part manually. Certificate № stays manual (the mirror holds condition/batch, not the Form 1 №).</Text>
          </View>
        </View>
      </Modal>
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
