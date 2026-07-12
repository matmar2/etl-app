import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { currentAircraft, deviceId, Ipad, listIpads, setMaster, syncAllComplete, syncAllIpads } from '../api/client';
import { masterSyncAll, peerSyncAvailable } from '../p2p';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

// The Captain (or the current master iPad) designates which iPad on this aircraft is the
// master — its data wins on sync (precedence master → FO → Backup → Cabin).
export default function MasterDeviceScreen() {
  const reg = currentAircraft()?.registration || '';
  const [ipads, setIpads] = useState<Ipad[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncList, setSyncList] = useState<Ipad[]>([]);
  const [syncDone, setSyncDone] = useState(false);
  const cancelled = useRef(false);

  const load = useCallback(() => {
    if (!reg) return;
    listIpads(reg).then((r) => setIpads(r.ipads)).catch(() => setMsg('Cannot load iPads (offline?).'));
  }, [reg]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function makeMaster(d: Ipad) {
    if (d.is_master) return;
    if (!(await confirmAction(`Make "${d.label}" (${d.role_label}) the master iPad for ${reg}?\n\nIts data will take priority on sync. The current master is demoted.`, 'Set master iPad'))) return;
    setBusy(true); setMsg('');
    try { await setMaster(reg, d.id); setMsg(`${d.label} is now the master.`); load(); }
    catch (e: any) { setMsg(e?.message || 'Failed — only the Captain or the current master iPad can change this.'); }
    finally { setBusy(false); }
  }

  // Master-initiated "sync all iPads": pushes our outbox, asks the others to sync on their next
  // heartbeat, then polls each iPad's status and shows progress. The outcome is written to the audit log.
  async function syncAll() {
    setSyncOpen(true); setSyncDone(false); setSyncList([]); cancelled.current = false;
    // 1) Peer path — the master GATHERS each iPad's newer entries, MERGES them into the complete
    //    latest, then DISTRIBUTES the complete package to all iPads. Offline, no server needed.
    //    Active once the on-board peer transport ships.
    try { if (peerSyncAvailable()) await masterSyncAll(await deviceId(), reg); } catch { /* transport not active yet */ }
    // 2) Server relay — push our outbox and ask the others to reconcile via the server when they have network.
    let last: Ipad[] = [];
    try { const r = await syncAllIpads(reg); last = r.ipads; setSyncList(last); } catch { setMsg('Started — iPads will reconcile as they get network.'); }
    const started = Date.now();
    let timer: any;
    const finish = (timedOut: boolean) => {
      if (timer) clearTimeout(timer);
      setSyncDone(true);
      const pendingLabels = last.filter((d) => !d.synced).map((d) => d.label);
      syncAllComplete(reg, { synced: last.filter((d) => d.synced).length, pending: pendingLabels.length, pending_labels: pendingLabels, timed_out: timedOut }).catch(() => {});
      load();
    };
    const tick = async () => {
      if (cancelled.current) return;
      if (Date.now() - started > 75000) return finish(true);
      try {
        const r = await listIpads(reg); last = r.ipads; setSyncList(last);
        if (last.length && last.every((d) => d.synced)) return finish(false);
      } catch { /* offline — retry */ }
      timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 2500);
  }
  const syncedN = syncList.filter((d) => d.synced).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, maxWidth: 720, alignSelf: 'center', width: '100%' }}>
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>Master iPad · {reg}</Text>
      <Text style={{ color: theme.sub, marginTop: 6, fontSize: 13 }}>
        The master iPad&apos;s entries take priority when several iPads sync the same flight. Order of precedence: master → First Officer → Backup → Cabin Crew. The Captain (or the current master) can transfer the master here.
      </Text>
      <TouchableOpacity onPress={syncAll} disabled={busy || !reg}
        style={{ backgroundColor: theme.green, borderRadius: 10, padding: 13, marginTop: 14, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>🔄  Sync all iPads</Text>
      </TouchableOpacity>
      <Text style={{ color: theme.sub, fontSize: 11, marginTop: 6 }}>
        Collects the latest entries from every iPad on the on-board network — including a mechanic&apos;s iPad that joins over Bluetooth — merges them, and sends the complete {reg || 'aircraft'} package back to all. A joining mechanic iPad detects this master&apos;s tail ({reg || '—'}) and receives its data. Directly between iPads when the on-board link is on, via the server otherwise. Written to the activity log.
      </Text>
      {msg ? <Text style={{ color: theme.accent, marginTop: 10, fontSize: 13 }}>{msg}</Text> : null}
      {busy ? <ActivityIndicator color={theme.accent} style={{ marginTop: 12 }} /> : null}

      <Modal visible={syncOpen} transparent animationType="fade" onRequestClose={() => { cancelled.current = true; setSyncOpen(false); }}>
        <View style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.bg, borderRadius: 14, padding: 18, maxWidth: 480, width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{syncDone ? 'Sync complete' : 'Sharing the latest with all iPads'} · {reg}</Text>
            <View style={{ height: 12, backgroundColor: theme.tile, borderRadius: 6, marginTop: 12, overflow: 'hidden' }}>
              <View style={{ height: 12, width: `${Math.round((syncedN / (syncList.length || 1)) * 100)}%`, backgroundColor: theme.green }} />
            </View>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 6 }}>
              {syncedN} of {syncList.length} iPad(s) have the latest{syncDone ? '.' : ' — waiting for the others…'}
            </Text>
            <Text style={{ color: theme.sub, fontSize: 11, marginTop: 3 }}>
              {peerSyncAvailable() ? 'On-board link active — shared directly between iPads.' : 'A pending iPad receives the latest as soon as it has network (or the on-board link is on).'}
            </Text>
            <View style={{ marginTop: 12, gap: 8 }}>
              {syncList.map((d) => (
                <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.panel, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: d.synced ? theme.green : theme.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{d.label}{d.this_device ? ' · this iPad' : ''}</Text>
                    <Text style={{ color: theme.sub, fontSize: 11 }}>{d.role_label}{d.is_master ? ' · ★ MASTER' : ''}</Text>
                  </View>
                  {d.synced
                    ? <Text style={{ color: theme.green, fontWeight: '800', fontSize: 12 }}>✓ Synced{d.online ? '' : ' · offline'}</Text>
                    : <Text style={{ color: d.online ? theme.accent : theme.sub, fontWeight: '800', fontSize: 12 }}>⏳ {d.pending_count} pending{d.online ? '' : ' · offline'}</Text>}
                </View>
              ))}
              {!syncList.length ? <Text style={{ color: theme.sub }}>No iPads registered for this aircraft yet.</Text> : null}
            </View>
            {!syncDone ? <ActivityIndicator color={theme.green} style={{ marginTop: 12 }} /> : null}
            <TouchableOpacity onPress={() => { cancelled.current = true; setSyncOpen(false); }}
              style={{ marginTop: 14, backgroundColor: syncDone ? theme.green : theme.tile, borderRadius: 10, padding: 11, alignItems: 'center' }}>
              <Text style={{ color: syncDone ? '#fff' : theme.text, fontWeight: '800' }}>{syncDone ? 'Done' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={{ marginTop: 14, gap: 10 }}>
        {ipads.length === 0 ? <Text style={{ color: theme.sub }}>No iPads registered for this aircraft yet. An iPad appears here after it first syncs.</Text> : null}
        {ipads.map((d) => (
          <View key={d.id} style={{ backgroundColor: d.is_master ? '#14361f' : theme.panel, borderWidth: 1, borderColor: d.is_master ? theme.green : theme.border, borderRadius: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>
                  {d.label}{d.this_device ? '  · this iPad' : ''}
                </Text>
                <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>
                  {d.role_label}{d.is_master ? '  ·  ★ MASTER' : ''}{d.last_sync ? `  ·  last sync ${String(d.last_sync).slice(0, 16).replace('T', ' ')}` : ''}
                </Text>
              </View>
              {d.is_master ? (
                <View style={{ backgroundColor: theme.green, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>MASTER</Text>
                </View>
              ) : (
                <TouchableOpacity disabled={busy} onPress={() => makeMaster(d)}
                  style={{ backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
                  <Text style={{ color: '#1a1300', fontWeight: '800', fontSize: 12 }}>Make master</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>
      <Text style={{ color: theme.sub, fontSize: 11, marginTop: 16 }}>
        Roles (Captain / First Officer / Backup / Cabin Crew) are assigned by the administrator in the back office; the default master is the Captain iPad.
      </Text>
    </ScrollView>
  );
}
