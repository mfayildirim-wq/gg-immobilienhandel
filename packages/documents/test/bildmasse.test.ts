import { describe, expect, it } from 'vitest';
import { bildMasse, bildRahmen } from '../src/pdf/bildmasse.ts';

const dataUrl = (typ: string, bytes: number[]) => `data:${typ};base64,${Buffer.from(bytes).toString('base64')}`;
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const png = (w: number, h: number) => dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
// JPEG: SOI, ein APP0-Block davor, dann SOF0 mit Höhe/Breite
const jpeg = (w: number, h: number) => dataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0]);
const webpX = (w: number, h: number) => dataUrl('image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const gif = (w: number, h: number) => dataUrl('image/gif', [...Buffer.from('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0]);

describe('bildMasse: Pixelmaße aus den Bilddaten', () => {
  it('PNG, JPEG, WebP, GIF', () => {
    expect(bildMasse(png(1600, 900))).toEqual({ w: 1600, h: 900 });
    expect(bildMasse(jpeg(4032, 3024))).toEqual({ w: 4032, h: 3024 });
    expect(bildMasse(webpX(800, 1200))).toEqual({ w: 800, h: 1200 });
    expect(bildMasse(gif(64, 32))).toEqual({ w: 64, h: 32 });
  });
  it('unbekannt oder kaputt → null', () => {
    expect(bildMasse('data:image/png;base64,AAAA')).toBeNull();
    expect(bildMasse('keine-data-url')).toBeNull();
  });
});

describe('bildRahmen: Seitenverhältnis des Bildes für pptxgenjs (sonst wird auf den Rahmen gestreckt)', () => {
  it('Querformat im hohen Rahmen: Höhe folgt dem Bild, nicht dem Rahmen', () => {
    expect(bildRahmen(png(1600, 900), 4, 8)).toEqual({ w: 4, h: 2.25 });
  });
  it('Maße unbekannt: Rahmen wie bisher', () => {
    expect(bildRahmen('data:image/png;base64,AAAA', 4, 8)).toEqual({ w: 4, h: 8 });
  });
});

describe('PowerPoint-Export: Bilder behalten ihr Seitenverhältnis', () => {
  it('Querformat-Foto im hohen Deckblatt-Rahmen wird beschnitten (cover), nicht gestreckt', async () => {
    const { renderFinanzPraesPptx } = await import('../src/pdf/pptx.ts');
    const JSZip = (await import('jszip')).default;
    const foto = png(1600, 900); // Kopf reicht: pptxgenjs bettet die Bytes ein, die Maße liest bildMasse
    const praes = { id: 'p', dealId: 'd', bankName: '', createdAt: '', updatedAt: '', slides: [{ id: 's1', typ: 'deckblatt', visible: true, data: { titel: 'T', bilder: [foto] } }] };
    const zip = await JSZip.loadAsync(await renderFinanzPraesPptx(praes as never));
    const folie = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const ausschnitt = [...folie.matchAll(/<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"\/>/g)].map((m) => m.slice(1).map(Number));
    // Mindestens ein Bild wird links/rechts beschnitten — vorher waren alle Werte 0 (gestreckt)
    expect(ausschnitt.some(([l, r, t, b]) => l! > 0 && r! > 0 && t === 0 && b === 0)).toBe(true);
  });
});
