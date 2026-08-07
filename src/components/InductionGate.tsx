import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ackInduction, fetchLogo, Induction, pendingInduction, role, roleLabel, userName, viewInduction } from '../api/client';
import { speak, speechAvailable, stop as stopSpeech } from '../util/speech';
import { getAdminVoiceLanguages, getUserVoiceLang, langLabel, loadUserVoiceLang, setUserVoiceLang, ttsCode } from '../util/voiceConfirm';
import { theme } from '../theme';

type Phase = 'email' | 'slide' | 'ack';
type Voice = 'female' | 'male';

const PREVIEW_ROLES: { role: string; label: string }[] = [
  { role: 'captain', label: 'Captain' },
  { role: 'pilot', label: 'First Officer' },
  { role: 'cabin', label: 'Cabin Crew' },
  { role: 'mechanic', label: 'Mechanic' },
  { role: 'admin', label: 'Application Overview' },
];

let _poke: (() => void) | null = null;
let _open: (() => void) | null = null;
export function pokeInduction() { _poke?.(); }
export function openInduction() { _open?.(); }

export default function InductionGate() {
  const [ind, setInd] = useState<Induction | null>(null);
  const [mode, setMode] = useState<'auto' | 'view'>('auto');
  const [phase, setPhase] = useState<Phase>('email');
  const [i, setI] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [showAgain, setShowAgain] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [previewRole, setPreviewRole] = useState<string | null>(null);
  const showing = useRef(false);
  const shownVer = useRef<number | null>(null);

  // Voice state
  const [voice, setVoice] = useState<Voice>('female');
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceOk = speechAvailable();

  // Language state
  const [lang, setLang] = useState('en');
  const [langOpen, setLangOpen] = useState(false);
  const [logoUri, setLogoUri] = useState<string | null>(null);
  useEffect(() => { loadUserVoiceLang().then(setLang); fetchLogo().then((l) => { if (l) setLogoUri(l); }); }, []);

  function availLangs(): string[] {
    return getAdminVoiceLanguages();
  }

  function pickLang(code: string) {
    setLang(code);
    setUserVoiceLang(code);
    setLangOpen(false);
    stopVoice();
  }

  function start(p: Induction, m: 'auto' | 'view', pr?: string | null) {
    showing.current = true; setMode(m); setPhase('email'); setI(0); setAgreed(false); setShowAgain(false);
    if (m === 'auto') shownVer.current = Number(p.version) || 0;
    setPreviewRole(pr ?? null); setInd(p); stopVoice();
  }
  async function pickRole(rl: string) {
    let p: Induction | null = null;
    try { p = await viewInduction(rl); } catch { /* offline */ }
    if (p && (p.slides?.length || p.email_body)) start(p, 'view', rl);
    else {
      const msg = 'That Quick Reference isn\'t available offline — open it once online to cache it.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); } else Alert.alert('Quick Reference', msg);
    }
  }
  function toRoles() { stopVoice(); setInd(null); setPreviewRole(null); }
  function close() { stopVoice(); showing.current = false; setInd(null); setChooser(false); setPreviewRole(null); setLangOpen(false); }

  // --- Translated email content ---
  function emailSubject(): string {
    if (!ind) return '';
    if (lang !== 'en' && ind.email_subject_i18n?.[lang]) return ind.email_subject_i18n[lang];
    return ind.email_subject || '';
  }
  function emailBody(): string {
    if (!ind) return '';
    if (lang !== 'en' && ind.email_body_i18n?.[lang]) return ind.email_body_i18n[lang];
    return ind.email_body || '';
  }

  // --- Voice controls ---
  function stopVoice() { stopSpeech(); setPlaying(false); }
  function narrationForSlide(idx: number): string {
    if (!ind) return '';
    if (lang !== 'en' && ind.slide_narrations_i18n?.[lang]?.[idx]) return ind.slide_narrations_i18n[lang][idx];
    return ind.slide_narrations?.[idx] || '';
  }
  function emailVoiceText(): string {
    if (!ind) return '';
    const greeting = previewRole
      ? `Dear ${roleLabel(previewRole)},`
      : `Dear ${roleLabel()}${userName() ? ` ${userName()}` : ''},`;
    const body = emailBody().replace(/^\s*Dear[^\n]*,?\s*\n+/i, '');
    const subj = emailSubject();
    return `${subj ? subj + '. ' : ''}${greeting} ${body}`;
  }
  function toggleVoice() {
    if (playing) { stopVoice(); return; }
    const text = phase === 'email' ? emailVoiceText() : phase === 'slide' ? narrationForSlide(i) : '';
    if (!text) return;
    setPlaying(true);
    speak(text, voice, () => setPlaying(false), ttsCode(lang));
  }
  // Auto-play voice on phase/slide change or when induction first loads
  useEffect(() => {
    stopSpeech(); setPlaying(false);
    if (!voiceOn || !voiceOk || !ind?.voice_enabled) return;
    if (phase === 'ack') return;
    const t = setTimeout(() => {
      const raw = phase === 'email' ? emailVoiceText()
        : phase === 'slide' ? narrationForSlide(i) : '';
      if (!raw) return;
      setPlaying(true);
      speak(raw, voice, () => setPlaying(false), ttsCode(lang));
    }, 500);
    return () => clearTimeout(t);
  }, [phase, i, voiceOn, ind, lang]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      if (!alive || showing.current) return;
      if (!userName()) { setInd(null); return; }
      try {
        const p = await pendingInduction();
        if (alive && p && (p.slides?.length || p.email_body)
            && shownVer.current !== (Number(p.version) || 0)) start(p, 'auto');
      } catch { /* offline */ }
    }
    async function open() {
      if (showing.current) return;
      const r = role();
      if (r === 'admin' || r === 'camo') { showing.current = true; setInd(null); setPreviewRole(null); setChooser(true); return; }
      let p: Induction | null = null;
      try { p = await viewInduction(); } catch { /* offline */ }
      if (alive && p && (p.slides?.length || p.email_body)) { start(p, 'view'); return; }
      const msg = 'There is no Welcome & Quick Reference for your role.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); } else Alert.alert('Welcome & Quick Ref', msg);
    }
    _poke = tick; _open = open; tick();
    const t = setInterval(tick, 20000);
    return () => { alive = false; _poke = null; _open = null; clearInterval(t); };
  }, []);

  if (!ind && !chooser) return null;

  // ---- Role picker (admin / CAMO) ----
  if (chooser && !ind) {
    return (
      <Modal visible animationType="slide" onRequestClose={close}>
        <View style={s.wrap}>
          <View style={s.header}>
            <Text style={s.badge}>{'👋'}  WELCOME &amp; QUICK REF</Text>
            <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>{'✕'} Close</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.emailContent}>
            <Text style={s.ackTitle}>Choose a role to view</Text>
            <Text style={s.ackSub}>As administration / CAMO you can preview the Welcome &amp; Quick Reference each role receives.</Text>
            {PREVIEW_ROLES.map((r) => (
              <TouchableOpacity key={r.role} style={s.roleBtn} onPress={() => pickRole(r.role)} activeOpacity={0.85}>
                <Text style={s.roleBtnTxt}>{r.label}</Text>
                <Text style={s.roleBtnArrow}>{'›'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    );
  }

  const slides = ind!.slides || [];
  const lastSlide = i + 1 >= slides.length;
  const greeting = previewRole
    ? `Dear ${roleLabel(previewRole)},`
    : `Dear ${roleLabel()}${userName() ? ` ${userName()}` : ''},`;
  const body = emailBody().replace(/^\s*Dear[^\n]*,?\s*\n+/i, '');
  const showVoice = voiceOk && ind!.voice_enabled && phase !== 'ack';
  const voiceActive = showVoice && voiceOn;
  const hasNarration = phase === 'slide' && !!narrationForSlide(i);
  const langs = availLangs();
  const showLangPicker = showVoice && langs.length > 1;

  function confirm() {
    if (!agreed) return;
    if (!showAgain) ackInduction(ind!.version);
    close();
  }
  function next() {
    if (phase === 'email') { setPhase(slides.length ? 'slide' : (mode === 'view' ? 'email' : 'ack')); if (!slides.length && mode === 'view') (previewRole ? toRoles() : close()); return; }
    if (phase === 'slide') {
      if (!lastSlide) { setI(i + 1); return; }
      mode === 'view' ? (previewRole ? toRoles() : close()) : setPhase('ack');
    }
  }
  function back() {
    if (phase === 'ack') { setI(Math.max(0, slides.length - 1)); setPhase('slide'); return; }
    if (phase === 'slide') { i > 0 ? setI(i - 1) : setPhase('email'); }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => mode === 'view' && (previewRole ? toRoles() : close())}>
      <View style={s.wrap}>
        <View style={s.header}>
          <View style={s.headerTop}>
            <Text style={s.badge}>
              {phase === 'email' ? (previewRole ? `✉  ${roleLabel(previewRole).toUpperCase()} — WELCOME` : '✉  WELCOME — PLEASE READ')
                : phase === 'slide' ? `📊  QUICK REFERENCE · ${i + 1} / ${slides.length}`
                : '✓  ACKNOWLEDGEMENT'}
            </Text>
            <View style={s.headerRight}>
              {previewRole ? <TouchableOpacity onPress={toRoles} hitSlop={12}><Text style={s.close}>{'‹'} Roles</Text></TouchableOpacity>
                : mode === 'view' ? <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>{'✕'} Close</Text></TouchableOpacity> : null}
            </View>
          </View>
          {showVoice ? (
            <View style={s.voiceRow}>
              <TouchableOpacity onPress={() => { stopVoice(); setVoiceOn(v => !v); }} hitSlop={8} style={[s.voiceToggle, voiceOn && s.voiceToggleOn]}>
                <Text style={s.voiceToggleTxt}>{voiceOn ? '🔊' : '🔇'}</Text>
              </TouchableOpacity>
              {showLangPicker ? (
                <View style={{ zIndex: 200 }}>
                  <TouchableOpacity onPress={() => setLangOpen(v => !v)} hitSlop={8} style={s.langBtn}>
                    <Text style={s.langBtnTxt}>{langLabel(lang)}</Text>
                    <Text style={s.langArrow}>{langOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {langOpen ? (
                    <View style={s.langDrop}>
                      {langs.map(c => (
                        <TouchableOpacity key={c} onPress={() => pickLang(c)} style={[s.langItem, c === lang && s.langItemActive]}>
                          <Text style={[s.langItemTxt, c === lang && s.langItemTxtActive]}>{langLabel(c)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {voiceActive && (phase === 'email' || hasNarration) ? (
                <>
                  <TouchableOpacity onPress={() => { stopVoice(); setVoice(v => v === 'female' ? 'male' : 'female'); }} hitSlop={8} style={s.voiceGender}>
                    <Text style={s.voiceGenderTxt}>{voice === 'female' ? '♀' : '♂'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={toggleVoice} hitSlop={8} style={[s.voiceBtn, playing && s.voiceBtnActive]}>
                    <Text style={s.voiceBtnTxt}>{playing ? '■ Stop' : '▶ Listen'}</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        {phase === 'email' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.emailContent}>
            <View style={s.logoWrap}>
              <Image source={logoUri ? { uri: logoUri } : require('../../assets/Fly2Sky-logo.png')} style={s.logo} resizeMode="contain" />
            </View>
            <View style={s.mailHead}>
              <Text style={s.mailLine}><Text style={s.mailLbl}>From: </Text>ETL Administrator</Text>
              <Text style={s.mailLine}><Text style={s.mailLbl}>To: </Text>{previewRole ? `${roleLabel(previewRole)} (preview)` : (userName() || 'You')}</Text>
            </View>
            {emailSubject() ? <Text style={s.subject}>{emailSubject()}</Text> : null}
            <Text style={s.greeting}>{greeting}</Text>
            <Text style={s.email}>{body}</Text>
          </ScrollView>
        ) : phase === 'slide' ? (
          <ScrollView style={s.slideArea} contentContainerStyle={s.slideScroll}
            maximumZoomScale={3} minimumZoomScale={1} bouncesZoom showsVerticalScrollIndicator={false}>
            <TouchableOpacity activeOpacity={0.97} onPress={next}>
              <Image source={{ uri: slides[i] }} style={{ width: '100%', aspectRatio: 16 / 9 }} resizeMode="contain" />
            </TouchableOpacity>
            {/* When a non-English language is selected, show the translated narration as readable
                text below the slide image — the PNG is baked in English and can't be translated. */}
            {lang !== 'en' && narrationForSlide(i) ? (
              <View style={s.translatedBox}>
                <Text style={s.translatedLabel}>{langLabel(lang)}</Text>
                <Text style={s.translatedText}>{narrationForSlide(i)}</Text>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.ackContent}>
            <Text style={s.ackTitle}>Before you continue</Text>
            <Text style={s.ackSub}>You have read the welcome notice and the {roleLabel(ind!.role)} Quick Reference. Please confirm below {'—'} this is recorded and won{'’'}t be shown again.</Text>
            <TouchableOpacity style={s.checkRow} activeOpacity={0.8} onPress={() => setAgreed((v) => !v)}>
              <View style={[s.box, agreed && s.boxOn]}>{agreed ? <Text style={s.tick}>{'✓'}</Text> : null}</View>
              <Text style={s.checkLabel}>I have read and understood the welcome notice and the {roleLabel(ind!.role)} Quick Reference.<Text style={s.req}>  *required</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.checkRow, { marginTop: 12 }]} activeOpacity={0.8} onPress={() => setShowAgain((v) => !v)}>
              <View style={[s.box, showAgain && s.boxOn]}>{showAgain ? <Text style={s.tick}>{'✓'}</Text> : null}</View>
              <Text style={s.checkLabel}>Show me this welcome again at my next sign-in.<Text style={s.opt}>  (optional {'—'} you can always re-open it from {'“'}Welcome &amp; Quick Ref{'”'} on the menu)</Text></Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        <View style={s.bar}>
          {phase !== 'email' ? (
            <TouchableOpacity style={s.backBtn} onPress={back} activeOpacity={0.85}><Text style={s.backTxt}>{'‹'} Back</Text></TouchableOpacity>
          ) : null}
          {phase === 'ack' ? (
            <TouchableOpacity style={[s.btn, s.grow, !agreed && s.btnDisabled]} onPress={confirm} disabled={!agreed} activeOpacity={0.85}>
              <Text style={s.btnTxt}>Confirm &amp; finish</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.btn, s.grow]} onPress={next} activeOpacity={0.85}>
              <Text style={s.btnTxt}>
                {phase === 'email' ? (slides.length ? 'Read the Quick Reference  ›' : (mode === 'view' ? (previewRole ? 'Back to roles' : 'Close') : 'Continue  ›'))
                  : (lastSlide ? (mode === 'view' ? (previewRole ? 'Back to roles' : 'Close') : 'Continue to acknowledgement  ›') : 'Next  ›   (tap the slide · pinch to zoom)')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  header: { paddingTop: 44, paddingBottom: 10, paddingHorizontal: 18, backgroundColor: theme.panel, borderBottomWidth: 1, borderBottomColor: theme.border, zIndex: 10 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badge: { color: theme.accent, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  close: { color: theme.sub, fontWeight: '700', fontSize: 14 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, zIndex: 10 },
  voiceToggle: { backgroundColor: theme.bg, borderRadius: 14, width: 32, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border, opacity: 0.5 },
  voiceToggleOn: { opacity: 1, borderColor: theme.accent },
  voiceToggleTxt: { fontSize: 14 },
  voiceGender: { backgroundColor: theme.bg, borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  voiceGenderTxt: { fontSize: 16, color: theme.accent, fontWeight: '800' },
  voiceBtn: { backgroundColor: theme.accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  voiceBtnActive: { backgroundColor: theme.red },
  voiceBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.bg, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: theme.accent },
  langBtnTxt: { color: theme.accent, fontWeight: '700', fontSize: 12 },
  langArrow: { color: theme.accent, fontSize: 8 },
  langDrop: { position: 'absolute', top: 32, right: 0, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, minWidth: 140, zIndex: 100, ...Platform.select({ web: { boxShadow: '0 4px 12px rgba(0,0,0,0.4)' } as any, default: { elevation: 8 } }) },
  langItem: { paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  langItemActive: { backgroundColor: theme.accent },
  langItemTxt: { color: theme.text, fontSize: 13, fontWeight: '600' },
  langItemTxtActive: { color: '#fff' },
  emailContent: { padding: 22, width: '100%', maxWidth: 760, alignSelf: 'center' },
  logoWrap: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start', marginBottom: 16 },
  logo: { width: 200, height: 44 },
  mailHead: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 12, marginBottom: 14 },
  mailLine: { color: theme.text, fontSize: 14, lineHeight: 22 },
  mailLbl: { color: theme.sub, fontWeight: '700' },
  subject: { color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 14, lineHeight: 27 },
  greeting: { color: theme.text, fontSize: 15, lineHeight: 23, fontWeight: '700', marginBottom: 10 },
  email: { color: theme.text, fontSize: 15, lineHeight: 23 },
  req: { color: theme.red, fontSize: 12, fontWeight: '700' },
  opt: { color: theme.sub, fontSize: 12, fontWeight: '400' },
  slideArea: { flex: 1, backgroundColor: theme.bg },
  slideScroll: { flexGrow: 1, justifyContent: 'center', padding: 10, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  translatedBox: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 16, marginTop: 12 },
  translatedLabel: { color: theme.accent, fontWeight: '800', fontSize: 11, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  translatedText: { color: theme.text, fontSize: 14, lineHeight: 22 },
  ackContent: { padding: 24, width: '100%', maxWidth: 620, alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },
  ackTitle: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  ackSub: { color: theme.sub, fontSize: 14, lineHeight: 21, marginBottom: 22 },
  roleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 18, paddingHorizontal: 18, marginBottom: 12 },
  roleBtnTxt: { color: theme.text, fontSize: 16, fontWeight: '700' },
  roleBtnArrow: { color: theme.accent, fontSize: 20, fontWeight: '800' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 16 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: theme.sub, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: theme.green, borderColor: theme.green },
  tick: { color: '#fff', fontWeight: '900', fontSize: 16 },
  checkLabel: { color: theme.text, fontSize: 15, lineHeight: 22, flex: 1, fontWeight: '600' },
  bar: { flexDirection: 'row', alignItems: 'stretch' },
  backBtn: { backgroundColor: theme.panel, borderTopWidth: 1, borderRightWidth: 1, borderColor: theme.border, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: theme.text, fontWeight: '800', fontSize: 16 },
  btn: { backgroundColor: theme.accent, paddingVertical: 16, alignItems: 'center' },
  grow: { flex: 1 },
  btnDisabled: { opacity: 0.4 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
