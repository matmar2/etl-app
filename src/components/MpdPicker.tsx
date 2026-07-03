import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MpdCard, mpdFilters, mpdSearch, mpdSummary } from '../api/client';
import { theme } from '../theme';

// Lets the mechanic search/filter the CAMO MPD tasks and pick one. onPick gets the full
// MPD task; the caller starts the defect description with "i.a.w AMM <reference> — <summary>".
export default function MpdPicker({ visible, onClose, onPick, defaultAta }: {
  visible: boolean; onClose: () => void; onPick: (m: MpdCard) => void; defaultAta?: string;
}) {
  const [q, setQ] = useState('');
  const [ata, setAta] = useState('');
  const [filters, setFilters] = useState<{ ata: string[] }>({ ata: [] });
  const [rows, setRows] = useState<MpdCard[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { if (visible) mpdFilters().then((f) => setFilters(f || { ata: [] })).catch(() => {}); }, [visible]);
  // default to the defect's ATA chapter (2-digit) when opened; the mechanic can widen to All
  useEffect(() => { if (visible) setAta((defaultAta || '').slice(0, 2)); }, [visible, defaultAta]);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    const id = setTimeout(() => {
      mpdSearch(q || undefined, ata || undefined).then((r) => setRows(r || [])).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(id);
  }, [visible, q, ata]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>MPD — AMM reference</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>

          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search AMM reference / description" placeholderTextColor={theme.sub} autoCapitalize="characters" />

          <Text style={s.lbl}>ATA</Text>
          <View style={s.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              <Chip label="All" on={!ata} onPress={() => setAta('')} />
              {filters.ata.map((a) => <Chip key={a} label={a} on={ata === a} onPress={() => setAta(a)} />)}
            </ScrollView>
          </View>

          <ScrollView style={s.results}>
            {rows === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
            {rows !== null && rows.length === 0 ? <Text style={s.sub}>No MPD tasks match.</Text> : null}
            {(rows || []).map((m, i) => {
              const key = `${m.reference}-${i}`;
              const open = expanded === key;
              const summary = mpdSummary(m) || '(no description — refer to MPD)';
              return (
                <View key={key} style={s.row}>
                  <TouchableOpacity onPress={() => setExpanded(open ? null : key)}>
                    <Text style={s.tno}>{m.reference}</Text>
                    {m.task_number || m.section ? <Text style={s.meta}>{[m.task_number, m.section].filter(Boolean).join(' · ')}</Text> : null}
                    <Text style={s.desc} numberOfLines={open ? undefined : 2}>{summary}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.use} onPress={() => onPick(m)}><Text style={s.useTxt}>Use this reference ›</Text></TouchableOpacity>
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
  use: { marginTop: 8, alignSelf: 'flex-start' },
  useTxt: { color: theme.accent, fontWeight: '800' },
});
