// Port von gg-immohandel src/modules/finanzpraes/finanzpraes-seitenumbruch.test.ts
// Der Umbruch ist erst dann etwas wert, wenn er im fertigen HTML ankommt —
// dieselbe Zeichenkette, die Puppeteer druckt. Deshalb prüft dieser Test den
// Renderer und nicht nur die Aufteilung der Zeilen.
import { describe, it, expect } from 'vitest';
import type { FinanzPraes } from '@gg/domain';
import { finanzpraesFullHtml } from '../src/finanzpraes/vorlage.ts';

function praesMitKalkulation(sanierungsposten: number): FinanzPraes {
  const rows: string[][] = [
    ['PROJEKTKOSTEN', ''],
    ['Kaufpreis', '1.200.000 €'],
    ['+ Notar & Grundbuch (1,50%)', '18.000 €'],
    ['+ Grunderwerbsteuer (5,00%)', '60.000 €'],
    ['+ Maklerprovision (3,57%)', '42.840 €'],
    ['= Anschaffungskosten', '1.320.840 €'],
    ['+ FK-Zinskosten (5,20% p.a.)', '104.000 €'],
    ['+ Abschlussgebühr Bank (1,00% auf FK)', '13.300 €'],
    ['– Mieteinnahmen IST (Haltedauer)', '– 54.000 €'],
    ['HERSTELLUNGSKOSTEN', ''],
  ];
  for (let i = 1; i <= sanierungsposten; i++) rows.push([`+ Sanierungsposten ${i}`, `${i * 10}.000 €`]);
  rows.push(['+ Risikopuffer (10,00%)', '28.000 €']);
  rows.push(['+ Vertriebsprovision (4,00% auf VKP)', '76.000 €']);
  rows.push(['+ Aufteilungskosten', '32.000 €']);
  rows.push(['= Gesamt-Investitionskosten (GIK)', '1.874.000 €']);
  rows.push(['  GIK pro m²', '2.680 €/m²']);
  rows.push(['EXIT AUFTEILER', '']);
  rows.push(['Verkaufserlöse (Σ KP Kunden)', '2.280.000 €']);
  rows.push(['Gewinn Aufteiler', '406.000 €']);
  rows.push(['Marge auf Verkaufserlöse', '17,8%']);
  return {
    id: 'p1',
    dealId: 'd1',
    bankName: 'Testbank',
    createdAt: '2026-08-04',
    updatedAt: '2026-08-04',
    slides: [
      { id: 's1', typ: 'deckblatt', visible: true, data: { titel: 'ANKAUF' } },
      {
        id: 's2',
        typ: 'projektkalkulation',
        visible: true,
        data: {
          tableTitle: 'Aufteiler-Kalkulation',
          tableHeaders: ['Position', 'Betrag'],
          tableRows: rows,
          beschreibung: 'Erläuterung zur Kalkulation.',
        },
      },
    ],
  };
}

const folienZahl = (html: string) => (html.match(/<section class="fp-slide"/g) || []).length;

describe('finanzpraesFullHtml — lange Kalkulationstabelle', () => {
  it('bringt GIK, Gewinn und Marge bei 8 Sanierungsposten auf eine zweite Folie', () => {
    const html = finanzpraesFullHtml(praesMitKalkulation(8));
    expect(folienZahl(html)).toBe(3);   // Deckblatt + zwei Kalkulationsseiten
    expect(html).toContain('Projektkalkulation (1 / 2)');
    expect(html).toContain('Projektkalkulation (2 / 2)');
    expect(html).toContain('= Gesamt-Investitionskosten (GIK)');
    expect(html).toContain('Gewinn Aufteiler');
    expect(html).toContain('Marge auf Verkaufserlöse');
  });

  it('zählt die Fußzeile über alle Seiten durch', () => {
    const html = finanzpraesFullHtml(praesMitKalkulation(8));
    expect(html).toContain('<span>1 / 3</span>');
    expect(html).toContain('<span>2 / 3</span>');
    expect(html).toContain('<span>3 / 3</span>');
  });

  it('wiederholt den Tabellenkopf und setzt den Text nur ans Ende', () => {
    const html = finanzpraesFullHtml(praesMitKalkulation(8));
    expect((html.match(/<th>Position<\/th>/g) || []).length).toBe(2);
    expect((html.match(/Erläuterung zur Kalkulation\./g) || []).length).toBe(1);
    // Der Untertitel steht einmal, nicht über jeder Folgeseite.
    expect((html.match(/Aufteiler-Kalkulation/g) || []).length).toBe(1);
  });

  it('lässt eine kurze Kalkulation auf einer Folie', () => {
    const html = finanzpraesFullHtml(praesMitKalkulation(1));
    expect(folienZahl(html)).toBe(2);
    expect(html).not.toContain('Projektkalkulation (1 /');
    expect(html).toContain('Marge auf Verkaufserlöse');
  });
});
