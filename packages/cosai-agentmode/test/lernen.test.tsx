import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { melden } from '../src/kanal.ts';
import { FeldVorschlaege, heuteLokal, Lernen } from '../src/lernen.tsx';

const antwort = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Lernen', () => {
  it('schickt nur gespeicherte Meldungen an den Kern — Klicks nicht', async () => {
    const aufrufe: { pfad: string; body: unknown }[] = [];
    const anfrage = async (pfad: string, init?: RequestInit) => { aufrufe.push({ pfad, body: JSON.parse(String(init?.body)) }); return antwort({ ok: true }); };
    render(<><Lernen api="/api/agent" anfrage={anfrage} /><button data-agent="deal.kommentar.senden">x</button></>);
    fireEvent.click(screen.getByText('x'));
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf Montag', kontext: { dealId: 'd1' } }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: '/api/agent/ereignis', body: { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf Montag', kontext: { dealId: 'd1' } } }]));
  });
});

describe('FeldVorschlaege', () => {
  it('zeigt die Formulierungen als Chips, ein Klick wählt, nach dem Speichern wird neu geladen', async () => {
    let liste = ['Mailbox besprochen', 'Rückruf Montag'];
    const pfade: string[] = [];
    const anfrage = async (pfad: string) => { pfade.push(pfad); return antwort({ vorschlaege: liste }); };
    const gewaehlt: string[] = [];
    render(<FeldVorschlaege api="/api/agent" anfrage={anfrage} ziel="deal.kommentar" waehlen={(t) => gewaehlt.push(t)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rückruf Montag' }));
    expect(gewaehlt).toEqual(['Rückruf Montag']);
    expect(pfade[0]).toBe('/api/agent/vorschlaege?ziel=deal.kommentar');
    liste = ['Neu gelernt'];
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Neu gelernt' }));
    expect(await screen.findByRole('button', { name: 'Neu gelernt' })).toBeTruthy();
  });

  it('zeigt nichts ohne Vorschläge', async () => {
    const pfade: string[] = [];
    const { container } = render(<FeldVorschlaege api="/api/agent" anfrage={async (p) => { pfade.push(p); return antwort({ vorschlaege: [] }); }} ziel="deal.kommentar" waehlen={() => undefined} />);
    await waitFor(() => expect(pfade.length).toBe(1));
    expect(container.querySelector('.am-feldvorschlaege')).toBeNull();
  });

  it('heuteLokal liefert das lokale Datum als JJJJ-MM-TT', () => {
    expect(heuteLokal(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07');
  });
});
