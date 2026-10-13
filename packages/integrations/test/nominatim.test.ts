import { describe, expect, it } from 'vitest';
import { nominatimAuswerten, nominatimGeocoder } from '../src/index.ts';

// Gekürzte echte Antworten (Abruf 13.10.2026)
const vaihingen = [{ address: { house_number: '10', road: 'Hauptstraße', neighbourhood: 'Vaihingen-Mitte', suburb: 'Vaihingen', city: 'Stuttgart', postcode: '70563' } }];
const leonberg = [{ address: { road: 'Bahnhofstraße', quarter: 'Gartenstadt', suburb: 'Eltingen', town: 'Leonberg', postcode: '71229' } }];

describe('Nominatim: Adresse → Stadtteil', () => {
  it('Stuttgart: Stadtbezirk aus suburb, Stadtteil aus neighbourhood; Leonberg: Ortsteil und Wohngebiet', () => {
    expect(nominatimAuswerten(vaihingen)).toEqual([{ stadtteil: 'Vaihingen', viertel: 'Vaihingen-Mitte', ort: 'Stuttgart', plz: '70563' }]);
    expect(nominatimAuswerten(leonberg)).toEqual([{ stadtteil: 'Eltingen', viertel: 'Gartenstadt', ort: 'Leonberg', plz: '71229' }]);
    expect(nominatimAuswerten([{ address: { city_district: 'Mitte', city: 'Ulm', postcode: '89073' } }])[0]!.stadtteil).toBe('Mitte');
    expect(nominatimAuswerten({ error: 'x' })).toEqual([]);
  });

  it('fragt strukturiert mit Kennung, PLZ und Stadt; Fehler des Dienstes werfen', async () => {
    const urls: string[] = [];
    const heads: any[] = [];
    const abruf = (async (url: string, init: RequestInit) => { urls.push(url); heads.push(init.headers); return new Response(JSON.stringify(vaihingen)); }) as unknown as typeof fetch;
    const g = nominatimGeocoder({ kennung: 'test/1.0', abruf, abstandMs: 0 });
    const r = await g.kandidaten({ strasse: 'Hauptstraße', hausnr: '10', plz: '70563', stadt: 'Stuttgart' });
    expect(r[0]!.stadtteil).toBe('Vaihingen');
    const q = new URL(urls[0]!).searchParams;
    expect([q.get('street'), q.get('postalcode'), q.get('city'), q.get('country'), q.get('addressdetails')]).toEqual(['10 Hauptstraße', '70563', 'Stuttgart', 'de', '1']);
    expect(heads[0]['User-Agent']).toBe('test/1.0');
    const kaputt = nominatimGeocoder({ kennung: 't', abstandMs: 0, abruf: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch });
    await expect(kaputt.kandidaten({ strasse: 'A', hausnr: '', plz: '', stadt: 'B' })).rejects.toThrow('Nominatim 503');
  });
});
