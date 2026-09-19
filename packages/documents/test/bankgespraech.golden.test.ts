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
  bankgespraechFullHtml, bankgespraechPayload, bankgespraechPdfFooter, bankgespraechPdfHeader, bankgespraechPreviewHtml,
  type KundenkalkFuerPdf,
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

describe('Bankgespräch (Golden Master)', () => {
  it('hat Fälle', () => expect(faelle.length).toBeGreaterThanOrEqual(60));

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const { k, heute, ersteller, disclaimer } = f.eingabe;
    const p = bankgespraechPayload(k, computeKKalk(k.inputs), { heute: new Date(heute), ersteller, disclaimer, bilder: k.impressionen });

    // Das veraltete Altfeld stellplatzKaufpreis führt der Neubau nicht mehr; die Vorlage zeigt es nicht an (HTML-Hash unten).
    const { stellplatzKaufpreis: _neu, ...neu } = wieJson(p);
    const { stellplatzKaufpreis: _alt, ...alt } = f.payload;
    expect(neu).toEqual(alt);

    // HTML: mit dem Altwert gerendert, damit der Vergleich byte-genau ist
    const mitAltwert = { ...p, stellplatzKaufpreis: (f.payload.stellplatzKaufpreis as number) ?? 0 };
    expect(hash(bankgespraechFullHtml(mitAltwert))).toBe(f.html.voll);
    expect(hash(bankgespraechPreviewHtml(mitAltwert))).toBe(f.html.vorschau);
    expect(hash(bankgespraechPdfHeader(mitAltwert))).toBe(f.html.kopf);
    expect(hash(bankgespraechPdfFooter(mitAltwert))).toBe(f.html.fuss);
    // und ohne Altwert identisch, weil die Vorlage das Feld nicht nutzt
    expect(hash(bankgespraechFullHtml(p))).toBe(f.html.voll);
  });
});
