import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicClient, anthropicSchluesselPruefen, KiDienstFehler, kiFehlerDeuten, KiSchluesselFehler } from '../src/index.ts';

const antwort = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UNGUELTIG = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };

afterEach(() => vi.unstubAllGlobals());

describe('anthropicClient: abgelehnter Schlüssel wird erkennbar', () => {
  it('401 bei Nachricht und Upload → KiSchluesselFehler (nicht mehr ein beliebiger Fehler)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => antwort(401, UNGUELTIG)));
    const ki = anthropicClient('sk-ant-falsch');
    await expect(ki.nachricht({})).rejects.toBeInstanceOf(KiSchluesselFehler);
    await expect(ki.dateiHochladen(new Uint8Array([1]), 'x.pdf')).rejects.toBeInstanceOf(KiSchluesselFehler);
  });
  it('andere Fehler → KiDienstFehler mit Art und verständlicher Meldung', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => antwort(529, { error: { type: 'overloaded_error' } })));
    const fehler = await anthropicClient('sk').nachricht({}).catch((e) => e);
    expect(fehler).not.toBeInstanceOf(KiSchluesselFehler);
    expect(fehler).toBeInstanceOf(KiDienstFehler);
    expect(fehler).toMatchObject({ status: 529, art: 'ueberlastet', antwort: expect.stringContaining('Anthropic 529') });
  });
  it('nicht erreichbar → KiDienstFehler „netz“', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }));
    expect(await anthropicClient('sk').nachricht({}).catch((e) => e)).toMatchObject({ art: 'netz', meldung: expect.stringContaining('nicht erreichbar') });
  });
});

describe('kiFehlerDeuten: Anthropic-Fehler auf Deutsch', () => {
  const fehler = (message: string) => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });
  it('Nutzungslimit mit Datum, Guthaben, Rate, Störung, sonstige Ablehnung', () => {
    expect(kiFehlerDeuten(400, fehler('You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'))).toEqual({
      art: 'limit',
      meldung: 'Das Nutzungslimit des Anthropic-Kontos ist erreicht — die KI-Auswertung ist gesperrt. Wieder verfügbar ab 01.11.2026, 00:00 UTC. Das Limit lässt sich in der Anthropic-Konsole (Settings → Limits) erhöhen.',
    });
    expect(kiFehlerDeuten(400, fehler('Your credit balance is too low to access the Anthropic API.')).art).toBe('guthaben');
    expect(kiFehlerDeuten(429, fehler('rate_limit')).art).toBe('rate');
    expect(kiFehlerDeuten(500, 'kaputt').meldung).toContain('Störung (500)');
    expect(kiFehlerDeuten(400, fehler('max_tokens: too large')).meldung).toBe('Anthropic lehnt die Anfrage ab (400): max_tokens: too large');
  });
});

describe('anthropicSchluesselPruefen: Schlüssel testen, ohne Kosten (Modellliste)', () => {
  it('gültig, abgelehnt, sonstiger Fehler, nicht erreichbar', async () => {
    const abruf = vi.fn(async () => antwort(200, { data: [] }));
    expect(await anthropicSchluesselPruefen('sk-ok', abruf)).toEqual({ gueltig: true, meldung: 'Schlüssel gültig — Anthropic hat ihn angenommen.' });
    expect(abruf).toHaveBeenCalledWith('https://api.anthropic.com/v1/models?limit=1', expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-ok' }) }));
    expect(await anthropicSchluesselPruefen('sk-x', async () => antwort(401, UNGUELTIG))).toMatchObject({ gueltig: false, meldung: expect.stringContaining('abgelehnt') });
    expect(await anthropicSchluesselPruefen('sk-x', async () => antwort(500, {}))).toMatchObject({ gueltig: false, meldung: expect.stringContaining('500') });
    expect(await anthropicSchluesselPruefen('sk-x', async () => { throw new Error('offline'); })).toMatchObject({ gueltig: false, meldung: expect.stringContaining('nicht erreichbar') });
  });
});
