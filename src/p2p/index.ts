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
  _transport.onReceive((env) => { merge(env).catch(() => {}); });
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

export { merge, snapshot } from './engine';
