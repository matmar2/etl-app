import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { speak, speechAvailable, stop as stopSpeech } from './speech';
import { userName, roleLabel, role } from '../api/client';

const STORE_KEY = 'voice_confirm_enabled';
const LANG_KEY = 'voice_language';

let _adminEnabled = true;
let _userEnabled: boolean | null = null;
let _adminLanguages: string[] = ['en', 'bg', 'de', 'it', 'el', 'ro', 'ar', 'ru'];
let _userLang: string | null = null;

export const MASTER_LANGUAGES: { code: string; label: string; ttsCode: string }[] = [
  { code: 'en', label: 'English', ttsCode: 'en-US' },
  { code: 'bg', label: 'Bulgarian', ttsCode: 'bg-BG' },
  { code: 'de', label: 'German', ttsCode: 'de-DE' },
  { code: 'it', label: 'Italian', ttsCode: 'it-IT' },
  { code: 'el', label: 'Greek', ttsCode: 'el-GR' },
  { code: 'ro', label: 'Romanian', ttsCode: 'ro-RO' },
  { code: 'ar', label: 'Arabic', ttsCode: 'ar-SA' },
  { code: 'ru', label: 'Russian', ttsCode: 'ru-RU' },
  { code: 'fr', label: 'French', ttsCode: 'fr-FR' },
  { code: 'es', label: 'Spanish', ttsCode: 'es-ES' },
  { code: 'pt', label: 'Portuguese', ttsCode: 'pt-PT' },
  { code: 'tr', label: 'Turkish', ttsCode: 'tr-TR' },
  { code: 'pl', label: 'Polish', ttsCode: 'pl-PL' },
  { code: 'nl', label: 'Dutch', ttsCode: 'nl-NL' },
  { code: 'cs', label: 'Czech', ttsCode: 'cs-CZ' },
  { code: 'sk', label: 'Slovak', ttsCode: 'sk-SK' },
  { code: 'hu', label: 'Hungarian', ttsCode: 'hu-HU' },
  { code: 'hr', label: 'Croatian', ttsCode: 'hr-HR' },
  { code: 'sr', label: 'Serbian', ttsCode: 'sr-RS' },
  { code: 'uk', label: 'Ukrainian', ttsCode: 'uk-UA' },
  { code: 'sv', label: 'Swedish', ttsCode: 'sv-SE' },
  { code: 'da', label: 'Danish', ttsCode: 'da-DK' },
  { code: 'fi', label: 'Finnish', ttsCode: 'fi-FI' },
  { code: 'no', label: 'Norwegian', ttsCode: 'nb-NO' },
  { code: 'zh', label: 'Chinese', ttsCode: 'zh-CN' },
  { code: 'ja', label: 'Japanese', ttsCode: 'ja-JP' },
  { code: 'ko', label: 'Korean', ttsCode: 'ko-KR' },
  { code: 'hi', label: 'Hindi', ttsCode: 'hi-IN' },
  { code: 'th', label: 'Thai', ttsCode: 'th-TH' },
  { code: 'vi', label: 'Vietnamese', ttsCode: 'vi-VN' },
  { code: 'he', label: 'Hebrew', ttsCode: 'he-IL' },
];

export function langLabel(code: string): string {
  return MASTER_LANGUAGES.find(l => l.code === code)?.label || code;
}

export function ttsCode(code: string): string {
  return MASTER_LANGUAGES.find(l => l.code === code)?.ttsCode || code;
}

export function setAdminVoiceConfirm(enabled: boolean): void { _adminEnabled = enabled; }
export function setAdminVoiceLanguages(langs: string[]): void { _adminLanguages = langs && langs.length ? langs : ['en']; }
export function getAdminVoiceLanguages(): string[] { return _adminLanguages; }

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

export async function loadUserVoiceLang(): Promise<string> {
  if (_userLang !== null) return _userLang;
  try {
    const v = Platform.OS === 'web'
      ? (typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null)
      : await SecureStore.getItemAsync(LANG_KEY);
    _userLang = v || 'en';
  } catch { _userLang = 'en'; }
  return _userLang;
}

export async function setUserVoiceLang(lang: string): Promise<void> {
  _userLang = lang;
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang);
    } else {
      await SecureStore.setItemAsync(LANG_KEY, lang);
    }
  } catch {}
}

export function getUserVoiceLang(): string { return _userLang || 'en'; }

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
