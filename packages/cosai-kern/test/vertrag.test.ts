import { describe, expect, it } from 'vitest';
import { AgentAntwort, Beobachtung, DNA, Steuerung, vertragAlsJsonSchema, Ziel } from '../src/vertrag.ts';

describe('Vertrag', () => {
  it('Ziele haben die Form bereich.objekt.aktion', () => {
    expect(Ziel.safeParse('deal.kommentar.senden').success).toBe(true);
    expect(Ziel.safeParse('nav.deals').success).toBe(true);
    expect(Ziel.safeParse('Deal.Kommentar').success).toBe(false);
    expect(Ziel.safeParse('kommentar').success).toBe(false);
  });

  it('eine Beobachtung trägt Fachbezug nur als Werte', () => {
    const b = Beobachtung.parse({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Mailbox besprochen', kontext: { dealId: 'd1' } });
    expect(b.kontext.dealId).toBe('d1');
    expect(Beobachtung.safeParse({ art: 'tanz', ziel: 'deal.kommentar' }).success).toBe(false);
  });

  it('eine Steuerung ohne Ziel ist nur beim Sprechen sinnvoll — der Vertrag lässt es zu, der Graph prüft es', () => {
    expect(Steuerung.parse({ art: 'sprich', text: 'Guten Morgen' }).art).toBe('sprich');
    expect(Steuerung.parse({ art: 'fuelle', ziel: 'deal.kommentar.text', wert: 'x' }).ziel).toBe('deal.kommentar.text');
  });

  it('eine DNA hat Vorgaben für Werkzeuge und Version', () => {
    const dna = DNA.parse({ slug: 'ankauf', name: 'Ankauf', rolle: 'Führt morgens durch fällige Deals.' });
    expect(dna.werkzeuge).toEqual(['*']);
    expect(dna.version).toBe(1);
  });

  it('die Antwort kann auf eine Bestätigung warten', () => {
    const a = AgentAntwort.parse({ sitzungId: 's', text: 'Abschicken?', wartetAuf: { frage: 'Kommentar abschicken?', aktion: { art: 'sende', ziel: 'deal.kommentar.senden' } } });
    expect(a.wartetAuf?.aktion.art).toBe('sende');
    expect(a.chips).toEqual([]);
  });

  it('lässt sich als JSON-Schema ausgeben', () => {
    const js = vertragAlsJsonSchema();
    expect(Object.keys(js)).toContain('DNA');
    expect((js.Steuerung as { properties: Record<string, unknown> }).properties).toHaveProperty('art');
  });
});
