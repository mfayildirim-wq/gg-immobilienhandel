import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicClient, anthropicSchluesselPruefen, KiSchluesselFehler } from '../src/index.ts';

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
  it('andere Fehler bleiben, wie sie sind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => antwort(529, { error: { type: 'overloaded_error' } })));
    const fehler = await anthropicClient('sk').nachricht({}).catch((e) => e);
    expect(fehler).not.toBeInstanceOf(KiSchluesselFehler);
    expect(String(fehler.message)).toContain('Anthropic 529');
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
