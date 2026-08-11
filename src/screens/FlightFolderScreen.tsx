// Electronic Flight Folder (EFF) — navigator target. This wrapper is deliberately TINY and imports
// NOTHING from src/eff/ statically: the whole EFF module is pulled in via a dynamic import(), so Metro
// never evaluates any EFF code at app boot. It runs only when an authorised user actually opens the
// Flight Folder. Consequence: a bug anywhere in src/eff/ cannot crash ETL boot or affect the fleet —
// at worst it breaks this one screen for the one user who opened it (and the server allow-list removes
// even that instantly). Access is gated upstream (Main Menu tile → releases._eff_access).
import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ui } from '../ui';

// Retry-on-failure wrapper for the chunk import. Metro's web chunk loader can fail
// transiently (network glitch, partial script load, bfcache stale module map) causing
// "Requiring unknown module 768". Retrying the import() re-fetches and re-evaluates the
// chunk, which registers the missing modules.
const Inner = React.lazy(() =>
  import('../eff/FlightFolder').catch(() =>
    new Promise<void>(r => setTimeout(r, 300)).then(() =>
      import('../eff/FlightFolder').catch(() =>
        new Promise<void>(r => setTimeout(r, 600)).then(() =>
          import('../eff/FlightFolder')
        )
      )
    )
  )
);

export default function FlightFolderScreen(props: any) {
  return (
    <Suspense fallback={<View style={[ui.screen, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator /></View>}>
      <Inner navigation={props.navigation} />
    </Suspense>
  );
}
