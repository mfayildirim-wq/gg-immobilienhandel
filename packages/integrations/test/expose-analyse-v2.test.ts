// Erfassung v2.2 (Protokoll 28/30): Teil A = bisheriger Aufruf (unverändert, Haiku → Sonnet wie main) parallel zu Teil B
// (Vollerfassung, eigener Aufruf); Wiederholung bei max_tokens und Nachfass nur in Teil B; Teil B darf scheitern.
import { EXPOSE_V2_TOOL_NAME, ExposeV2, einheitenAusTabellen, exposeV2Leer, KATALOG, v2Traegt, zuordnen } from '@gg/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnalyseFehler, analysiereExpose, einheitenAusNachfass, type AnalyseAbhaengigkeiten, KiDienstFehler, anfrageV2, attrappeErfassung, EXPOSE_EINHEITEN_TOOL_V2, EXPOSE_SYSTEM_PROMPT_V2, EXPOSE_TOOL_V2,
  HINWEIS_NACHFASS_V2, HINWEIS_WIEDERHOLUNG_V2, kiAttrappe, kostenEur, kostenSchaetzung, MAX_TOKENS_V2, MODELL_GRUENDLICH, MODELL_SCHNELL, pdfText,
  PROMPT_VERSION_V2, SCHAETZUNG_AUSGABE_TOKENS, seitenAufteilen, testExpose, testExposeV2, ZEITLIMIT_V2_MS,
} from '../src/index.ts';
import { SYSTEM_PROMPT } from '../src/expose/prompt.ts';
import type { PdfTextResult } from '../src/pdf/text.ts';

let aufrufe: { body: any; zeitlimit: number | undefined }[] = [];
let gebucht: { model: string; quelle: string }[] = [];
let antwort: (body: any) => any;
let gelesen: PdfTextResult;

const USAGE = { input_tokens: 1000, output_tokens: 200 };
const { schema: _s, ...LEER } = exposeV2Leer();
/** Antwort des v2-Werkzeugs; `teil` wird über das leere Gerüst gelegt. */
const v2Antwort = (teil: Record<string, any>, stop_reason = 'end_turn', usage = USAGE) => ({
  content: [{ type: 'tool_use', name: EXPOSE_V2_TOOL_NAME, input: { ...LEER, ...teil } }], stop_reason, usage,
});
const angabe = (bezeichnung: string, wert: string, pfad: string | null, seite = 1, gg: string | null = null) => ({ bezeichnung, wert, seite, pfad, kontakt: null, gg });
const SPALTEN = [{ ueberschrift: 'Lage', feld: 'lage' }, { ueberschrift: 'Wfl.', feld: 'flaeche' }, { ueberschrift: 'NKM', feld: 'kaltmiete' }];
const tabelle = (n: number) => ({ seite: 2, titel: 'Mieterliste', spalten: SPALTEN, zeilen: Array.from({ length: n }, (_, i) => [`Whg ${i + 1}`, '60 m²', '500 €']) });
const KERN = [angabe('Adresse', 'Musterweg 1, 89073 Ulm', 'geo.strasse'), angabe('Kaufpreis', '500.000 €', 'preise.kaufpreis')];
const TREFFER = { angaben: KERN, einheiten_tabellen: [tabelle(1)], einheiten_im_dokument: 1, einheiten_vollstaendig: true };
const nurEinheiten = (b: any) => b.tools?.[0]?.name === EXPOSE_V2_TOOL_NAME && !b.tools?.[0]?.input_schema?.properties?.angaben;
const letzterText = (b: any) => b.messages[0].content.at(-1).text as string;

const abh = (): AnalyseAbhaengigkeiten => ({
  ki: {
    nachricht: async (body, zeitlimit) => { aufrufe.push({ body, zeitlimit }); return antwort(body); },
    dateiHochladen: async () => 'file_abc',
    dateiLoeschen: async () => {},
  },
  pdfText: async () => gelesen,
  buchen: async (model, _u, quelle) => { gebucht.push({ model, quelle }); },
});

const seitenText = (n: number, zeichenJeSeite = 800): PdfTextResult => {
  const text = Array.from({ length: n }, (_, i) => `──────── Seite ${i + 1}\n${'x'.repeat(zeichenJeSeite)}`).join('\n\n');
  return { text, pageCount: n, seitenGesamt: n, charsTotal: n * zeichenJeSeite };
};
const pdf = (bytes = 1000) => new Uint8Array(bytes);

beforeEach(() => {
  aufrufe = []; gebucht = [];
  antwort = () => v2Antwort(TREFFER);
  gelesen = seitenText(10);
});

const TEIL_A = { objekt: { strasse: 'Musterweg', hausnr: '1', plz: '89073', stadt: 'Ulm', angebotspreis: 500000, einheiten: [{ typ: 'Wohnung', lage: 'EG', flaeche: 60, kaltmiete: 500 }] }, makler: { name: 'Anna' }, kalkulation: { kaufpreis: 500000 }, _konfidenz: {} };
const aAntwort = (input: unknown = TEIL_A, usage = USAGE) => ({ content: [{ type: 'tool_use', name: 'extract_expose_data', input }], stop_reason: 'tool_use', usage });
const istA = (b: any) => b.tools?.[0]?.name === 'extract_expose_data';
/** Standard: Teil A trägt, Teil B liefert die Vollerfassung. */
const standard = (teilB: Record<string, any> = TREFFER) => (b: any) => (istA(b) ? aAntwort() : v2Antwort(teilB));

describe('Prompt und Werkzeug v2.2 (Teil B)', () => {
  it('verlangt Vollerfassung, Wortlaut, Seiten, Kontakte, Mietlisten als Tabellen und bettet Katalog und gg-Ziele ein', () => {
    for (const satz of ['VOLLERFASSUNG', 'Seite für Seite', 'Lieber zu viel als zu wenig', 'WÖRTLICH', 'NICHTS umrechnen', 'UNGEKÜRZT', '──────── Seite N',
      'geo.strasse mit dem ganzen Wortlaut', 'gg.sanierung', '1 = Hauptansprechpartner', 'einheiten_tabellen', 'Mieternamen WEGLASSEN', 'NIE Warmmiete als Kaltmiete']) {
      expect(EXPOSE_SYSTEM_PROMPT_V2).toContain(satz);
    }
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain('preise.kaufpreis — Kaufpreis');
    expect(EXPOSE_SYSTEM_PROMPT_V2).not.toContain(SYSTEM_PROMPT);
    expect(PROMPT_VERSION_V2).toBe('v2.2');
  });

  it('das Werkzeug trägt nur Teil B; der Nachfass nur die Einheiten-Tabellen', () => {
    expect(EXPOSE_TOOL_V2.name).toBe(EXPOSE_V2_TOOL_NAME);
    expect(Object.keys((EXPOSE_TOOL_V2.input_schema as any).properties)).toEqual(['angaben', 'einheiten_tabellen', 'einheiten_im_dokument', 'einheiten_vollstaendig']);
    expect(Object.keys((EXPOSE_EINHEITEN_TOOL_V2.input_schema as any).properties).sort()).toEqual(['einheiten_im_dokument', 'einheiten_tabellen', 'einheiten_vollstaendig']);
    const a = anfrageV2('m', []);
    expect(a.max_tokens).toBe(MAX_TOKENS_V2);
    expect(a.tool_choice).toEqual({ type: 'tool', name: EXPOSE_V2_TOOL_NAME });
    expect(a.system[0]).toMatchObject({ text: EXPOSE_SYSTEM_PROMPT_V2, cache_control: { type: 'ephemeral' } });
  });
});

describe('Teil A ∥ Teil B', () => {
  it('Text: Teil A wie main (bisheriges Werkzeug, Haiku) und Teil B (Haiku) parallel; Teil A wird `felder`', async () => {
    antwort = standard();
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe).toHaveLength(2);
    const a = aufrufe.find((x) => istA(x.body))!; const b = aufrufe.find((x) => !istA(x.body))!;
    expect(a.body).toMatchObject({ model: MODELL_SCHNELL, max_tokens: 4096, system: [{ text: SYSTEM_PROMPT }], tools: [{ name: 'extract_expose_data' }] });
    expect(b.body).toMatchObject({ model: MODELL_SCHNELL, max_tokens: MAX_TOKENS_V2 });
    expect(b.zeitlimit).toBe(ZEITLIMIT_V2_MS);
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, schemaVersion: 'gg-expose-v2', promptVersion: 'v2.2', stopReason: 'tool_use', nachfass: false, wiederholung: false });
    expect(r.v2?.felder).toMatchObject({ objekt: { stadt: 'Ulm' }, makler: { name: 'Anna' } });
    expect(r.v2?.angaben).toHaveLength(2);
    expect(r.seitenTexte).toHaveLength(10);
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 400 });
    expect(r.kostenEur).toBe(+(2 * kostenEur(MODELL_SCHNELL, USAGE)).toFixed(4));
    expect(zuordnen(r.v2!).pruefdaten.objekt.einheiten).toHaveLength(1);
  });

  it('trägt Teil A nicht (wie in main: 2 von 3 Signalen), schlägt nur Teil A auf Sonnet nach', async () => {
    antwort = (b) => (istA(b) ? (b.model === MODELL_SCHNELL ? aAntwort({ objekt: {} }) : aAntwort()) : v2Antwort(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.modell).toBe(MODELL_GRUENDLICH);
    expect(aufrufe.filter((x) => !istA(x.body)).map((x) => x.body.model)).toEqual([MODELL_SCHNELL]);
  });

  it('Scan: Teil A und Teil B lesen das PDF mit dem gründlichen Modell; Seitentexte leer', async () => {
    gelesen = { text: '', pageCount: 3, seitenGesamt: 3, charsTotal: 0 };
    antwort = standard();
    const r = await analysiereExpose(pdf(), 'scan.pdf', abh());
    expect(r).toMatchObject({ modus: 'pdf', modell: MODELL_GRUENDLICH, seitenTexte: [] });
    expect(aufrufe.every((x) => x.body.model === MODELL_GRUENDLICH && x.body.messages[0].content[0].type === 'document')).toBe(true);
  });

  it('sagt es, wenn nicht alle Seiten gelesen wurden', async () => {
    gelesen = { ...seitenText(10), seitenGesamt: 250 };
    antwort = standard();
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).hinweis).toBe('Ausgewertet wurden die ersten 10 von 250 Seiten.');
  });

  it('Nutzungslimit: sofort durchreichen', async () => {
    antwort = () => { throw new KiDienstFehler(400, 'limit', 'Das Nutzungslimit des Anthropic-Kontos ist erreicht'); };
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toMatchObject({ art: 'limit' });
  });

  it('Teil B scheitert: Teil A bleibt, Warnung, keine Angaben', async () => {
    antwort = (b) => { if (!istA(b)) throw new Error('kaputt'); return aAntwort(); };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.v2?.felder).toBeTruthy();
    expect(r.v2?.angaben).toEqual([]);
    expect(r.warnungen).toContain('Vollerfassung fehlgeschlagen: kaputt — nur Teil A');
  });

  it('Teil A liefert nichts: AnalyseFehler, auch wenn Teil B etwas hat', async () => {
    antwort = (b) => (istA(b) ? { content: [], stop_reason: 'end_turn', usage: USAGE } : v2Antwort(TREFFER));
    const f = await analysiereExpose(pdf(), 'e.pdf', abh()).catch((e) => e);
    expect(f).toBeInstanceOf(AnalyseFehler);
  });
});

describe('Teil B: Wiederholung und Nachfass', () => {
  it('abgeschnitten → einmal ohne Mietliste wiederholen', async () => {
    let n = 0;
    antwort = (b) => (istA(b) ? aAntwort() : nurEinheiten(b) ? v2Antwort({ einheiten_tabellen: [] }) : ++n === 1 ? v2Antwort(TREFFER, 'max_tokens') : v2Antwort({ angaben: KERN }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.wiederholung).toBe(true);
    expect(letzterText(aufrufe.filter((x) => !istA(x.body))[1]!.body)).toBe(HINWEIS_WIEDERHOLUNG_V2);
    expect(r.v2?.einheiten_tabellen).toEqual([]);
    expect(r.v2?.angaben).toHaveLength(2);
  });

  it('auch die Wiederholung abgeschnitten → nur Teil A, mit Warnung', async () => {
    antwort = (b) => (istA(b) ? aAntwort() : v2Antwort(TREFFER, 'max_tokens'));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.v2?.angaben).toEqual([]);
    expect(r.warnungen.some((w) => w.includes('auch nach der Wiederholung abgeschnitten'))).toBe(true);
  });

  const nachfassAntwort = (n: number) => ({ content: [{ type: 'tool_use', name: 'extract_einheiten', input: { einheiten: Array.from({ length: n }, (_, i) => ({ typ: 'Wohnung', lage: `W${i + 1}`, flaeche: 60, kaltmiete: 500 })) } }], usage: USAGE });
  const istNachfass = (b: any) => b.tools?.[0]?.name === 'extract_einheiten';

  it('nennt das Dokument mehr Einheiten als Teil A und Teil B haben: Nachfass wie in der alten App (extract_einheiten), längere Liste gilt', async () => {
    antwort = (b) => (istNachfass(b) ? nachfassAntwort(5) : istA(b) ? aAntwort() : v2Antwort({ ...TREFFER, einheiten_im_dokument: 5 }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.nachfass).toBe(true);
    expect(aufrufe.filter((x) => istNachfass(x.body))).toHaveLength(1);
    expect((r.v2!.felder as any).objekt.einheiten).toHaveLength(5);
    expect(zuordnen(r.v2!).pruefdaten.objekt.einheiten).toHaveLength(5);
    expect(gebucht.map((g) => g.quelle)).toContain('expose-analyse/v2-einheiten');
    expect(r.warnungen).toContain('Einheitenliste unvollständig (1 von 5) — Nachfass');
  });

  it('Nachfass mit nicht längerer Liste wird nicht übernommen; kein Nachfass, wenn die Einheiten vollständig sind', async () => {
    antwort = (b) => (istNachfass(b) ? nachfassAntwort(1) : istA(b) ? aAntwort() : v2Antwort({ ...TREFFER, einheiten_im_dokument: 9 }));
    let r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.nachfass).toBe(false);
    expect((r.v2!.felder as any).objekt.einheiten).toHaveLength(1);
    aufrufe = [];
    antwort = standard();
    r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.some((x) => istNachfass(x.body) || nurEinheiten(x.body))).toBe(false);
  });

  it('Stellplatz-Zeilen mit Stückzahl werden einzelne Einheiten', () => {
    expect(einheitenAusNachfass([{ typ: 'Stellplatz', lage: 'TG', stk: 3, kaltmiete: 60 }, { typ: 'Wohnung', lage: 'EG', kaltmiete: 0 }])).toEqual([
      ...Array.from({ length: 3 }, () => ({ typ: 'Stellplatz', lage: 'TG', zimmer: null, flaeche: null, kaltmiete: 60, vermiet: 'Vermietet' })),
      { typ: 'Wohnung', lage: 'EG', zimmer: null, flaeche: null, kaltmiete: 0, vermiet: 'Leerstand' },
    ]);
  });

  it('Bereinigen: unbekannte Pfade und Ziele werden null (mit Warnung), nichts wird gekürzt', async () => {
    const lang = 'L'.repeat(20_000);
    antwort = standard({ angaben: [angabe('Lage', lang, 'freitexte.lage'), angabe('X', 'y', 'gibt.es.nicht', 1, 'gibt.es.auch.nicht'), angabe('Leer', '  ', null)] });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.v2!.angaben).toHaveLength(2);
    expect(r.v2!.angaben[0]!.wert).toHaveLength(20_000);
    expect(r.v2!.angaben[1]).toMatchObject({ pfad: null, gg: null });
    expect(r.warnungen).toContain('Unbekannter Standard-Pfad „gibt.es.nicht“ → ohne Pfad');
  });
});

describe('Attrappe v2 gegen das Test-Exposé', () => {
  const echt = (): AnalyseAbhaengigkeiten => ({ ki: kiAttrappe(), pdfText: (p) => pdfText(Buffer.from(p)), buchen: async (model, _u, quelle) => { gebucht.push({ model, quelle }); } });

  it('die Erfassung besteht das Schema, trägt und ordnet Objekt, Makler, Einheiten und die offenen Angaben zu', async () => {
    const r = await analysiereExpose(testExposeV2('T1'), 't1.pdf', echt());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, seiten: 2, wiederholung: false, nachfass: false });
    expect(r.v2?.felder).toMatchObject({ objekt: { stadt: 'Ulm' } });
    const v2 = r.v2!;
    expect(ExposeV2.safeParse(v2).success).toBe(true);
    expect(v2Traegt(v2)).toBe(true);
    expect(v2.angaben.find((x) => x.pfad === 'preise.kaufpreis')).toMatchObject({ bezeichnung: 'Kaufpreis', wert: '1.250.000 EUR', seite: 1, gg: 'objekt.angebotspreis' });
    expect(v2.angaben.find((x) => x.bezeichnung === 'E-Mail' && x.kontakt === 1)?.wert).toBe('anna.t1@beispiel.test');
    expect(v2.einheiten_tabellen).toHaveLength(1);
    expect(v2.einheiten_tabellen[0]).toMatchObject({ seite: 2, titel: 'Mietaufstellung' });
    expect(v2.einheiten_tabellen[0]!.zeilen[0]).toEqual(['Wohnung', 'EG links', '3', '80 m2', '800 EUR']);
    expect(v2).toMatchObject({ einheiten_im_dokument: 3, einheiten_vollstaendig: true });

    const z = zuordnen(v2);
    expect(z.pruefdaten.objekt).toMatchObject({ strasse: 'T1strasse', hausnr: '12', plz: '89073', stadt: 'Ulm', angebotspreis: 1250000, wohnflaeche: 240, grundstueck: 480, baujahr: 1965 });
    expect(z.pruefdaten.objekt.einheiten).toHaveLength(3);
    expect(z.pruefdaten.objekt.einheiten[1]).toMatchObject({ typ: 'Wohnung', lage: 'OG rechts', zimmer: 3, flaeche: 80, kaltmiete: 820 });
    expect(z.pruefdaten.makler).toMatchObject({ name: 'Anna T1', firma: 'Beispiel Immobilien GmbH', mobiltel: '0171 0000001', email: 'anna.t1@beispiel.test' });
    expect(z.pruefdaten.makler.alleNamen).toContain('Max Zweit');
    const ruecklage = v2.angaben.findIndex((x) => x.bezeichnung === 'Instandhaltungsrücklage');
    expect(z.zeilen[ruecklage]).toMatchObject({ ziel: null, grund: 'keinMapping', vorschlag: 'details.instandhaltungsruecklage', wert: 12000 });
    const besichtigung = v2.angaben.findIndex((x) => x.bezeichnung === 'Besichtigung');
    expect(v2.angaben[besichtigung]).toMatchObject({ wert: 'nach Vereinbarung', seite: 2, pfad: null, gg: null });
    expect(z.zeilen[besichtigung]).toMatchObject({ ziel: null, vorschlag: null });
    expect(r.seitenTexte[1]).toContain('Besichtigung: nach Vereinbarung');
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  it('das schlichte Test-Exposé (E2E) trägt ebenfalls: Straße, Makler und drei Einheiten', async () => {
    const r = await analysiereExpose(testExpose('E1'), 'e1.pdf', echt());
    expect(r.modell).toBe(MODELL_SCHNELL);
    const z = zuordnen(r.v2!);
    expect(z.pruefdaten.objekt).toMatchObject({ strasse: 'E1strasse', stadt: 'Ulm', angebotspreis: 1250000 });
    expect(z.pruefdaten.objekt.einheiten).toHaveLength(3);
    expect(z.pruefdaten.makler.name).toBe('Anna E1');
  });

  it('„Attrappe: abgeschnitten“: Teil B wird ohne Mietliste wiederholt; die Einheiten kommen aus Teil A', async () => {
    const r = await analysiereExpose(testExposeV2('T2', { abgeschnitten: true }), 't2.pdf', echt());
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, wiederholung: true, nachfass: false });
    expect(gebucht.map((g) => g.quelle).sort()).toEqual(['expose-analyse/text-schnell', 'expose-analyse/v2-text', 'expose-analyse/v2-text-wiederholung']);
    expect(ExposeV2.safeParse(r.v2).success).toBe(true);
    expect(r.v2?.einheiten_tabellen).toEqual([]);
    expect(zuordnen(r.v2!).pruefdaten.objekt.einheiten).toHaveLength(3);
    expect(r.v2?.angaben.some((x) => x.bezeichnung === 'Besichtigung')).toBe(true);
  });

  it('attrappeErfassung ignoriert die Anweisung vor dem ersten Seitenmarker', () => {
    const v2 = attrappeErfassung('Erfasse dieses Immobilien-Exposé vollständig und wörtlich, das ist eine lange Anweisung ohne Seite:\n──────── Seite 1\nKaufpreis: 1 EUR');
    expect(v2.angaben).toEqual([{ bezeichnung: 'Kaufpreis', wert: '1 EUR', seite: 1, pfad: 'preise.kaufpreis', kontakt: null, gg: 'objekt.angebotspreis' }]);
  });
});
