import React, { useEffect, useState } from 'react';
import { AppState, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ackDefect, currentAircraft, listIpads, pendingAckDefects, role } from '../api/client';
import { theme } from '../theme';

// Cross-side read-and-accept popup on ANY ETL page (mounted once at the app root).
//  • Flight crew (captain/pilot) — shows on the MASTER iPad: defects the mechanic/cabin entered.
//  • Mechanic — shows on their iPad: defects the flight crew/master entered.
// (falls back to any flight-crew iPad if no master is designated yet.)
export default function AckOverlay({ navRef }: { navRef: any }) {
  const [pending, setPending] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  async function poll() {
    try {
      if (!navRef?.isReady?.()) return;
      const rt = navRef.getCurrentRoute()?.name;
      if (!rt || rt === 'Login' || rt === 'MfaSetup') { setPending([]); setOpen(false); return; }
      const r = role();
      const isCrew = r === 'captain' || r === 'pilot' || r === 'admin';   // commander side
      const isMech = r === 'mechanic';
      if (!isCrew && !isMech) { setPending([]); setOpen(false); return; }
      const ac = currentAircraft();
      if (!ac?.registration) return;
      // Flight crew: only the designated MASTER iPad shows it (fallback: any crew iPad if no master set).
      // Mechanic: shows on their own iPad (no master gate).
      if (isCrew) {
        try {
          const { ipads } = await listIpads(ac.registration);
          const anyMaster = ipads.some((i) => i.is_master);
          const thisIsMaster = ipads.some((i) => i.this_device && i.is_master);
          if (anyMaster && !thisIsMaster) { setPending([]); setOpen(false); return; }
        } catch { /* offline — pendingAck below will also fail; keep last state */ }
      }
      const d = await pendingAckDefects(ac.registration);   // server returns the correct side per role
      setPending(d);
      setOpen(d.length > 0);
    } catch { /* offline — keep last state */ }
  }

  useEffect(() => {
    poll();
    const t = setInterval(poll, 15000);
    const subApp = AppState.addEventListener('change', (s) => { if (s === 'active') poll(); });
    let unsub: any;
    try { unsub = navRef?.addListener?.('state', poll); } catch { /* ref may not support */ }
    return () => { clearInterval(t); subApp.remove(); if (unsub) unsub(); };
  }, []);

  async function accept(id: string) {
    try {
      await ackDefect(id);
      const left = pending.filter((d) => d.id !== id);
      setPending(left);
      if (!left.length) setOpen(false);
    } catch { /* offline / not permitted */ }
  }

  if (!open || !pending.length) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.accent, maxHeight: '88%', overflow: 'hidden' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>Defects — read &amp; accept</Text>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 3 }}>Entered by the {role() === 'mechanic' ? 'flight crew' : 'mechanic / cabin crew'}{currentAircraft()?.registration ? ` on ${currentAircraft()!.registration}` : ''}. Review each and accept.</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            {pending.map((d) => (
              <View key={d.id} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{d.title || d.description}</Text>
                <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>{(d.source || 'marep').toUpperCase()} · ATA {d.ata_chapter || '—'} · {(d.status || '').toUpperCase()}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}</Text>
                {d.title && d.description ? <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>{d.description}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <TouchableOpacity style={{ flex: 1, minWidth: 150, backgroundColor: theme.green, borderRadius: 8, padding: 11, alignItems: 'center' }} onPress={() => accept(d.id)}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Read &amp; accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ minWidth: 100, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 11, alignItems: 'center' }}
                    onPress={() => { setOpen(false); try { navRef?.navigate?.('DefectDetail', { defectId: d.id }); } catch { /* noop */ } }}>
                    <Text style={{ color: theme.text, fontWeight: '700' }}>Details</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
            <TouchableOpacity style={{ flex: 1, alignItems: 'center', padding: 4 }} onPress={() => setOpen(false)}>
              <Text style={{ color: theme.accent, fontWeight: '700' }}>Later ({pending.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 2, backgroundColor: theme.green, borderRadius: 8, padding: 12, alignItems: 'center' }}
              onPress={async () => { for (const d of [...pending]) await accept(d.id); }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Accept all ({pending.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
