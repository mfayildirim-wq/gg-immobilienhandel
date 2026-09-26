import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { konstellation, saatAus } from '../src/konstellation.ts';
import { Sprechkreis, SPRECHKREIS_STILE } from '../src/Sprechkreis.tsx';

describe('Sprechkreis', () => {
  it('Konstellation ist deterministisch und hat 2–4 Ringe', () => {
    for (const saat of [1, 7, 1234567, saatAus('Agent')]) {
      const a = konstellation(saat);
      expect(a).toEqual(konstellation(saat));
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(a.length).toBeLessThanOrEqual(4);
    }
    expect(saatAus('a')).not.toBe(saatAus('b'));
  });

  it('rendert alle drei Stile in jedem Zustand', () => {
    for (const { wert } of SPRECHKREIS_STILE) {
      for (const zustand of ['ruhig', 'hoert', 'denkt', 'spricht'] as const) {
        const { container, unmount } = render(<Sprechkreis stil={wert} zustand={zustand} pegel={0.5} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('data-stil')).toBe(wert);
        expect(svg.getAttribute('data-zustand')).toBe(zustand);
        unmount();
      }
    }
  });
});
