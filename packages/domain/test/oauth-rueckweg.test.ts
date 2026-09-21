import { describe, expect, it } from 'vitest';
import { rueckwegPruefen, rueckwegRegelnAusUmgebung } from '../src/index.ts';

const lokal = { online: false, erlaubteHosts: [] };
const online = rueckwegRegelnAusUmgebung({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'gg.example.app', VERCEL_URL: 'gg-abc123.vercel.app', OAUTH_HOSTS: 'https://app.kunde.example/irgendwas, 192.168.178.20:5273' });

describe('Rücksprung-Adresse der Microsoft-Anmeldung', () => {
  it('lokal: Loopback und Heimnetz gehen ohne Eintrag, auch mit http', () => {
    expect(rueckwegPruefen('http://localhost:5273/m365/rueckweg', lokal)).toEqual({ ok: true, uri: 'http://localhost:5273/m365/rueckweg' });
    expect(rueckwegPruefen('http://192.168.178.20:5273/m365/rueckweg', lokal).ok).toBe(true);
    expect(rueckwegPruefen('http://100.100.1.2:5273/m365/rueckweg', lokal).ok).toBe(true);
  });

  it('lokal: eine fremde Adresse geht trotzdem nicht', () => {
    const r = rueckwegPruefen('https://boese.example/m365/rueckweg', lokal);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.grund).toContain('OAUTH_HOSTS');
  });

  it('online zählt nur die Liste: eigene Vercel-Domains und OAUTH_HOSTS (auch als kopierte URL)', () => {
    expect(online.erlaubteHosts).toEqual(['gg.example.app', 'gg-abc123.vercel.app', 'app.kunde.example', '192.168.178.20:5273']);
    expect(rueckwegPruefen('https://gg.example.app/m365/rueckweg', online).ok).toBe(true);
    expect(rueckwegPruefen('https://app.kunde.example/m365/rueckweg', online).ok).toBe(true);
    expect(rueckwegPruefen('https://localhost:5273/m365/rueckweg', online).ok).toBe(false);
    expect(rueckwegPruefen('https://gg.example.app.boese.example/m365/rueckweg', online).ok).toBe(false);
  });

  it('online nur https; ein Eintrag mit Port passt nur auf genau diesen Port', () => {
    expect(rueckwegPruefen('http://gg.example.app/m365/rueckweg', online).ok).toBe(false);
    expect(rueckwegPruefen('https://192.168.178.20:5273/m365/rueckweg', online).ok).toBe(true);
    expect(rueckwegPruefen('https://192.168.178.20:9999/m365/rueckweg', online).ok).toBe(false);
  });

  it('nur genau der Rückweg-Pfad — kein anderer Pfad, keine Parameter, keine Zugangsdaten in der Adresse', () => {
    for (const a of ['http://localhost:5273/', 'http://localhost:5273/m365/rueckweg/x', 'http://localhost:5273/m365/rueckweg?weiter=https://boese.example',
      'http://localhost:5273/m365/rueckweg#x', 'http://nutzer:pw@localhost:5273/m365/rueckweg', 'javascript:alert(1)', 'kein-url']) {
      expect(rueckwegPruefen(a, lokal).ok, a).toBe(false);
    }
  });

  it('ohne VERCEL zählen die Vercel-Variablen nicht', () => {
    expect(rueckwegRegelnAusUmgebung({ VERCEL_URL: 'x.vercel.app' })).toEqual({ online: false, erlaubteHosts: [] });
  });
});
