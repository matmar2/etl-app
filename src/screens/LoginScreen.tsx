import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { forgotPassword, hasOfflineSession, login, loginOffline, MfaRequired, NetworkError, publicConfig, requestOtp, serverReachable } from '../api/client';
import { theme } from '../theme';

export default function LoginScreen({ navigation }: any) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [otp, setOtp] = useState('');
  const [mfa, setMfa] = useState(false);          // second-factor step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [testing, setTesting] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);   // null = checking
  useEffect(() => { publicConfig().then((c) => setTesting(!!c.testing_mode)); }, []);
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

  async function forgotPwd() {
    if (!u.trim()) { setErr('Enter your User ID first, then tap Forgot password.'); return; }
    setErr(''); setNote('Requesting a reset…');
    try { const r = await forgotPassword(u.trim()); setNote(r.message || 'If the account has an email on file, a reset link was sent. Otherwise contact your admin.'); }
    catch { setNote('Could not request a reset — contact your administrator.'); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.logoCard}>
        <Image source={require('../../assets/Fly2Sky-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.title}>Electronic Tech Log</Text>
      <Text style={styles.sub}>Fly2Sky · Sign in</Text>
      {testing ? <Text style={styles.testing}>TESTING PERIOD — use MFA code 123456</Text> : null}
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
      ) : online ? (
        <Text style={styles.connOk}>● Connected to server</Text>
      ) : (
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
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{mfa ? 'Verify & sign in' : 'Sign in'}</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={forgotPwd}><Text style={[styles.link, { marginTop: 12 }]}>Forgot password?</Text></TouchableOpacity>
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
});
