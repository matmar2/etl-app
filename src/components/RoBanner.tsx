import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/** Shown when the signed-in role has read-only access to a page/field. */
export default function RoBanner({ text }: { text?: string }) {
  return (
    <View style={s.wrap}>
      <Text style={s.txt}>🔒 Read-only for your role{text ? ` — ${text}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: '#23303d', borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, marginTop: 10 },
  txt: { color: theme.sub, fontSize: 12, fontWeight: '700' },
});
