/**
 * Golden Master: Payload und HTML des Bankgesprächs gleichen der alten App.
 * Erzeugt mit `pnpm golden:erzeugen` aus buildPdfPayload + bankgespraechTemplate.ts des Originals.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeKKalk, type KKalkInputs } from '@gg/domain';
import { describe, expect, it } from 'vitest';
import {
  type BankgespraechPayload, bankgespraechFullHtml, bankgespraechPayload, bankgespraechPdfFooter, bankgespraechPdfHeader, bankgespraechPreviewHtml,
  type KundenkalkFuerPdf, monatlicheInvestitionenBox,
} from '../src/index.ts';

interface Fall {
  name: string;
  eingabe: { k: KundenkalkFuerPdf & { inputs: KKalkInputs; impressionen: string[]; stellplatzKaufpreis?: number }; heute: string; ersteller: string; disclaimer: string };
  payload: Record<string, unknown>;
  html: { voll: string; vorschau: string; kopf: string; fuss: string };
}
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/bankgespraech.json'), 'utf8')) as { faelle: Fall[] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** JSON-Rundreise wie im Golden-JSON (NaN/Infinity → null, undefined entfällt). */
const wieJson = (x: unknown) => JSON.parse(JSON.stringify(x)) as Record<string, unknown>;

/**
 * Bewusste Korrektur (Fachentscheidung 13.10.2026): „Monatliche Investitionen – Durchschnittswerte“ zeigte in der alten
 * App die Werte von Jahr 2 (Felder basisjahr2_*). Der Neubau zeigt echte Durchschnitte über die Betrachtungsdauer.
 * Für den HTML-Vergleich wird die Box mit den Altwerten in der Altfassung gerendert; der Rest bleibt byte-genau geprüft.
 */
const ALT_BOX = ['zins', 'tilgung', 'nichtUmlagefaehig', 'kaltmiete', 'vorSteuer', 'steuer', 'nachSteuer'] as const;
const ALT_FELD = {
  zins: 'basisjahr2_zinsMonat', tilgung: 'basisjahr2_tilgungMonat', nichtUmlagefaehig: 'basisjahr2_nichtUmlagefaehigMonat',
  kaltmiete: 'basisjahr2_kaltmieteMonat', vorSteuer: 'basisjahr2_einnahmenVorSteuerMonat', steuer: 'basisjahr2_steuerrueckerstattungMonat',
  nachSteuer: 'basisjahr2_einnahmenNachSteuerMonat',
} as const;
// Alt negiert Zins, Tilgung, Nebenkosten und Steuer (−x / 12): aus 0 wurde −0 und damit „-0,00 €“. JSON kennt kein −0.
const ALT_NEGIERT = new Set(['zins', 'tilgung', 'nichtUmlagefaehig', 'steuer']);
const altWerte = (alt: Record<string, unknown>) =>
  Object.fromEntries(ALT_BOX.map((f) => {
    const v = (alt[ALT_FELD[f]] as number | null) ?? Number.NaN;
    return [f, v === 0 && ALT_NEGIERT.has(f) ? -0 : v];
  })) as BankgespraechPayload['durchschnittMonat'];
function wieAlt(html: string, p: BankgespraechPayload, alt: Record<string, unknown>) {
  const neu = monatlicheInvestitionenBox(p.durchschnittMonat, `Durchschnittswerte ${p.hv_dauerJahre} Jahre`);
  expect(html.includes(neu)).toBe(true);
  return altesWording(html.replace(neu, () => monatlicheInvestitionenBox(altWerte(alt), 'Durchschnittswerte')), p);
}
/** Bewusste Änderung (Kundenwunsch 19.10.2026): Fußzeile „IVT Wohnen GmbH“, beim Globalverkauf „Kaufpreis Haus“. */
const altesWording = (html: string, p: BankgespraechPayload) => {
  const html2 = html.replaceAll('>IVT Wohnen GmbH<', '>Ein Produkt der IVT Wohnen GmbH<');
  return p.scope === 'aufteiler' ? html2 : html2.replaceAll('<td>Kaufpreis Haus', '<td>Kaufpreis Wohnung');
};

describe('Bankgespräch (Golden Master)', () => {
  it('hat Fälle', () => expect(faelle.length).toBeGreaterThanOrEqual(60));

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const { k, heute, ersteller, disclaimer } = f.eingabe;
    const p = bankgespraechPayload(k, computeKKalk(k.inputs), { heute: new Date(heute), ersteller, disclaimer, bilder: k.impressionen });

    // Das veraltete Altfeld stellplatzKaufpreis führt der Neubau nicht mehr; die Vorlage zeigt es nicht an (HTML-Hash unten).
    // Die Box „Monatliche Investitionen“ ist bewusst anders (siehe oben) und wird eigens geprüft.
    const { stellplatzKaufpreis: _neu, durchschnittMonat: _box, ...neu } = wieJson(p);
    const { stellplatzKaufpreis: _alt, ...altRest } = f.payload;
    const alt = Object.fromEntries(Object.entries(altRest).filter(([k]) => !k.startsWith('basisjahr2_')));
    expect(neu).toEqual(alt);

    // HTML: mit dem Altwert und der Box in Altfassung gerendert, damit der Vergleich byte-genau ist
    const mitAltwert = { ...p, stellplatzKaufpreis: (f.payload.stellplatzKaufpreis as number) ?? 0 };
    expect(hash(wieAlt(bankgespraechFullHtml(mitAltwert), p, f.payload))).toBe(f.html.voll);
    expect(hash(wieAlt(bankgespraechPreviewHtml(mitAltwert), p, f.payload))).toBe(f.html.vorschau);
    expect(hash(bankgespraechPdfHeader(mitAltwert))).toBe(f.html.kopf);
    expect(hash(altesWording(bankgespraechPdfFooter(mitAltwert), p))).toBe(f.html.fuss);
    // und ohne Altwert identisch, weil die Vorlage das Feld nicht nutzt
    expect(hash(wieAlt(bankgespraechFullHtml(p), p, f.payload))).toBe(f.html.voll);
  });

  it.each(faelle.map((f) => [f.name, f] as const))('%s: Monatliche Investitionen = Ø der Cashflow-Tabelle je Monat', (_n, f) => {
    const { k, heute, ersteller, disclaimer } = f.eingabe;
    const p = bankgespraechPayload(k, computeKKalk(k.inputs), { heute: new Date(heute), ersteller, disclaimer, bilder: k.impressionen });
    const n = p.cashflowYears.length * 12;
    const mittel = (w: (y: (typeof p.cashflowYears)[number]) => number) => p.cashflowYears.reduce((s, y) => s + w(y), 0) / n;
    const b = p.durchschnittMonat;
    if (!Number.isFinite(b.nachSteuer)) return; // Fälle mit fehlenden Jahren (NaN wie auf Seite 1)
    expect(b.zins).toBeCloseTo(mittel((y) => y.zinsen), 6);
    expect(b.tilgung).toBeCloseTo(mittel((y) => y.tilgung), 6);
    expect(b.kaltmiete).toBeCloseTo(mittel((y) => y.kaltmiete), 6);
    expect(b.nichtUmlagefaehig).toBeCloseTo(mittel((y) => y.bewirtschaftung), 6);
    expect(b.steuer).toBeCloseTo(mittel((y) => y.steuerErstattungLast), 6);
    // „nach Steuer“ ist derselbe Wert wie der Ø Cashflow auf Seite 1, und die Box rechnet in sich auf
    expect(b.nachSteuer).toBe(p.durchschnitt_cashflowProMonat);
    expect(b.vorSteuer + b.steuer).toBeCloseTo(b.nachSteuer, 6);
  });
});

describe('Bankgespräch: Wording (Kundenwunsch 19.10.2026)', () => {
  const payload = (scope: 'global' | 'aufteiler') => {
    const f = faelle.find((x) => x.eingabe.k.scope === scope)!;
    const { k, heute, ersteller, disclaimer } = f.eingabe;
    return bankgespraechPayload(k, computeKKalk(k.inputs), { heute: new Date(heute), ersteller, disclaimer, bilder: k.impressionen });
  };

  it('Fußzeile „IVT Wohnen GmbH“ — im PDF und in der Vorschau', () => {
    const p = payload('global');
    for (const html of [bankgespraechPdfFooter(p), bankgespraechPreviewHtml(p)]) {
      expect(html).toContain('>IVT Wohnen GmbH<');
      expect(html).not.toContain('Ein Produkt der');
    }
  });

  it('Globalverkauf: „Kaufpreis Haus“, Aufteiler: „Kaufpreis Wohnung“', () => {
    const global = bankgespraechFullHtml(payload('global'));
    expect(global).toContain('<td>Kaufpreis Haus</td>');
    expect(global).toContain('<td>Kaufpreis Haus pro m²</td>');
    expect(global).not.toContain('Kaufpreis Wohnung');
    const aufteiler = bankgespraechFullHtml(payload('aufteiler'));
    expect(aufteiler).toContain('<td>Kaufpreis Wohnung pro m²</td>');
    expect(aufteiler).not.toContain('Kaufpreis Haus');
  });
});
