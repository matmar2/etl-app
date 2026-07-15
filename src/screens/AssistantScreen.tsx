import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { assistantAsk, assistantFaq, guidePages, AssistSource, Faq } from '../api/client';
import { Markdown } from '../util/miniMarkdown';
import { theme } from '../theme';

type Turn = { q: string; answer: string; sources: AssistSource[]; mode: string };

export default function AssistantScreen() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [faq, setFaq] = useState<Faq[]>([]);
  const [search, setSearch] = useState('');            // filter the common questions
  const [open, setOpen] = useState<number | null>(null);   // expanded accordion item
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    assistantFaq().then(setFaq).catch(() => {});
    guidePages().catch(() => {});          // warm the guide cache so offline Q&A is ready
  }, []);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ(''); setBusy(true);
    try {
      const r = await assistantAsk(text);
      setTurns((t) => [...t, { q: text, answer: r.answer, sources: r.sources || [], mode: r.mode }]);
    } catch (e: any) {
      setTurns((t) => [...t, { q: text, answer: 'Sorry — something went wrong.', sources: [], mode: 'error' }]);
    } finally { setBusy(false); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }
  }

  const offline = (m: string) => m.startsWith('offline');
  const nq = search.trim().toLowerCase();
  const shown = nq ? faq.filter((f) => (f.q + ' ' + f.a).toLowerCase().includes(nq)) : faq;

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={s.content}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.title}>AI Assistant</Text>
          {turns.length > 0 ? (
            <TouchableOpacity style={s.closeBtn} onPress={() => { setTurns([]); setQ(''); }}>
              <Text style={s.closeTxt}>✕  Close</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={s.sub}>Ask how to use the app — tap a question or type your own. Works offline from the cached User Guide; full answers when online.</Text>

        {turns.length === 0 ? (
          <View style={{ marginTop: 16 }}>
            <Text style={s.faqHead}>Common questions</Text>
            <TextInput style={s.searchBox} value={search} onChangeText={(v) => { setSearch(v); setOpen(null); }}
              placeholder="🔍  Search questions…" placeholderTextColor={theme.sub} autoCorrect={false} clearButtonMode="while-editing" />
            {shown.length === 0 ? (
              <Text style={s.noMatch}>No matching question. Type it in the box below to ask the assistant.</Text>
            ) : shown.map((f, i) => {
              const isOpen = open === i;
              return (
                <View key={i} style={[s.accItem, isOpen && s.accItemOpen]}>
                  <TouchableOpacity style={s.accHead} activeOpacity={0.7} onPress={() => setOpen(isOpen ? null : i)}>
                    <Text style={s.accQ}>{f.q}</Text>
                    <Text style={s.chev}>{isOpen ? '▲' : '▾'}</Text>
                  </TouchableOpacity>
                  {isOpen ? (
                    <View style={s.accBody}>
                      <Markdown body={f.a} />
                      <TouchableOpacity onPress={() => ask(f.q)}><Text style={s.askMore}>Ask the assistant for a fuller answer  →</Text></TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}
            <Text style={s.hint}>Tap a question to see the answer, or type your own below — it answers from the User Guide, offline too.</Text>
          </View>
        ) : turns.map((t, i) => (
          <View key={i} style={{ marginTop: 14 }}>
            <View style={s.qBubble}><Text style={s.qText}>{t.q}</Text></View>
            <View style={s.aBubble}>
              {offline(t.mode) ? <Text style={s.offline}>● Offline answer</Text> : t.mode === 'ai' ? <Text style={s.ai}>● Assistant</Text> : null}
              <Markdown body={t.answer} />
              {t.sources.map((src) => (
                <View key={src.slug} style={s.src}>
                  <Text style={s.srcTitle}>{src.title}</Text>
                  <Text style={s.srcSnip} numberOfLines={6}>{src.snippet}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
        {busy ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={s.barRow}>
        <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Ask a question…" placeholderTextColor={theme.sub}
          onSubmitEditing={() => ask(q)} returnKeyType="send" editable={!busy} />
        <TouchableOpacity style={[s.send, (!q.trim() || busy) && { opacity: 0.5 }]} onPress={() => ask(q)} disabled={!q.trim() || busy}>
          <Text style={s.sendText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  faqHead: { color: theme.sub, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  closeBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  closeTxt: { color: theme.sub, fontWeight: '700', fontSize: 13 },
  hint: { color: theme.sub, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  searchBox: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, color: theme.text, fontSize: 15, marginBottom: 10 },
  noMatch: { color: theme.sub, fontSize: 13, paddingVertical: 10, fontStyle: 'italic' },
  accItem: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  accItemOpen: { borderColor: theme.accent },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14 },
  accQ: { color: theme.text, fontSize: 14, fontWeight: '600', flex: 1, paddingRight: 10 },
  chev: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  accBody: { paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 },
  askMore: { color: theme.accent, fontSize: 13, fontWeight: '700', marginTop: 8 },
  qBubble: { alignSelf: 'flex-end', backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, maxWidth: '85%' },
  qText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  aBubble: { alignSelf: 'flex-start', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 12, marginTop: 6, maxWidth: '95%' },
  offline: { color: theme.sub, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  ai: { color: theme.green, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  src: { marginTop: 8, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 6 },
  srcTitle: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  srcSnip: { color: theme.sub, fontSize: 12, marginTop: 2, lineHeight: 17 },
  barRow: { flexDirection: 'row', padding: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg, alignItems: 'center', gap: 8 },
  input: { flex: 1, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, color: theme.text, fontSize: 15 },
  send: { backgroundColor: theme.accent, borderRadius: 22, paddingVertical: 10, paddingHorizontal: 18 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
