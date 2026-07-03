import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store has no web implementation (it throws). On web fall back to
// localStorage so login/token storage works in the browser; native uses the
// real Keychain-backed SecureStore.
export async function setItem(key: string, value: string) {
  if (Platform.OS === 'web') { try { window.localStorage.setItem(key, value); } catch {} return; }
  await SecureStore.setItemAsync(key, value);
}
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') { try { return window.localStorage.getItem(key); } catch { return null; } }
  return SecureStore.getItemAsync(key);
}
export async function deleteItem(key: string) {
  if (Platform.OS === 'web') { try { window.localStorage.removeItem(key); } catch {} return; }
  await SecureStore.deleteItemAsync(key);
}
