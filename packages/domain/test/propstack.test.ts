/** Propstack-Feldabbildung (nach src/lib/propstack.ts der alten App). */
import { describe, expect, it } from 'vitest';
import { bewertungMerken, bewertungVorbelegen, propstackPayload, propstackUnitUrl } from '../src/index.ts';

const daten = {
  strasse: 'Hauptstraße', hausnr: '12a', plz: '70173', ort: 'Stuttgart', baujahr: '1965',
  wohnflaeche: '1.250', zimmer: '3,5', letzteModernisierung: '2019', etage: '2', etagenzahl: '5',
  balkonFlaeche: '8,5', qualitaet: 'gehoben' as const,
};

describe('Propstack', () => {
  it('baut die Nutzlast mit deutschen Zahlen und englischer Qualität', () => {
    expect(propstackPayload(daten, 42)).toEqual({
      property: {
        marketing_type: 'BUY', object_type: 'LIVING', rs_type: 'APARTMENT',
        street: 'Hauptstraße', house_number: '12a', zip_code: '70173', city: 'Stuttgart', country: 'DE',
        construction_year: 1965, living_space: 1250, number_of_rooms: 3.5,
        last_modernization: 2019, floor: 2, number_of_floors: 5, balcony_space: 8.5,
        furnishing_quality: 'sophisticated', furnishing_note: 'gehoben',
        property_status_id: 42,
      },
    });
  });

  it('lässt leere Felder weg und den Status ohne Einstellung aus', () => {
    const p = propstackPayload({ ...daten, hausnr: '', baujahr: '', balkonFlaeche: '', etage: '' }).property;
    expect(p).not.toHaveProperty('house_number');
    expect(p).not.toHaveProperty('construction_year');
    expect(p).not.toHaveProperty('balcony_space');
    expect(p).not.toHaveProperty('property_status_id');
    expect(p.country).toBe('DE');
  });

  it('belegt aus Objekt und Einheit vor und merkt sich das Individuelle', () => {
    const vor = bewertungVorbelegen(
      { strasse: ' Hauptstraße ', hausnr: '12a', plz: '70173', stadt: 'Stuttgart', baujahr: 1965 },
      { flaeche: 78.5, zimmer: 3, propstack: { etage: '2', qualitaet: 'luxuriös' } },
    );
    expect(vor).toMatchObject({ strasse: 'Hauptstraße', wohnflaeche: '78.5', zimmer: '3', etage: '2', qualitaet: 'luxuriös', etagenzahl: '' });
    expect(bewertungMerken(daten, 4711)).toEqual({ unitId: 4711, letzteModernisierung: '2019', etage: '2', etagenzahl: '5', balkonFlaeche: '8,5', qualitaet: 'gehoben' });
  });

  it('verlinkt die Einheit im CRM', () => {
    expect(propstackUnitUrl(4711)).toBe('https://crm.propstack.de/app/properties/4711');
  });
});
