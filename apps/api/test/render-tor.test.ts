// Port der renderTor-Tests aus gg-immohandel server/render-schleuse.test.ts, für Hono.
import { erzeugeSchleuse } from '@gg/documents/pdf';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { renderTor } from '../src/middleware/render-tor.ts';

const gleich = () => new Promise((r) => setImmediate(r));

/** Route, deren „Rendern“ erst endet, wenn der Test es erlaubt. */
function aufbau(opt: { maxParallel: number; maxWartend: number; wartezeitMs: number }) {
  const s = erzeugeSchleuse(opt);
  const gestartet: string[] = [];
  const fertig = new Map<string, () => void>();
  const app = new Hono();
  app.get('/pdf/:n', renderTor(s), async (c) => {
    const n = c.req.param('n');
    gestartet.push(n);
    await new Promise<void>((r) => fertig.set(n, r));
    return c.text('%PDF');
  });
  return { s, app, gestartet, fertig };
}

describe('renderTor (Hono)', () => {
  it('gibt den Platz frei, wenn ein Wartender den Tab schließt', async () => {
    const { s, app, gestartet, fertig } = aufbau({ maxParallel: 1, maxWartend: 4, wartezeitMs: 5000 });
    const a = app.request('/pdf/a');
    await gleich();
    expect(gestartet).toEqual(['a']);
    expect(s.laufend()).toBe(1);

    const abbruchB = new AbortController();
    const b = app.request('/pdf/b', { signal: abbruchB.signal });
    await gleich();
    expect(s.wartend()).toBe(1);

    abbruchB.abort();
    expect((await b).status).toBe(499); // keine 503 auf eine tote Leitung
    expect(s.wartend()).toBe(0);
    expect(gestartet).toEqual(['a']); // ein toter Request startet kein Chromium

    fertig.get('a')!();
    expect((await a).status).toBe(200);
    expect(s.laufend()).toBe(0);

    const c = app.request('/pdf/c');
    await gleich();
    expect(gestartet).toEqual(['a', 'c']);
    fertig.get('c')!();
    await c;
    expect(s.laufend()).toBe(0);
  });

  it('startet keinen Render, wenn die Anfrage beim Zuschlag schon abgebrochen ist', async () => {
    const { s, app, gestartet } = aufbau({ maxParallel: 1, maxWartend: 1, wartezeitMs: 1000 });
    const abbruch = new AbortController();
    abbruch.abort();
    expect((await app.request('/pdf/x', { signal: abbruch.signal })).status).toBe(499);
    expect(gestartet).toEqual([]);
    expect(s.laufend()).toBe(0);
  });

  it('antwortet mit 503 und Retry-After, wenn die Schleuse wirklich voll ist', async () => {
    const { s, app, gestartet } = aufbau({ maxParallel: 1, maxWartend: 0, wartezeitMs: 1000 });
    await s.betrete();
    const res = await app.request('/pdf/x');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as { details: { quelle: string } }).details.quelle).toBe('render-schleuse');
    expect(gestartet).toEqual([]);
  });

  it('gibt den Platz auch frei, wenn das Rendern scheitert', async () => {
    const s = erzeugeSchleuse({ maxParallel: 1, maxWartend: 0, wartezeitMs: 1000 });
    const app = new Hono();
    app.get('/pdf', renderTor(s), () => { throw new Error('Chrome weg'); });
    expect((await app.request('/pdf')).status).toBe(500);
    expect(s.laufend()).toBe(0);
  });
});
