import { describe, expect, it } from 'vitest';
import { auswahlUebernehmen, bildErsetzen, bildQuellen } from './bilder.ts';

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

describe('bildErsetzen', () => {
  it('tauscht ein Einzelbild und eine Stelle der Bildliste aus, Beschriftungen bleiben', () => {
    expect(bildErsetzen({ titel: 'x', bildPath: 'photo:o/a' }, { feld: 'bildPath' }, 'photo:o/a', 'photo:o/hell')).toEqual({ titel: 'x', bildPath: 'photo:o/hell' });
    expect(bildErsetzen({ bilder: ['photo:o/a', 'photo:o/b'], captions: ['EG', 'OG'] }, { index: 1 }, 'photo:o/b', 'photo:o/hell'))
      .toEqual({ bilder: ['photo:o/a', 'photo:o/hell'], captions: ['EG', 'OG'] });
  });

  it('lässt die Daten stehen, wenn am Platz inzwischen ein anderes Bild liegt', () => {
    const gewechselt = { bildPath: 'photo:o/c' };
    expect(bildErsetzen(gewechselt, { feld: 'bildPath' }, 'photo:o/a', 'photo:o/hell')).toBe(gewechselt);
    const umsortiert = { bilder: ['photo:o/b', 'photo:o/a'] };
    expect(bildErsetzen(umsortiert, { index: 1 }, 'photo:o/b', 'photo:o/hell')).toBe(umsortiert);
  });
});
