export const theme = {
  bg: '#0a1f3c',
  panel: '#13314f',
  tile: '#102a47',
  border: '#2a567f',
  accent: '#f0a500',   // amber edit highlight (Conduce-style)
  green: '#7cb342',
  red: '#d9534f',
  text: '#ffffff',
  sub: '#9bb4cf',
  // --- design tokens (additive; adopt opportunistically to remove per-screen drift) ---
  onAccent: '#1a1300',      // dark text on amber buttons (was inlined ~32×)
  onColor: '#ffffff',       // text on green / red / accent buttons
  placeholder: '#6f89a8',   // dimmer than `sub` so an empty field reads as empty
  disabledOpacity: 0.45,    // one disabled fade (was 0.4/0.45/0.5/0.55/0.6)
  radius: { sm: 8, md: 12, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  font: { label: 12, body: 14, title: 22, hero: 30 },
  tints: { flight: '#3d9be0', docs: '#5a8bd0', help: '#9b8cf0', warn: '#f0a500' },
};
