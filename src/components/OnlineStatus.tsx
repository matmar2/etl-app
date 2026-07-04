import React, { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { serverReachable } from '../api/client';

// Online/offline pill shown on every page (nav header + Menu top bar). Probes the
// server via serverReachable(); on web it also trusts navigator.onLine / online events.
// Last status is cached module-side so it doesn't flash "CHECKING" on every navigation.
let lastKnown: boolean | null = null;

export default function OnlineStatus() {
  const [online, setOnline] = useState<boolean | null>(lastKnown);

  useEffect(() => {
    let alive = true;
    const set = (v: boolean) => { lastKnown = v; if (alive) setOnline(v); };
    const check = async () => {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) { set(false); return; }
      try { set(await serverReachable(4000)); } catch { set(false); }
    };
    check();
    const t = setInterval(check, 20000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    const onWeb = Platform.OS === 'web' && typeof window !== 'undefined';
    const wOn = () => check();
    const wOff = () => set(false);
    if (onWeb) { window.addEventListener('online', wOn); window.addEventListener('offline', wOff); }
    return () => {
      alive = false; clearInterval(t); sub.remove();
      if (onWeb) { window.removeEventListener('online', wOn); window.removeEventListener('offline', wOff); }
    };
  }, []);

  const off = online === false;
  const color = off ? '#e8a000' : '#37b24d';
  const label = online == null ? 'CHECKING' : off ? 'OFFLINE' : 'ONLINE';
  return (
    <View style={[st.pill, { borderColor: color, backgroundColor: off ? 'rgba(232,160,0,0.16)' : 'rgba(55,178,77,0.16)' }]}>
      <View style={[st.dot, { backgroundColor: color }]} />
      <Text style={[st.txt, { color }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  txt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
});
