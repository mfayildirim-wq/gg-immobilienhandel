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
  /** Gesprächsfenster ohne Startwort (Standard `GESPRAECH_MS`) */
  gespraechMs?: number;
  /** Solange der Agent selbst spricht oder arbeitet, nichts aufnehmen — sonst hört er sich selbst */
  stumm?: boolean;
}

/** Was ein Fehler der Spracherkennung des Browsers bedeutet — `null`: nicht melden (Abbruch durch uns) */
export function erkennungsFehler(code: string): string | null {
  switch (code) {
    case 'aborted': return null;
    case 'not-allowed':
    case 'service-not-allowed': return 'Kein Zugriff aufs Mikrofon — bitte im Browser erlauben (Schloss-Symbol in der Adresszeile).';
    case 'network': return 'Die Spracherkennung des Browsers ist nicht erreichbar. Chrome, Edge und Safari nutzen dafür einen Online-Dienst — in Brave, Arc, Opera oder Chromium fehlt er.';
    case 'audio-capture': return 'Kein Mikrofon gefunden — ist eines angeschlossen und in den Systemeinstellungen erlaubt?';
    case 'no-speech': return 'Nichts gehört — bitte etwas lauter oder näher am Mikrofon sprechen.';
    case 'language-not-supported': return 'Deutsch wird von der Spracherkennung dieses Browsers nicht unterstützt.';
    default: return `Spracherkennung: ${code}`;
  }
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
 * Nach so viel Stille gilt der Satz als fertig. Das Satzende der Browser-Erkennung schnitt beim Luftholen ab (28.09.),
 * 2,5 s waren zu lang — 1,5 s trägt eine Atempause; wer schneller will, sagt das Endwort.
 */
export const STILLE_MS = 1500;
/** Nach einem Endwort so lange warten, ob noch etwas folgt („mach …“ kann auch ein Satzanfang sein) */
export const ENDWORT_MS = 400;
/**
 * Im Gespräch: nach dem Startwort, nach jedem Auftrag und nach jeder Antwort gilt so lange kein Startwort
 * (zum Testen 30 s, Wunsch des Auftraggebers 28.09.)
 */
export const GESPRAECH_MS = 30_000;
/** Nach dem Sprechen des Agenten so lange warten, bevor wieder zugehört wird (Nachhall aus dem Lautsprecher) */
export const NACHHALL_MS = 600;
/** Längste Aufnahme */
const AUFNAHME_MAX_MS = 30_000;

export function useZuhoeren(aufText: (text: string, fertig: boolean) => void, optionen: ZuhoerenOptionen = {}) {
  const aufnahmeMoeglich = () => typeof window !== 'undefined' && !!optionen.transkribieren && typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia;
  const [moeglich] = useState(() => erkennungKlasse() !== null || aufnahmeMoeglich());
  const [hoert, setHoert] = useState(false);
  const [pegel, setPegel] = useState(0);
  const pegelStufe = useRef(0);
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
    pegelStufe.current = 0;
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
        // Neu zeichnen nur bei spürbarer Änderung — und im Dauerbetrieb nur im Gespräch (sonst 12× je Sekunde der ganze Block)
        const stufe = dauerRef.current && Date.now() > wachBis.current ? 0 : Math.round(p * 10) / 10;
        if (stufe !== pegelStufe.current) { pegelStufe.current = stufe; setPegel(stufe); }
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
        .then((roh) => {
          const text = nachRufname(roh, optionenRef.current.rufname || RUFNAME) || roh;
          aufTextRef.current(ohneEndwort(text, optionenRef.current.endwoerter ?? ENDWOERTER) ?? text.trim(), true);
        })
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

  const wachTimer = useRef(0);
  /** Gesprächsfenster (neu) öffnen: so lange gilt kein Startwort */
  const gespraechOffen = useCallback(() => {
    const ms = optionenRef.current.gespraechMs ?? GESPRAECH_MS;
    wachBis.current = Date.now() + ms;
    setWach(true);
    window.clearTimeout(wachTimer.current);
    wachTimer.current = window.setTimeout(() => { if (Date.now() >= wachBis.current) setWach(false); }, ms + 50);
  }, []);
  // Hat der Agent geantwortet (spricht/arbeitet nicht mehr), beginnt das Fenster von vorn — man antwortet ohne Startwort
  const stumm = !!optionen.stumm;
  // Das Fenster ruht, solange der Agent arbeitet — auch wenn die Antwort länger als das Fenster dauert
  const imGespraech = useRef(false);
  useEffect(() => {
    if (stumm) { imGespraech.current = dauerRef.current && Date.now() < wachBis.current; return; }
    if (imGespraech.current && dauerRef.current) gespraechOffen();
    imGespraech.current = false;
  }, [stumm, gespraechOffen]);

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
    /** Dieser Satz wurde angenommen (Startwort oder im Gespräch) — er gilt zu Ende, auch wenn das Fenster abläuft */
    let angenommen = false;
    const abschliessen = () => {
      window.clearTimeout(pause);
      if (letzter && dauerRef.current) gespraechOffen();
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
        // Außerhalb des Gesprächs zählt nur, was nach dem Startwort kommt
        if (auftrag === null && !angenommen && Date.now() > wachBis.current) return;
        if (auftrag !== null) gespraechOffen();
        angenommen = true;
        text = auftrag ?? text;
        // Nur der Name — auf den Auftrag warten, ohne die Erkennung abzubrechen
        if (!text) return;
      } else {
        // Startwort gilt immer: beim Drücken-und-Sprechen nicht nötig, aber wenn gesagt, nicht Teil des Auftrags
        const auftrag = nachRufname(text, optionenRef.current.rufname || RUFNAME);
        if (auftrag) text = auftrag;
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
        // Chrome beendet die Erkennung nach Stille von selbst — im Dauerbetrieb gleich wieder zuhören
        window.setTimeout(() => { if (dauerRef.current && !optionenRef.current.stumm) erkennenRef.current(); }, 100);
        return;
      }
      setHoert(false);
      pegelStoppen();
    };
    e.onerror = (f) => {
      // Jeden Fehler sagen — still zu verstummen verwirrt („ich spreche, aber nichts passiert“)
      const meldung = erkennungsFehler(f.error);
      if (!meldung) return;
      if (f.error !== 'no-speech') { dauerRef.current = false; setDauer(false); }
      optionenRef.current.onFehler?.(meldung);
    };
    erkennung.current = e;
    setHoert(true);
    if (!audio.current) void pegelStarten();
    e.start();
  }, [pegelStarten, pegelStoppen]);
  const erkennenRef = useRef(erkennen);
  erkennenRef.current = erkennen;

  // Solange der Agent spricht oder arbeitet: gar nicht zuhören. Die Erkennung des Browsers sammelt sonst seine eigene
  // Stimme und gibt sie mit dem nächsten Ergebnis heraus — dann stand der Text des Agenten im Feld und ging ab (Echo).
  // Danach im Dauerbetrieb wieder an, mit etwas Abstand gegen Nachhall.
  useEffect(() => {
    if (stumm) {
      const e = erkennung.current;
      if (e) { erkennung.current = null; e.onresult = null; e.onend = null; e.onerror = null; e.abort(); }
      if (!dauerRef.current) { setHoert(false); pegelStoppen(); }
      return;
    }
    if (!dauerRef.current) return;
    const t = window.setTimeout(() => { if (dauerRef.current && !erkennung.current && !optionenRef.current.stumm) erkennenRef.current(); }, NACHHALL_MS);
    return () => window.clearTimeout(t);
  }, [stumm, pegelStoppen]);

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
