import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native';
import { classifyDevice, deviceSelf, DeviceSelf, serverReachable } from '../api/client';
import { theme } from '../theme';

// First-login gate: when an iPad hasn't been classified yet, prompt the crew to register it as an
// AIRCRAFT iPad (shared, bound to a tail) or a PERSONAL iPad. While it awaits admin approval it stays
// usable during the grace window — we just show a small "pending approval" banner. Online-only (the
// state lives on the server); offline launches skip it silently.
export default function DeviceRegisterGate() {
  const [self, setSelf] = useState<DeviceSelf | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      if (!(await serverReachable())) return;      // offline → don't nag
      setSelf(await deviceSelf());
    } catch { /* ignore — non-blocking */ }
  }
  useEffect(() => { refresh(); }, []);

  async function pick(kind: 'aircraft' | 'personal') {
    setBusy(true);
    try { setSelf(await classifyDevice(kind)); } catch { /* keep prompt open */ } finally { setBusy(false); }
  }

  if (!self || !self.enabled) return null;

  const needsKind = self.needs_kind && self.known !== false ? true : self.needs_kind;
  const pending = self.approval === 'pending';

  // Classification prompt (blocking modal on first login).
  if (needsKind) {
    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 460, backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 22 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 6 }}>Register this iPad</Text>
            <Text style={{ color: theme.sub, lineHeight: 20, marginBottom: 18 }}>
              How is this iPad used? An administrator will confirm the registration. You can keep using the app in the meantime{typeof self.grace_days === 'number' ? ` for up to ${self.grace_days} days` : ''}.
            </Text>
            <TouchableOpacity onPress={() => pick('aircraft')} disabled={busy}
              style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>✈️  Aircraft iPad</Text>
              <Text style={{ color: theme.sub, marginTop: 4, fontSize: 13 }}>Shared iPad kept with an aircraft — used by whoever operates that tail.</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pick('personal')} disabled={busy}
              style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 16 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>👤  Personal iPad</Text>
              <Text style={{ color: theme.sub, marginTop: 4, fontSize: 13 }}>An individual crew member's own device.</Text>
            </TouchableOpacity>
            {busy ? <View style={{ marginTop: 14, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View> : null}
          </View>
        </View>
      </Modal>
    );
  }

  // Pending-approval banner (non-blocking) once a kind has been chosen.
  if (pending) {
    const left = self.grace_days_left;
    return (
      <View style={{ backgroundColor: '#3a2e05', borderColor: theme.accent, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 14 }}>⏳</Text>
        <Text style={{ color: theme.text, fontSize: 12, flexShrink: 1 }}>
          This {self.kind === 'personal' ? 'personal' : 'aircraft'} iPad is awaiting administrator approval{typeof left === 'number' ? ` — ${left} day${left === 1 ? '' : 's'} left` : ''}.
        </Text>
      </View>
    );
  }
  return null;
}
