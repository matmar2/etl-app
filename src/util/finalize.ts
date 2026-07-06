// Post-sign "finalize" sequence shared by the 2/10-day check and the CRS release flows, so the
// crew see the aircraft return to serviceable instead of a silent wait. Offline-aware: on native
// the write is always recorded locally first, so we probe reachability and only say "syncing to
// the server" when we are actually online; offline it stays queued and syncs later.
import { aircraftStatus, AircraftStatus, serverReachable, syncPush } from '../api/client';

export type FinalizeStep = { frac: number; label: string };

function finalLabel(online: boolean, serviceable: boolean | null): string {
  if (serviceable === false) {
    return online
      ? '✓ Recorded — other item(s) still keep the aircraft unserviceable'
      : '✓ Recorded offline — other item(s) still keep it unserviceable; syncs when online';
  }
  return online
    ? '✓ Aircraft serviceable'
    : '✓ Recorded offline — serviceable on this iPad; syncs when online';
}

// Runs record→(sync if online)→refresh-serviceability, driving a progress callback (0.4→1.0).
// The caller shows 0→0.4 for the record step. Returns the refreshed status + connectivity.
export async function finalizeServiceable(
  reg: string,
  onProgress: (s: FinalizeStep) => void,
  opts?: { finalLabel?: (online: boolean, serviceable: boolean | null) => string },
): Promise<{ online: boolean; status: AircraftStatus | null; serviceable: boolean | null }> {
  onProgress({ frac: 0.4, label: 'Recorded ✓' });
  const online = await serverReachable().catch(() => false);
  if (online) {
    onProgress({ frac: 0.6, label: 'Syncing to the server…' });
    try { await syncPush(); } catch { /* transient — stays queued */ }
  }
  onProgress({ frac: 0.8, label: online ? 'Updating aircraft serviceability…' : 'Updating serviceability on this iPad…' });
  let status: AircraftStatus | null = null;
  try { status = await aircraftStatus(reg); } catch { /* offline → optimistic cached status */ }
  const serviceable = status ? status.serviceable : null;
  onProgress({ frac: 1, label: (opts?.finalLabel || finalLabel)(online, serviceable) });
  return { online, status, serviceable };
}
