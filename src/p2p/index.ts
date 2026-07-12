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

// Peer session. `getReg` returns this iPad's current aircraft (so it answers gather requests with
// its data for that tail). `onMasterReg` fires when a MASTER iPad is heard on the network — a
// roaming mechanic iPad that joins the Bluetooth network uses it to detect the aircraft reg the
// master is working and adopt/focus that tail.
export async function startPeerSync(
  deviceId: string,
  opts?: { getReg?: () => string | undefined; onMasterReg?: (reg: string) => void },
) {
  if (!_transport) return;
  _transport.onReceive((env) => {
    // A master's "gather" request → reply with our latest so it can merge our new entries.
    if (env?.kind === 'request') { shareLatest(deviceId, { reg: opts?.getReg?.() }).catch(() => {}); return; }
    if (env?.master && env?.reg && opts?.onMasterReg) opts.onMasterReg(env.reg);   // detected the master's tail
    merge(env).catch(() => {});
  });
  await _transport.start(deviceId);
}

export async function stopPeerSync() {
  await _transport?.stop();
}

// Push this device's latest records to the other onboard iPads (tagged with the tail it's working).
export async function shareLatest(deviceId: string, opts?: { reg?: string; master?: boolean }) {
  if (!_transport) throw new Error('Peer transport not configured (needs EAS dev build + MultipeerConnectivity)');
  await _transport.broadcast(await snapshot(deviceId, opts));
}

// Master-orchestrated "Sync all iPads" for aircraft `reg`: GATHER each iPad's (incl. a roaming
// mechanic iPad on the Bluetooth network) newer entries the master doesn't have, MERGE them into
// the master's complete latest for that tail, then DISTRIBUTE the complete package to all iPads.
export async function masterSyncAll(deviceId: string, reg?: string, collectMs = 2500) {
  if (!_transport) throw new Error('Peer transport not configured (needs EAS dev build + MultipeerConnectivity)');
  // 1) GATHER — ask every peer on the network for its latest for this tail; snapshots merge into us.
  await _transport.broadcast({ device: deviceId, at: new Date().toISOString(), kind: 'request',
                               reg, master: true, sectors: [], defects: [], attachments: [] });
  await new Promise((r) => setTimeout(r, collectMs));       // brief window for peers to respond & merge
  // 2) DISTRIBUTE — send the now-complete merged package back to all iPads, tagged as the master's.
  await _transport.broadcast(await snapshot(deviceId, { reg, master: true }));
}

export { merge, snapshot } from './engine';
