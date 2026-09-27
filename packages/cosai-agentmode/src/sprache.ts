/**
 * Sprache im Browser (Stufe 1, Web Speech API): Vorlesen (aus CoSAi `vorlesen.ts`) und Zuhören (SpeechRecognition).
 * Beides aus als Vorgabe — eine Seite, die ungefragt spricht oder lauscht, erschreckt. Kann der Browser es nicht,
 * meldet der Hook `moeglich: false`, und der Schalter verschwindet, statt nichts zu tun.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const TON = 'cosai.ton';

/** Höchstens so viele Zeichen werden vorgelesen — der volle Text steht auf dem Bildschirm */
const SPRECH_MAX = 280;

/**
 * Was vorgelesen wird: ohne Markdown (Sternchen, Rauten, Backticks, Aufzählungszeichen), nur der erste Absatz, am
 * Satzende gekürzt. Lange Antworten mit Listen vorzulesen dauert Minuten — Rückmeldung des Auftraggebers (27.09.).
 */
export function sprechfassung(text: string): string {
  // Erst den ersten Absatz nehmen (Leerzeile oder Beginn einer Aufzählung), dann das Markdown entfernen
  const ohneCode = text.replace(/```[\s\S]*?```/g, ' ').trim();
  const absatz = ohneCode.split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+\.)\s)/)[0] ?? '';
  const flach = absatz
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flach.length <= SPRECH_MAX) return flach;
  const saetze = flach.match(/[^.!?]+[.!?]+/g) ?? [];
  let kurz = '';
  for (const satz of saetze) {
    if ((kurz + satz).trim().length > SPRECH_MAX) break;
    kurz += satz;
  }
  return kurz.trim() || `${flach.slice(0, SPRECH_MAX - 1).replace(/\s+\S*$/, '')} …`;
}

/** „Stopp“, „Halt“, „Ruhe“ … — bricht das Vorlesen ab, statt als Auftrag zu gelten. */
export function istStoppwort(text: string): boolean {
  return /^(stopp?|halt|ruhe|genug|aufhören|sei still|still)$/.test(text.toLowerCase().replace(/[.!?,]/g, '').trim());
}

export function useVorlesen(saatwert = 'agent') {
  const [moeglich, setMoeglich] = useState(false);
  const [an, setAn] = useState(false);
  const [spricht, setSpricht] = useState(false);
  const stimme = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setMoeglich(true);
    try { setAn(window.localStorage.getItem(TON) === 'an'); } catch { /* privater Modus */ }
    const waehle = () => {
      const alle = window.speechSynthesis.getVoices();
      stimme.current = alle.find((v) => v.lang === 'de-DE' && v.localService) ?? alle.find((v) => v.lang.startsWith('de')) ?? null;
    };
    waehle();
    window.speechSynthesis.addEventListener('voiceschanged', waehle);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', waehle);
      window.speechSynthesis.cancel();
    };
  }, []);

  const schalte = useCallback((neu: boolean) => {
    setAn(neu);
    try { window.localStorage.setItem(TON, neu ? 'an' : 'aus'); } catch { /* gilt dann nur für diese Seite */ }
    if (!neu) window.speechSynthesis?.cancel();
  }, []);

  /** Spricht den Satz zu Ende und meldet, wenn er fertig ist — nie dazwischenreden. */
  const sprich = useCallback((text: string): Promise<void> => {
    if (!an || !moeglich || !text) return Promise.resolve();
    return new Promise((fertig) => {
      const fassung = sprechfassung(text);
      const u = new SpeechSynthesisUtterance(fassung.replace(/[„“"…]/g, ' '));
      u.lang = 'de-DE';
      if (stimme.current) u.voice = stimme.current;
      let h = 0;
      for (let i = 0; i < saatwert.length; i++) h = (h * 31 + saatwert.charCodeAt(i)) >>> 0;
      u.pitch = 0.9 + ((h % 7) / 6) * 0.3;
      u.rate = 1.02;
      // Manche Browser melden das Ende nie (Tab im Hintergrund): dann geht es nach einer Frist weiter.
      const frist = setTimeout(() => ende(), 4000 + fassung.length * 110);
      const ende = () => { clearTimeout(frist); setSpricht(false); fertig(); };
      u.onstart = () => setSpricht(true);
      u.onend = ende;
      u.onerror = ende;
      window.speechSynthesis.speak(u);
    });
  }, [an, moeglich, saatwert]);

  const stoppe = useCallback(() => { window.speechSynthesis?.cancel(); setSpricht(false); }, []);

  return { moeglich, an, spricht, schalte, sprich, stoppe };
}

type Erkennung = { start: () => void; stop: () => void; abort: () => void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
type ErkennungKonstruktor = new () => Erkennung;

function erkennungKlasse(): ErkennungKonstruktor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: ErkennungKonstruktor; webkitSpeechRecognition?: ErkennungKonstruktor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Zuhören: ein Druck auf den Kreis startet, das Ergebnis kommt als Text (Zwischenstand während des Sprechens,
 * `fertig` am Ende). Der Pegel kommt aus der Lautstärke des Mikrofons (AudioContext), damit der Kreis mitatmet.
 */
export function useZuhoeren(aufText: (text: string, fertig: boolean) => void) {
  const [moeglich] = useState(() => erkennungKlasse() !== null);
  const [hoert, setHoert] = useState(false);
  const [pegel, setPegel] = useState(0);
  const erkennung = useRef<Erkennung | null>(null);
  const audio = useRef<{ ctx: AudioContext; strom: MediaStream; timer: number } | null>(null);
  const aufTextRef = useRef(aufText);
  aufTextRef.current = aufText;

  const pegelStoppen = useCallback(() => {
    if (!audio.current) return;
    window.clearInterval(audio.current.timer);
    audio.current.strom.getTracks().forEach((t) => t.stop());
    void audio.current.ctx.close();
    audio.current = null;
    setPegel(0);
  }, []);

  const pegelStarten = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return;
    try {
      const strom = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const quelle = ctx.createMediaStreamSource(strom);
      const analyse = ctx.createAnalyser();
      analyse.fftSize = 512;
      quelle.connect(analyse);
      const daten = new Uint8Array(analyse.frequencyBinCount);
      const timer = window.setInterval(() => {
        analyse.getByteTimeDomainData(daten);
        let summe = 0;
        for (const d of daten) summe += (d - 128) ** 2;
        setPegel(Math.min(1, Math.sqrt(summe / daten.length) / 40));
      }, 80);
      audio.current = { ctx, strom, timer };
    } catch {
      // kein Mikrofon-Pegel — die Erkennung läuft trotzdem
    }
  }, []);

  const stoppe = useCallback(() => {
    erkennung.current?.stop();
    erkennung.current = null;
    setHoert(false);
    pegelStoppen();
  }, [pegelStoppen]);

  const starte = useCallback(() => {
    const Klasse = erkennungKlasse();
    if (!Klasse || erkennung.current) return;
    const e = new Klasse();
    e.lang = 'de-DE';
    e.interimResults = true;
    e.continuous = false;
    e.onresult = (ev) => {
      let text = '';
      let fertig = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        text += r[0]?.transcript ?? '';
        if (r.isFinal) fertig = true;
      }
      aufTextRef.current(text.trim(), fertig);
    };
    e.onend = () => { erkennung.current = null; setHoert(false); pegelStoppen(); };
    e.onerror = () => { erkennung.current = null; setHoert(false); pegelStoppen(); };
    erkennung.current = e;
    setHoert(true);
    void pegelStarten();
    e.start();
  }, [pegelStarten, pegelStoppen]);

  useEffect(() => () => { erkennung.current?.abort(); pegelStoppen(); }, [pegelStoppen]);

  return { moeglich, hoert, pegel, starte, stoppe };
}
