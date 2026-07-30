// Electronic Flight Folder (EFF) — merged into the ETL app as a flight-crew module (Milestone 1
// scaffold). The tile that reaches this screen is admin-gated (eff_module.enabled) and flight-crew
// only, so with the flag OFF (default) the live fleet never sees it. The EFF screens + offline
// storage (reusing ETL's SQLite/outbox/SecureStore) land here in the next milestones.
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { ui } from '../ui';

export default function FlightFolderScreen() {
  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ padding: 18, maxWidth: 900, alignSelf: 'center', width: '100%' }}>
      <Text style={ui.section}>Electronic Flight Folder</Text>
      <View style={[ui.card, { marginTop: 10 }]}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>EFF is being integrated into this app</Text>
        <Text style={{ color: theme.sub, marginTop: 8, lineHeight: 20 }}>
          Your per-flight briefing folder — OFP, weather &amp; NOTAMs, pre-flight report, nav log and
          sign-off — is moving into the Tech Log app so it works fully offline on the same store the
          rest of your flying already uses. This section is enabled by your administrator and is for
          flight crew only.
        </Text>
        <Text style={{ color: theme.sub, marginTop: 12, fontSize: 12.5, lineHeight: 18 }}>
          While it&apos;s being fitted, the current EFF is available in Safari at
          {' '}<Text style={{ color: theme.accent }}>etl.avora.aero/eff</Text>.
        </Text>
      </View>
    </ScrollView>
  );
}
