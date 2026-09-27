import { describe, expect, it } from 'vitest';
import { seiteLesen } from '../src/web/seiteLesen.ts';

const antwort = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
const oeffentlich = async () => ['93.184.216.34'];

describe('seiteLesen', () => {
  it('liefert den lesbaren Text einer öffentlichen Seite — ohne Skripte, Stile und Tags', async () => {
    const html = '<html><head><title>Inserat 3-Zimmer</title><style>p{}</style><script>alert(1)</script></head><body><h1>3 Zimmer, 78 m²</h1><p>Kaufpreis&nbsp;349.000&nbsp;&euro; &amp; provisionsfrei</p></body></html>';
    const text = await seiteLesen('https://example.org/inserat', { abruf: async () => antwort(html), aufloesen: oeffentlich });
    expect(text).toContain('Inserat 3-Zimmer');
    expect(text).toContain('3 Zimmer, 78 m²');
    expect(text).toContain('Kaufpreis 349.000 € & provisionsfrei');
    expect(text).not.toMatch(/alert|<|p\\{\\}/);
  });

  it('öffnet keine internen Adressen — weder direkt noch über den Namen noch über eine Weiterleitung', async () => {
    const abruf = async () => antwort('geheim');
    await expect(seiteLesen('http://169.254.169.254/latest/meta-data', { abruf, aufloesen: oeffentlich })).rejects.toThrow(/intern/);
    await expect(seiteLesen('https://metadaten.example.org/', { abruf, aufloesen: async () => ['169.254.169.254'] })).rejects.toThrow(/intern/);
    await expect(seiteLesen('https://doppelt.example.org/', { abruf, aufloesen: async () => ['93.184.216.34', '10.0.0.5'] })).rejects.toThrow(/intern/);
    const umleitung = async (url: string | URL | Request) => String(url).includes('start')
      ? new Response('', { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })
      : antwort('geheim');
    await expect(seiteLesen('https://example.org/start', { abruf: umleitung, aufloesen: oeffentlich })).rejects.toThrow(/intern/);
    await expect(seiteLesen('file:///etc/passwd', { abruf, aufloesen: oeffentlich })).rejects.toThrow();
  });

  it('liest nur Text (HTML, Klartext, JSON) und meldet anderes', async () => {
    await expect(seiteLesen('https://example.org/bild.png', { abruf: async () => new Response('x', { headers: { 'content-type': 'image/png' } }), aufloesen: oeffentlich })).rejects.toThrow(/kein Text/);
  });
});
