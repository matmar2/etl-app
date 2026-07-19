import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

// Blocks ALL interaction while a screen's initial server refresh is in flight (online only —
// callers time-box the wait and never show this when offline/unreachable).
//
// Deliberately NOT a react-native Modal: a second Modal (induction / broadcast pop-up) presenting
// while this one dismisses can wedge the iOS modal stack and leave the app dead to touches.
// Instead each SyncBlock registers its state here and a single <SyncBlockHost/> at the app root
// draws one plain absolute overlay above the navigator — real Modals always stay above it.
type P = { visible: boolean; label?: string };

const _owners = new Map<number, P>();
let _seq = 0;
let _setHost: ((p: P | null) => void) | null = null;

function _publish() {
  let top: P | null = null;
  for (const p of _owners.values()) if (p.visible) top = p;
  if (_setHost) _setHost(top);
}

export default function SyncBlock({ visible, label }: P) {
  const [id] = useState(() => ++_seq);
  useEffect(() => { _owners.set(id, { visible, label }); _publish(); }, [id, visible, label]);
  useEffect(() => () => { _owners.delete(id); _publish(); }, [id]);
  return null;
}

// Mounted once in App.tsx, above the navigator.
export function SyncBlockHost() {
  const [p, setP] = useState<P | null>(null);
  useEffect(() => {
    _setHost = setP; _publish();
    return () => { if (_setHost === setP) _setHost = null; };
  }, []);
  if (!p?.visible) return null;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,20,35,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 }]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
    >
      <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 18, paddingHorizontal: 26, alignItems: 'center', gap: 10 }}>
        <ActivityIndicator color={theme.accent} />
        <Text style={{ color: theme.text, fontWeight: '700' }}>{p.label || 'Wait — syncing with the server…'}</Text>
      </View>
    </View>
  );
}
