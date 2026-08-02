// Global SANDBOX strip — shown on EVERY page of a non-aircraft (sandbox) iPad, so a tester can
// never mistake the sandbox for the live Tech Log. Driven by the `sandbox` flag the release gate
// returns (set in api/client via appRelease). Mounted once in App.tsx, outside the navigator.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { hydrateSandbox, onSandbox } from '../api/client';

export default function SandboxBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => { hydrateSandbox(); return onSandbox(setOn); }, []);
  if (!on) return null;
  return (
    <View pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#d9a300',
               paddingVertical: 3, alignItems: 'center', zIndex: 99999, elevation: 99999 }}>
      <Text style={{ color: '#1a1200', fontWeight: '900', fontSize: 12, letterSpacing: 2 }}>
        ⚠ SANDBOX — TEST ENVIRONMENT · NOT THE LIVE TECH LOG
      </Text>
    </View>
  );
}
