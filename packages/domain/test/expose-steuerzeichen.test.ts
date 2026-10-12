import { describe, expect, it } from 'vitest';
import { steuerzeichenEntfernen, textBereinigen } from '../src/expose/steuerzeichen.ts';

describe('Steuerzeichen aus PDF-Texten (U+0000 als Aufzählungspunkt)', () => {
  it('macht Nullzeichen zwischen Wörtern zu Punkten und entfernt sie am Rand', () => {
    expect(textBereinigen('Objekt ID\u0000')).toBe('Objekt ID');
    expect(textBereinigen('\u0000 Zwei Häuser \u0000 18 WE vermietet')).toBe('Zwei Häuser • 18 WE vermietet');
    expect(textBereinigen('a\u0007b\tc\nd')).toBe('ab\tc\nd');
    expect(textBereinigen('ganz normal')).toBe('ganz normal');
  });
  it('bereinigt verschachtelte Analysen samt Schlüsseln, Zahlen bleiben', () => {
    const roh = { angaben: [{ bezeichnung: 'Objekt ID\u0000', wert: '1072081', seite: 1 }], felder: { objekt: { notizen: 'x\u0000y', baujahr: 1960 } } };
    expect(steuerzeichenEntfernen(roh)).toEqual({ angaben: [{ bezeichnung: 'Objekt ID', wert: '1072081', seite: 1 }], felder: { objekt: { notizen: 'x • y', baujahr: 1960 } } });
    expect(JSON.stringify(steuerzeichenEntfernen(roh))).not.toContain('\\u0000');
  });
});
