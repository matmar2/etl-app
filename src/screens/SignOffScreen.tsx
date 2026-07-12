import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { appSettings, currentAircraft, defectCrsPreview, sectorTlHtmlCached, SignOff, signoffsRecent } from '../api/client';
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
  const [cat, setCat] = useState('All');
  const [pick, setPick] = useState(false);
  const [catOpts, setCatOpts] = useState<string[]>([]);       // admin-configured categories (Settings)
  const CATS = ['All', ...catOpts, 'Others'];
  const count = (c: string) => c === 'All' ? (list?.length || 0) : (list || []).filter((g) => (g.category || 'Others') === c).length;
  const filtered = (list || []).filter((g) => cat === 'All' ? true : (g.category || 'Others') === cat);

  const reg = currentAircraft()?.registration;
  useEffect(() => { appSettings().then((sx) => setDays(sx.signoff_view_days || 15)).catch(() => {}); }, []);
  useEffect(() => { signoffsRecent(days, reg).then((r) => { setList(r.signoffs); setCached(!!r.cached); setCatOpts(r.categories || []); }).catch(() => setList([])); }, [days, reg]);

  async function open(g: SignOff) {
    setMsg('');
    if (g.sector_id) {                                   // sector-linked (flight / maintenance-log CRS) → the Tech Log page
      setOpeningId(g.id);
      try { const { html } = await sectorTlHtmlCached(g.sector_id); await printHtml(html); }
      catch (e: any) { setMsg(e?.message?.includes('cached') || e?.message?.includes('Offline') ? 'Offline — open this Tech Log once online to make it available offline.' : (e?.message || 'Could not open the document.')); }
      finally { setOpeningId(null); }
      return;
    }
    if (g.defect_id) {                                   // defect-rectification CRS → render the signed CRS in standard Tech Log format
      setOpeningId(g.id);
      try { const { html } = await defectCrsPreview(g.defect_id); await printHtml(html); }
      catch (e: any) { setMsg(e?.message || 'Could not open the CRS.'); }
      finally { setOpeningId(null); }
      return;
    }
    setMsg('This sign-off has no printable Tech Log.');
  }
  const openable = (g: SignOff) => !!(g.sector_id || g.defect_id);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Flight Sign Off</Text>
      <Text style={s.sub}>{reg ? `${reg} · ` : ''}sign-offs in the last {days} days (configurable in admin). Tap a row to open the signed Tech Log / CRS.{cached ? ' · Offline — showing the last cached list.' : ''}</Text>

      <TouchableOpacity style={s.ddBtn} onPress={() => setPick((p) => !p)} activeOpacity={0.7}>
        <Text style={s.ddBtnTxt}>Category: {cat} ({count(cat)})</Text>
        <Text style={s.ddCaret}>{pick ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {pick ? (
        <View style={s.ddPanel}>
          {CATS.map((c) => (
            <TouchableOpacity key={c} style={[s.ddRow, c === cat && s.ddRowOn]} onPress={() => { setCat(c); setPick(false); }}>
              <Text style={[s.ddRowTxt, c === cat && s.ddRowTxtOn]}>{c}</Text>
              <Text style={[s.ddCount, c === cat && s.ddRowTxtOn]}>{count(c)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {msg ? <Text style={[s.sub, { color: theme.red, marginTop: 8 }]}>{msg}</Text> : null}
      {list === null ? <ActivityIndicator style={{ marginTop: 20 }} /> :
        filtered.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>{list.length === 0 ? `No sign-offs in the last ${days} days.` : `No ${cat} sign-offs in the last ${days} days.`}</Text> :
        filtered.map((g) => (
          <TouchableOpacity key={g.id} style={s.row} activeOpacity={openable(g) ? 0.6 : 1} onPress={() => open(g)} disabled={!openable(g) || openingId === g.id}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>{KIND[g.kind] || g.kind}</Text>
              <Text style={s.meta}>
                {g.registration || ''}{g.flight_no ? ` · ${g.flight_no}` : ''}{g.dep && g.arr ? ` · ${g.dep}→${g.arr}` : ''}{g.flight_date ? ` · ${g.flight_date}` : ''}
              </Text>
              <Text style={s.meta}>{g.signer_name || ''}{g.licence_no ? ` · ${g.licence_no}` : ''}</Text>
              {g.defects_summary ? <Text style={s.defs}>Defects: {g.defects_summary}</Text> : null}
              {openable(g) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginTop: 6 }}>
                  <Text style={s.open}>{openingId === g.id ? 'Opening…' : 'Tap to open the signed CRS ›'}</Text>
                  {g.defect_id ? (
                    <TouchableOpacity onPress={() => navigation.navigate('DefectDetail', { defectId: g.defect_id })}>
                      <Text style={s.details}>details ›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
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
  open: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  details: { color: theme.sub, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  when: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  ddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginTop: 12, maxWidth: 320 },
  ddBtnTxt: { color: theme.text, fontWeight: '700', fontSize: 14 },
  ddCaret: { color: theme.sub, fontSize: 14, marginLeft: 10 },
  ddPanel: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, marginTop: 6, maxWidth: 320, overflow: 'hidden' },
  ddRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  ddRowOn: { backgroundColor: theme.accent },
  ddRowTxt: { color: theme.text, fontSize: 14, fontWeight: '600' },
  ddRowTxtOn: { color: '#fff' },
  ddCount: { color: theme.sub, fontSize: 13, fontWeight: '700' },
});
