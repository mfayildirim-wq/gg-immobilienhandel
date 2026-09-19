/**
 * Werte aus der alten App lesen. Dort liegen Zahlen teils als Text („1.200.000“, „5400“),
 * Zeitpunkte als ISO, deutsches Datum, ms oder „Altbestand“ (Protokoll 07, Befunde 1 und 4).
 */

export type Notiz = (feld: string, wert: unknown, hinweis: string) => void;

/** Zahlen lesen wie die alte App (eine Quelle: @gg/domain). */
export { parseNum as parseNumAlt } from '@gg/domain';
import { parseNum as parseNumAlt } from '@gg/domain';

/** Leer → null; unlesbar oder außerhalb der Spaltengrenze → null mit Notiz. */
export function zahl(wert: unknown, feld: string, notiz: Notiz, max = 1e12): number | null {
  if (wert === null || wert === undefined || wert === '') return null;
  if (typeof wert === 'number') {
    if (!Number.isFinite(wert)) return (notiz(feld, wert, 'keine endliche Zahl'), null);
  } else if (typeof wert !== 'string') {
    return (notiz(feld, wert, 'keine Zahl'), null);
  }
  const n = parseNumAlt(wert);
  if (typeof wert === 'string' && n === 0 && !/^[\s0.,]+$/.test(wert)) {
    return (notiz(feld, wert, 'Text nicht als Zahl lesbar'), null);
  }
  if (Math.abs(n) >= max) return (notiz(feld, wert, `größer als Spaltengrenze ${max}`), null);
  return n;
}

/**
 * Werte, die die alte Kalkulation mit Unärplus liest (`+e.rend_k`, `+e.vkp`, `+x.amt`).
 * Übernommen wird die Zahl, mit der die alte App tatsächlich rechnete. Liest `parseNum` den Text anders
 * (z. B. „38.000“ → 38 statt 38000), entsteht ein Befund: Anzeige und Rechnung liefen dort schon auseinander.
 */
export function zahlWiePlus(wert: unknown, feld: string, notiz: Notiz, max = 1e12): number | null {
  if (wert === null || wert === undefined || wert === '') return null;
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' ? Number(wert.trim()) : NaN;
  if (Number.isNaN(n)) return (notiz(feld, wert, 'Text nicht als Zahl lesbar (alte Kalkulation rechnete mit 0)'), null);
  if (typeof wert === 'string' && parseNumAlt(wert) !== n) {
    notiz(feld, wert, `mehrdeutig: alte Kalkulation rechnete mit ${n}, als deutsche Zahl gelesen ${parseNumAlt(wert)}`);
  }
  if (Math.abs(n) >= max) return (notiz(feld, wert, `größer als Spaltengrenze ${max}`), null);
  return n;
}

export function ganzzahl(wert: unknown, feld: string, notiz: Notiz): number | null {
  const n = zahl(wert, feld, notiz, 2_147_483_647);
  if (n === null) return null;
  if (!Number.isInteger(n)) notiz(feld, wert, 'auf ganze Zahl gerundet');
  return Math.round(n);
}

export function text(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert === 'number' || typeof wert === 'boolean') return String(wert);
  if (typeof wert !== 'string') return null;
  const t = wert.trim();
  return t ? t : null;
}

const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})/;
const DE_DATUM = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function gueltigesDatum(j: number, m: number, t: number): boolean {
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

const zwei = (n: number) => String(n).padStart(2, '0');

/** Fachlicher Tag → 'YYYY-MM-DD'. */
export function datum(wert: unknown, feld: string, notiz: Notiz): string | null {
  const t = text(wert);
  if (!t) return null;
  const iso = ISO_DATUM.exec(t);
  if (iso && gueltigesDatum(+iso[1]!, +iso[2]!, +iso[3]!)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = DE_DATUM.exec(t);
  if (de && gueltigesDatum(+de[3]!, +de[2]!, +de[1]!)) return `${de[3]}-${zwei(+de[2]!)}-${zwei(+de[1]!)}`;
  notiz(feld, wert, 'Datum nicht lesbar');
  return null;
}

/** Versatz von Europe/Berlin zu UTC in Minuten für einen Zeitpunkt. */
function berlinVersatz(utcMs: number): number {
  const teil = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(teil ?? '');
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!) : 0;
}

/** Zeitpunkt → ISO-UTC. Deutsches Datum mit Uhrzeit gilt als Berliner Ortszeit. „Altbestand“ → null. */
export function zeitpunkt(wert: unknown, feld: string, notiz: Notiz): string | null {
  if (wert === null || wert === undefined || wert === '' || wert === 'Altbestand') return null;
  if (typeof wert === 'number') {
    if (wert > 1e11) return new Date(wert).toISOString(); // Millisekunden
    if (wert > 1e9) return new Date(wert * 1000).toISOString(); // Unix-Sekunden
    return (notiz(feld, wert, 'Zahl ist kein Zeitstempel'), null);
  }
  const t = text(wert);
  if (!t) return null;
  const de = DE_DATUM.exec(t);
  if (de) {
    const [j, mo, tag, h = '0', mi = '0', s = '0'] = [de[3]!, de[2]!, de[1]!, de[4], de[5], de[6]];
    if (!gueltigesDatum(+j, +mo, +tag)) return (notiz(feld, wert, 'Datum nicht lesbar'), null);
    const lokal = Date.UTC(+j, +mo - 1, +tag, +h, +mi, +s);
    const utc = lokal - berlinVersatz(lokal) * 60_000;
    return new Date(lokal - berlinVersatz(utc) * 60_000).toISOString();
  }
  if (ISO_DATUM.test(t)) {
    const ms = Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  notiz(feld, wert, 'Zeitpunkt nicht lesbar');
  return null;
}

/** Papierkorb-Marke: `_deleted: true` + `_deletedAt` (ms) oder Altformat `_deleted` = Zeitstempel. */
export function geloeschtAm(item: Record<string, unknown>, stichtag: string): string | null {
  const marke = item._deleted;
  if (!marke) return null;
  const ohneNotiz: Notiz = () => {};
  if (typeof item._deletedAt === 'number') return zeitpunkt(item._deletedAt, '_deletedAt', ohneNotiz) ?? stichtag;
  if (typeof marke === 'number' || typeof marke === 'string') return zeitpunkt(marke, '_deleted', ohneNotiz) ?? stichtag;
  return stichtag;
}

export function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

export function liste(wert: unknown): Record<string, unknown>[] {
  return Array.isArray(wert) ? wert.filter(istObjekt) : [];
}

/** JSON mit sortierten Schlüsseln: jsonb in Postgres ordnet Schlüssel um, der Inhalt ist trotzdem gleich. */
export function kanonisch(wert: unknown): string {
  const sortiert = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sortiert)
      : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortiert((x as Record<string, unknown>)[k])]))
        : x;
  return JSON.stringify(sortiert(wert));
}
