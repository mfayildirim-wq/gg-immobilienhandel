/**
 * Prüfsatz der Exposé-Extraktion (Protokoll 27 T6, Protokoll 28): ein Ordner voller Exposé-PDFs durch `analysiereExpose`, je Exposé
 * die Kennzahlen aus `@gg/domain` (Füllgrad, Einheiten, Belege, Konsistenz, Dauer, Kosten), am Ende Zusammenfassung
 * als JSON und Markdown. In die Ausgabe gehen nur Dateinamen und Kennzahlen — keine Inhalte, Adressen oder Personen.
 *
 *   pnpm extraktion:pruefen --ordner "<Pfad>" [--schema v2|v0] [--max N] [--nur "teil"] [--attrappe]
 *                           [--cache <dir>] [--vergleich <json>] [--ausgabe <dir>] [--parallel N]
 *
 * Cache: je PDF `<cache>/<sha256>-<schema>-<promptVersion>.json` (Ergebnis ohne Seitentexte, dazu `belegt`).
 * Bei Treffer kein KI-Aufruf. Läufe mit `--attrappe` cachen unter eigenem Namen, damit sie keinen echten Lauf vortäuschen.
 * Echter Lauf braucht ANTHROPIC_API_KEY (aus .env) und kostet Geld.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  KERNFELDER, KONSISTENZ_REGELN, type KennzahlenJeExpose, type KennzahlenZusammenfassung, belegePruefen, kennzahlenAlsMarkdown,
  kennzahlenJeExpose, kennzahlenVergleich, kennzahlenZusammenfassen,
} from '@gg/domain';
import {
  type AnalyseAbhaengigkeiten, type AnalyseErgebnis, PROMPT_VERSION_V0, PROMPT_VERSION_V2, analysiereExpose, anthropicClient, kiAttrappe, pdfDokument, pdfText, tesseractOcr,
} from '@gg/integrations';

const WURZEL = join(import.meta.dirname, '..');

const { values: arg } = parseArgs({
  options: {
    ordner: { type: 'string' },
    schema: { type: 'string', default: 'v2' },
    max: { type: 'string' },
    nur: { type: 'string' },
    attrappe: { type: 'boolean', default: false },
    cache: { type: 'string', default: join(WURZEL, '.cache/extraktion') },
    vergleich: { type: 'string' },
    ausgabe: { type: 'string', default: join(WURZEL, '../immohandel-doks/protokoll/messdaten') },
    parallel: { type: 'string', default: '3' },
  },
});

function abbruch(meldung: string): never {
  console.error(meldung);
  process.exit(1);
}

if (!arg.ordner) abbruch('Aufruf: pnpm extraktion:pruefen --ordner "<Pfad>" [--schema v2|v0] [--max N] [--nur "teil"] [--attrappe] [--cache <dir>] [--vergleich <json>] [--ausgabe <dir>] [--parallel N]');
if (arg.schema !== 'v2' && arg.schema !== 'v0') abbruch('--schema ist v2 oder v0');
const schema = arg.schema as 'v0' | 'v2';
const promptVersion = schema === 'v2' ? PROMPT_VERSION_V2 : PROMPT_VERSION_V0;
const parallel = Math.max(1, Number(arg.parallel) || 3);
const ordner = resolve(arg.ordner);
const cacheDir = resolve(arg.cache!);
const ausgabeDir = resolve(arg.ausgabe!);
if (!existsSync(ordner)) abbruch(`Ordner nicht gefunden: ${ordner}`);

let dateien = readdirSync(ordner).filter((d) => d.toLowerCase().endsWith('.pdf')).sort((a, b) => a.localeCompare(b, 'de'));
if (arg.nur) dateien = dateien.filter((d) => d.toLowerCase().includes(arg.nur!.toLowerCase()));
if (arg.max) dateien = dateien.slice(0, Math.max(0, Number(arg.max) || 0));
if (!dateien.length) abbruch('Keine passenden PDFs gefunden.');

let ki;
if (arg.attrappe) ki = kiAttrappe();
else {
  const schluessel = process.env.ANTHROPIC_API_KEY;
  if (!schluessel) abbruch('ANTHROPIC_API_KEY fehlt (in .env) — oder --attrappe für einen Lauf ohne KI.');
  ki = anthropicClient(schluessel);
}

const texterkennung = tesseractOcr();

/** buchen: nur sammeln, nichts in die Datenbank. */
const buchungen: { model: string; quelle: string }[] = [];
const abh: AnalyseAbhaengigkeiten = {
  ki,
  pdfText: (pdf) => pdfText(Buffer.from(pdf)),
  dokument: (pdf) => pdfDokument(pdf, { ocr: texterkennung.ocr }),
  buchen: async (model, _usage, quelle) => { buchungen.push({ model, quelle }); },
};

interface CacheEintrag { ergebnis: Omit<AnalyseErgebnis, 'seitenTexte'>; belegt: (boolean | null)[] | null }

mkdirSync(cacheDir, { recursive: true });
const cachePfad = (hash: string) => join(cacheDir, `${hash}-${schema}-${promptVersion}${arg.attrappe ? '-attrappe' : ''}.json`);

async function auswerten(datei: string): Promise<{ eintrag: CacheEintrag; ausCache: boolean }> {
  const pdf = new Uint8Array(readFileSync(join(ordner, datei)));
  const hash = createHash('sha256').update(pdf).digest('hex');
  const pfad = cachePfad(hash);
  if (existsSync(pfad)) return { eintrag: JSON.parse(readFileSync(pfad, 'utf8')) as CacheEintrag, ausCache: true };
  const { seitenTexte, ...ergebnis } = await analysiereExpose(pdf, datei, abh, { schema });
  // Belege nur auf dem Textweg prüfbar (PDF-Weg liefert keine Seitentexte)
  const belegt = schema === 'v2' && ergebnis.v2 && seitenTexte.length ? belegePruefen(ergebnis.v2, seitenTexte).belegt : null;
  const eintrag: CacheEintrag = { ergebnis, belegt };
  writeFileSync(pfad, JSON.stringify(eintrag));
  return { eintrag, ausCache: false };
}

const zahlDe = (x: number, stellen: number) => x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
const modellKurz = (m: string) => (/haiku/i.test(m) ? 'haiku' : /sonnet/i.test(m) ? 'sonnet' : /opus/i.test(m) ? 'opus' : m || '?');

const kennzahlen: KennzahlenJeExpose[] = new Array(dateien.length);
let fertig = 0;
let naechste = 0;
const n = dateien.length;

async function arbeiter(): Promise<void> {
  while (naechste < n) {
    const i = naechste++;
    const datei = dateien[i]!;
    const start = Date.now();
    try {
      const { eintrag, ausCache } = await auswerten(datei);
      const e = eintrag.ergebnis;
      const k = kennzahlenJeExpose({
        datei, schema, v2: e.v2 ?? null, v0: schema === 'v0' ? e.extrahiert : undefined, modell: e.modell, modus: e.modus, stopReason: e.stopReason,
        usage: e.usage, dauerMs: e.dauerMs, kostenEur: e.kostenEur, nachfass: e.nachfass, wiederholung: e.wiederholung, warnungen: e.warnungen,
        belegt: eintrag.belegt ?? undefined,
      });
      kennzahlen[i] = k;
      fertig++;
      console.error(`${fertig}/${n} ${datei} … ${schema} ${modellKurz(k.modell)} ${zahlDe(k.dauerMs / 1000, 1)} s ${zahlDe(k.kostenEur, 2)} € ${k.einheitenAnzahl} Einheiten${ausCache ? ' (Cache)' : ''}`);
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err);
      kennzahlen[i] = kennzahlenJeExpose({
        datei, schema, modell: '', modus: '', stopReason: null, usage: { inputTokens: 0, outputTokens: 0 }, dauerMs: Date.now() - start, kostenEur: 0,
        nachfass: false, wiederholung: false, warnungen: [], fehler: meldung,
      });
      fertig++;
      console.error(`${fertig}/${n} ${datei} … FEHLER: ${meldung}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(parallel, n) }, () => arbeiter()));
await texterkennung.beenden();

const zusammenfassung = kennzahlenZusammenfassen(kennzahlen);
let gegenseite: KennzahlenZusammenfassung | null = null;
if (arg.vergleich) {
  try {
    const roh = JSON.parse(readFileSync(resolve(arg.vergleich), 'utf8')) as { zusammenfassung?: KennzahlenZusammenfassung };
    if (!roh.zusammenfassung) throw new Error('kein Feld „zusammenfassung“');
    gegenseite = roh.zusammenfassung;
  } catch (e) {
    console.error(`--vergleich nicht lesbar (${e instanceof Error ? e.message : String(e)}) — Ausgabe ohne Gegenüberstellung.`);
  }
}

const jetzt = new Date();
const datum = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
mkdirSync(ausgabeDir, { recursive: true });
const name = `extraktion-${datum}-${schema}`;

const json = {
  erstellt: jetzt.toISOString(), schema, promptVersion, attrappe: arg.attrappe, anzahl: n,
  zusammenfassung,
  ...(gegenseite ? { vergleich: { mit: basename(arg.vergleich!), schema: gegenseite.schema, delta: kennzahlenVergleich(gegenseite, zusammenfassung) } } : {}),
  exposes: kennzahlen,
};
writeFileSync(join(ausgabeDir, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);

const zeilen = kennzahlen.map((k) => {
  const kern = KERNFELDER.filter((f) => k.kern[f]).length;
  const abw = KONSISTENZ_REGELN.filter((r) => k.konsistenz[r] === 'abweichung').length;
  const flags = [k.abgeschnitten && 'abgeschnitten', k.wiederholung && 'Wiederholung', k.nachfass && 'Nachfass', k.fehler && 'Fehler'].filter(Boolean).join(', ');
  return `| ${k.datei.replace(/\|/g, '/')} | ${modellKurz(k.modell)} | ${zahlDe(k.dauerMs / 1000, 1)} s | ${zahlDe(k.kostenEur, 4)} € | ${k.einheitenAnzahl} | ${kern}/${KERNFELDER.length} | ${k.belegQuote == null ? '–' : `${k.belegQuote} %`} | ${abw} | ${flags || '–'} |`;
});
const md = [
  `# Prüfsatz Exposé-Extraktion · ${datum} · ${schema}`,
  '',
  `Prompt ${promptVersion} · ${n} Exposés${arg.attrappe ? ' · **KI-Attrappe (keine echten Werte)**' : ''}${gegenseite ? ` · Vergleich mit ${basename(arg.vergleich!)} (${gegenseite.schema})` : ''}`,
  '',
  kennzahlenAlsMarkdown(zusammenfassung, gegenseite ?? undefined),
  '## Je Exposé',
  '',
  '| Datei | Modell | Dauer | Kosten | Einheiten | Kernfelder | Belege | Konsistenz-Abw. | Hinweise |',
  '|---|---|---:|---:|---:|---:|---:|---:|---|',
  ...zeilen,
  '',
].join('\n');
writeFileSync(join(ausgabeDir, `${name}.md`), md);

console.error(`\nFertig: ${n} Exposés, ${zusammenfassung.fehler} Fehler, ${zahlDe(zusammenfassung.kostenEurSumme, 2)} €, ${buchungen.length} KI-Aufrufe.`);
console.error(`→ ${join(ausgabeDir, `${name}.json`)}\n→ ${join(ausgabeDir, `${name}.md`)}`);
