import { describe, expect, it, vi } from 'vitest';
import { istStoppwort, sprechfassung } from '../src/sprache.ts';

describe('sprechfassung', () => {
  it('liest ohne Markdown vor und nur den ersten Absatz', () => {
    expect(sprechfassung('**53 Deals** sind fällig.\n\n- Obertürkheimer Straße 11\n- Tübinger Str. 91')).toBe('53 Deals sind fällig.');
    expect(sprechfassung('## Überblick\n`deal.erledigt` ist *wichtig*.')).toBe('Überblick deal.erledigt ist wichtig.');
  });

  it('kürzt lange Texte am Satzende', () => {
    const satz = 'Das ist ein Satz mit etwas Inhalt, damit er lang genug wird. ';
    const lang = satz.repeat(12);
    const kurz = sprechfassung(lang);
    expect(kurz.length).toBeLessThanOrEqual(280);
    expect(kurz.endsWith('.')).toBe(true);
  });
});

describe('istStoppwort', () => {
  it('erkennt Stopp, Halt, Ruhe — aber keinen Auftrag', () => {
    for (const w of ['Stopp', 'stop.', 'Halt!', 'Ruhe', 'sei still', 'genug']) expect(istStoppwort(w), w).toBe(true);
    for (const w of ['Stopp den Deal', 'Stoppuhr', 'nächster Deal']) expect(istStoppwort(w), w).toBe(false);
  });
});

describe('useZuhoeren ohne Spracherkennung (Firefox)', () => {
  it('nimmt auf und lässt transkribieren, wenn der Browser selbst nichts erkennt', async () => {
    const { act, renderHook, waitFor } = await import('@testing-library/react');
    const { useZuhoeren } = await import('../src/sprache.ts');
    const gestoppt: string[] = [];
    Object.assign(navigator, { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => gestoppt.push('spur') }] }) } });
    class FakeRecorder {
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = 'inactive';
      mimeType = 'audio/ogg';
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['ton'], { type: 'audio/ogg' }) }); this.onstop?.(); }
    }
    Object.assign(window, { MediaRecorder: FakeRecorder });
    const texte: [string, boolean][] = [];
    const audios: Blob[] = [];
    const { result } = renderHook(() => useZuhoeren((t, f) => texte.push([t, f]), { transkribieren: async (a) => { audios.push(a); return 'Was ist heute fällig?'; } }));
    expect(result.current.moeglich).toBe(true);
    await act(async () => { result.current.starte(); });
    await waitFor(() => expect(result.current.hoert).toBe(true));
    await act(async () => { result.current.stoppe(); });
    await waitFor(() => expect(texte.at(-1)).toEqual(['Was ist heute fällig?', true]));
    expect(audios[0]?.type).toBe('audio/ogg');
    expect(gestoppt.length).toBeGreaterThan(0);
    expect(result.current.hoert).toBe(false);
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  });

  it('ist ohne Erkennung und ohne Transkription nicht möglich', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useZuhoeren } = await import('../src/sprache.ts');
    const { result } = renderHook(() => useZuhoeren(() => undefined));
    expect(result.current.moeglich).toBe(false);
  });
});

describe('nachRufname', () => {
  it('liefert den Auftrag nach dem Namen — auch getrennt geschrieben; ohne Namen null', async () => {
    const { nachRufname } = await import('../src/sprache.ts');
    expect(nachRufname('Superagent, was ist heute fällig?', 'Superagent')).toBe('was ist heute fällig?');
    expect(nachRufname('hallo Super Agent öffne den ersten Deal', 'Superagent')).toBe('öffne den ersten Deal');
    expect(nachRufname('super-agent', 'Superagent')).toBe('');
    expect(nachRufname('was ist heute fällig', 'Superagent')).toBeNull();
    expect(nachRufname('Jarvis zeig die Makler', 'Jarvis')).toBe('zeig die Makler');
  });
});

/** Browser-Erkennung zum Steuern aus dem Test: `sage(text, final)` liefert ein Ergebnis, `ende()` beendet */
function fakeErkennung() {
  const instanzen: FakeErkennung[] = [];
  class FakeErkennung {
    lang = ''; interimResults = false; continuous = false; laeuft = false;
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    ergebnisse: { transcript: string; final: boolean }[] = [];
    constructor() { instanzen.push(this); }
    start() { this.laeuft = true; }
    stop() { if (this.laeuft) { this.laeuft = false; this.onend?.(); } }
    abort() { this.laeuft = false; }
    sage(text: string, final = true) {
      this.ergebnisse.push({ transcript: text, final });
      const results = this.ergebnisse.map((r) => Object.assign([{ transcript: r.transcript }], { isFinal: r.final }));
      this.onresult?.({ results, resultIndex: 0 });
    }
  }
  Object.assign(window, { SpeechRecognition: FakeErkennung });
  return { instanzen, weg: () => { delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; } };
}

describe('useZuhoeren mit Browser-Erkennung', () => {
  it('schneidet bei einer kurzen Atempause nicht ab — fertig erst nach der Stille', async () => {
    const { act, renderHook } = await import('@testing-library/react');
    const { useZuhoeren, STILLE_MS } = await import('../src/sprache.ts');
    const { instanzen, weg } = fakeErkennung();
    vi.useFakeTimers();
    const texte: [string, boolean][] = [];
    const { result } = renderHook(() => useZuhoeren((t, f) => texte.push([t, f])));
    act(() => { result.current.starte(); });
    const e = instanzen[0]!;
    expect(e.continuous).toBe(true);
    act(() => { e.sage('Kommentar Mailbox besprochen'); });
    act(() => { vi.advanceTimersByTime(1200); });
    act(() => { e.sage(' Rückruf Montag'); });
    expect(texte.some(([, f]) => f)).toBe(false);
    act(() => { vi.advanceTimersByTime(STILLE_MS + 10); });
    expect(texte.at(-1)).toEqual(['Kommentar Mailbox besprochen Rückruf Montag', true]);
    expect(result.current.hoert).toBe(false);
    vi.useRealTimers();
    weg();
  });

  it('dauerhaft: reagiert nur auf den Rufnamen, hört danach weiter und schweigt, solange der Agent spricht', async () => {
    const { act, renderHook } = await import('@testing-library/react');
    const { useZuhoeren, STILLE_MS } = await import('../src/sprache.ts');
    const { instanzen, weg } = fakeErkennung();
    vi.useFakeTimers();
    const texte: [string, boolean][] = [];
    let stumm = false;
    const { result, rerender } = renderHook(() => useZuhoeren((t, f) => texte.push([t, f]), { rufname: 'Superagent', stumm }));
    act(() => { result.current.dauerSchalten(true); });
    expect(result.current.dauer).toBe(true);
    let e = instanzen.at(-1)!;
    act(() => { e.sage('wir reden über das Wetter'); });
    act(() => { vi.advanceTimersByTime(STILLE_MS + 10); });
    expect(texte).toEqual([]);
    // Chrome beendet nach Stille — die Erkennung startet von selbst neu
    act(() => { e.stop(); vi.advanceTimersByTime(300); });
    e = instanzen.at(-1)!;
    expect(e.laeuft).toBe(true);
    act(() => { e.sage('Super Agent was ist heute fällig'); });
    expect(result.current.wach).toBe(true);
    act(() => { vi.advanceTimersByTime(STILLE_MS + 10); });
    expect(texte.at(-1)).toEqual(['was ist heute fällig', true]);
    act(() => { vi.advanceTimersByTime(300); });
    // Der Agent spricht: nichts aufnehmen
    stumm = true;
    rerender();
    e = instanzen.at(-1)!;
    const vorher = texte.length;
    act(() => { e.sage('Superagent das hat der Agent selbst gesagt'); vi.advanceTimersByTime(STILLE_MS + 10); });
    expect(texte.length).toBe(vorher);
    act(() => { result.current.dauerSchalten(false); });
    expect(result.current.hoert).toBe(false);
    vi.useRealTimers();
    weg();
  });
});
