/** Unverändert aus gg-immohandel `src/lib/utils.ts` (Stand 9d693b8): deutsche und englische Schreibweisen. */
export function parseNum(s: unknown): number {
  if (typeof s === 'number') return s;
  const str = (s || '').toString().trim();
  if (!str) return 0;
  const hasComma = str.includes(',');
  const dotCount = (str.match(/\./g) || []).length;
  if (hasComma) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  if (dotCount > 1) return parseFloat(str.replace(/\./g, '')) || 0;
  if (dotCount === 1) {
    const parts = str.split('.');
    if (parts[1]!.length === 3 && /^\d+$/.test(parts[1]!)) return parseFloat(str.replace('.', '')) || 0;
    return parseFloat(str) || 0;
  }
  return parseFloat(str) || 0;
}

/** JavaScript-Unärplus wie im Altcode (`+e.rend_k`), für Werte aus Formularen und JSON. */
export const plus = (v: unknown): number => +(v as number);
