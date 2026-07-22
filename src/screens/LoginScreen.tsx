import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { forgotPassword, hasOfflineSession, login, loginOffline, MfaRequired, NetworkError, offlineResetPassword, publicConfig, requestOtp, serverReachable } from '../api/client';
import { theme } from '../theme';

export default function LoginScreen({ navigation }: any) {
  // AUTO-UPDATE at login: aircraft iPads are rarely cold-launched, so the native ON_LOAD check
  // rarely fires. Here — before sign-in, when a reload costs nothing — we silently download any
  // published update and relaunch straight into it. The user just sees the login screen refresh.
  const [updNote, setUpdNote] = useState('');
  const uRef2 = React.useRef('');
  useEffect(() => {
    (async () => {
      try {
        const Updates = require('expo-updates');
        if (!Updates.isEnabled) return;
        const r = await Updates.checkForUpdateAsync();
        if (!r.isAvailable) return;
        setUpdNote('⇩ Updating to the latest version…');
        await Updates.fetchUpdateAsync();
        // Only auto-relaunch while the user hasn't started signing in.
        if (!uRef2.current) { await Updates.reloadAsync(); return; }
        setUpdNote('Update downloaded — it applies next time the app is fully closed and reopened.');
      } catch { setUpdNote(''); /* offline or reload unsupported — applies on next launch */ }
    })();
  }, []);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [otp, setOtp] = useState('');
  const [mfa, setMfa] = useState(false);          // second-factor step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { uRef2.current = u || p; }, [u, p]);
  const [note, setNote] = useState('');
  const [testing, setTesting] = useState(false);
  const [trialNote, setTrialNote] = useState('TESTING PERIOD — use MFA code 123456');
  const [reset, setReset] = useState(false);        // authenticator reset panel
  const [rOtp, setROtp] = useState('');
  const [rNew, setRNew] = useState('');
  const [rNew2, setRNew2] = useState('');
  const [rBusy, setRBusy] = useState(false);
  const [offlineDone, setOfflineDone] = useState<string | null>(null);   // offline reset saved locally (flashing box)
  const flash = useRef(new Animated.Value(0)).current;                    // 0..1 border pulse
  const flashLoop = useRef<Animated.CompositeAnimation | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);   // null = checking
  useEffect(() => { publicConfig().then((c) => { setTesting(!!c.testing_mode); if (c.trial_login_note) setTrialNote(c.trial_login_note); }); }, []);
  useEffect(() => { hasOfflineSession(u).then(setOfflineReady); }, [u]);   // seeded for offline login?
  useEffect(() => {
    let alive = true;
    const check = () => serverReachable().then((ok) => alive && setOnline(ok));
    check();
    const t = setInterval(check, 8000);   // keep the indicator live while on the login screen
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await login(u.trim(), p, mfa ? otp.trim() : undefined);
      if (r.mfa_enrollment_required) { navigation.replace('MfaSetup'); return; }
      navigation.replace('Menu');
    } catch (e: any) {
      if (e instanceof MfaRequired) { setMfa(true); setErr(''); setNote('Enter your authenticator code.'); }
      else if (e instanceof NetworkError) {           // no signal — verify against the cached offline session
        try {
          await loginOffline(u.trim(), p, mfa ? otp.trim() : undefined);
          navigation.replace('Menu');
        } catch (e2: any) {
          if (e2 instanceof MfaRequired) { setMfa(true); setErr(''); setNote('Offline — enter your authenticator code.'); }
          else setErr(e2?.message || 'Offline login failed');
        }
      }
      else setErr(e?.message || 'Invalid credentials');
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setNote('Sending code…');
    try { const r = await requestOtp(u.trim()); setNote(r.status === 'sent' ? 'Code sent to your email/phone.' : 'Email/SMS not configured — use your authenticator app.'); }
    catch { setNote('Could not request a code.'); }
  }

  function openReset() {
    if (!u.trim()) { setErr('Enter your User ID first, then tap Forgot password.'); return; }
    setErr(''); setNote(''); setROtp(''); setRNew(''); setRNew2(''); setReset(true);
  }

  async function forgotPwd() {
    setErr(''); setNote('Requesting a reset…');
    try { const r = await forgotPassword(u.trim()); setNote(r.message || 'If the account has an email on file, a reset link was sent. Otherwise contact your admin.'); }
    catch { setNote('Could not request a reset — contact your administrator.'); }
  }

  // Flash the offline-reset box border red for 30 s, then leave it solid red (a persistent
  // "not yet on the server" reminder).
  function startFlash() {
    flashLoop.current?.stop();
    flash.setValue(1);
    flashLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(flash, { toValue: 0.15, duration: 500, useNativeDriver: false }),
      Animated.timing(flash, { toValue: 1, duration: 500, useNativeDriver: false }),
    ]));
    flashLoop.current.start();
    setTimeout(() => { flashLoop.current?.stop(); flash.setValue(1); }, 30000);
  }
  useEffect(() => () => flashLoop.current?.stop(), []);   // stop the loop if the screen unmounts

  async function doAuthReset() {
    if (!/^\d{6}$/.test(rOtp.trim())) { setErr('Enter the 6-digit code from your authenticator.'); return; }
    if (rNew.length < 6) { setErr('New password must be at least 6 characters.'); return; }
    if (rNew !== rNew2) { setErr('The two passwords do not match.'); return; }
    setRBusy(true); setErr(''); setNote(''); setOfflineDone(null);
    try {
      const r = await offlineResetPassword(u.trim(), rOtp.trim(), rNew);
      setReset(false); setP(rNew);
      if (r.synced) {
        setNote('Password reset ✓ synced to the server. Sign in with your new password.');
      } else {
        setOfflineDone('Password reset saved on this iPad ✓ — sign in now with your new password.  ⚠ It is NOT yet on the server; it will sync automatically when back online.');
        startFlash();
      }
    } catch (e: any) { setErr(e?.message || 'Could not reset the password.'); setNote(''); }
    finally { setRBusy(false); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.logoCard}>
        <Image source={require('../../assets/Fly2Sky-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.title}>Electronic Tech Log</Text>
      <Text style={styles.sub}>Fly2Sky · Sign in</Text>
      {testing ? <Text style={styles.testing}>{trialNote}</Text> : null}
      <TextInput style={styles.input} value={u} onChangeText={setU} autoCapitalize="none"
        placeholder="User ID" placeholderTextColor={theme.sub}
        returnKeyType="next" onSubmitEditing={() => { if (!busy) submit(); }} blurOnSubmit={false} />
      <View style={styles.pwdRow}>
        <TextInput style={styles.pwdInput} value={p} onChangeText={setP} secureTextEntry={!showPwd}
          placeholder="Password" placeholderTextColor={theme.sub} autoCapitalize="none" autoCorrect={false}
          returnKeyType="go" onSubmitEditing={() => { if (!busy) submit(); }} />
        <TouchableOpacity onPress={() => setShowPwd((v) => !v)} hitSlop={10} style={styles.eyeBtn}
          accessibilityLabel={showPwd ? 'Hide password' : 'Show password'}>
          <Text style={styles.eyeTxt}>{showPwd ? '🙈 Hide' : '👁 Show'}</Text>
        </TouchableOpacity>
      </View>
      {online === null ? (
        <Text style={styles.connChk}>● Checking server connection…</Text>
      ) : online ? (<>
        <Text style={styles.connOk}>● Connected to server</Text>
        {updNote ? <Text style={{ color: theme.accent, fontSize: 12, textAlign: 'center', marginTop: 4 }}>{updNote}</Text> : null}
      </>) : (
        <Text style={styles.connOff}>● No server connection — {offlineReady ? 'offline session ready ✓' : (u.trim() ? 'log in online once to enable offline use' : 'sign in online first')}</Text>
      )}
      {mfa ? (
        <>
          <TextInput style={styles.input} value={otp} onChangeText={setOtp} keyboardType="number-pad"
            placeholder="6-digit code (authenticator or email/SMS)" placeholderTextColor={theme.sub}
            returnKeyType="go" onSubmitEditing={() => { if (!busy) submit(); }} />
          <TouchableOpacity onPress={sendOtp}><Text style={styles.link}>Send code by email/SMS instead</Text></TouchableOpacity>
        </>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {offlineDone ? (
        <Animated.View style={[styles.offlineBox, { borderColor: flash.interpolate({ inputRange: [0, 1], outputRange: ['rgba(217,83,79,0.12)', theme.red] }) }]}>
          <Text style={styles.offlineBoxText}>{offlineDone}</Text>
        </Animated.View>
      ) : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
      {!reset ? (
        <>
          <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{mfa ? 'Verify & sign in' : 'Sign in'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={openReset}><Text style={[styles.link, { marginTop: 12 }]}>Forgot password?</Text></TouchableOpacity>
        </>
      ) : (
        <View style={styles.resetCard}>
          <Text style={styles.resetTitle}>Reset with your authenticator</Text>
          <Text style={styles.resetSub}>Works offline. Enter a code from your authenticator app and choose a new password — you can sign in straight away and it syncs to the server when back online.</Text>
          <TextInput style={styles.rInput} value={rOtp} onChangeText={setROtp} keyboardType="number-pad"
            placeholder="6-digit authenticator code" placeholderTextColor={theme.sub} maxLength={6} />
          <TextInput style={styles.rInput} value={rNew} onChangeText={setRNew} secureTextEntry
            placeholder="New password" placeholderTextColor={theme.sub} autoCapitalize="none" autoCorrect={false} />
          <TextInput style={styles.rInput} value={rNew2} onChangeText={setRNew2} secureTextEntry
            placeholder="Confirm new password" placeholderTextColor={theme.sub} autoCapitalize="none" autoCorrect={false}
            returnKeyType="go" onSubmitEditing={() => { if (!rBusy) doAuthReset(); }} />
          <TouchableOpacity style={styles.btn} onPress={doAuthReset} disabled={rBusy}>
            {rBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset password</Text>}
          </TouchableOpacity>
          <View style={styles.resetLinks}>
            <TouchableOpacity onPress={forgotPwd}><Text style={styles.link}>Email me a link instead</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setReset(false); setErr(''); setNote(''); }}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
          </View>
          <Text style={styles.resetHint}>Needs a prior online sign-in on this iPad and your MFA set up. No authenticator? Use the email link (needs internet).</Text>
        </View>
      )}
      <Text style={styles.hint}>Pilots, Cabin Crew & mechanics sign in with their crew login and MFA.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoCard: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, marginBottom: 22 },
  logo: { width: 240, height: 54 },
  title: { color: theme.text, fontSize: 30, fontWeight: '800' },
  sub: { color: theme.sub, marginBottom: 28 },
  input: { width: 360, maxWidth: '90%', backgroundColor: theme.panel, color: theme.text,
    borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16 },
  pwdRow: { width: 360, maxWidth: '90%', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border,
    borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  pwdInput: { flex: 1, color: theme.text, paddingVertical: 14, paddingLeft: 14, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  eyeTxt: { color: theme.accent, fontWeight: '700', fontSize: 14 },
  btn: { width: 360, maxWidth: '90%', backgroundColor: theme.green, borderRadius: 8, padding: 15, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  err: { color: theme.red, marginBottom: 8 },
  note: { color: theme.accent, fontSize: 12, marginBottom: 8 },
  testing: { color: '#ffd84d', fontWeight: '800', fontSize: 12, marginBottom: 16 },
  connChk: { color: theme.sub, fontSize: 12, marginTop: 8, marginBottom: 4 },
  connOk: { color: theme.green, fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  connOff: { color: '#ffb84d', fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  link: { color: theme.accent, fontSize: 13, marginBottom: 10 },
  hint: { color: theme.sub, fontSize: 12, marginTop: 18 },
  resetCard: { width: 360, maxWidth: '90%', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border,
    borderRadius: 10, padding: 16, marginTop: 6 },
  resetTitle: { color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  resetSub: { color: theme.sub, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  rInput: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border,
    borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 15 },
  resetLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  resetHint: { color: theme.sub, fontSize: 11, lineHeight: 15, marginTop: 2 },
  offlineBox: { width: 360, maxWidth: '90%', backgroundColor: theme.panel, borderWidth: 2, borderRadius: 10, padding: 14, marginBottom: 10 },
  offlineBoxText: { color: theme.text, fontSize: 13, lineHeight: 19, fontWeight: '600' },
});
