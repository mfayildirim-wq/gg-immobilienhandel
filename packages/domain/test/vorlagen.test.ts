import { describe, expect, it } from 'vitest';
import { resolveVorlage, standardVorlagen, vorlagenBereinigen, vorlagenFuerKanal, vorlagenKontext } from '../src/index.ts';

describe('Textvorlagen (vorlagen.ts, mkApplyVorlage, settingsVorlagenSave)', () => {
  it('Platzhalter werden ersetzt, unbekannte und leere werden leer', () => {
    expect(resolveVorlage('Hallo {maklerName}, {adresse} in {stadt} {gibtsnicht}!', { maklerName: 'Anna', adresse: 'Hafenweg 3', stadt: '' })).toBe('Hallo Anna, Hafenweg 3 in  !');
  });

  it('fünf Standardvorlagen wie alt', () => {
    let n = 0;
    const v = standardVorlagen(() => `v${++n}`);
    expect(v.map((x) => [x.id, x.name, x.kanal])).toEqual([['v1', 'Erstanfrage', 'email'], ['v2', 'Nachfass', 'beide'], ['v3', 'Besichtigungsanfrage', 'email'], ['v4', 'Unterlagenabfrage', 'email'], ['v5', 'Dankeschön', 'beide']]);
    expect(vorlagenFuerKanal(v, 'email')).toHaveLength(5);
    expect(vorlagenFuerKanal(v, 'whatsapp').map((x) => x.name)).toEqual(['Nachfass', 'Dankeschön']);
  });

  it('Speichern trimmt Name und Betreff, lässt Text stehen und entfernt leere Vorlagen', () => {
    expect(vorlagenBereinigen([
      { id: 'a', name: ' Erst ', kanal: 'email', betreff: ' Betreff ', text: ' Text \n' },
      { id: 'b', name: '  ', kanal: 'email', betreff: '', text: '   ' },
      { id: 'c', name: '', kanal: 'whatsapp', text: 'nur Text' },
    ])).toEqual([
      { id: 'a', name: 'Erst', kanal: 'email', betreff: 'Betreff', text: ' Text \n' },
      { id: 'c', name: '', kanal: 'whatsapp', text: 'nur Text' },
    ]);
  });

  it('Kontext aus erstem nicht archivierten Deal des Maklers und dessen Objekt', () => {
    const makler = { id: 'm1', name: 'Anna', firma: 'A GmbH' };
    const deals = [
      { id: 'd0', maklerId: 'm1', status: 'Archiv', adresse: 'Alt', stadt: 'X', objId: 'o0' },
      { id: 'd1', maklerId: 'm1', status: 'In Prüfung', adresse: '', stadt: '', objId: 'o1', kalk: { kaufpreis: 1234567.6 } },
    ];
    const objekte = [{ id: 'o1', strasse: 'Hafenweg', stadt: 'Hamburg', wohnflaeche: '480.4' }];
    expect(vorlagenKontext(makler, deals, objekte, 'Jonas')).toEqual({ maklerName: 'Anna', maklerFirma: 'A GmbH', adresse: 'Hafenweg', stadt: 'Hamburg', kaufpreis: '1.234.568', wohnflaeche: '480', meinName: 'Jonas' });
    expect(vorlagenKontext(null, deals, objekte, '')).toEqual({ maklerName: '', maklerFirma: '', adresse: '', stadt: '', kaufpreis: '', wohnflaeche: '', meinName: '' });
  });
});

describe('Mail-Auswahl im Cockpit (vtDealMailPicker, vtMaklerMailPicker, buildMailto)', () => {
  it('mailto mit CRLF, Kontext aus Deal-Kopie und Objekt, Einträge je E-Mail-Vorlage', async () => {
    const { mailtoAdresse, mailAuswahl, vorlagenKontextDeal, vorlagenKontextMakler } = await import('../src/index.ts');
    expect(mailtoAdresse('a@b.de', '', '')).toBe('mailto:a@b.de');
    expect(mailtoAdresse('a@b.de', 'Hallo Du', 'Zeile1\nZeile2')).toBe('mailto:a@b.de?subject=Hallo%20Du&body=Zeile1%0D%0AZeile2');
    const ctx = vorlagenKontextDeal({ maklerName: 'Anna', adresse: 'Hafenweg', stadt: '', kalk: { kaufpreis: 950000.4 } }, { hausnr: '3', stadt: 'Hamburg', wohnflaeche: '480' }, 'Jonas');
    expect(ctx).toEqual({ maklerName: 'Anna', maklerFirma: '', adresse: 'Hafenweg 3', stadt: 'Hamburg', kaufpreis: '950.000', wohnflaeche: '480', meinName: 'Jonas' });
    expect(vorlagenKontextMakler({ name: 'Anna' }, 'Jonas')).toEqual({ maklerName: 'Anna', maklerFirma: '', meinName: 'Jonas' });
    const eintraege = mailAuswahl('a@b.de', [{ id: 'w', name: 'WA', kanal: 'whatsapp', text: 'x' }, { id: 'e', name: 'Erst', kanal: 'email', betreff: 'Anfrage: {adresse}', text: 'Hallo {maklerName}' }], ctx);
    expect(eintraege).toEqual([{ id: 'e', name: 'Erst', betreff: 'Anfrage: Hafenweg 3', href: 'mailto:a@b.de?subject=Anfrage%3A%20Hafenweg%203&body=Hallo%20Anna' }]);
  });
});
