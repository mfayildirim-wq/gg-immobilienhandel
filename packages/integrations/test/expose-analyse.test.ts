// Tests nach gg-immohandel server/expose-analyse.test.ts (Wegwahl, Textweg, Bildweg, Kosten, Anfrageform, ergebnisTraegt),
// umgestellt von Modul-Mocks auf übergebene Abhängigkeiten. Routentests (Eingangsschlüssel, Signatur) liegen in apps/api.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  analysiereExpose, anfrage, type AnalyseAbhaengigkeiten, ergebnisTraegt, INLINE_MAX_BYTES, istPdf, MAX_PDF_SEITEN, MODELL_GRUENDLICH, MODELL_SCHNELL,
} from '../src/index.ts';
import type { PdfTextResult } from '../src/pdf/text.ts';

let aufrufe: any[] = [];
let uploads: { name: string; bytes: number }[] = [];
let geloescht: string[] = [];
let gebucht: { model: string; quelle: string }[] = [];
let antwort: (body: any) => any;
let gelesen: PdfTextResult;

const TREFFER = { objekt: { strasse: 'Musterweg', angebotspreis: 500000 } };
const tool = (input: any) => ({ content: [{ type: 'tool_use', name: 'extract_expose_data', input }], usage: { input_tokens: 1000, output_tokens: 200 } });

const abh = (): AnalyseAbhaengigkeiten => ({
  ki: {
    nachricht: async (body) => { aufrufe.push(body); return antwort(body); },
    dateiHochladen: async (bytes, name) => { uploads.push({ name, bytes: bytes.byteLength }); return 'file_abc'; },
    dateiLoeschen: async (id) => { geloescht.push(id); },
  },
  pdfText: async () => gelesen,
  buchen: async (model, _u, quelle) => { gebucht.push({ model, quelle }); },
});

const text = (seiten: number, zeichenJeSeite: number, gelesenSeiten = seiten): PdfTextResult => ({
  text: 'x'.repeat(zeichenJeSeite * gelesenSeiten), pageCount: gelesenSeiten, seitenGesamt: seiten, charsTotal: zeichenJeSeite * gelesenSeiten,
});
const pdf = (bytes = 1000) => new Uint8Array(bytes);

beforeEach(() => {
  aufrufe = []; uploads = []; geloescht = []; gebucht = [];
  antwort = () => tool(TREFFER);
  gelesen = text(10, 800);
});

describe('Wegwahl', () => {
  it('digitales Exposé: Text an das billige Modell', async () => {
    antwort = () => tool({ objekt: { strasse: 'A', angebotspreis: 1, einheiten: [{}] } });
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'text', modell: MODELL_SCHNELL });
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0].messages[0].content[0].type).toBe('text');
  });

  it('ein Scan geht als PDF, nicht als Bilderreihe', async () => {
    gelesen = { text: '', pageCount: 30, seitenGesamt: 30, charsTotal: 0 };
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(r).toMatchObject({ modus: 'pdf', modell: MODELL_GRUENDLICH, seiten: 30 });
    expect(aufrufe[0].messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
  });

  it('ein Deckblatt mit Text ist noch kein Text-Layer', async () => {
    gelesen = { text: 'x'.repeat(150), pageCount: 1, seitenGesamt: 1, charsTotal: 150 };
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modus).toBe('pdf');
  });
});

describe('Textweg', () => {
  it('schlägt auf das starke Modell nach, wenn das billige zu wenig findet', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? tool({ objekt: { strasse: 'nur Ort' } }) : tool(TREFFER));
    const r = await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(aufrufe.map((a) => a.model)).toEqual([MODELL_SCHNELL, MODELL_GRUENDLICH]);
    expect(r.modell).toBe(MODELL_GRUENDLICH);
  });

  it('ein Fehler des billigen Versuchs beendet die Analyse nicht', async () => {
    antwort = (b) => { if (b.model === MODELL_SCHNELL) throw new Error('529'); return tool(TREFFER); };
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).modell).toBe(MODELL_GRUENDLICH);
  });

  it('sagt es, wenn nicht alle Seiten gelesen wurden', async () => {
    gelesen = text(80, 800, 50);
    antwort = () => tool({ objekt: { strasse: 'A', angebotspreis: 1 } });
    expect((await analysiereExpose(pdf(), 'e.pdf', abh())).hinweis).toBe('Ausgewertet wurden die ersten 50 von 80 Seiten.');
  });
});

describe('Bildweg — Größe und Grenzen', () => {
  beforeEach(() => { gelesen = { text: '', pageCount: 5, seitenGesamt: 5, charsTotal: 0 }; });

  it('ein großes PDF wird hochgeladen statt eingebettet und danach gelöscht', async () => {
    await analysiereExpose(pdf(INLINE_MAX_BYTES + 1), 'gross.pdf', abh());
    expect(uploads).toEqual([{ name: 'gross.pdf', bytes: INLINE_MAX_BYTES + 1 }]);
    expect(aufrufe[0].messages[0].content[0].source).toEqual({ type: 'file', file_id: 'file_abc' });
    expect(geloescht).toEqual(['file_abc']);
  });

  it('räumt die Datei auch weg, wenn die Auswertung scheitert', async () => {
    antwort = () => ({ content: [] });
    await expect(analysiereExpose(pdf(INLINE_MAX_BYTES + 1), 'gross.pdf', abh())).rejects.toThrow('nichts auslesen');
    expect(geloescht).toEqual(['file_abc']);
  });

  it('lehnt ein Dokument jenseits der Seitengrenze mit einer Meldung ab, die weiterhilft', async () => {
    gelesen = { text: '', pageCount: 50, seitenGesamt: MAX_PDF_SEITEN + 1, charsTotal: 0 };
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toThrow('ohne Anhänge');
  });

  it('sagt es, wenn sich das PDF nicht öffnen ließ', async () => {
    gelesen = { text: '', pageCount: 0, seitenGesamt: 0, charsTotal: 0, grund: 'Invalid PDF structure' };
    await expect(analysiereExpose(pdf(), 'e.pdf', abh())).rejects.toThrow('Invalid PDF structure');
  });
});

describe('Kosten', () => {
  it('bucht beide Aufrufe, wenn nachgeschlagen wird', async () => {
    antwort = (b) => (b.model === MODELL_SCHNELL ? tool({}) : tool(TREFFER));
    await analysiereExpose(pdf(), 'e.pdf', abh());
    expect(gebucht).toEqual([
      { model: MODELL_SCHNELL, quelle: 'expose-analyse/text-schnell' },
      { model: MODELL_GRUENDLICH, quelle: 'expose-analyse/text-gruendlich' },
    ]);
  });
});

describe('Anfrageform', () => {
  it('erzwingt das Tool und markiert Anweisung und Schema als zwischenspeicherbar', () => {
    const a = anfrage('m', []);
    expect(a.tool_choice).toEqual({ type: 'tool', name: 'extract_expose_data' });
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('ergebnisTraegt', () => {
  it('zwei von drei Kernsignalen reichen, eines nicht, nichts ist nichts', () => {
    expect(ergebnisTraegt({ objekt: { stadt: 'Ulm', angebotspreis: 1 } })).toBe(true);
    expect(ergebnisTraegt({ objekt: { stadt: 'Ulm' } })).toBe(false);
    expect(ergebnisTraegt(null)).toBe(false);
  });
});

describe('istPdf', () => {
  it('erkennt die Signatur, nicht den Dateinamen', () => {
    expect(istPdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(istPdf(new Uint8Array([80, 75, 3, 4, 20]))).toBe(false);
  });
});
