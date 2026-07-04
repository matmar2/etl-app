import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DocItem, documentsList, openDocument } from '../api/client';
import { theme } from '../theme';

export default function DocumentsScreen() {
  const [docs, setDocs] = useState<DocItem[] | null>(null);

  useEffect(() => { documentsList('document').then(setDocs).catch(() => setDocs([])); }, []);

  async function open(d: DocItem) {
    try { await openDocument(d.id); } catch (e: any) { Alert.alert(d.title, e.message); }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Documents</Text>
      <Text style={s.sub}>Controlled documents published by the CAMO/admin. Read-only.</Text>
      {docs === null ? <ActivityIndicator style={{ marginTop: 20 }} /> :
        docs.length === 0 ? <Text style={[s.sub, { marginTop: 20 }]}>No documents published yet.</Text> :
        docs.map((d) => (
          <TouchableOpacity key={d.id} style={s.row} onPress={() => open(d)}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{d.title}</Text>
              <Text style={s.meta}>{d.filename}{d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''}</Text>
            </View>
            <Text style={s.open}>Open</Text>
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginTop: 10 },
  name: { color: theme.text, fontWeight: '700', fontSize: 15 },
  meta: { color: theme.sub, fontSize: 12, marginTop: 2 },
  open: { color: theme.accent, fontWeight: '800' },
});
