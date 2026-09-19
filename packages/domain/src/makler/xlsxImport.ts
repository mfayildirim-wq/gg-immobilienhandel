/**
 * Makler aus einer Tabelle importieren (alt: /api/import/makler-xlsx, Einstellungen → „Makler aus XLSX importieren“).
 * Spaltenerkennung, Prio-Normalisierung und Zeilenauswertung wörtlich aus gg-immohandel server/index.ts.
 */
/** Sieben Stufen wie die alte App (server/kontakt-frequenz.ts); im Neubau heißt „Nicht kontaktieren“ „Nie“. */
const FREQUENZ_STUFEN = ['Täglich', 'Wöchentlich', 'Monatlich', 'Alle 3 Monate', 'Alle 6 Monate', 'Alle 12 Monate', 'Nie'] as const;
type FrequenzStufe = (typeof FREQUENZ_STUFEN)[number];
const FREQUENZ_STANDARD: FrequenzStufe = 'Monatlich';
const FREQUENZ_TAGE: Record<FrequenzStufe, number> = {
  'Täglich': 1, 'Wöchentlich': 7, 'Monatlich': 30, 'Alle 3 Monate': 90, 'Alle 6 Monate': 180, 'Alle 12 Monate': 365, Nie: Number.POSITIVE_INFINITY,
};
/** Schreibweisen aus Tabellen — klein geschrieben verglichen. */
const FREQUENZ_WORTE: Record<string, FrequenzStufe> = {
  'täglich': 'Täglich', taeglich: 'Täglich', daily: 'Täglich',
  'wöchentlich': 'Wöchentlich', woechentlich: 'Wöchentlich', weekly: 'Wöchentlich',
  monatlich: 'Monatlich', monthly: 'Monatlich',
  quartalsweise: 'Alle 3 Monate', 'vierteljährlich': 'Alle 3 Monate', vierteljaehrlich: 'Alle 3 Monate', quartal: 'Alle 3 Monate',
  'halbjährlich': 'Alle 6 Monate', halbjaehrlich: 'Alle 6 Monate',
  'jährlich': 'Alle 12 Monate', jaehrlich: 'Alle 12 Monate', yearly: 'Alle 12 Monate',
  nie: 'Nie', keine: 'Nie', never: 'Nie', 'nicht kontaktieren': 'Nie',
};

/** Die Stufe, deren Tageszahl der gegebenen am nächsten kommt („Nie“ nie über Nähe). */
function naechsteStufe(tage: number): FrequenzStufe {
  let beste: FrequenzStufe = FREQUENZ_STANDARD;
  let abstand = Infinity;
  for (const stufe of FREQUENZ_STUFEN) {
    const t = FREQUENZ_TAGE[stufe];
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - tage);
    if (d < abstand) { abstand = d; beste = stufe; }
  }
  return beste;
}

/** normalisiereKontaktFrequenz: Zellinhalt → eine der sieben Stufen; Unlesbares ergibt die Standardstufe. */
export function xlsxFrequenz(roh: unknown): FrequenzStufe {
  const text = String(roh ?? '').trim();
  if (!text) return FREQUENZ_STANDARD;
  const treffer = FREQUENZ_STUFEN.find((f) => f.toLowerCase() === text.toLowerCase());
  if (treffer) return treffer;
  const wort = FREQUENZ_WORTE[text.toLowerCase()];
  if (wort) return wort;
  const zahl = /(\d+)/.exec(text);
  if (zahl) {
    const tage = Number(zahl[1]);
    if (Number.isFinite(tage) && tage > 0) return naechsteStufe(tage);
  }
  return FREQUENZ_STANDARD;
}

export const XLSX_SPALTEN: Record<string, string[]> = {
  name: ['name', 'vorname', 'nachname', 'kontakt', 'ansprechpartner'],
  firma: ['firma', 'unternehmen', 'gesellschaft', 'company', 'büro'],
  tel: ['tel', 'telefon', 'handy', 'mobil', 'phone', 'fon'],
  email: ['email', 'e-mail', 'mail'],
  prio: ['priorität', 'prio', 'kategorie', 'klasse', 'rank'],
  kontaktFreq: ['frequenz', 'rhythmus', 'kontakt freq', 'intervall', 'turnus'],
  adresse: ['adresse', 'straße', 'strasse', 'address'],
  stadt: ['stadt', 'ort', 'city', 'plz ort'],
  notizen: ['notiz', 'notizen', 'anmerkung', 'bemerkung', 'note', 'kommentar'],
};

/** detectColumns: erste Überschrift, die eines der Muster enthält. */
export function xlsxSpaltenErkennen(ueberschriften: string[]): Record<string, number> {
  const zuordnung: Record<string, number> = {};
  const klein = ueberschriften.map((h) => (h || '').toString().toLowerCase().trim());
  for (const [feld, muster] of Object.entries(XLSX_SPALTEN)) {
    const idx = klein.findIndex((h) => muster.some((p) => h.includes(p)));
    if (idx >= 0) zuordnung[feld] = idx;
  }
  return zuordnung;
}

/** normalizePrio */
export function xlsxPrio(roh: string): 'A' | 'B' | 'C' {
  const v = (roh || '').toString().trim().toUpperCase();
  if (v === 'A' || v === '1' || v === 'HOCH') return 'A';
  if (v === 'C' || v === '3' || v === 'NIEDRIG' || v === 'LOW') return 'C';
  return 'B';
}

export interface XlsxMakler { name: string; firma: string; tel: string; email: string; prio: 'A' | 'B' | 'C'; kontaktFrequenz: string; adresse: string; stadt: string; notizen: string }

/**
 * Zeilen auswerten: ohne Namen übersprungen, bekannte E-Mail übersprungen (Groß-/Kleinschreibung egal),
 * doppelte E-Mail innerhalb der Datei ebenfalls nur einmal.
 */
export function xlsxMaklerLesen(
  zeilen: unknown[][],
  zuordnung: Record<string, number>,
  vorhandeneEmails: Iterable<string>,
): { makler: XlsxMakler[]; uebersprungen: number } {
  const bekannt = new Set([...vorhandeneEmails].map((e) => (e || '').toLowerCase()).filter(Boolean));
  const makler: XlsxMakler[] = [];
  let uebersprungen = 0;
  for (const zeile of zeilen) {
    const feld = (f: string) => String(zeile[zuordnung[f] ?? -1] ?? '').trim();
    const name = feld('name');
    if (!name) { uebersprungen++; continue; }
    const email = feld('email').toLowerCase();
    if (email && bekannt.has(email)) { uebersprungen++; continue; }
    makler.push({
      name, firma: feld('firma'), tel: feld('tel'), email,
      prio: xlsxPrio(feld('prio')),
      kontaktFrequenz: xlsxFrequenz(feld('kontaktFreq')),
      adresse: feld('adresse'), stadt: feld('stadt'), notizen: feld('notizen'),
    });
    if (email) bekannt.add(email);
  }
  return { makler, uebersprungen };
}
