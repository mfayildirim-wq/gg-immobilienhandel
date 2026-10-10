// Schema v1 (Protokoll 26 Abschnitt 8, Protokoll 27 T2): Wegwahl, Wiederholung bei max_tokens + Einheiten-Nachfass,
// Kostengrenze, Bereinigung, Messwerte, Prompt/Werkzeug und die Attrappe gegen ein echtes Zwei-Seiten-PDF.
import { EXPOSE_V1_TOOL_NAME, ExposeV1, exposeV1Leer } from '@gg/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  analysiereExpose, type AnalyseAbhaengigkeiten, anfrageV1, EXPOSE_SYSTEM_PROMPT_V1, EXPOSE_TOOL_V1, kiAttrappe, kostenEur, kostenSchaetzung,
  MAX_TOKENS_V1, MODELL_GRUENDLICH, MODELL_SCHNELL, pdfText, PROMPT_VERSION_V1, seitenAufteilen, SONNET, testExposeV1, toolOhneEinheiten, traegtV1, ZEITLIMIT_V1_MS,
} from '../src/index.ts';
import type { PdfTextResult } from '../src/pdf/text.ts';

let aufrufe: { body: any; zeitlimit: number | undefined }[] = [];
let gebucht: { model: string; quelle: string }[] = [];
let antwort: (body: any) => any;
let gelesen: PdfTextResult;

const USAGE = { input_tokens: 1000, output_tokens: 200 };
/** Antwort des v1-Werkzeugs; `teil` wird über das leere Gerüst gelegt. */
const v1Antwort = (teil: Record<string, any>, stop_reason = 'end_turn', usage = USAGE) => ({
  content: [{ type: 'tool_use', name: EXPOSE_V1_TOOL_NAME, input: { ...exposeV1Leer(), ...teil } }], stop_reason, usage,
});
const einheitenAntwort = (n: number) => ({
  content: [{ type: 'tool_use', name: 'extract_einheiten', input: { einheiten: Array.from({ length: n }, (_, i) => ({ typ: 'Wohnung', lage: `Whg ${i + 1}`, zimmer: 2, flaeche: 60, kaltmiete: 500 })) } }],
  stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 300 },
});
const TREFFER = { geo: { ...exposeV1Leer().geo, strasse: 'Musterweg', ort: 'Ulm' }, preise: { ...exposeV1Leer().preise, kaufpreis: 500000 }, einheiten: [{ typ: 'Wohnung', lage: 'EG', zimmer: 2, flaeche: 60, kaltmiete: 500, nebenkosten: null, sollmiete: null, vermiet: 'Vermietet', mietbeginn: null, _seite: 2 }] };
const hatEinheiten = (b: any) => !!b.tools?.[0]?.input_schema?.properties?.einheiten;
const werkzeug = (b: any) => b.tools?.[0]?.name;

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
  antwort = () => v1Antwort(TREFFER);
  gelesen = seitenText(10);
});

describe('Prompt und Werkzeug v1', () => {
  it('übernimmt die bewährten Blöcke, lässt die Rechenanweisungen weg und erklärt Seitenmarker, Belege und Auffangbereich', () => {
    for (const block of ['EINHEITENLISTE — KRITISCH', 'WOHNFLÄCHE — Erkennungsmuster', 'KALTMIETE — STRENGE Definition', 'ZIMMER-ANZAHL', '═══ MAKLER ═══', '═══ KONFIDENZ ═══', '═══ NIEMALS ═══']) {
      expect(EXPOSE_SYSTEM_PROMPT_V1).toContain(block);
    }
    expect(EXPOSE_SYSTEM_PROMPT_V1).not.toContain('Grunderwerbsteuer');
    expect(EXPOSE_SYSTEM_PROMPT_V1).not.toContain('Bruttorendite = ');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('das System rechnet selbst');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('──────── Seite N');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('höchstens 80 Zeichen');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('NIE in weitere_angaben');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('KEINE Mieternamen');
    expect(EXPOSE_SYSTEM_PROMPT_V1).toContain('Höchstens 200 Einheiten');
    expect(PROMPT_VERSION_V1).toBe('v1.0');
  });

  it('das Werkzeug trägt das Schema aus @gg/domain; die Variante ohne Einheiten lässt einheiten und freitexte weg', () => {
    expect(EXPOSE_TOOL_V1.name).toBe(EXPOSE_V1_TOOL_NAME);
    const props = (EXPOSE_TOOL_V1.input_schema as any).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['geo', 'preise', 'einheiten', 'freitexte', 'belege', 'weitere_angaben']));
    const ohne = toolOhneEinheiten();
    const p2 = (ohne.input_schema as any).properties;
    expect(p2.einheiten).toBeUndefined();
    expect(p2.freitexte).toBeUndefined();
    expect((ohne.input_schema as any).required).not.toContain('einheiten');
    expect(p2.belege).toBeDefined();
    expect(props.einheiten).toBeDefined(); // das Original bleibt unberührt
  });

  it('die Anfrage erzwingt das Werkzeug, erlaubt 12000 Ausgabe-Tokens und markiert Anweisung und Schema als zwischenspeicherbar', () => {
    const a = anfrageV1('m', []);
    expect(a.max_tokens).toBe(MAX_TOKENS_V1);
    expect(a.tool_choice).toEqual({ type: 'tool', name: EXPOSE_V1_TOOL_NAME });
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('Wegwahl v1', () => {
  it('Standard ist v1: Text an Haiku mit 280 s Zeitlimit, Ergebnis mit Messwerten und Seitentexten', async () => {
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, schemaVersion: 'gg-expose-v1', promptVersion: 'v1.0', stopReason: 'end_turn', nachfass: false, wiederholung: false });
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]!.zeitlimit).toBe(ZEITLIMIT_V1_MS);
    expect(aufrufe[0]!.body.max_tokens).toBe(MAX_TOKENS_V1);
    expect(aufrufe[0]!.body.messages[0].content[0].text).toContain('──────── Seite 1');
    expect(r.v1?.preise.kaufpreis).toBe(500000);
    expect(r.extrahiert).toBe(r.v1);
    expect(r.seitenTexte).toHaveLength(10);
    expect(r.seitenTexte[0]).toBe('x'.repeat(800));
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect(r.kostenEur).toBe(kostenEur(MODELL_SCHNELL, USAGE));
    expect(r.dauerMs).toBeGreaterThanOrEqual(0);
    expect(gebucht).toEqual([{ model: MODELL_SCHNELL, quelle: 'expose-analyse/v1-text-schnell' }]);
  });

  it('ein Scan geht als PDF an Sonnet mit demselben Werkzeug; Seitentexte bleiben leer', async () => {
    gelesen = { text: '', pageCount: 30, seitenGesamt: 30, charsTotal: 0 };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'pdf', modell: MODELL_GRUENDLICH, seiten: 30, seitenTexte: [] });
    expect(aufrufe[0]!.body.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(aufrufe[0]!.body.tools[0].name).toBe(EXPOSE_V1_TOOL_NAME);
    expect(aufrufe[0]!.zeitlimit).toBe(ZEITLIMIT_V1_MS);
    expect(gebucht).toEqual([{ model: MODELL_GRUENDLICH, quelle: 'expose-analyse/v1-pdf' }]);
  });

  it('sagt es, wenn nicht alle Seiten gelesen wurden', async () => {
    gelesen = { ...seitenText(50), seitenGesamt: 80 };
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).hinweis).toBe('Ausgewertet wurden die ersten 50 von 80 Seiten.');
  });

  it('schlägt auf Sonnet nach, wenn Haiku zu wenig findet oder scheitert', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v1Antwort({ geo: { ...exposeV1Leer().geo, ort: 'nur Ort' } }) : v1Antwort(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => a.body.model)).toEqual([MODELL_SCHNELL, MODELL_GRUENDLICH]);
    expect(r.modell).toBe(MODELL_GRUENDLICH);
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v1-text-schnell', 'expose-analyse/v1-text-gruendlich']);

    aufrufe = [];
    antwort = (b) => { if (b.model === MODELL_SCHNELL) throw new Error('529'); return v1Antwort(TREFFER); };
    const r2 = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r2.modell).toBe(MODELL_GRUENDLICH);
    expect(r2.warnungen.join(' ')).toContain('529');
  });

  it('wirft, wenn auch Sonnet nichts liefert', async () => {
    antwort = () => ({ content: [], stop_reason: 'end_turn', usage: USAGE });
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toThrow('nichts auslesen');
  });
});

describe('traegtV1', () => {
  const mit = (teil: Record<string, any>) => ({ ...exposeV1Leer(), ...teil });
  const ort = { geo: { ...exposeV1Leer().geo, ort: 'Ulm' } };
  const preis = { preise: { ...exposeV1Leer().preise, kaufpreis: 1 } };
  it('Ort und Preis und Einheiten (oder genau eine Einheit laut Dokument) und nicht abgeschnitten', () => {
    expect(traegtV1(mit({ ...ort, ...preis, einheiten: TREFFER.einheiten }), 'end_turn')).toBe(true);
    expect(traegtV1(mit({ ...ort, ...preis, verwaltung: { ...exposeV1Leer().verwaltung, einheiten_anzahl_dokument: 1 } }), 'end_turn')).toBe(true);
    expect(traegtV1(mit({ ...ort, ...preis }), 'end_turn')).toBe(false); // 2 von 3 reicht in v1 nicht
    expect(traegtV1(mit({ ...ort, einheiten: TREFFER.einheiten }), 'end_turn')).toBe(false);
    expect(traegtV1(mit({ ...ort, ...preis, einheiten: TREFFER.einheiten }), 'max_tokens')).toBe(false);
    expect(traegtV1(null, 'end_turn')).toBe(false);
  });
});

describe('Abgeschnittene Antwort (max_tokens)', () => {
  it('wiederholt ohne Einheiten, holt die Einheiten nach und bleibt bei Haiku, wenn das Ergebnis trägt', async () => {
    antwort = (b) => {
      if (werkzeug(b) === 'extract_einheiten') return einheitenAntwort(3);
      if (hatEinheiten(b)) return v1Antwort({ geo: TREFFER.geo, preise: TREFFER.preise }, 'max_tokens');
      return v1Antwort({ geo: TREFFER.geo, preise: TREFFER.preise, zustand: { ...exposeV1Leer().zustand, baujahr: 1965 } });
    };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, wiederholung: true, nachfass: true, stopReason: 'end_turn' });
    expect(aufrufe.map((a) => werkzeug(a.body))).toEqual([EXPOSE_V1_TOOL_NAME, EXPOSE_V1_TOOL_NAME, 'extract_einheiten']);
    expect(hatEinheiten(aufrufe[1]!.body)).toBe(false);
    expect(aufrufe[2]!.body.messages[0].content[0].type).toBe('document'); // Nachfass bekommt das ganze PDF
    expect(r.v1?.einheiten).toHaveLength(3);
    expect(r.v1?.einheiten[0]).toMatchObject({ typ: 'Wohnung', lage: 'Whg 1', zimmer: 2, flaeche: 60, kaltmiete: 500, _seite: null });
    expect(r.v1?.zustand.baujahr).toBe(1965);
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v1-text-schnell', 'expose-analyse/v1-text-schnell-wiederholung', 'expose-analyse/v1-einheiten']);
    expect(gebucht[2]!.model).toBe(SONNET);
    expect(r.usage).toEqual({ inputTokens: 5000, outputTokens: 700 });
    expect(r.kostenEur).toBe(+(kostenEur(MODELL_SCHNELL, USAGE) * 2 + kostenEur(SONNET, { input_tokens: 3000, output_tokens: 300 })).toFixed(4));
    expect(r.warnungen.join(' ')).toContain('max_tokens');
  });

  it('ist auch die Wiederholung abgeschnitten, geht es zu Sonnet — nie stille Teilübernahme', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v1Antwort({ geo: TREFFER.geo, preise: TREFFER.preise }, 'max_tokens') : v1Antwort(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => [a.body.model, werkzeug(a.body)])).toEqual([[MODELL_SCHNELL, EXPOSE_V1_TOOL_NAME], [MODELL_SCHNELL, EXPOSE_V1_TOOL_NAME], [MODELL_GRUENDLICH, EXPOSE_V1_TOOL_NAME]]);
    expect(r).toMatchObject({ modell: MODELL_GRUENDLICH, stopReason: 'end_turn', wiederholung: true, nachfass: false });
    expect(r.v1?.einheiten).toHaveLength(1);
  });

  it('ein gescheiterter Nachfass wird vermerkt und führt zu Sonnet, wenn ohne Einheiten nichts trägt', async () => {
    antwort = (b) => {
      if (werkzeug(b) === 'extract_einheiten') throw new Error('KI lieferte keine Einheitenliste');
      if (b.model === MODELL_GRUENDLICH) return v1Antwort(TREFFER);
      return hatEinheiten(b) ? v1Antwort({ geo: TREFFER.geo, preise: TREFFER.preise }, 'max_tokens') : v1Antwort({ geo: TREFFER.geo, preise: TREFFER.preise });
    };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.modell).toBe(MODELL_GRUENDLICH);
    expect(r.warnungen.join(' ')).toContain('Einheiten-Nachfass fehlgeschlagen');
  });
});

describe('Kostengrenze', () => {
  it('bricht vor dem Sonnet-Aufruf ab, wenn die Schätzung die Grenze überschreitet', async () => {
    antwort = () => v1Antwort({});
    await expect(analysiereExpose(pdf(), 'e.pdf', abh(), { kostenGrenzeEur: 0.01 })).rejects.toThrow(/Kostengrenze 0\.01 € überschritten/);
    expect(aufrufe.map((a) => a.body.model)).toEqual([MODELL_SCHNELL]);
  });

  it('die Standardgrenze von 1 € lässt ein normales Exposé durch; die Schätzung rechnet mit den Preisen aus kosten.ts', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v1Antwort({}) : v1Antwort(TREFFER));
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_GRUENDLICH);
    expect(kostenSchaetzung(MODELL_GRUENDLICH, 400_000)).toBe(kostenEur(MODELL_GRUENDLICH, { input_tokens: 100_000, output_tokens: 8000 }));
  });
});

describe('Bereinigung', () => {
  it('liest Zahlen aus Texten, wirft unbekannte Schlüssel weg und meldet das als Warnung statt abzubrechen', async () => {
    antwort = () => v1Antwort({ ...TREFFER, preise: { ...TREFFER.preise, kaufpreis: '1.250.000 €', erfunden: 1 }, unbekannt: { x: 1 } });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(ExposeV1.safeParse(r.v1).success).toBe(true);
    expect(r.v1?.preise.kaufpreis).toBe(1250000);
    expect((r.v1 as any)?.unbekannt).toBeUndefined();
    expect(r.warnungen.length).toBeGreaterThan(0);
  });
});

describe('v0 per Option', () => {
  it('liefert das v0-Werkzeug mit denselben Messwerten', async () => {
    antwort = () => ({ content: [{ type: 'tool_use', name: 'extract_expose_data', input: { objekt: { strasse: 'A', angebotspreis: 1 } } }], stop_reason: 'end_turn', usage: USAGE });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh(), { schema: 'v0' });
    expect(r).toMatchObject({ schemaVersion: 'gg-expose-v0', promptVersion: 'v0', stopReason: 'end_turn', modell: MODELL_SCHNELL, nachfass: false, wiederholung: false, warnungen: [] });
    expect(r.v1).toBeUndefined();
    expect(r.extrahiert.objekt.strasse).toBe('A');
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect(r.kostenEur).toBe(kostenEur(MODELL_SCHNELL, USAGE));
    expect(r.seitenTexte).toHaveLength(10);
    expect(aufrufe[0]!.body.max_tokens).toBe(4096);
  });
});

describe('seitenAufteilen', () => {
  it('teilt an den Markern, Index 0 = Seite 1; ohne Marker bleibt der Text eine Seite', () => {
    expect(seitenAufteilen('──────── Seite 1\nA\n\n──────── Seite 2\nB\nC')).toEqual(['A', 'B\nC']);
    expect(seitenAufteilen('──────── Seite 1\n\n\n──────── Seite 3\nC')).toEqual(['', '', 'C']);
    expect(seitenAufteilen('nur Text')).toEqual(['nur Text']);
    expect(seitenAufteilen('')).toEqual([]);
  });
});

describe('Attrappe v1 gegen das Test-Exposé', () => {
  const echt = (): AnalyseAbhaengigkeiten => ({ ki: kiAttrappe(), pdfText: (p) => pdfText(Buffer.from(p)), buchen: async (model, _u, quelle) => { gebucht.push({ model, quelle }); } });

  it('die Antwort besteht das Schema und trägt Kernwerte, Belege mit Seite und Zitat, weitere Angaben und Kontakte', async () => {
    const r = await analysiereExpose(testExposeV1('T1'), 't1.pdf', echt());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, seiten: 2, wiederholung: false, nachfass: false, stopReason: 'end_turn' });
    const v1 = r.v1!;
    expect(ExposeV1.safeParse(v1).success).toBe(true);
    expect(r.warnungen).toEqual([]);
    expect(v1.geo).toMatchObject({ strasse: 'T1strasse', hausnummer: '12', plz: '89073', ort: 'Ulm' });
    expect(v1.preise.kaufpreis).toBe(1250000);
    expect(v1.preise.hausgeld_monat).toBe(350);
    expect(v1.flaechen).toMatchObject({ wohnflaeche: 240, grundstuecksflaeche: 480 });
    expect(v1.zustand).toMatchObject({ baujahr: 1965, denkmalschutz: true });
    expect(v1.belege.kaufpreis).toEqual({ seite: 1, zitat: 'Kaufpreis: 1.250.000 EUR', konfidenz: 'hoch' });
    expect(v1.belege.grundstueck.seite).toBe(1);
    expect(v1.belege.anzahl_we).toEqual({ seite: null, zitat: null, konfidenz: 'niedrig' }); // kein Zitat erfinden
    expect(v1.einheiten).toHaveLength(3);
    expect(v1.einheiten[0]).toMatchObject({ typ: 'Wohnung', lage: 'EG links', zimmer: 3, flaeche: 80, kaltmiete: 800, _seite: 2 });
    expect(v1.weitere_angaben).toHaveLength(2);
    expect(v1.weitere_angaben[0]).toMatchObject({ gruppe: 'zustand', bezeichnung: 'Dach', wert: '2015 neu gedeckt', seite: 2 });
    expect(v1.weitere_kontakte).toEqual([{ name: 'Max Zweit', rolle: 'Geschäftsführer', tel: '0711 123456', mobil: null, email: 'max@beispiel.test' }]);
    expect(v1.kontaktperson).toMatchObject({ vorname: 'Anna', name: 'T1', firma: 'Beispiel Immobilien GmbH', email: 'anna.t1@beispiel.test' });
    expect(v1.verwaltung).toMatchObject({ anzahl_wohneinheiten: 3, einheiten_anzahl_dokument: 3, einheiten_vollstaendig: true });
    expect(r.seitenTexte).toHaveLength(2);
    expect(r.seitenTexte[0]).toContain('Kaufpreis: 1.250.000 EUR');
    expect(r.seitenTexte[1]).toContain('Einheit: Wohnung | DG | 2 | 80 | 700');
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });

  it('„Attrappe: abgeschnitten“: erste Antwort max_tokens, Wiederholung ohne Einheiten, Einheiten über extract_einheiten', async () => {
    const r = await analysiereExpose(testExposeV1('T2', { abgeschnitten: true }), 't2.pdf', echt());
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, wiederholung: true, nachfass: true, stopReason: 'end_turn' });
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v1-text-schnell', 'expose-analyse/v1-text-schnell-wiederholung', 'expose-analyse/v1-einheiten']);
    expect(ExposeV1.safeParse(r.v1).success).toBe(true);
    expect(r.v1?.einheiten).toHaveLength(3);
    expect(r.v1?.einheiten[1]).toMatchObject({ typ: 'Wohnung', lage: 'OG rechts', zimmer: 3, flaeche: 80, kaltmiete: 820, _seite: null });
    expect(r.v1?.preise.hausgeld_monat).toBe(350);
    expect(r.v1?.weitere_angaben).toHaveLength(2);
  });

  it('die Attrappe selbst: Teilantwort mit max_tokens, Verbrauch aus Zeichen/4 und JSON-Länge/3', async () => {
    const text = 'Analysiere:\n\n──────── Seite 1\nAdresse: Musterweg 1, 89073 Ulm\nKaufpreis: 100.000 EUR\nBaujahr: 1900\nAttrappe: abgeschnitten';
    const a = await kiAttrappe().nachricht(anfrageV1(MODELL_SCHNELL, [{ type: 'text', text }]));
    expect(a.stop_reason).toBe('max_tokens');
    expect(a.content[0].input.preise.kaufpreis).toBe(100000);
    expect(a.content[0].input.zustand.baujahr).toBeNull();
    expect(a.usage).toEqual({ input_tokens: Math.floor(text.length / 4), output_tokens: Math.floor(JSON.stringify(a.content[0].input).length / 3) });
    const b = await kiAttrappe().nachricht(anfrageV1(MODELL_SCHNELL, [{ type: 'text', text }], toolOhneEinheiten()));
    expect(b.stop_reason).toBe('end_turn');
    expect(b.content[0].input.zustand.baujahr).toBe(1900);
    expect(b.content[0].input.einheiten).toBeUndefined();
  });
});
