import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KiAblegen, KiBezug, KiGespraech } from '@gg/ki-kern/vertrag';
import { httpTransport, KiKnopf, KiLeiste, KiLeisteRahmen, type KiTransport, titelVorschlag, useKiBezug } from '../src/index.ts';

afterEach(cleanup);

function attrappe(antwort = '## Vergleich\n\nDrei Angebote', vorschlag?: { titel: string; text: string }): KiTransport & { gesendet: unknown[]; abgelegt: KiAblegen[]; geloescht: string[] } {
  const gesendet: unknown[] = [];
  const abgelegt: KiAblegen[] = [];
  const geloescht: string[] = [];
  const gespeichert = new Map<string, KiGespraech>();
  return {
    gesendet, abgelegt, geloescht,
    stand: async () => ({ verfuegbar: true, gedaechtnis: true, verlaufDauerhaft: true, einstellungen: { modell: 'm', websuche: true, gedaechtnis: true }, modelle: [{ id: 'm', label: 'M' }] }),
    einstellungenSpeichern: async (e) => e,
    bezug: async (b: KiBezug) => ({
      bezug: b, label: b.art === 'deal' ? 'Deal' : 'Makler', titel: `Titel ${b.id}`,
      gedaechtnis: { verbunden: true, eintraege: [{ id: 'e1', text: 'Verkäufer will warten', titel: null, quelle: 'api' }] },
      gespraeche: [{ id: 'alt', bezug: b, titel: 'Frühere Frage', von: 'anna', am: '2026-10-25T10:00:00Z', anzahl: 2 }],
    }),
    allgemein: async () => ({ gespraeche: [] }),
    gespraech: async (id) => gespeichert.get(id) ?? ({ id, bezug: null, titel: 'Frühere Frage', von: 'anna', am: '', anzahl: 2, nachrichten: [{ rolle: 'nutzer', text: 'Frühere Frage', am: '' }, { rolle: 'ki', text: 'Frühere Antwort', am: '' }] }),
    async senden(s) {
      gesendet.push(s);
      const g: KiGespraech = {
        id: 'g1', bezug: s.bezug ?? null, titel: s.text, von: 'ich', am: '', anzahl: 2,
        nachrichten: [{ rolle: 'nutzer', text: s.text, am: '1' }, { rolle: 'ki', text: antwort, am: '2', gedaechtnis: 1, schritte: [{ art: 'websuche', name: 'web_search', ok: true, kurz: 'Ulm' }], ...(vorschlag ? { vorschlag } : {}) }],
      };
      gespeichert.set(g.id, structuredClone(g));
      return g;
    },
    async ablegen(a) {
      abgelegt.push(a);
      const g = gespeichert.get(a.gespraechId!)!;
      const n = g.nachrichten[a.nachricht!]!;
      g.nachrichten[a.nachricht!] = { ...n, abgelegt: a.titel, ...(n.vorschlag ? { vorschlag: { ...n.vorschlag, status: 'abgelegt' as const } } : {}) };
      return {};
    },
    async vorschlagVerwerfen(v) {
      const g = gespeichert.get(v.gespraechId)!;
      g.nachrichten[v.nachricht] = { ...g.nachrichten[v.nachricht]!, vorschlag: { ...g.nachrichten[v.nachricht]!.vorschlag!, status: 'verworfen' } };
      return structuredClone(g);
    },
    async gespraechLoeschen(id) { geloescht.push(id); return {}; },
  };
}

function Dialog({ b }: { b: KiBezug | null }) {
  useKiBezug(b);
  return null;
}

describe('KI-Leiste', () => {
  it('Knopf öffnet, Leiste zeigt den zuletzt gemeldeten Dialog; schließt er, gilt wieder der davor', async () => {
    const t = attrappe();
    function App() {
      const [innen, setInnen] = useState(true);
      return (
        <KiLeisteRahmen transport={t}>
          <KiKnopf />
          <Dialog b={{ art: 'makler', id: 'm1' }} />
          {innen && <Dialog b={{ art: 'deal', id: 'd1' }} />}
          <button type="button" onClick={() => setInnen(false)}>zu</button>
          <KiLeiste />
        </KiLeisteRahmen>
      );
    }
    render(<App />);
    expect(screen.getByRole('button', { name: 'KI-Leiste öffnen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'KI-Leiste öffnen' }));
    expect(screen.getByRole('button', { name: 'KI-Leiste schließen', pressed: true })).toBeTruthy();
    expect(await screen.findByText('Deal: Titel d1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'zu' }));
    expect(await screen.findByText('Makler: Titel m1')).toBeTruthy();
  });

  it('Senden mit Bezug, Antwort mit Fuß, Ablegen mit Titelvorschlag; Verlauf und Gedächtnis darunter', async () => {
    const t = attrappe();
    render(<KiLeisteRahmen transport={t}><Dialog b={{ art: 'deal', id: 'd1' }} /><KiLeiste darstellen={(md) => `<p>${md.replace(/^## /, '')}</p>`} /></KiLeisteRahmen>);
    await screen.findByText('Deal: Titel d1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Frage an die KI' }), { target: { value: 'Ähnliche Angebote?' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Frage an die KI' }), { key: 'Enter' });
    expect(await screen.findByText(/Drei Angebote/)).toBeTruthy();
    expect(t.gesendet).toEqual([{ gespraechId: null, bezug: { art: 'deal', id: 'd1' }, text: 'Ähnliche Angebote?' }]);
    expect(screen.getByText('🌐 1× gesucht')).toBeTruthy();
    expect(screen.getByText('🧠 1 aus dem Gedächtnis')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '🧠 Im Gedächtnis ablegen' }));
    expect((screen.getByRole('textbox', { name: 'Titel im Gedächtnis' }) as HTMLInputElement).value).toBe('Vergleich');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ablegen' })); });
    expect(t.abgelegt).toEqual([{ bezug: { art: 'deal', id: 'd1' }, titel: 'Vergleich', text: '## Vergleich\n\nDrei Angebote', gespraechId: 'g1', nachricht: 1 }]);
    expect(await screen.findByText('✓ Im Gedächtnis abgelegt: Vergleich')).toBeTruthy();

    // Folgefrage geht ins selbe Gespräch
    fireEvent.change(screen.getByRole('textbox', { name: 'Frage an die KI' }), { target: { value: 'Und billiger?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Senden' })); });
    await waitFor(() => expect(t.gesendet).toHaveLength(2));
    expect(t.gesendet[1]).toMatchObject({ gespraechId: 'g1' });

    fireEvent.click(screen.getByRole('tab', { name: /Gedächtnis \(1\)/ }));
    expect(screen.getByText('Verkäufer will warten')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Verlauf/ }));
    await act(async () => { fireEvent.click(screen.getByText('Frühere Frage')); });
    expect(await screen.findByText('Frühere Antwort')).toBeTruthy();
  });

  it('Vorschlag der KI: Karte mit Ablegen, Ändern, Verwerfen; abgelegt wird erst auf Klick', async () => {
    const t = attrappe('Notiert.', { titel: 'Termin', text: 'Besichtigung Montag' });
    render(<KiLeisteRahmen transport={t}><Dialog b={{ art: 'deal', id: 'd1' }} /><KiLeiste /></KiLeisteRahmen>);
    await screen.findByText('Deal: Titel d1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Frage an die KI' }), { target: { value: 'Merk dir: Besichtigung Montag' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Senden' })); });
    const karte = await screen.findByRole('group', { name: 'Vorschlag fürs Gedächtnis' });
    expect(karte.textContent).toContain('Besichtigung Montag');
    expect(screen.queryByRole('button', { name: '🧠 Im Gedächtnis ablegen' })).toBeNull();
    expect(t.abgelegt).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Ändern' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Text im Gedächtnis' }), { target: { value: 'Besichtigung Montag 10 Uhr' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ablegen' })); });
    expect(t.abgelegt).toEqual([{ bezug: { art: 'deal', id: 'd1' }, titel: 'Termin', text: 'Besichtigung Montag 10 Uhr', gespraechId: 'g1', nachricht: 1 }]);
    expect(await screen.findByText('✓ Im Gedächtnis abgelegt: Termin')).toBeTruthy();
  });

  it('Vorschlag verwerfen; Gespräch im Verlauf löschen (mit Rückfrage in der Zeile)', async () => {
    const t = attrappe('Notiert.', { titel: 'Termin', text: 'x' });
    render(<KiLeisteRahmen transport={t}><Dialog b={{ art: 'deal', id: 'd1' }} /><KiLeiste /></KiLeisteRahmen>);
    await screen.findByText('Deal: Titel d1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Frage an die KI' }), { target: { value: 'Merk dir das' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Senden' })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' })); });
    expect(await screen.findByText('Vorschlag fürs Gedächtnis verworfen.')).toBeTruthy();
    expect(t.abgelegt).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Gespräch löschen: Frühere Frage' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Wirklich löschen' })); });
    expect(t.geloescht).toEqual(['alt']);
  });

  it('Titelvorschlag: erste Überschrift, sonst die Frage', () => {
    expect(titelVorschlag('Text\n\n## **Lage** und Umfeld', 'Frage')).toBe('Lage und Umfeld');
    expect(titelVorschlag('ohne Überschrift', 'Wie ist die Lage?')).toBe('Wie ist die Lage?');
  });

  it('HTTP-Transport: Pfade, Rumpf und Fehlermeldung des Dienstes', async () => {
    const holen = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/stand')
      ? new Response(JSON.stringify({ fehler: 'Kein Zugriff' }), { status: 403 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const t = httpTransport('/api/ki-leiste/', holen);
    await t.bezug({ art: 'deal', id: 'a/b' });
    await t.senden({ text: 'x' });
    expect(holen.mock.calls.map((c) => c[0])).toEqual(['/api/ki-leiste/bezug/deal/a%2Fb', '/api/ki-leiste/senden']);
    expect(holen.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: '{"text":"x"}' });
    await expect(t.stand()).rejects.toThrow('Kein Zugriff');
  });
});
