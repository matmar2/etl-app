import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

// Prominent RED border that FLASHES for ~30 s (then stays solid red) around an OFFLINE-saved
// confirmation — an e-signature / CRS / check signed with no signal and NOT yet on the server.
// Draws the eye so crew know the record is pending sync. Re-triggers each time `message` changes.
export default function OfflineFlash({ message }: { message?: string | null }) {
  const flash = useRef(new Animated.Value(1)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (!message) return;
    flash.setValue(1);
    loop.current?.stop();
    loop.current = Animated.loop(Animated.sequence([
      Animated.timing(flash, { toValue: 0.12, duration: 500, useNativeDriver: false }),
      Animated.timing(flash, { toValue: 1, duration: 500, useNativeDriver: false }),
    ]));
    loop.current.start();
    const t = setTimeout(() => { loop.current?.stop(); flash.setValue(1); }, 30000);   // stop flashing, leave solid red
    return () => { loop.current?.stop(); clearTimeout(t); };
  }, [message]);
  if (!message) return null;
  return (
    <Animated.View style={[s.box, { borderColor: flash.interpolate({ inputRange: [0, 1], outputRange: ['rgba(217,83,79,0.12)', theme.red] }) }]}>
      <Text style={s.txt}>{message}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: theme.panel },
  txt: { color: theme.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },
});
