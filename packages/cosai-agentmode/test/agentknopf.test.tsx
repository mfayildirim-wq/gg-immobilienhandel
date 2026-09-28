import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentKnopf } from '../src/AgentKnopf.tsx';

describe('AgentKnopf', () => {
  it('zeigt den kleinen roten Kreis; ein Klick öffnet das Overlay', () => {
    const oeffnen = vi.fn();
    render(<AgentKnopf oeffnen={oeffnen} />);
    const knopf = screen.getByRole('button', { name: 'Agent öffnen' });
    expect(knopf.querySelector('svg')?.getAttribute('width')).toBe('40');
    expect(knopf.innerHTML).toContain('#e03131');
    fireEvent.click(knopf);
    expect(oeffnen).toHaveBeenCalledOnce();
  });
});
