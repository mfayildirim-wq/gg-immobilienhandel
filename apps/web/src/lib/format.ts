const zahlDe = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** Wie die alte App: ganze Euro, leer bei 0 (Strich). */
export const euro = (n: number | null | undefined, leer = '–') => (n ? `${zahlDe.format(Math.round(n))} €` : leer);
export const euroProQm = (n: number | null | undefined) => (n && Number.isFinite(n) ? `${zahlDe.format(Math.round(n))} €/m²` : '–');
export const prozent = (n: number | null | undefined, stellen = 1) =>
  n && Number.isFinite(n) ? `${n.toFixed(stellen).replace('.', ',')} %` : '–';
export const flaeche = (n: number | null | undefined) =>
  n ? `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` : '–';
/** Tagesdatum wie in den Listen der alten App (vtFormatDate): immer zweistellig, z. B. 08.09.2026. */
export const datumDe = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
/** Postgres liefert „2026-03-23 00:00:00+00“; JavaScript braucht „T“ und „+00:00“. */
export const alsDatum = (wert: string) => new Date(wert.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
export const zeitpunktDe = (iso: string | null | undefined) =>
  iso ? alsDatum(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'Altbestand';

/** Zeitstempel wie im Gesprächslog der alten App: „16.09.2026 10:15“, ohne Zeitpunkt „Altbestand“. */
export const zeitpunktLog = (iso: string | null | undefined) => {
  if (!iso) return 'Altbestand';
  const d = alsDatum(iso);
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * Wert eines Mantine-NumberInput als Zahl; '' (leer) wird `null`. Zwischenstände beim Tippen meldet das Feld als Text
 * ("01", wenn im Feld „0“ steht und jemand „1“ tippt; "4." vor der Nachkommastelle) — auch das sind Zahlen. Früher
 * galt jeder Text als leer: das Feld wurde geleert und das getippte Zeichen war weg.
 */
export const alsZahl = (v: number | string): number | null => {
  const n = typeof v === 'number' ? v : v.trim() === '' ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
