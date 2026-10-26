import { describe, expect, it } from 'vitest';
import { markdownAlsHtml } from './markdown.ts';

describe('markdownAlsHtml', () => {
  it('Überschrift, Tabelle und Link; Links öffnen in neuem Tab', () => {
    const html = markdownAlsHtml('## Vergleich\n\n| Objekt | Preis |\n|---|---|\n| Musterweg 1 | 420.000 € |\n\n[Inserat](https://example.org/1)');
    expect(html).toContain('<h2>Vergleich</h2>');
    expect(html).toContain('<td>Musterweg 1</td>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('kein Skript, kein Ereignis-Attribut, kein javascript:-Link', () => {
    const html = markdownAlsHtml('<script>alert(1)</script><img src=x onerror="alert(1)">\n\nText mit [Link](javascript:alert(1)) und <a href="javascript:alert(2)">roh</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain('roh');
  });
});
