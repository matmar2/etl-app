import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AmmCard, ammContent, ammFilters, ammSavedCount, ammSearch, ammSummary, NetworkError, prefetchAmm, saveAmmForOffline } from '../api/client';
import AmmInstruction from './AmmInstruction';
import { theme } from '../theme';

// Lets the mechanic search/filter the CAMO AMM task cards applicable to THIS aircraft and
// pick one. onPick gets the full AMM task; the caller starts the description with
// "i.a.w AMM Rev <rev> · <task#> — <description>".
export default function AmmPicker({ visible, reg, onClose, onPick, defaultAta }: {
  visible: boolean; reg?: string; onClose: () => void; onPick: (m: AmmCard) => void; defaultAta?: string;
}) {
  const [q, setQ] = useState('');
  const [ata, setAta] = useState('');
  const [filters, setFilters] = useState<{ ata: string[] }>({ ata: [] });
  const [rows, setRows] = useState<AmmCard[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ ref: string; html: string } | null>(null);   // instruction viewer
  const [loadingRef, setLoadingRef] = useState<string | null>(null);
  const [cached, setCached] = useState<number | null>(null);   // AMM task-card list cached for offline
  const [saveProg, setSaveProg] = useState<{ done: number; total: number } | null>(null);
  const [saveNote, setSaveNote] = useState('');
  const [savedN, setSavedN] = useState(0);   // how many of the shown cards already have an offline copy

  // Save the full instructions (diagrams inlined) for the cards currently shown, for offline reading.
  async function saveThese() {
    if (saveProg) return;
    const refs = (rows || []).map((r) => r.task_card_ref).filter(Boolean);
    if (!refs.length) return;
    if (refs.length > 60) { setSaveNote('Too many to save at once — filter by ATA or search to 60 cards or fewer, then Save.'); return; }
    setSaveNote(''); setSaveProg({ done: 0, total: refs.length });
    const res = await saveAmmForOffline(reg, refs, (done, total) => setSaveProg({ done, total }));
    setSaveProg(null);
    setSaveNote(res.saved
      ? `✓ ${res.saved} instruction${res.saved === 1 ? '' : 's'} saved for offline${res.failed ? ` · ${res.failed} unavailable` : ''}`
      : 'Could not save — connect to the internet and try again.');
  }

  async function openInstruction(m: AmmCard) {
    setLoadingRef(m.task_card_ref);
    try {
      const r = await ammContent(reg, m.task_card_ref);
      setViewer({ ref: m.task_card_ref, html: r.html });
    } catch (e) {
      const offline = e instanceof NetworkError;
      const msg = offline
        ? 'This instruction is not saved on this iPad yet.<br><br>Full AMM instructions and diagrams are large, so they are kept offline only when you choose to save them. While online, filter to the tasks you need and tap <b>“⬇ Save these … for offline”</b> at the top of the picker (or open each one once). The task-card list and the i.a.w reference already work offline.'
        : 'No instruction is available for this task card.';
      setViewer({ ref: m.task_card_ref, html: `<div style="padding:22px;font-family:-apple-system,sans-serif;color:#333;line-height:1.55;font-size:15px">${msg}</div>` });
    } finally { setLoadingRef(null); }
  }

  // On open (online), cache this tail's full AMM list + filters so the picker works offline next
  // time — one online open is enough. Shows how many cards are held for offline use.
  useEffect(() => {
    if (!visible || !reg) return;
    ammFilters(reg).then((f) => setFilters(f || { ata: [] })).catch(() => {});
    prefetchAmm(reg).then((n) => { if (n) setCached(n); }).catch(() => {});
  }, [visible, reg]);
  useEffect(() => { if (visible) setAta((defaultAta || '').slice(0, 2)); }, [visible, defaultAta]);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    const id = setTimeout(() => {
      ammSearch(reg, q || undefined, ata || undefined).then((r) => setRows(r || [])).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(id);
  }, [visible, reg, q, ata]);

  useEffect(() => {
    if (!visible || !rows || !rows.length) { setSavedN(0); return; }
    ammSavedCount(reg, rows.map((r) => r.task_card_ref)).then(setSavedN).catch(() => setSavedN(0));
  }, [visible, reg, rows]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>AMM task cards{reg && reg.length <= 8 ? ` · ${reg}` : ''}</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>

          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search Task # / description" placeholderTextColor={theme.sub} autoCapitalize="characters" />
          {cached ? <Text style={s.cached}>✓ {cached} task cards available offline</Text> : null}

          <Text style={s.lbl}>ATA</Text>
          <View style={s.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              <Chip label="All" on={!ata} onPress={() => setAta('')} />
              {filters.ata.map((a) => <Chip key={a} label={a} on={ata === a} onPress={() => setAta(a)} />)}
            </ScrollView>
          </View>

          {rows && rows.length ? (
            <View style={s.saveBar}>
              <TouchableOpacity style={[s.saveBtn, saveProg && { opacity: 0.6 }]} disabled={!!saveProg} onPress={saveThese}>
                <Text style={s.saveTxt}>{saveProg ? `Saving instructions ${saveProg.done}/${saveProg.total}…` : `⬇ Save these ${rows.length} instruction${rows.length === 1 ? '' : 's'} for offline`}</Text>
              </TouchableOpacity>
              {saveNote ? <Text style={s.saveNote}>{saveNote}</Text>
                : (!saveProg && savedN) ? <Text style={s.saveNote}>{savedN} of {rows.length} already saved offline</Text> : null}
            </View>
          ) : null}

          <ScrollView style={s.results}>
            {rows === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
            {rows !== null && rows.length === 0 ? <Text style={s.sub}>No AMM task cards match for this aircraft.</Text> : null}
            {(rows || []).map((m, i) => {
              const key = `${m.task_card_ref}-${i}`;
              const open = expanded === key;
              const summary = ammSummary(m) || '(no description — refer to AMM)';
              return (
                <View key={key} style={s.row}>
                  <TouchableOpacity onPress={() => setExpanded(open ? null : key)}>
                    <Text style={s.tno}>{m.task_card_ref}</Text>
                    {m.revision || m.ata ? <Text style={s.meta}>{[m.revision ? `AMM Rev ${m.revision}` : '', m.ata].filter(Boolean).join(' · ')}</Text> : null}
                    <Text style={s.desc} numberOfLines={open ? undefined : 2}>{summary}</Text>
                  </TouchableOpacity>
                  <View style={s.actions}>
                    <TouchableOpacity style={s.instrBtn} onPress={() => openInstruction(m)} disabled={loadingRef === m.task_card_ref}>
                      <Text style={s.instrTxt}>{loadingRef === m.task_card_ref ? 'Opening…' : '📖 Instruction'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.use} onPress={() => onPick(m)}><Text style={s.useTxt}>Use this task card ›</Text></TouchableOpacity>
                  </View>
                </View>
              );
            })}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>

      {/* AMM instruction viewer (full HTML + diagrams from CAMO) */}
      <Modal visible={!!viewer} animationType="slide" onRequestClose={() => setViewer(null)}>
        <View style={s.viewer}>
          <View style={s.vhead}>
            <Text style={s.title} numberOfLines={1}>AMM · {viewer?.ref}</Text>
            <TouchableOpacity onPress={() => setViewer(null)}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>{viewer ? <AmmInstruction html={viewer.html} /> : null}</View>
          <View style={s.vfoot}>
            <TouchableOpacity style={s.pickBtn}
              onPress={() => { const card = (rows || []).find((x) => x.task_card_ref === viewer?.ref); if (card) { setViewer(null); onPick(card); } }}>
              <Text style={s.pickTxt}>Use this task card ›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  cached: { color: theme.green, fontSize: 11, fontWeight: '700', marginTop: 6 },
  saveBar: { marginTop: 6, marginBottom: 2 },
  saveBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  saveTxt: { color: theme.accent, fontWeight: '700', fontSize: 12 },
  saveNote: { color: theme.sub, fontSize: 11, marginTop: 5 },
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 10 },
  use: { alignSelf: 'flex-start' },
  useTxt: { color: theme.accent, fontWeight: '800' },
  instrBtn: { alignSelf: 'flex-start' },
  instrTxt: { color: theme.green, fontWeight: '800' },
  viewer: { flex: 1, backgroundColor: theme.bg, paddingTop: 12 },
  vhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  vfoot: { padding: 12, borderTopWidth: 1, borderTopColor: theme.border },
  pickBtn: { backgroundColor: theme.accent, borderRadius: 8, padding: 14, alignItems: 'center' },
  pickTxt: { color: '#1a1300', fontWeight: '800' },
});
