import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { theme } from '../theme';

const fhHM = (h?: number | null) => {                 // decimal FH -> hh:mm (negative clamps to 0)
  if (h == null) return '—';
  const v = Math.max(0, h);
  return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
};

// The three remaining columns for a deferred (HIL) item — Days / Hrs / Cycles — always shown.
// A column reads "—" when that limit was not set; whichever remaining reaches zero shows red.
export default function HilRemaining({ item, style }: { item: any; style?: ViewStyle }) {
  const cols = [
    { label: 'Days', set: item.due_date != null, txt: item.remaining_days == null ? '—' : String(item.remaining_days), red: (item.remaining_days ?? 1) <= 0 },
    { label: 'Hrs', set: item.max_fh != null, txt: fhHM(item.remaining_fh), red: (item.remaining_fh ?? 1) <= 0 },
    { label: 'Cyc', set: item.max_cycles != null, txt: item.remaining_cycles == null ? '—' : String(item.remaining_cycles), red: (item.remaining_cycles ?? 1) <= 0 },
  ];
  const noneSet = cols.every((c) => !c.set);
  return (
    <View style={style}>
      <Text style={{ color: theme.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginBottom: 3 }}>REMAINING</Text>
      {noneSet ? (
        <Text style={{ color: theme.sub, fontSize: 11 }}>no limit set — amend</Text>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          {cols.map((c) => (
            <View key={c.label} style={{ alignItems: 'center', minWidth: 50 }}>
              <Text style={{ color: theme.sub, fontSize: 10 }}>{c.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], color: !c.set ? theme.sub : (c.red ? theme.red : theme.text) }}>{c.set ? c.txt : '—'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
