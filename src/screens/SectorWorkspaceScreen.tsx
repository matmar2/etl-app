import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { access, listActiveDefects, sectorTlHtmlCached, setTlNumber } from '../api/client';
import { getSector, pullSector } from '../db/sectors';
import { printHtml } from '../print';
import RouteMapModal from '../components/RouteMapModal';
import { theme } from '../theme';
import { hhmm } from './sectorShared';
import { fmtTl, parseTl } from '../util/tl';

export default function SectorWorkspaceScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const [s, setS] = useState<any>(null);
  const [tl, setTl] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [defs, setDefs] = useState<any[] | null>(null);   // active defects for the MAINT-log summary

  const refresh = useCallback(async () => {
    setErr('');
    try {
      const local = await getSector(sectorId);
      if (local) setS(local);                                 // show local instantly
      const row = await pullSector(sectorId);                 // then pull server-authoritative status/signatures
      if (!row) { if (!local) setErr('Sector not found.'); return; }
      setS(row);
      setTl(row.page_no ?? null);
    } catch (e: any) {
      setErr(`Could not load sector — ${e?.message || 'unknown error'}`);
    }
  }, [sectorId]);
  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);
  useEffect(() => {   // inline defects summary for ground-maintenance logs (no Preview needed)
    const isM = (s as any)?.page_kind === 'maintenance_only' || s?.flight_no === 'MAINT';
    if (s?.aircraft_id && isM) listActiveDefects(s.aircraft_id).then(setDefs).catch(() => setDefs(null));
  }, [s?.aircraft_id, s?.page_kind]);

  async function previewTl() {
    try { const { html } = await sectorTlHtmlCached(sectorId); await printHtml(html); }   // cached VAW-ETL-01 offline; fresh online
    catch (e: any) { Alert.alert('Tech Log', `Could not load the Tech Log${e?.message ? ` — ${e.message}` : ''}.\nOpen "Release & Print" for offline print options.`); }
  }

  function editTl() {
    Alert.prompt?.('Change TL #', 'Rare cases only. A skipped number is reported to the CAMO Manager.',
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Change', onPress: async (v?: string) => {
         const n = parseTl(v);
         if (!n || isNaN(n)) return;
         try { const r = await setTlNumber(sectorId, n); refresh();
           Alert.alert('TL #', r.reported_camo ? `Set to ${fmtTl(r.page_no)}. Skipped ${r.skipped.map(fmtTl).join(', ')} — reported to CAMO Manager.` : `Set to ${fmtTl(r.page_no)}.`); }
         catch (e: any) { Alert.alert('TL #', e.message); }
       } }], 'plain-text', tl ? fmtTl(tl) : '');
  }

  if (!s) return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { padding: 16 }]}>{err || 'Loading…'}</Text>
      {err ? <TouchableOpacity style={{ padding: 16 }} onPress={refresh}><Text style={{ color: theme.accent, fontWeight: '700' }}>Retry</Text></TouchableOpacity> : null}
    </View>
  );

  const depDone = !!s.off_block;
  const arrDone = s.status === 'closed' || !!s.on_block;
  const closed = s.status === 'closed' || s.status === 'exported';
  const isMaint = (s as any)?.page_kind === 'maintenance_only' || s?.flight_no === 'MAINT';   // ground maintenance log — no flight

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {!closed ? (
        <View style={styles.tlBar}>
          <Text style={styles.tlTxt}>TL # {tl != null ? fmtTl(tl) : '…'}</Text>
          <TouchableOpacity onPress={editTl}><Text style={styles.tlEdit}>Change</Text></TouchableOpacity>
        </View>
      ) : null}
      <Text style={styles.title}>{s.flight_no} · {s.dep} → {s.arr}</Text>
      <View style={styles.subRow}>
        <Text style={styles.sub}>{s.flight_date} · STD {hhmm(s.std)} · STA {hhmm(s.sta)}</Text>
        {s.dep && s.arr && s.dep !== s.arr ? (
          <TouchableOpacity onPress={() => setMapOpen(true)} hitSlop={8}><Text style={styles.mapBtn}>🗺  Map view</Text></TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.status, { color: s.status === 'closed' ? theme.green : theme.accent }]}>{(s.status || 'draft').toUpperCase()}</Text>

      <RouteMapModal visible={mapOpen} sector={s} onClose={() => setMapOpen(false)} />

      <TouchableOpacity style={styles.previewBtn} onPress={previewTl}>
        <Text style={styles.previewTxt}>⎙  Preview / print Tech Log (current info)</Text>
      </TouchableOpacity>

      {!closed ? (
        <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('ReportDefect', { sectorId, aircraftId: s.aircraft_id })}>
          <Text style={styles.reportTxt}>＋  Report defect — any time (in flight / after departure)</Text>
        </TouchableOpacity>
      ) : null}

      {isMaint ? (
        <>
        <Text style={{ color: theme.sub, fontSize: 12, marginTop: 10 }}>
          Ground maintenance log — no flight. Work the defects from the Defects page; issue the CRS and print via Release &amp; Print below.
        </Text>
        <View style={[styles.card, { marginTop: 10 }]}>
          <Text style={styles.cardTitle}>Defects on this log</Text>
          {defs === null ? <Text style={styles.cardSub}>Loading…</Text> :
           defs.length === 0 ? <Text style={styles.cardSub}>NIL — no active defects on this aircraft.</Text> :
           defs.map((d: any) => (
            <TouchableOpacity key={d.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border }}
              onPress={() => navigation.navigate('DefectDetail', { defectId: d.id })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: d.status === 'deferred' ? theme.sub : theme.red, fontWeight: '800', fontSize: 11 }}>
                  {(d.status || 'open').toUpperCase()}{d.mel_ref ? ` · ${d.mel_ref}` : ''}
                </Text>
                {d.area === 'cabin' ? <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700' }}>CABIN{d.dispatch_accepted === true ? ' · dispatch accepted' : d.dispatch_accepted === false ? ' · NOT dispatchable' : ' · decision pending'}</Text> : null}
              </View>
              <Text style={{ color: theme.text, fontSize: 13, marginTop: 2 }} numberOfLines={2}>{d.title || d.description}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.cardSub, { marginTop: 6 }]}>Cleared items appear on the printed Tech Log page (Preview above). Tap a defect to open it.</Text>
        </View>
        </>
      ) : null}

      {!isMaint ? (
      <TouchableOpacity style={[styles.card, { borderColor: depDone ? theme.green : theme.border }]} onPress={() => navigation.navigate('Departure', { sectorId })}>
        <Text style={styles.cardTitle}>Departure  ›</Text>
        <Text style={styles.cardSub}>Off-block, fuel, servicing, ice, PIREP defects, commander acceptance</Text>
        <Text style={styles.cardState}>{depDone ? `Off-block ${hhmm(s.off_block)} · uplift ${s.fuel_uplift_kg ?? '—'} kg` : 'Not started'}</Text>
      </TouchableOpacity>
      ) : null}

      {!isMaint ? (
      <TouchableOpacity style={[styles.card, { borderColor: arrDone ? theme.green : theme.border }]} onPress={() => navigation.navigate('Arrival', { sectorId })}>
        <Text style={styles.cardTitle}>After Departure closed / Arrival  ›</Text>
        <Text style={styles.cardSub}>Take-off (at brake release) / landed / on-block times, fuel, landings, MAREP defects, post-flight acceptance</Text>
        <Text style={styles.cardState}>{arrDone ? `On-block ${hhmm(s.on_block)} · ${s.status}` : 'Not started'}</Text>
      </TouchableOpacity>
      ) : null}

      {/* Hidden for roles without release access (permission-matrix driven — e.g. cabin crew). */}
      {access('release') !== 'none' ? (
        <TouchableOpacity style={[styles.card, { borderColor: s.released_at ? theme.green : theme.border }]} onPress={() => navigation.navigate('Release', { sectorId })}>
          <Text style={styles.cardTitle}>Release &amp; Print  ›</Text>
          <Text style={styles.cardSub}>Serviceability, mechanic CRS release (NIL / deferred / HIL / rectified), print or transfer the Tech Log</Text>
          <Text style={styles.cardState}>{s.released_at ? `Released ${hhmm(s.released_at)}` : 'Not released'}</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  mapBtn: { color: theme.accent, fontWeight: '800', fontSize: 13 },
  tlBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10 },
  tlTxt: { color: '#1a1300', fontWeight: '900', fontSize: 16 },
  tlEdit: { color: '#1a1300', fontWeight: '700', textDecorationLine: 'underline' },
  status: { fontWeight: '800', marginTop: 6, fontSize: 12 },
  previewBtn: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.accent, borderRadius: 10, padding: 14, marginTop: 14, alignItems: 'center' },
  previewTxt: { color: theme.accent, fontWeight: '800', fontSize: 15 },
  reportBtn: { backgroundColor: theme.red, borderRadius: 10, padding: 14, marginTop: 10, alignItems: 'center' },
  reportTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 18, marginTop: 16 },
  cardTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  cardSub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  cardState: { color: theme.text, marginTop: 10, fontWeight: '600' },
});
