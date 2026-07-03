import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

// Minimal Markdown renderer for the User Guide (no external lib in Expo Go).
// Supports: # / ## / ### headings, - / * bullets, 1. numbered lists, **bold**, blank-line paragraphs.

function inline(text: string, keyBase: string) {
  // split on **bold** spans
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '');
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <Text key={`${keyBase}-b${i}`} style={s.bold}>{p.slice(2, -2)}</Text>
      : <Text key={`${keyBase}-t${i}`}>{p}</Text>);
}

export function Markdown({ body }: { body: string }) {
  const lines = (body || '').replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) { out.push(<View key={`sp${i}`} style={{ height: 8 }} />); return; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.*)/))) out.push(<Text key={i} style={s.h1}>{inline(m[1], `h1${i}`)}</Text>);
    else if ((m = line.match(/^##\s+(.*)/))) out.push(<Text key={i} style={s.h2}>{inline(m[1], `h2${i}`)}</Text>);
    else if ((m = line.match(/^###\s+(.*)/))) out.push(<Text key={i} style={s.h3}>{inline(m[1], `h3${i}`)}</Text>);
    else if ((m = line.match(/^\s*[-*]\s+(.*)/)))
      out.push(<View key={i} style={s.li}><Text style={s.bullet}>•</Text><Text style={s.liText}>{inline(m[1], `li${i}`)}</Text></View>);
    else if ((m = line.match(/^\s*(\d+)\.\s+(.*)/)))
      out.push(<View key={i} style={s.li}><Text style={s.num}>{m[1]}.</Text><Text style={s.liText}>{inline(m[2], `ol${i}`)}</Text></View>);
    else out.push(<Text key={i} style={s.p}>{inline(line, `p${i}`)}</Text>);
  });
  return <View>{out}</View>;
}

const s = StyleSheet.create({
  h1: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 6, marginBottom: 6 },
  h2: { color: theme.text, fontSize: 17, fontWeight: '800', marginTop: 12, marginBottom: 4 },
  h3: { color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 10, marginBottom: 2 },
  p: { color: theme.text, fontSize: 14, lineHeight: 21, marginBottom: 2 },
  bold: { fontWeight: '800', color: theme.text },
  li: { flexDirection: 'row', marginBottom: 3, paddingLeft: 4 },
  bullet: { color: theme.accent, fontSize: 14, lineHeight: 21, width: 16 },
  num: { color: theme.accent, fontSize: 14, lineHeight: 21, width: 22, fontWeight: '700' },
  liText: { color: theme.text, fontSize: 14, lineHeight: 21, flex: 1 },
});
