import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { mfaSetup, mfaVerify } from '../api/client';
import { theme } from '../theme';

// One-time TOTP enrolment for pilots & mechanics. Shows a QR + manual secret;
// the crew member scans it with Google/Microsoft Authenticator, then confirms.
export default function MfaSetupScreen({ navigation }: any) {
  const [data, setData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { mfaSetup().then(setData).catch((e) => setErr(e.message)); }, []);

  async function confirm() {
    setBusy(true); setErr('');
    try { await mfaVerify(code.trim()); navigation.replace('Menu'); }
    catch (e: any) { setErr(e.message || 'Code did not match'); }
    finally { setBusy(false); }
  }

  const qr = data ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.otpauth_uri)}` : null;

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Set up two-factor authentication</Text>
      <Text style={s.sub}>Required for pilots & mechanics. Scan this with Google or Microsoft Authenticator.</Text>
      {!data ? <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} /> : (
        <>
          <View style={s.qrCard}>{qr ? <Image source={{ uri: qr }} style={{ width: 220, height: 220 }} /> : null}</View>
          <Text style={s.sub}>Or enter this key manually:</Text>
          <Text style={s.secret}>{data.secret}</Text>
          <TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad"
            placeholder="Enter the 6-digit code" placeholderTextColor={theme.sub} />
          {err ? <Text style={s.err}>{err}</Text> : null}
          <TouchableOpacity style={s.btn} onPress={confirm} disabled={busy || code.length < 6}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>Confirm & enable</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: theme.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: theme.sub, marginTop: 8, textAlign: 'center', maxWidth: 360 },
  qrCard: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginVertical: 18 },
  secret: { color: theme.text, fontWeight: '800', letterSpacing: 2, fontSize: 16, marginVertical: 8 },
  input: { width: 320, maxWidth: '90%', backgroundColor: theme.panel, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 14, marginTop: 14, fontSize: 18, textAlign: 'center' },
  err: { color: theme.red, marginTop: 8 },
  btn: { width: 320, maxWidth: '90%', backgroundColor: theme.green, borderRadius: 8, padding: 15, alignItems: 'center', marginTop: 14 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
