import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ackBroadcast, Broadcast } from '../api/client';
import { theme } from '../theme';

const SEV: Record<string, { color: string; label: string }> = {
  info: { color: theme.accent, label: 'NOTICE' },
  warning: { color: '#ffb84d', label: 'IMPORTANT' },
  critical: { color: theme.red, label: 'URGENT' },
};

// Admin broadcast pop-up shown right after login. Shows each pending message in turn;
// dismissing acknowledges it (server-side) so it never pops up again for this user.
export default function BroadcastModal({ items, onClose }: { items: Broadcast[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const cur = items[i];
  if (!cur) return null;
  const sev = SEV[cur.severity] || SEV.info;
  const last = i + 1 >= items.length;
  function dismiss() {
    ackBroadcast(cur.id);
    if (last) onClose(); else setI(i + 1);
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={s.backdrop}>
        <View style={[s.card, { borderColor: sev.color }]}>
          <Text style={[s.badge, { color: sev.color }]}>📢  {sev.label}{items.length > 1 ? `  ·  ${i + 1} of ${items.length}` : ''}</Text>
          <Text style={s.title}>{cur.title}</Text>
          <ScrollView style={{ maxHeight: 280 }}><Text style={s.body}>{cur.body}</Text></ScrollView>
          <Text style={s.from}>— {cur.from || 'Operations'}</Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: sev.color }]} onPress={dismiss}>
            <Text style={s.btnTxt}>{last ? 'Acknowledge' : 'Next  ›'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 560, backgroundColor: theme.panel, borderWidth: 2, borderRadius: 14, padding: 22 },
  badge: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  title: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  body: { color: theme.text, fontSize: 15, lineHeight: 22 },
  from: { color: theme.sub, fontSize: 12, fontStyle: 'italic', marginTop: 14 },
  btn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
