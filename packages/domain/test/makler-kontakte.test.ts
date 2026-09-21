import { describe, expect, it } from 'vitest';
import { telefonSchluessel, weitereKontakte } from '../src/index.ts';

describe('weitereKontakte', () => {
  const haupt = { name: 'Erika Beispiel', tel: '+49 171 1234567', mobil: '+49 171 1234567', festnetz: '030 123456', email: 'erika@beispiel.de' };

  it('lässt weg, was am Makler schon steht — auch in anderer Schreibweise', () => {
    expect(weitereKontakte(haupt, {
      namen: ['Erika Beispiel', 'Max Muster'],
      telefonnummern: ['0171 1234567', '0049 30 123456', '(030) 99 88 77'],
      emails: ['ERIKA@beispiel.de', 'info@beispiel.de'],
    })).toEqual({ namen: ['Max Muster'], telefonnummern: ['(030) 99 88 77'], emails: ['info@beispiel.de'] });
  });

  it('nennt jeden Wert nur einmal', () => {
    expect(weitereKontakte({}, { telefonnummern: ['030 1', '030-1', ' 0301 '], emails: ['a@b.de', 'A@B.de'] }))
      .toEqual({ namen: [], telefonnummern: ['030 1'], emails: ['a@b.de'] });
  });

  it('ist null, wenn nichts übrig bleibt — auch bei Altformaten, die keine Liste sind', () => {
    expect(weitereKontakte(haupt, { namen: ['Erika Beispiel'], telefonnummern: ['030 123456'], emails: [] })).toBeNull();
    expect(weitereKontakte(haupt, { namen: 'Max', telefonnummern: undefined, emails: [null, 7, ''] })).toBeNull();
  });

  it('vergleicht Nummern über die Ziffern, Ländervorwahl wie führende Null', () => {
    expect(telefonSchluessel('+49 (171) 12-34')).toBe(telefonSchluessel('0171 1234'));
    expect(telefonSchluessel('0049 171 1234')).toBe('01711234');
    expect(telefonSchluessel('+49 (0)711 12 34')).toBe(telefonSchluessel('0711 1234'));
  });
});
