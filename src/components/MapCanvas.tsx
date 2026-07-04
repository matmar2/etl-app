import React from 'react';
import { WebView } from 'react-native-webview';

// Native: render the Leaflet/OpenStreetMap route HTML (needs a connection for tiles).
export default function MapCanvas({ html }: { html: string }) {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ flex: 1, backgroundColor: '#eef1f5' }}
      startInLoadingState
      setSupportMultipleWindows={false}
    />
  );
}
