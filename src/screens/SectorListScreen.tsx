import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appSettings, cacheRouteMaps, LeonFlight, leonFlights, syncPush } from '../api/client';
import { getCachedFlights, setCachedFlights } from '../db/flights';
import IcaoHint from '../components/IcaoHint';
import { createSector, dedupeSectors, deleteSector, listSectors, pullSectorList, sectorExists, Sector } from '../db/sectors';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

const REFRESH_MS = 60000;

export default function SectorListScreen({ route, navigation }: any) {
  const reg = route?.params?.aircraftId ?? 'LZ-FSA';
  const [flights, setFlights] = useState<LeonFlight[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [status, setStatus] = useState('');
  const [feed, setFeed] = useState('Loading…');
  const [manualForm, setManualForm] = useState<any | null>(null);
  const [displayN, setDisplayN] = useState(10);    // picker shows next-N; full window stays cached offline
  useEffect(() => { appSettings().then((s) => setDisplayN(s.leon_offline_flights ?? 10)).catch(() => {}); }, []);
  // "Your sectors" defaults to today; "List previous flights" opens a date range (today by default).
  const today = new Date().toISOString().slice(0, 10);
  const [histOpen, setHistOpen] = useState(false);
  const [histFrom, setHistFrom] = useState(today);
  const [histTo, setHistTo] = useState(today);

  async function refresh() {                       // instant local view
    await dedupeSectors().catch(() => {});
    setSectors(await listSectors());
  }
  const pull = useCallback(async () => {           // converge with the server (web ↔ iPad)
    setSectors(await pullSectorList(reg));
  }, [reg]);
  useFocusEffect(useCallback(() => { pull(); }, [pull]));   // re-sync whenever this screen is focused

  // Show flights "from the last 3 hours" onward — drop anything scheduled to depart
  // more than 3 h ago so old/stale flights don't clutter the list (active sectors always stay).
  const WINDOW_MS = 3 * 60 * 60 * 1000;
  const cutoff = Date.now() - WINDOW_MS;
  const startMs = (o: any): number | null => {
    let t = o?.std ?? null;
    if (!t && o?.payload) { try { t = JSON.parse(o.payload).std ?? null; } catch { /* ignore */ } }
    if (t) { const ms = Date.parse(t); return isNaN(ms) ? null : ms; }
    if (o?.flight_date) { const ms = Date.parse(`${o.flight_date}T23:59:59Z`); return isNaN(ms) ? null : ms; }  // date-only → end of day
    return null;
  };
  const inWindow = (o: any) => { const ms = startMs(o); return ms == null || ms >= cutoff; };

  // Flights that don't already have a sector started for them, in departure order.
  // The full window (up to 72 h) is cached offline; the picker shows only the next-N,
  // and later flights slide into view as the nearer ones are flown/closed.
  const started = new Set(sectors.map((s) => `${s.flight_no}|${s.flight_date}`));
  const available = flights
    .filter((f) => !started.has(`${f.flight_no}|${(f.std ?? '').slice(0, 10)}`))
    .filter(inWindow)
    .sort((a, b) => (a.std ?? '').localeCompare(b.std ?? ''))
    .slice(0, displayN);
  // Your-sectors list: default shows today's legs plus anything still in progress (never hide an
  // open sector, even from an earlier day). "List previous flights" switches to the chosen date range.
  const inProgress = (s: Sector) => !['closed', 'exported'].includes(s.status);
  const visibleSectors = histOpen
    ? sectors.filter((s) => (s.flight_date ?? '') >= histFrom && (s.flight_date ?? '') <= histTo)
    : sectors.filter((s) => s.flight_date === today || inProgress(s));
  // A flight may only be opened once the previous FLIGHT leg is closed (one open flight at a time),
  // and flights are opened in departure-time order (earliest first). A ground MAINTENANCE log is
  // independent of flight dispatch, so it never blocks opening a Leon leg.
  const isMaint = (s: Sector) => (s as any).page_kind === 'maintenance_only' || s.flight_no === 'MAINT';
  const openSector = sectors.find((s) => !isMaint(s) && !['closed', 'exported'].includes(s.status));
  const nextFlight = available[0];                       // earliest by STD

  // Try Leon when online; on success cache the full 72 h window; on failure fall back to cache.
  async function loadFlights() {
    try {
      const fresh = await leonFlights(reg);          // full offline window (Admin leon_offline_hours)
      setFlights(fresh);
      try { await setCachedFlights(reg, fresh); } catch {}
      cacheRouteMaps(fresh).catch(() => {});         // pre-cache overview route maps for offline (dedup'd)
      setFeed(`Updated ${new Date().toLocaleTimeString().slice(0, 5)} · ${fresh.length} flight(s)`);
    } catch (e: any) {
      const { flights: cached, updatedAt } = await getCachedFlights(reg).catch(() => ({ flights: [] as LeonFlight[], updatedAt: null }));
      setFlights(cached);
      setFeed(`${cached.length ? `Cached ${new Date(updatedAt!).toLocaleTimeString().slice(0, 5)}` : 'Could not load flights'}${e?.message ? ` — ${e.message}` : ''}`);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { flights: cached } = await getCachedFlights(reg);   // show cache instantly
      if (alive && cached.length) setFlights(cached);
      refresh();
      pull();
      loadFlights();
    })();
    const t = setInterval(() => { loadFlights(); pull(); }, REFRESH_MS);   // refresh flights + sectors every minute
    return () => { alive = false; clearInterval(t); };
  }, [reg]);

  async function createManual() {
    const f = manualForm || {};
    const flight_no = (f.flight_no || '').trim();
    const dep = (f.dep || '').trim().toUpperCase();
    const arr = (f.arr || '').trim().toUpperCase();
    const date = (f.date || '').trim() || new Date().toISOString().slice(0, 10);
    if (!flight_no || !dep || !arr) { setStatus('Enter flight, dep and arr.'); return; }
    if (openSector) { setStatus(`Close flight ${openSector.flight_no} before opening a new one.`); return; }
    const std = /^\d{1,2}:\d{2}$/.test(f.std || '') ? `${date}T${(f.std as string).padStart(5, '0')}:00Z` : undefined;
    const row = await createSector({ aircraft_id: reg, flight_no, flight_date: date, dep, arr, std, source: 'manual' });
    setManualForm(null); setStatus(`Sector ${flight_no} created (manual)`);
    refresh(); pull();
    navigation.navigate('Sector', { sectorId: row.id });
  }

  async function pick(f: LeonFlight) {
    const flightDate = (f.std ?? new Date().toISOString()).slice(0, 10);
    if (await sectorExists(reg, f.flight_no, flightDate)) {
      setStatus(`Sector ${f.flight_no} already started`);
      return;
    }
    if (openSector) {
      setStatus(`Close flight ${openSector.flight_no} before opening a new one.`);
      return;
    }
    if (nextFlight && f.leon_nid !== nextFlight.leon_nid) {
      setStatus(`Open flights in departure order — next is ${nextFlight.flight_no} (STD ${(nextFlight.std ?? '').slice(11, 16)}z).`);
      return;
    }
    const row = await createSector({
      aircraft_id: reg,
      flight_no: f.flight_no,
      flight_date: flightDate,
      dep: f.dep,
      arr: f.arr,
      alternate_airport: f.alternate,
      std: f.std,
      sta: f.sta,
      flight_type: f.flight_type,          // OASES nature from Leon (editable on Departure)
      cancelled: f.cancelled,
      source: 'leon',
    } as any);
    setStatus(`Sector ${f.flight_no} created from Leon`);
    refresh();
    pull();                                          // push + converge with server
    navigation.navigate('Sector', { sectorId: row.id });
  }
  async function sync() {
    try { setStatus('Syncing…'); await syncPush(); await pull(); setStatus('Server Synced ✓'); }
    catch { setStatus('Offline — queued'); }
  }

  async function removeOne(s: Sector) {
    if (!(await confirmAction(`Remove ${s.flight_no} (${s.flight_date})?`, 'Remove sector'))) return;
    try { await deleteSector(s.id); setStatus(`Removed ${s.flight_no}`); pull(); return; }
    catch (e: any) {
      if (!e?.message?.includes('409')) { setStatus(`Cannot remove — ${e.message}`); return; }
      // Released/exported records can never be deleted — don't offer a force option.
      if (!e.message.includes('Force remove')) { setStatus(`Cannot remove ${s.flight_no} — released/exported sectors cannot be deleted.`); return; }
    }
    // 409 — closed / signed. Offer a force remove.
    if (!(await confirmAction(`${s.flight_no} is closed or signed. Force‑remove it and delete its signatures? This cannot be undone.`, 'Force remove'))) return;
    try { await deleteSector(s.id, true); setStatus(`Force‑removed ${s.flight_no}`); pull(); }
    catch (e2: any) { setStatus(`Cannot remove — ${e2.message}`); }
  }
  async function clearList() {
    if (!(await confirmAction('Remove all sectors from this list? Released / closed / signed ones are kept; unsynced work on the iPad is kept.', 'Clear list'))) return;
    let cleared = 0, kept = 0;
    for (const s of visibleSectors) {
      try { await deleteSector(s.id); cleared++; } catch { kept++; }
    }
    setStatus(`Cleared ${cleared}${kept ? ` · ${kept} kept (released/signed)` : ''}`);
    pull();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>Flight Details · {reg}</Text>
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.feedHead}>
        <Text style={styles.section}>Next flights (Leon · departure order)</Text>
        <Text style={styles.feed}>{feed}</Text>
      </View>
      <TouchableOpacity onPress={() => {
        if (manualForm) { setManualForm(null); return; }
        // default the next leg's departure to the last leg's effective arrival (diversion airport if diverted)
        const last = sectors.length ? sectors.reduce((a: any, b: any) => ((b.std || b.flight_date || '') > (a.std || a.flight_date || '') ? b : a)) : null as any;
        const dep0 = last ? ((last.diverted && last.diversion_airport ? last.diversion_airport : last.arr) || '') : '';
        setManualForm({ flight_no: '', dep: dep0, arr: '', date: new Date().toISOString().slice(0, 10), std: '' });
      }}>
        <Text style={styles.manualLink}>{manualForm ? '✕ Cancel manual entry' : '＋ Add flight manually (no Leon / last‑minute change)'}</Text>
      </TouchableOpacity>
      {manualForm ? (
        <View style={styles.manualCard}>
          <Text style={styles.empty}>Enter a flight relayed by phone/radio when Leon can't update (offline). Date defaults to today.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {[['Flight *', 'flight_no', 'AH1234'], ['Dep *', 'dep', 'DAAG'], ['Arr *', 'arr', 'DAUB'], ['Date', 'date', 'YYYY-MM-DD'], ['STD (HH:MM)', 'std', '07:25']].map(([lbl, key, ph]) => (
              <View key={key} style={{ width: 150 }}>
                <Text style={styles.mlbl}>{lbl}</Text>
                <TextInput style={styles.minput} autoCapitalize="characters" value={manualForm[key] ?? ''}
                  onChangeText={(v) => setManualForm({ ...manualForm, [key]: v })} placeholder={ph} placeholderTextColor={theme.sub} />
                {key === 'dep' || key === 'arr' ? <IcaoHint code={manualForm[key]} /> : null}
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.manualBtn} onPress={createManual}><Text style={styles.manualBtnTxt}>Create sector &amp; open</Text></TouchableOpacity>
        </View>
      ) : null}
      {openSector ? (
        <Text style={styles.blocked}>Close flight {openSector.flight_no} before opening the next one.</Text>
      ) : null}
      {available.length === 0 ? <Text style={styles.empty}>{flights.length ? 'All flights started.' : `No upcoming flights for ${reg}.`}</Text> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
          {available.map((item) => {
            const openable = !openSector && nextFlight?.leon_nid === item.leon_nid;
            return (
              <TouchableOpacity key={String(item.leon_nid)} style={[styles.flightCard, !openable && styles.flightCardLocked]} onPress={() => pick(item)} activeOpacity={0.8}>
                <Text style={styles.flightNo}>{item.flight_no}{item.airborne ? ' ✈' : ''}</Text>
                <Text style={styles.route}>{item.dep} → {item.arr}</Text>
                <Text style={styles.meta}>{item.std?.slice(0, 10)}</Text>
                <Text style={styles.meta}>STD {item.std?.slice(11, 16)}z · STA {item.sta?.slice(11, 16)}z</Text>
                <Text style={styles.meta}>{item.commander}</Text>
                <Text style={[styles.tap, !openable && { color: theme.sub }]}>{openable ? 'tap to start sector' : (openSector ? 'close current first' : 'opens after earlier flight')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.feedHead}>
        <Text style={styles.section}>Your sectors · {histOpen ? `${histFrom} → ${histTo}` : 'today'}</Text>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'baseline' }}>
          <TouchableOpacity onPress={() => { setHistOpen(!histOpen); if (!histOpen) { setHistFrom(today); setHistTo(today); } }}>
            <Text style={styles.histLink}>{histOpen ? '✕ Back to today' : '🗓 List previous flights'}</Text>
          </TouchableOpacity>
          {!histOpen && visibleSectors.length ? <TouchableOpacity onPress={clearList}><Text style={styles.clear}>Clear list</Text></TouchableOpacity> : null}
        </View>
      </View>
      {histOpen ? (
        <View style={styles.histCard}>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <View style={{ width: 150 }}>
              <Text style={styles.mlbl}>From</Text>
              <TextInput style={styles.minput} value={histFrom} onChangeText={setHistFrom} placeholder="YYYY-MM-DD" placeholderTextColor={theme.sub} autoCapitalize="none" />
            </View>
            <View style={{ width: 150 }}>
              <Text style={styles.mlbl}>To</Text>
              <TextInput style={styles.minput} value={histTo} onChangeText={setHistTo} placeholder="YYYY-MM-DD" placeholderTextColor={theme.sub} autoCapitalize="none" />
            </View>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([lbl, back]) => (
                <TouchableOpacity key={String(lbl)} style={styles.preset}
                  onPress={() => { const to = today; const d = new Date(); d.setDate(d.getDate() - (back as number)); setHistFrom(d.toISOString().slice(0, 10)); setHistTo(to); }}>
                  <Text style={styles.presetTxt}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={[styles.feed, { marginTop: 8 }]}>{visibleSectors.length} flight(s) in range · released &amp; closed Tech Logs are kept on the server and always reappear here.</Text>
        </View>
      ) : null}
      {visibleSectors.length === 0 ? <Text style={styles.empty}>{histOpen ? 'No flights in this date range.' : 'No flights today — pick a flight above.'}</Text> : visibleSectors.map((item) => (
        <View key={item.id} style={styles.row}>
          <TouchableOpacity style={styles.rowOpen} onPress={() => navigation.navigate('Sector', { sectorId: item.id })} onLongPress={() => removeOne(item)}>
            <Text style={styles.rowFlight}>{item.flight_no}</Text>
            <Text style={styles.rowRoute}>{item.dep} → {item.arr}</Text>
            <Text style={styles.rowMeta}>{item.flight_date}</Text>
            <Text style={[styles.badge, item.status === 'signed' && styles.signed]}>{item.status}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeOne(item)} hitSlop={10} style={styles.delBtn}><Text style={styles.del}>✕</Text></TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  status: { color: '#9fd', marginTop: 6 },
  section: { color: theme.sub, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  feedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  feed: { color: theme.sub, fontSize: 11 },
  empty: { color: theme.sub },
  flightCard: { backgroundColor: theme.tile, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, marginRight: 10, width: 160 },
  flightCardLocked: { opacity: 0.45 },
  blocked: { color: theme.red, marginBottom: 8, fontSize: 13 },
  flightNo: { color: theme.text, fontWeight: '800', fontSize: 16 },
  route: { color: '#cde', marginTop: 2 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  tap: { color: theme.accent, fontSize: 11, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, marginTop: 8 },
  rowOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 4 },
  delBtn: { paddingVertical: 6, paddingHorizontal: 12, marginLeft: 6 },
  rowFlight: { color: theme.text, fontWeight: '700', width: 70 },
  rowRoute: { color: '#cde', flex: 1 },
  rowMeta: { color: theme.sub, fontSize: 12 },
  clear: { color: theme.red, fontWeight: '700', fontSize: 13 },
  histLink: { color: theme.accent, fontWeight: '700', fontSize: 13 },
  histCard: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  preset: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  presetTxt: { color: theme.text, fontSize: 12, fontWeight: '700' },
  del: { color: theme.sub, fontSize: 16, paddingLeft: 10 },
  badge: { color: theme.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  signed: { color: theme.green },
  manualLink: { color: theme.accent, fontWeight: '700', fontSize: 13, marginTop: 6 },
  manualCard: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  mlbl: { color: theme.sub, fontSize: 11, marginBottom: 4 },
  minput: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 },
  manualBtn: { backgroundColor: theme.accent, borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 10 },
  manualBtnTxt: { color: '#1a1300', fontWeight: '800' },
});
