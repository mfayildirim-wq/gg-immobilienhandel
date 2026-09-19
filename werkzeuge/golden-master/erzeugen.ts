/**
 * Golden Master: führt den ORIGINALCODE der alten App (../gg-immohandel, nur lesend) mit vielen
 * Eingabefällen aus und speichert Eingaben + Ergebnisse als JSON unter packages/domain/test/golden/.
 * Die portierten Engines müssen exakt dieselben Ergebnisse liefern. Die Tests brauchen das alte Repo danach nicht mehr.
 *
 *   pnpm golden:erzeugen            (ALT_REPO=/pfad/zu/gg-immohandel, Standard ../gg-immohandel)
 *
 * Ankaufskalkulation: `dealKalkRC` und `dealRenderEinheiten` hängen am DOM und an Modulzustand. Ihr Quelltext wird
 * wörtlich aus deals.ts gelesen, nach JavaScript übersetzt und mit Stubs für DOM/Zustand ausgeführt. Jede Anzeige
 * (V/T nach Element-ID) und die in dealDK zurückgeschriebenen Kennzahlen werden aufgezeichnet.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const ALT = resolve(process.env.ALT_REPO ?? join(import.meta.dirname, '../../../gg-immohandel'));
const ZIEL = join(import.meta.dirname, '../../packages/domain/test/golden');
const ZIEL_DOKUMENTE = join(import.meta.dirname, '../../packages/documents/test/golden');
const lies = (p: string) => readFileSync(join(ALT, p), 'utf8');

// ── deterministischer Zufall ─────────────────────────────────
function zufall(seed: number) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    r,
    /** stellen < 0 rundet auf Zehnerpotenzen (-3 → volle Tausend) */
    zahl: (min: number, max: number, stellen = 0) => {
      const f = 10 ** stellen;
      return Math.round((min + r() * (max - min)) * f) / f;
    },
    wahl: <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!,
    ja: (p = 0.5) => r() < p,
  };
}

// ── Funktionsquelltext wörtlich herauslösen ─────────────────
function funktion(quelle: string, kopf: string, rumpfNach?: string): string {
  const start = quelle.indexOf(kopf);
  if (start < 0) throw new Error(`nicht gefunden: ${kopf}`);
  if (rumpfNach) {
    // Rückgabetyp mit { } über mehrere Zeilen: der Rumpf beginnt nach dieser Markierung
    const r = quelle.indexOf(rumpfNach, start) + rumpfNach.length - 1;
    let t = 0;
    for (let j = r; j < quelle.length; j++) {
      if (quelle[j] === '{') t++;
      else if (quelle[j] === '}' && --t === 0) return quelle.slice(start, j + 1).replace(/^export /, '');
    }
    throw new Error(`unvollständig: ${kopf}`);
  }
  // Parameterliste überspringen (kann Typen mit { } enthalten), dann beginnt der Rumpf mit dem letzten „{“ am Zeilenende
  let i = quelle.indexOf('(', start);
  for (let tiefe = 0; i < quelle.length; i++) {
    if (quelle[i] === '(') tiefe++;
    else if (quelle[i] === ')' && --tiefe === 0) break;
  }
  const zeilenEnde = /\{[ \t]*\r?\n/.exec(quelle.slice(i));
  if (!zeilenEnde) throw new Error(`Rumpf nicht gefunden: ${kopf}`);
  const rumpf = i + zeilenEnde.index;
  let tiefe = 0;
  for (let j = rumpf; j < quelle.length; j++) {
    if (quelle[j] === '{') tiefe++;
    else if (quelle[j] === '}' && --tiefe === 0) return quelle.slice(start, j + 1).replace(/^export /, '');
  }
  throw new Error(`unvollständig: ${kopf}`);
}

function objektLiteral(quelle: string, name: string): Record<string, number> {
  const m = new RegExp(`${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\})`).exec(quelle);
  if (!m) throw new Error(`nicht gefunden: ${name}`);
  return new Function(`return (${m[1]!})`)() as Record<string, number>;
}

// ═════════════ Ankaufskalkulation ═════════════
const deals = lies('src/modules/deals/deals.ts');
const utils = lies('src/lib/utils.ts');
const KALK_STANDARD = objektLiteral(lies('src/lib/kalkDefaults.ts'), 'KALK_DEFAULTS_STANDARD');

const jsQuelle = ts.transpile(
  [funktion(utils, 'export function parseNum('), funktion(deals, 'export function dealRenderEinheiten('), funktion(deals, 'export function dealKalkRC(')].join('\n'),
  { target: ts.ScriptTarget.ES2022 },
);
const baueAlt = new Function(
  'dealDK', 'dealDE', 'dealDSAN', 'getKalkDefaults', 'V', 'T', 'document', 'updateAufkHelperSum', 'dealAmpel', 'initEinheitenSortable', 'fmtNum', 'dealRenderSan',
  `${jsQuelle}\nreturn { dealKalkRC, dealRenderEinheiten };`,
);

export interface AnkaufFall {
  name: string;
  eingabe: { kalk: Record<string, unknown>; einheiten: Record<string, unknown>[]; sanierung: Record<string, unknown>[]; standard: Record<string, number> };
  anzeige: Record<string, string>;
  ampel: Record<string, number>;
  ergebnis: Record<string, unknown>;
}

function altAnkauf(name: string, eingabe: AnkaufFall['eingabe']): AnkaufFall {
  const dk = structuredClone(eingabe.kalk);
  const de = structuredClone(eingabe.einheiten);
  const anzeige: Record<string, string> = {};
  const ampel: Record<string, number> = {};
  const merke = (id: string, v: unknown) => { anzeige[id] = String(v); };
  const einhBody = { querySelectorAll: () => ({ length: de.length }) };
  const document = { getElementById: (id: string) => (id === 'dk-einh-body' ? einhBody : null) };
  const alt = baueAlt(dk, de, structuredClone(eingabe.sanierung), () => ({ ...eingabe.standard }), merke, merke, document,
    () => {}, (id: string, m: number) => { ampel[id] = m; }, () => {}, (n: unknown) => String(n), () => {});
  alt.dealKalkRC();
  const ergebnis = Object.fromEntries(['gik', 'kaufpreis', 'gewinnAuf', 'margeAuf', 'gewinnGlo', 'margeGlo'].map((k) => [k, dk[k]]));
  return { name, eingabe, anzeige, ampel, ergebnis };
}

function ankaufFaelle(): AnkaufFall[] {
  const z = zufall(20260917);
  const faelle: AnkaufFall[] = [];
  const std = KALK_STANDARD;
  const deZahl = (n: number) => n.toLocaleString('de-DE');
  const einheit = (i: number) => {
    const typ = z.wahl(['Wohnung', 'Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges']);
    const e: Record<string, unknown> = { id: `e${i}`, typ, lage: `L${i}` };
    if (typ === 'Stellplatz') e.stk = z.wahl([1, 2, 3, '', undefined]);
    else e.fl = z.wahl([z.zahl(18, 180, 1), deZahl(z.zahl(18, 180, 1)), '', 0]);
    e.mi_ist = z.wahl([z.zahl(0, 2500, 0), deZahl(z.zahl(100, 2500, 2)), '', 0]);
    if (z.ja(0.35)) { e.mi_neu_manual = true; e.mi_neu = z.wahl([z.zahl(100, 3000, 0), deZahl(z.zahl(100, 3000, 2)), '']); }
    e.rend_k = z.wahl([z.zahl(2.5, 8, 1), '', 0, 4.5]);
    if (z.ja(0.25)) e.vkp = z.wahl([z.zahl(15000, 900000, 0), '']);
    return e;
  };
  const optional = (feld: string, wert: () => unknown, kalk: Record<string, unknown>, p = 0.6) => { if (z.ja(p)) kalk[feld] = wert(); };

  for (let n = 0; n < 400; n++) {
    const kalk: Record<string, unknown> = { kaufpreis: z.wahl([0, z.zahl(80000, 6000000, 0), z.zahl(250000, 2500000, -3)]) };
    optional('notar', () => z.wahl([0, z.zahl(0, 3, 2)]), kalk);
    optional('gest', () => z.wahl([0, 3.5, 5, 6, 6.5]), kalk);
    optional('makler', () => z.wahl([0, 3.57, 4.76, 7.14]), kalk);
    optional('euribor', () => z.zahl(0, 5, 2), kalk);
    optional('margeB', () => z.zahl(0, 4, 2), kalk);
    if (z.ja(0.7)) { const fk = z.wahl([0, 50, 70, 80, 90, 100, z.zahl(0, 100, 0)]); kalk.fk_p = fk; kalk.ek_p = z.ja(0.9) ? 100 - fk : z.zahl(0, 100, 0); }
    optional('ek_r', () => z.wahl([0, 8, 15, 25]), kalk);
    optional('halt', () => z.wahl([0, 6, 12, 18, 24, 36]), kalk);
    optional('vprov', () => z.wahl([0, 3.57, 4.76]), kalk);
    optional('aufk', () => z.wahl([0, 5000, z.zahl(0, 60000, 0)]), kalk, 0.5);
    optional('auf_h', () => z.wahl([0, 1, 2]), kalk, 0.3);
    optional('auf_e', () => z.wahl([0, 6, 12]), kalk, 0.3);
    optional('glo_m', () => z.wahl([0, 10, 15, 20]), kalk);
    optional('bank_abgeb', () => z.wahl([0, 1, 2, 3.5]), kalk);
    if (z.ja(0.2)) kalk.rp_fix = z.wahl([0, z.zahl(1000, 80000, 0)]);
    else optional('rp_pct', () => z.wahl([0, 5, 10, 20]), kalk, 0.5);
    const einheiten = Array.from({ length: z.wahl([0, 1, 3, 6, 9, 14]) }, (_, i) => einheit(i));
    const sanierung = Array.from({ length: z.wahl([0, 1, 2, 4, 7]) }, (_, i) => ({
      id: `s${i}`, desc: `Posten ${i}`, amt: z.wahl([0, z.zahl(500, 250000, 0), '']), ...(z.ja(0.7) ? { scope: z.wahl(['both', 'auf', 'glo']) } : {}),
    }));
    const standard = z.ja(0.8) ? std : { ...std, notar: 1.5, gest: 6.5, fk_p: 100, ek_p: 0, halt: 18, glo_m: 12, rp_pct: 15, bank_abgeb: 0 };
    faelle.push(altAnkauf(`zufall-${n}`, { kalk, einheiten, sanierung, standard }));
  }

  // Randfälle
  faelle.push(altAnkauf('leer', { kalk: {}, einheiten: [], sanierung: [], standard: std }));
  faelle.push(altAnkauf('nenner-unter-005', {
    kalk: { kaufpreis: 1000000, fk_p: 100, ek_p: 100, euribor: 40, margeB: 30, ek_r: 60, halt: 36, bank_abgeb: 20 },
    einheiten: [{ typ: 'Wohnung', fl: 100, mi_ist: 1000, rend_k: 4 }], sanierung: [{ amt: 50000 }], standard: std,
  }));
  faelle.push(altAnkauf('fk-100-ek-0', { kalk: { kaufpreis: 900000, fk_p: 100, ek_p: 0 }, einheiten: [{ typ: 'Wohnung', fl: 80, mi_ist: 800, rend_k: 4.5 }], sanierung: [], standard: std }));
  faelle.push(altAnkauf('nur-stellplaetze', { kalk: { kaufpreis: 120000 }, einheiten: [{ typ: 'Stellplatz', stk: 4, mi_ist: 320, rend_k: 5 }], sanierung: [], standard: std }));
  faelle.push(altAnkauf('demo-deal-001', {
    kalk: { rp: 10, aufk: 10000, gest: 5, auf_e: 6, auf_h: 1, glo_m: 15, nachg: 100000, notar: 2, vprov: 4.76, makler: 4.76, margeB: 2.5, euribor: 2, kaufpreis: 1200000 },
    einheiten: [
      { id: 'de1', typ: 'Wohnung', lage: 'EG links', fl_ist: 78, mi_ist: 780, rend_k: 4, fl_soll: 78, mi_soll: 900 },
      { id: 'de2', typ: 'Wohnung', lage: 'EG rechts', fl_ist: 82, mi_ist: 820, rend_k: 4, fl_soll: 82, mi_soll: 950 },
    ],
    sanierung: [{ id: 's1', amt: 45000, desc: 'Treppenhaussanierung' }, { id: 's2', amt: 38000, desc: 'Fensteraustausch' }],
    standard: std,
  }));
  return faelle;
}

// ═════════════ Kundenkalkulation ═════════════
async function kundenFaelle() {
  const { computeKKalk } = (await import(join(ALT, 'src/lib/kundenKalkEngine.ts'))) as typeof import('../../packages/domain/src/kundenkalkulation/engine.ts');
  const z = zufall(42);
  const faelle: { name: string; eingabe: unknown; ergebnis: unknown }[] = [];
  for (let n = 0; n < 120; n++) {
    const kaufpreis = z.wahl([0, z.zahl(90000, 900000, -2), z.zahl(900000, 4000000, -3)]);
    const eingabe = {
      kaufpreis,
      notarPct: z.wahl([0, 0.015, 0.02]), grundbuchPct: z.wahl([0, 0.005]), grundsteuerPct: z.wahl([0.035, 0.05, 0.065]),
      maklerPct: z.wahl([0, 0.0357, 0.0714]), sonstigePct: z.wahl([0, 0.01]),
      sanierungsposten: Array.from({ length: z.wahl([0, 1, 3]) }, (_, i) => ({
        label: `S${i}`, amount: z.zahl(0, 120000, 0), modus: z.wahl(['sofort', 'aktivieren', 'weg_ruecklage'] as const),
      })),
      nettokaltmieteMonat: z.zahl(0, 6000, 0), stellplatzMiete: z.wahl([0, 60, 120]), sonstigeMiete: z.wahl([0, 50]),
      umlagefaehig: z.zahl(0, 800, 0), mieterhoehungJaehrlich: z.wahl([0, 0.01, 0.02, 0.03]),
      nichtUmlagefaehig: z.zahl(0, 400, 0), kostensteigerungJaehrlich: z.wahl([0, 0.02]),
      wertsteigerungJaehrlich: z.wahl([0, 0.01, 0.02, 0.035]), anteilGebaeudeKaufpreis: z.wahl([0.6, 0.75, 0.85]),
      afaSatz: z.wahl([0.02, 0.025, 0.03]),
      ...(z.ja(0.2) ? { afaTypDenkmal: true, denkmalAfaBasis: z.zahl(10000, 300000, 0), denkmalAfaSatz: z.wahl([0.09, 0.07]) } : {}),
      grenzsteuersatz: z.wahl([0, 0.3, 0.42, 0.45]),
      darlehen: Array.from({ length: z.wahl([0, 1, 2, 3]) }, (_, i) => ({
        label: `D${i}`, summe: z.zahl(0, Math.max(1, kaufpreis), -3), zinssatz: z.wahl([0, 0.025, 0.0404, 0.055]), tilgung: z.wahl([0, 0.01, 0.02, 0.03]),
      })),
      betrachtungsdauerJahre: z.wahl([undefined, 5, 10, 10.5, 15, 30, 60]),
      kaufjahr: 2026,
      wohnflaeche: undefined,
      wohnflaecheGesamt: z.wahl([undefined, 0, z.zahl(25, 900, 0)]),
    };
    faelle.push({ name: `zufall-${n}`, eingabe, ergebnis: computeKKalk(eingabe as never) });
  }
  return faelle;
}

// ═════════════ Ankauf-Cockpit: Fälligkeit, Frequenz, Geburtstag ═════════════
function cockpitFaelle() {
  process.env.TZ = 'Europe/Berlin'; // Gerrys Zeitzone: die Datumslogik der alten App hängt daran
  const vertrieb = lies('src/modules/vertrieb/vertrieb.ts');
  const quelle = ts.transpile(
    ['function vtToday(', 'function parseDate(', 'function vtAddDays(', 'function vtFreqDays(', 'function vtNextDue(', 'function vtDueStatus(', 'function vtBirthdayDue(']
      .map((k) => funktion(vertrieb, k.startsWith('function parseDate') || k.startsWith('function vtBirthdayDue') ? k : `export ${k}`))
      .join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  const mitHeute = (heute: string) => {
    const Echt = Date;
    const fest = new Echt(`${heute}T09:30:00`).getTime(); // Ortszeit Berlin, vormittags
    class FesterTag extends Echt {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(fest);
        else super(...(args as [string]));
      }
      static now() { return fest; }
    }
    return new Function('Date', `${quelle}\nreturn { vtNextDue, vtDueStatus, vtBirthdayDue };`)(FesterTag) as {
      vtNextDue: (l: string | null, f: string) => string | null;
      vtDueStatus: (d: string) => { cls: string; label: string; sort: number } | null;
      vtBirthdayDue: (p: { geburtsdatum?: string }) => { inXTagen: number; alter?: number; label: string; urgent: boolean } | null;
    };
  };
  const plus = (iso: string, t: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + t * 86_400_000).toISOString().slice(0, 10);
  const heuteListe = ['2026-01-15', '2026-03-27', '2026-03-29', '2026-03-30', '2026-06-30', '2026-09-17', '2026-10-24', '2026-10-25', '2026-12-31', '2028-02-28'];
  const frequenzen = ['Täglich', 'Wöchentlich', 'Monatlich', 'Alle 3 Monate', 'Alle 6 Monate', 'Alle 12 Monate', 'Nie', 'Nicht kontaktieren', 'Zweiwöchentlich', ''];
  const faelle = [];
  for (const heute of heuteListe) {
    const alt = mitHeute(heute);
    const faelligkeit = [];
    for (let d = -45; d <= 45; d++) faelligkeit.push({ termin: plus(heute, d), ergebnis: alt.vtDueStatus(plus(heute, d)) });
    const termin = [];
    for (const f of frequenzen) for (const t of [-400, -200, -95, -40, -31, -8, -1, 0]) termin.push({ lastContact: plus(heute, t), frequenz: f, ergebnis: alt.vtNextDue(plus(heute, t), f) });
    for (const f of frequenzen) termin.push({ lastContact: null, frequenz: f, ergebnis: alt.vtNextDue(null, f) });
    const geburtstag = [];
    for (let d = -3; d <= 10; d++) {
      const tag = plus(heute, d);
      geburtstag.push({ geburtsdatum: `1970-${tag.slice(5)}`, ergebnis: alt.vtBirthdayDue({ geburtsdatum: `1970-${tag.slice(5)}` }) });
      geburtstag.push({ geburtsdatum: tag.slice(5), ergebnis: alt.vtBirthdayDue({ geburtsdatum: tag.slice(5) }) });
    }
    for (const g of ['', 'kaputt', '1980-02-29', '02-30', '13-01']) geburtstag.push({ geburtsdatum: g, ergebnis: alt.vtBirthdayDue({ geburtsdatum: g }) });
    faelle.push({ heute, faelligkeit, termin, geburtstag });
  }
  return faelle;
}

// ═════════════ Kundenkalkulation: Vorbelegung und Bearbeitung ═════════════
async function kundenBearbeitungFaelle() {
  const modul = lies('src/modules/kundenkalk/kundenkalk.ts');
  const std = objektLiteral(lies('src/lib/kkalkDefaults.ts'), 'KKALK_DEFAULTS_STANDARD');
  const { computeKKalk, splitSanierung } = await import(join(ALT, 'src/lib/kundenKalkEngine.ts'));
  const quelle = ts.transpile(
    ['function defaultsFromDeal(', 'function parseGermanNumber(', 'export function kkalkUpdateField(', 'function applyEK(', 'export function kkalkSetEKQuick(', 'export function kkalkSetTranche1Quick(']
      .map((k) => funktion(modul, k)).join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  const baue = (deals: unknown[], objs: unknown[], kkD: Record<string, number>, hinweise: string[], kk: { wert: any }) =>
    new Function(
      'DB', 'getKKalkDefaults', 'getKKalkHinweise', 'uid', 'todayISO', 'computeKKalk', 'splitSanierung', 'getKKalk', 'saveKKalk', 'kkalkRenderEditView', 'showToast',
      `let _currentKKalkId = 'k1';\n${quelle}\nreturn { defaultsFromDeal, kkalkUpdateField, applyEK, kkalkSetEKQuick, kkalkSetTranche1Quick };`,
    )(
      { get: (key: string) => (key === 'immo-deals' ? deals : key === 'immo-objects' ? objs : null) },
      () => ({ ...kkD }), () => [...hinweise], () => 'neu-id', () => '2026-09-17', computeKKalk, splitSanierung,
      () => kk.wert, (k: unknown) => { kk.wert = structuredClone(k); }, () => {}, () => {},
    );

  const z = zufall(777);
  const einheit = (i: number) => {
    const typ = z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz']);
    return {
      id: `e${i}`, typ, lage: z.wahl([`EG ${i}`, `1.OG li ${i}`, '', undefined]),
      fl: typ === 'Stellplatz' ? undefined : z.wahl([z.zahl(20, 140, 1), '85', '', undefined]),
      mi_ist: z.wahl([z.zahl(0, 1800, 0), '', undefined]), mi_neu: z.wahl([z.zahl(0, 2200, 0), '', undefined, 0]),
      rend_k: z.wahl([4, 4.5, '5', '', undefined]), vkp: z.wahl([undefined, undefined, '', z.zahl(20000, 600000, 0), '350000']),
    };
  };
  const faelle = [];
  for (let n = 0; n < 80; n++) {
    const einheiten = Array.from({ length: z.wahl([0, 1, 3, 6]) }, (_, i) => einheit(i));
    const deal = { id: 'd1', objId: 'o1', einheiten, kalk: z.wahl([{}, { kaufpreis: z.zahl(100000, 3000000, -3) }, { kaufpreis: '900000' }]) };
    const obj = z.ja(0.9) ? { id: 'o1', strasse: z.wahl(['Lindenstr.', '', undefined]), hausnr: z.wahl(['4', undefined]), stadt: z.wahl(['Ulm', '', undefined]), wohnflaeche: z.wahl([0, 480, '310', undefined]), angebotspreis: z.wahl([0, 1200000, '750000', undefined]), stellplaetze: z.wahl([undefined, 3, '2']) } : null;
    const kkD = z.ja(0.7) ? std : { ...std, notarPct: 2, grundsteuerPct: 6.5, default_fk_anteil_kp: 100, betrachtungsdauerJahre: 15 };
    const hinweise = z.ja(0.5) ? [] : ['KfW-Förderung', 'Mietsteigerung'];
    const scope = z.wahl(['global', 'aufteiler'] as const);
    const einheitId = scope === 'aufteiler' ? z.wahl([...einheiten.map((e) => e.id), 'fehlt', undefined]) : undefined;
    const kk = { wert: null as any };
    const alt = baue([deal], obj ? [obj] : [], kkD, hinweise, kk);
    const vorbelegt = alt.defaultsFromDeal('d1', scope, einheitId);

    // Bearbeitungsschritte auf der vorbelegten Kalkulation
    const schritte: { aktion: string; wert?: string; ergebnis: unknown }[] = [];
    kk.wert = structuredClone(vorbelegt);
    kk.wert.inputs.sanierungsposten = [{ label: 'Dach', amount: z.zahl(0, 90000, 0), modus: z.wahl(['sofort', 'aktivieren', 'weg_ruecklage']) }];
    const aktionen: [string, string?][] = [
      ['feld:kaufpreisWohnung', z.wahl(['450.000', '1.234,5', '99'])], ['feld:kaufpreisStellplatz', z.wahl(['25.000', '0', ''])],
      ['feld:notarPct', z.wahl(['1,5', '2'])], ['feld:grundsteuerPct__eur', z.wahl(['30.000', '0'])], ['feld:betrachtungsdauerJahre', z.wahl(['10,5', '60', '0', '12'])],
      ['feld:mietflaeche', z.wahl(['85,5', '-3'])], ['feld:nettokaltmieteMonat', '1.250'],
      ['ek:zero'], ['ek:nk'], ['ek:p10'], ['ek:wert', z.wahl(['50.000', '0', '9999999'])],
      ['tranche:kp'], ['tranche:kp_san'], ['tranche:kp_nk'], ['tranche:kp90'],
    ];
    for (const [aktion, wert] of aktionen) {
      if (aktion.startsWith('feld:')) alt.kkalkUpdateField(aktion.slice(5), wert!);
      else if (aktion === 'ek:wert') alt.applyEK(parseFloat(wert!.replace(/\./g, '').replace(',', '.')));
      else if (aktion.startsWith('ek:')) alt.kkalkSetEKQuick(aktion.slice(3));
      else alt.kkalkSetTranche1Quick(aktion.slice(8));
      schritte.push({ aktion, wert, ergebnis: structuredClone(kk.wert) });
    }
    faelle.push({ name: `zufall-${n}`, eingabe: { deal, obj, kkD, hinweise, scope, einheitId }, vorbelegt, schritte });
  }
  return faelle;
}

// ═════════════ Exposé-Import: Dubletten, Telefon, Vorbereitung ═════════════
function exposeFaelle() {
  const dedup = lies('src/lib/dedup.ts');
  const utils2 = lies('src/lib/utils.ts');
  const wizard = lies('src/modules/expose-wizard/expose-wizard.ts');
  const PHONE = /const PHONE_ALLOWED = (.*);/.exec(utils2)![1]!;
  const quelle = ts.transpile(
    [
      `const PHONE_ALLOWED = ${PHONE};`,
      ...['export function normalizeAddr(', 'function normalizeHausnr(', 'export function levenshtein(', 'export function nameSimilar(', 'export function addressSimilar(', 'export function findDuplicateObj(', 'export function findDuplicateMakler(', 'export function findDuplicateDeal('].map((k) => funktion(dedup, k)),
      ...['export function validatePhone(', 'export function validateEmail(', 'export function normalizePhone(', 'export function isMobilePhone('].map((k) => funktion(utils2, k)),
    ].join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  const start = wizard.indexOf('    ewObjData   = { ...(ewExtracted.objekt   || {}) };');
  const ende = wizard.indexOf('    next.disabled = false;', start);
  if (start < 0 || ende < 0) throw new Error('Vorbereitung in ewDoAnalyse nicht gefunden');
  const vorbereitung = ts.transpile(`function vorbereiten(ewExtracted) { let ewObjData, ewMkData, ewDealData;\n${wizard.slice(start, ende)}\nreturn { ewObjData, ewMkData, ewDealData }; }`, { target: ts.ScriptTarget.ES2022 });
  const alt = (db: { objs: unknown[]; makler: unknown[]; deals: unknown[] }) =>
    new Function('DB', `${quelle}\n${vorbereitung.replace(/normalizePhone/g, 'normalizePhone')}\nreturn { findDuplicateObj, findDuplicateMakler, findDuplicateDeal, validatePhone, validateEmail, normalizePhone, isMobilePhone, vorbereiten };`)(
      { objs: () => db.objs, makler: () => db.makler, deals: () => db.deals },
    );

  const z = zufall(4711);
  const strassen = ['Hauptstraße', 'Hauptstr.', 'Hauptstrasse', 'Haupt Str', 'Hauptstraßen', 'Bahnhofstraße', 'Bahnhofsweg', 'Am Markt'];
  const staedte = ['Ulm', 'ulm', 'Neu-Ulm', '', undefined];
  const telefone = ['+49 171 1234567', '0171-1234567', '(0711) 123456', '0049 711 123456', '0711 123456', '12345', 'abc', '', undefined, '01512 99 88 77'];
  const faelle = [];
  for (let n = 0; n < 150; n++) {
    const objs = Array.from({ length: z.wahl([0, 1, 4]) }, (_, i) => ({ id: `o${i}`, strasse: z.wahl(strassen), hausnr: z.wahl(['1', '1a', '1 A', '2', '', undefined]), stadt: z.wahl(staedte) }));
    const makler = Array.from({ length: z.wahl([0, 2, 5]) }, (_, i) => ({ id: `m${i}`, name: z.wahl(['Anna Beispiel', 'Anna Beispil', 'Bernd Muster', 'B. Muster', '', undefined]), email: z.wahl(['anna@x.de', 'ANNA@x.de', 'b@y.de', '', undefined]), tel: z.wahl(telefone) }));
    const deals = objs.flatMap((o, i) => (makler[i] ? [{ id: `d${i}`, objId: o.id, maklerId: (makler[i] as { id: string }).id }] : []));
    const f = alt({ objs, makler, deals });
    const suche = { strasse: z.wahl([...strassen, '', undefined]), hausnr: z.wahl(['1', '1A', '2', '']), stadt: z.wahl(staedte), plz: '89073' };
    const mkSuche = { name: z.wahl(['Anna Beispiel', 'anna beispiel ', 'Bernd Musterr', '', undefined]), email: z.wahl(['anna@x.de', 'b@Y.de', '', undefined]), tel: z.wahl(telefone) };
    const absender = z.wahl(['b@y.de', undefined, 'anna@x.de']);
    const extrahiert = {
      objekt: {
        wohnflaeche: z.wahl([undefined, 300, 480.5, '400']), istmiete: z.wahl([undefined, 0, 3200, '2500']), notizen: z.wahl(['', 'Denkmal', undefined]),
        einheiten: z.ja(0.8) ? Array.from({ length: z.wahl([1, 3, 6]) }, () => ({ typ: z.wahl(['Wohnung', 'Wohnung', 'Stellplatz', 'Gewerbe']), lage: 'EG', flaeche: z.wahl([undefined, 0, 75, 62.3]), kaltmiete: z.wahl([undefined, 0, 700]) })) : undefined,
      },
      makler: { mobiltel: z.wahl([undefined, '0171 1234567', '']), festnetztel: z.wahl([undefined, '0049 711  (123) 456']), tel: z.wahl([undefined, '07 11 12']), name: 'X' },
      kalkulation: z.wahl([undefined, { kaufpreis: 900000, rp: 12 }]),
    };
    faelle.push({
      name: `zufall-${n}`,
      eingabe: { objs, makler, deals, suche, mkSuche, absender, extrahiert, dealSuche: [z.wahl(['o0', 'o1', '']), z.wahl(['m0', 'm1', ''])] },
      ergebnis: {
        objekt: f.findDuplicateObj(suche),
        makler: f.findDuplicateMakler(mkSuche, absender),
        deal: f.findDuplicateDeal(...([] as string[]).concat(faelle.length % 2 ? ['o0', 'm0'] : ['o1', ''])),
        telefon: telefone.map((t) => ({ t, pruef: f.validatePhone(t), norm: f.normalizePhone(t), mobil: f.isMobilePhone(t) })),
        email: ['a@b.de', 'a@b', 'a b@c.de', '', undefined].map((e) => f.validateEmail(e)),
        vorbereitet: f.vorbereiten(structuredClone(extrahiert)),
      },
    });
  }
  return faelle;
}

// ═════════════ Bank-Präsentation: Vorbelegung, Konsistenz, Standards ═════════════
function finanzpraesFaelle() {
  const modul = lies('src/modules/finanzpraes/finanzpraes.ts');
  const tabelle = lies('src/modules/finanzpraes/finanzpraes-tabelle.ts');
  const quelle = ts.transpile(
    [
      funktion(tabelle, 'export function formatiereFlaeche('),
      ...['function getCurrentDealAndObjekt(', 'function computeDeckblattTitelPrefill(', 'function computeDeckblattUntertitelPrefill(',
        'function createEmptySlide(', 'export function finanzpraesPrefillDeckblatt(', 'export function finanzpraesPrefillObjekt(',
        'export function computeDealKalkSummary(', 'export function finanzpraesPrefillProjektkalk(', 'export function finanzpraesPrefillVerkaufspreise(',
        'function getMietenSpalten(', 'export function finanzpraesApplyMietenSpalten(', 'export function finanzpraesPrefillFinanzierung(',
        'export function finanzpraesCheckConsistency(', 'function expandWithDefaults(', 'export function finanzpraesSlideMove(']
        .map((k) => (k.includes('computeDealKalkSummary') ? funktion(modul, k, '} | null {') : funktion(modul, k))),
    ].join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  const defaults = {
    geschaeftsmodell: { zielgruppe: 'ZG', angebot: 'Angebot', kundengewinnung: 'KG', vorteile: 'V', vorteileIvt: 'VI' },
    organigramm: { bild: 'standardbild:organigramm', beschreibung: 'Konzern' },
    abschluss: { untertitel: 'Gerry & Sven', bild: 'standardbild:abschluss' },
  };
  const baue = (welt: { deals: unknown[]; objekte: unknown[]; praes: any; confirm: boolean; spalten: string[] }) =>
    new Function(
      'DB', 'getFinanzPraes', 'saveFinanzPraes', 'refreshTab', 'showToast', 'confirm', 'document', 'uid', 'getFinanzpraesDefaults', 'STANDARD_ORDER',
      `let _currentDealId = 'd1'; let _currentPraesId = 'p1'; let _selectedSlideId = null;\n${quelle}\nreturn { createEmptySlide, finanzpraesPrefillDeckblatt, finanzpraesPrefillObjekt, computeDealKalkSummary, finanzpraesPrefillProjektkalk, finanzpraesPrefillVerkaufspreise, getMietenSpalten, finanzpraesApplyMietenSpalten, finanzpraesPrefillFinanzierung, finanzpraesCheckConsistency, expandWithDefaults, finanzpraesSlideMove };`,
    )(
      { get: (k: string) => (k === 'immo-deals' ? welt.deals : k === 'immo-objects' ? welt.objekte : null) },
      () => welt.praes, (p: unknown) => { welt.praes = structuredClone(p); }, () => {}, () => {}, () => welt.confirm,
      { querySelectorAll: () => ['nr', 'typ', 'lage', 'zimmer', 'flaeche', 'mi_ist', 'mi_neu', 'mi_qm', 'jnkm', 'stk'].map((k) => ({ dataset: { spalte: k }, checked: welt.spalten.includes(k) })), getElementById: () => null },
      () => 'neu', () => structuredClone(defaults), [],
    );

  const z = zufall(9090);
  const zahlOderText = (n: number) => (z.ja(0.25) ? String(n) : n);
  const faelle = [];
  for (let n = 0; n < 120; n++) {
    const einheiten = Array.from({ length: z.wahl([0, 1, 3, 7]) }, (_, i) => {
      const typ = z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz']);
      return {
        id: `e${i}`, typ, lage: z.wahl([`EG ${i}`, '', undefined]), zimmer: z.wahl([undefined, 2, '3', 4.5]),
        fl: typ === 'Stellplatz' ? undefined : z.wahl([z.zahl(20, 140, 1), zahlOderText(z.zahl(20, 140, 0)), undefined, 45.5]),
        mi_ist: z.wahl([z.zahl(0, 1800, 0), undefined, '640']), mi_neu: z.wahl([undefined, z.zahl(300, 2000, 0)]), mi_neu_manual: z.ja(0.3),
        rend_k: z.wahl([4, 4.5, '5', undefined, 0]), vkp: z.wahl([undefined, '', z.zahl(20000, 600000, 0), '350000']), stk: z.wahl([undefined, 2, '3']),
      };
    });
    const sanierung = Array.from({ length: z.wahl([0, 2, 9]) }, (_, i) => ({ id: `s${i}`, desc: z.wahl([`Posten ${i}`, '', 'Dach <neu> & Gauben']), amt: z.wahl([z.zahl(0, 90000, 0), 0, '12000']), scope: z.wahl([undefined, 'both', 'auf', 'glo']) }));
    const kalk = z.ja(0.9) ? {
      kaufpreis: z.wahl([0, z.zahl(200000, 4000000, -3), '950000']), notar: z.wahl([1.5, 2, undefined]), gest: z.wahl([3.5, 5, 6.5]), makler: z.wahl([0, 3.57]),
      fk_p: z.wahl([0, 80, 85, 100]), ek_p: z.wahl([undefined, 15, 20, 0, -1]), euribor: z.wahl([0, 2.1, 3.4]), margeB: z.wahl([0, 2, 2.5]),
      halt: z.wahl([0, 12, 18, 24]), bank_abgeb: z.wahl([0, 1]), vprov: z.wahl([0, 3]), aufk: z.wahl([0, 25000]), glo_m: z.wahl([0, 15, 20]),
      rp_pct: z.wahl([undefined, 0, 10, 15]), rp_fix: z.wahl([undefined, 0, 30000]),
    } : undefined;
    const objekt = z.ja(0.85) ? {
      id: 'o1', strasse: z.wahl(['Lindenstr.', '', undefined]), hausnr: z.wahl(['4', undefined]), stadt: z.wahl(['Ulm', '', undefined]),
      baujahr: z.wahl([undefined, 1965, '1978']), einheitenAnz: z.wahl([undefined, 1, 6, '9']), wohnflaeche: z.wahl([undefined, 480, '310']),
      grundstueck: z.wahl([undefined, 900]), objektTyp: z.wahl([undefined, undefined, 'Wohn- und Geschäftshaus']),
    } : null;
    const deal = { id: 'd1', objId: objekt ? 'o1' : 'fehlt', kalk, einheiten, sanierung, ...(z.ja(0.2) ? { stadt: 'Kopiestadt', adresse: 'Kopieweg', hausnr: '9' } : {}) };
    const welt = { deals: [deal], objekte: objekt ? [objekt] : [], praes: null as any, confirm: z.ja(), spalten: z.wahl([['nr', 'typ', 'lage', 'flaeche', 'mi_ist'], ['typ', 'mi_qm', 'jnkm', 'mi_neu', 'stk', 'zimmer'], []]) };
    const alt = baue(welt);
    const folien = ['deckblatt', 'objektbeschreibung', 'projektkalkulation', 'verkaufspreise', 'mietenaufstellung', 'finanzierungsstruktur', 'organigramm', 'abschluss', 'geschaeftsmodell']
      .map((typ, i) => ({ ...alt.createEmptySlide(typ), id: `f${i}` }));
    if (z.ja(0.3)) folien[5].data.kreditnehmer = 'Eigene GmbH';
    welt.praes = { id: 'p1', dealId: 'd1', bankName: 'Testbank', slides: folien, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
    const angelegt = structuredClone(welt.praes);
    const scope = z.wahl(['aufteiler', 'global'] as const);
    const ergebnisse: Record<string, unknown> = {
      summaryAufteiler: alt.computeDealKalkSummary(deal, 'aufteiler'),
      summaryGlobal: alt.computeDealKalkSummary(deal, 'global'),
    };
    alt.finanzpraesPrefillDeckblatt('f0');
    alt.finanzpraesPrefillObjekt('f1');
    if (z.ja(0.7)) alt.finanzpraesPrefillProjektkalk('f2', scope);
    alt.finanzpraesPrefillVerkaufspreise('f3');
    alt.finanzpraesApplyMietenSpalten('f4');
    const nachVorbelegung = structuredClone(welt.praes);
    alt.finanzpraesPrefillFinanzierung('f5');
    const nachFinanzierung = structuredClone(welt.praes);
    if (z.ja(0.3)) welt.praes.slides[5].data.gik = '1.000 €';
    if (z.ja(0.2)) welt.praes.slides[5].data._scope = scope === 'aufteiler' ? 'global' : 'aufteiler';
    if (z.ja(0.2)) welt.praes.slides[3].data.tableRows = [['Summe', z.wahl(['1.234.567 €', '0 €'])]];
    ergebnisse.konsistenz = alt.finanzpraesCheckConsistency();
    ergebnisse.mitStandards = alt.expandWithDefaults(welt.praes);
    const verschoben = structuredClone(welt.praes);
    alt.finanzpraesSlideMove(z.wahl(['f0', 'f3', 'f8', 'fehlt']), z.wahl([-1, 1, 3]));
    faelle.push({
      name: `zufall-${n}`, eingabe: { deal, objekt, scope, confirm: welt.confirm, spalten: welt.spalten, defaults }, angelegt, ergebnisse,
      nachVorbelegung, nachFinanzierung, vorKonsistenz: verschoben, verschiebung: welt.praes.slides.map((s: { id: string }) => s.id),
    });
  }
  return faelle;
}

// ═════════════ Dokumente: Bank-Präsentation (HTML, PowerPoint) ═════════════
function zufallsPraesentation(z: ReturnType<typeof zufall>, n: number) {
  const bild = () => z.wahl(['photo:obj1/f1', 'photo:obj1/f2', 'data:image/png;base64,iVBORw0KGgo=', '', `photo:obj${n}/x${n}`]);
  const text = () => z.wahl(['', 'Kurzer Text', 'Zeile eins\nZeile zwei\n\n  Zeile drei  ', 'Sonderzeichen <b>&</b> "Zitat" \'x\'', 'Ä'.repeat(300)]);
  const tabelle = () => {
    const anzahl = z.wahl([0, 3, 22, 23, 30, 47]);
    const rows = Array.from({ length: anzahl }, (_, i) => (i % 9 === 0 ? [z.wahl(['PROJEKTKOSTEN', 'EXIT AUFTEILER', '📊 Übersicht']), ''] : [`Position ${i}`, `${(i * 1234).toLocaleString('de-DE')} €`]));
    return anzahl ? { tableHeaders: z.wahl([['Position', 'Betrag'], ['Nr.', 'Typ', 'Lage']]), tableRows: rows, tableTitle: z.wahl(['', 'Aufteiler-Kalkulation']) } : {};
  };
  const daten: Record<string, () => Record<string, unknown>> = {
    deckblatt: () => ({ titel: z.wahl([undefined, 'ANKAUF Mehrfamilienhaus']), untertitel: text(), bilder: Array.from({ length: z.wahl([0, 1, 6, 8]) }, bild) }),
    objektbeschreibung: () => ({ adresse: text(), baujahr: '1978', einheiten: z.wahl(['', '9']), stellplaetze: '3', wohnflaeche: '480', grundstueck: '', gik: '1.200.000 €', kaufpreisPerM2: '2.500 €/m²', jnkm: z.wahl(['', '48.000 €']), renditeIst: '4,00 %', beschreibung: text(), bildPath: bild() }),
    lagebeschreibung: () => ({ standortBullets: text(), anbindungBullets: text(), bildPath: bild() }),
    projektbeschreibung: () => ({ aktuellerStand: text(), geplanteMassnahmen: text(), vertrieb: text() }),
    geschaeftsmodell: () => ({ zielgruppe: text(), angebot: text(), kundengewinnung: text(), vorteile: text(), vorteileIvt: z.wahl([undefined, text()]) }),
    projektkalkulation: () => ({ ...tabelle(), bildPath: bild(), beschreibung: text() }),
    verkaufspreise: () => ({ ...tabelle(), bildPath: bild(), beschreibung: text() }),
    mietenaufstellung: () => ({ ...tabelle(), bildPath: bild() }),
    finanzierungsstruktur: () => ({ gik: '1.587.000 €', em: '238.050 €', ekAnteil: '15%', fm: z.wahl(['', '1.348.950 €']), fkAnteil: '85%', zinsbindung: text(), verzinsung: '5,5%', tilgung: '', bereitstellung: text(), strukturierungsentgelt: '1,5%', kreditlaufzeit: '18 Monate', kreditnehmer: 'IVT Wohnen GmbH', verwendungszweck: text(), buergschaft: '', grundschuldeintragung: text(), grundschuldAufteilung: '', ausschuettung: text(), zusatzBullets: text() }),
    grundrisse: () => { const b = Array.from({ length: z.wahl([0, 1, 3]) }, bild); return { bilder: b, captions: b.map(() => z.wahl(['', 'EG', '1. OG'])) }; },
    organigramm: () => ({ bild: bild(), beschreibung: text() }),
    abschluss: () => ({ bild: bild(), untertitel: text() }),
    impressionen: () => { const b = Array.from({ length: z.wahl([0, 4, 9]) }, bild); return { bilder: b, captions: b.map(() => z.wahl(['', 'Fassade'])) }; },
    referenz: () => ({ projektName: z.wahl(['', 'Aldinger Str. 86']), zeilen: z.wahl(['', 'Ankauf | 01.02.2025 | 1,2 Mio\nVerkauf|03.2026|\n  \nnur Phase']) }),
    kundenliste: () => ({ einzelverkauf: text(), globalansprachen: text() }),
    marktvergleich: () => ({ titel1: z.wahl(['', 'Sprengnetter']), bild1: bild(), text1: text(), titel2: 'Portale', bild2: bild(), text2: text() }),
  };
  const typen = Object.keys(daten);
  const slides = Array.from({ length: z.wahl([0, 1, 5, 16, 20]) }, (_, i) => {
    const typ = i < 16 && z.ja(0.7) ? typen[i]! : z.wahl(typen);
    return { id: `s${i}`, typ, visible: z.ja(0.85), data: daten[typ]!() };
  });
  if (z.ja(0.1)) slides.push({ id: 'unbekannt', typ: 'gibtesnicht', visible: true, data: {} });
  return { id: `p${n}`, dealId: 'd1', bankName: z.wahl(['', 'Kreissparkasse Ulm', 'Bank <&> "AG"']), slides, createdAt: '2026-09-01', updatedAt: '2026-09-02' };
}

/** Fotos für die PowerPoint-Fälle: fest aus dem Verweis abgeleitet; `x…`-Fotos fehlen (leere Stelle). */
const testFoto = async (objId: string, fotoId: string) => {
  if (fotoId.startsWith('x')) return null;
  const kopf = fotoId === 'f2' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0xff, 0xd8, 0xff, 0xe0];
  return Buffer.from([...kopf, ...Buffer.from(`${objId}/${fotoId}`)]);
};

/** Inhalt einer PPTX-Datei als Hash je Eintrag; docProps/core.xml trägt den Erstellzeitpunkt und bleibt außen vor. */
async function pptxInhalt(bytes: Uint8Array, JSZip: { loadAsync(b: Uint8Array): Promise<{ files: Record<string, { dir: boolean; async(t: 'uint8array'): Promise<Uint8Array> }> }> }) {
  const zip = await JSZip.loadAsync(bytes);
  const aus: Record<string, string> = {};
  for (const name of Object.keys(zip.files).sort()) {
    const eintrag = zip.files[name]!;
    if (eintrag.dir || name === 'docProps/core.xml') continue;
    aus[name] = createHash('sha256').update(await eintrag.async('uint8array')).digest('hex');
  }
  return aus;
}

async function praesentationDokumentFaelle() {
  const vorlage = await import(join(ALT, 'src/lib/finanzpraesTemplate.ts'));
  const { renderFinanzPraesPptx } = await import(join(ALT, 'server/finanzpraes-pptx.ts'));
  const JSZip = createRequire(join(ALT, 'package.json'))('jszip');
  const hash = (x: string) => createHash('sha256').update(x).digest('hex');
  const z = zufall(3131);
  const faelle = [];
  for (let n = 0; n < 50; n++) {
    const praes = zufallsPraesentation(z, n);
    faelle.push({
      name: `zufall-${n}`,
      praes,
      html: {
        voll: hash(vorlage.finanzpraesFullHtml(praes)),
        vorschau: hash(vorlage.finanzpraesPreviewHtml(praes)),
        folien: praes.slides.map((s) => hash(vorlage.renderSlideLivePreview(praes, s))),
        seiten: praes.slides.map((s) => vorlage.seitenAnzahlDerSlide(s)),
      },
      pptx: await pptxInhalt(await renderFinanzPraesPptx(praes, { holeFoto: testFoto }), JSZip),
    });
  }
  return faelle;
}

// ═════════════ Vertriebslisten: Anlegen aus Deal, Rechenspalten, Zellwerte ═════════════
function vertriebslistenFaelle() {
  const lib = lies('src/lib/vertriebsliste.ts');
  const modul = lies('src/modules/vertriebslisten/vertriebslisten.ts');
  const konst = (name: string) => { const i = lib.indexOf(`export const ${name}`); return lib.slice(i, lib.indexOf('];', i) + 2).replace(/^export /, ''); };
  const cs = lib.indexOf('export const COMPUTED_FIELDS'); const computed = lib.slice(cs, lib.indexOf(']);', cs) + 3).replace(/^export /, '');
  const quelle = ts.transpile(
    [computed, konst('DEFAULT_COLUMNS'),
      funktion(lib, 'export function createVertriebslisteFromDeal('), funktion(lib, 'export function computeRowValues('), funktion(lib, 'export function totalWohnflaeche('),
      funktion(modul, 'function formatComputed('), funktion(modul, 'export function vlUpdateCell(')].join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  let zaehler = 0;
  const welt = { vl: null as any };
  const alt = new Function('getDefaultColumns', 'uid', 'todayISO', 'getVertriebsliste', 'saveVertriebsliste', 'vlRefreshPanelBody',
    `${quelle}\nreturn { DEFAULT_COLUMNS, createVertriebslisteFromDeal, computeRowValues, totalWohnflaeche, formatComputed, vlUpdateCell };`)(
    () => welt.vl?.columnsFuerNeu ?? null, () => `id${++zaehler}`, () => '2026-09-17', () => welt.vl, (v: unknown) => { welt.vl = structuredClone(v); }, () => {},
  );
  const z = zufall(5151);
  const faelle = [];
  for (let n = 0; n < 80; n++) {
    zaehler = 0;
    const einheiten = Array.from({ length: z.wahl([0, 1, 4, 9]) }, (_, i) => {
      const typ = z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz']);
      return {
        id: `e${i}`, typ, lage: z.wahl([`EG ${i}`, '', undefined]), zimmer: z.wahl([undefined, 2, '3', 0]),
        fl: z.wahl([z.zahl(20, 140, 1), '85', '', undefined]), mi_ist: z.wahl([z.zahl(0, 1800, 0), '', undefined, '640']),
        mi_neu: z.wahl([undefined, z.zahl(300, 2000, 0), 0, '']), vkp: z.wahl([undefined, '', z.zahl(15000, 600000, 0), '350000']),
      };
    });
    const deal = { id: 'd1', status: 'Angekauft', einheiten };
    welt.vl = null;
    const altAlleSpalten = alt.DEFAULT_COLUMNS.map((c: object) => ({ ...c }));
    const vl = new Function('getDefaultColumns', 'uid', 'todayISO', `${ts.transpile(funktion(lib, 'export function createVertriebslisteFromDeal('), { target: ts.ScriptTarget.ES2022 })}\nreturn createVertriebslisteFromDeal;`)(
      () => altAlleSpalten.map((c: object) => ({ ...c })), () => `id${++zaehler}`, () => '2026-09-17')(deal);
    // Zellen bearbeiten wie in der Tabelle
    welt.vl = structuredClone(vl);
    const schritte: { zeile: number; spalte: string; wert: unknown; ergebnis: unknown }[] = [];
    for (let k = 0; k < 6 && vl.rows.length; k++) {
      const zeile = z.wahl(vl.rows.map((_: unknown, i: number) => i));
      const spalte = z.wahl(['wohnflaeche', 'kaltmiete_ist', 'kaltmiete_soll', 'grundpreis_whg', 'grundpreis_stp', 'verkaufspreis', 'sanierung', 'miete_qm', 'lage', 'vertriebsstand', 'ampel', 'notartermin', 'zi']);
      const wert = z.wahl(['85.5', '1.234,56', '850.000', 'k. A.', '', 12, 'gruen', '2026-10-01', '0,75']);
      alt.vlUpdateCell(vl.id, zeile, spalte, wert);
      schritte.push({ zeile, spalte, wert, ergebnis: structuredClone(welt.vl.rows[zeile].data) });
    }
    const gik = z.wahl([0, z.zahl(200000, 3000000, 0)]);
    const prov = z.wahl([7.14, 0, 3.57]);
    const totalWf = alt.totalWohnflaeche(welt.vl);
    const berechnet = welt.vl.rows.map((r: object) => {
      const w = alt.computeRowValues(r, gik, totalWf, prov);
      return { werte: w, anzeige: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, alt.formatComputed(k === 'rendite_ist' || k === 'rendite_soll' ? 'percent' : 'euro', v)])) };
    });
    faelle.push({ name: `zufall-${n}`, deal, angelegt: vl, schritte, bearbeitet: welt.vl, gik, prov, totalWf, berechnet });
  }
  return { faelle, defaultColumns: alt.DEFAULT_COLUMNS };
}

// ═════════════ Projektmanagement ═════════════
/** Vergleichsform eines Projekts (gleich in test/projekte.golden.test.ts): leer/undefined → null, `done` entfällt. */
const PM_EINHEIT_FELDER = ['id', 'typ', 'lage', 'zimmer', 'fl', 'stk', 'teNr', 'kaltmiete', 'kmMoeglich', 'grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP', 'vstatus',
  'vertriebsstand', 'vermietet', 'mieterName', 'pip', 'pipStrategie', 'pipTodosText', 'mieterTodosText', 'reservDatum', 'notarDatum', 'kaeufer', 'vtKommentar'];
const pmLeer = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
function pmNormal(p: any) {
  return {
    ...Object.fromEntries(['id', 'dealId', 'adresse', 'stadt', 'datum', 'zielVKP', 'globalVstatus', 'globalIstKP', 'globalKommentar', 'globalKaeufer', 'globalNotarDatum', 'globalReservDatum'].map((k) => [k, pmLeer(p[k])])),
    todos: p.todos.map((t: any) => [t.id, t.cat, t.text, t.status, pmLeer(t.kommentar), pmLeer(t.verantwortlich), pmLeer(t.faellig)]),
    einheiten: p.einheiten.map((e: any) => [...PM_EINHEIT_FELDER.map((k) => pmLeer(e[k])), (e.mieterHistorie ?? []).map((h: any) => [h.id, h.datum, h.inhalt, h.ergebnis])]),
    gebPIP: p.gebPIP.map((m: any) => [pmLeer(m.text), pmLeer(m.status), pmLeer(m.verantw)]),
  };
}
function projekteFaelle() {
  const pm = lies('src/modules/projektmanagement/pm.ts');
  const ber = lies('src/modules/projektmanagement/pm-berechnung.ts').replace(/^import .*$/m, '');
  const block = (start: string, ende: string) => { const i = pm.indexOf(start); return pm.slice(i, pm.indexOf(ende, i) + ende.length).replace(/^export /, ''); };
  const quelle = ts.transpile([
    ber.replace(/export /g, ''), funktion(utils, 'export function parseNum('), funktion(utils, 'export function esc('),
    block('export const PM_TODO_TEMPLATE', '\n]\n'), block('export const TODO_STATUS', '\n};'),
    block('const PM_SUMMEN_SPALTEN', ';'), block('const PM_GLOBAL_ZAHLFELDER', ';'),
    ...['pmCreateProject', 'pmCardHTML', 'pmEinhSummeText', 'pmRenderEinh', 'pmEinhRowHTML', 'pmGlobalFieldHTML', 'pmGebPIPRowHTML', 'pmDeleteTodo', 'pmAddTodoBelowRow',
      'pmAddTodoInCat', 'pmAddTodoCat', 'pmRenameCat', 'pmSetTodoStatus', 'pmSaveTodoField', 'pmSaveVT', 'pmSaveVTNum', 'pmSetPIP', 'pmSaveGlobal', 'pmSaveHistModal', 'pmRmHistModal',
      'pmGebPIPUpd', 'pmAddGebPIP', 'pmRmGebPIP'].map((n) => funktion(pm, n === 'pmEinhSummeText' ? `function ${n}(` : `export function ${n}(`)),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { projs: [] as any[], deals: [] as any[], felder: {} as Record<string, string>, prompt: '' as string | null, hinweise: [] as string[] };
  let zaehler = 0;
  const document = {
    getElementById: (id: string) => (id in welt.felder ? { value: welt.felder[id] } : null),
    querySelector: () => null, querySelectorAll: () => [],
  };
  const alt = new Function('DB', 'uid', 'todayISO', 'showToast', 'closePanel', 'getKalkDefaults', 'document', 'prompt', 'pmProjects', 'pmActiveProjects', 'pmSave', 'pmRender', 'pmRenderTodo',
    'pmRefreshTodoStats', 'pmRefreshFinbar', 'pmRefreshEinhSummen', 'pmOpenMieterHist', 'pmTodoRowHTML',
    `${quelle}\nreturn { PM_TODO_TEMPLATE, TODO_STATUS, pmCreateProject, pmCardHTML, pmRenderEinh, pmDeleteTodo, pmAddTodoBelowRow, pmAddTodoInCat, pmAddTodoCat, pmRenameCat, pmSetTodoStatus, pmSaveTodoField, pmSaveVT, pmSaveVTNum, pmSetPIP, pmSaveGlobal, pmSaveHistModal, pmRmHistModal, pmGebPIPUpd, pmAddGebPIP, pmRmGebPIP, pmTodoPasstZuFilter, pmTodoStatistik };`)(
    { deals: () => welt.deals }, () => `id${++zaehler}`, () => '2026-09-17', (t: string) => welt.hinweise.push(t), () => {}, () => ({ ...KALK_STANDARD }), document, () => welt.prompt,
    () => welt.projs, () => welt.projs.filter((p) => !p?._deleted), (p: any[]) => { welt.projs = structuredClone(p); }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => '',
  );
  // Anzeige aus dem HTML: Element-IDs der Finanzleiste/Summen und die Kennzahlen der Karte
  const ids = (html: string) => Object.fromEntries([...html.matchAll(/id="(pm(?:fin|sum)-[\w-]+)"[^>]*?(?:value="([^"]*)"[^>]*>|>([^<]*)<)/g)].map((m) => [m[1], (m[2] ?? m[3] ?? '').trim()]));
  const karte = (html: string) => ({
    kpi: [...html.matchAll(/class="pm-kpi-val"[^>]*>([^<]*)</g)].map((m) => m[1]),
    unter: [...html.matchAll(/<div style="font-size:10px;color:var\(--tx3\)">([^<]*)</g)].map((m) => m[1]),
    sub: /class="pm-card-sub">([^<]*)</.exec(html)?.[1],
    ampel: [...html.matchAll(/<\/span>(\d+ (?:grün|gelb|rot))<\/span>/g)].map((m) => m[1]),
    ohnePip: html.includes('PIP noch nicht bewertet'),
  });
  const fussZeile = (html: string) => { const f = /<tfoot>([\s\S]*?)<\/tfoot>/.exec(html)?.[1] ?? ''; return [...f.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]!.trim()).filter(Boolean); };

  const z = zufall(4711);
  const faelle = [];
  for (let n = 0; n < 60; n++) {
    zaehler = 0;
    const einheiten = Array.from({ length: z.wahl([0, 1, 3, 7]) }, (_, i) => ({
      id: `e${i}`, typ: z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz', undefined]), lage: z.wahl([`OG ${i}`, '', undefined]), zimmer: z.wahl([undefined, 2, 3.5, 0]),
      fl: z.wahl([z.zahl(20, 140, 1), '', undefined]), fl_ist: z.wahl([undefined, undefined, z.zahl(20, 140, 0)]),
      mi_ist: z.wahl([z.zahl(0, 1800, 0), undefined, 640]), mi_neu: z.wahl([undefined, z.zahl(300, 2000, 0), '']), mi_neu_manual: z.ja(0.4),
      rend_k: z.wahl([undefined, 4.5, '3,8', 5]), vkp: z.wahl([undefined, '', z.zahl(15000, 600000, 0), '275.000']),
    }));
    const kalk = z.ja(0.15) ? undefined : Object.fromEntries(Object.entries({
      kaufpreis: z.wahl([0, z.zahl(300000, 4000000, -3), '1.250.000']), notar: z.wahl([undefined, 1.8]), gest: z.wahl([undefined, 6.5]), makler: z.wahl([undefined, 0, 3.57]),
      fk_p: z.wahl([undefined, 70, 100]), ek_p: z.wahl([undefined, 30, 0]), euribor: z.wahl([undefined, 3.1]), margeB: z.wahl([undefined, 1.9]), ek_r: z.wahl([undefined, 10]),
      halt: z.wahl([undefined, 6, 24]), bank_abgeb: z.wahl([undefined, 1]), glo_m: z.wahl([undefined, 12, 20]), rp_pct: z.wahl([undefined, 0, 15]), rp_fix: z.wahl([undefined, 0, 25000]),
    }).filter(([, v]) => v !== undefined));
    const sanierung = Array.from({ length: z.wahl([0, 1, 3]) }, () => ({ amt: z.wahl([z.zahl(1000, 200000, -2), '12.500']), scope: z.wahl([undefined, 'both', 'glo', 'auf']) }));
    const mitDeal = z.ja(0.85);
    const deal = { id: 'd1', status: 'Angekauft', adresse: 'Teststr. 1', stadt: 'Stuttgart', einheiten, sanierung, ...(kalk ? { kalk } : {}) };
    welt.deals = [deal];
    welt.projs = [];
    const eingabe = { adresse: z.wahl(['  Musterweg 3 ', 'Teststr. 1']), stadt: z.wahl(['Stuttgart', ' Esslingen ']), datum: '2026-09-01' };
    welt.felder = { 'pm-new-deal': mitDeal ? 'd1' : '', 'pm-new-addr': eingabe.adresse, 'pm-new-stadt': eingabe.stadt, 'pm-new-datum': eingabe.datum };
    alt.pmCreateProject();
    const angelegt = structuredClone(welt.projs[0]);
    const p = angelegt.id;
    // Bearbeitungsschritte wie in der Oberfläche
    const schritte: any[] = [];
    for (let k = 0; k < 14; k++) {
      const proj = welt.projs[0];
      const neueId = `id${zaehler + 1}`;
      const todo = z.wahl(proj.todos as any[]);
      const einh = proj.einheiten.length ? z.wahl(proj.einheiten as any[]) : null;
      const art = z.wahl(['status', 'feld', 'loeschen', 'darunter', 'inKat', 'katNeu', 'umbenennen', 'vt', 'vtNum', 'pip', 'global', 'gespraech', 'gespraechWeg', 'geb', 'gebAendern', 'gebWeg']);
      welt.hinweise = [];
      const s: any = { art, neueId };
      if (art === 'status' && todo) { s.id = todo.id; s.wert = z.wahl(['offen', 'in progress', 'erledigt']); alt.pmSetTodoStatus(p, s.id, s.wert); }
      else if (art === 'feld' && todo) { s.id = todo.id; s.feld = z.wahl(['text', 'kommentar', 'verantwortlich', 'faellig']); s.wert = s.feld === 'faellig' ? z.wahl(['2026-09-17', '', '2026-10-01']) : z.wahl(['Neu', '', 'Jonas']); alt.pmSaveTodoField(p, s.id, s.feld, s.wert); }
      else if (art === 'loeschen' && todo) { s.id = z.ja(0.3) ? proj.todos.at(-1).id : todo.id; alt.pmDeleteTodo(p, s.id); }
      else if (art === 'darunter' && todo) { s.id = z.ja(0.1) ? 'gibtsnicht' : todo.id; alt.pmAddTodoBelowRow(p, s.id); }
      else if (art === 'inKat' && todo) { s.cat = z.ja(0.2) ? '🆕 Unbekannt' : todo.cat; alt.pmAddTodoInCat(p, s.cat); }
      else if (art === 'katNeu') { s.cat = z.wahl(['📋 Neue Kategorie', '', null, '🧪 Test']); welt.prompt = s.cat; alt.pmAddTodoCat(p); }
      else if (art === 'umbenennen' && todo) { s.alt = todo.cat; s.neu = z.wahl(['', todo.cat, '🔁 Umbenannt']); alt.pmRenameCat(p, s.alt, s.neu); }
      else if (art === 'vt' && einh) { s.id = einh.id; s.feld = z.wahl(['vstatus', 'vermietet', 'vertriebsstand', 'mieterName', 'pipStrategie', 'pipTodosText', 'mieterTodosText', 'reservDatum', 'notarDatum', 'kaeufer']); s.wert = s.feld === 'vstatus' ? z.wahl(['none', 'active', 'reserved', 'notar', 'sold', 'noglobal']) : s.feld === 'vermietet' ? z.wahl(['vermietet', 'leer', 'leer / gekündigt']) : z.wahl(['x', '', '2026-11-02']); alt.pmSaveVT(p, s.id, s.feld, s.wert); }
      else if (art === 'vtNum' && einh) { s.id = einh.id; s.feld = z.wahl(['grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP']); s.wert = z.wahl(['250.000', '85.5', '1.234,56', '', 'abc', '399000']); const input = { value: s.wert }; alt.pmSaveVTNum(p, s.id, s.feld, input); s.anzeige = input.value; }
      else if (art === 'pip' && einh) { s.id = einh.id; s.wert = z.wahl(['grn', 'yel', 'red']); alt.pmSetPIP(p, s.id, s.wert); }
      else if (art === 'global') { s.feld = z.wahl(['zielVKP', 'globalIstKP', 'globalVstatus', 'globalKommentar', 'globalKaeufer', 'globalNotarDatum', 'globalReservDatum']); s.wert = s.feld === 'globalVstatus' ? z.wahl(['none', 'notar', 'sold', 'reserved']) : z.wahl(['1.500.000', '980000', '', 'Notiz', '2026-12-01']); alt.pmSaveGlobal(p, s.feld, s.wert); }
      else if (art === 'gespraech' && einh) { s.id = einh.id; s.eingabe = { datum: z.wahl(['', '2026-09-10']), inhalt: z.wahl(['  Mieterhöhung besprochen ', '', '   ']), ergebnis: z.wahl(['', ' zugestimmt ']) }; welt.felder = { 'pmh-datum': s.eingabe.datum, 'pmh-inhalt': s.eingabe.inhalt, 'pmh-ergebnis': s.eingabe.ergebnis }; alt.pmSaveHistModal(p, s.id); }
      else if (art === 'gespraechWeg' && einh && einh.mieterHistorie?.length) { s.id = einh.id; s.index = 0; alt.pmRmHistModal(p, s.id, 0); }
      else if (art === 'geb') alt.pmAddGebPIP(p);
      else if (art === 'gebAendern' && proj.gebPIP.length) { s.index = 0; s.feld = z.wahl(['text', 'status']); s.wert = s.feld === 'status' ? 'in Arbeit' : 'Dach'; alt.pmGebPIPUpd(p, 0, s.feld, s.wert); }
      else if (art === 'gebWeg' && proj.gebPIP.length) { s.index = 0; alt.pmRmGebPIP(p, 0); }
      else continue;
      s.hinweise = [...welt.hinweise];
      s.stand = createHash('sha256').update(JSON.stringify(pmNormal(welt.projs[0]))).digest('hex');
      schritte.push(s);
    }
    const ende = welt.projs[0];
    const body = { innerHTML: '' };
    alt.pmRenderEinh(ende, body);
    const heute = '2026-09-17';
    faelle.push({
      name: `zufall-${n}`, deal: mitDeal ? deal : null, eingabe, angelegt: pmNormal(angelegt), schritte, ende: pmNormal(ende),
      karte: karte(alt.pmCardHTML(ende)), anzeige: ids(body.innerHTML), fuss: fussZeile(body.innerHTML),
      filter: Object.fromEntries(['alle', 'offen', 'progress', 'erledigt', 'heute'].map((f) => [f, ende.todos.filter((t: any) => alt.pmTodoPasstZuFilter(t, f, heute)).map((t: any) => t.id)])),
      statistik: alt.pmTodoStatistik(ende.todos),
    });
  }
  return { faelle, vorlage: alt.PM_TODO_TEMPLATE, todoStatus: alt.TODO_STATUS };
}

// ═════════════ Listen (Deals, Objekte, Makler) und gespeicherte Filter ═════════════
function listenFaelle() {
  const sf = lies('src/lib/savedFilters.ts').replace(/^import .*$/m, '');
  const dealsQ = lies('src/modules/deals/deals.ts');
  const objQ = lies('src/modules/objekte/objekte.ts');
  const mkQ = lies('src/modules/makler/makler.ts');
  const storage = lies('src/lib/storage.ts');
  const zeile = (name: string) => { const i = storage.indexOf(`export const ${name}`); return storage.slice(i, storage.indexOf('\n', i)).replace(/^export /, ''); };
  const quelle = ts.transpile([
    sf.replace(/export /g, ''), zeile('fe'), zeile('nf'),
    funktion(utils, 'export function esc('), funktion(utils, 'export function statusBadge('), funktion(utils, 'export function getMaklerForObj('), funktion(utils, 'export function getJahresmiete('),
    funktion(dealsQ, 'export function dealRenderList('), funktion(objQ, 'export function objRenderList('), funktion(mkQ, 'export function mkRenderList('),
    funktion(dealsQ, 'function dealCurrentFilterCriteria('), funktion(objQ, 'function objCurrentFilterCriteria('), funktion(mkQ, 'function mkCurrentFilterCriteria('),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { deals: [] as any[], objs: [] as any[], makler: [] as any[], suche: '', aktiv: null as any, html: {} as Record<string, string> };
  const el = (id: string) => ({ set innerHTML(v: string) { welt.html[id] = v; }, get innerHTML() { return welt.html[id] ?? ''; } });
  const document = { getElementById: el, querySelector: () => ({ value: welt.suche }), querySelectorAll: () => [] };
  const alt = new Function('DB', 'document', 'initSavedFiltersBar', 'getActiveFilter', 'apiUrl', 'exposeIdsLaden', 'uid', 'serverAnswered',
    `let dealFilter = 'alle', objFilter = 'alle', mkFilter = 'alle'; let _exposeIds = null;
     ${quelle}
     return { setzen: (d, o, m) => { dealFilter = d; objFilter = o; mkFilter = m; }, dealRenderList, objRenderList, mkRenderList, dealCurrentFilterCriteria, objCurrentFilterCriteria, mkCurrentFilterCriteria, applyFilter, describeFilter, FILTER_TEMPLATES };`)(
    { deals: () => welt.deals, objs: () => welt.objs, makler: () => welt.makler }, document, () => {}, () => welt.aktiv, (p: string) => p, () => {}, () => 'x', () => true,
  );
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const tabelle = (h: string | undefined) => [...(h ?? '').matchAll(/<tr onclick=[\s\S]*?<\/tr>/g)].map((tr) => [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => text(td[1]!)));
  const stats = (h: string | undefined) => [...(h ?? '').matchAll(/class="stat-lbl"[^>]*>([\s\S]*?)<\/div>\s*<div class="stat-num">(\d+)</g)].map((m) => `${text(m[1]!)}=${m[2]}`);

  const z = zufall(8080);
  const STATUS = ['In Prüfung', 'Über Zeit nachfassen', 'Closing Path', 'Angebot abgegeben', 'Angekauft', 'Archiv', undefined, 'Absage'];
  const faelle = [];
  for (let n = 0; n < 50; n++) {
    const makler = Array.from({ length: z.wahl([0, 2, 6]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `m${i}`, name: z.wahl([`Makler ${String.fromCharCode(90 - i)}`, 'Ärger Anna', '', undefined, 'anna']), firma: z.wahl(['Firma GmbH', '', undefined]),
      tel: z.wahl(['+49 711 1', '', undefined]), email: z.wahl(['a@b.test', '', undefined]), prio: z.wahl(['A', 'B', 'C', undefined]), kontaktFreq: z.wahl(['Monatlich', 'Wöchentlich', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const objs = Array.from({ length: z.wahl([0, 3, 7]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `o${i}`, strasse: z.wahl(['Hauptstraße', 'Bahnhofweg', '', undefined]), hausnr: z.wahl(['1', '12a', undefined]), plz: z.wahl(['70173', undefined]), stadt: z.wahl(['Stuttgart', 'Ulm', undefined]),
      status: z.wahl(STATUS), datum: z.wahl(['2026-03-01', undefined, '']), angebotspreis: z.wahl([z.zahl(100000, 4000000, -3), 0, undefined, -5]), zielpreis: z.wahl([undefined, 890000]),
      wohnflaeche: z.wahl([undefined, 480, 95.5]), einheitenAnz: z.wahl([undefined, 6, 0]), istmiete: z.wahl([undefined, 2500]),
      einheiten: z.wahl([undefined, [], [{ kaltmiete: 600 }, { kaltmiete: '450' }]]),
    }).filter(([, v]) => v !== undefined)));
    const deals = Array.from({ length: z.wahl([0, 4, 9]) }, (_, i) => {
      const o = objs.length ? z.wahl(objs) : null;
      const m = makler.length && z.ja(0.8) ? z.wahl(makler) : null;
      return Object.fromEntries(Object.entries({
        id: `d${i}`, objId: o?.id ?? 'fehlt', maklerId: m?.id, status: z.wahl(STATUS), adresse: o?.strasse, hausnr: z.wahl([undefined, o?.hausnr]), stadt: o?.stadt,
        maklerName: m?.name, maklerFirma: m?.firma, maklerTel: z.wahl([undefined, '0711 9']), angebotsDatum: z.wahl([undefined, '2026-05-04', '04.05.2026']),
        kalk: z.wahl([undefined, {}, { kaufpreis: z.zahl(100000, 3000000, -3) }]), einheiten: z.wahl([undefined, [{ mi_ist: 500 }, { mi_ist: '300' }]]),
      }).filter(([, v]) => v !== undefined));
    });
    welt.deals = deals; welt.objs = objs; welt.makler = makler;
    const statusD = z.wahl(['alle', 'alle', 'In Prüfung', 'Archiv', 'Closing Path']);
    const statusO = z.wahl(['alle', 'In Prüfung', 'Archiv']);
    const prio = z.wahl(['alle', 'A', 'B']);
    welt.suche = z.wahl(['', '', 'haupt', 'STUTT', 'makler', 'anna', ' ']);
    const kriterium = () => z.wahl([
      { field: 'status', op: 'equals', value: z.wahl(['in prüfung', 'Archiv']) }, { field: 'status', op: 'not_equals', value: 'Archiv' },
      { field: 'status', op: 'in', value: z.wahl([['Closing Path', 'Angebot abgegeben'], []]) }, { field: 'kalk.kaufpreis', op: 'gte', value: 1000000 },
      { field: 'angebotspreis', op: 'lte', value: '2000000' }, { field: 'tel', op: 'is_set' }, { field: 'email', op: 'is_empty' },
      { field: 'adresse', op: 'contains', value: z.wahl(['bahn', '']) }, { field: 'prio', op: 'equals', value: 'A' }, { field: 'einheiten', op: 'is_empty' },
      { field: 'wohnflaeche', op: 'is_set' }, { field: 'x.y.z', op: 'equals', value: '' }, { field: 'status', op: 'unbekannt' },
    ]);
    welt.aktiv = z.ja(0.5) ? { id: 'f', module: 'deals', name: 'F', criteria: Array.from({ length: z.wahl([0, 1, 2]) }, kriterium), createdAt: 1, updatedAt: 1 } : null;
    welt.html = {};
    alt.setzen(statusD, statusO, prio);
    alt.dealRenderList(); alt.objRenderList(); alt.mkRenderList();
    faelle.push({
      name: `zufall-${n}`, deals, objs, makler, statusD, statusO, prio, suche: welt.suche, filter: welt.aktiv,
      deal: { stats: stats(welt.html['deal-stats']), zeilen: tabelle(welt.html['deal-grid']), leer: text(welt.html['deal-grid'] ?? '').startsWith('📋'), kriterien: alt.dealCurrentFilterCriteria() },
      objekt: { stats: stats(welt.html['obj-stats']), zeilen: tabelle(welt.html['obj-grid']), kriterien: alt.objCurrentFilterCriteria() },
      maklerListe: { stats: stats(welt.html['mk-stats']), zeilen: tabelle(welt.html['mk-grid']), kriterien: alt.mkCurrentFilterCriteria() },
      beschreibung: welt.aktiv ? alt.describeFilter(welt.aktiv) : null,
    });
  }
  return { faelle, vorlagen: alt.FILTER_TEMPLATES };
}

// ═════════════ Kalkulation: „Alle setzen“ (Rendite, KP/m², Mieterhöhung) ═════════════
function kalkWerkzeugeFaelle() {
  const storage = lies('src/lib/storage.ts');
  const zeile = (name: string) => { const i = storage.indexOf(`export const ${name}`); return storage.slice(i, storage.indexOf('\n', i)).replace(/^export /, ''); };
  const quelle = ts.transpile([
    zeile('nf'), funktion(utils, 'export function parseNum('), funktion(deals, 'export function fmtNum('),
    funktion(deals, 'export function dealBulkRendite('), funktion(deals, 'export function dealBulkKpm2('), funktion(deals, 'export function dealBulkMietsteigerung('),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { de: [] as any[], eingabe: '', hinweise: [] as string[] };
  const document = { getElementById: (id: string) => (id === 'dk-einh-body' ? {} : { value: welt.eingabe }) };
  const alt = new Function('document', 'showToast', 'dealRenderEinheiten', 'dealKalkRC', 'welt',
    `${quelle.replace(/dealDE/g, 'welt.de')}\nreturn { dealBulkRendite, dealBulkKpm2, dealBulkMietsteigerung };`)(
    document, (t: string, art?: string) => welt.hinweise.push(art ? `${art}:${t}` : t), () => {}, () => {}, welt,
  );
  const z = zufall(1123);
  const faelle = [];
  for (let n = 0; n < 60; n++) {
    const einheiten = Array.from({ length: z.wahl([0, 1, 3, 6]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `e${i}`, typ: z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz']), lage: z.wahl(['EG', '1. OG', '']),
      zimmer: z.wahl([0, 2, 3.5]), fl: z.wahl([0, 45, 72.5, '1.234,5', '', undefined]), mi_ist: z.wahl(['', 0, 480, 612.4, '1.050,00', undefined]),
      mi_neu: z.wahl(['', 520, 700, undefined]), mi_neu_manual: z.ja(0.3), rend_k: z.wahl([4.5, 5, '', undefined]), vkp: z.wahl([undefined, 180000, 0]), stk: z.wahl([1, 2, undefined]),
    }).filter(([, v]) => v !== undefined)));
    const art = z.wahl(['rendite', 'kpm2', 'miete'] as const);
    const eingabe = art === 'rendite' ? z.wahl(['4.5', '5', '', '0', '-1', '3,8', 'abc']) : art === 'kpm2' ? z.wahl(['3500', '3.200', '2.750,50', '', '0', 'x']) : '';
    const pct = z.wahl([0, 10, 15]);
    welt.de = structuredClone(einheiten); welt.eingabe = eingabe; welt.hinweise = [];
    if (art === 'rendite') alt.dealBulkRendite(); else if (art === 'kpm2') alt.dealBulkKpm2(); else alt.dealBulkMietsteigerung(pct);
    faelle.push({ name: `zufall-${n}`, art, eingabe, pct, einheiten, ergebnis: welt.de, hinweise: welt.hinweise });
  }
  return faelle;
}

// ═════════════ Globale Suche (Objekte, Deals, Makler) ═════════════
function sucheFaelle() {
  const quelle = ts.transpile([funktion(utils, 'export function esc('), funktion(lies('src/lib/search.ts'), 'export function globalSearchExec(')].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { deals: [] as any[], objs: [] as any[], makler: [] as any[], eingabe: '', html: '' };
  const document = {
    getElementById: (id: string) => (id === 'gs-input' ? { value: welt.eingabe } : { set innerHTML(v: string) { welt.html = v; } }),
  };
  const alt = new Function('DB', 'document', `${quelle}\nreturn { globalSearchExec };`)(
    { deals: () => welt.deals, objs: () => welt.objs, makler: () => welt.makler }, document,
  );
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const bereiche = (h: string) => [...h.matchAll(/(🏢 Objekte|📋 Deals|🤝 Makler) \((\d+)\)<\/div>([\s\S]*?)(?=<div style="font-size:10px;font-weight:700|$)/g)]
    .map((m) => ({ bereich: m[1]!, anzahl: Number(m[2]), zeilen: [...m[3]!.matchAll(/<div onclick=[\s\S]*?<\/div>\s*<\/div>/g)].map((z) => text(z[0])) }));

  const z = zufall(4711);
  const faelle = [];
  for (let n = 0; n < 40; n++) {
    const makler = Array.from({ length: z.wahl([0, 3, 8]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `m${i}`, name: z.wahl([`Makler ${String.fromCharCode(65 + i)}`, 'Anna Ärger', '', undefined]), firma: z.wahl(['Firma & Co', '', undefined]),
      tel: z.wahl(['+49 711 123456', '0170/99 88 77', '', undefined]), email: z.wahl(['a@b.test', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const objs = Array.from({ length: z.wahl([0, 4, 9]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `o${i}`, strasse: z.wahl(['Hauptstraße', 'Bahnhofweg', 'Lindenallee', '', undefined]), hausnr: z.wahl(['1', '12a', undefined]),
      plz: z.wahl(['70173', '89073', undefined]), stadt: z.wahl(['Stuttgart', 'Ulm', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const deals = Array.from({ length: z.wahl([0, 4, 9]) }, (_, i) => {
      const o = objs.length ? z.wahl(objs) : null;
      const m = makler.length ? z.wahl(makler) : null;
      return Object.fromEntries(Object.entries({
        id: `d${i}`, adresse: o?.strasse, hausnr: o?.hausnr, stadt: o?.stadt, plz: o?.plz, maklerName: m?.name,
      }).filter(([, v]) => v !== undefined));
    });
    welt.deals = deals; welt.objs = objs; welt.makler = makler;
    welt.eingabe = z.wahl(['', 'h', 'ha', 'haupt', 'STUTT', '711', '0170 99', 'anna', '  ulm ', '70173', 'x&y', '12a']);
    welt.html = '';
    alt.globalSearchExec();
    faelle.push({ name: `zufall-${n}`, deals, objs, makler, eingabe: welt.eingabe, hinweis: /^[^<]+$/.test(welt.html) ? welt.html : '', bereiche: bereiche(welt.html), leer: /Kein Treffer/.test(welt.html) });
  }
  return faelle;
}

// ═════════════ Objekt-Detail (Anzeige, Recherche, Einheiten) ═════════════
function objektDetailFaelle() {
  const objQ = lies('src/modules/objekte/objekte.ts');
  const storage = lies('src/lib/storage.ts');
  const zeile = (name: string) => { const i = storage.indexOf(`export const ${name}`); return storage.slice(i, storage.indexOf('\n', i)).replace(/^export /, ''); };
  const quelle = ts.transpile([
    zeile('fe'), zeile('nf'), funktion(utils, 'export function esc('), funktion(utils, 'export function statusBadge('),
    funktion(objQ, 'export function objDetailHTML('), funktion(objQ, 'export function objRenderEinheiten('),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { einheiten: [] as any[], summen: {} as Record<string, string>, zeilen: [] as string[] };
  const body = { set innerHTML(_v: string) { welt.zeilen = []; }, appendChild: (tr: any) => welt.zeilen.push(tr.innerHTML) };
  const document = {
    getElementById: (id: string) => (id === 'obj-einh-body' ? body : null),
    createElement: () => ({ innerHTML: '' }),
  };
  const alt = new Function('objEinheiten', 'document', 'T',
    `${quelle}\nreturn { objDetailHTML, objRenderEinheiten };`)(welt.einheiten, document, (id: string, v: string) => { welt.summen[id] = v; });
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

  const z = zufall(3003);
  const faelle = [];
  for (let n = 0; n < 40; n++) {
    const einheiten = Array.from({ length: z.wahl([0, 1, 4, 7]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `e${i}`, typ: z.wahl(['Wohnung', 'Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges']), lage: z.wahl(['EG links', '1. OG', '', undefined]),
      zimmer: z.wahl([0, 2, 3.5, undefined]), stueck: z.wahl([undefined, 1, 4]), flaeche: z.wahl([0, 62, 95.5, undefined]),
      kaltmiete: z.wahl([0, 640, 1250.5, undefined]), vermiet: z.wahl(['Vermietet', 'Leerstand', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const o = Object.fromEntries(Object.entries({
      id: `o${n}`, strasse: z.wahl(['Hauptstraße', 'Süße & Co-Weg', '', undefined]), hausnr: z.wahl(['12', '4a', undefined]),
      plz: z.wahl(['70173', '', undefined]), stadt: z.wahl(['Stuttgart', 'Ulm', undefined]), baujahr: z.wahl([1965, undefined, 0]),
      einheitenAnz: z.wahl([6, undefined, 0]), wohnflaeche: z.wahl([480, 95.5, undefined]), grundstueck: z.wahl([900, undefined]),
      energie: z.wahl(['C', '', undefined]), heizung: z.wahl(['Gas-Zentralheizung', undefined]),
      angebotspreis: z.wahl([1450000, 0, undefined]), zielpreis: z.wahl([1300000, undefined]),
      istmiete: z.wahl([4200, 0, undefined]), sollmiete: z.wahl([5100, undefined]),
      status: z.wahl(['In Prüfung', 'Archiv', undefined]), notizen: z.wahl(['Dach 2021 neu', undefined]),
      einheiten,
    }).filter(([, v]) => v !== undefined));
    const html = alt.objDetailHTML(o);
    // Einheitenliste der Bearbeitungsansicht mit denselben Einheiten
    welt.einheiten.length = 0; einheiten.forEach((e) => welt.einheiten.push({ ...e }));
    welt.summen = {}; welt.zeilen = [];
    alt.objRenderEinheiten();
    const abschnitt = (titel: string) => {
      const i = html.indexOf(titel);
      if (i < 0) return '';
      const naechste = html.indexOf('fsec-title', i + titel.length);
      const ende = naechste < 0 ? html.length : html.lastIndexOf('<div', naechste);
      return text(html.slice(i + titel.length, ende));
    };
    faelle.push({
      name: `zufall-${n}`, objekt: o, einheiten,
      lage: abschnitt('📍 Lage'), gebaeude: abschnitt('🏢 Gebäude'), kennzahlen: abschnitt('💶 Kennzahlen'), einheitenTabelle: abschnitt('🏠 Einheiten'),
      recherche: [...html.matchAll(/href="([^"]+)"[^>]*class="btn-ghost"[^>]*>([^<]+)</g)].map((m) => ({ url: m[1]!.replace(/&amp;/g, '&'), label: m[2]!.trim() })),
      summen: { ...welt.summen },
    });
  }
  return faelle;
}

// ═════════════ Dubletten: Scan und Feld-Auflösung ═════════════
function dublettenFaelle() {
  const dedup = lies('src/lib/dedup.ts').replace(/^import .*$/gm, '');
  const mergeQ = lies('src/lib/merge.ts');
  const quelle = ts.transpile([
    dedup.replace(/export /g, ''),
    funktion(mergeQ, 'export function computeFieldDiffs('),
    funktion(mergeQ, 'function resolveField('),
    funktion(mergeQ, 'function resolveSubStructure('),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const welt = { deals: [] as any[], objs: [] as any[], makler: [] as any[], ignoriert: [] as string[] };
  const alt = new Function('DB', 'esc', `${quelle}\nreturn { findAllDuplicates, computeFieldDiffs, resolveField, resolveSubStructure };`)(
    {
      deals: () => welt.deals, objs: () => welt.objs, makler: () => welt.makler,
      get: (k: string) => (k === 'immo-merge-ignored' ? welt.ignoriert : []),
      set: () => {},
    },
    (x: string) => x,
  );

  const z = zufall(9090);
  const faelle = [];
  for (let n = 0; n < 40; n++) {
    const makler = Array.from({ length: z.wahl([0, 3, 6]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `m${i}`, name: z.wahl(['Anna Beispiel', 'Anna Beispil', 'Bernd Bauer', '', undefined]), firma: z.wahl(['Firma GmbH', 'firma gmbh', undefined]),
      tel: z.wahl(['+49 711 123', '0711123', '(0711) 123', undefined]), email: z.wahl(['a@b.test', 'A@B.test', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const objs = Array.from({ length: z.wahl([0, 3, 6]) }, (_, i) => Object.fromEntries(Object.entries({
      id: `o${i}`, strasse: z.wahl(['Hauptstraße', 'Hauptstr.', 'Hauptstrasse', 'Bahnhofweg', undefined]),
      hausnr: z.wahl(['12', '12 a', '13', undefined]), stadt: z.wahl(['Stuttgart', 'stuttgart', 'Ulm', undefined]), plz: z.wahl(['70173', undefined]),
    }).filter(([, v]) => v !== undefined)));
    const deals = Array.from({ length: z.wahl([0, 4, 8]) }, (_, i) => ({
      id: `d${i}`, objId: objs.length ? z.wahl(objs).id : '', maklerId: makler.length ? z.wahl(makler).id : '',
    }));
    welt.makler = makler; welt.objs = objs; welt.deals = deals;
    welt.ignoriert = z.ja(0.3) && makler.length > 1 ? [[makler[0]!.id, makler[1]!.id].sort().join('|')] : [];
    const paare = alt.findAllDuplicates().map((p: any) => ({ typ: p.type, a: p.a.id, b: p.b.id, sicherheit: p.confidence, grund: p.reason }));

    // Feld-Auflösung mit beliebigen Feldnamen (computeFieldDiffs/resolveField/resolveSubStructure)
    const felder = ['f1', 'f2', 'f3'];
    const wert = () => z.wahl(['x', 'y', '', 0, null, undefined, 5]);
    const a: any = { f1: wert(), f2: wert(), f3: wert(), liste: z.wahl([undefined, [], [{ id: 'a' }], ['a']]), obj: z.wahl([undefined, {}, { k: 1 }]) };
    const b: any = { f1: wert(), f2: wert(), f3: wert(), liste: z.wahl([undefined, [], [{ id: 'b' }], ['b']]), obj: z.wahl([undefined, { k: 2, j: 3 }]) };
    const wahl = { fields: { f1: z.wahl(['A', 'B']), f2: 'B' }, subArrays: { liste: z.wahl(['A', 'B', 'union']), obj: z.wahl(['A', 'B', 'union']) } };
    faelle.push({
      name: `zufall-${n}`, makler, objs, deals, ignoriert: welt.ignoriert, paare,
      felderFall: {
        a, b, wahl,
        diffs: alt.computeFieldDiffs(a, b, felder),
        werte: Object.fromEntries(felder.map((f) => [f, alt.resolveField(f, a, b, wahl)])),
        listen: { liste: alt.resolveSubStructure('liste', a, b, wahl), obj: alt.resolveSubStructure('obj', a, b, wahl) },
      },
    });
  }
  return faelle;
}

// ═════════════ Audit-Hash-Kette ═════════════
function auditFaelle() {
  const quelle = ts.transpile(lies('server/audit-chain.ts').replace(/^import .*$/gm, '').replace(/^export /gm, ''), { target: ts.ScriptTarget.ES2022 });
  const alt = new Function('crypto', `${quelle}\nreturn { auditPayload, chainHash, verifyChainRows, parseAuditAnchor, resolveChainStart, anchorMetadata, AUDIT_GENESIS, AUDIT_ANCHOR_ACTION };`)(
    { createHash },
  );
  const z = zufall(5150);
  const zeile = (id: number, ts0: number): any => ({
    id, ts: ts0, type: z.wahl(['mutation', 'kicall', 'delete', 'import']), entity: z.wahl(['deal', 'makler', null]),
    entity_id: z.wahl(['d1', null]), action: z.wahl(['update', 'delete', null]), collection: z.wahl(['immo-deals', null]),
    field_name: z.wahl(['status', null]), old_value: z.wahl(['In Prüfung', null, '{"a":1}']), new_value: z.wahl(['Archiv', null]),
    ai_model: z.wahl(['claude-haiku-4-5-20251001', null]), ai_function: z.wahl(['makler/zusammenfassung', null]),
    input_tokens: z.wahl([0, 1200, null]), output_tokens: z.wahl([0, 300, null]), cost_eur: z.wahl([0, 0.0123, null]),
    source: z.wahl(['/api/deals/{id}', null]), metadata: z.wahl(['{"deal_id":"d1"}', null]),
  });
  const faelle = [];
  for (let n = 0; n < 25; n++) {
    const anzahl = z.wahl([0, 1, 5, 12]);
    const zeilen: any[] = [];
    let prev = alt.AUDIT_GENESIS;
    for (let i = 0; i < anzahl; i++) {
      const r = zeile(i + 1, 1_780_000_000 + i * 60);
      r.hash_chain = alt.chainHash(prev, r);
      prev = r.hash_chain;
      zeilen.push(r);
    }
    // Manchmal die Kette brechen oder ein Anfangsstück mit Anker entfernen
    const art = z.wahl(['heil', 'gebrochen', 'anker', 'anker-falsch']);
    if (art === 'gebrochen' && zeilen.length > 1) zeilen[Math.floor(zeilen.length / 2)].new_value = 'manipuliert';
    if ((art === 'anker' || art === 'anker-falsch') && zeilen.length > 3) {
      const geloescht = zeilen.splice(0, 2);
      const letzte = geloescht[geloescht.length - 1];
      const anker = { prevHash: letzte.hash_chain, prevId: letzte.id, firstKeptId: art === 'anker' ? zeilen[0].id : 999, deleted: geloescht.length, cutoffTs: 1_780_000_100 };
      const ankerZeile = zeile(zeilen[zeilen.length - 1].id + 1, 1_780_000_999);
      ankerZeile.type = 'delete'; ankerZeile.action = alt.AUDIT_ANCHOR_ACTION; ankerZeile.metadata = JSON.stringify(alt.anchorMetadata(anker));
      ankerZeile.hash_chain = alt.chainHash(zeilen[zeilen.length - 1].hash_chain, ankerZeile);
      zeilen.push(ankerZeile);
    }
    faelle.push({
      name: `zufall-${n}-${art}`, zeilen,
      nutzinhalt: zeilen.map((r: any) => alt.auditPayload(r)),
      start: alt.resolveChainStart(zeilen),
      befund: alt.verifyChainRows(zeilen),
    });
  }
  return faelle;
}

// ═════════════ Default-Deny-Gate für Aktionen nach außen ═════════════
function outwardFaelle() {
  const quelle = lies('server/outward-gate.ts');
  const kern = quelle.slice(quelle.indexOf('export const OUTWARD_ACTIONS'), quelle.indexOf('// ── Laufzeit-Fassade'));
  const alt = new Function('process', `${ts.transpile(kern.replace(/^export /gm, ''), { target: ts.ScriptTarget.ES2022 })}\nreturn { evaluateOutward, OUTWARD_ACTIONS };`)({ env: {} });

  const z = zufall(8102);
  const UMGEBUNGEN = [
    {}, { VERCEL: '1', VERCEL_ENV: 'production' }, { VERCEL: '1', VERCEL_ENV: 'preview' },
    { VERCEL: '1', VERCEL_ENV: 'production', OUTWARD_GATE_KILL: '1' }, { VERCEL: '1', VERCEL_ENV: 'production', OUTWARD_GATE_KILL: 'false' },
  ];
  const ZIELE = [
    'https://api.propstack.de/v1/units', 'https://www.immobilienscout24.de/expose/1', 'https://immo.fio.de/x', 'https://evilpropstack.de/units',
    'http://api.propstack.de/v1/units', 'https://boese.example/?x=propstack.de', 'https://api.propstack.de./v1/units', 'nicht-mal-eine-url', '',
    'https://portal.makler-beispiel.de/agb',
  ];
  const EINSTELLUNGEN = [
    undefined, null, {}, { allowAgbSubmit: true }, { allowPropstackWrite: true },
    { allowAgbSubmit: true, allowPropstackWrite: true, extraAgbHosts: ['makler-beispiel.de'] },
    { allowAgbSubmit: 'true' }, { allowAgbSubmit: true, extraAgbHosts: ['de', '*', ' MAKLER-Beispiel.de. '] },
  ];
  const faelle = [];
  for (let n = 0; n < 60; n++) {
    const eingabe = {
      action: z.wahl(['agb-submit', 'propstack-unit-create', 'unbekannt', '']),
      url: z.wahl(ZIELE),
      env: z.wahl(UMGEBUNGEN),
      settings: z.wahl(EINSTELLUNGEN),
    };
    faelle.push({ name: `zufall-${n}`, eingabe, entscheidung: alt.evaluateOutward(eingabe) });
  }
  // Feste Fälle, in denen alle Bedingungen erfüllt sind (und knapp daneben)
  const prod = { VERCEL: '1', VERCEL_ENV: 'production' };
  const fest: { name: string; eingabe: any }[] = [
    { name: 'propstack-frei', eingabe: { action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', env: prod, settings: { allowPropstackWrite: true } } },
    { name: 'propstack-schalter-aus', eingabe: { action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', env: prod, settings: { allowPropstackWrite: false } } },
    { name: 'agb-frei', eingabe: { action: 'agb-submit', url: 'https://immo.fio.de/expose/123', env: prod, settings: { allowAgbSubmit: true } } },
    { name: 'agb-frei-extra-host', eingabe: { action: 'agb-submit', url: 'https://portal.makler-beispiel.de/agb', env: prod, settings: { allowAgbSubmit: true, extraAgbHosts: ['makler-beispiel.de'] } } },
    { name: 'agb-extra-host-ungueltig', eingabe: { action: 'agb-submit', url: 'https://portal.makler-beispiel.de/agb', env: prod, settings: { allowAgbSubmit: true, extraAgbHosts: ['de'] } } },
    { name: 'agb-lokal', eingabe: { action: 'agb-submit', url: 'https://immo.fio.de/expose/123', env: {}, settings: { allowAgbSubmit: true } } },
    { name: 'propstack-not-aus', eingabe: { action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', env: { ...prod, OUTWARD_GATE_KILL: 'false' }, settings: { allowPropstackWrite: true } } },
    { name: 'propstack-fremder-host', eingabe: { action: 'propstack-unit-create', url: 'https://evilpropstack.de/units', env: prod, settings: { allowPropstackWrite: true } } },
  ];
  for (const f of fest) faelle.push({ ...f, entscheidung: alt.evaluateOutward(f.eingabe) });
  return faelle;
}

// ═════════════ Mail-Auswertung (Links, Klartext, Anhänge) ═════════════
function mailFaelle() {
  const graph = lies('server/graph.ts');
  const teil = (start: string, ende: string) => graph.slice(graph.indexOf(start), graph.indexOf(ende, graph.indexOf(start)));
  const quelle = ts.transpile([
    "const URL_RE = /https?:\\/\\/[^\\s\"'<>)\\]]{8,}/g;",
    `const HREF_RE = /<a\\b[^>]*\\bhref\\s*=\\s*["']([^"']+)["'][^>]*>/gi;`,
    teil('function extractLinksFromBody', '// ── Types'),
    teil('function plainTextFromBody', 'function escapeOdataString'),
    teil('function isRelevantAttachment', 'function toOfferAttachment'),
    `${teil('function toOfferAttachment', 'function isPdfAttachment')}`,
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const alt = new Function(`${quelle}\nreturn { extractLinksFromBody, plainTextFromBody, isRelevantAttachment, toOfferAttachment };`)();

  const z = zufall(6612);
  const BODIES = [
    null,
    { contentType: 'text', content: 'Hallo, hier das Exposé: https://immo.fio.de/expose/abc123?token=xyz und https://www.linkedin.com/company/x' },
    { contentType: 'html', content: '<style>a{}</style><p>Guten Tag</p><a href="https://landingpage.immobilien/mandant/objekt/9">Exposé ansehen</a> <a href="https://image.onoffice.de/logo.png">Logo</a> <a href="https://makler.de/impressum">Impressum</a>' },
    { contentType: 'html', content: '<div>Preis: 1.250.000&nbsp;&euro; &amp; mehr</div><a href="https://portal.example.de/immobilie/4711?key=abcdefghij">Objekt</a><a href="https://cdn.example.de/style.css">x</a>' },
    { contentType: 'Text', content: 'Kein Link, nur Text.' },
    { contentType: 'html', content: '<script>var a=1</script><a href="https://x.de/newsletter">Newsletter</a> https://y.de/objekt/1 https://tracking.z.de/pixel.gif' },
  ];
  const ANHAENGE = [
    { id: 'a1', name: 'Expose.pdf', contentType: 'application/pdf', size: 2_500_000, isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' },
    { id: 'a2', name: 'logo.png', contentType: 'image/png', size: 12_000, isInline: true },
    { id: 'a3', name: 'Mieterliste.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 45_000, isInline: false },
    { id: 'a4', name: 'Anschreiben.docx', contentType: 'application/msword', size: 30_000, isInline: false },
    { id: 'a5', name: 'unbekannt.bin', contentType: 'application/octet-stream', size: 1000, isInline: false },
    { id: 'a6', name: 'karte.jpg', contentType: 'image/jpeg', size: 80_000, isInline: false },
    { id: 'a7', contentType: 'application/pdf', size: 0, isInline: false, '@odata.type': '#microsoft.graph.itemAttachment' },
  ];
  const faelle = [];
  for (const [i, body] of BODIES.entries()) {
    faelle.push({
      name: `body-${i}`, body,
      links: alt.extractLinksFromBody(body),
      klartext: alt.plainTextFromBody(body),
    });
  }
  for (const [i, a] of ANHAENGE.entries()) {
    faelle.push({ name: `anhang-${i}`, anhang: a, relevant: alt.isRelevantAttachment(a), eingeordnet: alt.toOfferAttachment(a) });
  }
  void z;
  return faelle;
}

// ═════════════ MCP: Schlüsselverzeichnis, Bereiche, lokale Umgebung ═════════════
function mcpFaelle() {
  const mcp = lies('server/mcp.ts');
  const auth = lies('server/auth.ts');
  const teil = (quelle: string, start: string, ende: string) => quelle.slice(quelle.indexOf(start), quelle.indexOf(ende, quelle.indexOf(start)));
  const quelle = ts.transpile([
    "const MCP_SCOPES = ['read', 'write', 'outward'];",
    'function isMcpScope(value) { return typeof value === "string" && MCP_SCOPES.includes(value); }',
    teil(auth, 'export const LOCAL_OPEN_FLAG', 'export function isAuthRequired').replace(/^export /gm, ''),
    teil(mcp, 'const LABEL_RE', '// ── Anmeldung').replace(/^export /gm, ''),
    teil(mcp, 'export function requiredScope', '// ── Ausführung').replace(/^export /gm, ''),
  ].join('\n'), { target: ts.ScriptTarget.ES2022 });
  const alt = new Function('crypto', `${quelle}\nreturn { parseKeyRegistry, isProvenLocal, requiredScope, isToolAllowed };`)({ createHash });

  const hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const EINTRAEGE = [
    undefined, '', 'cowork:read:' + hash('k1'),
    `cowork:read:${hash('k1')}; claude-code:read+write:${hash('k2')}`,
    `cowork:read:${hash('k1')}, cowork:write:${hash('k3')}`,
    'ohne-hash:read:xyz', 'Falsches Label!:read:' + hash('k4'), 'leer::' + hash('k5'),
    `gross:READ+WRITE:${hash('k6')}`, `bereich:admin:${hash('k7')}`, 'zu:viele:doppel:punkte',
    `mehrzeilig:read:${hash('k8')}\nzweiter:outward:${hash('k9')}`,
  ];
  const UMGEBUNGEN = [
    {}, { AUTH_LOCAL_OPEN: '1' }, { AUTH_LOCAL_OPEN: 'true' }, { AUTH_LOCAL_OPEN: '1', VERCEL: '1' },
    { AUTH_LOCAL_OPEN: '1', VERCEL_ENV: ' ' }, { AUTH_LOCAL_OPEN: '1', DYNO: 'web.1' }, { VERCEL: '1' },
  ];
  const SPECS = [
    { name: 'read_collection', scope: 'read' }, { name: 'create_entity', scope: 'write' },
    { name: 'request_outward_approval', scope: 'outward' }, { name: 'ohne_bereich' },
    { name: 'falscher_bereich', scope: 'admin' }, { name: 'Falscher Name', scope: 'read' },
    { name: 'read_collection', scope: 'read' },
  ];
  const faelle: any[] = [];
  EINTRAEGE.forEach((roh, i) => {
    const r = alt.parseKeyRegistry(roh);
    faelle.push({ art: 'verzeichnis', name: `eintrag-${i}`, roh: roh ?? null, keys: r.keys.map((k: any) => ({ label: k.label, scopes: k.scopes, hash: k.digest.toString('hex') })), rejected: r.rejected });
  });
  UMGEBUNGEN.forEach((env, i) => faelle.push({ art: 'umgebung', name: `umgebung-${i}`, env, lokal: alt.isProvenLocal(env) }));
  SPECS.forEach((spec, i) => faelle.push({
    art: 'werkzeug', name: `spec-${i}`, spec,
    bereich: alt.requiredScope(spec),
    erlaubt: { read: alt.isToolAllowed(spec, ['read']), alle: alt.isToolAllowed(spec, ['read', 'write', 'outward']), keine: alt.isToolAllowed(spec, []) },
  }));
  return faelle;
}

// ═════════════ Dokumente: Bankgespräch-Payload und -HTML ═════════════
async function bankgespraechFaelle() {
  process.env.TZ = 'Europe/Berlin';
  const modul = lies('src/modules/kundenkalk/kundenkalk.ts');
  const vorlage = await import(join(ALT, 'src/lib/bankgespraechTemplate.ts'));
  const { computeKKalk, splitSanierung } = await import(join(ALT, 'src/lib/kundenKalkEngine.ts'));
  const quelle = ts.transpile(funktion(modul, 'function buildPdfPayload('), { target: ts.ScriptTarget.ES2022 });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const Echt = Date;
  const baue = (heute: string, meinName: string, disclaimer: string) => {
    const fest = new Echt(heute).getTime();
    class FesterTag extends Echt {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(fest);
        else super(...(args as [string]));
      }
      static now() { return fest; }
    }
    return new Function('Date', 'getMeinName', 'getKKalkDisclaimer', 'DEFAULT_DISCLAIMER', 'splitSanierung', `${quelle}\nreturn buildPdfPayload;`)(
      FesterTag, () => meinName, () => disclaimer, vorlage.DEFAULT_DISCLAIMER, splitSanierung,
    );
  };
  const z = zufall(4711);
  const bild = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const faelle = [];
  for (let n = 0; n < 60; n++) {
    const kaufpreis = z.wahl([0, z.zahl(90000, 900000, -2), z.zahl(900000, 4000000, -3)]);
    const inputs = {
      kaufpreis,
      notarPct: z.wahl([0, 0.015]), grundbuchPct: z.wahl([0, 0.005]), grundsteuerPct: z.wahl([0.035, 0.065]),
      maklerPct: z.wahl([0, 0.0357]), sonstigePct: z.wahl([0, 0.01]),
      sanierungsposten: Array.from({ length: z.wahl([0, 1, 3]) }, (_, i) => ({
        label: `S${i}`, amount: z.zahl(0, 120000, 0), modus: z.wahl(['sofort', 'aktivieren', 'weg_ruecklage'] as const),
      })),
      nettokaltmieteMonat: z.zahl(0, 6000, 0), stellplatzMiete: z.wahl([0, 60]), sonstigeMiete: z.wahl([0, 50]),
      umlagefaehig: z.zahl(0, 800, 0), mieterhoehungJaehrlich: z.wahl([0, 0.02]),
      nichtUmlagefaehig: z.zahl(0, 400, 0), kostensteigerungJaehrlich: z.wahl([0, 0.02, undefined]),
      wertsteigerungJaehrlich: z.wahl([0, 0.02]), anteilGebaeudeKaufpreis: z.wahl([0.6, 0.85]),
      afaSatz: z.wahl([0.02, 0.03]),
      ...(z.ja(0.2) ? { afaTypDenkmal: true, denkmalAfaBasis: z.zahl(10000, 300000, 0), denkmalAfaSatz: 0.09 } : {}),
      grenzsteuersatz: z.wahl([0, 0.42]),
      darlehen: Array.from({ length: z.wahl([0, 1, 2]) }, (_, i) => ({
        label: `D${i}`, summe: z.zahl(0, Math.max(1, kaufpreis), -3), zinssatz: z.wahl([0, 0.0404]), tilgung: z.wahl([0, 0.02]),
      })),
      betrachtungsdauerJahre: z.wahl([undefined, 1, 2, 10, 15, 30]),
      kaufjahr: z.wahl([undefined, 2025, 2026]),
      wohnflaecheGesamt: z.wahl([undefined, z.zahl(25, 900, 0)]),
    };
    const k = {
      id: `kk${n}`, dealId: 'd1', name: z.wahl(['Kalkulation Lindenstr. 4', 'EG li / Ärger & <Test>', 'x'.repeat(120)]),
      scope: z.wahl(['global', 'aufteiler'] as const),
      createdAt: z.wahl(['2026-05-03T22:30:00.000Z', '2026-01-01T08:00:00.000Z', '2025-12-31T23:15:00.000Z']),
      updatedAt: '2026-09-01T00:00:00.000Z',
      objSnapshot: { adresse: z.wahl(['Lindenstr. 4, 89073 Ulm', '']), kaufdatum: '', wohnflaecheGesamt: z.wahl([0, z.zahl(40, 900, 1)]), stellplaetzeAnzahl: 0, einheitenAnzahl: 1 },
      inputs,
      projektTitel: z.wahl([undefined, '', 'IVT AG Projekt: Entwicklung 9-Familienhaus']),
      wertsteigerungBullets: z.wahl([undefined, [], ['Mieten anpassen', 'Kosten <senken>']]),
      wertsteigerungSichtbar: z.wahl([undefined, true, false]),
      internNotiz: 'nicht im PDF',
      kaufpreisWohnung: z.wahl([undefined, z.zahl(50000, 900000, -3)]),
      kaufpreisStellplatz: z.wahl([undefined, 0, 25000]),
      stellplaetzeAnzahl: z.wahl([undefined, 0, 2]),
      stellplatzKaufpreis: z.wahl([undefined, 0, 12500]),
      stellplaetzeIds: [],
      impressionen: z.wahl([[], [bild], [bild, bild, bild, bild]]),
      anhaengeNamen: [],
    };
    const heute = z.wahl(['2026-09-17T23:30:00+02:00', '2026-01-01T00:10:00+01:00', '2026-06-30T12:00:00+02:00']);
    const ersteller = z.wahl(['', 'Gerry Weyrich']);
    const disclaimer = z.wahl(['', 'Eigener Hinweis\n\nzweiter Absatz']);
    const payload = baue(heute, ersteller, disclaimer)(k, computeKKalk(inputs));
    faelle.push({
      name: `zufall-${n}`,
      eingabe: { k, heute, ersteller, disclaimer },
      payload,
      html: {
        voll: hash(vorlage.bankgespraechFullHtml(payload)),
        vorschau: hash(vorlage.bankgespraechPreviewHtml(payload)),
        kopf: hash(vorlage.bankgespraechPdfHeader(payload)),
        fuss: hash(vorlage.bankgespraechPdfFooter(payload)),
      },
    });
  }
  return faelle;
}

const ankauf = ankaufFaelle();
writeFileSync(join(ZIEL, 'ankaufkalkulation.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/deals/deals.ts dealKalkRC + dealRenderEinheiten', faelle: ankauf }, null, 1));
const kunden = await kundenFaelle();
const cockpit = cockpitFaelle();
const kundenBearbeitung = await kundenBearbeitungFaelle();
writeFileSync(join(ZIEL, 'expose-uebernahme.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/dedup.ts, src/lib/utils.ts, expose-wizard ewDoAnalyse (Vorbereitung)', faelle: exposeFaelle() }));
writeFileSync(join(ZIEL, 'kundenkalkulation-bearbeitung.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/kundenkalk/kundenkalk.ts defaultsFromDeal/kkalkUpdateField/applyEK/Schnellwahl', faelle: kundenBearbeitung }));
writeFileSync(join(ZIEL, 'ankauf-cockpit.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/vertrieb/vertrieb.ts vtNextDue/vtDueStatus/vtBirthdayDue (TZ Europe/Berlin)', faelle: cockpit }, null, 1));
writeFileSync(join(ZIEL, 'kundenkalkulation.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/kundenKalkEngine.ts', faelle: kunden }));
writeFileSync(join(ZIEL_DOKUMENTE, 'bankgespraech.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/kundenkalk/kundenkalk.ts buildPdfPayload + src/lib/bankgespraechTemplate.ts (sha256 der HTML-Ausgaben, TZ Europe/Berlin)', faelle: await bankgespraechFaelle() }, null, 1));
writeFileSync(join(ZIEL, 'finanzpraesentation.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/finanzpraes/finanzpraes.ts (Vorbelegung, computeDealKalkSummary, Konsistenz, expandWithDefaults)', faelle: finanzpraesFaelle() }));
writeFileSync(join(ZIEL_DOKUMENTE, 'finanzpraesentation.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/finanzpraesTemplate.ts (sha256 der HTML-Ausgaben)', faelle: await praesentationDokumentFaelle() }, null, 1));
writeFileSync(join(ZIEL, 'vertriebslisten.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/vertriebsliste.ts + vertriebslisten.ts (formatComputed, vlUpdateCell)', ...vertriebslistenFaelle() }));
writeFileSync(join(ZIEL, 'projekte.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/projektmanagement/pm.ts + pm-berechnung.ts (Anlegen, Karte, Finanzleiste, Bearbeitung)', ...projekteFaelle() }));
writeFileSync(join(ZIEL, 'listen.json'), JSON.stringify({ quelle: 'gg-immohandel deals.ts dealRenderList, objekte.ts objRenderList, makler.ts mkRenderList, lib/savedFilters.ts', ...listenFaelle() }));
writeFileSync(join(ZIEL, 'kalkulationswerkzeuge.json'), JSON.stringify({ quelle: 'gg-immohandel deals.ts dealBulkRendite, dealBulkKpm2, dealBulkMietsteigerung, fmtNum', faelle: kalkWerkzeugeFaelle() }));
writeFileSync(join(ZIEL, 'suche.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/search.ts globalSearchExec', faelle: sucheFaelle() }));
writeFileSync(join(ZIEL, 'objekt-detail.json'), JSON.stringify({ quelle: 'gg-immohandel src/modules/objekte/objekte.ts objDetailHTML + objRenderEinheiten', faelle: objektDetailFaelle() }));
writeFileSync(join(ZIEL, 'dubletten.json'), JSON.stringify({ quelle: 'gg-immohandel src/lib/dedup.ts findAllDuplicates + src/lib/merge.ts computeFieldDiffs/resolveField/resolveSubStructure', faelle: dublettenFaelle() }));
writeFileSync(join(ZIEL, 'audit-kette.json'), JSON.stringify({ quelle: 'gg-immohandel server/audit-chain.ts (auditPayload, chainHash, resolveChainStart, verifyChainRows)', faelle: auditFaelle() }));
writeFileSync(join(ZIEL, 'outward-gate.json'), JSON.stringify({ quelle: 'gg-immohandel server/outward-gate.ts evaluateOutward', faelle: outwardFaelle() }));
writeFileSync(join(ZIEL, 'mail-auswertung.json'), JSON.stringify({ quelle: 'gg-immohandel server/graph.ts (extractLinksFromBody, plainTextFromBody, isRelevantAttachment, toOfferAttachment)', faelle: mailFaelle() }));
writeFileSync(join(ZIEL, 'mcp-zugang.json'), JSON.stringify({ quelle: 'gg-immohandel server/mcp.ts (parseKeyRegistry, requiredScope, isToolAllowed, buildToolRegistry) + server/auth.ts (isProvenLocal)', faelle: mcpFaelle() }));
console.log(`Golden Master: ${ankauf.length} Ankauf-Fälle, ${kunden.length} Kunden-Fälle, ${cockpit.length} Cockpit-Tage → ${ZIEL}`);
