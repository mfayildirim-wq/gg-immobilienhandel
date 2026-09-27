import { describe, expect, it } from 'vitest';
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
