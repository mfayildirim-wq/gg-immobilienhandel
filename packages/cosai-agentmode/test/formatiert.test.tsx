import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Formatiert } from '../src/Bausteine.tsx';

describe('Formatiert', () => {
  it('zeigt **fett**, Aufzählungen und Absätze — ohne die Zeichen', () => {
    const { container } = render(<Formatiert text={'**Marktdaten:**\n\n- Kaufpreis **4.464 €/m²**\n- Miete 12,71 €/m²\n\nFazit: seitwärts.'} />);
    expect(container.querySelectorAll('strong')[0]?.textContent).toBe('Marktdaten:');
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['Kaufpreis 4.464 €/m²', 'Miete 12,71 €/m²']);
    expect(container.querySelectorAll('p').length).toBe(2);
    expect(container.textContent).not.toContain('**');
  });

  it('lässt HTML aus fremden Texten als Text stehen', () => {
    const { container } = render(<Formatiert text={'<img src=x onerror=alert(1)> **ok**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
