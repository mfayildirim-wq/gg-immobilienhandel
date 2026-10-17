import { describe, expect, it } from 'vitest';
import {
  firmenFelderVergleichen, firmenFelderZusammenfuehren, firmenFeldVergleichswert, htmlZuText, impressumFelder, impressumKandidaten, impressumLinkFinden, leereFirmenFelder, siehtNachImpressumAus,
} from '../src/index.ts';

/** Firmendaten aus dem Impressum (Baustein B, 17.10.2026): reine Regeln ohne Netz und ohne KI. */
describe('HTML zu Text', () => {
  it('entfernt Skripte und Stile, macht aus Blöcken Zeilen und löst Entitäten auf', () => {
    const html = '<html><head><title>x</title><style>a{}</style></head><body><script>var a="<p>";</script><h1>Impressum</h1><p>Beispiel &amp; Partner GmbH<br>Musterstra&szlig;e 1</p><div>70173&nbsp;Stuttgart</div><!-- Kommentar --><ul><li>Tel.: 0711 &#49;2</li></ul></body></html>';
    expect(htmlZuText(html)).toBe('Impressum\n\nBeispiel & Partner GmbH\nMusterstraße 1\n\n70173 Stuttgart\n\nTel.: 0711 12');
  });

  it('findet den Impressum-Link über Text oder Adresse und löst relative Adressen auf', () => {
    const html = '<a href="/kontakt">Kontakt</a><a href="/rechtliches/impressum-und-datenschutz" title="x">Rechtliches</a><footer><a href=\'../impressum.html\'>Impres&shy;sum</a><a href="mailto:a@b.de">Impressum per Mail</a></footer>';
    expect(impressumLinkFinden(html, 'https://www.beispiel-immo.de/de/start')).toBe('https://www.beispiel-immo.de/impressum.html');
    expect(impressumLinkFinden('<a href="https://www.beispiel-immo.de/legal-notice">Legal Notice</a>', 'https://beispiel-immo.de/')).toBe('https://www.beispiel-immo.de/legal-notice');
    expect(impressumLinkFinden('<a href="/rechtliches/impressum">Rechtliches</a>', 'https://b.de')).toBe('https://b.de/rechtliches/impressum');
    expect(impressumLinkFinden('<a href="/kontakt">Kontakt</a><a href="#">Impressum</a>', 'https://b.de')).toBeNull();
  });

  it('erkennt, ob eine Seite wie ein Impressum spricht', () => {
    expect(siehtNachImpressumAus('Angaben gemäß § 5 TMG\nBeispiel GmbH')).toBe(true);
    expect(siehtNachImpressumAus('Vertreten durch die Geschäftsführer')).toBe(true);
    expect(siehtNachImpressumAus('Willkommen bei Beispiel Immobilien — Ihr Partner in Stuttgart')).toBe(false);
  });

  it('Kandidaten: Impressum-Pfade je Host, Startseiten zuletzt (zum Schluss über http), www. und ohne', () => {
    const k = impressumKandidaten('Beispiel-Immo.de');
    expect(k[0]).toBe('https://beispiel-immo.de/impressum');
    expect(k).toContain('https://www.beispiel-immo.de/impressum');
    expect(k.slice(-4)).toEqual(['https://beispiel-immo.de/', 'https://www.beispiel-immo.de/', 'http://beispiel-immo.de/', 'http://www.beispiel-immo.de/']);
    expect(impressumKandidaten('https://www.beispiel-immo.de/team')[0]).toBe('https://www.beispiel-immo.de/impressum');
  });
});

describe('Felder per Regel aus dem Impressum-Text', () => {
  it('liest das klassische deutsche Impressum (TMG-Angaben, Anschrift, Kontakt, Vertretung)', () => {
    const text = `Impressum
Angaben gemäß § 5 TMG
Beispiel Immobilien GmbH & Co. KG
Königstraße 12a
70173 Stuttgart
Vertreten durch: Max Beispiel (Geschäftsführer)
Kontakt
Telefon: +49 (0) 711 123 456-0
Telefax: +49 711 123456-99
E-Mail: info (at) beispiel-immo.de
Registereintrag: Amtsgericht Stuttgart HRA 12345
Umsatzsteuer-ID: DE123456789
Umsetzung: Webdesign Agentur GmbH, Berlin`;
    expect(impressumFelder(text)).toEqual({
      name: 'Beispiel Immobilien GmbH & Co. KG', rechtsform: 'GmbH & Co. KG', strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart',
      tel: '+49 (0) 711 123 456-0', fax: '+49 711 123456-99', email: 'info@beispiel-immo.de',
    });
  });

  it('Anschrift in einer Zeile, Rufnummer hinter „Fon“, E-Mail mit [at] und [dot], Firma mit Vorsatz', () => {
    const text = `Firma: Garant Immobilien AG, vertreten durch den Vorstand
Anschrift: Hauptstr. 5, D-71063 Sindelfingen
Fon 07031/123-0 · Fax 07031/123-9
mail [at] garant-immo [dot] de`;
    expect(impressumFelder(text)).toEqual({
      name: 'Garant Immobilien AG', rechtsform: 'AG', strasse: 'Hauptstr. 5', plz: '71063', ort: 'Sindelfingen', tel: '07031/123-0', fax: '07031/123-9', email: 'mail@garant-immo.de',
    });
  });

  it('ohne Rechtsform kein Name per Regel, Behörden- und Agenturzeilen zählen nicht, Ort mit Zusatz wird bereinigt', () => {
    const text = `Immobilien Service Bärbel Bahr
Inhaberin: Bärbel Bahr
Marktplatz 3
71229 Leonberg (Eltingen), Deutschland
Tel 07152 9876 Mobil 0171 55555
Aufsichtsbehörde: Landratsamt Böblingen GmbH-Abteilung
Zuständige Kammer: IHK Region Stuttgart e.V.`;
    const f = impressumFelder(text);
    expect(f.name).toBeNull();
    expect(f.rechtsform).toBeNull();
    expect(f).toMatchObject({ strasse: 'Marktplatz 3', plz: '71229', ort: 'Leonberg', tel: '07152 9876', fax: null, email: null });
  });

  it('nichts Passendes → alles null', () => {
    expect(impressumFelder('Willkommen auf unserer Seite.')).toEqual(leereFirmenFelder());
  });
});

describe('Zusammenführen und Vergleichen', () => {
  it('KI geht vor, Regel füllt Lücken, Rechtsform notfalls aus dem Namen, Unbrauchbares wird verworfen', () => {
    const regel = { ...leereFirmenFelder(), name: 'Alt GmbH', strasse: 'Weg 1', plz: '70173', ort: 'Stuttgart', tel: '0711 12345' };
    const f = firmenFelderZusammenfuehren(regel, { name: 'Alt & Neu Immobilien GmbH', rechtsform: null, email: 'INFO@alt-neu.de ', tel: 'unbekannt', plz: '7017', ort: 'null' });
    expect(f).toEqual({ name: 'Alt & Neu Immobilien GmbH', rechtsform: 'GmbH', strasse: 'Weg 1', plz: '70173', ort: 'Stuttgart', tel: '0711 12345', fax: null, email: 'info@alt-neu.de' });
    expect(firmenFelderZusammenfuehren(regel, null).name).toBe('Alt GmbH');
  });

  it('Vergleichsform: Telefon nur Ziffern (+49 → 0), Straße ohne „straße/str.“-Unterschiede', () => {
    expect(firmenFeldVergleichswert('tel', '+49 (0)711 123-0')).toBe(firmenFeldVergleichswert('tel', '0711 1230'));
    expect(firmenFeldVergleichswert('strasse', 'Königstraße 12a')).toBe(firmenFeldVergleichswert('strasse', 'Königstr. 12 a'));
    expect(firmenFeldVergleichswert('name', 'Beispiel GmbH.')).toBe('beispiel gmbh');
  });

  it('leere Felder füllen, gefüllte vergleichen, Gleiches erkennen', () => {
    const ermittelt = { ...leereFirmenFelder(), name: 'Beispiel Immobilien GmbH', rechtsform: 'GmbH', strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart', tel: '+49 711 1230' };
    const v = firmenFelderVergleichen({ name: 'Beispiel Immobilien GmbH', rechtsform: 'GmbH', strasse: 'Königstr. 12 a', tel: '0711 999', ort: '' }, ermittelt);
    expect(v.leer).toEqual(['plz', 'ort']);
    expect(v.gleich).toEqual(['name', 'rechtsform', 'strasse']);
    expect(v.abweichend).toEqual([{ feld: 'tel', aktuell: '0711 999', ermittelt: '+49 711 1230' }]);
  });
});
