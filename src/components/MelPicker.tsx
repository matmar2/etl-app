import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MelItem, melSearch } from '../api/client';
import { theme } from '../theme';

// Standard MEL rectification intervals by category (shown alongside the item's category).
const CAT_DAYS: Record<string, string> = { A: 'per remarks', B: '3 days', C: '10 days', D: '120 days' };

// Browse / search the mirrored CAMO MEL, view an item's full page (CAMO-style), then pick it.
// When `ata` is given it defaults to that chapter, with a toggle to show all items.
export default function MelPicker({ visible, onClose, onPick, ata }: {
  visible: boolean; onClose: () => void; onPick: (m: MelItem) => void; ata?: string;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MelItem[] | null>(null);
  const [sel, setSel] = useState<MelItem | null>(null);
  const [all, setAll] = useState(false);                 // false = filter to `ata`, true = whole MEL
  const filterAta = ata && !all ? ata : undefined;

  useEffect(() => { if (visible) { setSel(null); setAll(!ata); } }, [visible, ata]);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    const id = setTimeout(() => { melSearch(q.trim(), filterAta).then((r) => setRows(r || [])).catch(() => setRows([])); }, 250);
    return () => clearTimeout(id);
  }, [visible, q, filterAta]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={sel ? () => setSel(null) : onClose}>
      <View style={{ flex: 1 }}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>MEL reference</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>
          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search MEL — ATA, item, keyword" placeholderTextColor={theme.sub} autoCapitalize="characters" />
          {ata ? (
            <View style={s.toggleRow}>
              <Chip label={`ATA ${ata} only`} on={!all} onPress={() => setAll(false)} />
              <Chip label="All MEL items" on={all} onPress={() => setAll(true)} />
            </View>
          ) : null}
          {rows ? <Text style={s.hint}>{rows.length >= 200 ? 'Showing first 200 — type an ATA or keyword to narrow' : `${rows.length} item(s)`}</Text> : null}
          <ScrollView style={s.results}>
            {rows === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
            {rows !== null && rows.length === 0 ? <Text style={s.sub}>No MEL items match{filterAta ? ` in ATA ${filterAta}` : ''}.</Text> : null}
            {(rows || []).map((m) => (
              <TouchableOpacity key={m.id} style={s.row} onPress={() => setSel(m)}>
                <Text style={s.itTitle}>{m.ata ? `${m.ata}  ·  ` : ''}{m.item}</Text>
                <Text style={s.meta}>Cat {m.category || '—'}{m.rectification_interval ? ` · ${m.rectification_interval}` : ''}{m.qty_installed ? ` · inst ${m.qty_installed}` : ''}{m.qty_required ? ` / req ${m.qty_required}` : ''}  ›</Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>

      {/* MEL item detail — overlay inside the SAME modal (stacked Modals fail on iOS) */}
      {sel ? (
      <View style={s.detailBackdrop}>
        <View style={s.detailCard}>
          <Text style={s.dHdr}>MEL {sel?.ata || ''}</Text>
          {sel ? (
            <ScrollView style={{ maxHeight: '76%' }} contentContainerStyle={{ padding: 18 }}>
              <Text style={s.dAta}>{sel.ata}</Text>
              <Text style={s.dItem}>{sel.item}</Text>
              <View style={s.table}>
                <View style={s.tHeadRow}>
                  {['REPAIR INTERVAL', 'NBR INSTALLED', 'NBR REQUIRED', 'PLACARD'].map((h) => (
                    <Text key={h} style={s.tHead}>{h}</Text>
                  ))}
                </View>
                <View style={s.tValRow}>
                  {[sel.rectification_interval || sel.category, sel.qty_installed, sel.qty_required, sel.placard].map((v, i) => (
                    <Text key={i} style={s.tVal}>{v || '—'}</Text>
                  ))}
                </View>
              </View>
              {sel.remarks ? <Text style={s.body}>{sel.remarks}</Text> : null}
              {(sel.maintenance_proc || sel.ops_proc) ? (
                <View style={s.refDiv}><View style={s.refLine} /><Text style={s.refDivTxt}>REFERENCE(S)</Text><View style={s.refLine} /></View>
              ) : null}
              {sel.maintenance_proc ? <Text style={s.ref}><Text style={s.refTag}>(M) </Text>{sel.maintenance_proc}</Text> : null}
              {sel.ops_proc ? <Text style={s.ref}><Text style={s.refTag}>(O) </Text>{sel.ops_proc}</Text> : null}
              {sel.category ? <Text style={s.catLine}>Category {sel.category}{CAT_DAYS[sel.category] ? ` — rectification interval ${CAT_DAYS[sel.category]}` : ''}</Text> : null}
              <Text style={s.dApp}>Applicability {sel.applicability || 'ALL'}{sel.revision ? ` · rev ${sel.revision}` : ''}</Text>
            </ScrollView>
          ) : null}
          <View style={s.dFooter}>
            <TouchableOpacity style={s.useBtn} onPress={() => sel && (onPick(sel), setSel(null))}><Text style={s.useBtnTxt}>Use this MEL</Text></TouchableOpacity>
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
  // MEL detail — light "document" card matching the CAMO application
  detailBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 16 },
  detailCard: { backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '90%', overflow: 'hidden' },
  dHdr: { color: '#1b2a4a', fontSize: 16, fontWeight: '800', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f2' },
  dAta: { color: '#1b2a4a', fontSize: 22, fontWeight: '900' },
  dItem: { color: '#5a6b85', fontSize: 14, marginTop: 2 },
  table: { borderWidth: 1, borderColor: '#dbe2ec', borderRadius: 6, marginTop: 14, overflow: 'hidden' },
  tHeadRow: { flexDirection: 'row', backgroundColor: '#eef2f7' },
  tHead: { flex: 1, color: '#5a6b85', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center', paddingVertical: 8, paddingHorizontal: 4 },
  tValRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#dbe2ec' },
  tVal: { flex: 1, color: '#1b2a4a', fontSize: 15, fontWeight: '700', textAlign: 'center', paddingVertical: 10 },
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
  ref: { color: '#33425e', fontSize: 13, lineHeight: 19, marginTop: 8, fontStyle: 'italic' },
  refTag: { color: '#2b5bbf', fontStyle: 'normal', fontWeight: '800' },
  catLine: { color: '#5a6b85', fontSize: 13, marginTop: 14 },
  useBtn: { backgroundColor: '#e6edf8', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 18 },
  useBtnTxt: { color: '#1b2a4a', fontWeight: '800' },
});
