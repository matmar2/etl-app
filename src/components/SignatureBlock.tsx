import React from 'react';
import { Image, Text, View, ViewStyle } from 'react-native';
import { theme } from '../theme';

// Inline display of a captured sign-off — the drawn signature on a white card (signatures are
// dark ink; invisible on the dark theme without it) + who/when. Used wherever a section shows
// an "Accepted / Signed ✓" state: commander acceptance, post-flight, CRS, defect reports.
export default function SignatureBlock({ sig, label, style }: {
  sig?: { signer_name?: string | null; licence_no?: string | null; signed_at?: string | null; signature_image?: string | null } | null;
  label: string;
  style?: ViewStyle;
}) {
  if (!sig || (!sig.signature_image && !sig.signer_name)) return null;
  const when = sig.signed_at ? `${String(sig.signed_at).slice(0, 16).replace('T', ' ')}z` : '';
  return (
    <View style={[{ marginTop: 8 }, style]}>
      <Text style={{ color: theme.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      {sig.signature_image ? (
        <View style={{ backgroundColor: '#ffffff', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderColor: theme.border }}>
          <Image source={{ uri: sig.signature_image }} style={{ width: 200, height: 56, resizeMode: 'contain' }} />
        </View>
      ) : null}
      <Text style={{ color: theme.sub, fontSize: 12, marginTop: 4 }}>
        {sig.signer_name || ''}{sig.licence_no ? ` · ${sig.licence_no}` : ''}{when ? ` · ${when}` : ''}
      </Text>
    </View>
  );
}
