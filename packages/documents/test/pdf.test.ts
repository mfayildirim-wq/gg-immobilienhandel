import { computeKKalk } from '@gg/domain';
import { describe, expect, it } from 'vitest';
import { bankgespraechPayload } from '../src/index.ts';
import { bankgespraechPdf, chromePfad, finanzpraesPdf } from '../src/pdf/index.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/bankgespraech.json'), 'utf8'));

describe.skipIf(!chromePfad())('PDF-Druck mit echtem Chrome', () => {
  it('druckt das Bankgespräch als A4-PDF', { timeout: 60_000 }, async () => {
    const { k } = faelle[0].eingabe;
    const p = bankgespraechPayload(k, computeKKalk(k.inputs), { heute: new Date('2026-09-17T10:00:00+02:00'), bilder: k.impressionen });
    const pdf = await bankgespraechPdf(p);
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  it('druckt die Bank-Präsentation quer mit Standardbild und Foto', { timeout: 60_000 }, async () => {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    const praes = { id: 'p', dealId: 'd', bankName: 'Testbank', createdAt: '', updatedAt: '', slides: [
      { id: 'a', typ: 'deckblatt' as const, visible: true, data: { titel: 'ANKAUF', bilder: ['photo:o/f1'] } },
      { id: 'b', typ: 'abschluss' as const, visible: true, data: { bild: 'standardbild:abschluss', untertitel: 'Gerry & Sven' } },
    ] };
    const pdf = await finanzpraesPdf(praes, { holeFoto: async () => jpeg });
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 84[12]\.\d+ 59[56]\.\d+\]/); // A4 quer
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });
});
