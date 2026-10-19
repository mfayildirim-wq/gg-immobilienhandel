// HubSpot-CSV → Datenblock der Migration `…_hubspot_daten.sql` (19.10.2026).
// Einmal ausführen: `node supabase/daten/csv-zu-sql.mjs` schreibt den Block zwischen „-- DATEN ANFANG“ und „-- DATEN ENDE“.
// Der Test `apps/api/test/hubspot-daten.test.ts` prüft, dass die Migration genau diese CSV enthält.
// Kann entfernt werden, sobald die Migration überall eingespielt ist (Migrationen selbst ändert man nicht mehr).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
export const CSV = join(hier, 'hubspot-makler-2026-10-05.csv');
export const MIGRATION = join(hier, '../migrations/20261019150530_hubspot_daten.sql');
const ANFANG = '-- DATEN ANFANG\n';
const ENDE = '-- DATEN ENDE\n';

/** RFC-4180-CSV: Felder in "…" dürfen Komma und "" enthalten. */
export function csvLesen(text) {
  const zeilen = [];
  let feld = '', zeile = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; } else if (c === '"') inQ = false; else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { zeile.push(feld); feld = ''; }
    else if (c === '\n') { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; }
    else if (c !== '\r') feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  const [kopf, ...rest] = zeilen;
  return { kopf, zeilen: rest };
}

const literal = (v) => (v.trim() === '' ? 'null' : `'${v.replace(/'/g, "''")}'`);

export function datenblock(text) {
  const { kopf, zeilen } = csvLesen(text);
  const werte = zeilen.map((z, i) => `  (${i + 1}, ${kopf.map((_, j) => literal(z[j] ?? '')).join(', ')})`);
  return `insert into hubspot_roh (zeile, ${kopf.join(', ')}) values\n${werte.join(',\n')};\n`;
}

export function migrationMitDaten(migration, text) {
  const a = migration.indexOf(ANFANG), e = migration.indexOf(ENDE);
  if (a < 0 || e < a) throw new Error('Markierungen DATEN ANFANG/ENDE fehlen');
  return migration.slice(0, a + ANFANG.length) + datenblock(text) + migration.slice(e);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(MIGRATION, migrationMitDaten(readFileSync(MIGRATION, 'utf8'), readFileSync(CSV, 'utf8')));
  console.log('Datenblock geschrieben:', MIGRATION);
}
