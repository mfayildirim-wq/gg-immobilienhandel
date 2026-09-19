// Port von gg-immohandel src/modules/finanzpraes/finanzpraes-bilder.test.ts
import { describe, it, expect } from 'vitest';
import { verschiebeBild, entferneBild } from '../src/finanzpraesentation/bilder.ts';

const bilder = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
const captions = ['Erdgeschoss', '1. OG', '2. OG', 'Dachgeschoss'];

describe('verschiebeBild', () => {
  it('nimmt die Beschriftung beim Ziehen über mehrere Plätze mit', () => {
    const neu = verschiebeBild(bilder, captions, 3, 0);
    expect(neu.bilder).toEqual(['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
    expect(neu.captions).toEqual(['Dachgeschoss', 'Erdgeschoss', '1. OG', '2. OG']);
  });

  it('nimmt die Beschriftung auch beim Sprung um einen Platz mit', () => {
    const neu = verschiebeBild(bilder, captions, 1, 2);
    expect(neu.bilder).toEqual(['a.jpg', 'c.jpg', 'b.jpg', 'd.jpg']);
    expect(neu.captions).toEqual(['Erdgeschoss', '2. OG', '1. OG', 'Dachgeschoss']);
  });

  it('füllt fehlende Beschriftungen auf, statt sie zu verschieben', () => {
    const neu = verschiebeBild(bilder, ['Erdgeschoss'], 0, 2);
    expect(neu.bilder).toEqual(['b.jpg', 'c.jpg', 'a.jpg', 'd.jpg']);
    expect(neu.captions).toEqual(['', '', 'Erdgeschoss', '']);
  });

  it('lässt die Eingabe unangetastet und ignoriert unmögliche Ziele', () => {
    const eingabe = [...bilder];
    const neu = verschiebeBild(eingabe, captions, 0, 9);
    expect(neu.bilder).toEqual(bilder);
    expect(neu.captions).toEqual(captions);
    expect(eingabe).toEqual(bilder);
    expect(verschiebeBild(bilder, captions, 2, 2).captions).toEqual(captions);
    expect(verschiebeBild(undefined, undefined, 0, 1).bilder).toEqual([]);
  });
});

describe('entferneBild', () => {
  it('löscht die Beschriftung an derselben Stelle mit', () => {
    const neu = entferneBild(bilder, captions, 1);
    expect(neu.bilder).toEqual(['a.jpg', 'c.jpg', 'd.jpg']);
    expect(neu.captions).toEqual(['Erdgeschoss', '2. OG', 'Dachgeschoss']);
  });

  it('lässt bei einem Index außerhalb alles stehen', () => {
    expect(entferneBild(bilder, captions, 7).bilder).toEqual(bilder);
    expect(entferneBild(bilder, captions, -1).captions).toEqual(captions);
  });
});
