import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { guidePages, GuidePage } from '../api/client';
import { Markdown } from '../util/miniMarkdown';
import { theme } from '../theme';

export default function GuideScreen({ navigation }: any) {
  const [pages, setPages] = useState<GuidePage[] | null>(null);
  const [cached, setCached] = useState(false);
  const [open, setOpen] = useState<GuidePage | null>(null);

  useEffect(() => { guidePages().then(({ pages, cached }) => { setPages(pages); setCached(cached); }).catch(() => setPages([])); }, []);

  if (open) {
    return (
      <ScrollView style={s.wrap} contentContainerStyle={s.content}>
        <TouchableOpacity onPress={() => setOpen(null)}><Text style={s.back}>‹ All topics</Text></TouchableOpacity>
        <Text style={s.section}>{open.section}</Text>
        <Markdown body={open.body} />
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  const bySection: Record<string, GuidePage[]> = {};
  (pages || []).forEach((p) => (bySection[p.section] ??= []).push(p));

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <Text style={s.title}>User Guide</Text>
      <Text style={s.sub}>How to use the Electronic Tech Log.{cached ? '  ·  Offline copy' : ''}</Text>
      {pages === null ? <ActivityIndicator style={{ marginTop: 24 }} /> :
        pages.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>Guide not available offline yet — open it once while online.</Text> :
        Object.entries(bySection).map(([sec, list]) => (
          <View key={sec} style={{ marginTop: 16 }}>
            <Text style={s.secHead}>{sec}</Text>
            {list.map((p) => (
              <TouchableOpacity key={p.slug} style={s.row} onPress={() => setOpen(p)}>
                <Text style={s.rowTitle}>{p.title}</Text>
                <Text style={s.chev}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  secHead: { color: theme.sub, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginBottom: 8 },
  rowTitle: { color: theme.text, fontWeight: '700', fontSize: 15, flex: 1 },
  chev: { color: theme.sub, fontSize: 22 },
  back: { color: theme.accent, fontWeight: '700', fontSize: 14, marginBottom: 10 },
  section: { color: theme.sub, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
});
