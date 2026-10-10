import { describe, expect, it } from 'vitest';
import { umformen } from '../src/umformen.ts';
import { ALTBESTAND } from './altbestand.ts';

const u = umformen(ALTBESTAND, '2026-09-17T12:00:00.000Z');

describe('Exposé-Altimporte (deals._exposeRaw → expose_importe, Schema v0)', () => {
  it('ergibt je Deal mit Rohdaten genau eine Zeile mit fester ID, Verweisen, Dateiname und Rohdaten ohne Dateinamen', () => {
    const zeilen = u.zeilen.exposeImporte.filter((e) => e.dealId === 'deal-1');
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toEqual({
      id: 'imp:deal-1', dealId: 'deal-1', objektId: 'obj-1', maklerId: 'mk-1',
      dateiname: 'Exposé Musterstraße.pdf', schemaVersion: 'gg-expose-v0', status: 'uebernommen',
      rohdaten: {
        objekt: { strasse: 'Musterstraße', hausnr: '12', plz: '70178', stadt: 'Stuttgart', baujahr: '1978' },
        makler: { name: 'Anna Alt', tel: '+49 30 111' },
        kalkulation: { kaufpreis: 1200000 },
        _konfidenz: { strasse: 'hoch', baujahr: 'mittel' },
      },
      promptVersion: null, modell: null, weg: null, seitenGelesen: null, seitenGesamt: null, stopReason: null,
      inputTokens: null, outputTokens: null, dauerMs: null, kostenEur: null, analyse: null,
    });
  });

  it('legt für Deals ohne Rohdaten keine Zeile an und meldet die Überführung als Info-Befund', () => {
    expect(u.zeilen.exposeImporte.map((e) => e.dealId)).toEqual(['deal-1']);
    expect(u.befunde.filter((b) => b.art === 'expose-altimport')).toEqual([
      { schwere: 'info', art: 'expose-altimport', entitaet: 'deals', id: 'deal-1', feld: '_exposeRaw', hinweis: 'als expose_importe (v0) überführt' },
    ]);
  });
});
