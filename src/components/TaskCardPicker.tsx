import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { TaskCard, taskCardFilters, taskCards, taskSummary } from '../api/client';
import { theme } from '../theme';

// Lets the mechanic search/filter the CAMO AMP task cards and pick one. onPick gets
// the full card; the caller formats the "i.a.w …" narrative.
export default function TaskCardPicker({ visible, onClose, onPick, defaultAta }: {
  visible: boolean; onClose: () => void; onPick: (t: TaskCard) => void; defaultAta?: string;
}) {
  const [q, setQ] = useState('');
  const [ata, setAta] = useState('');
  const [sub, setSub] = useState('');
  const [filters, setFilters] = useState<{ ata: string[]; sub: Record<string, string[]> }>({ ata: [], sub: {} });
  const [rows, setRows] = useState<TaskCard[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { if (visible) taskCardFilters().then((f) => setFilters(f || { ata: [], sub: {} })).catch(() => {}); }, [visible]);
  // default to the defect's ATA chapter (2-digit) when opened; the mechanic can widen to All
  useEffect(() => { if (visible) { setAta((defaultAta || '').slice(0, 2)); setSub(''); } }, [visible, defaultAta]);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    const id = setTimeout(() => {
      taskCards(q || undefined, ata || undefined, sub || undefined).then((r) => setRows(r || [])).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(id);
  }, [visible, q, ata, sub]);

  const subOptions: string[] = ata ? (filters.sub[ata] || []) : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>AMP task cards</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>

          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search task no / card / description" placeholderTextColor={theme.sub} autoCapitalize="characters" />

          <Text style={s.lbl}>ATA</Text>
          <View style={s.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              <Chip label="All" on={!ata} onPress={() => { setAta(''); setSub(''); }} />
              {filters.ata.map((a) => <Chip key={a} label={a} on={ata === a} onPress={() => { setAta(a); setSub(''); }} />)}
            </ScrollView>
          </View>

          {subOptions.length > 0 && (
            <>
              <Text style={s.lbl}>Sub-chapter</Text>
              <View style={s.chipRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                  <Chip label="All" on={!sub} onPress={() => setSub('')} />
                  {subOptions.map((c) => <Chip key={c} label={c} on={sub === c} onPress={() => setSub(c)} />)}
                </ScrollView>
              </View>
            </>
          )}

          <ScrollView style={s.results}>
            {rows === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
            {rows !== null && rows.length === 0 ? <Text style={s.sub}>No task cards match.</Text> : null}
            {(rows || []).map((t) => {
              const open = expanded === t.task_number;
              const meta = [t.ata_chapter ? `ATA ${t.ata_chapter}` : '', t.chapter || '', t.job_type || '',
                t.interval ? `${t.interval}${t.interval_unit ? ' ' + t.interval_unit : ''}` : ''].filter(Boolean).join(' · ');
              return (
                <View key={t.task_number + (t.card_no || '')} style={s.row}>
                  <TouchableOpacity onPress={() => setExpanded(open ? null : t.task_number)}>
                    <Text style={s.tno}>{t.task_number}{t.card_no ? `  ·  card ${t.card_no}` : ''}</Text>
                    {meta ? <Text style={s.meta}>{meta}</Text> : null}
                    {(() => { const sum = taskSummary(t) || '(no description in AMP — refer to task card)';
                      return open ? <Text style={s.desc}>{sum}</Text> : <Text style={s.desc} numberOfLines={2}>{sum}</Text>; })()}
                    {t.effectivity ? <Text style={s.eff}>Effectivity: {t.effectivity}</Text> : null}
                  </TouchableOpacity>
                  <TouchableOpacity style={s.use} onPress={() => onPick(t)}><Text style={s.useTxt}>Use this card ›</Text></TouchableOpacity>
                </View>
              );
            })}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, on ? s.chipOn : null]}>
      <Text numberOfLines={1} style={[s.chipTxt, on ? s.chipTxtOn : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 16, height: '85%' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  close: { color: theme.accent, fontWeight: '700' },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 },
  lbl: { color: theme.sub, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4, textTransform: 'uppercase' },
  chipRow: { height: 40, marginBottom: 2 },
  chips: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  sub: { color: theme.sub, marginTop: 16 },
  results: { flex: 1, marginTop: 8 },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile, maxWidth: 220, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.sub, fontWeight: '700', fontSize: 12 },
  chipTxtOn: { color: '#1a1300' },
  row: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  tno: { color: theme.text, fontWeight: '800', fontSize: 15 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  desc: { color: '#cde', fontSize: 13, marginTop: 6, lineHeight: 18 },
  eff: { color: theme.sub, fontSize: 11, marginTop: 4 },
  use: { marginTop: 8, alignSelf: 'flex-start' },
  useTxt: { color: theme.accent, fontWeight: '800' },
});
