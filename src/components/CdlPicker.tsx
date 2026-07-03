import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CdlItem, cdlSearch } from '../api/client';
import { theme } from '../theme';

// Browse / search the mirrored CAMO CDL (Configuration Deviation List), view an item's
// full page (CAMO-style), then pick it. Mirrors MelPicker. `ata` defaults the filter.
export default function CdlPicker({ visible, onClose, onPick, ata }: {
  visible: boolean; onClose: () => void; onPick: (c: CdlItem) => void; ata?: string;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CdlItem[] | null>(null);
  const [sel, setSel] = useState<CdlItem | null>(null);
  const [all, setAll] = useState(false);
  const filterAta = ata && !all ? ata : undefined;

  useEffect(() => { if (visible) { setSel(null); setAll(!ata); } }, [visible, ata]);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    const id = setTimeout(() => { cdlSearch(q.trim(), filterAta).then((r) => setRows(r || [])).catch(() => setRows([])); }, 250);
    return () => clearTimeout(id);
  }, [visible, q, filterAta]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={sel ? () => setSel(null) : onClose}>
      <View style={{ flex: 1 }}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>CDL reference</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>
          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search CDL — ATA, system, code, keyword" placeholderTextColor={theme.sub} autoCapitalize="characters" />
          {ata ? (
            <View style={s.toggleRow}>
              <Chip label={`ATA ${ata} only`} on={!all} onPress={() => setAll(false)} />
              <Chip label="All CDL items" on={all} onPress={() => setAll(true)} />
            </View>
          ) : null}
          {rows ? <Text style={s.hint}>{rows.length >= 200 ? 'Showing first 200 — type an ATA or keyword to narrow' : `${rows.length} item(s)`}</Text> : null}
          <ScrollView style={s.results}>
            {rows === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
            {rows !== null && rows.length === 0 ? <Text style={s.sub}>No CDL items match{filterAta ? ` in ATA ${filterAta}` : ''}.</Text> : null}
            {(rows || []).map((c) => (
              <TouchableOpacity key={c.id} style={s.row} onPress={() => setSel(c)}>
                <Text style={s.itTitle}>{c.ata ? `${c.ata}  ·  ` : ''}{c.item || c.system}</Text>
                <Text style={s.meta}>{c.code ? `Code ${c.code}` : ''}{c.ident ? ` · ${c.ident}` : ''}{c.qty_installed ? ` · inst ${c.qty_installed}` : ''}  ›</Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>

      {sel ? (
      <View style={s.detailBackdrop}>
        <View style={s.detailCard}>
          <Text style={s.dHdr}>CDL {sel?.ata || ''}</Text>
          <ScrollView style={{ maxHeight: '76%' }} contentContainerStyle={{ padding: 18 }}>
            <Text style={s.dAta}>{sel.ata}{sel.code ? ` · ${sel.code}` : ''}</Text>
            <Text style={s.dItem}>{sel.item || sel.system}</Text>
            <View style={s.table}>
              <View style={s.tHeadRow}>
                {['CODE', 'IDENT', 'NBR INSTALLED', 'APPLICABILITY'].map((h) => (
                  <Text key={h} style={s.tHead}>{h}</Text>
                ))}
              </View>
              <View style={s.tValRow}>
                {[sel.code, sel.ident, sel.qty_installed, sel.applicability || 'ALL'].map((v, i) => (
                  <Text key={i} style={s.tVal}>{v || '—'}</Text>
                ))}
              </View>
            </View>
            {sel.dispatch ? <Text style={s.body}><Text style={s.bLbl}>Dispatch: </Text>{sel.dispatch}</Text> : null}
            {sel.criteria ? <Text style={s.body}><Text style={s.bLbl}>Criteria: </Text>{sel.criteria}</Text> : null}
            {sel.detail ? <Text style={s.body}>{sel.detail}</Text> : null}
            {(sel.maintenance_proc || sel.performance) ? (
              <View style={s.refDiv}><View style={s.refLine} /><Text style={s.refDivTxt}>REFERENCE(S)</Text><View style={s.refLine} /></View>
            ) : null}
            {sel.maintenance_proc ? <Text style={s.ref}><Text style={s.refTag}>(M) </Text>{sel.maintenance_proc}</Text> : null}
            {sel.performance ? <Text style={s.ref}><Text style={s.refTag}>(P) </Text>{sel.performance}</Text> : null}
            {sel.registrations && sel.registrations.length ? (
              <View style={{ marginTop: 16 }}>
                <Text style={s.regHdr}>APPLICABLE REGISTRATIONS ({sel.registrations.length})</Text>
                <View style={s.regWrap}>
                  {sel.registrations.map((r) => <View key={r} style={s.regChip}><Text style={s.regChipTxt}>{r}</Text></View>)}
                </View>
              </View>
            ) : null}
            <Text style={s.dApp}>Model applicability {sel.applicability || 'ALL'}{sel.revision ? ` · rev ${sel.revision}` : ''}</Text>
          </ScrollView>
          <View style={s.dFooter}>
            <TouchableOpacity style={s.useBtn} onPress={() => sel && (onPick(sel), setSel(null))}><Text style={s.useBtnTxt}>Use this CDL</Text></TouchableOpacity>
            <TouchableOpacity style={s.closeBtn} onPress={() => setSel(null)}><Text style={s.closeBtnTxt}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </View>
      ) : null}
      </View>
    </Modal>
  );
}
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, on ? s.chipOn : null]}>
      <Text style={[s.chipTxt, on ? s.chipTxtOn : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 16, height: '88%' },
  detailBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 16 },
  detailCard: { backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '90%', overflow: 'hidden' },
  dHdr: { color: '#1b2a4a', fontSize: 16, fontWeight: '800', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f2' },
  dAta: { color: '#1b2a4a', fontSize: 22, fontWeight: '900' },
  dItem: { color: '#5a6b85', fontSize: 14, marginTop: 2 },
  table: { borderWidth: 1, borderColor: '#dbe2ec', borderRadius: 6, marginTop: 14, overflow: 'hidden' },
  tHeadRow: { flexDirection: 'row', backgroundColor: '#eef2f7' },
  tHead: { flex: 1, color: '#5a6b85', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center', paddingVertical: 8, paddingHorizontal: 4 },
  tValRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#dbe2ec' },
  tVal: { flex: 1, color: '#1b2a4a', fontSize: 14, fontWeight: '700', textAlign: 'center', paddingVertical: 10, paddingHorizontal: 2 },
  refDiv: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  refLine: { flex: 1, height: 1, backgroundColor: '#dbe2ec' },
  refDivTxt: { color: '#5a6b85', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginHorizontal: 10 },
  dApp: { color: '#5a6b85', fontSize: 12, marginTop: 14 },
  dFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: '#e2e8f2' },
  closeBtn: { backgroundColor: '#2b5bbf', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 18 },
  closeBtnTxt: { color: '#fff', fontWeight: '800' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  close: { color: theme.accent, fontWeight: '700' },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.sub, fontWeight: '700', fontSize: 12 },
  chipTxtOn: { color: '#1a1300' },
  hint: { color: theme.sub, fontSize: 11, marginTop: 6 },
  results: { flex: 1, marginTop: 8 },
  sub: { color: theme.sub, marginTop: 16 },
  row: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  itTitle: { color: theme.text, fontWeight: '800', fontSize: 15 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  body: { color: '#1b2a4a', fontSize: 14, lineHeight: 20, marginTop: 14 },
  bLbl: { fontWeight: '800', color: '#1b2a4a' },
  ref: { color: '#33425e', fontSize: 13, lineHeight: 19, marginTop: 8, fontStyle: 'italic' },
  refTag: { color: '#2b5bbf', fontStyle: 'normal', fontWeight: '800' },
  useBtn: { backgroundColor: '#e6edf8', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 18 },
  useBtnTxt: { color: '#1b2a4a', fontWeight: '800' },
  regHdr: { color: '#5a6b85', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  regWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  regChip: { backgroundColor: '#eef2f7', borderWidth: 1, borderColor: '#cdd9ea', borderRadius: 5, paddingVertical: 4, paddingHorizontal: 8 },
  regChipTxt: { color: '#1b2a4a', fontWeight: '800', fontSize: 12 },
});
