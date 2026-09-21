import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { quelleLaden } from './quelle.ts';

/**
 * Feld-Inventar: **jedes** Attribut des Altbestands gegen den umgezogenen Neubau.
 *
 *   pnpm umzug:inventar        (nach `pnpm umzug`; Quelle 54322, Ziel DATABASE_URL)
 *
 * Der Umzugsbericht meldet unbekannte Felder nur dort, wo eine Feldliste hinterlegt ist — und er glaubt der
 * Umformung, dass ein bekanntes Feld auch ankommt. Dieses Werkzeug glaubt nichts: es zerlegt den Altbestand in
 * Pfade (`immo-makler[].mobiltel`), sammelt **alle Werte** aus **allen** Tabellen des Schemas `fach` (auch aus
 * jsonb-Spalten) und zählt je Pfad, wie viele der gefüllten Altwerte im Neubau wiederzufinden sind.
 *
 * Das ist eine Spur, kein Beweis: umgeformte Werte (Status-Namen, normalisierte Telefonnummern, berechnete
 * Felder) erscheinen als „fehlt" und gehören von Hand bewertet; Kurzwerte (true, 3, „A") finden sich immer
 * irgendwo und zählen deshalb nicht. Ergebnis ohne Inhalte — nur Pfade und Mengen: berichte/feld-inventar.md
 */
const quelleUrl = process.env.QUELLE_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const zielUrl = process.env.DATABASE_URL;
if (!zielUrl) throw new Error('DATABASE_URL (Ziel) fehlt');

/** Vergleichsformen eines Werts: Zahl als Zahl, Text getrimmt, Datum zusätzlich als Tag. */
function formen(v: unknown): string[] {
  if (typeof v === 'number') {
    const f = [String(v)];
    if (v > 946_684_800_000 && v < 4_102_444_800_000) f.push(new Date(v).toISOString().slice(0, 10)); // Epoch-ms → Tag
    if (v > 946_684_800 && v < 4_102_444_800) f.push(new Date(v * 1000).toISOString().slice(0, 10)); // Unix-Sekunden → Tag
    return f;
  }
  if (typeof v === 'boolean') return [String(v)];
  if (typeof v !== 'string') return [];
  const t = v.trim();
  if (!t) return [];
  const f = [t];
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) f.push(t.slice(0, 10));
  // Die alte App schrieb Tage deutsch („16.9.2026", auch mit Uhrzeit); der Neubau speichert ISO.
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (de) f.push(`${de[3]}-${de[2]!.padStart(2, '0')}-${de[1]!.padStart(2, '0')}`);
  // Kind-IDs sind im Neubau zusammengesetzt („<dealId>:<einheitId>") — die Teile zählen als vorhanden.
  if (/^[^\s:]+(:[^\s:]+)+$/.test(t)) f.push(...t.split(':'));
  if (/^-?\d+([.,]\d+)?$/.test(t)) f.push(String(Number(t.replace(',', '.'))));
  return f;
}
const aussagekraeftig = (v: unknown) => (typeof v === 'string' ? v.trim().length >= 4 : typeof v === 'number' ? Math.abs(v) >= 1000 || !Number.isInteger(v) : false);
const leer = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

function blaetter(v: unknown, pfad: string, aus: (pfad: string, wert: unknown) => void) {
  if (Array.isArray(v)) { for (const e of v) blaetter(e, `${pfad}[]`, aus); if (v.length === 0) aus(pfad, v); return; }
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    if (e.length === 0) aus(pfad, v);
    // Schlüssel, die selbst Daten sind (IDs, Laufnummern), zu einem Pfad zusammenfassen
    for (const [k, w] of e) blaetter(w, `${pfad}.${/^(?=.*\d)[a-z0-9]{12,}$|^\d+$|^[0-9a-f-]{36}$/i.test(k) ? '{id}' : k}`, aus);
    return;
  }
  aus(pfad, v);
}

// ── Ziel: alle Werte aus allen Tabellen von `fach` ─────────────────────────
const ziel = postgres(zielUrl, { prepare: false, max: 1 });
const zielWerte = new Set<string>();
let zielZeilen = 0;
try {
  const tabellen = await ziel<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'fach' and table_type = 'BASE TABLE' order by 1`;
  for (const { table_name } of tabellen) {
    const zeilen = await ziel.unsafe<{ j: unknown }[]>(`select to_jsonb(t) as j from fach."${table_name}" t`);
    zielZeilen += zeilen.length;
    for (const z of zeilen) blaetter(z.j, table_name, (_p, w) => { for (const f of formen(w)) zielWerte.add(f); });
  }
  if (tabellen.length === 0 || zielZeilen === 0) throw new Error('Ziel ist leer — erst „pnpm umzug" laufen lassen.');
} finally {
  await ziel.end();
}

// ── Quelle: Pfade zählen ───────────────────────────────────────────────────
interface Zaehler { vorkommen: number; gefuellt: number; pruefbar: number; gefunden: number; typen: Set<string> }
const pfade = new Map<string, Zaehler>();
const kv = await quelleLaden(quelleUrl);
for (const [schluessel, wert] of Object.entries(kv)) {
  blaetter(wert, schluessel, (pfad, w) => {
    const z = pfade.get(pfad) ?? { vorkommen: 0, gefuellt: 0, pruefbar: 0, gefunden: 0, typen: new Set<string>() };
    pfade.set(pfad, z);
    z.vorkommen++;
    if (leer(w)) return;
    z.gefuellt++;
    z.typen.add(typeof w);
    if (!aussagekraeftig(w)) return;
    z.pruefbar++;
    if (formen(w).some((f) => zielWerte.has(f))) z.gefunden++;
  });
}
if (pfade.size === 0) throw new Error('Quelle lieferte keinen einzigen Pfad — das Inventar hat nichts geprüft.');

// ── Bericht ────────────────────────────────────────────────────────────────
const zeilen = [...pfade.entries()].map(([pfad, z]) => ({ pfad, ...z, fehlt: z.pruefbar - z.gefunden }));
const lage = (z: (typeof zeilen)[number]) =>
  z.gefuellt === 0 ? 'leer' : z.pruefbar === 0 ? 'nur Kurzwerte' : z.gefunden === z.pruefbar ? 'vollständig' : z.gefunden === 0 ? 'FEHLT' : 'teilweise';
const gruppe = (p: string) => p.split(/[.[]/)[0]!;
const tabelle = (zs: typeof zeilen) => [
  '| Pfad | gefüllt | prüfbar | gefunden | fehlt | Lage |', '|---|---:|---:|---:|---:|---|',
  ...zs.map((z) => `| \`${z.pfad}\` | ${z.gefuellt} | ${z.pruefbar} | ${z.gefunden} | ${z.fehlt} | ${lage(z)} |`),
];
const auffaellig = zeilen.filter((z) => ['FEHLT', 'teilweise'].includes(lage(z))).sort((a, b) => b.fehlt - a.fehlt);
const md = [
  '# Feld-Inventar: Altbestand gegen Neubau', '',
  `Stand ${new Date().toISOString()} · ${pfade.size} Pfade im Altbestand · ${zielZeilen} Zeilen und ${zielWerte.size} verschiedene Werte im Neubau`, '',
  '„prüfbar" = aussagekräftiger Wert (Text ab 4 Zeichen, Zahl ab 1000 oder mit Komma). „fehlt" heißt: der Wert steht',
  'nirgends im Neubau — verloren **oder** umgeformt. Jede Zeile hier braucht eine Bewertung von Hand.', '',
  `## Auffällig (${auffaellig.length})`, '', ...tabelle(auffaellig), '',
  '## Alle Pfade je Sammlung', '',
  ...[...new Set(zeilen.map((z) => gruppe(z.pfad)))].sort().flatMap((g) => [`### ${g}`, '', ...tabelle(zeilen.filter((z) => gruppe(z.pfad) === g).sort((a, b) => a.pfad.localeCompare(b.pfad))), '']),
];
mkdirSync('berichte', { recursive: true });
writeFileSync('berichte/feld-inventar.md', md.join('\n'));
console.log(`${pfade.size} Pfade · ${auffaellig.length} auffällig → packages/umzug/berichte/feld-inventar.md\n`);
for (const z of auffaellig.slice(0, 60)) console.log(`${String(z.fehlt).padStart(5)} von ${String(z.pruefbar).padStart(5)} fehlen  ${lage(z).padEnd(10)} ${z.pfad}`);
