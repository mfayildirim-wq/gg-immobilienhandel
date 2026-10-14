import { describe, expect, it } from 'vitest';
import { dokumentArtPruefen } from '../src/expose/dokumentart.ts';

describe('Ist es ein Exposé?', () => {
  it('erkennt die Investment-Rechnung aus Google Sheets (Pfaudlerstraße)', () => {
    const r = dokumentArtPruefen({ dateiname: 'Investment -Pfaudlerstraße 2 + 4 - ML.pdf', seiten: 1, bilder: 2, erzeuger: 'Google Sheets', maklerGefunden: false });
    expect(r.art).toBe('tabelle');
    expect(r.hinweis).toBe('„Investment -Pfaudlerstraße 2 + 4 - ML.pdf“ sieht nicht nach einem Exposé aus (1 Seite, aus Google Sheets, keine Maklerangaben, 2 Bilder). Fotos und Makler fehlen deshalb meist. Lade das Exposé des Maklers dazu hoch — es kann den Deal zu diesem Objekt ergänzen.');
  });
  it('lässt ein echtes Exposé in Ruhe (McMakler, 17 Seiten, 25 Bilder, Makler)', () => {
    expect(dokumentArtPruefen({ dateiname: 'Exposé Pfaudlerstraße.pdf', seiten: 17, bilder: 25, erzeuger: 'Skia/PDF m127', maklerGefunden: true })).toEqual({ art: 'expose' });
  });
  it('meldet kurze Dateien ohne Fotos und Makler, auch ohne Erzeuger', () => {
    const r = dokumentArtPruefen({ dateiname: 'Mieterliste.pdf', seiten: 2, bilder: 0, maklerGefunden: false });
    expect(r.art).toBe('knapp');
    expect(r.hinweis).toContain('(2 Seiten, keine Maklerangaben, keine Fotos)');
  });
  it('ein kurzes Exposé mit Makler ist in Ordnung', () => {
    expect(dokumentArtPruefen({ dateiname: 'Kurzexposé.pdf', seiten: 2, bilder: 1, erzeuger: null, maklerGefunden: true }).art).toBe('expose');
  });
  it('eine Excel-Tabelle bleibt eine Tabelle, auch mit Makler', () => {
    expect(dokumentArtPruefen({ dateiname: 'Kalkulation.pdf', seiten: 3, bilder: 0, erzeuger: 'Microsoft® Excel® für Microsoft 365', maklerGefunden: true }).art).toBe('tabelle');
  });
});
