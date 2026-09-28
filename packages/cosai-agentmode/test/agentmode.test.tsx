import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentMode } from '../src/AgentMode.tsx';
import { melden } from '../src/kanal.ts';

/** Ein Kern-Ersatz hinter `anfrage`: antwortet wie der echte auf /sitzung, /kontext, /morgen, /nachricht, /entscheidung, /ereignis. */
function kernErsatz() {
  const aufrufe: { pfad: string; body?: unknown }[] = [];
  let wartet = false;
  let morgen: unknown = null;
  let routinen: unknown[] = [];
  let sitzung: unknown = { sitzungId: null, verlauf: [] };
  let ergebnisse: Record<string, unknown[]> = {};
  let kontext: unknown = { art: 'neu', sitzungId: null, text: 'Du bist bei Ankauf. Womit kann ich helfen?', chips: [{ label: 'Was kann ich hier tun?', wert: 'Was kann ich hier tun?', art: 'vorschlag' }] };
  const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });
  const anfrage = async (pfad: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    aufrufe.push({ pfad, body });
    if (pfad.startsWith('/api/agent/sitzung')) return antwort(sitzung);
    if (pfad === '/api/agent/ereignis') return antwort({ ok: true });
    if (pfad === '/api/agent/morgen') return antwort({ antwort: morgen });
    if (pfad === '/api/agent/kontext') return antwort(kontext);
    if (pfad === '/api/agent/routinen') return antwort({ routinen });
    if (pfad.startsWith('/api/agent/ergebnisse?')) { const q = new URLSearchParams(pfad.split('?')[1]); return antwort({ ergebnisse: ergebnisse[`${q.get('typ')}:${q.get('id')}`] ?? [] }); }
    if (pfad.startsWith('/api/agent/ergebnisse/') && init?.method === 'DELETE') { for (const k of Object.keys(ergebnisse)) ergebnisse[k] = []; return antwort({ geloescht: true }); }
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
  return { anfrage, aufrufe, setzeMorgen: (m: unknown) => { morgen = m; }, setzeRoutinen: (r: unknown[]) => { routinen = r; }, setzeSitzung: (x: { wartetAuf?: unknown; [feld: string]: unknown }) => { sitzung = x; wartet = !!x.wartetAuf; }, setzeErgebnisse: (e: Record<string, unknown[]>) => { ergebnisse = e; }, setzeKontext: (x: unknown) => { kontext = x; } };
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
  it('fragt am Tagesbeginn: weitermachen oder zusammenfassen — die Übersicht erst auf Wunsch, ohne deren Steuerung', async () => {
    const k = kernErsatz();
    k.setzeKontext({ art: 'tagesbeginn', sitzungId: 's0', text: 'Guten Morgen! Zuletzt bei Ankauf: „Notiz zu Musterweg“. Dort weitermachen, oder soll ich zusammenfassen, was heute ansteht?',
      chips: [{ label: 'Weitermachen', wert: 'weiter:s0', art: 'kontext' }, { label: 'Heute zusammenfassen', wert: 'morgen', art: 'kontext' }, { label: 'Neu beginnen', wert: 'neu', art: 'kontext' }] });
    k.setzeMorgen({ sitzungId: 'm1', text: 'Heute sind 3 Deals fällig.', steuerung: [{ art: 'oeffne', ziel: 'deal.reiter.kommunikation' }], chips: [{ label: 'Ersten Deal öffnen', wert: 'Öffne den ersten Deal' }] });
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern"><App /></AgentMode>);
    expect((await screen.findAllByText(/Guten Morgen! Zuletzt bei Ankauf/)).length).toBeGreaterThan(0);
    expect((k.aufrufe.find((a) => a.pfad === '/api/agent/kontext')?.body as { heute: string }).heute).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Keine Übersicht, kein alter Verlauf von allein
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/morgen' || a.pfad.startsWith('/api/agent/sitzung'))).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Heute zusammenfassen' })); });
    expect((await screen.findAllByText('Heute sind 3 Deals fällig.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ersten Deal öffnen' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-etikett]')).toBeNull();
  });

  it('„Weitermachen“ lädt den Faden; ein neuer Bereich fragt, was der Agent dort tun soll', async () => {
    const k = kernErsatz();
    k.setzeKontext({ art: 'fortsetzen', sitzungId: 's0', text: 'Hier bei Ankauf waren wir zuletzt bei: „Notiz“. Weitermachen oder neu beginnen?', chips: [{ label: 'Weitermachen', wert: 'weiter:s0', art: 'kontext' }, { label: 'Neu beginnen', wert: 'neu', art: 'kontext' }] });
    k.setzeSitzung({ sitzungId: 's0', verlauf: [{ rolle: 'nutzer', text: 'Notiz zu Musterweg' }, { rolle: 'agent', text: 'Notiz gespeichert.' }] });
    const { rerender } = render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" />);
    const weiter = await screen.findByRole('button', { name: 'Weitermachen' });
    await act(async () => { fireEvent.click(weiter); });
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/sitzung?sitzungId=s0')).toBe(true);
    expect((await screen.findAllByText('Notiz gespeichert.')).length).toBeGreaterThan(0);

    k.setzeKontext({ art: 'neu', sitzungId: null, text: 'Du bist bei Deals. Womit kann ich helfen?', chips: [{ label: 'Welche Deals sind überfällig?', wert: 'Welche Deals sind überfällig?', art: 'vorschlag' }] });
    rerender(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/deals" stil="kern" />);
    expect((await screen.findAllByText('Du bist bei Deals. Womit kann ich helfen?')).length).toBeGreaterThan(0);
    expect(k.aufrufe.filter((a) => a.pfad === '/api/agent/kontext').at(-1)?.body).toMatchObject({ ort: '/deals' });
    // Innerhalb des Bereichs (ein Deal geöffnet) fragt er nicht erneut
    const anzahl = k.aufrufe.filter((a) => a.pfad === '/api/agent/kontext').length;
    rerender(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/deals/d1" stil="kern" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(k.aufrufe.filter((a) => a.pfad === '/api/agent/kontext').length).toBe(anzahl);
    // Ein Vorschlag geht als neuer Faden an den Agenten (ohne alte Sitzung)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Welche Deals sind überfällig?' })); });
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/nachricht')?.body).toMatchObject({ text: 'Welche Deals sind überfällig?', ort: '/deals/d1' }));
    expect((k.aufrufe.find((a) => a.pfad === '/api/agent/nachricht')?.body as { sitzungId?: string }).sitzungId).toBeUndefined();
  });

  it('meldet gespeicherte Eingaben nicht selbst — das macht <Lernen>', async () => {
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={vi.fn()} ort="/" stil="kern" />);
    await waitFor(() => expect(k.aufrufe.some((a) => a.pfad === '/api/agent/kontext')).toBe(true));
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
    // Neu geladen mitten im Faden dieses Bereichs: er wird ohne Rückfrage wieder aufgenommen
    k.setzeKontext({ art: 'fortsetzen', sitzungId: 's1', text: '…', chips: [] });
    window.localStorage.setItem('cosai.sitzung', 's1');
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

describe('AgentMode (Ergebnisse)', () => {
  const ergebnis = { id: 'e1', titel: 'Lage Esslingen', art: 'recherche', inhalt: '**Ø 4.000 €/m²**, seitwärts.', quellen: [{ titel: 'immowelt', url: 'https://www.immowelt.de/x' }], frage: 'Analysiere die Lage', werkzeuge: ['web_search'], modell: 'anthropic', nutzer: 'n', createdAt: '2026-09-27T12:00:00.000Z', bezuege: [{ typ: 'deal', refId: 'd1', bezeichnung: 'Musterweg 1' }] };

  it('zeigt zum geöffneten Objekt 🗂 mit Anzahl, die Ergebnisse im zweiten Bereich, ⤢ als Dialog, ✕ zurück zu den Knöpfen', async () => {
    const k = kernErsatz();
    k.setzeErgebnisse({ 'deal:d1': [ergebnis] });
    render(
      <AgentMode api="/api/agent" anfrage={k.anfrage} modus="overlay" navigiere={vi.fn()} ort="/" stil="kern" schrittMs={10}>
        <section data-agent-fokus='{"dealId":"d1","deal":"Musterweg 1"}'><App /></section>
      </AgentMode>,
    );
    const knopf = await screen.findByRole('button', { name: 'Ergebnisse (1)' });
    await act(async () => { fireEvent.click(knopf); });
    const bereich = screen.getByRole('region', { name: 'Ergebnisse' });
    expect(bereich.textContent).toContain('Musterweg 1');
    expect(screen.queryByLabelText('Nachricht an den Agenten')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lage Esslingen/ })); });
    expect(bereich.querySelector('.am-ergebnis-inhalt strong')?.textContent).toBe('Ø 4.000 €/m²');
    expect(screen.getByRole('link', { name: 'immowelt' }).getAttribute('href')).toBe('https://www.immowelt.de/x');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse vergrößern' })); });
    const dialog = screen.getByRole('dialog', { name: /Ergebnisse/ });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Ergebnisse schließen' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ergebnisse' })).toBeNull();
    expect(screen.getByLabelText('Nachricht an den Agenten')).toBeTruthy();
  });

  it('schickt den Fokus der App als Kontext mit — daraus entsteht der Bezug beim Speichern', async () => {
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="overlay" navigiere={vi.fn()} ort="/deals" stil="kern" schrittMs={10}><section data-agent-fokus='{"dealId":"d1","deal":"Musterweg 1"}'><App /></section></AgentMode>);
    const eingabe = await screen.findByLabelText('Nachricht an den Agenten');
    fireEvent.change(eingabe, { target: { value: 'Analysiere die Lage' } });
    await act(async () => { fireEvent.submit(eingabe.closest('form')!); });
    await waitFor(() => expect(k.aufrufe.find((a) => a.pfad === '/api/agent/nachricht')?.body).toMatchObject({ kontext: { dealId: 'd1', deal: 'Musterweg 1' } }));
  });
});

describe('AgentMode (Knöpfe unter dem Kreis)', () => {
  it('✕ schließt, ↗ wechselt zum Agent-Dialog — beide unter dem Kreis', async () => {
    const k = kernErsatz();
    const schliessen = vi.fn();
    const zurSeite = vi.fn();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="overlay" navigiere={vi.fn()} ort="/" stil="kern" schliessen={schliessen} zurSeite={zurSeite} />);
    const kreis = document.querySelector('.am-kreis') as HTMLElement;
    fireEvent.click(within(kreis).getByRole('button', { name: 'AgentMode schließen' }));
    fireEvent.click(within(kreis).getByRole('button', { name: 'Zum Agent-Dialog' }));
    expect(schliessen).toHaveBeenCalledOnce();
    expect(zurSeite).toHaveBeenCalledOnce();
  });
});
