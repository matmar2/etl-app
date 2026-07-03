import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { currentAircraft, Ipad, listIpads, setMaster } from '../api/client';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

// The Captain (or the current master iPad) designates which iPad on this aircraft is the
// master — its data wins on sync (precedence master → FO → Backup → Cabin).
export default function MasterDeviceScreen() {
  const reg = currentAircraft()?.registration || '';
  const [ipads, setIpads] = useState<Ipad[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, maxWidth: 720, alignSelf: 'center', width: '100%' }}>
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>Master iPad · {reg}</Text>
      <Text style={{ color: theme.sub, marginTop: 6, fontSize: 13 }}>
        The master iPad&apos;s entries take priority when several iPads sync the same flight. Order of precedence: master → First Officer → Backup → Cabin Crew. The Captain (or the current master) can transfer the master here.
      </Text>
      {msg ? <Text style={{ color: theme.accent, marginTop: 10, fontSize: 13 }}>{msg}</Text> : null}
      {busy ? <ActivityIndicator color={theme.accent} style={{ marginTop: 12 }} /> : null}

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
