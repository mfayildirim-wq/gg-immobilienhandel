/** Ein Element von Stelle `von` an Stelle `nach` verschieben (Ziel wird auf die Liste begrenzt); liefert immer eine neue Liste. */
export function verschieben<T>(liste: readonly T[], von: number, nach: number): T[] {
  const neu = [...liste];
  if (von < 0 || von >= neu.length) return neu;
  const ziel = Math.max(0, Math.min(neu.length - 1, nach));
  if (ziel === von) return neu;
  const [el] = neu.splice(von, 1);
  neu.splice(ziel, 0, el!);
  return neu;
}
