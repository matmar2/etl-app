import { requireNativeModule } from 'expo';
import type { PeerTransport } from './index';
import type { SyncEnvelope } from './engine';

// Bridge to the native MultipeerConnectivity module (modules/peer-sync). Present only in a
// native EAS build; absent in Expo Go and on web, where requireNativeModule throws and we
// return null so peer sync stays inert (the app then syncs via the server as before).
type NativePeerSync = {
  start(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  broadcast(payload: string): Promise<void>;
  getPeers(): string[];
  addListener(event: string, listener: (e: { data: string }) => void): { remove(): void };
};

let _native: NativePeerSync | null | undefined;
function nativeModule(): NativePeerSync | null {
  if (_native !== undefined) return _native;
  try { _native = requireNativeModule('PeerSync') as unknown as NativePeerSync; }
  catch { _native = null; }                              // module not linked → inert
  return _native;
}

// Build a PeerTransport backed by the native module, or null when it isn't available.
export function makeNativeTransport(): PeerTransport | null {
  const mod = nativeModule();
  if (!mod) return null;
  let sub: { remove(): void } | null = null;
  return {
    async start(deviceId: string) { await mod.start(deviceId); },
    async stop() { sub?.remove(); sub = null; try { await mod.stop(); } catch { /* already stopped */ } },
    async broadcast(env: SyncEnvelope) { await mod.broadcast(JSON.stringify(env)); },
    onReceive(handler: (env: SyncEnvelope) => void) {
      sub?.remove();
      sub = mod.addListener('onReceive', (e) => {
        try { handler(JSON.parse(e.data) as SyncEnvelope); } catch { /* ignore malformed */ }
      });
    },
    peers(): string[] { try { return mod.getPeers(); } catch { return []; } },
  };
}
