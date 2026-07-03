// Tech Log page number: a per-tail integer sequence (1, 2, 3 …) shown as six
// digits grouped NNN-NNN — starts at 000-001 and rolls 000-999 → 001-000.
export function fmtTl(n?: number | null): string {
  if (n == null || isNaN(Number(n))) return '';
  const v = Math.trunc(Number(n));
  return `${String(Math.floor(v / 1000)).padStart(3, '0')}-${String(v % 1000).padStart(3, '0')}`;
}

// Parse a typed TL number ('001-000', '001000', '5') back to its integer sequence.
export function parseTl(s?: string | null): number {
  const digits = (s || '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : NaN;
}
