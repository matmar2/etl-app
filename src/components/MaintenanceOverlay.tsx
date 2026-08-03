import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { lastApiOkMs, serverReachable } from '../api/client';
import { theme } from '../theme';

// "Maintenance is going on... hold on..." overlay shown when the API was recently reachable
// but becomes temporarily unreachable — typical during backend deploys. Auto-dismisses on reconnect.
// Does NOT show on genuinely-offline sessions (device has never reached the server this session).
const GRACE_MS = 6000;    // wait 6s of continuous unreachability before showing
const POLL_MS  = 4000;    // poll every 4s (fast enough to dismiss quickly on reconnect)
const RECENT   = 90_000;  // "recently online" = last successful API call within 90s
const MAX_MS   = 60_000;  // auto-dismiss after 60s — a real deploy takes <60s; beyond that it's genuine offline

export default function MaintenanceOverlay() {
  const [show, setShow] = useState(false);
  const offSince = useRef(0);
  const dismissed = useRef(false);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      if (!alive) return;
      const lastOk = lastApiOkMs();
      if (!lastOk) return;
      const ok = await serverReachable(3000);
      if (!alive) return;

      if (ok) {
        offSince.current = 0;
        dismissed.current = false;
        setShow(false);
      } else if (!dismissed.current && (Date.now() - lastOk < RECENT || offSince.current > 0)) {
        if (!offSince.current) offSince.current = Date.now();
        const elapsed = Date.now() - offSince.current;
        if (elapsed >= GRACE_MS && elapsed < MAX_MS) setShow(true);
        else if (elapsed >= MAX_MS) { dismissed.current = true; setShow(false); }
      }
    };

    const t = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!show) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, st.backdrop]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
    >
      <View style={st.card}>
        <Text style={st.title}>Maintenance is going on</Text>
        <Text style={st.msg}>Hold on — the system will be back shortly.</Text>
        <ProgressBar />
      </View>
    </View>
  );
}

function ProgressBar() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const TRACK = 280;
  const FILL  = 90;
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-FILL, TRACK] });

  return (
    <View style={[st.track, { width: TRACK }]}>
      <Animated.View style={[st.fill, { width: FILL, transform: [{ translateX }] }]} />
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,20,35,0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 9998, elevation: 9998 },
  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 24, paddingHorizontal: 32, alignItems: 'center', gap: 6, maxWidth: 380 },
  title: { color: theme.text, fontWeight: '800', fontSize: 16 },
  msg: { color: theme.sub, fontSize: 13, textAlign: 'center', marginTop: 2 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 16 },
  fill: { height: 4, borderRadius: 2, backgroundColor: theme.accent },
});
