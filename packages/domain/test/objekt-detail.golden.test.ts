/** Golden Master: Objekt-Detail (Anzeige, Recherchelinks, Einheitenaufstellung) wie objDetailHTML/objRenderEinheiten der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { objektAnzeige, objektEinheitAendern, objektEinheitenAnzeige, objektEinheitNeu, objektRecherche } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/objekt-detail.json'), 'utf8')) as { faelle: any[] };
const zusammen = (...t: (string | number)[]) => t.join(' ').replace(/\s+/g, ' ').trim();
/** Altformat (energie, istmiete, einheitenAnz, vermiet) → Felder des Neubaus. */
const objektNeu = (o: any) => ({
  strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt, baujahr: o.baujahr, einheitenAnzahl: o.einheitenAnz,
  wohnflaeche: o.wohnflaeche, grundstueck: o.grundstueck, energieklasse: o.energie, heizung: o.heizung,
  angebotspreis: o.angebotspreis, zielpreis: o.zielpreis, istMiete: o.istmiete, sollMiete: o.sollmiete,
});
const einheitNeu = (e: any) => ({ typ: e.typ, lage: e.lage, zimmer: e.zimmer, stueck: e.stueck, flaeche: e.flaeche, kaltmiete: e.kaltmiete, vermietung: e.vermiet });

describe('Objekt-Detail (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const a = objektAnzeige(objektNeu(f.objekt));
    expect(zusammen('Adresse', a.adresse, 'PLZ / Stadt', a.plzStadt)).toBe(f.lage);
    expect(zusammen('Baujahr', a.baujahr, 'Einheiten', a.einheiten, 'Wohnfläche', a.wohnflaeche, 'Grundstück', a.grundstueck, 'Energieausweis', a.energieklasse, 'Heizungsart', a.heizung)).toBe(f.gebaeude);
    expect(zusammen('Angebotspreis', a.angebotspreis, 'Zielkaufpreis', a.zielpreis, 'Ist-Miete/Mo', a.istMiete, 'Soll-Miete/Mo', a.sollMiete, 'Rendite brutto', a.renditeBrutto, 'KP-Faktor', a.kpFaktor)).toBe(f.kennzahlen);
    expect(objektRecherche(objektNeu(f.objekt))).toEqual(f.recherche);

    const e = objektEinheitenAnzeige(f.einheiten.map(einheitNeu));
    const kopf = 'Typ Lage Zi/Stk m² Kaltmiete €/m² Status';
    expect(f.einheiten.length ? zusammen(kopf, ...e.zeilen.map((z) => zusammen(z.typ, z.lage, z.anzahl, z.flaeche, z.kaltmiete, z.proQm, z.vermietung))) : '').toBe(f.einheitenTabelle);
    expect([e.summen.flaeche, e.summen.kaltmiete, e.summen.proQm]).toEqual([f.summen['oe-sf'], f.summen['oe-sm'], f.summen['oe-kq']]);
  });

  it('neue Einheit und Feldänderung wie objAddEinheit/objUE', () => {
    expect(objektEinheitNeu()).toEqual({ typ: 'Wohnung', lage: '', zimmer: null, stueck: null, flaeche: 0, kaltmiete: 0, vermietung: 'Vermietet' });
    expect(objektEinheitNeu('Stellplatz').typ).toBe('Stellplatz');
    const e = objektEinheitNeu();
    expect(objektEinheitAendern(e, 'lage', 'EG links').lage).toBe('EG links');
    expect(objektEinheitAendern(e, 'flaeche', '75,5').flaeche).toBe(75);
    expect(objektEinheitAendern(e, 'kaltmiete', 'abc').kaltmiete).toBe(0);
    expect(objektEinheitAendern(e, 'vermietung', 'Leerstand').vermietung).toBe('Leerstand');
  });
});
