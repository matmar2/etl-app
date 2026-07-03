import * as Location from 'expo-location';
import { airportLookup } from '../api/client';

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type GpsState = { state: 'idle' | 'checking' | 'ok' | 'far' | 'nogps' | 'error'; km?: number; name?: string; msg?: string };

// Compare the device GPS against an airport's coordinates (from Leon). >50 km => 'far'.
export async function checkAirportGps(code?: string): Promise<GpsState> {
  const c = (code || '').trim();
  if (!c) return { state: 'idle' };
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { state: 'nogps', msg: 'location permission off' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    const apt = await airportLookup(c);
    if (!apt?.valid || apt.lat == null || apt.lon == null) return { state: 'error', msg: `no coordinates for ${c}` };
    const km = Math.round(haversineKm(pos.coords.latitude, pos.coords.longitude, apt.lat, apt.lon));
    return { state: km > 50 ? 'far' : 'ok', km, name: apt.name || c };
  } catch (e: any) { return { state: 'nogps', msg: e?.message || 'GPS unavailable' }; }
}
