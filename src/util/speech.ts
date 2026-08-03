import { Platform } from 'react-native';

// TTS abstraction — expo-speech on native (behind requireOptionalNativeModule),
// Web Speech API on web. Splits on paragraph breaks and inserts real silent gaps.

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
let _stopped = false;
let _pauseTimer: ReturnType<typeof setTimeout> | null = null;

export function isSpeaking(): boolean { return _speaking; }

const PAUSE_MS = 800;

function splitChunks(text: string): string[] {
  return text.split(/\n\s*\n/).map(c => c.replace(/\n/g, ' ').trim()).filter(Boolean);
}

export function speak(text: string, voice: Voice = 'female', onDone?: () => void): void {
  if (!text || !_available) return;
  stop();
  _speaking = true;
  _stopped = false;

  const chunks = splitChunks(text);
  if (!chunks.length) { _speaking = false; onDone?.(); return; }

  if (Platform.OS === 'web') {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voice === 'female'
      ? voices.find(v => /samantha|female|zira|karen|moira|tessa/i.test(v.name))
      : voices.find(v => /daniel|male|david|alex|tom/i.test(v.name));

    let idx = 0;
    function speakNext() {
      if (_stopped || idx >= chunks.length) {
        _speaking = false; onDone?.(); return;
      }
      const u = new SpeechSynthesisUtterance(chunks[idx]);
      u.rate = 0.95;
      u.pitch = voice === 'female' ? 1.1 : 0.9;
      if (preferred) u.voice = preferred;
      u.onend = () => {
        idx++;
        if (_stopped || idx >= chunks.length) { _speaking = false; onDone?.(); return; }
        _pauseTimer = setTimeout(speakNext, PAUSE_MS);
      };
      u.onerror = () => { _speaking = false; onDone?.(); };
      window.speechSynthesis.speak(u);
    }
    speakNext();
    return;
  }

  if (_Speech) {
    let idx = 0;
    function speakNext() {
      if (_stopped || idx >= chunks.length) {
        _speaking = false; onDone?.(); return;
      }
      _Speech!.speak(chunks[idx], {
        language: 'en-US',
        pitch: voice === 'female' ? 1.1 : 0.85,
        rate: 0.95,
        onDone: () => {
          idx++;
          if (_stopped || idx >= chunks.length) { _speaking = false; onDone?.(); return; }
          _pauseTimer = setTimeout(speakNext, PAUSE_MS);
        },
        onError: () => { _speaking = false; onDone?.(); },
      });
    }
    speakNext();
  }
}

export function stop(): void {
  _stopped = true;
  _speaking = false;
  if (_pauseTimer) { clearTimeout(_pauseTimer); _pauseTimer = null; }
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    return;
  }
  _Speech?.stop();
}
