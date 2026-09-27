import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentMode } from '../src/AgentMode.tsx';
import { melden } from '../src/kanal.ts';

/** Ein Kern-Ersatz hinter `anfrage`: antwortet wie der echte auf /sitzung, /nachricht, /entscheidung, /ereignis. */
function kernErsatz() {
  const aufrufe: { pfad: string; body?: unknown }[] = [];
  let wartet = false;
  let morgen: unknown = null;
  let routinen: unknown[] = [];
  let sitzung: unknown = { sitzungId: null, verlauf: [] };
  const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });
  const anfrage = async (pfad: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    aufrufe.push({ pfad, body });
    if (pfad.startsWith('/api/agent/sitzung')) return antwort(sitzung);
    if (pfad === '/api/agent/ereignis') return antwort({ ok: true });
    if (pfad === '/api/agent/morgen') return antwort({ antwort: morgen });
    if (pfad === '/api/agent/routinen') return antwort({ routinen });
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
  return { anfrage, aufrufe, setzeMorgen: (m: unknown) => { morgen = m; }, setzeRoutinen: (r: unknown[]) => { routinen = r; }, setzeSitzung: (x: { wartetAuf?: unknown; [feld: string]: unknown }) => { sitzung = x; wartet = !!x.wartetAuf; } };
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

describe('AgentMode (Öffnen)', () => {
  it('zeigt beim Öffnen den Morgenvorschlag — ohne dessen Steuerung auszuführen', async () => {
    const k = kernErsatz();
    k.setzeMorgen({ sitzungId: 'm1', text: 'Heute sind 3 Deals fällig.', steuerung: [{ art: 'oeffne', ziel: 'deal.reiter.kommunikation' }], chips: [{ label: 'Ersten Deal öffnen', wert: 'Öffne den ersten Deal' }] });
    const navigiere = vi.fn();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={navigiere} ort="/" stil="kern"><App /></AgentMode>);
    expect((await screen.findAllByText('Heute sind 3 Deals fällig.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ersten Deal öffnen' })).toBeTruthy();
    const m = k.aufrufe.find((a) => a.pfad === '/api/agent/morgen');
    expect((m?.body as { heute: string }).heute).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-etikett]')).toBeNull();
  });

  it('meldet gespeicherte Eingaben nicht selbst — das macht <Lernen>', async () => {
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" />);
    await waitFor(() => expect(k.aufrufe.some((a) => a.pfad === '/api/agent/morgen')).toBe(true));
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'x' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/ereignis')).toBe(false);
  });
});

describe('AgentMode (Routinen)', () => {
  it('bietet erkannte Routinen als ▶-Chip an und schickt ihren Auftrag', async () => {
    const k = kernErsatz();
    k.setzeRoutinen([{ id: 'r1', label: 'Neue Gesprächsnotiz → Erledigt', folge: ['deal.kommentar', 'deal.erledigt'], anzahl: 3, auftrag: 'Routine ausführen (3× so gemacht): …' }]);
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}><App /></AgentMode>);
    const chip = await screen.findByRole('button', { name: 'Routine: Neue Gesprächsnotiz → Erledigt' });
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/nachricht')?.body).toMatchObject({ text: 'Routine ausführen (3× so gemacht): …' }));
    expect((await screen.findAllByText('▶ Neue Gesprächsnotiz → Erledigt')).length).toBeGreaterThan(0);
  });
});

describe('AgentMode (Eingabe)', () => {
  it('schickt mit dem ➤-Knopf ab — die Nachricht steht dann in der Du-Blase', async () => {
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}><App /></AgentMode>);
    const senden = await screen.findByRole('button', { name: 'Senden' });
    expect((senden as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nachricht an den Agenten'), { target: { value: 'Was ist heute fällig?' } });
    await act(async () => { fireEvent.click(senden); });
    await waitFor(() => expect(document.querySelector('.am-blase[data-wer="nutzer"]')?.textContent).toContain('Was ist heute fällig?'));
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/nachricht')).toBe(true);
  });
});

describe('AgentMode (Rückfrage absichern)', () => {
  it('sagt selbst „Nein“, wenn ein Schritt vor dem Senden gescheitert ist', async () => {
    const k = kernErsatz();
    // Ohne Notizfeld: `fuelle deal.kommentar.text` findet kein Ziel
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="overlay" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}>
      <div><button data-agent="deal.reiter.kommunikation">Kommunikation</button><button data-agent="deal.kommentar.senden">Abschicken</button></div>
    </AgentMode>);
    const eingabe = await screen.findByLabelText('Nachricht an den Agenten');
    fireEvent.change(eingabe, { target: { value: 'Kommentar: Rückruf Montag. Abschicken.' } });
    await act(async () => { fireEvent.submit(eingabe.closest('form')!); });
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/entscheidung')?.body).toMatchObject({ wert: 'nein' }), { timeout: 8000 });
    expect(screen.queryByRole('button', { name: 'Ja, ausführen' })).toBeNull();
  }, 12_000);

  it('schickt nicht ab, wenn inzwischen ein anderer Eintrag offen ist', async () => {
    document.body.removeAttribute('data-gesendet');
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="overlay" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}>
      <section data-agent-kontext='{"dealId":"d1"}'><App /></section>
    </AgentMode>);
    const eingabe = await screen.findByLabelText('Nachricht an den Agenten');
    fireEvent.change(eingabe, { target: { value: 'Kommentar: Rückruf Montag. Abschicken.' } });
    await act(async () => { fireEvent.submit(eingabe.closest('form')!); });
    const ja = await screen.findByRole('button', { name: 'Ja, ausführen' });
    document.querySelector('section')!.setAttribute('data-agent-kontext', '{"dealId":"d2"}');
    await act(async () => { fireEvent.click(ja); });
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/entscheidung')?.body).toMatchObject({ wert: 'nein' }));
    expect(document.body.getAttribute('data-gesendet')).toBeNull();
  });

  it('lässt eine Rückfrage aus einer früheren Sitzung beim Öffnen verfallen', async () => {
    const k = kernErsatz();
    k.setzeSitzung({ sitzungId: 's1', verlauf: [{ rolle: 'agent', text: 'Notiz abschicken?' }], wartetAuf: { frage: 'Notiz abschicken?', aktion: { art: 'sende', ziel: 'deal.kommentar.senden' } } });
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" />);
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/entscheidung')?.body).toEqual({ sitzungId: 's1', wert: 'nein' }));
    expect(screen.queryByRole('button', { name: 'Ja, ausführen' })).toBeNull();
  });
});

describe('AgentMode (Vorlesen stoppen)', () => {
  it('zeigt beim Vorlesen ⏹, ein Klick auf den Kreis bricht sofort ab', async () => {
    // Eine Sprachausgabe, die „spricht“, bis sie abgebrochen wird
    const abbrueche: number[] = [];
    let laufend: { onend?: () => void } | null = null;
    Object.assign(window, {
      SpeechSynthesisUtterance: class { text: string; lang = ''; pitch = 1; rate = 1; voice = null; onstart?: () => void; onend?: () => void; onerror?: () => void; constructor(t: string) { this.text = t; } },
      speechSynthesis: {
        getVoices: () => [], addEventListener: () => undefined, removeEventListener: () => undefined,
        speak: (u: { onstart?: () => void; onend?: () => void }) => { laufend = u; u.onstart?.(); },
        cancel: () => { abbrueche.push(Date.now()); const u = laufend; laufend = null; u?.onend?.(); },
      },
    });
    window.localStorage.setItem('cosai.ton', 'an');
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}><App /></AgentMode>);
    const eingabe = await screen.findByLabelText('Nachricht an den Agenten');
    fireEvent.change(eingabe, { target: { value: 'Kommentar: Rückruf Montag. Abschicken.' } });
    await act(async () => { fireEvent.submit(eingabe.closest('form')!); });
    // spricht → ⏹ sichtbar, der Kreis zeigt „spricht“
    const stopp = await screen.findByRole('button', { name: 'Vorlesen stoppen' });
    const vorher = abbrueche.length;
    await act(async () => { fireEvent.click(screen.getByRole('img', { name: /Agent: spricht/ })); });
    expect(abbrueche.length).toBeGreaterThan(vorher);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Vorlesen stoppen' })).toBeNull());
    expect(stopp).toBeTruthy();
    window.localStorage.removeItem('cosai.ton');
  });
});
