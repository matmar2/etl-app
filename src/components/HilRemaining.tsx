import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { theme } from '../theme';

const fhHM = (h?: number | null) => {                 // decimal FH -> hh:mm (negative clamps to 0)
  if (h == null) return '—';
  const v = Math.max(0, h);
  return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
};

// The three remaining columns for a deferred (HIL) item — Days / Hrs / Cycles — always shown,
// left-aligned with a large figure. A column reads "—" when that limit was not set; whichever
// remaining reaches zero (or below) shows red. Remaining is measured from the date the HIL was
// registered: Days count to the due date, Hrs/Cyc from the TSN/CSN stamped at deferral.
export default function HilRemaining({ item, style }: { item: any; style?: ViewStyle }) {
  const cols = [
    { label: 'Days', set: item.due_date != null, txt: item.remaining_days == null ? '—' : String(item.remaining_days), red: (item.remaining_days ?? 1) <= 0 },
    { label: 'Hrs', set: item.max_fh != null, txt: fhHM(item.remaining_fh), red: (item.remaining_fh ?? 1) <= 0 },
    { label: 'Cyc', set: item.max_cycles != null, txt: item.remaining_cycles == null ? '—' : String(item.remaining_cycles), red: (item.remaining_cycles ?? 1) <= 0 },
  ];
  const noneSet = cols.every((c) => !c.set);
  return (
    <View style={style}>
      <Text style={{ color: theme.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 }}>REMAINING</Text>
      {noneSet ? (
        <Text style={{ color: theme.sub, fontSize: 12 }}>no limit set — amend</Text>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          {cols.map((c) => (
            <View key={c.label} style={{ alignItems: 'flex-start', minWidth: 66 }}>
              <Text style={{ color: theme.sub, fontSize: 11, fontWeight: '600' }}>{c.label}</Text>
              <Text style={{ fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 26, color: !c.set ? theme.sub : (c.red ? theme.red : theme.text) }}>{c.set ? c.txt : '—'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
