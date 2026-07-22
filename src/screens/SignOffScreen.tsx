import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appSettings, cabinLogHtml, cabinLogHtmlOne, checkHtml, clearedItems, ClearedItem, currentAircraft, defectCrsPreview, hilHtml, hilHtmlOne, oasesCheckHtml, role, sectorTlHtmlCached, SignOff, signoffsRecent } from '../api/client';
import { printHtml } from '../print';
import { theme } from '../theme';

const KIND: Record<string, string> = {
  preflight: 'Pre-flight (commander)', postflight: 'Post-flight (commander)',
  crs: 'Maintenance Release (CRS)', release: 'Maintenance Release (CRS)', defect: 'Defect action',
  di: 'Double Inspection (DI) — interim', double_inspection: 'Double Inspection (DI) — interim',
  check_2day: '2-Day Check completed', check_10day: '10-Day Check completed',
};

export default function SignOffScreen({ navigation }: any) {
  const isCabin = role() === 'cabin';                         // cabin crew see Cleared Cabin defects only
  const VIEWS: { key: 'signoffs' | 'hil' | 'cabin'; label: string }[] = isCabin
    ? [{ key: 'cabin', label: 'Cleared Cabin' }]
    : [{ key: 'signoffs', label: 'Sign-offs' }, { key: 'hil', label: 'Cleared HIL' }, { key: 'cabin', label: 'Cleared Cabin' }];
  const [view, setView] = useState<'signoffs' | 'hil' | 'cabin'>(isCabin ? 'cabin' : 'signoffs');
  const [hilItems, setHilItems] = useState<ClearedItem[] | null>(null);
  const [cabItems, setCabItems] = useState<ClearedItem[] | null>(null);
  const cleared = view === 'hil' ? hilItems : cabItems;
  const [clearedCached, setClearedCached] = useState(false);
  const [days, setDays] = useState(15);
  const [list, setList] = useState<SignOff[] | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [cached, setCached] = useState(false);
  const [cat, setCat] = useState('All');
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState('');                             // free-text search over the whole row
  const [catOpts, setCatOpts] = useState<string[]>([]);       // admin-configured categories (Settings)
  const CATS = ['All', ...catOpts, 'Others'];
  // Search any content of a row: type, tail, WO#/flight, signer, licence, defect/check summary, category, date.
  const matchQ = (g: SignOff) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const hay = `${KIND[g.kind] || g.kind} ${g.registration || ''} ${g.flight_no || ''} ${g.dep || ''} ${g.arr || ''} ${g.signer_name || ''} ${g.licence_no || ''} ${g.defects_summary || ''} ${(g as any).action_summary || ''} ${g.search_text || ''} ${g.category || ''} ${g.flight_date || ''} ${(g.signed_at || '').slice(0, 10)}`.toLowerCase();
    return s.split(/\s+/).every((w) => hay.includes(w));      // all words must match (AND)
  };
  const count = (c: string) => (list || []).filter((g) => (c === 'All' || (g.category || 'Others') === c) && matchQ(g)).length;
  const filtered = (list || []).filter((g) => (cat === 'All' ? true : (g.category || 'Others') === cat) && matchQ(g));

  const reg = currentAircraft()?.registration;
  useEffect(() => { appSettings().then((sx) => setDays(sx.signoff_view_days || 15)).catch(() => {}); }, []);
  useEffect(() => { if (isCabin) return; signoffsRecent(days, reg).then((r) => { setList(r.signoffs); setCached(!!r.cached); setCatOpts(r.categories || []); }).catch(() => setList([])); }, [days, reg]);
  // Load BOTH cleared lists up-front so every tab shows its total count.
  useEffect(() => {
    setHilItems(null); setCabItems(null);
    if (!isCabin) clearedItems('hil', days, reg).then((r) => { setHilItems(r.items); setClearedCached(!!r.cached); }).catch(() => setHilItems([]));
    clearedItems('cabin', days, reg).then((r) => { setCabItems(r.items); setClearedCached(!!r.cached); }).catch(() => setCabItems([]));
  }, [days, reg]);

  // Cleared HIL / Cabin → render the HIL or Cabin Defect Log FORM (not the CRS): date raised,
  // closed date and signed-by, in the proper logbook format. defectId = one item; omitted = all.
  async function openClearedForm(defectId?: string) {
    setMsg('');
    setOpeningId(defectId || 'all');
    try {
      const { html } = view === 'hil'
        ? (defectId ? await hilHtmlOne(defectId) : await hilHtml(reg!, days))       // "all" = only items cleared in the window (matches the list)
        : (defectId ? await cabinLogHtmlOne(defectId) : await cabinLogHtml(reg!, days));
      await printHtml(html);
    } catch (e: any) {
      setMsg(/network|connection|offline|cached/i.test(e?.message || '') ? 'Open this once online to view it offline.' : (e?.message || 'Could not open the form.'));
    } finally { setOpeningId(null); }
  }

  async function open(g: SignOff) {
    setMsg('');
    if (g.sector_id) {                                   // sector-linked (flight / maintenance-log CRS) → the Tech Log page
      setOpeningId(g.id);
      try { const { html } = await sectorTlHtmlCached(g.sector_id); await printHtml(html); }
      catch (e: any) { setMsg(e?.message?.includes('cached') || e?.message?.includes('Offline') ? 'Offline — open this Tech Log once online to make it available offline.' : (e?.message || 'Could not open the document.')); }
      finally { setOpeningId(null); }
      return;
    }
    if (g.oases_check && g.defect_id) {                  // OASES-accomplished 2/10-day check → the check task list
      setOpeningId(g.id);
      try { const { html } = await oasesCheckHtml(g.defect_id); await printHtml(html); }
      catch (e: any) { setMsg(/network|connection|offline|cached/i.test(e?.message || '') ? 'Open this once online to view it offline.' : (e?.message || 'Could not open the check.')); }
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
    if (g.check_id) {                                    // 2/10-day check → the signed check record
      setOpeningId(g.id);
      try { const { html } = await checkHtml(g.check_id); await printHtml(html); }
      catch (e: any) { setMsg(/network|connection|offline|cached/i.test(e?.message || '') ? 'Open this check once online to view it offline.' : (e?.message || 'Could not open the check.')); }
      finally { setOpeningId(null); }
      return;
    }
    setMsg('This sign-off has no printable Tech Log.');
  }
  const openable = (g: SignOff) => !!(g.sector_id || g.defect_id || g.check_id);
  const isCheck = (g: SignOff) => !!g.check_id || String(g.kind || '').startsWith('check_');

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Flight Sign Off</Text>
      <Text style={s.sub}>{reg ? `${reg} · ` : ''}last {days} days (configurable in admin).{view === 'signoffs' ? ' Tap a row to open the signed Tech Log / CRS.' : ' Cleared items — with date raised, closed date and closed-by.'}{(view === 'signoffs' ? cached : clearedCached) ? ' · Offline — cached.' : ''}</Text>

      {VIEWS.length > 1 ? (
        <View style={s.tabs}>
          {VIEWS.map((v) => (
            <TouchableOpacity key={v.key} style={[s.tab, view === v.key && s.tabOn]} onPress={() => setView(v.key)} activeOpacity={0.7}>
              <Text style={[s.tabTxt, view === v.key && s.tabTxtOn]}>{v.label}{(() => {
                const n = v.key === 'signoffs' ? list?.length : v.key === 'hil' ? hilItems?.length : cabItems?.length;
                return n == null ? '' : ` (${n})`;
              })()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {view !== 'signoffs' ? (
        cleared === null ? <ActivityIndicator style={{ marginTop: 20 }} /> :
        cleared.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>No cleared {view === 'hil' ? 'HIL items' : 'cabin defects'} in the last {days} days.</Text> :
        <>
          <TouchableOpacity style={s.previewAll} activeOpacity={0.7} disabled={openingId === 'all'} onPress={() => openClearedForm()}>
            <Text style={s.previewAllTxt}>{openingId === 'all' ? 'Opening…' : `📄  Preview all — ${view === 'hil' ? 'Hold Item List' : 'Cabin Defect Log'} (${cleared.length})`}</Text>
          </TouchableOpacity>
          {cleared.map((c) => (
          <TouchableOpacity key={c.id} style={s.row} activeOpacity={0.6} disabled={openingId === c.id} onPress={() => openClearedForm(c.id)}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>{c.ref || c.title || c.description || (view === 'hil' ? 'HIL item' : 'Cabin defect')}</Text>
              <Text style={s.meta}>ATA {c.ata_chapter || '—'}{c.mel_ref ? ` · ${view === 'hil' ? 'MEL ' : ''}${c.mel_ref}` : ''}{c.cdl_ref ? ` · CDL ${c.cdl_ref}` : ''}{c.approved_ref ? ` · Approved data ${c.approved_ref}` : ''}{c.source ? ` · ${c.source.toUpperCase()}` : ''}</Text>
              {c.description && c.ref ? <Text style={s.defs}>{c.description}</Text> : null}
              {c.action_taken ? <Text style={s.defs}>Action: {c.action_taken}</Text> : null}
              <Text style={s.meta}>Raised {c.raised_date || '—'} · Cleared {c.closed_date || '—'}{c.closed_by ? ` · by ${c.closed_by}` : ''}</Text>
              <Text style={s.open}>{openingId === c.id ? 'Opening…' : `Open ${view === 'hil' ? 'HIL' : 'Cabin Defect'} form ›`}</Text>
            </View>
          </TouchableOpacity>
          ))}
        </>
      ) : (<>

      <View style={s.searchWrap}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput style={s.search} value={q} onChangeText={setQ} placeholder="Search — WO#, check, defect, name, date…"
          placeholderTextColor={theme.sub} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
        {q ? <TouchableOpacity onPress={() => setQ('')} hitSlop={10}><Text style={s.searchClr}>✕</Text></TouchableOpacity> : null}
      </View>

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
        filtered.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>{list.length === 0 ? `No sign-offs in the last ${days} days.` : q.trim() ? `No sign-offs match “${q.trim()}”${cat !== 'All' ? ` in ${cat}` : ''}.` : `No ${cat} sign-offs in the last ${days} days.`}</Text> :
        filtered.map((g) => (
          <TouchableOpacity key={g.id} style={s.row} activeOpacity={openable(g) ? 0.6 : 1} onPress={() => open(g)} disabled={!openable(g) || openingId === g.id}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {g.kind === 'check_2day' || g.kind === 'check_10day' ? (
                  <View style={[s.chkTag, { backgroundColor: g.kind === 'check_2day' ? '#2f8f6b' : '#b5762a' }]}>
                    <Text style={s.chkTagTxt}>{g.kind === 'check_2day' ? '2-DAY' : '10-DAY'}</Text>
                  </View>
                ) : null}
                <Text style={s.k}>{KIND[g.kind] || g.kind}</Text>
              </View>
              <Text style={s.meta}>
                {g.registration || ''}{g.flight_no ? ` · ${g.flight_no}` : ''}{g.dep && g.arr ? ` · ${g.dep}→${g.arr}` : ''}{g.flight_date ? ` · ${g.flight_date}` : ''}
              </Text>
              <Text style={s.meta}>{g.signer_name || ''}{g.licence_no ? ` · ${g.licence_no}` : ''}</Text>
              {g.defects_summary ? <Text style={s.defs}>{isCheck(g) ? g.defects_summary : `Defects: ${g.defects_summary}`}</Text> : null}
              {(g.kind === 'di' || g.kind === 'double_inspection') ? <Text style={[s.defs, { color: theme.sub }]}>Interim independent check — not a release; the defect stays open until rectified or deferred.</Text> : null}
              {(g as any).action_summary ? <Text style={[s.defs, { color: theme.green }]}>✔ {(g as any).action_summary}</Text> : null}
              {openable(g) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginTop: 6 }}>
                  <Text style={s.open}>{openingId === g.id ? 'Opening…' : (isCheck(g) ? 'Tap to open the signed check ›' : 'Tap to open the signed CRS ›')}</Text>
                  {g.defect_id ? (
                    <TouchableOpacity onPress={() => navigation.navigate('DefectDetail', { defectId: g.defect_id })}>
                      <Text style={s.details}>details ›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Text style={s.when}>{(() => {
              const t = g.signed_at || '';
              // OASES imports carry a date only (midnight placeholder) — don't show a fake 00:00z time
              return t.slice(11, 16) === '00:00' ? t.slice(0, 10) : `${t.slice(0, 16).replace('T', ' ')}z`;
            })()}</Text>
          </TouchableOpacity>
        ))}
      </>)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panel },
  tabOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabTxt: { color: theme.text, fontWeight: '700', fontSize: 13 },
  tabTxtOn: { color: '#1a1300' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginTop: 10 },
  k: { color: theme.text, fontWeight: '800', fontSize: 15 },
  chkTag: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  chkTagTxt: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  defs: { color: theme.text, fontSize: 12, marginTop: 4 },
  open: { color: theme.accent, fontSize: 12, fontWeight: '700', marginTop: 6 },
  previewAll: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  previewAllTxt: { color: theme.accent, fontWeight: '800', fontSize: 14 },
  details: { color: theme.sub, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  when: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, marginTop: 12 },
  searchIcon: { color: theme.sub, fontSize: 14 },
  search: { flex: 1, color: theme.text, fontSize: 14, paddingVertical: 10 },
  searchClr: { color: theme.sub, fontSize: 15, fontWeight: '700', paddingHorizontal: 4 },
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
