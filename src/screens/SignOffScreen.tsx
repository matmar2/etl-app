import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { appSettings, sectorTlHtmlCached, SignOff, signoffsRecent } from '../api/client';
import { printHtml } from '../print';
import { theme } from '../theme';

const KIND: Record<string, string> = {
  preflight: 'Pre-flight (commander)', postflight: 'Post-flight (commander)',
  crs: 'Maintenance Release (CRS)', release: 'Maintenance Release (CRS)', defect: 'Defect action',
};

export default function SignOffScreen({ navigation }: any) {
  const [days, setDays] = useState(15);
  const [list, setList] = useState<SignOff[] | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [cached, setCached] = useState(false);

  useEffect(() => { appSettings().then((sx) => setDays(sx.signoff_view_days || 15)).catch(() => {}); }, []);
  useEffect(() => { signoffsRecent(days).then((r) => { setList(r.signoffs); setCached(!!r.cached); }).catch(() => setList([])); }, [days]);

  async function open(g: SignOff) {
    setMsg('');
    if (g.sector_id) {                                   // sector-linked (flight / maintenance-log CRS) → the Tech Log page
      setOpeningId(g.id);
      try { const { html } = await sectorTlHtmlCached(g.sector_id); await printHtml(html); }
      catch (e: any) { setMsg(e?.message?.includes('cached') || e?.message?.includes('Offline') ? 'Offline — open this Tech Log once online to make it available offline.' : (e?.message || 'Could not open the document.')); }
      finally { setOpeningId(null); }
      return;
    }
    if (g.defect_id) {                                   // defect-rectification CRS (no sector) → open the defect + its CRS
      navigation.navigate('DefectDetail', { defectId: g.defect_id });
      return;
    }
    setMsg('This sign-off has no printable Tech Log.');
  }
  const openable = (g: SignOff) => !!(g.sector_id || g.defect_id);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Flight Sign Off</Text>
      <Text style={s.sub}>Sign-offs recorded in the last {days} days (configurable in admin). Tap a row to open the signed Tech Log / CRS.{cached ? ' · Offline — showing the last cached list.' : ''}</Text>
      {msg ? <Text style={[s.sub, { color: theme.red, marginTop: 8 }]}>{msg}</Text> : null}
      {list === null ? <ActivityIndicator style={{ marginTop: 20 }} /> :
        list.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>No sign-offs in the last {days} days.</Text> :
        list.map((g) => (
          <TouchableOpacity key={g.id} style={s.row} activeOpacity={openable(g) ? 0.6 : 1} onPress={() => open(g)} disabled={!openable(g) || openingId === g.id}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>{KIND[g.kind] || g.kind}</Text>
              <Text style={s.meta}>
                {g.registration || ''}{g.flight_no ? ` · ${g.flight_no}` : ''}{g.dep && g.arr ? ` · ${g.dep}→${g.arr}` : ''}{g.flight_date ? ` · ${g.flight_date}` : ''}
              </Text>
              <Text style={s.meta}>{g.signer_name || ''}{g.licence_no ? ` · ${g.licence_no}` : ''}</Text>
              {g.defects_summary ? <Text style={s.defs}>Defects: {g.defects_summary}</Text> : null}
              {openable(g) ? <Text style={s.open}>{openingId === g.id ? 'Opening…' : (g.sector_id ? 'Tap to open signed Tech Log / CRS ›' : 'Tap to open the defect & CRS ›')}</Text> : null}
            </View>
            <Text style={s.when}>{g.signed_at?.slice(0, 16).replace('T', ' ')}z</Text>
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginTop: 10 },
  k: { color: theme.text, fontWeight: '800', fontSize: 15 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  defs: { color: theme.text, fontSize: 12, marginTop: 4 },
  open: { color: theme.accent, fontSize: 12, fontWeight: '700', marginTop: 6 },
  when: { color: theme.accent, fontSize: 12, fontWeight: '700' },
});
