import React from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { theme } from '../theme';

// Blocks ALL interaction while a screen's initial server refresh is in flight (online only —
// callers time-box the wait and never show this when offline/unreachable). Modal-based so no
// screen layout changes are needed.
export default function SyncBlock({ visible, label }: { visible: boolean; label?: string }) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,20,35,0.55)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 18, paddingHorizontal: 26, alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.text, fontWeight: '700' }}>{label || 'Wait — syncing with the server…'}</Text>
        </View>
      </View>
    </Modal>
  );
}
