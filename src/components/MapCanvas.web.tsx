import React from 'react';

// Web: react-native-web renders DOM, so an <iframe srcDoc> hosts the Leaflet map.
export default function MapCanvas({ html }: { html: string }) {
  return (
    <iframe
      srcDoc={html}
      title="Route map"
      style={{ border: 0, width: '100%', height: '100%', background: '#eef1f5' }}
    />
  );
}
