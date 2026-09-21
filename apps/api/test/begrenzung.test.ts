import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { begrenzung } from '../src/middleware/begrenzung.ts';

describe('Begrenzung', () => {
  it('lässt max Anfragen je Fenster durch, danach 429 mit Retry-After — und nach dem Fenster wieder', async () => {
    let t = 1_000_000;
    const app = new Hono();
    app.use('/teuer', begrenzung({ fensterMs: 60_000, max: 3, meldung: 'zu viel' }, () => t));
    app.get('/teuer', (c) => c.text('ok'));
    const ruf = (token = 'a') => app.request('/teuer', { headers: { authorization: `Bearer ${token}` } });
    for (let i = 0; i < 3; i++) expect((await ruf()).status).toBe(200);
    const zu = await ruf();
    expect(zu.status).toBe(429);
    expect(await zu.json()).toEqual({ fehler: 'zu viel' });
    expect(Number(zu.headers.get('retry-after'))).toBe(60);
    expect((await ruf('anderer-nutzer')).status).toBe(200); // je Anmeldung gezählt
    t += 60_001;
    expect((await ruf()).status).toBe(200);
  });
});
