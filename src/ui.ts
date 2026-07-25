import { StyleSheet } from 'react-native';
import { theme } from './theme';

// Shared design system — one source of truth for the styled patterns that were previously
// re-rolled inline on every screen (inputs, buttons, section headers, cards, list rows, pills).
// Built from the theme tokens so radius / spacing / type stay consistent app-wide.
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: theme.font.title, fontWeight: '800' },
  sub: { color: theme.sub, fontSize: theme.font.body, marginTop: theme.space.xs },
  hint: { color: theme.sub, fontSize: theme.font.label },

  // uppercase section header with a hairline divider (the app's reference treatment)
  section: {
    color: theme.text, fontWeight: '800', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: theme.space.xl, marginBottom: theme.space.md, paddingBottom: theme.space.sm,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  subhead: { color: theme.sub, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: theme.space.sm, marginBottom: theme.space.sm },
  label: { color: theme.sub, fontSize: theme.font.label, marginTop: theme.space.md, marginBottom: theme.space.xs },

  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.md, padding: theme.space.lg },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm, padding: theme.space.md, marginTop: theme.space.sm },

  // consistent input — 44pt min target, tile bg, one radius/padding
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm, paddingHorizontal: theme.space.md, paddingVertical: 11, minHeight: 44, fontSize: theme.font.body },

  // buttons — one shape, semantic fills
  btn: { borderRadius: theme.radius.sm, paddingVertical: 13, paddingHorizontal: theme.space.lg, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnPrimary: { backgroundColor: theme.green },
  btnAccent: { backgroundColor: theme.accent },
  btnDanger: { backgroundColor: theme.red },
  btnGhost: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border },
  btnTxt: { color: theme.onColor, fontWeight: '800', fontSize: theme.font.body },
  btnTxtOnAccent: { color: theme.onAccent, fontWeight: '800', fontSize: theme.font.body },
  btnTxtGhost: { color: theme.text, fontWeight: '700', fontSize: theme.font.body },
  disabled: { opacity: theme.disabledOpacity },

  pill: { paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.pill, borderWidth: 1 },
});
