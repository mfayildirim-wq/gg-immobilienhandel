import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentMode } from '../src/AgentMode.tsx';

/** Ein Kern-Ersatz hinter `anfrage`: antwortet wie der echte auf /sitzung, /nachricht, /entscheidung, /ereignis. */
function kernErsatz() {
  const aufrufe: { pfad: string; body?: unknown }[] = [];
  let wartet = false;
  const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });
  const anfrage = async (pfad: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    aufrufe.push({ pfad, body });
    if (pfad.startsWith('/api/agent/sitzung')) return antwort({ sitzungId: null, verlauf: [] });
    if (pfad === '/api/agent/ereignis') return antwort({ ok: true });
    if (pfad === '/api/agent/nachricht') {
      wartet = true;
      return antwort({
        sitzungId: 's1', text: 'Ich erfasse die Notiz.',
        steuerung: [{ art: 'oeffne', ziel: 'deal.reiter.kommunikation', text: 'öffnet Reiter Kommunikation' }, { art: 'fuelle', ziel: 'deal.kommentar.text', wert: 'Rückruf Montag', text: 'schreibt die Notiz' }],
        chips: [{ label: 'Ja, ausführen', wert: 'ja', art: 'entscheidung' }, { label: 'Nein', wert: 'nein', art: 'entscheidung' }],
        wartetAuf: { frage: 'Notiz abschicken?', aktion: { art: 'sende', ziel: 'deal.kommentar.senden' } },
      });
    }
    if (pfad === '/api/agent/entscheidung') {
      if (!wartet) return antwort({ fehler: 'Nichts wartet' }, 409);
      wartet = false;
      return antwort({ sitzungId: 's1', text: 'Erledigt.', steuerung: body.wert === 'ja' ? [{ art: 'sende', ziel: 'deal.kommentar.senden', text: 'schickt ab' }] : [], chips: [{ label: 'Nächster', wert: 'Nächster Deal' }] });
    }
    return antwort({ fehler: 'unbekannt' }, 404);
  };
  return { anfrage, aufrufe };
}

function App() {
  return (
    <div>
      <button data-agent="deal.reiter.kommunikation">Kommunikation</button>
      <div data-agent="deal.kommentar.text"><textarea aria-label="Neue Gesprächsnotiz" /></div>
      <button data-agent="deal.kommentar.senden" onClick={() => document.body.setAttribute('data-gesendet', 'ja')}>Abschicken</button>
    </div>
  );
}

describe('AgentMode (Overlay)', () => {
  it('führt die Steuerung sichtbar aus, wartet auf die Bestätigung und schickt nach „Ja“ ab', async () => {
    const { anfrage, aufrufe } = kernErsatz();
    const navigiere = vi.fn();
    render(
      <AgentMode api="/api/agent" anfrage={anfrage} modus="overlay" navigiere={navigiere} ort="/" stil="kern" schrittMs={10}>
        <App />
      </AgentMode>,
    );
    const eingabe = await screen.findByLabelText('Nachricht an den Agenten');
    fireEvent.change(eingabe, { target: { value: 'Kommentar: Rückruf Montag. Abschicken.' } });
    fireEvent.submit(eingabe.closest('form')!);

    // Die Schritte laufen sichtbar: Etikett mit Text, Ziel hervorgehoben, Feld gefüllt
    await waitFor(() => expect(document.querySelector('[data-etikett]')?.textContent).toMatch(/Agent: (öffnet Reiter Kommunikation|schreibt die Notiz)/));
    await waitFor(() => expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Rückruf Montag'));
    await waitFor(() => expect(screen.getByText('Notiz abschicken?')).toBeTruthy());
    expect(document.body.getAttribute('data-gesendet')).toBeNull();
    const ja = await screen.findByRole('button', { name: 'Ja, ausführen' });

    await act(async () => { fireEvent.click(ja); });
    await waitFor(() => expect(document.body.getAttribute('data-gesendet')).toBe('ja'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nächster' })).toBeTruthy());
    expect(aufrufe.find((a) => a.pfad === '/api/agent/entscheidung')?.body).toEqual({ sitzungId: 's1', wert: 'ja' });
    expect(aufrufe.find((a) => a.pfad === '/api/agent/nachricht')?.body).toMatchObject({ text: 'Kommentar: Rückruf Montag. Abschicken.', ort: '/' });
    // Ein Klick des Nutzers auf ein markiertes Element geht als Beobachtung an den Kern
    fireEvent.click(screen.getByText('Kommunikation'));
    await waitFor(() => expect(aufrufe.some((a) => a.pfad === '/api/agent/ereignis' && (a.body as { ziel: string }).ziel === 'deal.reiter.kommunikation')).toBe(true));
  });
});
