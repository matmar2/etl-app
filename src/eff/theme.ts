// Dark cockpit theme — mirrors the ETL app tokens so the module is visually at home after the merge.
export const T = {
  bg: '#0b1526', panel: '#12203a', card: '#16263f', line: '#24385c',
  text: '#e8eef6', sub: '#8fa3c0', accent: '#4aa3df',
  green: '#46b06c', amber: '#d9a300', red: '#e05252',
  inBg: '#0e1a30', inBorder: '#2c4a76', entry: '#9fd6ae',
};

// Spacing unit (use multiples: 4 / 8 / 12 / 16) and radii.
export const SP = 4;
export const R = { card: 12, control: 8, pill: 999 };

// Type scale.
export const TY = {
  title: { color: T.text, fontSize: 20, fontWeight: '800' as const },
  section: { color: T.sub, fontSize: 13, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  label: { color: T.sub, fontSize: 12 },
  value: { color: T.text, fontSize: 15 },
};

// Subtle card elevation — 1px border + soft shadow (renders as box-shadow on web).
export const ELEV = {
  borderWidth: 1, borderColor: T.line,
  shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
};

// Shared control styles.
export const S = {
  input: {
    backgroundColor: T.inBg, borderColor: T.inBorder, borderWidth: 1, borderRadius: R.control,
    height: 40, paddingHorizontal: 12, color: T.text, fontSize: 15,
  },
  inputFocus: { borderColor: T.accent },
  card: { backgroundColor: T.card, borderRadius: R.card, padding: 16, ...ELEV },
  btnPrimary: {
    backgroundColor: T.green, borderRadius: 10, minHeight: 44, paddingVertical: 11, paddingHorizontal: 20,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  btnPrimaryTxt: { color: '#08120b', fontWeight: '800' as const, fontSize: 15 },
  btnSecondary: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: T.accent, borderRadius: 10,
    minHeight: 40, paddingVertical: 9, paddingHorizontal: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  btnSecondaryTxt: { color: T.accent, fontWeight: '700' as const, fontSize: 14 },
  btnDanger: {
    backgroundColor: '#3a1515', borderWidth: 1, borderColor: '#5c2626', borderRadius: 10,
    minHeight: 40, paddingVertical: 9, paddingHorizontal: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  btnDangerTxt: { color: '#f0a3a3', fontWeight: '700' as const, fontSize: 14 },
  pill: { borderRadius: R.pill, paddingHorizontal: 12, height: 26, justifyContent: 'center' as const },
};
