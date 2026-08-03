import { Platform } from 'react-native';

// TTS abstraction — expo-speech on native (behind requireOptionalNativeModule),
// Web Speech API on web. Gracefully no-ops when unavailable.

type Voice = 'female' | 'male';

let _Speech: typeof import('expo-speech') | null = null;
try {
  if (Platform.OS !== 'web') {
    const mod = require('expo-modules-core').requireOptionalNativeModule('ExpoSpeech');
    if (mod) _Speech = require('expo-speech');
  }
} catch { /* native module absent — voice button hidden */ }

const _available = Platform.OS === 'web' ? typeof window !== 'undefined' && 'speechSynthesis' in window : !!_Speech;

export function speechAvailable(): boolean { return _available; }

let _speaking = false;

export function isSpeaking(): boolean { return _speaking; }

export function speak(text: string, voice: Voice = 'female', onDone?: () => void): void {
  if (!text || !_available) return;
  stop();
  _speaking = true;

  if (Platform.OS === 'web') {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = voice === 'female' ? 1.1 : 0.9;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voice === 'female'
      ? voices.find(v => /samantha|female|zira|karen|moira|tessa/i.test(v.name))
      : voices.find(v => /daniel|male|david|alex|tom/i.test(v.name));
    if (preferred) u.voice = preferred;
    u.onend = () => { _speaking = false; onDone?.(); };
    u.onerror = () => { _speaking = false; onDone?.(); };
    window.speechSynthesis.speak(u);
    return;
  }

  if (_Speech) {
    _Speech.speak(text, {
      language: 'en-US',
      pitch: voice === 'female' ? 1.1 : 0.85,
      rate: 0.95,
      onDone: () => { _speaking = false; onDone?.(); },
      onError: () => { _speaking = false; onDone?.(); },
    });
  }
}

export function stop(): void {
  _speaking = false;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    return;
  }
  _Speech?.stop();
}
