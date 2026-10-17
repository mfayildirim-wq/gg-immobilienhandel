import { describe, expect, it } from 'vitest';
import { domainAusAdresse, rechtsformAusName, unternehmenKurzname, unternehmenNameNormieren, webseiteNormieren } from '../src/unternehmen/index.ts';

describe('Unternehmen (Normalform 17.10.2026): Namen normieren', () => {
  it('Groß/Klein, Leerraum und Satzzeichen am Ende spielen keine Rolle', () => {
    expect(unternehmenNameNormieren('  Beispiel   Immobilien GmbH. ')).toBe('beispiel immobilien gmbh');
    expect(unternehmenNameNormieren('Engel & Völkers (Schäfer CIO GmbH & Co. KG)')).toBe('engel & völkers (schäfer cio gmbh & co. kg)');
    expect(unternehmenNameNormieren('Pflugfelder,')).toBe('pflugfelder');
    expect(unternehmenNameNormieren(null)).toBe('');
    expect(unternehmenNameNormieren('   ')).toBe('');
  });
});

describe('Rechtsform aus dem Namen', () => {
  it.each([
    ['Immobilien Rienhardt GmbH', 'GmbH'],
    ['Garant Immobilien AG', 'AG'],
    ['Schäfer CIO GmbH & Co. KG', 'GmbH & Co. KG'],
    ['Schäfer CIO GmbH & Co KG', 'GmbH & Co. KG'],
    ['Immobilien Service Bärbel Bahr e.K.', 'e.K.'],
    ['Bahr e. K.', 'e.K.'],
    ['Haus & Grund Stuttgart e.V.', 'e.V.'],
    ['Wohnbau eG', 'eG'],
    ['Mustermann Immobilien UG (haftungsbeschränkt)', 'UG (haftungsbeschränkt)'],
    ['Jones Lang LaSalle IP, Inc. (JLL)', 'Inc.'],
    ['Müller & Partner GbR', 'GbR'],
    ['Kreissparkasse Waiblingen', null],
    ['Mucha Immobilien', null],
    ['Pflugfelder', null],
    ['', null],
  ])('%s → %s', (name, form) => {
    expect(rechtsformAusName(name)).toBe(form);
  });

  it('„AG“, „SE“, „UG“ und „eG“ nur groß geschrieben — „Lage“ oder „Tag“ sind keine Rechtsform', () => {
    expect(rechtsformAusName('Immobilien am Tag')).toBeNull();
    expect(rechtsformAusName('Beste Lage Immobilien')).toBeNull();
    expect(rechtsformAusName('ug immobilien')).toBeNull();
  });

  it('Kurzname ohne Rechtsform', () => {
    expect(unternehmenKurzname('Immobilien Rienhardt GmbH')).toBe('Immobilien Rienhardt');
    expect(unternehmenKurzname('Schäfer CIO GmbH & Co. KG')).toBe('Schäfer CIO');
    expect(unternehmenKurzname('Kreissparkasse Waiblingen')).toBe('Kreissparkasse Waiblingen');
    // Rechtsform mitten im Namen bleibt stehen
    expect(unternehmenKurzname('Engel & Völkers (Schäfer CIO GmbH & Co. KG)')).toBe('Engel & Völkers (Schäfer CIO GmbH & Co. KG)');
  });
});

describe('Domain aus E-Mail oder Webseite', () => {
  it.each([
    ['Max.Muster@Beispiel-Immo.de', 'beispiel-immo.de'],
    ['https://www.beispiel-immo.de/team/', 'beispiel-immo.de'],
    ['http://beispiel-immo.de', 'beispiel-immo.de'],
    ['beispiel-immo.de/index.php', 'beispiel-immo.de'],
    ['www2.beispiel-immo.de', 'beispiel-immo.de'],
    // Marken-Domain ohne klassische Endung (BNP Paribas) — gültig
    ['realestate.bnpparibas', 'realestate.bnpparibas'],
    ['info@gmx.de', null],
    ['jemand@web.de', null],
    ['kein-wert', null],
    ['', null],
    [null, null],
  ])('%s → %s', (wert, domain) => {
    expect(domainAusAdresse(wert)).toBe(domain);
  });

  it('Webseite für die Anzeige', () => {
    expect(webseiteNormieren('https://www.atenos.de/')).toBe('atenos.de');
    expect(webseiteNormieren('schmucker-immobilien.de/index.php')).toBe('schmucker-immobilien.de/index.php');
    expect(webseiteNormieren('  ')).toBeNull();
  });
});
