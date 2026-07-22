import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appSettings, authMe, myFeedback, MyFeedback, submitFeedback } from '../api/client';
import { theme } from '../theme';

const CATS: { key: string; label: string }[] = [
  { key: 'bug', label: 'Bug' },
  { key: 'suggestion', label: 'Suggestion' },
  { key: 'question', label: 'Question' },
  { key: 'general', label: 'General' },
];

export default function FeedbackScreen() {
  const [category, setCategory] = useState('suggestion');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyFeedback[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailCopy, setEmailCopy] = useState(true);
  const [routing, setRouting] = useState<{ recipients?: { label: string; email: string; enabled: boolean }[]; default?: string }>({});
  const [dest, setDest] = useState<string>('');

  const loadMine = useCallback(() => { myFeedback().then(setMine).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => {
    loadMine();
    authMe().then((m) => { setName(m.name || m.username || ''); setEmail((e) => e || m.email || ''); }).catch(() => {});
    appSettings().then((sx: any) => {
      const r = sx.feedback_routing || {};
      setRouting(r);
      const enabled = (r.recipients || []).filter((x: any) => x.enabled && x.email);
      let d = r.default || (enabled[0]?.label) || '';
      if (d !== 'all' && !enabled.some((x: any) => x.label === d)) d = enabled[0]?.label || '';
      setDest(d);
    }).catch(() => {});
  }, [loadMine]));

  const enabledRecips = (routing.recipients || []).filter((x) => x.enabled && x.email);
  const destOpts = [
    ...enabledRecips.map((x) => ({ key: x.label, label: x.label })),
    ...(enabledRecips.length > 1 ? [{ key: 'all', label: 'All' }] : []),
  ];

  async function send() {
    if (!message.trim() || busy) return;
    setBusy(true); setStatus('');
    try {
      const { queued } = await submitFeedback({ message: message.trim(), category, screen: 'iPad', contact_email: email.trim() || undefined, email_copy: emailCopy, destination: destOpts.length ? dest : undefined });
      setMessage('');
      setStatus(queued ? 'Saved offline — it will be sent automatically when you reconnect. ✓' : (emailCopy ? 'Thank you — your feedback was sent (and emailed to the team). ✓' : 'Thank you — your feedback was sent. ✓'));
      loadMine();
    } catch (e: any) {
      setStatus(e.message || 'Could not send.');
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Feedback</Text>
      <Text style={s.sub}>Report a bug, suggest a change, or ask a question. During testing, this is the fastest way to reach the team. For a bug, include the steps to reproduce. Replies from the team appear below.</Text>

      <Text style={s.label}>Type</Text>
      <View style={s.catRow}>
        {CATS.map((c) => (
          <TouchableOpacity key={c.key} style={[s.cat, category === c.key && s.catOn]} onPress={() => setCategory(c.key)}>
            <Text style={[s.catText, category === c.key && s.catTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {destOpts.length > 1 ? (
        <>
          <Text style={s.label}>Send to</Text>
          <View style={s.catRow}>
            {destOpts.map((c) => (
              <TouchableOpacity key={c.key} style={[s.cat, dest === c.key && s.catOn]} onPress={() => setDest(c.key as any)}>
                <Text style={[s.catText, dest === c.key && s.catTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      <Text style={s.label}>From</Text>
      <View style={s.fromRow}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={s.fieldLbl}>Full name</Text>
          <View style={s.readonly}><Text style={s.readonlyText}>{name || '—'}</Text></View>
        </View>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={s.fieldLbl}>Email address</Text>
          <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Your email (any address)" placeholderTextColor={theme.sub}
            autoCapitalize="none" keyboardType="email-address" />
        </View>
      </View>

      <Text style={s.label}>Message</Text>
      <TextInput style={s.area} value={message} onChangeText={setMessage} multiline placeholder="Describe it…" placeholderTextColor={theme.sub} textAlignVertical="top" />

      <View style={s.emailRow}>
        <Switch value={emailCopy} onValueChange={setEmailCopy} />
        <Text style={s.emailLbl}>Also send by email to the team</Text>
      </View>

      <TouchableOpacity style={[s.btn, (!message.trim() || busy) && { opacity: 0.5 }]} onPress={send} disabled={!message.trim() || busy}>
        <Text style={s.btnText}>{busy ? 'Sending…' : (emailCopy ? 'Send feedback & email' : 'Send feedback')}</Text>
      </TouchableOpacity>
      {status ? <Text style={[s.status, status.includes('✓') && { color: theme.green }]}>{status}</Text> : null}

      {mine.length ? (
        <>
          <Text style={s.label}>Your messages &amp; replies</Text>
          {mine.map((f) => (
            <View key={f.id} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardCat}>{f.category.toUpperCase()}</Text>
                <Text style={s.cardStatus}>{f.status}</Text>
              </View>
              <Text style={s.cardMsg}>{f.message}</Text>
              {f.reply ? (
                <View style={s.reply}>
                  <Text style={s.replyHead}>↩ Reply{f.reply_by ? ` · ${f.reply_by}` : ''}</Text>
                  <Text style={s.replyMsg}>{f.reply}</Text>
                </View>
              ) : <Text style={s.awaiting}>Awaiting a reply…</Text>}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13, lineHeight: 19 },
  label: { color: theme.sub, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  catOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  catText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  catTextOn: { color: '#fff' },
  area: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 14, color: theme.text, fontSize: 15, minHeight: 150 },
  fromRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldLbl: { color: theme.sub, fontSize: 11, marginBottom: 4 },
  readonly: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  readonlyText: { color: theme.text, fontSize: 15 },
  input: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, color: theme.text, fontSize: 15 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  emailLbl: { color: theme.text, fontSize: 14 },
  btn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  status: { color: theme.sub, marginTop: 12, fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  cardCat: { color: theme.accent, fontWeight: '800', fontSize: 11 },
  cardStatus: { color: theme.sub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  cardMsg: { color: theme.text, fontSize: 14, marginTop: 4 },
  reply: { marginTop: 8, borderLeftWidth: 3, borderLeftColor: theme.green, paddingLeft: 10 },
  replyHead: { color: theme.green, fontWeight: '800', fontSize: 12 },
  replyMsg: { color: theme.text, fontSize: 14, marginTop: 2 },
  awaiting: { color: theme.sub, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
});
