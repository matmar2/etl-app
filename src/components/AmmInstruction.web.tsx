import React from 'react';

// Web: react-native-web renders DOM, so an <iframe srcDoc> shows the instruction HTML
// (its <base> tag resolves the figure <img src="/api/figures/…"> against CAMO).
export default function AmmInstruction({ html }: { html: string }) {
  return (
    <iframe
      srcDoc={html}
      title="AMM instruction"
      style={{ border: 0, width: '100%', height: '100%', background: '#fff' }}
    />
  );
}
