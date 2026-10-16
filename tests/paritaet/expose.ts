/**
 * Parallelprüfung des Exposé-Imports (Protokoll 31, B7/E7): dieselben PDFs auf drei Wegen, die Felder der Prüfseite im Vergleich.
 *
 *   alt — die laufende alte App (Ticket, Upload in ihren Eingang, POST /api/expose/analyse). Teil A auf dem pdfjs-Text, Scan → PDF an Sonnet.
 *   v0  — der Neubau im v0-Weg: derselbe Aufruf wie alt, portiert (Prüfsatz-Schema v0).
 *   v2  — der Neubau im Produktivweg: Rohdaten ohne KI, Teil A auf dem Dokument-Text, Scan → OCR → Text; Ergebnis über `zuordnen` in die v0-Form.
 *
 * alt ↔ v0 ist derselbe Weg zweimal und zeigt das KI-Rauschen; v0 ↔ v2 zeigt die Wirkung der anderen Eingabe. Ein Merkmal gilt als
 * **Befund**, wenn v2 von alt und v0 abweicht, obwohl alt und v0 übereinstimmen; als **Rauschen**, wenn v2 mit einem der beiden übereinstimmt;
 * als **unklar**, wenn alle drei verschieden sind.
 *
 *   pnpm paritaet:expose --ordner "<Pfad>" --nur "Postplatz,Kernen" [--scan "Kernen"] [--ohne-alt] [--dpi 150] [--ausgabe <md>] [--cache <dir>]
 *
 * `--scan` nimmt die genannten PDFs zusätzlich als nachgestellten Scan (gerastert, ohne Textlayer) — der Textweg desselben Exposés ist
 * dann die Wahrheit für den Scan-Weg. Echter Lauf kostet Geld (ANTHROPIC_API_KEY aus .env; die alte App bucht ihre Aufrufe selbst).
 * Je PDF und Weg wird das Ergebnis unter `--cache` abgelegt; ein zweiter Lauf fragt die KI nicht noch einmal (`--frisch` erzwingt es).
 * Der Bericht (berichte/paritaet/expose.md, ignoriert) enthält Werte aus den Exposés; die Konsole nur Dateinamen und Zähler.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ExtrahiertV0, zuordnen } from '@gg/domain';
import { type AnalyseAbhaengigkeiten, analysiereExpose, anthropicClient, pdfAlsScan, pdfDokument, pdfText, tesseractOcr } from '@gg/integrations';
import { ALT_API, BERICHTE } from './umgebung.ts';

const WURZEL = join(import.meta.dirname, '../..');

const { values: arg } = parseArgs({
  options: {
    ordner: { type: 'string' },
    nur: { type: 'string' },
    scan: { type: 'string' },
    dpi: { type: 'string', default: '150' },
    'ohne-alt': { type: 'boolean', default: false },
    frisch: { type: 'boolean', default: false },
    ausgabe: { type: 'string', default: join(BERICHTE, 'expose.md') },
    cache: { type: 'string', default: join(WURZEL, '.cache/paritaet-expose') },
  },
});

function abbruch(meldung: string): never { console.error(meldung); process.exit(1); }

if (!arg.ordner) abbruch('Aufruf: pnpm paritaet:expose --ordner "<Pfad>" --nur "a,b" [--scan "a"] [--ohne-alt] [--dpi 150] [--ausgabe <md>] [--cache <dir>] [--frisch]');
const ordner = resolve(arg.ordner);
if (!existsSync(ordner)) abbruch(`Ordner nicht gefunden: ${ordner}`);
const schluessel = process.env.ANTHROPIC_API_KEY;
if (!schluessel) abbruch('ANTHROPIC_API_KEY fehlt (in .env).');
const mitAlt = !arg['ohne-alt'];
const dpi = Number(arg.dpi) || 150;
const cacheDir = resolve(arg.cache!);
mkdirSync(cacheDir, { recursive: true });
mkdirSync(BERICHTE, { recursive: true });

const teile = (s?: string) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const nur = teile(arg.nur);
const scans = teile(arg.scan);
const alle = readdirSync(ordner).filter((d) => d.toLowerCase().endsWith('.pdf')).sort((a, b) => a.localeCompare(b, 'de'));
const passt = (datei: string, muster: string[]) => muster.some((m) => datei.toLowerCase().includes(m));
const dateien = nur.length ? alle.filter((d) => passt(d, nur)) : alle;
if (!dateien.length) abbruch('Keine passenden PDFs gefunden.');

// ── Die drei Wege ─────────────────────────────────────────────────────────────────────────────────────────────

type Weg = 'alt' | 'v0' | 'v2';
interface Lauf {
  weg: Weg;
  extrahiert: ExtrahiertV0 | any;
  modus: string;
  modell: string;
  seiten: number;
  zeichenProSeite: number;
  dauerMs: number;
  kostenEur: number | null;
  nachfass: boolean;
  warnungen: string[];
  fehler?: string;
}

const ki = anthropicClient(schluessel);
const texterkennung = tesseractOcr();
const abh: AnalyseAbhaengigkeiten = {
  ki,
  pdfText: (pdf) => pdfText(Buffer.from(pdf)),
  dokument: (pdf) => pdfDokument(pdf, { ocr: texterkennung.ocr }),
  buchen: async () => { /* nur messen, nichts buchen */ },
};

async function alt(pdf: Uint8Array, name: string): Promise<Lauf> {
  const start = Date.now();
  const ticket = await (await fetch(`${ALT_API}/api/upload/ticket`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zweck: 'expose-pdf', groesse: pdf.byteLength }),
  })).json() as { url?: string; key?: string; error?: string };
  if (!ticket.url || !ticket.key) throw new Error(`alte App: kein Upload-Ticket (${ticket.error ?? 'unbekannt'})`);
  const put = await fetch(ticket.url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: new Blob([pdf as BlobPart], { type: 'application/pdf' }) });
  if (!put.ok) throw new Error(`alte App: Upload ${put.status}`);
  const antwort = await fetch(`${ALT_API}/api/expose/analyse`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: ticket.key, dateiname: name }),
    signal: AbortSignal.timeout(600_000),
  });
  const e = await antwort.json() as any;
  if (!antwort.ok) throw new Error(`alte App: Analyse ${antwort.status} — ${e?.error ?? ''}`);
  return { weg: 'alt', extrahiert: e.extrahiert, modus: e.modus, modell: e.modell, seiten: e.seiten, zeichenProSeite: e.zeichenProSeite, dauerMs: Date.now() - start, kostenEur: null, nachfass: false, warnungen: e.hinweis ? [e.hinweis] : [] };
}

async function neu(weg: 'v0' | 'v2', pdf: Uint8Array, name: string): Promise<Lauf> {
  const e = await analysiereExpose(pdf, name, abh, { schema: weg });
  const extrahiert = weg === 'v2' && e.v2 ? zuordnen(e.v2, null, {}).pruefdaten : e.extrahiert;
  return { weg, extrahiert, modus: e.modus, modell: e.modell, seiten: e.seiten, zeichenProSeite: e.zeichenProSeite, dauerMs: e.dauerMs, kostenEur: e.kostenEur, nachfass: e.nachfass, warnungen: e.warnungen };
}

async function lauf(weg: Weg, pdf: Uint8Array, name: string, hash: string): Promise<Lauf> {
  const pfad = join(cacheDir, `${hash}-${weg}.json`);
  if (!arg.frisch && existsSync(pfad)) return JSON.parse(readFileSync(pfad, 'utf8')) as Lauf;
  let ergebnis: Lauf;
  try {
    ergebnis = weg === 'alt' ? await alt(pdf, name) : await neu(weg, pdf, name);
  } catch (e) {
    return { weg, extrahiert: null, modus: '—', modell: '—', seiten: 0, zeichenProSeite: 0, dauerMs: 0, kostenEur: null, nachfass: false, warnungen: [], fehler: e instanceof Error ? e.message : String(e) };
  }
  writeFileSync(pfad, JSON.stringify(ergebnis));
  return ergebnis;
}

// ── Merkmale und Vergleich ────────────────────────────────────────────────────────────────────────────────────

type Wert = string | number | null;
interface Merkmal { name: string; lesen: (x: any) => Wert; art: 'text' | 'zahl' | 'name' | 'laenge' }

const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const einheiten = (x: any): any[] => (Array.isArray(x?.objekt?.einheiten) ? x.objekt.einheiten : []);
const summe = (xs: any[], feld: string) => { const w = xs.map((e) => zahl(e?.[feld])).filter((n): n is number => n !== null); return w.length ? Math.round(w.reduce((a, b) => a + b, 0)) : null; };

const MERKMALE: Merkmal[] = [
  { name: 'objekt.strasse', lesen: (x) => text(x?.objekt?.strasse), art: 'text' },
  { name: 'objekt.hausnr', lesen: (x) => text(x?.objekt?.hausnr), art: 'text' },
  { name: 'objekt.plz', lesen: (x) => text(x?.objekt?.plz), art: 'text' },
  { name: 'objekt.stadt', lesen: (x) => text(x?.objekt?.stadt), art: 'text' },
  { name: 'objekt.baujahr', lesen: (x) => zahl(x?.objekt?.baujahr), art: 'zahl' },
  { name: 'objekt.wohnflaeche', lesen: (x) => zahl(x?.objekt?.wohnflaeche), art: 'zahl' },
  { name: 'objekt.grundstueck', lesen: (x) => zahl(x?.objekt?.grundstueck), art: 'zahl' },
  { name: 'objekt.einheitenAnz', lesen: (x) => zahl(x?.objekt?.einheitenAnz), art: 'zahl' },
  { name: 'objekt.angebotspreis', lesen: (x) => zahl(x?.objekt?.angebotspreis), art: 'zahl' },
  { name: 'objekt.istmiete (Monat)', lesen: (x) => zahl(x?.objekt?.istmiete), art: 'zahl' },
  { name: 'objekt.bruttorendite', lesen: (x) => zahl(x?.objekt?.bruttorendite), art: 'zahl' },
  { name: 'objekt.heizungsart', lesen: (x) => text(x?.objekt?.heizungsart), art: 'text' },
  { name: 'objekt.heizungsbaujahr', lesen: (x) => zahl(x?.objekt?.heizungsbaujahr), art: 'zahl' },
  { name: 'energieausweis.klasse', lesen: (x) => text(x?.objekt?.energieausweis?.klasse), art: 'text' },
  { name: 'energieausweis.kennwert', lesen: (x) => zahl(x?.objekt?.energieausweis?.kennwert), art: 'zahl' },
  { name: 'energieausweis.art', lesen: (x) => text(x?.objekt?.energieausweis?.art), art: 'text' },
  { name: 'einheiten: Anzahl', lesen: (x) => einheiten(x).length, art: 'zahl' },
  { name: 'einheiten: Wohnungen', lesen: (x) => einheiten(x).filter((e) => e?.typ === 'Wohnung').length, art: 'zahl' },
  { name: 'einheiten: Gewerbe', lesen: (x) => einheiten(x).filter((e) => e?.typ === 'Gewerbe').length, art: 'zahl' },
  { name: 'einheiten: Stellplätze', lesen: (x) => einheiten(x).filter((e) => e?.typ === 'Stellplatz').length, art: 'zahl' },
  { name: 'einheiten: Σ Fläche', lesen: (x) => summe(einheiten(x), 'flaeche'), art: 'zahl' },
  { name: 'einheiten: Σ Kaltmiete', lesen: (x) => summe(einheiten(x), 'kaltmiete'), art: 'zahl' },
  { name: 'einheiten: vermietet', lesen: (x) => einheiten(x).filter((e) => e?.vermiet === 'Vermietet').length, art: 'zahl' },
  { name: 'makler.name', lesen: (x) => text(x?.makler?.name), art: 'name' },
  { name: 'makler.firma', lesen: (x) => text(x?.makler?.firma), art: 'name' },
  { name: 'makler.mobiltel', lesen: (x) => text(x?.makler?.mobiltel), art: 'text' },
  { name: 'makler.tel', lesen: (x) => text(x?.makler?.tel ?? x?.makler?.festnetztel), art: 'text' },
  { name: 'makler.email', lesen: (x) => text(x?.makler?.email), art: 'text' },
  { name: 'kalkulation.kaufpreis', lesen: (x) => zahl(x?.kalkulation?.kaufpreis), art: 'zahl' },
  { name: 'kalkulation.makler (%)', lesen: (x) => zahl(x?.kalkulation?.makler), art: 'zahl' },
  { name: 'lagebeschreibung (Zeichen)', lesen: (x) => (text(x?.objekt?.lagebeschreibung) ?? '').length, art: 'laenge' },
  { name: 'ausstattung (Zeichen)', lesen: (x) => (text(x?.objekt?.ausstattung) ?? '').length, art: 'laenge' },
  { name: 'notizen (Zeichen)', lesen: (x) => (text(x?.objekt?.notizen) ?? '').length, art: 'laenge' },
];

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/str\.(?=\s|$)/g, 'straße').replace(/[.,;:]+$/g, '').replace(/[\s-]/g, '').trim();
const normTel = (s: string) => s.replace(/\D/g, '').replace(/^0049/, '0').replace(/^49/, '0');

function gleich(m: Merkmal, a: Wert, b: Wert): boolean {
  if (a === null || b === null) return a === b;
  if (m.art === 'zahl' || m.art === 'laenge') {
    const x = Number(a); const y = Number(b);
    return Math.abs(x - y) <= Math.max(1, 0.01 * Math.max(Math.abs(x), Math.abs(y)));
  }
  const sa = String(a); const sb = String(b);
  if (/tel/.test(m.name)) return normTel(sa) === normTel(sb);
  if (m.art === 'name') { const na = normText(sa); const nb = normText(sb); return na === nb || na.includes(nb) || nb.includes(na); }
  return normText(sa) === normText(sb);
}

type Urteil = 'gleich' | 'rauschen' | 'befund' | 'unklar' | 'abweichung' | 'info';

function urteilen(m: Merkmal, werte: Partial<Record<Weg, Wert>>): Urteil {
  if (m.art === 'laenge') return 'info';
  const v0 = werte.v0 ?? null; const v2 = werte.v2 ?? null;
  if (!mitAlt || werte.alt === undefined) return gleich(m, v0, v2) ? 'gleich' : 'abweichung';
  const a = werte.alt ?? null;
  const av = gleich(m, a, v0); const a2 = gleich(m, a, v2); const v02 = gleich(m, v0, v2);
  if (av && a2 && v02) return 'gleich';
  if (av && !a2 && !v02) return 'befund';
  if (a2 || v02) return 'rauschen';
  return 'unklar';
}

// ── Lauf ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Fall { name: string; pdf: Uint8Array; scan: boolean }
const faelle: Fall[] = [];
for (const d of dateien) {
  const pdf = new Uint8Array(readFileSync(join(ordner, d)));
  faelle.push({ name: d, pdf, scan: false });
  if (passt(d, scans)) faelle.push({ name: `${d} [Scan ${dpi} dpi]`, pdf: await pdfAlsScan(pdf, { dpi }), scan: true });
}

const wege: Weg[] = mitAlt ? ['alt', 'v0', 'v2'] : ['v0', 'v2'];
const zeilen: string[] = [`# Parallelprüfung Exposé-Import alt ↔ v0 ↔ v2 · ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`, '',
  `Ordner: \`${ordner}\` · Wege: ${wege.join(', ')} · Scan-Nachstellung: ${scans.length ? `${scans.join(', ')} (${dpi} dpi)` : 'keine'}`, ''];
const gesamt: Record<Urteil, number> = { gleich: 0, rauschen: 0, befund: 0, unklar: 0, abweichung: 0, info: 0 };
const uebersicht: string[] = [];
const roh: Record<string, Partial<Record<Weg, Lauf>>> = {};
let kostenNeu = 0;
const md = (s: unknown) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);

for (const fall of faelle) {
  const hash = createHash('sha256').update(fall.pdf).digest('hex').slice(0, 16);
  console.log(`\n▶ ${fall.name} (${(fall.pdf.byteLength / 1e6).toFixed(1)} MB)`);
  const laeufe: Partial<Record<Weg, Lauf>> = {};
  for (const weg of wege) {
    const start = Date.now();
    laeufe[weg] = await lauf(weg, fall.pdf, basename(fall.name), hash);
    const l = laeufe[weg]!;
    kostenNeu += l.kostenEur ?? 0;
    console.log(`  ${weg.padEnd(3)} ${l.fehler ? `FEHLER: ${l.fehler.slice(0, 120)}` : `${l.modus}/${l.modell} · ${l.seiten} S · ${l.zeichenProSeite} Z/S · ${Math.round(l.dauerMs / 1000)} s${l.kostenEur !== null ? ` · ${(l.kostenEur * 100).toFixed(1)} ct` : ''}${l.nachfass ? ' · Nachfass' : ''}`} (${Math.round((Date.now() - start) / 1000)} s)`);
  }
  roh[fall.name] = laeufe;

  const zaehler: Record<Urteil, number> = { gleich: 0, rauschen: 0, befund: 0, unklar: 0, abweichung: 0, info: 0 };
  const tabelle: string[] = [`| Merkmal | ${wege.join(' | ')} | Urteil |`, `|---|${wege.map(() => '---').join('|')}|---|`];
  for (const m of MERKMALE) {
    const werte: Partial<Record<Weg, Wert>> = {};
    for (const weg of wege) werte[weg] = laeufe[weg]?.extrahiert ? m.lesen(laeufe[weg]!.extrahiert) : null;
    const u = urteilen(m, werte);
    zaehler[u]++; gesamt[u]++;
    const zeichen = { gleich: '✓', rauschen: '~ Rauschen', befund: '**✗ Befund**', unklar: '? unklar', abweichung: '**✗**', info: '·' }[u];
    tabelle.push(`| ${m.name} | ${wege.map((w) => md(werte[w])).join(' | ')} | ${zeichen} |`);
  }
  console.log(`  → gleich ${zaehler.gleich}, Rauschen ${zaehler.rauschen}, Befund ${zaehler.befund}, unklar ${zaehler.unklar}${!mitAlt ? `, Abweichung ${zaehler.abweichung}` : ''}`);
  uebersicht.push(`| ${md(fall.name)} | ${wege.map((w) => { const l = laeufe[w]!; return l.fehler ? 'FEHLER' : `${l.modus} · ${l.modell.replace('claude-', '')}${l.nachfass ? ' · Nachfass' : ''}`; }).join(' | ')} | ${zaehler.gleich} | ${zaehler.rauschen} | ${zaehler.befund} | ${zaehler.unklar} |`);

  zeilen.push(`## ${fall.name}`, '', `| Weg | Modus | Modell | Seiten | Zeichen/Seite | Dauer | Kosten | Nachfass | Warnungen |`, `|---|---|---|---|---|---|---|---|---|`);
  for (const weg of wege) {
    const l = laeufe[weg]!;
    zeilen.push(`| ${weg} | ${l.fehler ? `FEHLER: ${md(l.fehler)}` : l.modus} | ${md(l.modell)} | ${l.seiten} | ${l.zeichenProSeite} | ${Math.round(l.dauerMs / 1000)} s | ${l.kostenEur !== null ? `${(l.kostenEur * 100).toFixed(1)} ct` : 'in der alten App gebucht'} | ${l.nachfass ? 'ja' : '—'} | ${l.warnungen.length ? md(l.warnungen.join(' · ')) : '—'} |`);
  }
  zeilen.push('', ...tabelle, '');
}

const kopf = [
  `**Gesamt:** gleich ${gesamt.gleich} · Rauschen ${gesamt.rauschen} · Befund ${gesamt.befund} · unklar ${gesamt.unklar}${!mitAlt ? ` · Abweichung ${gesamt.abweichung}` : ''} · Kosten Neubau (v0 + v2): ${(kostenNeu * 100).toFixed(1)} ct`, '',
  `| Exposé | ${wege.join(' | ')} | gleich | Rauschen | Befund | unklar |`, `|---|${wege.map(() => '---').join('|')}|---|---|---|---|`, ...uebersicht, '',
  'Rauschen = derselbe Weg liefert zweimal Verschiedenes (alt ↔ v0), v2 stimmt mit einem der beiden überein. Befund = alt und v0 stimmen überein, v2 weicht ab. Zahlen gelten als gleich bei ±1 % (mindestens ±1).', '',
];
zeilen.splice(4, 0, ...kopf);
writeFileSync(resolve(arg.ausgabe!), zeilen.join('\n'));
writeFileSync(resolve(arg.ausgabe!).replace(/\.md$/, '.json'), JSON.stringify(roh, null, 1));
texterkennung.beenden?.();
console.log(`\nBericht: ${resolve(arg.ausgabe!)}\nGesamt: gleich ${gesamt.gleich}, Rauschen ${gesamt.rauschen}, Befund ${gesamt.befund}, unklar ${gesamt.unklar} · Kosten Neubau ${(kostenNeu * 100).toFixed(1)} ct`);
