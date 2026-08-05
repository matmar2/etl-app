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

// Native voice cache — resolved once per language.  Avoids repeated async lookups mid-speech.
const _nativeVoiceCache: Record<string, { female?: string; male?: string }> = {};

// iOS/macOS voice names by gender across all supported languages.  Apple assigns a
// personal name to each voice; these lists cover every built-in iOS 17/18 voice so
// non-English languages (Bulgarian Daria, German Anna/Markus, etc.) match too.
const _femaleNames = /samantha|female|zira|karen|moira|tessa|fiona|victoria|allison|ava|susan|helena|nicky|sin-ji|ioana|sara|luciana|milena|damayanti|lekha|daria|anna|petra|amelie|marie|alice|federica|carmela|paola|kyoko|yuna|meijia|sinji|tian-tian|tingting|lana|katya|milena|zosia|zuzana|iveta|mariska|laura|ellen|lesya|kanya|linh|carmit|joana|monica|paulina|soledad|sara|melina|yelda|nora|sandy|claire/i;
const _maleNames = /daniel|male|david|alex|tom|jorge|thomas|oliver|luca|yuri|ivan|aaron|rishi|fred|grandpa|junior|markus|hattori|otoya|lee|lisheng|wobao|maged|majed|xander|filiz|albert|maxim|mikko|oskar|anders|krzysztof|nicolas|jacques|lekso|henrik|carlos|diego|enrique|reed|rocko|evan/i;

async function _resolveNativeVoice(lang: string, gender: Voice): Promise<string | undefined> {
  const key = lang.substring(0, 2);
  if (_nativeVoiceCache[key]) return _nativeVoiceCache[key][gender];
  if (!_Speech) return undefined;
  try {
    const all = await _Speech.getAvailableVoicesAsync();
    const matching = all.filter((v: any) => v.language?.startsWith(key));
    const entry: { female?: string; male?: string } = {};
    // Pick a distinctly-named voice for each gender so they actually sound different.
    const pickFemale = matching.find((v: any) => _femaleNames.test(v.name || v.identifier));
    const pickMale = matching.find((v: any) => _maleNames.test(v.name || v.identifier));
    if (pickFemale) entry.female = pickFemale.identifier;
    if (pickMale) entry.male = pickMale.identifier;
    // Fallback: if only one name matched, use the other end of the list for the opposite gender.
    if (!entry.female && matching.length) entry.female = matching[0].identifier;
    if (!entry.male && matching.length > 1) entry.male = matching[matching.length - 1].identifier;
    // If still only one voice for this language, rely on pitch to differentiate.
    if (!entry.male && matching.length === 1) entry.male = matching[0].identifier;
    _nativeVoiceCache[key] = entry;
    return entry[gender];
  } catch { return undefined; }
}

export function speechAvailable(): boolean { return _available; }

let _speaking = false;
let _stopped = false;
let _pauseTimer: ReturnType<typeof setTimeout> | null = null;

export function isSpeaking(): boolean { return _speaking; }

const PARA_PAUSE = 900;
const LINE_PAUSE = 500;

type Chunk = { text: string; pause: number };

function splitChunks(text: string): Chunk[] {
  const parts = text.split(/(\n\s*\n|\n)/);
  const chunks: Chunk[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (/^\n\s*\n$/.test(p)) {
      if (chunks.length) chunks[chunks.length - 1].pause = PARA_PAUSE;
    } else if (p === '\n') {
      if (chunks.length) chunks[chunks.length - 1].pause = LINE_PAUSE;
    } else {
      chunks.push({ text: t, pause: LINE_PAUSE });
    }
  }
  return chunks;
}

export function speak(text: string, voice: Voice = 'female', onDone?: () => void, lang?: string): void {
  if (!text || !_available) return;
  stop();
  _speaking = true;
  _stopped = false;

  const chunks = splitChunks(text);
  if (!chunks.length) { _speaking = false; onDone?.(); return; }

  if (Platform.OS === 'web') {
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = lang ? lang.substring(0, 2) : '';
    const langVoices = langPrefix ? voices.filter(v => v.lang.startsWith(langPrefix)) : voices;
    // Reuse the same comprehensive name lists so web and native match the same voices.
    const femaleRe = _femaleNames;
    const maleRe = _maleNames;
    let preferred: SpeechSynthesisVoice | undefined;
    if (voice === 'female') {
      preferred = langVoices.find(v => femaleRe.test(v.name)) || langVoices.find(v => !maleRe.test(v.name));
    } else {
      preferred = langVoices.find(v => maleRe.test(v.name)) || langVoices.find(v => !femaleRe.test(v.name));
    }
    if (!preferred && langVoices.length) preferred = langVoices[0];

    let idx = 0;
    function speakNext() {
      if (_stopped || idx >= chunks.length) {
        _speaking = false; onDone?.(); return;
      }
      const c = chunks[idx];
      const u = new SpeechSynthesisUtterance(c.text);
      u.rate = 0.95;
      u.pitch = voice === 'female' ? 1.1 : 0.9;
      if (lang) u.lang = lang;
      if (preferred) u.voice = preferred;
      u.onend = () => {
        const pause = c.pause;
        idx++;
        if (_stopped || idx >= chunks.length) { _speaking = false; onDone?.(); return; }
        _pauseTimer = setTimeout(speakNext, pause);
      };
      u.onerror = () => { _speaking = false; onDone?.(); };
      window.speechSynthesis.speak(u);
    }
    speakNext();
    return;
  }

  if (_Speech) {
    const language = lang || 'en-US';
    // Resolve a real OS voice for the requested gender, then start speaking.
    _resolveNativeVoice(language, voice).then((voiceId) => {
      if (_stopped) { _speaking = false; onDone?.(); return; }
      let idx = 0;
      function speakNext() {
        if (_stopped || idx >= chunks.length) {
          _speaking = false; onDone?.(); return;
        }
        const c = chunks[idx];
        const opts: any = {
          language,
          pitch: voice === 'female' ? 1.1 : 0.85,
          rate: 0.95,
          onDone: () => {
            const pause = c.pause;
            idx++;
            if (_stopped || idx >= chunks.length) { _speaking = false; onDone?.(); return; }
            _pauseTimer = setTimeout(speakNext, pause);
          },
          onError: () => { _speaking = false; onDone?.(); },
        };
        if (voiceId) opts.voice = voiceId;
        _Speech!.speak(c.text, opts);
      }
      speakNext();
    }).catch(() => { _speaking = false; onDone?.(); });
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
