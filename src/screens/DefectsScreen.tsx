import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { access, can, cabinLogHtml, cabinLogHtmlOne, currentAircraft, hilHtml, hilHtmlOne, listActiveDefects, listClearedCabin, listHIL, syncPush } from '../api/client';
import { printHtml } from '../print';
import { cabinDefectHtml as localCabinHtml, hilHtml as localHilHtml } from '../print/techlog';
import { theme } from '../theme';

type Tab = 'defects' | 'cabin' | 'hil';

const fmtD = (iso?: string) => {                      // ISO -> DD/MM/YY
  if (!iso) return '';
  const p = iso.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : iso.slice(0, 10);
};

export default function DefectsScreen({ route, navigation }: any) {
  const aircraftId = route?.params?.aircraftId ?? 'LZ-FSA';
  // Tab visibility is admin-controlled via the permission matrix, not hard-coded by role:
  // technical Defects + HIL follow the 'defects' page; Cabin follows the 'cabin' page.
  const canTech = access('defects') !== 'none';
  const canCabin = access('cabin') !== 'none';
  const [tab, setTab] = useState<Tab>(canTech ? 'defects' : canCabin ? 'cabin' : 'hil');
  const [active, setActive] = useState<any[]>([]);
  const [hil, setHil] = useState<any[]>([]);
  const [clearedCabin, setClearedCabin] = useState<any[]>([]);
  const [note, setNote] = useState('Loading…');

  const load = useCallback(async () => {
    setNote('Loading…');
    await syncPush().catch(() => {});                 // push any locally-created defects up first
    try {
      const [a, h] = await Promise.all([listActiveDefects(aircraftId), listHIL(aircraftId)]);
      setActive(a); setHil(h); setNote('');
    } catch { setNote('Offline — will sync when connected'); }
    listClearedCabin(aircraftId).then(setClearedCabin).catch(() => {});   // cleared cabin items (read-only)
  }, [aircraftId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const tech = active.filter((d) => (d.area ?? 'technical') !== 'cabin');
  // Cabin tab lists only OPEN cabin defects (like Defects/HIL). Closed/cleared items are not
  // shown here — they remain in the printed full Cabin Defect Log and the Sign Off page.
  const cabin = active.filter((d) => d.area === 'cabin');
  const data = tab === 'defects' ? tech : tab === 'cabin' ? cabin : hil;
  const empty = tab === 'defects' ? 'No active defects' : tab === 'cabin' ? 'No cabin defects' : 'No hold items';

  const badge = (s: string) =>
    s === 'deferred' ? theme.accent : s === 'rectified' ? '#3aa655' : s === 'closed' ? theme.sub : s === 'troubleshooting' ? theme.sub : theme.red;

  const Tab = ({ id, label, n }: { id: Tab; label: string; n: number }) => (
    <TouchableOpacity style={[styles.tab, tab === id && styles.tabOn]} onPress={() => setTab(id)}>
      <Text style={[styles.tabTxt, tab === id && styles.tabTxtOn]}>{label}{n ? ` (${n})` : ''}</Text>
    </TouchableOpacity>
  );

  // Offline fallback: render the HIL / Cabin Defect Log from the cached aircraft defects.
  async function localForm(kind: 'hil' | 'cabin', items?: any[]): Promise<string> {
    const { getLocalAircraftDefects } = require('../db/defects');
    const defects = items ?? await getLocalAircraftDefects(aircraftId).catch(() => [] as any[]);
    const ac = currentAircraft() || { registration: acLabel };
    const data: any = { sector: {}, aircraft: ac, defects, signatures: [] };
    return kind === 'hil' ? localHilHtml(data) : localCabinHtml(data);
  }

  async function printForm(kind: 'hil' | 'cabin') {
    setNote('Preparing form…');
    try {
      const { html } = kind === 'hil' ? await hilHtml(aircraftId) : await cabinLogHtml(aircraftId);
      setNote('');
      await printHtml(html);
    } catch (e: any) {
      try { const html = await localForm(kind); setNote(''); await printHtml(html); }   // offline → cached render
      catch { setNote(e.message || 'Could not load the form'); }
    }
  }
  async function printOne(kind: 'hil' | 'cabin', item: any) {
    setNote('Preparing form…');
    try {
      const { html } = kind === 'hil' ? await hilHtmlOne(item.id) : await cabinLogHtmlOne(item.id);
      setNote('');
      await printHtml(html);
    } catch (e: any) {
      try { const html = await localForm(kind, [item]); setNote(''); await printHtml(html); }   // offline → single-item render
      catch { setNote(e.message || 'Could not load the form'); }
    }
  }

  const acLabel = /^[0-9a-f-]{12,}$/i.test(aircraftId) ? aircraftId.slice(0, 8) : aircraftId;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Defects · {acLabel}</Text>
      {note ? <Text style={{ color: theme.sub, marginTop: 2, fontSize: 12 }}>{note}</Text> : null}
      <View style={styles.tabs}>
        {canTech ? <Tab id="defects" label="Defects" n={tech.length} /> : null}
        {canCabin ? <Tab id="cabin" label="Cabin" n={cabin.length} /> : null}
        {canTech ? <Tab id="hil" label="HIL" n={hil.length} /> : null}
      </View>
      {/* Report a defect from here (same options as the sector button): PIREP / MAREP / CABIN.
          Certifying staff can also open a ground-maintenance log with NO crew on board and issue the CRS. */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[styles.addBtn, { flex: 1, minWidth: 150 }]}
          onPress={() => navigation.navigate('ReportDefect', { aircraftId, ...(tab === 'cabin' ? { source: 'cabin' } : {}) })}>
          <Text style={styles.addTxt}>＋ {tab === 'cabin' ? 'Report cabin defect' : 'Report defect'}</Text>
        </TouchableOpacity>
        {can('maintenance') ? (
          <TouchableOpacity style={[styles.addBtn, { flex: 1, minWidth: 150, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]}
            onPress={() => navigation.navigate('Maintenance', { aircraftId })}>
            <Text style={styles.addTxt}>⚙ Ground maintenance · no crew (CRS)</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : data.length ? null : <Text style={styles.note}>{empty}</Text>}
      <FlatList
        data={data}
        keyExtractor={(d) => d.id}
        ListFooterComponent={tab === 'hil' || tab === 'cabin' ? (
          <TouchableOpacity style={[styles.printBtn, { marginTop: data.length ? 14 : 4 }]} onPress={() => printForm(tab === 'hil' ? 'hil' : 'cabin')}>
            <Text style={styles.printTxt}>🖨  View / Print full {tab === 'hil' ? 'Hold Item List' : 'Cabin Defect Log'} ({tab === 'cabin' ? cabin.length + clearedCabin.length : data.length})</Text>
          </TouchableOpacity>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('DefectDetail', { defectId: item.id })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dTitle}>{(item.hil_no || (item.cabin_log_seq != null ? `CABIN${String(item.cabin_log_seq).padStart(3, '0')}` : '')) ? <Text style={styles.dNo}>{item.hil_no || `${acLabel}-CABIN${String(item.cabin_log_seq).padStart(3, '0')}`}  </Text> : null}{item.title || item.description}</Text>
              <Text style={styles.dSub}>
                {item.source?.toUpperCase()} · ATA {item.ata_chapter || '—'}
                {item.captain_clearable ? ' · CAPT-clearable' : ''}
                {item.mel_ref ? ` · MEL ${item.mel_ref}` : ''}
                {item.cdl_ref ? ` · CDL ${item.cdl_ref}` : ''}
                {item.approved_ref ? ` · Approved data ${item.approved_ref}` : ''}
                {item.due_date ? ` · due ${item.due_date}` : ''}
                {item.max_fh != null ? ` · ${item.max_fh} FH` : ''}
                {item.max_cycles != null ? ` · ${item.max_cycles} FC` : ''}
              </Text>
              <Text style={styles.dDates}>
                Opened {fmtD(item.raised_at)}{item.closed_at ? `   ·   Closed ${fmtD(item.closed_at)}` : ''}
              </Text>
            </View>
            {tab === 'hil' || tab === 'cabin' ? (
              <TouchableOpacity style={styles.rowPrint} onPress={() => printOne(tab === 'hil' ? 'hil' : 'cabin', item)}>
                <Text style={styles.rowPrintTxt}>🖨 View/Print</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={[styles.status, { color: badge(item.status) }]}>{item.status}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12 },
  printBtn: { marginTop: 10, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile, alignItems: 'center' },
  printTxt: { color: theme.text, fontWeight: '700', fontSize: 13 },
  addBtn: { marginTop: 10, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.red, alignItems: 'center' },
  addTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  tab: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile },
  tabOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabTxt: { color: theme.sub, fontWeight: '700', fontSize: 13 },
  tabTxtOn: { color: '#fff' },
  note: { color: theme.sub, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderRadius: 8,
    borderWidth: 1, borderColor: theme.border, padding: 14, marginTop: 10 },
  dTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  dNo: { color: theme.accent, fontWeight: '800' },
  dSub: { color: theme.sub, fontSize: 12, marginTop: 3 },
  dDates: { color: theme.sub, fontSize: 11, marginTop: 3, fontWeight: '600' },
  rowPrint: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginHorizontal: 8 },
  rowPrintTxt: { color: theme.sub, fontWeight: '700', fontSize: 12 },
  status: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
});
