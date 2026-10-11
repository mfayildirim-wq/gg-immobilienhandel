// Erfassung v2 (Protokoll 28): Wegwahl, Haiku → Sonnet, Kostengrenze, Wiederholung bei max_tokens, Nachfass nur der
// Einheiten-Tabellen, Bereinigung, Messwerte, Prompt/Werkzeug und die Attrappe gegen ein echtes Zwei-Seiten-PDF.
import { EXPOSE_V2_TOOL_NAME, ExposeV2, einheitenAusTabellen, exposeV2Leer, KATALOG, v2Traegt, zuordnen } from '@gg/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnalyseFehler, analysiereExpose, type AnalyseAbhaengigkeiten, KiDienstFehler, anfrageV2, attrappeErfassung, EXPOSE_EINHEITEN_TOOL_V2, EXPOSE_SYSTEM_PROMPT_V2, EXPOSE_TOOL_V2,
  HINWEIS_NACHFASS_V2, HINWEIS_WIEDERHOLUNG_V2, kiAttrappe, kostenEur, kostenSchaetzung, MAX_TOKENS_V2, MODELL_GRUENDLICH, MODELL_SCHNELL, pdfText,
  PROMPT_VERSION_V2, SCHAETZUNG_AUSGABE_TOKENS, seitenAufteilen, testExpose, testExposeV2, ZEITLIMIT_V2_MS,
} from '../src/index.ts';
import { EXTRACT_TOOL, SYSTEM_PROMPT } from '../src/expose/prompt.ts';
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
const nurEinheiten = (b: any) => !b.tools?.[0]?.input_schema?.properties?.angaben;
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

describe('Prompt und Werkzeug v2', () => {
  it('verlangt Vollerfassung, Wortlaut, Seiten, Kontakte, Mietlisten als Tabellen und bettet Katalog und gg-Ziele ein', () => {
    for (const satz of ['VOLLERFASSUNG', 'Seite für Seite', 'Lieber zu viel als zu wenig', 'WÖRTLICH', 'NICHTS umrechnen', 'UNGEKÜRZT', '──────── Seite N',
      'geo.strasse mit dem ganzen Wortlaut', 'gg.sanierung', 'ausstattung.merkmal', '1 = Hauptansprechpartner', 'einheiten_tabellen', 'Mieternamen WEGLASSEN',
      'Summenzeilen', 'NIE Warmmiete als Kaltmiete', 'NKM', 'einheiten_im_dokument', 'einheiten_vollstaendig']) {
      expect(EXPOSE_SYSTEM_PROMPT_V2).toContain(satz);
    }
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain('preise.kaufpreis — Kaufpreis');
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain('kontaktperson.tel_handy — Mobil');
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain('details.instandhaltungsruecklage — Instandhaltungsrücklage');
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain('makler.email — E-Mail');
    for (const pfad of Object.keys(KATALOG)) expect(EXPOSE_SYSTEM_PROMPT_V2).toContain(`${pfad} — `);
    // Teil A: der bisherige Prompt steht wortgleich darin („mindestens wie früher“)
    expect(EXPOSE_SYSTEM_PROMPT_V2).toContain(SYSTEM_PROMPT);
    expect(EXPOSE_SYSTEM_PROMPT_V2.indexOf('TEIL A')).toBeLessThan(EXPOSE_SYSTEM_PROMPT_V2.indexOf('TEIL B'));
    expect(PROMPT_VERSION_V2).toBe('v2.1');
  });

  it('das Werkzeug trägt Teil A (bisheriges Schema, wortgleich) und Teil B aus @gg/domain; der Nachfass nur die Einheiten-Tabellen', () => {
    expect(EXPOSE_TOOL_V2.name).toBe(EXPOSE_V2_TOOL_NAME);
    expect(EXPOSE_EINHEITEN_TOOL_V2.name).toBe(EXPOSE_V2_TOOL_NAME);
    const props = (EXPOSE_TOOL_V2.input_schema as any).properties;
    expect(Object.keys(props)).toEqual(['objekt', 'makler', 'kalkulation', '_konfidenz', 'angaben', 'einheiten_tabellen', 'einheiten_im_dokument', 'einheiten_vollstaendig']);
    expect(props.objekt).toBe((EXTRACT_TOOL.input_schema as any).properties.objekt);
    expect(props.angaben.items.properties.pfad.enum ?? props.angaben.items.properties.pfad.anyOf).toBeDefined();
    expect(Object.keys((EXPOSE_EINHEITEN_TOOL_V2.input_schema as any).properties).sort()).toEqual(['einheiten_im_dokument', 'einheiten_tabellen', 'einheiten_vollstaendig']);
  });

  it('die Anfrage erzwingt das Werkzeug, erlaubt 32000 Ausgabe-Tokens und markiert Anweisung und Schema als zwischenspeicherbar', () => {
    const a = anfrageV2('m', []);
    expect(a.max_tokens).toBe(MAX_TOKENS_V2);
    expect(MAX_TOKENS_V2).toBe(32_000);
    expect(a.tool_choice).toEqual({ type: 'tool', name: EXPOSE_V2_TOOL_NAME });
    expect(a.system[0]).toMatchObject({ text: EXPOSE_SYSTEM_PROMPT_V2, cache_control: { type: 'ephemeral' } });
    expect(a.tools[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(anfrageV2('m', [], EXPOSE_EINHEITEN_TOOL_V2).tools[0].input_schema).toBe(EXPOSE_EINHEITEN_TOOL_V2.input_schema);
  });
});

describe('Wegwahl v2', () => {
  it('Standard ist v2: Text an Haiku mit 280 s Zeitlimit, Ergebnis mit Messwerten und Seitentexten', async () => {
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, schemaVersion: 'gg-expose-v2', promptVersion: 'v2.1', stopReason: 'end_turn', nachfass: false, wiederholung: false });
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]!.zeitlimit).toBe(ZEITLIMIT_V2_MS);
    expect(aufrufe[0]!.body.max_tokens).toBe(MAX_TOKENS_V2);
    expect(aufrufe[0]!.body.messages[0].content[0].text).toContain('──────── Seite 1');
    expect(r.v2?.angaben).toHaveLength(2);
    expect(r.v2?.schema).toBe('gg-expose-v2');
    expect(r.extrahiert).toBe(r.v2);
    expect(r.seitenTexte).toHaveLength(10);
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect(r.kostenEur).toBe(kostenEur(MODELL_SCHNELL, USAGE));
    expect(gebucht).toEqual([{ model: MODELL_SCHNELL, quelle: 'expose-analyse/v2-text-schnell' }]);
  });

  it('ein Scan geht als PDF direkt an Sonnet mit demselben Werkzeug; Seitentexte bleiben leer', async () => {
    gelesen = { text: '', pageCount: 30, seitenGesamt: 30, charsTotal: 0 };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'pdf', modell: MODELL_GRUENDLICH, seiten: 30, seitenTexte: [] });
    expect(aufrufe[0]!.body.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(aufrufe[0]!.body.tools[0].name).toBe(EXPOSE_V2_TOOL_NAME);
    expect(aufrufe[0]!.body.model).toBe(MODELL_GRUENDLICH);
    expect(gebucht).toEqual([{ model: MODELL_GRUENDLICH, quelle: 'expose-analyse/v2-pdf' }]);
  });

  it('sagt es, wenn nicht alle Seiten gelesen wurden', async () => {
    gelesen = { ...seitenText(50), seitenGesamt: 80 };
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).hinweis).toBe('Ausgewertet wurden die ersten 50 von 80 Seiten.');
  });

  it('schlägt auf Sonnet nach, wenn Haiku nicht trägt (kein Preis) oder scheitert', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v2Antwort({ ...TREFFER, angaben: [KERN[0]] }) : v2Antwort(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => a.body.model)).toEqual([MODELL_SCHNELL, MODELL_GRUENDLICH]);
    expect(r.modell).toBe(MODELL_GRUENDLICH);
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v2-text-schnell', 'expose-analyse/v2-text-gruendlich']);

    aufrufe = [];
    antwort = (b) => { if (b.model === MODELL_SCHNELL) throw new Error('529'); return v2Antwort(TREFFER); };
    const r2 = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r2.modell).toBe(MODELL_GRUENDLICH);
    expect(r2.warnungen.join(' ')).toContain('529');
  });

  it('ohne Einheiten trägt Haiku nicht — es sei denn, das Dokument nennt genau eine', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v2Antwort({ angaben: KERN }) : v2Antwort(TREFFER));
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_GRUENDLICH);
    antwort = () => v2Antwort({ angaben: KERN, einheiten_im_dokument: 1 });
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_SCHNELL);
  });

  it('wirft, wenn auch Sonnet nichts liefert — als AnalyseFehler mit Meldung für die Oberfläche', async () => {
    antwort = () => ({ content: [], stop_reason: 'end_turn', usage: USAGE });
    const f = await analysiereExpose(pdf(), 'e.pdf', abh()).catch((e) => e);
    expect(f).toBeInstanceOf(AnalyseFehler);
    expect(f.message).toContain('nichts auslesen');
  });

  it('Nutzungslimit bei Haiku: sofort durchreichen, kein zweiter Versuch mit Sonnet', async () => {
    antwort = () => { throw new KiDienstFehler(400, 'limit', 'Das Nutzungslimit des Anthropic-Kontos ist erreicht'); };
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toMatchObject({ art: 'limit' });
    expect(aufrufe).toHaveLength(1);
  });

  it('Überlast bei Haiku: Sonnet versucht es noch einmal', async () => {
    antwort = (b) => { if (b.model === MODELL_SCHNELL) throw new KiDienstFehler(529, 'ueberlastet', 'überlastet'); return v2Antwort(TREFFER); };
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_GRUENDLICH);
  });
});

describe('Abgeschnittene Antwort (max_tokens)', () => {
  it('wiederholt mit Hinweis ohne Mietliste, holt die Tabellen im Nachfass und bleibt bei Haiku, wenn das Ergebnis trägt', async () => {
    antwort = (b) => {
      if (nurEinheiten(b)) return v2Antwort({ einheiten_tabellen: [tabelle(3)], einheiten_im_dokument: 3, einheiten_vollstaendig: true }, 'end_turn', { input_tokens: 3000, output_tokens: 300 });
      if (letzterText(b) === HINWEIS_WIEDERHOLUNG_V2) return v2Antwort({ angaben: [...KERN, angabe('Lage', 'Ein sehr langer Freitext', 'freitexte.lage')], einheiten_tabellen: [tabelle(2)], einheiten_vollstaendig: false });
      return v2Antwort({ angaben: KERN }, 'max_tokens');
    };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, wiederholung: true, nachfass: true, stopReason: 'end_turn' });
    expect(aufrufe.map((a) => nurEinheiten(a.body))).toEqual([false, false, true]);
    expect(aufrufe[1]!.body.messages[0].content).toHaveLength(2);
    expect(letzterText(aufrufe[2]!.body)).toBe(HINWEIS_NACHFASS_V2);
    expect(aufrufe[2]!.body.messages[0].content[0].text).toContain('──────── Seite 1'); // Nachfass bekommt denselben Inhalt
    expect(r.v2?.einheiten_tabellen).toHaveLength(1);
    expect(r.v2?.einheiten_tabellen[0]!.zeilen).toHaveLength(3); // die Tabelle der Wiederholung wurde verworfen
    expect(r.v2?.angaben.map((x) => x.bezeichnung)).toEqual(['Adresse', 'Kaufpreis', 'Lage']);
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v2-text-schnell', 'expose-analyse/v2-text-schnell-wiederholung', 'expose-analyse/v2-text-schnell-einheiten']);
    expect(r.usage).toEqual({ inputTokens: 5000, outputTokens: 700 });
    expect(r.kostenEur).toBe(+(kostenEur(MODELL_SCHNELL, USAGE) * 2 + kostenEur(MODELL_SCHNELL, { input_tokens: 3000, output_tokens: 300 })).toFixed(4));
    expect(r.warnungen.join(' ')).toContain('max_tokens');
  });

  it('ist auch die Wiederholung abgeschnitten, geht es zu Sonnet — nie stille Teilübernahme', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v2Antwort(TREFFER, 'max_tokens') : v2Antwort(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => a.body.model)).toEqual([MODELL_SCHNELL, MODELL_SCHNELL, MODELL_GRUENDLICH]);
    expect(r).toMatchObject({ modell: MODELL_GRUENDLICH, stopReason: 'end_turn', wiederholung: true, nachfass: false });
  });

  it('eine abgeschnittene Antwort trägt nicht, auch wenn sie Ort, Preis und Einheiten enthält', async () => {
    antwort = (b) => {
      if (b.model === MODELL_GRUENDLICH) return v2Antwort(TREFFER);
      if (nurEinheiten(b)) throw new Error('Nachfass kaputt');
      return letzterText(b) === HINWEIS_WIEDERHOLUNG_V2 ? v2Antwort({ angaben: KERN, einheiten_vollstaendig: false }) : v2Antwort(TREFFER, 'max_tokens');
    };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.modell).toBe(MODELL_GRUENDLICH);
    expect(r.warnungen.join(' ')).toContain('Einheiten-Nachfass fehlgeschlagen: Nachfass kaputt');
  });
});

describe('Nachfass bei unvollständiger Einheitenliste', () => {
  it('meldet die KI weniger Zeilen als das Dokument nennt, ersetzt der Nachfass die Tabellen, wenn er mehr Zeilen liefert', async () => {
    antwort = (b) => (nurEinheiten(b) ? v2Antwort({ einheiten_tabellen: [tabelle(34)], einheiten_im_dokument: 34, einheiten_vollstaendig: true }) : v2Antwort({ ...TREFFER, einheiten_im_dokument: 34, einheiten_vollstaendig: true }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => nurEinheiten(a.body))).toEqual([false, true]);
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, nachfass: true, wiederholung: false });
    expect(einheitenAusTabellen(r.v2!.einheiten_tabellen).einheiten).toHaveLength(34);
    expect(r.v2?.angaben).toHaveLength(2); // die Angaben bleiben aus dem ersten Aufruf
    expect(r.warnungen.join(' ')).toContain('Einheitenliste unvollständig (1 von 34)');
  });

  it('einheiten_vollstaendig = false löst den Nachfass aus; liefert er nicht mehr Zeilen, bleibt die erste Liste', async () => {
    antwort = (b) => (nurEinheiten(b) ? v2Antwort({ einheiten_tabellen: [tabelle(1)] }) : v2Antwort({ ...TREFFER, einheiten_im_dokument: null, einheiten_vollstaendig: false }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe).toHaveLength(2);
    expect(r.nachfass).toBe(false);
    expect(r.v2?.einheiten_tabellen[0]!.zeilen).toHaveLength(1);
    expect(r.v2?.einheiten_vollstaendig).toBe(false);
  });

  it('Summenzeilen zählen nicht als Einheiten', async () => {
    const mitSumme = { ...tabelle(2), zeilen: [...tabelle(2).zeilen, ['Summe', '120 m²', '1.000 €']] };
    antwort = (b) => (nurEinheiten(b) ? v2Antwort({ einheiten_tabellen: [tabelle(3)] }) : v2Antwort({ ...TREFFER, einheiten_tabellen: [mitSumme], einheiten_im_dokument: 3 }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.nachfass).toBe(true); // 2 echte Zeilen < 3 laut Dokument
  });

  it('ein abgeschnittener Nachfass wird nicht übernommen', async () => {
    antwort = (b) => (nurEinheiten(b) ? v2Antwort({ einheiten_tabellen: [tabelle(20)] }, 'max_tokens') : v2Antwort({ ...TREFFER, einheiten_im_dokument: 34 }));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.nachfass).toBe(false);
    expect(r.v2?.einheiten_tabellen[0]!.zeilen).toHaveLength(1);
    expect(r.warnungen.join(' ')).toContain('Einheiten-Nachfass abgeschnitten');
  });

  it('kein Nachfass, wenn die Liste vollständig ist', async () => {
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe).toHaveLength(1);
    expect(r.nachfass).toBe(false);
  });
});

describe('Kostengrenze', () => {
  it('bricht vor dem Sonnet-Aufruf ab, wenn die Schätzung die Grenze überschreitet', async () => {
    antwort = () => v2Antwort({});
    await expect(analysiereExpose(pdf(), 'e.pdf', abh(), { kostenGrenzeEur: 0.01 })).rejects.toThrow(/Kostengrenze 0\.01 € überschritten/);
    expect(aufrufe.map((a) => a.body.model)).toEqual([MODELL_SCHNELL]);
  });

  it('die Standardgrenze von 1 € lässt ein normales Exposé durch; die Schätzung rechnet mit 16000 Ausgabe-Tokens', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? v2Antwort({}) : v2Antwort(TREFFER));
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_GRUENDLICH);
    expect(SCHAETZUNG_AUSGABE_TOKENS).toBe(16_000);
    expect(kostenSchaetzung(MODELL_GRUENDLICH, 400_000)).toBe(kostenEur(MODELL_GRUENDLICH, { input_tokens: 100_000, output_tokens: 16_000 }));
  });
});

describe('Bereinigung', () => {
  it('unbekannte Pfade und Ziele werden null (mit Warnung), leere Angaben fallen weg, nichts wird gekürzt', async () => {
    const lang = 'Lage '.repeat(400).trim();
    antwort = () => v2Antwort({ ...TREFFER, angaben: [...KERN, angabe('X', 'y', 'erfunden.pfad', 1, 'gibts.nicht'), angabe('Leer', '  ', null), angabe('Lage', lang, 'freitexte.lage')], unbekannt: 1 });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(ExposeV2.safeParse(r.v2).success).toBe(true);
    expect(r.v2?.angaben).toHaveLength(4);
    expect(r.v2?.angaben[2]).toMatchObject({ pfad: null, gg: null });
    expect(r.v2?.angaben[3]!.wert).toBe(lang);
    expect((r.v2 as any).unbekannt).toBeUndefined();
    expect(r.warnungen.join(' ')).toContain('Unbekannter Standard-Pfad „erfunden.pfad“');
  });
});

describe('v0 per Option', () => {
  it('liefert das v0-Werkzeug mit denselben Messwerten', async () => {
    antwort = () => ({ content: [{ type: 'tool_use', name: 'extract_expose_data', input: { objekt: { strasse: 'A', angebotspreis: 1 } } }], stop_reason: 'end_turn', usage: USAGE });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh(), { schema: 'v0' });
    expect(r).toMatchObject({ schemaVersion: 'gg-expose-v0', promptVersion: 'v0', stopReason: 'end_turn', modell: MODELL_SCHNELL, nachfass: false, wiederholung: false, warnungen: [] });
    expect(r.v2).toBeUndefined();
    expect(r.extrahiert.objekt.strasse).toBe('A');
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

describe('Attrappe v2 gegen das Test-Exposé', () => {
  const echt = (): AnalyseAbhaengigkeiten => ({ ki: kiAttrappe(), pdfText: (p) => pdfText(Buffer.from(p)), buchen: async (model, _u, quelle) => { gebucht.push({ model, quelle }); } });

  it('die Erfassung besteht das Schema, trägt und ordnet Objekt, Makler, Einheiten und die offenen Angaben zu', async () => {
    const r = await analysiereExpose(testExposeV2('T1'), 't1.pdf', echt());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, seiten: 2, wiederholung: false, nachfass: false, stopReason: 'end_turn', warnungen: [] });
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

  it('„Attrappe: abgeschnitten“: erste Antwort max_tokens, Wiederholung ohne Mietliste; Teil A hat die Einheiten schon, der Nachfass bringt keine längere Liste', async () => {
    const r = await analysiereExpose(testExposeV2('T2', { abgeschnitten: true }), 't2.pdf', echt());
    expect(r).toMatchObject({ modell: MODELL_SCHNELL, wiederholung: true, nachfass: false, stopReason: 'end_turn' });
    expect(gebucht.map((g) => g.quelle)).toEqual(['expose-analyse/v2-text-schnell', 'expose-analyse/v2-text-schnell-wiederholung', 'expose-analyse/v2-text-schnell-einheiten']);
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
