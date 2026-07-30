// Electronic Flight Folder (EFF) — merged into the ETL app as a flight-crew module (Milestone 2).
// This screen is the module host: it sequences the ported EFF flow (login → My Flights → flight
// Workspace) exactly like the standalone EFF App.tsx did, and mounts the pilot InductionGate.
//
// The tile that reaches this screen is admin-gated (eff_module.enabled) and flight-crew only, so
// with the flag OFF (default) the live fleet never sees it. Everything the module needs is loaded
// lazily on mount (hydrate + auto-flush start) — nothing in src/eff/ runs at app boot.
//
// M3 auth reuse: the pilot is already signed into the ETL app, so on mount we mint an EFF session
// from their existing ETL bearer (POST /eff-api/auth/session) and go straight to My Flights — no
// second login. The EFF LoginScreen is kept only as a fallback for offline / no-ETL-token / errors;
// a 403 (not flight crew) shows a short message instead.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { hydrate, isOnline, loadToken, sessionFromEtl, setToken, startAutoFlush, stopAutoFlush } from './api';
import { FlightsScreen, LoginScreen } from './screens';
import { Workspace } from './workspace';
import { InductionGate } from './help';
import { S, T } from './theme';

export default function FlightFolderScreen() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [flight, setFlight] = useState<any>(null);
  const [page, setPage] = useState<'flights' | 'folder'>('flights');
  const [authMsg, setAuthMsg] = useState<string>('');    // set only on 403 (flight-crew-only) — see below
  const [manual, setManual] = useState(false);           // escape hatch: force the manual LoginScreen

  useEffect(() => {
    let alive = true;
    (async () => {
      // Hydrate the sync mirrors (token, outbox, required fields, help cache) from the native store,
      // then decide the first screen from the persisted EFF token.
      await hydrate();
      const t = await loadToken();
      if (alive && t) { setUser({}); }     // already have an EFF token → land on My Flights (stale → 401 re-login)
      else if (alive) {
        // No EFF token yet — reuse the existing ETL login rather than prompting a second sign-in.
        const ex = await sessionFromEtl();
        if (alive) {
          if (ex.ok) {
            setUser(ex.user || {});
          } else if (ex.reason === 'forbidden') {
            setAuthMsg('The Flight Folder is available to flight crew only.');
          }
          // no-etl-token / offline / error → user stays null → the EFF LoginScreen fallback renders.
        }
      }
      if (!alive) return;
      setReady(true);
      startAutoFlush();                    // begins the offline outbox flush + online probe loop
      isOnline();                          // prime isOnlineSync() for the offline badges
    })();
    return () => { alive = false; stopAutoFlush(); };
  }, []);

  const signOut = () => { setToken(null); setUser(null); setFlight(null); setPage('flights'); setAuthMsg(''); setManual(false); };

  if (!ready) return (
    <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );

  let body;
  if (!user && authMsg && !manual) {
    // 403 from the session exchange — not flight crew. Offer the manual login as an escape hatch
    // (e.g. the ETL token was for a non-crew account and they want to sign in as someone else).
    body = (
      <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={[S.card, { maxWidth: 460 }]}>
          <Text style={{ color: T.text, fontSize: 17, fontWeight: '800', marginBottom: 8 }}>Flight crew only</Text>
          <Text style={{ color: T.sub, fontSize: 14, lineHeight: 21 }}>{authMsg}</Text>
          <TouchableOpacity style={[S.btnSecondary, { marginTop: 16 }]} onPress={() => setManual(true)}>
            <Text style={S.btnSecondaryTxt}>Sign in with another account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  } else if (!user) body = <LoginScreen onDone={setUser} />;
  else if (page === 'folder' && flight) body = <Workspace flight={flight} back={() => setPage('flights')} signOut={signOut} />;
  else body = <FlightsScreen user={user} open={(f: any) => { setFlight(f); setPage('folder'); }} signOut={signOut} />;

  // Pilot login induction — shown once per pilot per version, gated server-side (non-pilots/acked see nothing).
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {body}
      <InductionGate active={!!user} />
    </View>
  );
}
