import { describe, expect, it } from 'vitest';
import { auswahlUebernehmen, bildQuellen } from './bilder.ts';

describe('bildQuellen', () => {
  it('zeigt Objektfotos zuerst und ergänzt Bilder aus Folien ohne Doppelte', () => {
    const q = bildQuellen([{ ref: 'photo:o/a', url: '/api/photos/o/a', dateiname: 'Fassade.jpg' }], {
      slides: [
        { id: '1', typ: 'deckblatt', visible: true, data: { bildPath: 'photo:o/a', titel: 'Foto: kein Bild' } },
        { id: '2', typ: 'impressionen', visible: true, data: { bilder: ['photo:x/b', 'data:image/png;base64,AA', 'photo:x/b'] } },
      ],
    });
    expect(q.map((x) => [x.ref, x.url])).toEqual([
      ['photo:o/a', '/api/photos/o/a'], ['photo:x/b', '/api/photos/x/b'], ['data:image/png;base64,AA', 'data:image/png;base64,AA'],
    ]);
    expect(q[1]!.label).toBe('aus Folie „impressionen“ (bilder)');
  });
});

describe('auswahlUebernehmen', () => {
  it('nimmt Beschriftungen in die neue Reihenfolge mit, neue Bilder ohne', () => {
    expect(auswahlUebernehmen({ bilder: ['a', 'b'], captions: ['EG', 'OG'], x: 1 }, ['b', 'c', 'a'])).toEqual({ bilder: ['b', 'c', 'a'], captions: ['OG', '', 'EG'], x: 1 });
  });
});
