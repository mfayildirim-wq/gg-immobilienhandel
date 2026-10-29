import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KiAblegen, KiAenderung, KiAenderungEntscheiden, KiBezug, KiGespraech } from '@gg/ki-kern/vertrag';
import { httpTransport, KiKnopf, KiLeiste, KiLeisteRahmen, type KiTransport, titelVorschlag, useKiBezug } from '../src/index.ts';

afterEach(cleanup);

function attrappe(antwort = '## Vergleich\n\nDrei Angebote', vorschlag?: { titel: string; text: string }, aenderungen?: KiAenderung[]): KiTransport & { gesendet: unknown[]; abgelegt: KiAblegen[]; geloescht: string[]; entschieden: KiAenderungEntscheiden[] } {
  const entschieden: KiAenderungEntscheiden[] = [];
  const gesendet: unknown[] = [];
  const abgelegt: KiAblegen[] = [];
  const geloescht: string[] = [];
  const gespeichert = new Map<string, KiGespraech>();
  return {
    gesendet, abgelegt, geloescht, entschieden,
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
        nachrichten: [{ rolle: 'nutzer', text: s.text, am: '1' }, { rolle: 'ki', text: antwort, am: '2', gedaechtnis: 1, schritte: [{ art: 'websuche', name: 'web_search', ok: true, kurz: 'Ulm' }], ...(vorschlag ? { vorschlag } : {}), ...(aenderungen ? { aenderungen } : {}) }],
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
    async aenderungEntscheiden(a) {
      entschieden.push(a);
      const g = gespeichert.get(a.gespraechId)!;
      const n = g.nachrichten[a.nachricht]!;
      const status = a.aktion === 'verwerfen' ? 'verworfen' as const : n.aenderungen![a.aenderung]!.argumente.version === 1 ? 'uebernommen' as const : 'fehler' as const;
      g.nachrichten[a.nachricht] = { ...n, aenderungen: n.aenderungen!.map((x, i) => (i === a.aenderung ? { ...x, status, ...(status === 'fehler' ? { ergebnis: 'Makler wurde zwischenzeitlich geändert' } : {}) } : x)) };
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

  it('Änderung der KI: Karte mit Feldern (ohne Version); erst „Übernehmen“ speichert, danach lädt die App neu; Fehler und Verwerfen an der Karte', async () => {
    const t = attrappe('Zwei Änderungen vorgeschlagen.', undefined, [
      { werkzeug: 'update_makler', titel: 'Makler ändern', argumente: { id: 'm1', version: 1, prio: 'A', mobil: null } },
      { werkzeug: 'update_makler', titel: 'Makler ändern', argumente: { id: 'm1', version: 0, webseite: 'https://b.example' } },
      { werkzeug: 'add_communication', titel: 'Kommunikation beim Makler eintragen', argumente: { maklerId: 'm1', kanal: 'email', text: 'Angebot' } },
    ]);
    const neuLaden = vi.fn();
    render(<KiLeisteRahmen transport={t}><Dialog b={{ art: 'makler', id: 'm1' }} /><KiLeiste nachAenderung={neuLaden} /></KiLeisteRahmen>);
    await screen.findByText('Makler: Titel m1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Frage an die KI' }), { target: { value: 'Prio A' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Senden' })); });
    const karten = await screen.findAllByRole('group', { name: /^Änderung: / });
    expect(karten).toHaveLength(3);
    expect(karten[0]!.textContent).toContain('prioA');
    expect(karten[0]!.textContent).toContain('mobil(leer)');
    expect(karten[0]!.textContent).not.toContain('version');
    expect(t.entschieden).toEqual([]);

    await act(async () => { fireEvent.click(within(karten[0]!).getByRole('button', { name: 'Übernehmen' })); });
    expect(t.entschieden).toEqual([{ gespraechId: 'g1', nachricht: 1, aenderung: 0, aktion: 'uebernehmen' }]);
    expect(await screen.findByText('✓ Übernommen')).toBeTruthy();
    expect(neuLaden).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(within(screen.getAllByRole('group', { name: /^Änderung: / })[1]!).getByRole('button', { name: 'Übernehmen' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('Nicht übernommen: Makler wurde zwischenzeitlich geändert');
    expect(neuLaden).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(within(screen.getAllByRole('group', { name: /^Änderung: / })[2]!).getByRole('button', { name: 'Verwerfen' })); });
    expect(await screen.findByText('Verworfen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull();
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
