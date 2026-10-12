// Exposé-Erfassung v3 (Protokoll 30, P1): Dokument ohne KI → Rohdaten im Code; KI nur für Teil A (bisheriger Aufruf,
// auf dem Dokument-Text) und für unbekannte Bezeichnungen (kleiner Aufruf); Einheiten-Nachfass wie in der alten App.
import { DOKUMENT_VERSION, type Dokument, type ErfassteAngabe } from '@gg/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnalyseFehler, analysiereExpose, type AnalyseAbhaengigkeiten, BEZEICHNUNGEN_TOOL_NAME, bezeichnungenZuordnen, einheitenAusNachfass, KiDienstFehler,
  kostenEur, MODELL_GRUENDLICH, MODELL_SCHNELL, PROMPT_VERSION_V2,
} from '../src/index.ts';
import { SYSTEM_PROMPT } from '../src/expose/prompt.ts';
import type { PdfTextResult } from '../src/pdf/text.ts';

let aufrufe: any[] = [];
let gebucht: string[] = [];
let antwort: (body: any) => any;
let dok: Dokument;

const USAGE = { input_tokens: 1000, output_tokens: 200 };
const TEIL_A = { objekt: { strasse: 'Musterweg', hausnr: '1', plz: '89073', stadt: 'Ulm', angebotspreis: 500000, einheiten: [{ typ: 'Wohnung', lage: 'EG', flaeche: 60, kaltmiete: 500 }] }, makler: { name: 'Anna' }, kalkulation: { kaufpreis: 500000 }, _konfidenz: {} };
const aAntwort = (input: unknown = TEIL_A) => ({ content: [{ type: 'tool_use', name: 'extract_expose_data', input }], stop_reason: 'tool_use', usage: USAGE });
const istA = (b: any) => b.tools?.[0]?.name === 'extract_expose_data';
const istBez = (b: any) => b.tools?.[0]?.name === BEZEICHNUNGEN_TOOL_NAME;
const zeile = (text: string) => [text];
const textSeite = (nr: number, n = 30): Dokument['seiten'][number] => ({ nr, typ: 'text', zeilen: Array.from({ length: n }, (_, i) => zeile(`Zeile ${i} mit ausreichend Text für die Seite ${nr}`)), ocr: null });

const abh = (): AnalyseAbhaengigkeiten => ({
  ki: { nachricht: async (body) => { aufrufe.push(body); return antwort(body); }, dateiHochladen: async () => 'file_abc', dateiLoeschen: async () => {} },
  pdfText: async (): Promise<PdfTextResult> => ({ text: '', pageCount: dok.seiten.length, seitenGesamt: dok.seitenGesamt, charsTotal: 0 }),
  dokument: async () => dok,
  buchen: async (_m, _u, quelle) => { gebucht.push(quelle); },
});
const pdf = () => new Uint8Array(1000);

beforeEach(() => {
  aufrufe = []; gebucht = [];
  antwort = () => aAntwort();
  dok = { version: DOKUMENT_VERSION, seitenGesamt: 3, seiten: [textSeite(1), textSeite(2), textSeite(3)] };
});

describe('Analyse v3', () => {
  it('Teil A ist der Aufruf von main auf dem Dokument-Text; das Dokument wird gespeichert; keine KI-Vollerfassung', async () => {
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    const a = aufrufe.find(istA);
    expect(a).toMatchObject({ model: MODELL_SCHNELL, max_tokens: 4096, system: [{ text: SYSTEM_PROMPT }] });
    expect(a.messages[0].content[0].text).toContain('──────── Seite 2');
    expect(aufrufe.every((b) => istA(b) || istBez(b))).toBe(true);
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL, schemaVersion: 'gg-expose-v2', promptVersion: PROMPT_VERSION_V2, nachfass: false });
    expect(PROMPT_VERSION_V2).toBe('v3.0');
    expect(r.v2?.dokument).toEqual(dok);
    expect(r.v2?.felder).toMatchObject({ objekt: { stadt: 'Ulm' } });
    expect(r.seitenTexte).toHaveLength(3);
    expect(r.kostenEur).toBeGreaterThanOrEqual(kostenEur(MODELL_SCHNELL, USAGE));
  });

  it('Scan ohne lesbaren Text: Teil A liest das PDF mit dem gründlichen Modell (wie main)', async () => {
    dok = { version: DOKUMENT_VERSION, seitenGesamt: 2, seiten: [{ nr: 1, typ: 'bild', zeilen: [], ocr: null }, { nr: 2, typ: 'bild', zeilen: [], ocr: null }] };
    const r = await analysiereExpose(pdf(), 'scan.pdf', abh());
    expect(r).toMatchObject({ modus: 'pdf', modell: MODELL_GRUENDLICH });
    expect(aufrufe.find(istA).messages[0].content[0].type).toBe('document');
  });

  it('per Texterkennung gelesene Seiten werden gemeldet; mehr Seiten als gelesen → Hinweis', async () => {
    dok = { ...dok, seitenGesamt: 80, seiten: [...dok.seiten, { nr: 4, typ: 'bild', zeilen: [zeile('Kaufpreis: 1.000 €')], ocr: { sicherheit: 88, woerter: 3 } }] };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r.warnungen).toContain('1 Bild-Seite(n) per Texterkennung gelesen');
    expect(r.hinweis).toBe('Ausgewertet wurden die ersten 4 von 80 Seiten.');
  });

  it('Nutzungslimit: sofort durchreichen; Teil A ohne Ergebnis: AnalyseFehler', async () => {
    antwort = () => { throw new KiDienstFehler(400, 'limit', 'Limit'); };
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toMatchObject({ art: 'limit' });
    antwort = () => ({ content: [], stop_reason: 'end_turn', usage: USAGE });
    expect(await analysiereExpose(pdf(), 'e.pdf', abh()).catch((e) => e)).toBeInstanceOf(AnalyseFehler);
  });

  it('Einheiten-Stellplatzzeilen mit Stückzahl werden einzelne Einheiten', () => {
    expect(einheitenAusNachfass([{ typ: 'Stellplatz', lage: 'TG', stk: 2, kaltmiete: 60 }])).toHaveLength(2);
  });
});

describe('bezeichnungenZuordnen', () => {
  const A = (bezeichnung: string, wert: string, pfad: string | null = null, gg: string | null = null): ErfassteAngabe => ({ bezeichnung, wert, seite: 1, pfad, kontakt: null, gg });
  const ki = (input: unknown) => ({ nachricht: async (body: any) => { aufrufe.push(body); return { content: [{ type: 'tool_use', name: BEZEICHNUNGEN_TOOL_NAME, input }], usage: USAGE }; }, dateiHochladen: async () => '', dateiLoeschen: async () => {} });
  const vermerke = async (_m: string, _u: unknown, q: string) => { gebucht.push(q); };

  it('fragt nur unbekannte Bezeichnungen, je Bezeichnung einmal; übernimmt nur gültige Pfade und Ziele', async () => {
    const angaben = [A('Kaufpreis', '1 €', 'preise.kaufpreis'), A('Rücklage', '12.000 €'), A('Rücklage', '12.000 €'), A('Besichtigung', 'nach Vereinbarung'), A('X', 'y', null, 'details.titel')];
    const r = await bezeichnungenZuordnen(ki({ zuordnungen: [{ nr: 1, pfad: 'preise.instandhaltungsruecklage', gg: 'details.instandhaltungsruecklage' }, { nr: 2, pfad: 'erfunden', gg: 'auch.erfunden' }] }), angaben, vermerke);
    expect(aufrufe[0].messages[0].content[0].text).toBe('1. Rücklage = 12.000 €\n2. Besichtigung = nach Vereinbarung');
    expect(aufrufe[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect([...r!.entries()]).toEqual([[1, { pfad: 'preise.instandhaltungsruecklage', gg: 'details.instandhaltungsruecklage' }], [2, { pfad: 'preise.instandhaltungsruecklage', gg: 'details.instandhaltungsruecklage' }]]);
    expect(gebucht).toEqual(['expose-analyse/bezeichnungen']);
  });

  it('nichts zu fragen → kein Aufruf', async () => {
    expect(await bezeichnungenZuordnen(ki({ zuordnungen: [] }), [A('Kaufpreis', '1 €', 'preise.kaufpreis')], vermerke)).toBeNull();
    expect(aufrufe).toHaveLength(0);
  });
});
