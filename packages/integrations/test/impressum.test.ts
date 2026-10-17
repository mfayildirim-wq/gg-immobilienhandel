import { describe, expect, it } from 'vitest';
import { FIRMENDATEN_TOOL, firmendatenDeuten, firmendatenErmitteln, impressumHolen, kiAttrappe, type KiClient } from '../src/index.ts';

/** Firmendaten aus dem Impressum (Baustein B, 17.10.2026): Abruf mit Ersatz-fetch, Deutung mit Attrappe und Ersatz-KI. */
const IMPRESSUM = `<html><body><h1>Impressum</h1><p>Angaben gemäß § 5 TMG</p><p>Beispiel Immobilien GmbH<br>Königstraße 12a<br>70173 Stuttgart</p>
<p>Telefon: 0711 123456-0<br>Fax: 0711 123456-9<br>E-Mail: info(at)beispiel-immo.test</p><p>Vertreten durch: Max Beispiel</p></body></html>`;
const START = '<html><body><nav><a href="/team">Team</a><a href="/rechtliches/anbieter">Impressum</a></nav><p>Willkommen bei Beispiel Immobilien</p></body></html>';

function abrufAus(seiten: Record<string, string | { status?: number; body?: string; typ?: string; endUrl?: string }>, protokoll: string[] = []): typeof fetch {
  return (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    protokoll.push(url);
    const s = seiten[url];
    if (s === undefined) return new Response('nicht da', { status: 404 });
    const e = typeof s === 'string' ? { body: s } : s;
    const r = new Response(e.body ?? '', { status: e.status ?? 200, headers: { 'content-type': e.typ ?? 'text/html; charset=utf-8' } });
    if (e.endUrl) Object.defineProperty(r, 'url', { value: e.endUrl });
    return r;
  }) as typeof fetch;
}

describe('Impressum holen', () => {
  it('nimmt den ersten üblichen Pfad, der wie ein Impressum spricht', async () => {
    const protokoll: string[] = [];
    const abruf = abrufAus({ 'https://beispiel-immo.test/impressum': IMPRESSUM }, protokoll);
    const s = await impressumHolen('beispiel-immo.test', { abruf });
    expect(s?.url).toBe('https://beispiel-immo.test/impressum');
    expect(s?.text).toContain('Beispiel Immobilien GmbH\nKönigstraße 12a\n70173 Stuttgart');
    expect(protokoll).toEqual(['https://beispiel-immo.test/impressum']);
  });

  it('überspringt 200er ohne Impressum-Inhalt, folgt dem Link „Impressum“ von der Startseite, auch mit www.', async () => {
    const protokoll: string[] = [];
    const abruf = abrufAus({
      'https://beispiel-immo.test/impressum': '<html><body>Willkommen! Hier entsteht etwas Neues.</body></html>',
      'https://www.beispiel-immo.test/': START,
      'https://www.beispiel-immo.test/rechtliches/anbieter': IMPRESSUM,
    }, protokoll);
    const s = await impressumHolen('beispiel-immo.test', { abruf });
    expect(s?.url).toBe('https://www.beispiel-immo.test/rechtliches/anbieter');
    expect(protokoll.at(-1)).toBe('https://www.beispiel-immo.test/rechtliches/anbieter');
  });

  it('nimmt 443 nichts an, leitet http auf eine andere Adresse um: der Umleitung folgen, dort den Link suchen', async () => {
    const protokoll: string[] = [];
    const abruf = abrufAus({
      'http://kurz.test/': { body: START.replace('/rechtliches/anbieter', 'https://www.lang-immobilien.test/impressum'), endUrl: 'https://www.lang-immobilien.test/de/home.html' },
      'https://www.lang-immobilien.test/impressum': IMPRESSUM,
    }, protokoll);
    const s = await impressumHolen('kurz.test', { abruf });
    expect(s?.url).toBe('https://www.lang-immobilien.test/impressum');
    expect(protokoll.at(-2)).toBe('http://kurz.test/');
  });

  it('null ohne Impressum; kein Abruf interner Ziele; Umleitung ins Interne und Nicht-HTML werden verworfen', async () => {
    expect(await impressumHolen('beispiel-immo.test', { abruf: abrufAus({}) })).toBeNull();
    const protokoll: string[] = [];
    expect(await impressumHolen('localhost', { abruf: abrufAus({ 'https://localhost/impressum': IMPRESSUM }, protokoll) })).toBeNull();
    expect(protokoll).toEqual([]);
    expect(await impressumHolen('beispiel-immo.test', { abruf: abrufAus({ 'https://beispiel-immo.test/impressum': { body: IMPRESSUM, endUrl: 'http://169.254.169.254/latest' } }) })).toBeNull();
    expect(await impressumHolen('beispiel-immo.test', { abruf: abrufAus({ 'https://beispiel-immo.test/impressum': { body: IMPRESSUM, typ: 'application/pdf' } }) })).toBeNull();
  });
});

describe('Firmendaten deuten und ermitteln', () => {
  it('Werkzeugaufruf mit dem Impressum-Text, Antwort aus dem Werkzeugblock; Regel und KI zusammengeführt', async () => {
    const gesendet: any[] = [];
    const ki: KiClient = {
      ...kiAttrappe(),
      async nachricht(b: any) {
        gesendet.push(b);
        return { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'Ich trage ein.' }, { type: 'tool_use', name: 'firmendaten_speichern', input: { name: 'Beispiel Immobilien GmbH', rechtsform: 'GmbH', strasse: null, plz: null, ort: null, tel: '0711 123456-0', fax: null, email: 'info@beispiel-immo.test' } }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
    const e = await firmendatenErmitteln('beispiel-immo.test', ki, { abruf: abrufAus({ 'https://beispiel-immo.test/impressum': IMPRESSUM }) });
    expect(e.gefunden).toBe(true);
    if (!e.gefunden) return;
    expect(e.url).toBe('https://beispiel-immo.test/impressum');
    expect(e.felder).toEqual({ name: 'Beispiel Immobilien GmbH', rechtsform: 'GmbH', strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart', tel: '0711 123456-0', fax: '0711 123456-9', email: 'info@beispiel-immo.test' });
    expect(e.ki?.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(gesendet[0].tools[0]).toBe(FIRMENDATEN_TOOL);
    expect(gesendet[0].messages[0].content).toContain('Domain: beispiel-immo.test');
    expect(gesendet[0].messages[0].content).toContain('Königstraße 12a');
  });

  it('ohne KI gilt die Regel; ein KI-Fehler lässt das Ergebnis nicht scheitern; ohne Impressum ein Grund', async () => {
    const abruf = abrufAus({ 'https://beispiel-immo.test/impressum': IMPRESSUM });
    const ohne = await firmendatenErmitteln('beispiel-immo.test', null, { abruf });
    expect(ohne.gefunden && ohne.felder.name).toBe('Beispiel Immobilien GmbH');
    expect(ohne.gefunden && ohne.ki).toBeNull();
    const kaputt: KiClient = { ...kiAttrappe(), async nachricht() { throw new Error('Anthropic 529'); } };
    const trotzdem = await firmendatenErmitteln('beispiel-immo.test', kaputt, { abruf });
    expect(trotzdem.gefunden && trotzdem.felder.ort).toBe('Stuttgart');
    const nichts = await firmendatenErmitteln('leer.test', kaputt, { abruf });
    expect(nichts).toEqual({ gefunden: false, grund: 'Kein Impressum unter leer.test gefunden' });
  });

  it('Attrappe liest „Feld: Wert“-Zeilen aus dem Impressum-Text', async () => {
    const a = await firmendatenDeuten(kiAttrappe(), 'Impressum\nFirma: Test Makler UG (haftungsbeschränkt)\nStraße: Weg 1\nPLZ: 70173\nOrt: Stuttgart\nE-Mail: info@test-makler.test', 'test-makler.test');
    expect(a.wert).toEqual({ name: 'Test Makler UG (haftungsbeschränkt)', rechtsform: 'UG (haftungsbeschränkt)', strasse: 'Weg 1', plz: '70173', ort: 'Stuttgart', tel: null, fax: null, email: 'info@test-makler.test' });
    expect((await firmendatenDeuten(kiAttrappe(), 'nichts', 'x.test')).wert).toMatchObject({ name: null, email: null });
  });
});
