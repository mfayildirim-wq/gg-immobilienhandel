import { describe, expect, it } from 'vitest';
import {
  gedaechtnisBetrifft, dealKommentarText, dealStatusText, gedaechtnisBezug, MAKLER_BETREUUNG_FELDER, MAKLER_KONTAKT_FELDER, maklerBetreuungText, maklerKontaktText,
} from '../src/gedaechtnis.ts';

const anna = { name: 'Beispiel', vorname: 'Anna', nachname: 'Beispiel', firma: 'Musterhaus Immobilien GmbH', tel: '+49 711 5550000', mobil: '0171 5550001', festnetz: null, email: 'anna@beispiel.test', prio: 'A', kontaktFrequenz: 'monatlich', zustaendig: null, hinweis: null, mailsAbgemeldet: false };

describe('Gedächtnis: Bezug und Texte', () => {
  it('Bezug je Art und Id', () => {
    expect(gedaechtnisBezug('makler', 'm1')).toBe('gg:makler:m1');
    expect(gedaechtnisBezug('deal', 'd1')).toBe('gg:deal:d1');
  });

  it('Kontakt: ganzer Stand in einem Satz, leere Felder fehlen', () => {
    expect(maklerKontaktText(anna)).toBe('Makler Anna Beispiel (Musterhaus Immobilien GmbH): Telefon +49 711 5550000, Mobil 0171 5550001, E-Mail anna@beispiel.test.');
    expect(maklerKontaktText({ ...anna, tel: null, mobil: null, email: null })).toBeNull();
    expect(maklerKontaktText({ ...anna, vorname: null, nachname: null, name: 'Maier Immobilien', firma: null, tel: null, email: null })).toBe('Makler Maier Immobilien: Mobil 0171 5550001.');
  });

  it('Betreuung: Priorität, Rhythmus, Abmeldung, Hinweis', () => {
    expect(maklerBetreuungText({ ...anna, mailsAbgemeldet: true, hinweis: 'nur vormittags' }))
      .toBe('Makler Anna Beispiel (Musterhaus Immobilien GmbH): Priorität A, Kontakt-Rhythmus monatlich, von allen E-Mails abgemeldet, Hinweis: nur vormittags.');
    expect(maklerBetreuungText({ ...anna, prio: null, kontaktFrequenz: null })).toBeNull();
  });

  it('welche Änderung was neu meldet', () => {
    expect(gedaechtnisBetrifft({ mobil: '0172' }, MAKLER_KONTAKT_FELDER)).toBe(true);
    expect(gedaechtnisBetrifft({ mobil: '0172' }, MAKLER_BETREUUNG_FELDER)).toBe(false);
    expect(gedaechtnisBetrifft({ prio: null }, MAKLER_BETREUUNG_FELDER)).toBe(true);
    expect(gedaechtnisBetrifft({ version: 3 }, MAKLER_KONTAKT_FELDER)).toBe(false);
  });

  it('Deal: Status mit Grund, Kommentar', () => {
    expect(dealStatusText({ titel: 'Königstraße 1', status: 'Verkauft', grund: ' Notar 12.11. ' })).toBe('Deal Königstraße 1: Status Verkauft (Grund: Notar 12.11.).');
    expect(dealStatusText({ titel: 'Königstraße 1', status: 'Archiv' })).toBe('Deal Königstraße 1: Status Archiv.');
    expect(dealKommentarText({ titel: 'Königstraße 1', text: ' Bank will Mietliste. ' })).toBe('Kommentar zum Deal Königstraße 1: Bank will Mietliste.');
  });
});
