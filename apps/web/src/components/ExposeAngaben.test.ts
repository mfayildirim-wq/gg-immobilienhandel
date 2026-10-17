import { describe, expect, it } from 'vitest';
import { kurzText } from './ExposeAngaben.tsx';

describe('kurzText: lange Werte aus dem Exposé auf wenige Wörter (ganzer Text im Tooltip, 16.10.2026)', () => {
  it('kurze Texte bleiben, Leerraum wird zusammengezogen', () => {
    expect(kurzText('Gas-Zentralheizung')).toBe('Gas-Zentralheizung');
    expect(kurzText('Gas  \n Zentralheizung')).toBe('Gas Zentralheizung');
  });
  it('lange Texte enden am Wortende mit „…“', () => {
    const lang = 'Der Maklervertrag mit uns kommt durch eine Vereinbarung in Textform oder durch die Inanspruchnahme unserer Maklertätigkeit zustande.';
    const kurz = kurzText(lang);
    expect(kurz.endsWith(' …')).toBe(true);
    expect(kurz.length).toBeLessThanOrEqual(82);
    expect(lang.startsWith(kurz.slice(0, -2))).toBe(true);
    expect(kurzText(lang, 40)).toBe('Der Maklervertrag mit uns kommt durch …');
  });
  it('ohne Wortgrenze in der ersten Hälfte wird hart geschnitten', () => {
    expect(kurzText('x'.repeat(100), 20)).toBe(`${'x'.repeat(20)} …`);
  });
});
