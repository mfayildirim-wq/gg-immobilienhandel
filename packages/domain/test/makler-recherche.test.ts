import { describe, expect, it } from 'vitest';
import {
  immoscoutProfilAusFirma, istImmoscoutProfil, rechercheKostenSchaetzung, rechercheVorschlaege, rechercheWebseite, webseiteAlsUrl,
} from '../src/index.ts';

describe('Makler-Recherche: Webseite und ImmoScout-Adresse (21.10.2026)', () => {
  it('Webseite als aufrufbare Adresse', () => {
    expect(webseiteAlsUrl('www.teuscher-immobilien.de')).toBe('https://www.teuscher-immobilien.de/');
    expect(webseiteAlsUrl('http://www.vbleos.de/')).toBe('http://www.vbleos.de/');
    expect(webseiteAlsUrl('atenos.de/team')).toBe('https://atenos.de/team');
    expect(webseiteAlsUrl('keine webseite')).toBeNull();
    expect(webseiteAlsUrl('')).toBeNull();
  });

  it('Reihenfolge: gespeicherter Stand, bekannte Webseite, E-Mail-Domain (ohne Freemailer)', () => {
    expect(rechercheWebseite({ webseite: 'barth-immo.de', webseiteQuelle: 'ki' }, 'www.alt.de', 'm@x.de')).toEqual({ url: 'https://barth-immo.de/', quelle: 'ki' });
    expect(rechercheWebseite(null, 'www.alt.de', 'm@x.de')).toEqual({ url: 'https://www.alt.de/', quelle: 'bekannt' });
    expect(rechercheWebseite(null, null, 'max@Teuscher-Immobilien.de')).toEqual({ url: 'https://teuscher-immobilien.de/', quelle: 'email' });
    expect(rechercheWebseite(null, null, 'max@gmx.de')).toBeNull();
    expect(rechercheWebseite({ webseite: null }, '', null)).toBeNull();
  });

  it('ImmoScout-Profil aus dem Firmennamen', () => {
    expect(immoscoutProfilAusFirma('Dennis Teuscher Immobilien')).toBe('https://www.immobilienscout24.de/anbieter/profil/dennis-teuscher-immobilien');
    expect(immoscoutProfilAusFirma('Immobilien Service Bärbel Bahr e.K.')).toBe('https://www.immobilienscout24.de/anbieter/profil/immobilien-service-baerbel-bahr-e-k');
    expect(immoscoutProfilAusFirma('E & G Private Immobilien GmbH')).toBe('https://www.immobilienscout24.de/anbieter/profil/e-g-private-immobilien-gmbh');
    expect(immoscoutProfilAusFirma('  ')).toBeNull();
    expect(istImmoscoutProfil('https://www.immobilienscout24.de/anbieter/profil/dennis-teuscher-immobilien')).toBe(true);
    expect(istImmoscoutProfil('https://www.immobilienscout24.de/expose/123')).toBe(false);
  });
});

describe('Makler-Recherche: Funde → Vorschläge', () => {
  const makler = { tel: '+49 711 123456', mobil: null, festnetz: null, email: 'max@x.de', position: null, anrede: 'Herr', firma: 'X GmbH' };
  const unternehmen = { webseite: 'www.x.de', strasse: null, plz: null, ort: 'Stuttgart', fax: null, telefonZentrale: null, emailZentrale: null };
  const q = 'https://www.x.de/team';

  it('nur Neues und Abweichendes; gleiche Werte in anderer Schreibweise zählen nicht', () => {
    const v = rechercheVorschlaege(makler, unternehmen, [
      { ziel: 'makler', feld: 'tel', wert: '0711 / 12 34 56', quelle: q },
      { ziel: 'makler', feld: 'email', wert: 'MAX@X.DE', quelle: q },
      { ziel: 'makler', feld: 'position', wert: 'Geschäftsführer', quelle: q },
      { ziel: 'makler', feld: 'mobil', wert: '0171 999', quelle: q },
      { ziel: 'unternehmen', feld: 'webseite', wert: 'https://x.de/', quelle: q },
      { ziel: 'unternehmen', feld: 'ort', wert: 'Esslingen', quelle: q },
      { ziel: 'unternehmen', feld: 'fax', wert: '0711 99', quelle: q },
    ]);
    expect(v.map((x) => [x.feld, x.alt, x.neu])).toEqual([
      ['position', null, 'Geschäftsführer'], ['mobil', null, '0171 999'], ['ort', 'Stuttgart', 'Esslingen'], ['fax', null, '0711 99'],
    ]);
    expect(v.every((x) => x.entscheidung === null && x.quelle === q)).toBe(true);
  });

  it('Firma nur, wenn noch keine da ist', () => {
    const fund = { ziel: 'makler' as const, feld: 'firma', wert: 'X GmbH & Co. KG', quelle: q };
    expect(rechercheVorschlaege(makler, unternehmen, [fund])).toEqual([]);
    expect(rechercheVorschlaege({ ...makler, firma: null }, null, [fund]).map((x) => x.neu)).toEqual(['X GmbH & Co. KG']);
  });

  it('Telefonnummer, die schon in einem anderen Feld steht, ist kein Vorschlag', () => {
    expect(rechercheVorschlaege(makler, unternehmen, [{ ziel: 'makler', feld: 'festnetz', wert: '+49 (711) 123456', quelle: q }])).toEqual([]);
  });

  it('verworfen bleibt verworfen; je Feld nur der erste Fund; unbekannte Felder und Leeres fallen weg', () => {
    const v = rechercheVorschlaege(makler, unternehmen, [
      { ziel: 'makler', feld: 'position', wert: 'Prokurist', quelle: q },
      { ziel: 'makler', feld: 'mobil', wert: '0171 1', quelle: q },
      { ziel: 'makler', feld: 'mobil', wert: '0171 2', quelle: q },
      { ziel: 'makler', feld: 'prio', wert: 'A', quelle: q },
      { ziel: 'makler', feld: 'anrede', wert: ' ', quelle: q },
    ], [{ ziel: 'makler', feld: 'position', neu: 'prokurist' }]);
    expect(v.map((x) => [x.feld, x.neu])).toEqual([['mobil', '0171 1']]);
  });

  it('ohne Unternehmen: Fax und Zentrale haben keinen Platz, Webseite und Anschrift gehen an die Altfelder des Maklers', () => {
    const v = rechercheVorschlaege({ ...makler, webseite: null, strasse: null }, null, [
      { ziel: 'unternehmen', feld: 'fax', wert: '0711 99', quelle: q },
      { ziel: 'unternehmen', feld: 'telefonZentrale', wert: '0711 1', quelle: q },
      { ziel: 'unternehmen', feld: 'webseite', wert: 'x.de', quelle: q },
      { ziel: 'unternehmen', feld: 'strasse', wert: 'Weg 1', quelle: q },
    ]);
    expect(v.map((x) => x.feld)).toEqual(['webseite', 'strasse']);
  });
});

describe('Makler-Recherche: Kostenschätzung', () => {
  it('Auswerten je Makler, KI-Websuche nur für die ohne Webseite; Warnung ab 5 €', () => {
    expect(rechercheKostenSchaetzung({ mitWebseite: 10, ohneWebseite: 5 }, false)).toEqual({ euro: 0.05, kiSucheMakler: 0, warnung: false });
    expect(rechercheKostenSchaetzung({ mitWebseite: 10, ohneWebseite: 5 }, true)).toEqual({ euro: 0.2, kiSucheMakler: 5, warnung: false });
    expect(rechercheKostenSchaetzung({ mitWebseite: 340, ohneWebseite: 514 }, true).warnung).toBe(true);
    expect(rechercheKostenSchaetzung({ mitWebseite: 340, ohneWebseite: 514 }, false).warnung).toBe(false);
  });
});
