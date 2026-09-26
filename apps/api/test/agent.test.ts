import { createDb, verlangeLokaleDatenbank } from '@gg/db';
import { attrappenModell } from '@cosai/kern';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const offen = { lokalOffen: true, produktion: false, erlaubteEmails: [] };

describe('AgentMode ohne Modell', () => {
  it('meldet /api/agent/stand als nicht verfügbar', async () => {
    const app = createApp({ db: null as never, auth: offen });
    const res = await app.request('/api/agent/stand');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { verfuegbar: boolean }).verfuegbar).toBe(false);
  });
});

describe.skipIf(!url)('AgentMode mit Attrappe', () => {
  const { db, client } = url ? createDb(url) : ({} as ReturnType<typeof createDb>);
  afterAll(async () => { await client?.end(); });
  const app = url ? createApp({ db, auth: offen, agent: { modell: attrappenModell() } }) : (null as never);
  const post = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('kennt die Oberflächenkarte und die lesenden Werkzeuge der eigenen API', async () => {
    const stand = (await (await app.request('/api/agent/stand')).json()) as { werkzeuge: number; ziele: number; modell: string };
    expect(stand.modell).toBe('attrappe');
    expect(stand.werkzeuge).toBeGreaterThan(50);
    expect(stand.ziele).toBeGreaterThan(15);
  });

  it('liest das Cockpit in-process im Namen des Nutzers und fasst zusammen', async () => {
    const res = await post('/api/agent/nachricht', { text: 'Was ist heute fällig?', ort: '/' });
    expect(res.status).toBe(200);
    const a = (await res.json()) as { text: string; chips: { label: string }[] };
    expect(a.text).toMatch(/^Heute sind \d+ Deals und \d+ Makler fällig\./);
    expect(a.chips.map((c) => c.label)).toContain('Ersten Deal öffnen');
  });

  it('erfasst eine Notiz sichtbar über die Oberfläche und wartet vor dem Abschicken', async () => {
    const a = (await (await post('/api/agent/nachricht', { text: 'Ankauf, erster Deal, Kommentar: Mailbox besprochen, Rückruf Montag. Abschicken.', ort: '/' })).json()) as { sitzungId: string; steuerung: { art: string; ziel: string; wert?: string }[]; wartetAuf?: { aktion: { ziel: string } } };
    expect(a.steuerung.map((s) => `${s.art} ${s.ziel}`)).toEqual(['navigiere nav.ankauf', 'oeffne ankauf.deals.erster', 'oeffne deal.reiter.kommunikation', 'fuelle deal.kommentar.text']);
    expect(a.steuerung[3]?.wert).toBe('Mailbox besprochen, Rückruf Montag');
    expect(a.wartetAuf?.aktion.ziel).toBe('deal.kommentar.senden');
    const b = (await (await post('/api/agent/entscheidung', { sitzungId: a.sitzungId, wert: 'ja' })).json()) as { steuerung: { art: string }[]; text: string };
    expect(b.steuerung.map((s) => s.art)).toEqual(['sende']);
    expect(b.text).toBe('Erledigt — gespeichert.');
  });
});
