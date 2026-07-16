import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ackInduction, Induction, pendingInduction, role, roleLabel, userName, viewInduction } from '../api/client';
import { theme } from '../theme';

type Phase = 'email' | 'slide' | 'ack';

// admin / CAMO oversee all roles, so their "Welcome & Quick Ref" is a picker over every role's deck.
const PREVIEW_ROLES: { role: string; label: string }[] = [
  { role: 'captain', label: 'Captain' },
  { role: 'pilot', label: 'First Officer' },
  { role: 'cabin', label: 'Cabin Crew' },
  { role: 'mechanic', label: 'Mechanic' },
  { role: 'admin', label: 'Application Overview' },
];

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
//  • admin/CAMO — a role PICKER (preview every role's deck); no acknowledgement.
export default function InductionGate() {
  const [ind, setInd] = useState<Induction | null>(null);
  const [mode, setMode] = useState<'auto' | 'view'>('auto');
  const [phase, setPhase] = useState<Phase>('email');
  const [i, setI] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [showAgain, setShowAgain] = useState(false);   // opt to see the welcome again next sign-in
  const [chooser, setChooser] = useState(false);       // admin/CAMO role picker is open
  const [previewRole, setPreviewRole] = useState<string | null>(null);   // role being previewed by admin/CAMO
  const showing = useRef(false);

  function start(p: Induction, m: 'auto' | 'view', pr?: string | null) {
    showing.current = true; setMode(m); setPhase('email'); setI(0); setAgreed(false); setShowAgain(false);
    setPreviewRole(pr ?? null); setInd(p);
  }
  async function pickRole(rl: string) {
    let p: Induction | null = null;
    try { p = await viewInduction(rl); } catch { /* offline */ }
    if (p && (p.slides?.length || p.email_body)) start(p, 'view', rl);
    else {
      const msg = 'That Quick Reference isn’t available offline — open it once online to cache it.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); } else Alert.alert('Quick Reference', msg);
    }
  }
  function toRoles() { setInd(null); setPreviewRole(null); }   // back to the picker (admin/CAMO)
  function close() { showing.current = false; setInd(null); setChooser(false); setPreviewRole(null); }

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
      const r = role();
      if (r === 'admin' || r === 'camo') { showing.current = true; setInd(null); setPreviewRole(null); setChooser(true); return; }
      let p: Induction | null = null;
      try { p = await viewInduction(); } catch { /* offline/error handled below */ }
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
            <Text style={s.badge}>👋  WELCOME &amp; QUICK REF</Text>
            <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>✕ Close</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.emailContent}>
            <Text style={s.ackTitle}>Choose a role to view</Text>
            <Text style={s.ackSub}>As administration / CAMO you can preview the Welcome &amp; Quick Reference each role receives.</Text>
            {PREVIEW_ROLES.map((r) => (
              <TouchableOpacity key={r.role} style={s.roleBtn} onPress={() => pickRole(r.role)} activeOpacity={0.85}>
                <Text style={s.roleBtnTxt}>{r.label}</Text>
                <Text style={s.roleBtnArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    );
  }

  const slides = ind!.slides || [];
  const lastSlide = i + 1 >= slides.length;
  // Greeting: for a normal user it's "Dear <Role> <name>,"; for an admin/CAMO preview it's the
  // previewed role, with no personal name (they're viewing someone else's induction).
  const greeting = previewRole
    ? `Dear ${roleLabel(previewRole)},`
    : `Dear ${roleLabel()}${userName() ? ` ${userName()}` : ''},`;
  const body = (ind!.email_body || '').replace(/^\s*Dear[^\n]*,?\s*\n+/i, '');

  function confirm() {
    if (!agreed) return;
    if (!showAgain) ackInduction(ind!.version);            // if they want to see it again, don't record the ack
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
          <Text style={s.badge}>
            {phase === 'email' ? (previewRole ? `✉  ${roleLabel(previewRole).toUpperCase()} — WELCOME` : '✉  WELCOME — PLEASE READ')
              : phase === 'slide' ? `📊  QUICK REFERENCE · ${i + 1} / ${slides.length}`
              : '✓  ACKNOWLEDGEMENT'}
          </Text>
          {previewRole ? <TouchableOpacity onPress={toRoles} hitSlop={12}><Text style={s.close}>‹ Roles</Text></TouchableOpacity>
            : mode === 'view' ? <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>✕ Close</Text></TouchableOpacity> : null}
        </View>

        {phase === 'email' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.emailContent}>
            <View style={s.logoWrap}>
              <Image source={require('../../assets/Fly2Sky-logo.png')} style={s.logo} resizeMode="contain" />
            </View>
            <View style={s.mailHead}>
              <Text style={s.mailLine}><Text style={s.mailLbl}>From: </Text>ETL Administrator</Text>
              <Text style={s.mailLine}><Text style={s.mailLbl}>To: </Text>{previewRole ? `${roleLabel(previewRole)} (preview)` : (userName() || 'You')}</Text>
            </View>
            {ind!.email_subject ? <Text style={s.subject}>{ind!.email_subject}</Text> : null}
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
            <Text style={s.ackSub}>You have read the welcome notice and the {roleLabel(ind!.role)} Quick Reference. Please confirm below — this is recorded and won’t be shown again.</Text>
            <TouchableOpacity style={s.checkRow} activeOpacity={0.8} onPress={() => setAgreed((v) => !v)}>
              <View style={[s.box, agreed && s.boxOn]}>{agreed ? <Text style={s.tick}>✓</Text> : null}</View>
              <Text style={s.checkLabel}>I have read and understood the welcome notice and the {roleLabel(ind!.role)} Quick Reference.<Text style={s.req}>  *required</Text></Text>
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
                {phase === 'email' ? (slides.length ? 'Read the Quick Reference  ›' : (mode === 'view' ? (previewRole ? 'Back to roles' : 'Close') : 'Continue  ›'))
                  : (lastSlide ? (mode === 'view' ? (previewRole ? 'Back to roles' : 'Close') : 'Continue to acknowledgement  ›') : 'Next  ›   (or tap the slide)')}
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
