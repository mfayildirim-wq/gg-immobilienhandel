import { describe, expect, it } from 'vitest';
import { adresse, katalogFingerabdruck, werkzeugeAusOpenapi, werkzeugName, type OpenapiDokument } from '../src/katalog.ts';

const doc: OpenapiDokument = {
  paths: {
    '/api/deals': {
      get: { responses: { 200: { description: 'Deals' } } },
      post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { objektId: { type: 'string' } } } } } }, responses: { 201: { description: 'angelegt' } } },
    },
    '/api/deals/{id}/kommentare': {
      get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'ab', in: 'query', schema: { type: 'string' }, description: 'ab Datum' }], responses: { 200: { description: 'Kommentare' } } },
    },
  },
};

describe('Werkzeugkatalog aus OpenAPI', () => {
  it('bildet Namen aus Methode und Pfad', () => {
    expect(werkzeugName('get', '/api/deals/{id}/kommentare')).toBe('get_api_deals_id_kommentare');
  });

  it('macht aus jeder Operation ein Werkzeug; GET liest, POST schreibt', () => {
    const alle = werkzeugeAusOpenapi(doc);
    expect(alle.map((w) => w.name)).toEqual(['get_api_deals', 'get_api_deals_id_kommentare', 'post_api_deals']);
    expect(alle.find((w) => w.name === 'post_api_deals')?.lesend).toBe(false);
    expect(alle.find((w) => w.name === 'post_api_deals')?.rumpf).toBeTruthy();
    expect(werkzeugeAusOpenapi(doc, { nurLesend: true })).toHaveLength(2);
  });

  it('kennt Pfad- und Abfrageparameter und setzt sie in die Adresse ein', () => {
    const w = werkzeugeAusOpenapi(doc).find((x) => x.name === 'get_api_deals_id_kommentare')!;
    expect(w.pfadParameter).toEqual(['id']);
    expect(w.abfrageParameter).toEqual(['ab']);
    expect(w.parameter.safeParse({ id: 'd 1' }).success).toBe(true);
    expect(w.parameter.safeParse({}).success).toBe(false);
    expect(adresse(w, { id: 'd 1', ab: '2026-09-01' })).toBe('/api/deals/d%201/kommentare?ab=2026-09-01');
    expect(adresse(w, { id: 'd1' })).toBe('/api/deals/d1/kommentare');
    expect(w.beschreibung).toBe('GET /api/deals/{id}/kommentare — Liefert: Kommentare');
  });

  it('ändert den Fingerabdruck bei neuen Operationen, nicht bei anderen Antwortbeschreibungen', () => {
    const a = katalogFingerabdruck(werkzeugeAusOpenapi(doc));
    const geaendert = structuredClone(doc);
    geaendert.paths!['/api/deals']!.get!.responses![200]!.description = 'Alle Deals';
    expect(katalogFingerabdruck(werkzeugeAusOpenapi(geaendert))).toBe(a);
    (geaendert.paths as Record<string, unknown>)['/api/makler'] = { get: { responses: {} } };
    expect(katalogFingerabdruck(werkzeugeAusOpenapi(geaendert))).not.toBe(a);
    expect(katalogFingerabdruck(werkzeugeAusOpenapi(doc), [['nav.deals']])).not.toBe(a);
  });
});
