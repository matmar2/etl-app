import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appSettings, authMe, feedbackMarkSeen, myFeedback, MyFeedback, replyToFeedback, submitFeedback } from '../api/client';
import { theme } from '../theme';

const CATS: { key: string; label: string }[] = [
  { key: 'bug', label: 'Bug' },
  { key: 'suggestion', label: 'Suggestion' },
  { key: 'question', label: 'Question' },
  { key: 'general', label: 'General' },
];

const API_BASE = Platform.OS === 'web'
  ? (typeof window !== 'undefined' ? (window as any).__ETL_API_BASE || '' : '')
  : '';

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const loadMine = useCallback(() => { myFeedback().then(setMine).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => {
    loadMine();
    feedbackMarkSeen().catch(() => {});
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

  async function sendReply(fid: string) {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    try {
      await replyToFeedback(fid, replyText.trim());
      setReplyText(''); setReplyTo(null);
      loadMine();
    } catch (e: any) {
      setStatus(e.message || 'Could not send reply.');
    } finally { setReplying(false); }
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
                <View style={s.cardStatusPill}><Text style={s.cardStatusText}>{f.status}</Text></View>
              </View>
              <Text style={s.cardMsg}>{f.message}</Text>

              {(f.replies || []).length > 0 ? (
                (f.replies || []).map((r, i) => (
                  <View key={i} style={[s.reply, { borderLeftColor: r.role === 'admin' ? theme.green : theme.accent }]}>
                    <Text style={[s.replyHead, { color: r.role === 'admin' ? theme.green : theme.accent }]}>
                      {r.role === 'admin' ? '↩' : '→'} {r.by}{r.role === 'admin' ? '' : ' (you)'} · {r.at ? r.at.slice(0, 16).replace('T', ' ') + 'z' : ''}
                    </Text>
                    <Text style={s.replyMsg}>{r.text || (r as any).message || ''}</Text>
                    {r.attachments && r.attachments.length > 0 ? (
                      <View style={s.attachRow}>
                        {r.attachments.map((a) => (
                          <TouchableOpacity key={a.id} style={s.attachChip} onPress={() => {
                            if (Platform.OS === 'web') {
                              window.open(`${API_BASE}/feedback/attachments/${a.id}`, '_blank');
                            }
                          }}>
                            <Text style={s.attachText}>{a.content_type?.startsWith('image/') ? '🖼 ' : '📎 '}{a.filename} ({fmtSize(a.size)})</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))
              ) : f.reply ? (
                <View style={s.reply}>
                  <Text style={s.replyHead}>↩ Reply{f.reply_by ? ` · ${f.reply_by}` : ''}</Text>
                  <Text style={s.replyMsg}>{f.reply}</Text>
                </View>
              ) : <Text style={s.awaiting}>Awaiting a reply…</Text>}

              {/* Reply form */}
              {replyTo === f.id ? (
                <View style={s.replyForm}>
                  <TextInput style={s.replyInput} value={replyText} onChangeText={setReplyText}
                    placeholder="Your reply…" placeholderTextColor={theme.sub} multiline textAlignVertical="top" />
                  <View style={s.replyBtns}>
                    <TouchableOpacity style={s.replyCancel} onPress={() => { setReplyTo(null); setReplyText(''); }}>
                      <Text style={s.replyCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.replySend, (!replyText.trim() || replying) && { opacity: 0.5 }]}
                      onPress={() => sendReply(f.id)} disabled={!replyText.trim() || replying}>
                      <Text style={s.replySendText}>{replying ? 'Sending…' : 'Send'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={s.replyBtn} onPress={() => { setReplyTo(f.id); setReplyText(''); }}>
                  <Text style={s.replyBtnText}>Reply</Text>
                </TouchableOpacity>
              )}
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
  cardStatusPill: { backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  cardStatusText: { color: theme.sub, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardMsg: { color: theme.text, fontSize: 14, marginTop: 4 },
  reply: { marginTop: 8, borderLeftWidth: 3, borderLeftColor: theme.green, paddingLeft: 10 },
  replyHead: { color: theme.green, fontWeight: '800', fontSize: 12 },
  replyMsg: { color: theme.text, fontSize: 14, marginTop: 2 },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  attachChip: { backgroundColor: theme.bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  attachText: { color: theme.sub, fontSize: 12 },
  awaiting: { color: theme.sub, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  replyBtn: { marginTop: 8, alignSelf: 'flex-start' },
  replyBtnText: { color: theme.accent, fontWeight: '700', fontSize: 13 },
  replyForm: { marginTop: 8 },
  replyInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, color: theme.text, fontSize: 14, minHeight: 60 },
  replyBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  replyCancel: { paddingVertical: 6, paddingHorizontal: 12 },
  replyCancelText: { color: theme.sub, fontWeight: '600', fontSize: 13 },
  replySend: { backgroundColor: theme.accent, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  replySendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
