import { Platform } from 'react-native';
import { api } from './api/client';

// Real push notifications (APNs via Expo Push) — registers this user+device's Expo push token
// with the backend after sign-in. Ships with the 1.0.2 native build; on web / Expo Go / older
// builds every step is guarded and silently no-ops, so it is always safe to call.
export async function registerPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = require('expo-notifications');
    const Constants = require('expo-constants').default;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;                          // user declined — the in-app pop-ups remain
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (token) await api('/push/register', { method: 'POST', body: JSON.stringify({ token, platform: Platform.OS }) });
  } catch { /* module absent (old build/Expo Go) or offline — in-app broadcasts still work */ }
}
