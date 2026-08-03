import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { speak, speechAvailable, stop as stopSpeech } from './speech';
import { userName, roleLabel, role } from '../api/client';

const STORE_KEY = 'voice_confirm_enabled';

let _adminEnabled = true;
let _userEnabled: boolean | null = null;

export function setAdminVoiceConfirm(enabled: boolean): void { _adminEnabled = enabled; }

export async function loadUserVoicePref(): Promise<boolean> {
  if (_userEnabled !== null) return _userEnabled;
  try {
    const v = Platform.OS === 'web'
      ? (typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null)
      : await SecureStore.getItemAsync(STORE_KEY);
    _userEnabled = v === null ? true : v === '1';
  } catch { _userEnabled = true; }
  return _userEnabled;
}

export async function setUserVoicePref(on: boolean): Promise<void> {
  _userEnabled = on;
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, on ? '1' : '0');
    } else {
      await SecureStore.setItemAsync(STORE_KEY, on ? '1' : '0');
    }
  } catch {}
}

export function voiceConfirmAvailable(): boolean {
  return speechAvailable() && _adminEnabled;
}

async function canSpeak(): Promise<boolean> {
  if (!speechAvailable() || !_adminEnabled) return false;
  await loadUserVoicePref();
  return !!_userEnabled;
}

function nameForSpeech(): string {
  const n = userName();
  return n || 'you';
}

function roleTitle(): string {
  const r = role();
  if (r === 'captain') return 'Captain';
  if (r === 'pilot') return 'First Officer';
  return '';
}

export async function speakPreDeparture(): Promise<void> {
  if (!(await canSpeak())) return;
  const title = roleTitle();
  const name = nameForSpeech();
  const msg = title
    ? `Thanks ${title} ${name}. You signed the pre-departure.`
    : `Thanks ${name}. You signed the pre-departure.`;
  speak(msg);
}

export async function speakFlightClosed(): Promise<void> {
  if (!(await canSpeak())) return;
  const title = roleTitle();
  const name = nameForSpeech();
  const msg = title
    ? `Thanks ${title} ${name}. You completed and signed the flight.`
    : `Thanks ${name}. You completed and signed the flight.`;
  speak(msg);
}

export async function speakDefectCleared(): Promise<void> {
  if (!(await canSpeak())) return;
  const name = nameForSpeech();
  speak(`Thanks ${name}. You cleared the defect.`);
}

export async function speakCRSSigned(): Promise<void> {
  if (!(await canSpeak())) return;
  const name = nameForSpeech();
  speak(`Thanks ${name}. You signed the CRS.`);
}

export async function speakMissingFields(fields: string[]): Promise<void> {
  if (!(await canSpeak())) return;
  if (!fields.length) return;
  const list = fields.join(', ');
  speak(`Please enter the following before signing: ${list}.`);
}

export function stopVoiceConfirm(): void { stopSpeech(); }
