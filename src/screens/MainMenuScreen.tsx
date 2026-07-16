import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import ClockBanner from '../components/ClockBanner';
import HeaderLogo from '../components/HeaderLogo';
import DeviceRegisterGate from '../components/DeviceRegisterGate';
import OnlineStatus from '../components/OnlineStatus';
import { pokeBroadcasts } from '../components/BroadcastGate';
import { openInduction, pokeInduction } from '../components/InductionGate';
import { access, AircraftStatus, aircraftStatus, aircraftUtilisation, appRelease, CheckStatus, currentAircraft, deviceId, documentsList, Fleet, fleetList, flushBroadcastAcks, flushInductionAcks, flushFeedback, inductionExists, leonFlights, listActiveDefects, listHIL, loadCurrentAircraft, loadPermissions, logout, pendingSyncCount, prefetchAircraftDefects, prepareOffline, publicConfig, refreshReference, roleLabel, serverReachable, setCurrentAircraft, signoffsRecent, syncPush, userName, Utilisation } from '../api/client';
import { theme } from '../theme';
import { fmt, fmtHM } from './sectorShared';
import { confirmAction } from '../util/confirm';

type Tile = { key: string; title: string; sub?: string; nav?: string; perm?: string; icon: string; group: string; tint: string };
const TILES: Tile[] = [
  { key: 'flight', title: 'Flight Details', sub: 'Leon · today', nav: 'Sectors', icon: '✈️', group: 'Operations', tint: '#3d9be0' },
  { key: 'defects', title: 'Defects', sub: 'PIREP / MAREP / HIL', nav: 'Defects', icon: '🔧', group: 'Operations', tint: theme.accent },
  { key: 'signoff', title: 'Flight Sign Off', sub: 'Recent sign-offs', nav: 'SignOff', icon: '🖊️', group: 'Operations', tint: theme.red },
  { key: 'planned', title: 'Planned Maint.', sub: '2-Day / 10-Day checks', nav: 'Planned', perm: 'checks', icon: '🛠️', group: 'Maintenance', tint: theme.green },
  { key: 'maint', title: 'Maintenance', sub: 'Ground · no crew (CRS)', nav: 'Maintenance', perm: 'maintenance', icon: '⚙️', group: 'Maintenance', tint: theme.green },
  { key: 'docs', title: 'Documents', sub: 'Controlled documents', nav: 'Documents', icon: '📄', group: 'Documents & forms', tint: '#5a8bd0' },
  { key: 'forms', title: 'Forms', sub: 'Role forms to fill', nav: 'Forms', icon: '📝', group: 'Documents & forms', tint: '#5a8bd0' },
  { key: 'induction', title: 'Welcome & Quick Ref', sub: 'Your role induction', nav: '', icon: '👋', group: 'Help & feedback', tint: '#9b8cf0' },
  { key: 'guide', title: 'User Guide', sub: 'How to use the app', nav: 'Guide', icon: '📖', group: 'Help & feedback', tint: '#9b8cf0' },
  { key: 'assistant', title: 'AI Assistant', sub: 'Ask · works offline', nav: 'Assistant', icon: '🤖', group: 'Help & feedback', tint: '#9b8cf0' },
  { key: 'feedback', title: 'Feedback', sub: 'Report a bug / idea', nav: 'Feedback', icon: '💬', group: 'Help & feedback', tint: '#9b8cf0' },
  { key: 'master', title: 'Master iPad', sub: 'Sync priority · Captain', nav: 'MasterDevice', icon: '📲', group: 'Help & feedback', tint: '#9b8cf0' },
];
const GROUPS = ['Operations', 'Maintenance', 'Documents & forms', 'Help & feedback'];

// Offline prep survives navigation: progress + state live at module scope (not gated by the
// screen being focused), so leaving the menu never stops it and returning shows it resuming.
let _offlineDone = false;                   // fully cached this app session (don't re-run)
let _offlineRunning = false;                // a prep pass is in flight
let _offlineProg: { frac: number; label: string } | null = null;   // last emitted progress
let _offlineListener: ((p: { frac: number; label: string } | null) => void) | null = null;
function _emitOffline(p: { frac: number; label: string } | null) { _offlineProg = p; if (_offlineListener) _offlineListener(p); }

// Cache everything needed for offline use, with a visible progress bar. Runs to completion in the
// background even if the user navigates away; only marks done when it actually finishes, so an
// interruption (or offline moment) auto-resumes next focus — or via the box's Resume button.
async function runOfflinePrep(reg?: string) {
  if (_offlineDone || _offlineRunning || !reg) return;
  if (require('react-native').Platform.OS === 'web') return;        // web is always online
  _offlineRunning = true;
  try {
    if (!(await serverReachable())) { _offlineRunning = false; return; }   // offline now → retry next focus
    await prepareOffline(reg, (frac, label) => _emitOffline({ frac, label }));
    _offlineDone = true;
    _emitOffline({ frac: 1, label: 'Ready for offline' });
    setTimeout(() => { if (_offlineDone) _emitOffline(null); }, 2500);
  } catch { /* leave _offlineDone false so it resumes */ }
  finally { _offlineRunning = false; }
}

let _loginUpdateNoticeShown = false;       // login "please update" pop-up — once per app session

function fmtLeft(c: CheckStatus): string {
  if (!c.baseline) return 'not recorded';
  if (!c.due) return c.expired ? 'OVERDUE' : '—';
  const ms = new Date(c.due).getTime() - Date.now();
  if (ms <= 0) return 'OVERDUE';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return (d > 0 ? `${d}d ` : '') + `${h}h ${m}m left`;
}

export default function MainMenuScreen({ navigation }: any) {
  const [st, setSt] = useState<AircraftStatus | null>(null);
  const [util, setUtil] = useState<Utilisation | null>(null);
  const [testing, setTesting] = useState(false);
  const [hasInduction, setHasInduction] = useState<boolean | null>(null);   // null = unknown (show); false = hide the tile (admin/CAMO)
  const [ac, setAc] = useState<Fleet | null>(currentAircraft());
  const [fleet, setFleet] = useState<Fleet[]>([]);
  const [pick, setPick] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [ver, setVer] = useState<{ revision: string | null; approved_at?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [offlineProg, setOfflineProg] = useState<{ frac: number; label: string } | null>(_offlineProg);

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try { await syncPush().catch(() => {}); const n = await pendingSyncCount(); setPending(n); }
    finally { setSyncing(false); }
  }

  function versionLabel() {
    const rev = ver?.revision || (Constants.expoConfig as any)?.version || '—';
    const d = ver?.approved_at ? new Date(ver.approved_at) : null;
    const date = d && !isNaN(d.getTime())
      ? ` · ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
      : '';
    return `Version ${rev}${date}`;
  }

  // The TRUTH about which JS bundle is actually running (independent of the release-governance
  // revision above). Shows the live OTA publish date so you can confirm an update landed. Rendered
  // on its own line below the version. Returns '' when there is nothing to show.
  function otaLine() {
    try {
      if (!Updates.isEnabled) return '';
      if (Updates.isEmbeddedLaunch) return 'built-in';
      const c: any = Updates.createdAt;
      const cd = c ? new Date(c) : null;
      if (!cd || isNaN(cd.getTime())) return '';
      return `OTA ${String(cd.getUTCDate()).padStart(2, '0')}/${String(cd.getUTCMonth() + 1).padStart(2, '0')} ${String(cd.getUTCHours()).padStart(2, '0')}:${String(cd.getUTCMinutes()).padStart(2, '0')}z`;
    } catch { return ''; }
  }

  const [checking, setChecking] = useState(false);
  // Light the star for BOTH states: a new OTA available to download, AND one already downloaded and
  // pending a restart. expo auto-downloads on launch, so crew almost always land in the "pending"
  // case — without it the star would essentially never show (the manual check finds nothing waiting).
  const upd = Updates.useUpdates();
  const updateAvail = Updates.isEnabled && (upd.isUpdateAvailable || upd.isUpdatePending);
  // Which channel/runtimeVersion THIS installed build listens on. An OTA only reaches it (and only
  // then does the red star light) when it's published to this exact channel at this runtimeVersion.
  function otaDiag() {
    try {
      const ch = (Updates as any).channel || '—';
      const rv = (Updates as any).runtimeVersion || '—';
      const id = (Updates.updateId || '').slice(0, 8) || (Updates.isEmbeddedLaunch ? 'built-in' : '—');
      return `\n\nBuild channel: ${ch}\nRuntime version: ${rv}\nRunning bundle: ${id}`;
    } catch { return ''; }
  }
  // Updates.reloadAsync() proved UNRELIABLE on this iOS build — it hard-crashed the app more than
  // once, even when deferred until after the confirm dialog dismissed. So we do NOT reload in-app.
  // The update is downloaded and applied on the next FRESH launch; close-and-reopen is 100% reliable
  // and the session persists (Keychain), so the user comes back signed in. (Slower than a seamless
  // reload, but crash-proof — reliability wins.)
  const READY_MSG = 'Update downloaded ✓\n\nTo finish, FULLY CLOSE the app — open the app switcher and flick the ETL card up and off the screen (just going to the Home screen is NOT enough), then reopen ETL. You stay signed in.';
  async function checkForUpdate() {
    if (checking) return;
    if (!Updates.isEnabled) { await confirmAction('Live updates are not enabled in this build (dev/web).', 'Updates'); return; }
    if (upd.isUpdatePending) { await confirmAction(READY_MSG, 'Update ready'); return; }   // already downloaded → just reopen
    setChecking(true);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable) {
        await Updates.fetchUpdateAsync();   // download; it applies on the next fresh launch
        await confirmAction(READY_MSG, 'Update ready');
      } else {
        await confirmAction(`You are already on the latest published version.${otaDiag()}`, 'Up to date');
      }
    } catch (e: any) {
      const offline = !(await serverReachable(4000).catch(() => false));
      await confirmAction(offline
        ? `You appear to be OFFLINE. Checking for a new app version needs an internet connection — connect to Wi-Fi and try again. (Your work keeps syncing separately.)${otaDiag()}`
        : `Could not check for updates: ${e?.message || 'unknown error'}. Try again in a moment.${otaDiag()}`,
        offline ? 'Offline — can’t check now' : 'Update check failed');
    } finally { setChecking(false); }
  }

  // On login, tell the user which bundle this iPad is running and — if a newer version is
  // waiting — remind them to update. Once per app session, shortly after the menu appears.
  useEffect(() => {
    if (_loginUpdateNoticeShown || !Updates.isEnabled) return;
    const t = setTimeout(async () => {
      if (_loginUpdateNoticeShown) return;
      _loginUpdateNoticeShown = true;
      let avail = upd.isUpdateAvailable || upd.isUpdatePending;
      if (!avail) { try { avail = (await Updates.checkForUpdateAsync()).isAvailable; } catch { /* offline */ } }
      if (!avail) return;                                   // up to date → no interruption
      const bundle = (Constants.expoConfig as any)?.extra?.commit || '—';
      const msg = `A newer version of the ETL is available.\n\nThis iPad is running Bundle ${bundle}. To get the latest, tap "⇩ Update" at the top of the menu, then FULLY close and reopen the app — you stay signed in.`;
      if (await confirmAction(msg, 'Please update the app')) checkForUpdate();
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  function loadCounts(reg: string) {
    return Promise.all([
      Promise.all([listActiveDefects(reg).catch(() => []), listHIL(reg).catch(() => [])])
        .then(([a, h]) => setCounts((c) => ({ ...c, defects: `${a.length} active${h.length ? ` · ${h.length} HIL` : ''}` }))),
      leonFlights(reg).then((f) => setCounts((c) => ({ ...c, flight: `${f.length} flight(s)` }))).catch(() => {}),
      documentsList('document').then((d) => setCounts((c) => ({ ...c, docs: `${d.length} document(s)` }))).catch(() => {}),
      documentsList('form').then((d) => setCounts((c) => ({ ...c, forms: `${d.length} form(s)` }))).catch(() => {}),
      signoffsRecent(15, reg).then((r) => setCounts((c) => ({ ...c, signoff: `${r.signoffs.length} in 15 days` }))).catch(() => {}),
    ]);
  }

  // Reload everything the menu shows (fleet, aircraft status/utilisation, check + defect counts,
  // permissions, reference cache, version). Used on focus and by the manual Refresh button.
  const reload = useCallback(async (isAlive: () => boolean = () => true) => {
    let cur = await loadCurrentAircraft();
    const list = await fleetList().catch(() => [] as Fleet[]);
    if (!isAlive()) return;
    setFleet(list);
    if (!cur && list.length) { cur = list[0]; await setCurrentAircraft(cur); }
    setAc(cur);
    runOfflinePrep(cur?.registration);         // background offline download (survives navigation, auto-resumes)
    pokeBroadcasts();                                // check for admin pop-ups now (immediate on login)
    pokeInduction();                                 // check for the role induction (email + PPTX) on login
    inductionExists().then((v) => { if (isAlive()) setHasInduction(v); }).catch(() => {});   // hide the tile for roles with no induction (admin/CAMO)
    const jobs: Promise<any>[] = [
      flushBroadcastAcks().catch(() => {}),          // send any broadcast acks made while offline
      flushInductionAcks().catch(() => {}),          // send any induction acks made while offline
      publicConfig().then((c) => { if (isAlive()) setTesting(!!c.testing_mode); }).catch(() => {}),
      Promise.resolve(loadPermissions()).catch(() => {}),
      Promise.resolve(refreshReference()).catch(() => {}),
      flushFeedback().catch(() => {}),               // send any feedback queued while offline
      deviceId().then((d) => appRelease(d)).then((r) => { if (isAlive()) setVer(r); }).catch(() => {}),
      Promise.resolve().then(() => (Updates.isEnabled ? Updates.checkForUpdateAsync() : null)).catch(() => {}),   // probe; the useUpdates() hook drives the star (available OR downloaded-pending)
    ];
    if (cur) jobs.push(
      aircraftStatus(cur.registration).then((s) => { if (isAlive()) setSt(s); }).catch(() => { if (isAlive()) setSt(null); }),
      aircraftUtilisation(cur.registration).then((u) => { if (isAlive()) setUtil(u); }).catch(() => { if (isAlive()) setUtil(null); }),
      loadCounts(cur.registration),
      prefetchAircraftDefects(cur.registration),      // warm the offline defect cache for this tail
    );
    await Promise.all(jobs);
    pendingSyncCount().then((n) => { if (isAlive()) setPending(n); }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    _offlineListener = (p) => { if (alive) setOfflineProg(p); };   // reflect prep progress while focused
    setOfflineProg(_offlineProg);                                  // show current progress on (re)entry
    runOfflinePrep(currentAircraft()?.registration);               // start/continue immediately (independent of reload)
    reload(() => alive);
    return () => { alive = false; _offlineListener = null; };      // unsubscribe UI, but never stop the prep
  }, [reload]));

  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await reload(); setRefreshedAt(new Date().toLocaleTimeString().slice(0, 5)); }
    finally { setRefreshing(false); }
  }

  async function choose(a: Fleet) {
    await setCurrentAircraft(a); setAc(a); setPick(false); setSt(null); setUtil(null); setCounts({});
    aircraftStatus(a.registration).then(setSt).catch(() => setSt(null));
    aircraftUtilisation(a.registration).then(setUtil).catch(() => setUtil(null));
    loadCounts(a.registration);
    prefetchAircraftDefects(a.registration).catch(() => {});   // warm this tail's defects (incl. OASES-imported) for offline
  }

  async function signOut() {
    if (!(await confirmAction('Before leaving the aircraft, confirm:\n\n•  all flight-crew iPads are synced\n•  the tech log is backed up to the server\n\nSign out of the Electronic Tech Log on this device?', 'Sign out'))) return;
    await logout();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  const reg = ac?.registration ?? '—';
  const ok = !!st?.serviceable;

  return (
    <View style={styles.wrap}>
      {/* top bar */}
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 }}>
          <View style={{ marginRight: 10 }}><HeaderLogo /></View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.appName}>Electronic Tech Log</Text>
            {userName() ? <Text style={styles.appUser}>{userName()}{roleLabel() ? ` · ${roleLabel()}` : ''}</Text> : null}
            <Text style={styles.appVer} numberOfLines={2}>{versionLabel()}{otaLine() ? ` · ${otaLine()}` : ''}{refreshedAt ? ` · updated ${refreshedAt}` : ''}</Text>
            {(Constants.expoConfig as any)?.extra?.commit ? <Text style={styles.appVer}>Bundle {(Constants.expoConfig as any).extra.commit}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <OnlineStatus />
          <TouchableOpacity onPress={manualRefresh} disabled={refreshing} style={[styles.refreshBtn, refreshing && { opacity: 0.6 }]}>
            {refreshing ? <ActivityIndicator size="small" color={theme.accent} /> : <Text style={styles.refreshTxt}>⟳ Refresh</Text>}
          </TouchableOpacity>
          <View>
            <TouchableOpacity onPress={checkForUpdate} disabled={checking} style={[styles.updateBtn, checking && { opacity: 0.6 }]}>
              {checking ? <ActivityIndicator size="small" color="#1a1300" /> : <Text style={styles.updateTxt}>⇩ Update</Text>}
            </TouchableOpacity>
            {updateAvail && !checking ? <View style={styles.updateBadge} /> : null}
          </View>
          <TouchableOpacity onPress={signOut} style={styles.signOut}><Text style={styles.signOutTxt}>⎋ Sign out</Text></TouchableOpacity>
        </View>
      </View>

      <DeviceRegisterGate />

      {pending > 0 ? (
        <TouchableOpacity onPress={syncNow} disabled={syncing} style={styles.pendingBar}>
          <Text style={styles.pendingBarTxt}>{syncing ? 'Syncing…' : `⇅ ${pending} change${pending === 1 ? '' : 's'} to sync — tap to sync now`}</Text>
        </TouchableOpacity>
      ) : null}

      {testing ? (
        <View style={styles.testBanner}>
          <Text style={styles.testTxt}>⚠ TESTING MODE — MFA code 123456 · tap “Switch aircraft” to change tail. Off at go-live.</Text>
        </View>
      ) : null}

      {offlineProg ? (() => {
        const done = offlineProg.frac >= 1;
        const pct = Math.round(offlineProg.frac * 100);
        return (
          <View style={[styles.offCard, done && { borderColor: theme.green }]}>
            <View style={styles.offHead}>
              <Text style={[styles.offTitle, done && { color: theme.green }]}>{done ? '✓ Ready for offline use' : 'Preparing offline data…'}</Text>
              <Text style={styles.offPct}>{pct}%</Text>
            </View>
            <View style={styles.offTrack}><View style={[styles.offFill, { width: `${pct}%` }, done && { backgroundColor: theme.green }]} /></View>
            <View style={styles.offFoot}>
              <Text style={[styles.offLabel, { flex: 1 }]}>{done ? 'Pickers, schedule, defects and maps are on this iPad. (AMM instructions open online only.)' : offlineProg.label}</Text>
              {!done ? (
                <TouchableOpacity style={styles.offResume} onPress={() => runOfflinePrep(currentAircraft()?.registration)}>
                  <Text style={styles.offResumeTxt}>↻ Resume</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })() : null}

      <ClockBanner />
      {/* aircraft + serviceability hero */}
      <View style={[styles.hero, { borderColor: st ? (ok ? theme.green : theme.red) : theme.border }]}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.heroReg}>{reg}</Text>
            <Text style={styles.heroType}>{ac?.type ?? '—'}{ac?.msn ? `   ·   MSN ${ac.msn}` : ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            {st ? (
              <View style={[styles.svcPill, { backgroundColor: ok ? 'rgba(124,179,66,0.15)' : 'rgba(217,83,79,0.18)', borderColor: ok ? theme.green : theme.red }]}>
                <Text style={[styles.svcTxt, { color: ok ? theme.green : theme.red }]}>{ok ? '● SERVICEABLE' : '▲ UNSERVICEABLE'}</Text>
              </View>
            ) : <Text style={styles.heroType}>checking…</Text>}
            <View style={{ position: 'relative', zIndex: 50 }}>
              <TouchableOpacity style={[styles.acChip, testing && styles.acChipTest]} disabled={!testing} onPress={() => setPick((p) => !p)}>
                <Text style={styles.acChipTxt}>{testing ? `Switch aircraft  ${pick ? '▴' : '▾'}` : (ac?.type ?? '')}</Text>
              </TouchableOpacity>
              {pick ? (
                <View style={styles.dropdown}>
                  <ScrollView style={{ maxHeight: 264 }} keyboardShouldPersistTaps="handled">
                    {fleet.map((a) => (
                      <TouchableOpacity key={a.registration} style={[styles.ddRow, a.registration === reg && styles.ddRowOn]} onPress={() => choose(a)}>
                        <Text style={styles.ddReg}>{a.registration}</Text>
                        <Text style={styles.ddSub}>{a.type}{a.msn ? ` · MSN ${a.msn}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        {st?.reasons?.length ? <Text style={styles.heroReason}>{st.reasons.join('   ·   ')}</Text> : null}
        {(st?.checks?.length || util) ? (
          <View style={styles.checks}>
            {(st?.checks || []).map((c) => (
              <View key={c.kind} style={styles.checkPill}>
                <Text style={styles.checkLbl}>{c.label}</Text>
                <Text style={[styles.checkVal, { color: c.expired ? theme.red : c.baseline ? theme.green : theme.sub }]}>{fmtLeft(c)}</Text>
              </View>
            ))}
            {util ? (
              <>
                {(() => {
                  const src = util.camo?.tsn != null ? 'OASES' : util.baseline ? String(util.baseline.source || 'Leon').split(' ')[0] : 'ETL';
                  return (
                    <>
                      <View style={styles.checkPill}>
                        <Text style={styles.checkLbl}>TSN · h:mm ({src})</Text>
                        <Text style={[styles.checkVal, { color: theme.text }]}>{fmtHM(util.camo?.tsn ?? util.etl?.tsn_fh)}</Text>
                      </View>
                      <View style={styles.checkPill}>
                        <Text style={styles.checkLbl}>CSN · FC ({src})</Text>
                        <Text style={[styles.checkVal, { color: theme.text }]}>{fmt((util.camo?.csn ?? util.etl?.csn_fc)) || '—'}</Text>
                      </View>
                    </>
                  );
                })()}
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* grouped tiles */}
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {GROUPS.map((g) => {
          const tiles = TILES.filter((t) => t.group === g && (!t.perm || access(t.perm) !== 'none')
            && (t.key !== 'induction' || hasInduction !== false));   // hide Welcome & Quick Ref when the role has no induction
          if (!tiles.length) return null;
          return (
            <View key={g} style={{ marginTop: 18 }}>
              <Text style={styles.section}>{g.toUpperCase()}</Text>
              <View style={styles.grid}>
                {tiles.map((t) => (
                  <TouchableOpacity key={t.key} activeOpacity={0.85} style={styles.card}
                    onPress={() => t.key === 'induction' ? openInduction() : (t.nav && navigation.navigate(t.nav, { aircraftId: ac?.registration ?? 'LZ-FSA' }))}>
                    <View style={[styles.iconBox, { backgroundColor: t.tint + '22', borderColor: t.tint + '66' }]}>
                      <Text style={styles.icon}>{t.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{t.title}</Text>
                      <Text style={[styles.cardSub, (t.key !== 'induction' && counts[t.key]) ? { color: theme.text, fontWeight: '700' } : null]} numberOfLines={1}>
                        {t.key === 'induction'
                          ? (['Administrator', 'CAMO'].includes(roleLabel()) ? `${roleLabel()} · Application Overview` : `${roleLabel()} · Quick Reference`)
                          : (counts[t.key] ?? t.sub ?? '')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 18, paddingTop: 16 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appName: { color: theme.text, fontSize: 21, fontWeight: '800', letterSpacing: 0.3 },
  appUser: { color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
  appVer: { color: theme.sub, fontSize: 11, marginTop: 2 },
  signOut: { borderWidth: 1, borderColor: theme.border, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 13 },
  signOutTxt: { color: theme.sub, fontWeight: '700', fontSize: 13 },
  refreshBtn: { borderWidth: 1, borderColor: theme.accent, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 13, minWidth: 88, alignItems: 'center' },
  refreshTxt: { color: theme.accent, fontWeight: '700', fontSize: 13 },
  updateBtn: { backgroundColor: theme.accent, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 13, minWidth: 82, alignItems: 'center' },
  updateTxt: { color: '#1a1300', fontWeight: '800', fontSize: 13 },
  updateBadge: { position: 'absolute', top: -4, right: -4, width: 13, height: 13, borderRadius: 7, backgroundColor: theme.red, borderWidth: 2, borderColor: theme.bg },
  pendingBar: { backgroundColor: '#B45309', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12 },
  pendingBarTxt: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  offCard: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12 },
  offHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  offTitle: { color: theme.text, fontWeight: '800', fontSize: 13 },
  offPct: { color: theme.sub, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] },
  offTrack: { height: 6, borderRadius: 3, backgroundColor: theme.tile, marginTop: 8, overflow: 'hidden' },
  offFill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
  offLabel: { color: theme.sub, fontSize: 11, marginTop: 6 },
  offFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offResume: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12, marginTop: 6 },
  offResumeTxt: { color: theme.accent, fontWeight: '800', fontSize: 12 },
  testBanner: { backgroundColor: 'rgba(240,165,0,0.14)', borderWidth: 1, borderColor: theme.accent, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12 },
  testTxt: { color: theme.accent, fontWeight: '700', fontSize: 12 },

  hero: { backgroundColor: theme.panel, borderWidth: 1.5, borderRadius: 16, padding: 18, marginTop: 14, zIndex: 20 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 30 },   // keep the Switch-aircraft dropdown above the checks/reasons rows below it (web stacking)
  heroReg: { color: theme.text, fontSize: 32, fontWeight: '900', letterSpacing: 1 },
  heroType: { color: theme.sub, fontSize: 13, marginTop: 3 },
  svcPill: { borderWidth: 1.5, borderRadius: 22, paddingVertical: 7, paddingHorizontal: 14 },
  svcTxt: { fontWeight: '900', fontSize: 13, letterSpacing: 0.6 },
  acChip: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 12 },
  acChipTest: { borderColor: theme.accent, borderWidth: 1.5 },
  acChipTxt: { color: theme.sub, fontWeight: '700', fontSize: 12 },
  heroReason: { color: theme.sub, marginTop: 12, fontSize: 12 },
  checks: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  checkPill: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 13 },
  checkLbl: { color: theme.sub, fontSize: 11, fontWeight: '600' },
  checkVal: { fontWeight: '800', fontSize: 13, marginTop: 2 },

  section: { color: theme.sub, fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginBottom: 11, marginLeft: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, width: 232, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 },
  iconBox: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  cardSub: { color: theme.sub, fontSize: 12, marginTop: 3 },

  dropdown: { position: 'absolute', top: 38, right: 0, width: 230, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, zIndex: 1000, elevation: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  ddRow: { paddingVertical: 10, paddingHorizontal: 13, borderBottomWidth: 1, borderBottomColor: theme.border },
  ddRowOn: { backgroundColor: theme.tile },
  ddReg: { color: theme.text, fontWeight: '800', fontSize: 15 },
  ddSub: { color: theme.sub, fontSize: 11, marginTop: 1 },
});
