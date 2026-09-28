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
export interface ZuhoerenOptionen {
  /**
   * Für Browser ohne eigene Spracherkennung (Firefox): Aufnahme per MediaRecorder, der Host macht Text daraus
   * (in gg-immo: Whisper über /api/transkription). Ohne diese Option gibt es dort kein Mikrofon.
   */
  transkribieren?: (audio: Blob) => Promise<string>;
  /** Fehler der Aufnahme oder Transkription (z. B. kein Schlüssel hinterlegt) */
  onFehler?: (meldung: string) => void;
  /** Dauerhaft zuhören: nur, was nach diesem Namen gesagt wird, gilt als Auftrag (Standard „Superagent“) */
  rufname?: string;
  /** Endwörter: steht eines am Ende („… Rückruf Montag, fertig“), geht der Auftrag gleich ab — ohne die Pause */
  endwoerter?: string[];
  /** Solange der Agent selbst spricht, nichts aufnehmen — sonst hört er sich selbst */
  stumm?: boolean;
}

/** Standard-Endwörter */
export const ENDWOERTER = ['fertig', 'mach'];

/** Der Text ohne das Endwort an seinem Ende — `null`, wenn keines am Ende steht */
export function ohneEndwort(text: string, endwoerter: string[]): string | null {
  const t = text.trim().replace(/[\s.!?,;:]+$/, '');
  for (const w of endwoerter.map((x) => x.trim()).filter(Boolean)) {
    const m = new RegExp(`(^|[\\s,.;:!?-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').exec(t);
    if (m) return t.slice(0, m.index + m[1]!.length).replace(/[\s,.;:!?-]+$/, '').trim();
  }
  return null;
}

/** Standard-Rufname für das dauerhafte Zuhören */
export const RUFNAME = 'Superagent';

/**
 * Der Auftrag nach dem Rufnamen — `null`, wenn der Name nicht fiel. Die Erkennung schreibt Namen gern getrennt
 * („Super Agent“, „Super-Agent“), deshalb sind Leerzeichen und Bindestriche zwischen den Buchstaben erlaubt.
 */
export function nachRufname(text: string, rufname: string): string | null {
  const buchstaben = [...rufname.replace(/[\s-]/g, '')].map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!buchstaben.length) return null;
  const m = new RegExp(buchstaben.join('[\\s-]?'), 'i').exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim();
}

/**
 * Nach so viel Stille gilt der Satz als fertig — lang genug für eine Atempause (vorher 1,6 s bzw. das Satzende der
 * Browser-Erkennung: kurzes Luftholen schnitt ab, Rückmeldung des Auftraggebers 28.09.)
 */
export const STILLE_MS = 2500;
/** Nach einem Endwort so lange warten, ob noch etwas folgt */
const ENDWORT_MS = 700;
/** Nach dem Rufnamen allein so lange auf den Auftrag warten */
const WACH_MS = 8000;
/** Längste Aufnahme */
const AUFNAHME_MAX_MS = 30_000;

export function useZuhoeren(aufText: (text: string, fertig: boolean) => void, optionen: ZuhoerenOptionen = {}) {
  const aufnahmeMoeglich = () => typeof window !== 'undefined' && !!optionen.transkribieren && typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia;
  const [moeglich] = useState(() => erkennungKlasse() !== null || aufnahmeMoeglich());
  const [hoert, setHoert] = useState(false);
  const [pegel, setPegel] = useState(0);
  const erkennung = useRef<Erkennung | null>(null);
  const aufnahme = useRef<{ recorder: MediaRecorder; strom: MediaStream; ende: number } | null>(null);
  const audio = useRef<{ ctx: AudioContext; strom: MediaStream; timer: number; eigen: boolean } | null>(null);
  const laut = useRef<{ gehoert: boolean; zuletzt: number }>({ gehoert: false, zuletzt: 0 });
  const aufTextRef = useRef(aufText);
  aufTextRef.current = aufText;
  const optionenRef = useRef(optionen);
  optionenRef.current = optionen;
  const stoppeRef = useRef<() => void>(() => undefined);

  const pegelStoppen = useCallback(() => {
    if (!audio.current) return;
    window.clearInterval(audio.current.timer);
    if (audio.current.eigen) audio.current.strom.getTracks().forEach((t) => t.stop());
    void audio.current.ctx.close();
    audio.current = null;
    setPegel(0);
  }, []);

  /** Pegel für den Sprechkreis — und ohne eigene Erkennung: Ende der Aufnahme nach Stille. */
  const pegelStarten = useCallback(async (vorhanden?: MediaStream) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return;
    try {
      const strom = vorhanden ?? await navigator.mediaDevices.getUserMedia({ audio: true });
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
        const p = Math.min(1, Math.sqrt(summe / daten.length) / 40);
        setPegel(p);
        if (aufnahme.current) {
          const jetzt = Date.now();
          if (p > 0.12) laut.current = { gehoert: true, zuletzt: jetzt };
          if ((laut.current.gehoert && jetzt - laut.current.zuletzt > STILLE_MS) || jetzt > aufnahme.current.ende) stoppeRef.current();
        }
      }, 80);
      audio.current = { ctx, strom, timer, eigen: !vorhanden };
    } catch {
      // kein Mikrofon-Pegel — die Erkennung läuft trotzdem
    }
  }, []);

  const stoppe = useCallback(() => {
    erkennung.current?.stop();
    erkennung.current = null;
    const a = aufnahme.current;
    aufnahme.current = null;
    if (a && a.recorder.state !== 'inactive') a.recorder.stop();
    setHoert(false);
    pegelStoppen();
  }, [pegelStoppen]);
  stoppeRef.current = stoppe;

  /** Ohne eigene Spracherkennung: aufnehmen, bei Stille oder Klick beenden, dann transkribieren lassen. */
  const aufnahmeStarten = useCallback(async () => {
    const { transkribieren, onFehler } = optionenRef.current;
    if (!transkribieren || aufnahme.current) return;
    let strom: MediaStream;
    try {
      strom = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onFehler?.('Kein Zugriff aufs Mikrofon — bitte im Browser erlauben.');
      return;
    }
    const Recorder = (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder;
    const recorder = new Recorder(strom);
    const teile: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) teile.push(e.data); };
    recorder.onstop = () => {
      strom.getTracks().forEach((t) => t.stop());
      const ton = new Blob(teile, { type: recorder.mimeType || 'audio/webm' });
      if (!ton.size) return;
      aufTextRef.current('…', false);
      transkribieren(ton)
        .then((text) => aufTextRef.current(ohneEndwort(text, optionenRef.current.endwoerter ?? ENDWOERTER) ?? text.trim(), true))
        .catch((e: Error) => { aufTextRef.current('', false); onFehler?.(e.message); });
    };
    laut.current = { gehoert: false, zuletzt: Date.now() };
    aufnahme.current = { recorder, strom, ende: Date.now() + AUFNAHME_MAX_MS };
    recorder.start();
    setHoert(true);
    void pegelStarten(strom);
  }, [pegelStarten]);

  const [dauer, setDauer] = useState(false);
  const dauerRef = useRef(false);
  /** Dauerhaft: der Rufname fiel gerade (auch ohne Auftrag) — der nächste Satz gilt */
  const [wach, setWach] = useState(false);
  const wachBis = useRef(0);
  const dauerMoeglich = erkennungKlasse() !== null;

  /**
   * Browser-Erkennung fortlaufend: Zwischenstände gehen sofort hinaus, fertig ist der Satz erst nach `STILLE_MS`
   * ohne neues Wort. Danach endet die Erkennung; im Dauerbetrieb startet sie von vorn.
   */
  const erkennen = useCallback(() => {
    const Klasse = erkennungKlasse();
    if (!Klasse || erkennung.current) return;
    const e = new Klasse();
    e.lang = 'de-DE';
    e.interimResults = true;
    e.continuous = true;
    let pause = 0;
    let letzter = '';
    const abschliessen = () => {
      window.clearTimeout(pause);
      if (letzter) aufTextRef.current(letzter, true);
      letzter = '';
      e.stop();
    };
    e.onresult = (ev) => {
      if (optionenRef.current.stumm) return;
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]?.transcript ?? '';
      text = text.trim();
      if (dauerRef.current) {
        const auftrag = nachRufname(text, optionenRef.current.rufname || RUFNAME);
        if (auftrag === null && Date.now() > wachBis.current) return;
        if (auftrag !== null) { wachBis.current = Date.now() + WACH_MS; setWach(true); }
        text = auftrag ?? text;
        // Nur der Name — auf den Auftrag warten, ohne die Erkennung abzubrechen
        if (!text) return;
      }
      // Endwort am Ende: kurz abwarten, ob noch etwas kommt („mach …“ kann auch ein Satzanfang sein), dann ab
      const ohne = ohneEndwort(text, optionenRef.current.endwoerter ?? ENDWOERTER);
      letzter = ohne ?? text;
      aufTextRef.current(letzter, false);
      window.clearTimeout(pause);
      pause = window.setTimeout(abschliessen, ohne !== null ? ENDWORT_MS : STILLE_MS);
    };
    e.onend = () => {
      window.clearTimeout(pause);
      // Beendet per Klick, bevor die Pause um war: das Gesagte gilt trotzdem
      if (letzter) aufTextRef.current(letzter, true);
      letzter = '';
      erkennung.current = null;
      if (dauerRef.current) {
        if (Date.now() > wachBis.current) setWach(false);
        // Chrome beendet die Erkennung nach Stille von selbst — im Dauerbetrieb gleich wieder zuhören
        window.setTimeout(() => { if (dauerRef.current) erkennenRef.current(); }, 250);
        return;
      }
      setHoert(false);
      pegelStoppen();
    };
    e.onerror = (f) => {
      if (f.error === 'not-allowed' || f.error === 'service-not-allowed') {
        dauerRef.current = false;
        setDauer(false);
        optionenRef.current.onFehler?.('Kein Zugriff aufs Mikrofon — bitte im Browser erlauben.');
      }
    };
    erkennung.current = e;
    setHoert(true);
    if (!audio.current) void pegelStarten();
    e.start();
  }, [pegelStarten, pegelStoppen]);
  const erkennenRef = useRef(erkennen);
  erkennenRef.current = erkennen;

  const starte = useCallback(() => {
    if (!erkennungKlasse()) { void aufnahmeStarten(); return; }
    erkennen();
  }, [aufnahmeStarten, erkennen]);

  /** Dauerhaft zuhören an/aus — reagiert nur auf den Rufnamen */
  const dauerSchalten = useCallback((an: boolean) => {
    if (!dauerMoeglich) return;
    dauerRef.current = an;
    setDauer(an);
    setWach(false);
    wachBis.current = 0;
    if (an) erkennen();
    else { erkennung.current?.abort(); erkennung.current = null; setHoert(false); pegelStoppen(); }
  }, [dauerMoeglich, erkennen, pegelStoppen]);

  // Beim Schließen: Aufnahme verwerfen (nichts mehr zur kostenpflichtigen Transkription schicken)
  useEffect(() => () => {
    dauerRef.current = false;
    erkennung.current?.abort();
    const a = aufnahme.current;
    aufnahme.current = null;
    if (a) { a.recorder.onstop = () => a.strom.getTracks().forEach((t) => t.stop()); if (a.recorder.state === 'recording') a.recorder.stop(); }
    pegelStoppen();
  }, [pegelStoppen]);

  return { moeglich, hoert, pegel, starte, stoppe, dauer, dauerMoeglich, dauerSchalten, wach };
}
