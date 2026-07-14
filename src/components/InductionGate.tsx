import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ackInduction, Induction, pendingInduction, roleLabel, userName, viewInduction } from '../api/client';
import { theme } from '../theme';

type Phase = 'email' | 'slide' | 'ack';

// Module hooks so the Main Menu can (a) trigger the auto-check on login and (b) re-open the
// induction on demand ("view again") from a tile.
let _poke: (() => void) | null = null;
let _open: (() => void) | null = null;
export function pokeInduction() { _poke?.(); }
export function openInduction() { _open?.(); }

// Full-screen role induction: the cover email (from ETL Administrator) first, then the role
// Quick-Reference slides one at a time, then a final acknowledgement check box.
//  • auto mode  — shown on login until the user ticks the box + Confirm (then never again);
//  • view mode  — re-opened on demand from the menu, closeable anytime, no acknowledgement.
export default function InductionGate() {
  const [ind, setInd] = useState<Induction | null>(null);
  const [mode, setMode] = useState<'auto' | 'view'>('auto');
  const [phase, setPhase] = useState<Phase>('email');
  const [i, setI] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [showAgain, setShowAgain] = useState(false);   // opt to see the welcome again next sign-in
  const showing = useRef(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      if (!alive || showing.current) return;
      if (!userName()) { setInd(null); return; }            // only while signed in
      try {
        const p = await pendingInduction();
        if (alive && p && (p.slides?.length || p.email_body)) start(p, 'auto');
      } catch { /* offline handled in client */ }
    }
    async function open() {
      if (showing.current) return;
      const p = await viewInduction();
      if (alive && p && (p.slides?.length || p.email_body)) start(p, 'view');
    }
    function start(p: Induction, m: 'auto' | 'view') {
      showing.current = true; setMode(m); setPhase('email'); setI(0); setAgreed(false); setShowAgain(false); setInd(p);
    }
    _poke = tick; _open = open; tick();
    const t = setInterval(tick, 20000);
    return () => { alive = false; _poke = null; _open = null; clearInterval(t); };
  }, []);

  if (!ind) return null;
  const slides = ind.slides || [];
  const lastSlide = i + 1 >= slides.length;
  // Personalised greeting (title + full name); drop the generic "Dear Colleagues," from the body.
  const greeting = `Dear ${roleLabel()}${userName() ? ` ${userName()}` : ''},`;
  const body = (ind.email_body || '').replace(/^\s*Dear[^\n]*,?\s*\n+/i, '');

  function close() { showing.current = false; setInd(null); }
  function confirm() {
    if (!agreed) return;
    if (!showAgain) ackInduction(ind!.version);            // if they want to see it again, don't record the ack
    close();
  }
  function next() {
    if (phase === 'email') { setPhase(slides.length ? 'slide' : (mode === 'view' ? 'email' : 'ack')); if (!slides.length && mode === 'view') close(); return; }
    if (phase === 'slide') {
      if (!lastSlide) { setI(i + 1); return; }
      mode === 'view' ? close() : setPhase('ack');
    }
  }
  function back() {
    if (phase === 'ack') { setI(Math.max(0, slides.length - 1)); setPhase('slide'); return; }
    if (phase === 'slide') { i > 0 ? setI(i - 1) : setPhase('email'); }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => mode === 'view' && close()}>
      <View style={s.wrap}>
        <View style={s.header}>
          <Text style={s.badge}>
            {phase === 'email' ? '✉  WELCOME — PLEASE READ'
              : phase === 'slide' ? `📊  QUICK REFERENCE · ${i + 1} / ${slides.length}`
              : '✓  ACKNOWLEDGEMENT'}
          </Text>
          {mode === 'view' ? <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>✕ Close</Text></TouchableOpacity> : null}
        </View>

        {phase === 'email' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.emailContent}>
            <View style={s.logoWrap}>
              <Image source={require('../../assets/Fly2Sky-logo.png')} style={s.logo} resizeMode="contain" />
            </View>
            <View style={s.mailHead}>
              <Text style={s.mailLine}><Text style={s.mailLbl}>From: </Text>ETL Administrator</Text>
              <Text style={s.mailLine}><Text style={s.mailLbl}>To: </Text>{userName() || 'You'}</Text>
            </View>
            {ind.email_subject ? <Text style={s.subject}>{ind.email_subject}</Text> : null}
            <Text style={s.greeting}>{greeting}</Text>
            <Text style={s.email}>{body}</Text>
          </ScrollView>
        ) : phase === 'slide' ? (
          <TouchableOpacity style={s.slideArea} activeOpacity={0.96} onPress={next}>
            <Image source={{ uri: slides[i] }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          </TouchableOpacity>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.ackContent}>
            <Text style={s.ackTitle}>Before you continue</Text>
            <Text style={s.ackSub}>You have read the welcome notice and the {roleLabel(ind.role)} Quick Reference. Please confirm below — this is recorded and won’t be shown again.</Text>
            <TouchableOpacity style={s.checkRow} activeOpacity={0.8} onPress={() => setAgreed((v) => !v)}>
              <View style={[s.box, agreed && s.boxOn]}>{agreed ? <Text style={s.tick}>✓</Text> : null}</View>
              <Text style={s.checkLabel}>I have read and understood the welcome notice and the {roleLabel(ind.role)} Quick Reference.<Text style={s.req}>  *required</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.checkRow, { marginTop: 12 }]} activeOpacity={0.8} onPress={() => setShowAgain((v) => !v)}>
              <View style={[s.box, showAgain && s.boxOn]}>{showAgain ? <Text style={s.tick}>✓</Text> : null}</View>
              <Text style={s.checkLabel}>Show me this welcome again at my next sign-in.<Text style={s.opt}>  (optional — you can always re-open it from “Welcome &amp; Quick Ref” on the menu)</Text></Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        <View style={s.bar}>
          {phase !== 'email' ? (
            <TouchableOpacity style={s.backBtn} onPress={back} activeOpacity={0.85}><Text style={s.backTxt}>‹ Back</Text></TouchableOpacity>
          ) : null}
          {phase === 'ack' ? (
            <TouchableOpacity style={[s.btn, s.grow, !agreed && s.btnDisabled]} onPress={confirm} disabled={!agreed} activeOpacity={0.85}>
              <Text style={s.btnTxt}>Confirm &amp; finish</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.btn, s.grow]} onPress={next} activeOpacity={0.85}>
              <Text style={s.btnTxt}>
                {phase === 'email' ? (slides.length ? 'Read the Quick Reference  ›' : (mode === 'view' ? 'Close' : 'Continue  ›'))
                  : (lastSlide ? (mode === 'view' ? 'Close' : 'Continue to acknowledgement  ›') : 'Next  ›   (or tap the slide)')}
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
  header: { paddingTop: 44, paddingBottom: 12, paddingHorizontal: 18, backgroundColor: theme.panel, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { color: theme.accent, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  close: { color: theme.sub, fontWeight: '700', fontSize: 14 },
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
  slideArea: { flex: 1, backgroundColor: '#000', padding: 8 },
  ackContent: { padding: 24, width: '100%', maxWidth: 620, alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },
  ackTitle: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  ackSub: { color: theme.sub, fontSize: 14, lineHeight: 21, marginBottom: 22 },
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
