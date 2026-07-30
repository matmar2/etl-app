/* EFF Help — User Guide + AI Assistant page (rail item) and the pilot login InductionGate.
   Mirrors the ETL GuideScreen/AssistantScreen/InductionGate, adapted to the self-contained EFF
   module. The guide + FAQ are cached (api.ts) so the guide works offline; the assistant falls back
   to the cached FAQ when there is no connectivity. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  ackInduction, askAssistant, AssistantReply, FaqItem, getInduction, GuidePage,
  helpFaq, helpGuide, Induction, inductionStatus, isOnlineSync,
} from './api';
import { S, T } from './theme';

const LOGO = require('../../assets/Fly2Sky-logo.png');

// ---------- tiny markdown renderer (headings, paragraphs, bullets, **bold**, blockquote) --------
function inline(text: string, base: any, key: string) {
  // split on **bold** — everything else is plain
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  return (
    <Text key={key} style={base}>
      {parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
        ? <Text key={i} style={{ fontWeight: '800', color: T.text }}>{p.slice(2, -2)}</Text>
        : <Text key={i}>{p}</Text>)}
    </Text>
  );
}

function Markdown({ md }: { md: string }) {
  const lines = (md || '').replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^#\s+/.test(ln)) { out.push(inline(ln.replace(/^#\s+/, ''), { color: T.text, fontSize: 22, fontWeight: '800', marginTop: 4, marginBottom: 10 }, 'h' + i)); i++; continue; }
    if (/^##\s+/.test(ln)) { out.push(inline(ln.replace(/^##\s+/, ''), { color: T.text, fontSize: 17, fontWeight: '800', marginTop: 16, marginBottom: 6 }, 'h' + i)); i++; continue; }
    if (/^###\s+/.test(ln)) { out.push(inline(ln.replace(/^###\s+/, ''), { color: T.accent, fontSize: 14.5, fontWeight: '800', marginTop: 12, marginBottom: 4 }, 'h' + i)); i++; continue; }
    if (/^\s*[-*]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push(
        <View key={'ul' + i} style={{ marginTop: 4, marginBottom: 6 }}>
          {items.map((it, k) => (
            <View key={k} style={{ flexDirection: 'row', marginBottom: 4 }}>
              <Text style={{ color: T.accent, marginRight: 8, lineHeight: 22 }}>•</Text>
              {inline(it, { color: T.sub, fontSize: 14.5, lineHeight: 22, flex: 1 }, 'li' + i + k)}
            </View>
          ))}
        </View>);
      continue;
    }
    if (/^>\s?/.test(ln)) {
      const q = ln.replace(/^>\s?/, '');
      out.push(
        <View key={'bq' + i} style={{ borderLeftWidth: 3, borderLeftColor: T.amber, paddingLeft: 10, marginVertical: 8 }}>
          {inline(q, { color: T.sub, fontSize: 14, lineHeight: 21, fontStyle: 'italic' }, 'bqt' + i)}
        </View>);
      i++; continue;
    }
    if (ln.trim() === '') { i++; continue; }
    out.push(inline(ln, { color: T.sub, fontSize: 14.5, lineHeight: 22, marginBottom: 6 }, 'p' + i));
    i++;
  }
  return <View>{out}</View>;
}

// ---------- Help page (rail item): User Guide + AI Assistant tabs ------------------------------
export function HelpPage() {
  const [tab, setTab] = useState<'guide' | 'assistant'>('guide');
  const [pages, setPages] = useState<GuidePage[] | null>(null);
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { helpGuide().then((p) => { setPages(p); if (p[0]) setOpen(p[0].slug); }); helpFaq().then(setFaq); }, []);

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {(['guide', 'assistant'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)}
            style={{ borderWidth: 1, borderColor: tab === t ? T.accent : T.line, backgroundColor: tab === t ? '#1c3050' : T.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: tab === t ? '#fff' : T.sub, fontWeight: '700', fontSize: 13 }}>{t === 'guide' ? '📖 User Guide' : '💬 AI Assistant'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'guide' ? (
        pages === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : (
          <View>
            {/* web→native: navigator.onLine → isOnlineSync() (updated by the storage adapter's probe) */}
            {!isOnlineSync()
              ? <Text style={{ color: T.amber, fontSize: 12, marginBottom: 10 }}>● Offline — showing the cached guide</Text> : null}
            {pages.map((p) => (
              <View key={p.slug} style={[S.card, { marginBottom: 10 }]}>
                <TouchableOpacity onPress={() => setOpen(open === p.slug ? null : p.slug)}
                  style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: T.text, fontSize: 15.5, fontWeight: '700', flex: 1 }}>{p.title}</Text>
                  <Text style={{ color: T.accent, fontSize: 16 }}>{open === p.slug ? '▾' : '›'}</Text>
                </TouchableOpacity>
                {open === p.slug ? <View style={{ marginTop: 10 }}><Markdown md={p.body_markdown} /></View> : null}
              </View>
            ))}
          </View>
        )
      ) : <Assistant faq={faq} />}
    </View>
  );
}

function Assistant({ faq }: { faq: FaqItem[] }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const ask = async () => {
    const question = q.trim(); if (!question || busy) return;
    setBusy(true); setReply(null);
    try { setReply(await askAssistant(question)); } finally { setBusy(false); }
  };
  return (
    <View>
      <View style={[S.card]}>
        <Text style={{ color: T.sub, fontSize: 13.5, lineHeight: 20, marginBottom: 10 }}>
          Ask how to do something in the EFF — e.g. “how do I complete the pre-flight fuel?” or “how do I bookmark a NOTAM?”. Answers come from the User Guide.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={q} onChangeText={setQ} placeholder="Type your question…" placeholderTextColor={T.sub}
            onSubmitEditing={ask} returnKeyType="send"
            style={[S.input, { flex: 1, height: 44 }]} />
          <TouchableOpacity onPress={ask} disabled={busy || !q.trim()} style={[S.btnPrimary, { minWidth: 92, opacity: busy || !q.trim() ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator color="#08120b" /> : <Text style={S.btnPrimaryTxt}>Ask</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {reply ? (
        <View style={[S.card, { marginTop: 12 }]}>
          <Markdown md={reply.answer} />
          {reply.sources?.length ? (
            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: T.line, paddingTop: 10 }}>
              <Text style={{ color: T.sub, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>From the guide</Text>
              {reply.sources.map((s) => (
                <Text key={s.slug} style={{ color: T.accent, fontSize: 13, marginBottom: 3 }}>• {s.title}</Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {!reply && faq.length ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: T.sub, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Common questions</Text>
          {faq.slice(0, 8).map((f, i) => (
            <TouchableOpacity key={i} onPress={() => { setQ(f.q); setReply({ answer: f.a, sources: [], mode: 'faq' }); }}
              style={[S.card, { marginBottom: 8 }]}>
              <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }}>{f.q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------- Pilot login induction gate ---------------------------------------------------------
// On first sign-in for a pilot, if the current induction version isn't acknowledged, a full-screen
// overlay shows the cover text then the Quick-Reference slides, dismissible only by acknowledging.
// Non-pilots (and already-acked pilots) never see it. Mirrors the ETL InductionGate behaviour.
type Phase = 'cover' | 'slide' | 'ack';

// Re-open the induction on demand (the sidebar "Welcome & Quick Ref" item) — same as ETL, where
// the briefing stays re-viewable after it has been acknowledged. Set by the mounted gate.
let _openInduction: (() => void) | null = null;
export function openInduction() { _openInduction?.(); }

export function InductionGate({ active }: { active: boolean }) {
  const [ind, setInd] = useState<Induction | null>(null);
  const [phase, setPhase] = useState<Phase>('cover');
  const [i, setI] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [review, setReview] = useState(false);       // re-opened from the sidebar (no ack needed)
  const shown = useRef(false);

  useEffect(() => {
    if (!active) { setInd(null); shown.current = false; return; }
    let alive = true;
    (async () => {
      try {
        const st = await inductionStatus();
        if (!alive || !st.show || shown.current) return;
        const p = await getInduction();
        if (!alive || !(p.slides?.length || p.cover_html)) return;
        shown.current = true;
        setReview(false); setInd(p); setPhase('cover'); setI(0); setAgreed(false);
      } catch { /* offline / not required — no gate */ }
    })();
    return () => { alive = false; };
  }, [active]);

  // Sidebar trigger — load and show in review mode (dismissible with ✕, never re-marks the ack).
  useEffect(() => {
    _openInduction = () => {
      getInduction().then((p) => {
        if (!(p.slides?.length || p.cover_html)) return;
        setReview(true); setInd(p); setPhase('cover'); setI(0); setAgreed(false);
      }).catch(() => {});
    };
    return () => { _openInduction = null; };
  }, []);

  if (!ind) return null;
  const slides = ind.slides || [];
  const lastSlide = i + 1 >= slides.length;

  const confirm = () => { if (!agreed) return; ackInduction(ind.version); setInd(null); };
  const next = () => {
    if (phase === 'cover') { setPhase(slides.length ? 'slide' : 'ack'); return; }
    if (phase === 'slide') { if (!lastSlide) { setI(i + 1); return; } setPhase('ack'); }
  };
  const back = () => {
    if (phase === 'ack') { if (slides.length) { setI(Math.max(0, slides.length - 1)); setPhase('slide'); } else setPhase('cover'); return; }
    if (phase === 'slide') { i > 0 ? setI(i - 1) : setPhase('cover'); }
  };

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ paddingTop: 44, paddingBottom: 12, paddingHorizontal: 18, backgroundColor: T.panel, borderBottomWidth: 1, borderBottomColor: T.line, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: T.accent, fontWeight: '800', fontSize: 13, letterSpacing: 1, flex: 1 }}>
            {phase === 'cover' ? (review ? '👋  WELCOME & QUICK REFERENCE' : '✉  WELCOME — PLEASE READ')
              : phase === 'slide' ? `📊  QUICK REFERENCE · ${i + 1} / ${slides.length}`
              : '✓  ACKNOWLEDGEMENT'}
          </Text>
          {review ? (
            <TouchableOpacity onPress={() => setInd(null)} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ color: T.sub, fontSize: 15, fontWeight: '800' }}>✕  Close</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {phase === 'cover' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start', marginBottom: 16 }}>
              <Image source={LOGO} style={{ width: 200, height: 44, resizeMode: 'contain' } as any} />
            </View>
            {ind.title ? <Text style={{ color: T.text, fontSize: 21, fontWeight: '800', marginBottom: 12, lineHeight: 28 }}>{ind.title}</Text> : null}
            <CoverHtml html={ind.cover_html || ''} />
          </ScrollView>
        ) : phase === 'slide' ? (
          <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 10, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
            <TouchableOpacity activeOpacity={0.97} onPress={next}>
              <Image source={{ uri: slides[i] }} style={{ width: '100%', aspectRatio: 16 / 9 }} resizeMode="contain" />
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, width: '100%', maxWidth: 620, alignSelf: 'center', flexGrow: 1, justifyContent: 'center' }}>
            <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Before you continue</Text>
            <Text style={{ color: T.sub, fontSize: 14, lineHeight: 21, marginBottom: 22 }}>You have read the welcome notice and the EFF Quick Reference. Please confirm below — this is recorded and won’t be shown again.</Text>
            <TouchableOpacity onPress={() => setAgreed((v) => !v)} activeOpacity={0.8}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 16 }}>
              <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: agreed ? T.green : T.sub, backgroundColor: agreed ? T.green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {agreed ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>✓</Text> : null}
              </View>
              <Text style={{ color: T.text, fontSize: 15, lineHeight: 22, flex: 1, fontWeight: '600' }}>I have read and understood the welcome notice and the EFF Quick Reference.<Text style={{ color: T.red, fontSize: 12, fontWeight: '700' }}>  *required</Text></Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          {phase !== 'cover' ? (
            <TouchableOpacity onPress={back} activeOpacity={0.85} style={{ backgroundColor: T.panel, borderTopWidth: 1, borderRightWidth: 1, borderColor: T.line, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: T.text, fontWeight: '800', fontSize: 16 }}>‹ Back</Text>
            </TouchableOpacity>
          ) : null}
          {phase === 'ack' ? (
            <TouchableOpacity onPress={confirm} disabled={!agreed} activeOpacity={0.85} style={{ flex: 1, backgroundColor: T.green, paddingVertical: 16, alignItems: 'center', opacity: agreed ? 1 : 0.4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Confirm &amp; finish</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={next} activeOpacity={0.85} style={{ flex: 1, backgroundColor: T.accent, paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                {phase === 'cover' ? (slides.length ? 'Read the Quick Reference  ›' : 'Continue  ›') : (lastSlide ? 'Continue to acknowledgement  ›' : 'Next  ›   (tap the slide)')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Minimal HTML→text renderer for the cover (paragraphs + <b>) — no external libraries.
function CoverHtml({ html }: { html: string }) {
  const paras = html.split(/<\/p>/i).map((s) => s.replace(/<p[^>]*>/i, '').trim()).filter(Boolean);
  return (
    <View>
      {paras.map((p, i) => {
        const parts = p.split(/(<b>[\s\S]*?<\/b>|<br\s*\/?>)/i);
        return (
          <Text key={i} style={{ color: T.text, fontSize: 15, lineHeight: 23, marginBottom: 12 }}>
            {parts.map((seg, k) => {
              if (/^<br/i.test(seg)) return '\n';
              if (/^<b>/i.test(seg)) return <Text key={k} style={{ fontWeight: '800' }}>{seg.replace(/<\/?b>/gi, '')}</Text>;
              return <Text key={k}>{seg.replace(/<[^>]+>/g, '')}</Text>;
            })}
          </Text>
        );
      })}
    </View>
  );
}
