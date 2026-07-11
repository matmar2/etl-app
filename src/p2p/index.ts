import { SyncEnvelope, merge, snapshot } from './engine';

// Onboard peer-to-peer sync facade. The reconcile ENGINE (engine.ts) is pure JS
// and works in Expo Go. The TRANSPORT — iOS MultipeerConnectivity over
// Bluetooth + Wi-Fi — is a native module and needs an EAS dev build; register it
// at startup once the dev build ships. Until then bluetooth/peer sync is inert.

export type PeerTransport = {
  start(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  broadcast(env: SyncEnvelope): Promise<void>;
  onReceive(handler: (env: SyncEnvelope) => void): void;
  peers(): string[];
};

let _transport: PeerTransport | null = null;

export function registerPeerTransport(tx: PeerTransport) {
  _transport = tx;
}
export function peerSyncAvailable() {
  return _transport !== null;
}
export function onlinePeers(): string[] {
  return _transport?.peers() ?? [];
}

export async function startPeerSync(deviceId: string) {
  if (!_transport) return;
  _transport.onReceive((env) => {
    // A master's "gather" request → reply with our latest so it can merge our new entries.
    if (env?.kind === 'request') { shareLatest(deviceId).catch(() => {}); return; }
    merge(env).catch(() => {});
  });
  await _transport.start(deviceId);
}

export async function stopPeerSync() {
  await _transport?.stop();
}

// Push this device's latest records to the other onboard iPads.
export async function shareLatest(deviceId: string) {
  if (!_transport) throw new Error('Peer transport not configured (needs EAS dev build + MultipeerConnectivity)');
  await _transport.broadcast(await snapshot(deviceId));
}

// Master-orchestrated "Sync all iPads": GATHER each iPad's newer entries the master doesn't yet
// have, MERGE them into the master's complete latest, then DISTRIBUTE the complete package to all.
export async function masterSyncAll(deviceId: string, collectMs = 2500) {
  if (!_transport) throw new Error('Peer transport not configured (needs EAS dev build + MultipeerConnectivity)');
  // 1) GATHER — ask every peer for its latest; their snapshots arrive via onReceive and merge into us.
  await _transport.broadcast({ device: deviceId, at: new Date().toISOString(), kind: 'request',
                               sectors: [], defects: [], attachments: [] });
  await new Promise((r) => setTimeout(r, collectMs));       // brief window for peers to respond & merge
  // 2) DISTRIBUTE — send the now-complete merged package back to all iPads.
  await _transport.broadcast(await snapshot(deviceId));
}

export { merge, snapshot } from './engine';
