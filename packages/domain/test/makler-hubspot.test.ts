import { describe, expect, it } from 'vitest';
import {
  excelDatum, hubspotAbgleich, hubspotErgaenzung, hubspotFehlendeSpalten, hubspotFrequenz, hubspotKollege, hubspotKontaktLesen, hubspotNamePasst, hubspotPersoenlich, hubspotPrio, hubspotSpalten, hubspotTelefon, HUBSPOT_SPALTEN, telefonSchluessel,
} from '../src/index.ts';

/** HubSpot-Übernahme (Baustein C, 17.10.2026): reine Regeln ohne Datenbank. */
const kopf = ['Datensatz-ID', 'Vorname', 'Nachname', 'Anrede', 'Du / Sie', 'E-Mail', 'Zusätzliche E-Mail-Adressen', 'E-Mail-Domain', 'Telefonnummer', 'Handynummer', 'Faxnummer', 'Unternehmensname', 'Unternehmensanschrift', 'Webseite', 'Website-URL', 'Adresszeile', 'Postleitzahl', 'Stadt', 'Klassifizierung', 'Makler Status Mailings', 'Stellung', 'Beruf', 'Jobbezeichnung', 'Warnhinweis', 'Von allen E-Mails abgemeldet', 'Für Kontakt zuständiger Mitarbeiter ', 'Erstellungsdatum', 'Letzte Kontaktaufnahme', 'Zusammengeführte Kontakt-IDs', 'Irgendwas anderes'];
const zeile = (w: Partial<Record<string, unknown>>) => kopf.map((k) => w[k.trim()] ?? '');
const s = hubspotSpalten(kopf);

describe('Spalten und Zeile', () => {
  it('findet die Spalten trotz Leerraum in der Überschrift; fehlende Pflichtspalten werden benannt', () => {
    expect(s.zustaendig).toBe(25);
    expect(s.id).toBe(0);
    expect(hubspotFehlendeSpalten(s)).toEqual([]);
    expect(hubspotFehlendeSpalten(hubspotSpalten(['Name', 'Firma']))).toEqual(['Datensatz-ID', 'Vorname', 'Nachname', 'E-Mail', 'Telefonnummer', 'Klassifizierung']);
    expect(Object.keys(HUBSPOT_SPALTEN)).toHaveLength(29);
  });

  it('liest eine Zeile als Kontakt: Name, Du/Sie, E-Mails, Telefone bereinigt, Datum aus Excel-Zahl, zusammengeführte IDs', () => {
    const k = hubspotKontaktLesen(zeile({
      'Datensatz-ID': 312819241160, Vorname: ' Anna ', Nachname: 'Beispiel', Anrede: 'Frau', 'Du / Sie': 'per Du', 'E-Mail': 'Anna.Beispiel@Beispiel-Immo.de',
      'Zusätzliche E-Mail-Adressen': 'anna@privat.de; kaputt', 'E-Mail-Domain': 'beispiel-immo.de', Telefonnummer: "'+497112272470", Handynummer: '+49 173-8025886', Faxnummer: "'+",
      Unternehmensname: 'beispiel-immo.de', Webseite: '', 'Website-URL': 'https://www.beispiel-immo.de/', Adresszeile: 'Königstraße 12', Postleitzahl: 70173, Stadt: 'Stuttgart',
      Klassifizierung: 'VIP', 'Makler Status Mailings': 'Mails für allgemeines im Kontakt bleiben', Stellung: 'Angestellt', Beruf: 'Vertrieb', Jobbezeichnung: 'Senior Beraterin',
      Warnhinweis: 'nur vormittags', 'Von allen E-Mails abgemeldet': 'true', 'Für Kontakt zuständiger Mitarbeiter': 'Gerry Weyrich', Erstellungsdatum: 45471.45486111111, 'Letzte Kontaktaufnahme': '2026-09-30T10:00:00Z', 'Zusammengeführte Kontakt-IDs': '538023150799; 328349828287',
    }), s)!;
    expect(k).toMatchObject({
      id: '312819241160', name: 'Anna Beispiel', anrede: 'Frau', duSie: 'Du', email: 'anna.beispiel@beispiel-immo.de', zusatzEmails: ['anna@privat.de'], emailDomain: 'beispiel-immo.de',
      tel: '+497112272470', mobil: '+49 173-8025886', fax: null, firma: 'beispiel-immo.de', webseite: 'https://www.beispiel-immo.de/', strasse: 'Königstraße 12', plz: '70173', ort: 'Stuttgart',
      klassifizierung: 'VIP', stellung: 'Angestellt', jobbezeichnung: 'Senior Beraterin', warnhinweis: 'nur vormittags', abgemeldet: true, zustaendig: 'Gerry Weyrich',
      erstelltAm: '2024-06-28', letzterKontakt: '2026-09-30', zusammengefuehrteIds: ['538023150799', '328349828287'],
    });
    expect(hubspotKontaktLesen(zeile({ Vorname: 'ohne ID' }), s)).toBeNull();
  });

  it('Telefon: Hochkomma, 49 ohne Plus, Platzhalter mit sieben Nullen, nur Plus', () => {
    expect(hubspotTelefon("'+497112272470")).toBe('+497112272470');
    expect(hubspotTelefon('497121972610')).toBe('+497121972610');
    expect(hubspotTelefon('4971310000000')).toBeNull();
    expect(hubspotTelefon("'+")).toBeNull();
    expect(hubspotTelefon('015161146495')).toBe('015161146495');
    expect(hubspotTelefon('0049 711 1234')).toBe('+49 711 1234');
    expect(telefonSchluessel('+49 (0)711 22 72 470')).toBe('07112272470');
    expect(telefonSchluessel('0711/2272470')).toBe('07112272470');
  });

  it('Excel-Datum und Textdaten', () => {
    expect(excelDatum(45678.43194444444)).toBe('2025-01-21');
    expect(excelDatum('17.10.2026 12:00')).toBe('2026-10-17');
    expect(excelDatum('')).toBeNull();
    expect(excelDatum('gestern')).toBeNull();
  });
});

describe('Prio, Frequenz, persönlich', () => {
  it('Klassifizierung → Prio und Frequenz (Entscheidung 17.10.: Test = C, Exit = Nie)', () => {
    expect(['VIP', 'High Potential', 'B', 'C', 'Test', 'Exit', null].map(hubspotPrio)).toEqual(['A', 'A', 'B', 'C', 'C', 'C', 'C']);
    expect(hubspotFrequenz('Exit')).toBe('Nie');
    expect(hubspotFrequenz('Test')).toBe('Monatlich');
  });

  it('persönlich: Anrede, Du/Sie, Jobbezeichnung (sonst Beruf), Mailing-Status mit Abmeldung, Herkunft mit HubSpot-ID', () => {
    const k = hubspotKontaktLesen(zeile({ 'Datensatz-ID': '1', Vorname: 'Max', Nachname: 'Muster', Anrede: 'Herr', Beruf: 'Geschäftsführer', Klassifizierung: 'Test', 'Für Kontakt zuständiger Mitarbeiter': 'Sven Neubert', 'Von allen E-Mails abgemeldet': 'true', Erstellungsdatum: 45527.48541666667 }), s)!;
    expect(hubspotPersoenlich(k, '2026-10-17')).toEqual({
      anrede: 'Herr', jobbezeichnung: 'Geschäftsführer', mailingStatus: 'Von allen E-Mails abgemeldet',
      herkunft: { quelle: 'hubspot', id: '1', importiertAm: '2026-10-17', klassifizierung: 'Test', zustaendig: 'Sven Neubert', erstelltAm: '2024-08-23' },
    });
  });
});

describe('Abgleich und Ergänzung', () => {
  const bestand = [
    { id: 'm1', name: 'Anna Beispiel', email: 'anna@beispiel-immo.de', tel: '0711 2272470', mobil: null, festnetz: null },
    { id: 'm2', name: 'Bernd Bauer', email: null, tel: null, mobil: '+49 173 8025886', festnetz: null, weitereKontakte: { emails: ['buero@bauer.de'] } },
    { id: 'm3', name: 'Dr. Carla Cem', email: 'c@cem.de', tel: '07031 1', mobil: null, festnetz: null, persoenlich: { herkunft: { quelle: 'hubspot', id: '999', importiertAm: '2026-10-01' } } },
  ];
  const kontakt = (w: Partial<Record<string, unknown>>) => hubspotKontaktLesen(zeile({ 'Datensatz-ID': '42', Vorname: 'X', Nachname: 'Y', ...w }), s)!;

  it('E-Mail (auch Zusatz und weitere Kontakte) → Telefon (auch Mobil) → gleicher Name ohne Titel; HubSpot-ID zuerst; ähnlich reicht nicht', () => {
    expect(hubspotAbgleich(kontakt({ Vorname: 'Anna', Nachname: 'Beispiel', 'E-Mail': 'ANNA@beispiel-immo.de' }), bestand)).toEqual({ id: 'm1', ueber: 'email', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Bernd', Nachname: 'Bauer', 'E-Mail': 'neu@x.de', 'Zusätzliche E-Mail-Adressen': 'buero@bauer.de' }), bestand)).toEqual({ id: 'm2', ueber: 'email', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Anna', Nachname: 'Beispiel', Telefonnummer: "'+497112272470" }), bestand)).toEqual({ id: 'm1', ueber: 'telefon', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Bernd', Nachname: 'Bauer', Handynummer: '0173-8025886' }), bestand)).toEqual({ id: 'm2', ueber: 'telefon', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Carla', Nachname: 'Cem' }), bestand)).toEqual({ id: 'm3', ueber: 'name', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Anne', Nachname: 'Beispiel' }), bestand)).toBeNull();
    expect(hubspotAbgleich(kontakt({ 'Datensatz-ID': '999', Vorname: 'Ganz', Nachname: 'Anders' }), bestand)).toEqual({ id: 'm3', ueber: 'hubspot-id', name: 'fehlt' });
    expect(hubspotAbgleich(kontakt({ 'Zusammengeführte Kontakt-IDs': '999', Vorname: 'Carla', Nachname: 'Cem' }), bestand)).toEqual({ id: 'm3', ueber: 'hubspot-id', name: 'gleich' });
    expect(hubspotAbgleich(kontakt({ Vorname: 'Niemand', Nachname: 'Neu', 'E-Mail': 'n@n.de' }), bestand)).toBeNull();
  });

  it('E-Mail- und Telefon-Treffer nur mit passendem Namen: Kollegen an der Zentralnummer oder am Sammelpostfach werden neu angelegt (Befund Probelauf Prod 17.10.2026)', () => {
    // Zentralnummer von Anna Beispiel, aber eine andere Person → kein Treffer, dafür Kollege für den Bericht
    const kollege = kontakt({ Vorname: 'Verena', Nachname: 'Köhler', 'E-Mail': 'v.koehler@beispiel-immo.de', Telefonnummer: '0711 2272470' });
    expect(hubspotAbgleich(kollege, bestand)).toBeNull();
    expect(hubspotKollege(kollege, bestand)).toEqual({ id: 'm1', ueber: 'telefon' });
    // Sammelpostfach in den weiteren Kontakten von Bernd Bauer → ebenfalls Kollege
    const postfach = kontakt({ Vorname: 'Nicolo', Nachname: 'Mazzola', 'E-Mail': 'buero@bauer.de' });
    expect(hubspotAbgleich(postfach, bestand)).toBeNull();
    expect(hubspotKollege(postfach, bestand)).toEqual({ id: 'm2', ueber: 'email' });
    // Kollege an der Zentralnummer, der aber mit dem Namen auf einen anderen Makler passt → Namenstreffer
    expect(hubspotAbgleich(kontakt({ Vorname: 'Carla', Nachname: 'Cem', Telefonnummer: '0711 2272470' }), bestand)).toEqual({ id: 'm3', ueber: 'name', name: 'gleich' });
    // Ähnlicher Name (Tippfehler) reicht als Schutz: Treffer, aber als „ähnlich“ gekennzeichnet
    expect(hubspotAbgleich(kontakt({ Vorname: 'Anna', Nachname: 'Beispiehl', 'E-Mail': 'anna@beispiel-immo.de' }), bestand)).toEqual({ id: 'm1', ueber: 'email', name: 'aehnlich' });
    // Ohne Namen gilt der Kontaktdaten-Treffer, als „fehlt“ gekennzeichnet; Kollege dann keiner
    const ohneName = kontakt({ Vorname: '', Nachname: '', 'E-Mail': 'anna@beispiel-immo.de' });
    expect(hubspotAbgleich(ohneName, bestand)).toEqual({ id: 'm1', ueber: 'email', name: 'fehlt' });
    // Ganz Unbekannter ohne gemeinsame Kontaktdaten → kein Kollege
    expect(hubspotKollege(kontakt({ Vorname: 'Niemand', Nachname: 'Neu', 'E-Mail': 'n@n.de', Telefonnummer: '030 1' }), bestand)).toBeNull();
  });

  it('hubspotNamePasst: Titel und Groß/Klein egal, Tippfehler ähnlich, Kollegen anders, fehlender Name', () => {
    expect(hubspotNamePasst('Carla Cem', 'Dr. Carla Cem')).toBe('gleich');
    expect(hubspotNamePasst('Alexander Wolff', 'Alexander Wolf')).toBe('aehnlich');
    expect(hubspotNamePasst('Verena Köhler', 'Maximilian Da Val')).toBe('anders');
    expect(hubspotNamePasst('Dirk Karge', 'Julian Karge')).toBe('anders');
    expect(hubspotNamePasst('Nicolo Mazzola', 'Nico Presthofer')).toBe('anders');
    // Vor- und Nachname getrennt: langer gemeinsamer Nachname macht nicht ähnlich; Kurzform, zweiter Vorname und Reihenfolge schon
    expect(hubspotNamePasst('Anna Hengstler-Schmidtbauer', 'Tom Hengstler-Schmidtbauer')).toBe('anders');
    expect(hubspotNamePasst('Markus Hengsteler', 'Tom Hengstler')).toBe('anders');
    expect(hubspotNamePasst('Max Mustermann', 'Maximilian Mustermann')).toBe('aehnlich');
    expect(hubspotNamePasst('Ralph Thomas Goebel', 'Ralph Goebel')).toBe('aehnlich');
    expect(hubspotNamePasst('Mustermann Max', 'Max Mustermann')).toBe('aehnlich');
    expect(hubspotNamePasst('Lukas Schweitzer', 'L. Schweitzer')).toBe('aehnlich');
    expect(hubspotNamePasst('Bernd Zondler', 'B. Eng. Bernd Zondler')).toBe('aehnlich');
    expect(hubspotNamePasst('Matthias Zondler', 'B. Eng. Bernd Zondler')).toBe('anders');
    expect(hubspotNamePasst('Gusinjac', 'Gusinjac')).toBe('gleich');
    expect(hubspotNamePasst('', 'Anna Beispiel')).toBe('fehlt');
    expect(hubspotNamePasst('Anna Beispiel', null)).toBe('fehlt');
  });

  it('Ergänzung: Bestandsmakler ohne Namen bekommt den HubSpot-Namen, mit Namen nicht', () => {
    const ohne = { id: 'm9', name: null, email: 'x@y.de', tel: null, mobil: null, festnetz: null };
    expect(hubspotErgaenzung(kontakt({ Vorname: 'Bernd', Nachname: 'Schmucker', 'E-Mail': 'x@y.de' }), ohne, '2026-10-17').felder).toMatchObject({ name: 'Bernd Schmucker' });
    expect(hubspotErgaenzung(kontakt({ Vorname: 'Bernd', Nachname: 'Schmucker' }), { ...ohne, name: 'B. Schmucker' }, '2026-10-17').felder.name).toBeUndefined();
  });

  it('Ergänzung nur in leeren Feldern; Mobil nicht doppelt zum Haupttelefon; persönlich nur fehlende Schlüssel', () => {
    const k = kontakt({ 'E-Mail': 'anna.neu@beispiel-immo.de', Telefonnummer: '', Handynummer: '+49 173 1111111', Adresszeile: 'Weg 1', Postleitzahl: '70173', Stadt: 'Stuttgart', Anrede: 'Frau', 'Du / Sie': 'per Sie' });
    const e = hubspotErgaenzung(k, { ...bestand[0]!, strasse: 'Alt 9', persoenlich: { anrede: 'Fr.', geburtsdatum: '01-02' } }, '2026-10-17');
    expect(e.felder).toEqual({ mobil: '+49 173 1111111', plz: '70173', ort: 'Stuttgart' });
    expect(e.persoenlich).toEqual({ anrede: 'Fr.', geburtsdatum: '01-02', duSie: 'Sie', herkunft: { quelle: 'hubspot', id: '42', importiertAm: '2026-10-17' } });
    // Haupttelefon leer: Handynummer wird Haupttelefon, nicht zusätzlich Mobil
    const e2 = hubspotErgaenzung(k, { id: 'x', name: 'X', email: null, tel: null, mobil: null, festnetz: null }, '2026-10-17');
    expect(e2.felder).toMatchObject({ tel: '+49 173 1111111', email: 'anna.neu@beispiel-immo.de' });
    expect(e2.felder.mobil).toBeUndefined();
    // nichts zu tun
    expect(hubspotErgaenzung(kontakt({}), { ...bestand[0]!, persoenlich: { herkunft: { quelle: 'hubspot', id: '42', importiertAm: 'x' } } }, '2026-10-17')).toEqual({ felder: {}, persoenlich: null });
  });
});
