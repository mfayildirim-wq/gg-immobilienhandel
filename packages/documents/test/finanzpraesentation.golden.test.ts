/** Golden Master: HTML der Bank-Präsentation (PDF, Vorschau, Einzelfolie) byte-gleich zur alten App. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FinanzPraes } from '@gg/domain';
import { STANDARDBILD_ABSCHLUSS } from '@gg/domain';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { renderFinanzPraesPptx } from '../src/pdf/pptx.ts';
import { finanzpraesFullHtml, finanzpraesPreviewHtml, renderSlideLivePreview, seitenAnzahlDerSlide, standardbilderEinsetzen } from '../src/finanzpraes/index.ts';
import { STANDARD_ABSCHLUSS_BILD } from '../src/finanzpraes/standardbilder.ts';

interface Fall { name: string; praes: FinanzPraes; html: { voll: string; vorschau: string; folien: string[]; seiten: number[] }; pptx: Record<string, string> }
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/finanzpraesentation.json'), 'utf8')) as { faelle: Fall[] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Bank-Präsentation HTML (Golden Master)', () => {
  it('hat Fälle', () => expect(faelle.length).toBe(50));
  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    expect(hash(finanzpraesFullHtml(f.praes))).toBe(f.html.voll);
    expect(hash(finanzpraesPreviewHtml(f.praes))).toBe(f.html.vorschau);
    expect(f.praes.slides.map((s) => hash(renderSlideLivePreview(f.praes, s)))).toEqual(f.html.folien);
    expect(f.praes.slides.map((s) => seitenAnzahlDerSlide(s))).toEqual(f.html.seiten);
  });
});

/** Wie im Generator: Fotos fest aus dem Verweis, `x…` fehlt. */
const testFoto = async (objId: string, fotoId: string) => {
  if (fotoId.startsWith('x')) return null;
  const kopf = fotoId === 'f2' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0xff, 0xd8, 0xff, 0xe0];
  return Buffer.from([...kopf, ...Buffer.from(`${objId}/${fotoId}`)]);
};

async function pptxInhalt(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const aus: Record<string, string> = {};
  for (const name of Object.keys(zip.files).sort()) {
    const eintrag = zip.files[name]!;
    if (eintrag.dir || name === 'docProps/core.xml') continue; // Erstellzeitpunkt
    aus[name] = createHash('sha256').update(await eintrag.async('uint8array')).digest('hex');
  }
  return aus;
}

describe('Bank-Präsentation PowerPoint (Golden Master)', () => {
  it.each(faelle.map((f) => [f.name, f] as const))('%s', async (_n, f) => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // pptxgenjs meldet leere Bilder (Ist-Verhalten)
    expect(await pptxInhalt(await renderFinanzPraesPptx(f.praes, { holeFoto: testFoto }))).toEqual(f.pptx);
  });
});

describe('standardbilderEinsetzen', () => {
  it('ersetzt nur die Platzhalter, auch verschachtelt', () => {
    const aus = standardbilderEinsetzen({ slides: [{ data: { bild: STANDARDBILD_ABSCHLUSS, text: 'standardbild:abschluss ' } }] });
    expect(aus.slides[0]!.data.bild).toBe(STANDARD_ABSCHLUSS_BILD);
    expect(aus.slides[0]!.data.text).toBe('standardbild:abschluss ');
    expect(STANDARD_ABSCHLUSS_BILD.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});
