import * as Location from 'expo-location';
import { airportLookup } from '../api/client';
import { getApt } from '../db/reference';

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type GpsState = { state: 'idle' | 'checking' | 'ok' | 'far' | 'nogps' | 'error'; km?: number; name?: string; msg?: string };

// Airport coordinates — cache first (works offline once the route maps have been prefetched),
// then Leon online. Returns null when neither is available.
async function resolveApt(code: string): Promise<{ lat: number; lon: number; name?: string } | null> {
  const cached = await getApt(code).catch(() => null);
  if (cached?.lat != null && cached?.lon != null) return { lat: cached.lat, lon: cached.lon, name: cached.name };
  try {
    const a = await airportLookup(code);
    if (a?.valid && a.lat != null && a.lon != null) return { lat: a.lat, lon: a.lon, name: a.name };
  } catch { /* offline — no cached coords either */ }
  return null;
}

// Device position — try a live fix, then fall back to the last cached fix (up to 6 h old).
// Wifi-only iPads have no GNSS chip: they position off wifi/network, so a live fix fails offline
// (kCLErrorLocationUnknown / error 0). The last-known fix still works with no connection.
async function devicePosition(): Promise<{ lat: number; lon: number } | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch { /* fall through to last-known */ }
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 6 * 60 * 60 * 1000 });
    if (last) return { lat: last.coords.latitude, lon: last.coords.longitude };
  } catch { /* none */ }
  return null;
}

// Compare the device GPS against an airport's coordinates. >50 km => 'far'.
export async function checkAirportGps(code?: string): Promise<GpsState> {
  const c = (code || '').trim();
  if (!c) return { state: 'idle' };
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { state: 'nogps', msg: 'location permission is off' };
    const apt = await resolveApt(c);
    if (!apt) return { state: 'error', msg: `no coordinates for ${c} (offline)` };
    const pos = await devicePosition();
    if (!pos) return { state: 'nogps', msg: 'no GPS fix — offline or indoors' };
    const km = Math.round(haversineKm(pos.lat, pos.lon, apt.lat, apt.lon));
    return { state: km > 50 ? 'far' : 'ok', km, name: apt.name || c };
  } catch (e: any) { return { state: 'nogps', msg: e?.message || 'GPS unavailable' }; }
}
