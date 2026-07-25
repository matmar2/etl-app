import { Alert } from 'react-native';
import { approvePeer, registerPeerTransport, shareLatest, startPeerSync, stopPeerSync } from './index';
import { makeNativeTransport } from './native';
import { currentAircraft, deviceId, listIpads } from '../api/client';

// Boots the on-board Bluetooth (MultipeerConnectivity) peer sync when the native transport is
// present (a native EAS build). No-ops in Expo Go / web / older builds, so it is always safe to
// call. The reconcile engine + master "Sync all iPads" orchestration already exist (p2p/index.ts);
// this only wires the now-available transport and starts the session.

let _started = false;
let _isMaster = false;

// Am I the master iPad for the current tail? Derived from the admin-maintained iPad list.
async function refreshMaster(): Promise<void> {
  try {
    const reg = currentAircraft()?.registration;
    if (!reg) { _isMaster = false; return; }
    const r = await listIpads(reg);
    _isMaster = !!r.ipads.find((d) => d.this_device && d.is_master);
  } catch { /* offline — keep the last known value */ }
}

export async function startOnboardSync(): Promise<void> {
  if (_started) return;
  const tx = makeNativeTransport();
  if (!tx) return;                                       // native module absent → stay inert
  registerPeerTransport(tx);
  _started = true;

  const id = await deviceId();
  await refreshMaster();

  await startPeerSync(id, {
    getReg: () => currentAircraft()?.registration,
    isMaster: () => _isMaster,
    // Only the master is prompted (enforced in startPeerSync). Approving a peer is the human
    // half of the two-sided join confirmation — the master then shares the latest to it.
    onJoinRequest: (peerId: string, label?: string) => {
      const reg = currentAircraft()?.registration;
      Alert.alert(
        'On-board iPad wants to join',
        `${label || peerId} is asking to join ${reg || 'this aircraft'}'s on-board sync.`,
        [
          { text: 'Deny', style: 'cancel' },
          { text: 'Approve', onPress: () => { approvePeer(peerId); shareLatest(id, { reg, master: _isMaster }).catch(() => {}); } },
        ],
      );
    },
  });
}

// Call after the master designation may have changed (e.g. returning to the Main Menu).
export async function refreshOnboardMaster(): Promise<void> { await refreshMaster(); }

export async function stopOnboardSync(): Promise<void> {
  if (!_started) return;
  await stopPeerSync().catch(() => {});
  _started = false;
}
