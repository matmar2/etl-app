// Electronic Flight Folder (EFF) — navigator target. This wrapper is deliberately TINY and imports
// NOTHING from src/eff/ statically: the whole EFF module is pulled in via a dynamic import(), so Metro
// never evaluates any EFF code at app boot. It runs only when an authorised user actually opens the
// Flight Folder. Consequence: a bug anywhere in src/eff/ cannot crash ETL boot or affect the fleet —
// at worst it breaks this one screen for the one user who opened it (and the server allow-list removes
// even that instantly). Access is gated upstream (Main Menu tile → releases._eff_access).
import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ui } from '../ui';

const Inner = React.lazy(() => import('../eff/FlightFolder'));

export default function FlightFolderScreen() {
  return (
    <Suspense fallback={<View style={[ui.screen, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator /></View>}>
      <Inner />
    </Suspense>
  );
}
