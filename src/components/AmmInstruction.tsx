import React from 'react';
import { WebView } from 'react-native-webview';

// Native: render the AMM instruction HTML (diagrams load from CAMO's public figures URL
// via the <base> tag baked into the HTML by the backend).
export default function AmmInstruction({ html }: { html: string }) {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ flex: 1, backgroundColor: '#fff' }}
      startInLoadingState
      setSupportMultipleWindows={false}
    />
  );
}
