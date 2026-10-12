/**
 * Goldstandard-Messung der Exposé-Extraktion (Protokoll 30, P0): vergleicht gespeicherte Analyse-Ergebnisse (Cache des
 * Prüfsatzes) mit den von Hand geprüften Soll-Werten aus der Goldstandard-Tabelle. Ausgabe nur als Kennzahlen.
 *
 *   pnpm extraktion:gold --gold "<goldstandard.xlsx>" --ordner "<PDF-Ordner>" [--lauf v0-v0] [--lauf v2-v2.1] [--cache <dir>] [--ausgabe <dir>]
 *
 * `--lauf` ist die Endung der Cache-Datei `<sha256>-<lauf>.json` (Schema-Promptversion), mehrfach angebbar.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ExposeV2, type ExtrahiertV0, type GoldErgebnis, goldAlsMarkdown, goldAusTabellen, goldVergleich, zuordnen } from '@gg/domain';
import { tabelleLesen } from '@gg/integrations';

const WURZEL = join(import.meta.dirname, '..');
const { values: arg } = parseArgs({
  options: {
    gold: { type: 'string' }, ordner: { type: 'string' }, lauf: { type: 'string', multiple: true, default: ['v0-v0'] },
    cache: { type: 'string', default: join(WURZEL, '.cache/extraktion') },
    ausgabe: { type: 'string', default: join(WURZEL, '../immohandel-doks/protokoll/messdaten') },
  },
});
if (!arg.gold || !arg.ordner) { console.error('Aufruf: pnpm extraktion:gold --gold "<xlsx>" --ordner "<PDF-Ordner>" [--lauf v0-v0] [--lauf v2-v2.1]'); process.exit(1); }

const mappe = new Uint8Array(readFileSync(resolve(arg.gold)));
const gold = goldAusTabellen(tabelleLesen(mappe, 'Objekte').zeilen, tabelleLesen(mappe, 'Einheiten').zeilen);
const geprueft = gold.filter((g) => Object.keys(g.soll).length || g.einheiten);
console.error(`${gold.length} Exposés im Goldstandard, ${geprueft.length} mit geprüften Werten.`);

const pdfs = new Set(readdirSync(resolve(arg.ordner)));
const hashVon = (datei: string) => (pdfs.has(datei) ? createHash('sha256').update(readFileSync(join(resolve(arg.ordner!), datei))).digest('hex') : null);

const ergebnisse: Record<string, GoldErgebnis> = {};
for (const lauf of arg.lauf!) {
  const je = new Map<number, { pruefdaten: ExtrahiertV0; details?: Record<string, unknown> }>();
  let fehlt = 0;
  for (const g of gold) {
    const h = hashVon(g.datei);
    const pfad = h ? join(resolve(arg.cache!), `${h}-${lauf}.json`) : '';
    if (!h || !existsSync(pfad)) { fehlt++; continue; }
    const e = JSON.parse(readFileSync(pfad, 'utf8')).ergebnis;
    if (e.v2) { const z = zuordnen(e.v2 as ExposeV2); je.set(g.nr, { pruefdaten: z.pruefdaten, details: z.details }); }
    else if (e.extrahiert?.objekt) je.set(g.nr, { pruefdaten: e.extrahiert as ExtrahiertV0 });
    else fehlt++;
  }
  if (fehlt) console.error(`${lauf}: ${fehlt} Exposés ohne Ergebnis im Cache (zählen als ausgelassen)`);
  ergebnisse[lauf] = goldVergleich(gold, je);
}

const d = new Date();
const datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
mkdirSync(resolve(arg.ausgabe!), { recursive: true });
const name = `gold-${datum}-${arg.lauf!.join('_')}`;
writeFileSync(join(resolve(arg.ausgabe!), `${name}.json`), `${JSON.stringify({ erstellt: d.toISOString(), exposes: gold.length, geprueft: geprueft.length, ergebnisse }, null, 2)}\n`);
writeFileSync(join(resolve(arg.ausgabe!), `${name}.md`), `# Goldstandard · ${datum}\n\n${geprueft.length} von ${gold.length} Exposés geprüft · Läufe: ${arg.lauf!.join(', ')}\n\n${goldAlsMarkdown(ergebnisse)}`);
console.error(`→ ${join(resolve(arg.ausgabe!), `${name}.md`)}`);
