import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { clockOffsetSeconds } from '../api/client';
import { theme } from '../theme';

// Warns the crew if this iPad's clock differs from the server's UTC by more than the
// threshold — OOOI times are stamped from the device clock, so a wrong clock = wrong
// legal times. Quiet when in sync or offline.
export default function ClockBanner({ thresholdSec = 60 }: { thresholdSec?: number }) {
  const [off, setOff] = useState<number | null>(null);
  useEffect(() => { clockOffsetSeconds().then(setOff).catch(() => {}); }, []);
  if (off == null || Math.abs(off) <= thresholdSec) return null;
  const ahead = off < 0;
  const a = Math.abs(off);
  const amt = a >= 120 ? `~${Math.round(a / 60)} min` : `${a} s`;
  return (
    <View style={{ backgroundColor: '#3a1111', borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 10, marginTop: 10 }}>
      <Text style={{ color: theme.red, fontWeight: '800' }}>⚠ iPad clock is {amt} {ahead ? 'AHEAD of' : 'BEHIND'} UTC</Text>
      <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>OOOI times are recorded from this device&apos;s clock. Fix it in Settings → General → Date &amp; Time → Set Automatically, then reopen this screen.</Text>
    </View>
  );
}
