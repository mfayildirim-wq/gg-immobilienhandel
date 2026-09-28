/**
 * AgentMode — Overlay über der laufenden App oder eigene Seite, aus einer Komponente.
 *
 * Oben ein Block über die ganze Breite: Sprechkreis, Agent-Blase mit Chips, Du-Blase mit Eingabe und Symbolknöpfen. Darunter: im Overlay die App im Schaufenster (sehen, nicht
 * klicken, solange der Agent handelt), auf der Seite der Inhalt des Hosts (Kontextkarte, Todos) und der Zeitstrahl.
 * Der Kanal läuft über `anfrage` des Hosts (mit dessen
 * Anmeldung) gegen die Routen des Kerns; Steuerungen führt die Oberfläche Schritt für Schritt sichtbar aus.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chips, Gedaechtnisleiste, Schaufenster, Sprechblase, type ChipDaten, type GedaechtnisEintragDaten, type Schritt } from './Bausteine.tsx';
import { ErgebnisBereich, ErgebnisDialog, type ErgebnisDaten } from './Ergebnisse.tsx';
import { ausfuehren, bereichVon, beobachten, fokusBezuege, fokusLesen, zielFinden, zielKontext, type Beobachtung, type Steuerung } from './kanal.ts';
import { saatAus } from './konstellation.ts';
import { heuteLokal } from './lernen.tsx';
import { Sprechkreis, SPRECHKREIS_STILE, type SprechkreisStil, type SprechkreisZustand } from './Sprechkreis.tsx';
import { ENDWOERTER, istStoppwort, RUFNAME, useVorlesen, useZuhoeren } from './sprache.ts';

export interface AgentAntwortDaten {
  sitzungId: string;
  text: string;
  steuerung: Steuerung[];
  chips: ChipDaten[];
  wartetAuf?: { frage: string; aktion: Steuerung };
}

interface Zeile { wer: 'agent' | 'nutzer'; text: string; nr: number }

/** Eine erkannte Routine des Nutzers (Kern: `GET /routinen`) */
export interface RoutineDaten { id: string; label: string; auftrag: string }

export interface AgentModeProps {
  /** Basis der Kern-Routen, z. B. `/api/agent` */
  api: string;
  /** Aufruf mit der Anmeldung des Hosts (Token, Cookie) */
  anfrage: (pfad: string, init?: RequestInit) => Promise<Response>;
  modus: 'overlay' | 'seite';
  /** Seitenwechsel für `navigiere nav.<seite>` — der Host kennt seinen Router */
  navigiere: (ziel: string) => void | Promise<void>;
  /** Wo der Nutzer gerade ist (Pfad) und was gewählt ist */
  ort: string;
  kontext?: Record<string, string | number | boolean | null>;
  stil: SprechkreisStil;
  onStil?: (stil: SprechkreisStil) => void;
  /** Overlay: die App; Seite: der Inhalt der Mitte (Kontextkarte, Todos) */
  children?: ReactNode;
  schliessen?: () => void;
  /** Wartezeit zwischen zwei sichtbaren Schritten */
  schrittMs?: number;
  farbe?: string;
  /** Wird nach einer ausgeführten Steuerung gerufen — z. B. um Daten neu zu laden */
  onSteuerung?: (s: Steuerung) => void;
  /** Für Browser ohne eigene Spracherkennung (Firefox): Aufnahme → Text über den Host */
  transkribieren?: (audio: Blob) => Promise<string>;
  /** ⚙ im Block: öffnet die Einstellungen des Agenten (Immer/Nie, Anbieter) beim Host */
  einstellungen?: () => void;
  /** Overlay: Knopf unter dem Kreis, der zum Agent-Dialog (eigene Seite des Hosts) wechselt */
  zurSeite?: () => void;
}

const SITZUNG = 'cosai.sitzung';

/** Popup am ▾ neben 🎤: Betriebsart „Immer zuhören“, Startwort (Rufname) und Endwörter — Esc, Enter oder Klick daneben schließt und speichert */
function Sprachmenue({ ohr, ohrMoeglich, ohrSchalten, rufname, endwoerter, speichern, schliessen }: {
  ohr: boolean; ohrMoeglich: boolean; ohrSchalten: (an: boolean) => void; rufname: string; endwoerter: string[];
  speichern: (rufname: string, endwoerter: string) => void; schliessen: () => void;
}) {
  const [start, setStart] = useState(rufname);
  const [ende, setEnde] = useState(endwoerter.join(', '));
  const feld = useRef<HTMLDivElement>(null);
  const zu = useRef(schliessen);
  zu.current = schliessen;
  // Gespeichert wird beim Schließen — egal wie (Esc, Klick daneben, 👂, Enter)
  const stand = useRef({ start, ende, speichern });
  stand.current = { start, ende, speichern };
  useEffect(() => () => stand.current.speichern(stand.current.start, stand.current.ende), []);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') zu.current(); };
    const klick = (e: MouseEvent) => { if (feld.current && !feld.current.parentElement?.contains(e.target as Node)) zu.current(); };
    window.addEventListener('keydown', taste);
    document.addEventListener('mousedown', klick);
    return () => { window.removeEventListener('keydown', taste); document.removeEventListener('mousedown', klick); };
  }, []);
  return (
    <div ref={feld} className="am-menue" role="dialog" aria-label="Sprachsteuerung">
      <label className="am-menue-zeile">
        <input type="checkbox" checked={ohr} disabled={!ohrMoeglich} onChange={(e) => ohrSchalten(e.currentTarget.checked)} />
        <span>👂 Immer zuhören{ohrMoeglich ? ` — 🎤 bleibt nach dem Drücken an und reagiert auf „${start.trim() || RUFNAME}“` : ' (in diesem Browser nicht möglich)'}</span>
      </label>
      <label className="am-menue-feld">Startwort
        <input aria-label="Startwort" value={start} maxLength={30} placeholder={RUFNAME} onChange={(e) => setStart(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') zu.current(); }} />
      </label>
      <label className="am-menue-feld">Endwörter
        <input aria-label="Endwörter" value={ende} maxLength={80} placeholder={ENDWOERTER.join(', ')} onChange={(e) => setEnde(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') zu.current(); }} />
      </label>
      <p className="am-hinweis">Zum Beispiel: „{start.trim() || RUFNAME}, Notiz Rückruf Montag, {ende.split(',')[0]?.trim() || 'fertig'}“ — das Endwort schickt sofort ab, sonst nach 1,5 s Pause. Im Gespräch (30 s nach Startwort, Auftrag oder Antwort) ist kein Startwort nötig. Ohne 👂: 🎤 drücken und sprechen, das Startwort ist dann nicht nötig.</p>
    </div>
  );
}
/** Dauerhaft zuhören bleibt an, bis es ausgeschaltet wird (auch nach dem Neuladen) — und der Rufname dazu */
const DAUERHOEREN = 'cosai.dauerhoeren';
/** Betriebsart: 👂 angehakt = 🎤 bleibt nach dem Drücken an */
const OHRMODUS = 'cosai.ohrmodus';
const RUFNAME_SCHLUESSEL = 'cosai.rufname';
const ENDWOERTER_SCHLUESSEL = 'cosai.endwoerter';
const lesen = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string | null) => { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* privater Modus */ } };

export function AgentMode({ api, anfrage, modus, navigiere, ort, kontext = {}, stil, onStil, children, schliessen, schrittMs = 700, farbe, onSteuerung, transkribieren, einstellungen, zurSeite }: AgentModeProps) {
  const [sitzungId, setSitzungId] = useState<string | null>(() => { try { return window.localStorage.getItem(SITZUNG); } catch { return null; } });
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [chips, setChips] = useState<ChipDaten[]>([]);
  const [wartetAuf, setWartetAuf] = useState<AgentAntwortDaten['wartetAuf']>(undefined);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const [handelt, setHandelt] = useState(false);
  const [schritt, setSchritt] = useState<Schritt | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [rufname, setRufname] = useState(() => lesen(RUFNAME_SCHLUESSEL) || RUFNAME);
  const [endwoerter, setEndwoerter] = useState(() => (lesen(ENDWOERTER_SCHLUESSEL) ?? ENDWOERTER.join(', ')).split(',').map((w) => w.trim()).filter(Boolean));
  const [sprachMenue, setSprachMenue] = useState(false);
  const [ohrModus, setOhrModus] = useState(() => lesen(OHRMODUS) === 'an');
  const [fehler, setFehler] = useState<string | null>(null);
  const [transkriptOffen, setTranskriptOffen] = useState(false);
  const [gedaechtnisOffen, setGedaechtnisOffen] = useState(false);
  const [gedaechtnis, setGedaechtnis] = useState<GedaechtnisEintragDaten[]>([]);
  const [routinen, setRoutinen] = useState<RoutineDaten[]>([]);
  // Fokus der App (data-agent-fokus): was gerade offen ist — geht als Kontext mit und bestimmt die Ergebnisse
  const [fokusText, setFokusText] = useState(() => (typeof document === 'undefined' ? '{}' : JSON.stringify(fokusLesen())));
  const fokus = useMemo(() => JSON.parse(fokusText) as Record<string, string | number | boolean | null>, [fokusText]);
  const [ergebnisse, setErgebnisse] = useState<ErgebnisDaten[]>([]);
  const [ergebnisOffen, setErgebnisOffen] = useState(false);
  const [ergebnisGross, setErgebnisGross] = useState(false);
  const nr = useRef(0);
  const abgebrochen = useRef(false);
  /** Welcher Eintrag offen war, als gefragt wurde — „Ja“ gilt nur dafür */
  const wartKontext = useRef<string | null>(null);
  const saat = useMemo(() => saatAus('agent'), []);
  const vorlesen = useVorlesen('agent');

  const sitzungMerken = useCallback((id: string) => {
    setSitzungId(id);
    try { window.localStorage.setItem(SITZUNG, id); } catch { /* privater Modus */ }
  }, []);

  const zeile = useCallback((wer: Zeile['wer'], text: string) => {
    if (!text) return;
    nr.current += 1;
    setZeilen((z) => [...z.slice(-99), { wer, text, nr: nr.current }]);
  }, []);

  /** Einen Faden wieder aufnehmen: Verlauf zeigen; eine offene Rückfrage von damals verfällt. */
  const fadenLaden = useCallback(async (id: string) => {
    const r = await anfrage(`${api}/sitzung?sitzungId=${encodeURIComponent(id)}`).catch(() => null);
    const d = r?.ok ? ((await r.json()) as { sitzungId: string | null; verlauf: { rolle: string; text: string; chips?: ChipDaten[] | null }[]; wartetAuf?: AgentAntwortDaten['wartetAuf'] | null }) : null;
    if (!d?.sitzungId) return;
    sitzungMerken(d.sitzungId);
    setZeilen(d.verlauf.filter((v) => v.text).map((v) => ({ wer: v.rolle === 'agent' ? 'agent' as const : 'nutzer' as const, text: v.text, nr: (nr.current += 1) })).slice(-100));
    setChips([]);
    // Eine Rückfrage von vorhin verfällt: der vorbereitete Stand (gefülltes Feld, offener Deal) ist nach dem
    // Neuladen weg — ein „Ja“ träfe, was gerade offen ist. Der Kern bekommt ein „Nein“, der Nutzer einen Satz.
    if (d.wartetAuf) {
      void anfrage(`${api}/entscheidung`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sitzungId: d.sitzungId, wert: 'nein' }) }).catch(() => undefined);
      zeile('agent', 'Die Rückfrage von vorhin ist verfallen — sag mir bitte noch einmal, was ich tun soll.');
      return;
    }
    const letzte = [...d.verlauf].reverse().find((v) => v.rolle === 'agent');
    if (letzte?.chips?.length) setChips(letzte.chips);
  }, [anfrage, api, sitzungMerken, zeile]);

  /**
   * Was der Agent beim Öffnen und beim Wechsel des Bereichs sagt (CoSAi, ohne Modell): am Tagesbeginn „weitermachen
   * oder zusammenfassen?“, im Bereich mit Faden „weitermachen oder neu?“, sonst was er hier tun kann.
   * `behalten`: der Agent ist selbst hierher navigiert — sein Faden läuft weiter, er sagt nur, was es hier gibt.
   */
  const kontextZeigen = useCallback(async (o: { faehigkeiten?: boolean; behalten?: boolean; beimOeffnen?: boolean } = {}) => {
    const r = await anfrage(`${api}/kontext`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ort, heute: heuteLokal(), faehigkeiten: o.faehigkeiten || o.behalten || undefined }) }).catch(() => null);
    if (!r?.ok) return;
    const k = (await r.json()) as { art: 'tagesbeginn' | 'fortsetzen' | 'neu'; sitzungId: string | null; text: string; chips: ChipDaten[] };
    let gemerkt: string | null = null;
    try { gemerkt = window.localStorage.getItem(SITZUNG); } catch { /* privater Modus */ }
    // Neu geladen mitten im Faden dieses Bereichs: einfach weiter, ohne Rückfrage
    if (o.beimOeffnen && k.art === 'fortsetzen' && k.sitzungId && k.sitzungId === gemerkt) { await fadenLaden(k.sitzungId); return; }
    if (!o.behalten) {
      setSitzungId(null);
      try { window.localStorage.removeItem(SITZUNG); } catch { /* privater Modus */ }
      setZeilen([]);
    }
    setWartetAuf(undefined);
    zeile('agent', k.text);
    setChips(k.chips);
  }, [anfrage, api, fadenLaden, ort, zeile]);

  // Beim Öffnen: nicht die letzte Zeile von gestern, sondern der Kontext (Tagesbeginn, Faden des Bereichs oder Neu)
  useEffect(() => {
    void kontextZeigen({ beimOeffnen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Beobachtung: Klicks und Meldungen der App an den Kern — solange AgentMode offen ist.
  // Gespeicherte Eingaben meldet <Lernen> (auch ohne Overlay) — hier nicht, sonst zählten sie doppelt.
  useEffect(() => beobachten((b: Beobachtung) => {
    if (b.art === 'gespeichert') return;
    void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, kontext: b.kontext ?? {}, sitzungId: sitzungId ?? undefined }) }).catch(() => undefined);
  }), [anfrage, api, sitzungId]);

  /** Führt die Steuerungen sichtbar aus — Schritt für Schritt, mit Etikett und Hervorhebung. */
  /** Führt die Steuerungen aus; `false`, wenn ein Schritt scheiterte oder der Nutzer übernommen hat. */
  const steuern = useCallback(async (steuerung: Steuerung[]): Promise<boolean> => {
    if (!steuerung.length) return true;
    let vollstaendig = true;
    setHandelt(true);
    abgebrochen.current = false;
    try {
      for (const s of steuerung) {
        if (abgebrochen.current) { vollstaendig = false; break; }
        if (s.art === 'sprich') { zeile('agent', s.text ?? ''); continue; }
        setSchritt({ el: null, text: s.text ?? `${s.art} ${s.ziel ?? ''}`.trim() });
        try {
          const el = await ausfuehren(s, { navigiere });
          setSchritt({ el, text: s.text ?? `${s.art} ${s.ziel ?? ''}`.trim() });
          onSteuerung?.(s);
        } catch (e) {
          setFehler((e as Error).message);
          void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ art: 'klick', ziel: s.ziel ?? 'unbekannt', wert: `FEHLER: ${(e as Error).message}`, kontext: {}, sitzungId: sitzungId ?? undefined }) }).catch(() => undefined);
          vollstaendig = false;
          break;
        }
        await new Promise((r) => setTimeout(r, schrittMs));
      }
    } finally {
      setSchritt(null);
      setHandelt(false);
    }
    return vollstaendig && !abgebrochen.current;
  }, [anfrage, api, navigiere, onSteuerung, schrittMs, sitzungId, zeile]);

  /** Markiert das Ziel der wartenden Aktion, solange gefragt wird — man sieht, worum es geht. */
  const wartendesZielZeigen = useCallback((aktion?: Steuerung) => {
    if (!aktion?.ziel) { setSchritt(null); return; }
    const el = zielFinden(aktion.ziel);
    setSchritt(el ? { el, text: aktion.text ?? 'wartet auf deine Bestätigung' } : null);
  }, []);

  const verarbeiten = useCallback(async (antwort: AgentAntwortDaten): Promise<{ verwerfen: boolean }> => {
    sitzungMerken(antwort.sitzungId);
    if (antwort.text) zeile('agent', antwort.text);
    const sprechen = antwort.text ? vorlesen.sprich(antwort.text) : Promise.resolve();
    // Erst handeln, dann fragen: Die Chips erscheinen nach den Schritten. Sonst kann der Nutzer „Ja“ drücken,
    // während das Feld noch leer ist — die Bestätigung liefe dann ins Leere.
    const vollstaendig = await steuern(antwort.steuerung ?? []);
    // Ist ein Schritt vor dem Senden gescheitert, gibt es kein „Ja“ auf einen halbfertigen Stand
    if (antwort.wartetAuf && !vollstaendig) {
      await sprechen;
      zeile('agent', 'Ein Schritt davor hat nicht geklappt — ich schicke nicht ab.');
      return { verwerfen: true };
    }
    wartendesZielZeigen(antwort.wartetAuf?.aktion);
    wartKontext.current = antwort.wartetAuf?.aktion.ziel ? zielKontext(antwort.wartetAuf.aktion.ziel) : null;
    setWartetAuf(antwort.wartetAuf);
    setChips(antwort.chips ?? []);
    await sprechen;
    if (antwort.wartetAuf && antwort.wartetAuf.frage !== antwort.text) {
      zeile('agent', antwort.wartetAuf.frage);
      await vorlesen.sprich(antwort.wartetAuf.frage);
    }
    return { verwerfen: false };
  }, [sitzungMerken, steuern, vorlesen, wartendesZielZeigen, zeile]);

  // Wechsel des Bereichs (Ankauf → Deals): im Leerlauf fragt der Agent, was er dort tun soll bzw. ob er den Faden dort
  // fortsetzt. Navigiert der Agent selbst, unterbricht das nichts — ist er fertig, sagt er, was es im neuen Bereich gibt.
  const bereich = bereichVon(ort);
  const gezeigtFuer = useRef(bereich);
  const unterwegsGewechselt = useRef(false);
  useEffect(() => {
    if (bereich === gezeigtFuer.current) return;
    if (beschaeftigt || handelt) { unterwegsGewechselt.current = true; return; }
    if (wartetAuf) return;
    gezeigtFuer.current = bereich;
    const behalten = unterwegsGewechselt.current;
    unterwegsGewechselt.current = false;
    void kontextZeigen({ behalten });
  }, [bereich, beschaeftigt, handelt, kontextZeigen, wartetAuf]);

  useEffect(() => {
    const neu = () => setFokusText(JSON.stringify(fokusLesen()));
    neu();
    const beobachter = new MutationObserver(neu);
    beobachter.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-agent-fokus'] });
    return () => beobachter.disconnect();
  }, []);

  /** Ergebnisse zu allen Objekten im Fokus (ohne Fokus: die jüngsten) */
  const ergebnisseLaden = useCallback(async () => {
    const bezuege = fokusBezuege(fokus);
    const pfade = bezuege.length ? bezuege.map((b) => `${api}/ergebnisse?typ=${encodeURIComponent(b.typ)}&id=${encodeURIComponent(b.id)}`) : [`${api}/ergebnisse`];
    const listen = await Promise.all(pfade.map(async (p) => {
      const r = await anfrage(p).catch(() => null);
      return r?.ok ? ((await r.json()) as { ergebnisse: ErgebnisDaten[] }).ergebnisse : [];
    }));
    const alle = new Map<string, ErgebnisDaten>();
    for (const e of listen.flat()) alle.set(e.id, e);
    setErgebnisse([...alle.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [anfrage, api, fokus]);
  useEffect(() => { void ergebnisseLaden(); }, [ergebnisseLaden]);
  const ergebnisLoeschen = useCallback((id: string) => {
    void anfrage(`${api}/ergebnisse/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(ergebnisseLaden);
  }, [anfrage, api, ergebnisseLaden]);
  const fokusTitel = fokusBezuege(fokus).map((b) => `${b.typ[0]!.toUpperCase()}${b.typ.slice(1)} ${b.name || b.id}`).join(' · ') || 'Alle Ergebnisse';

  /** Erkannte Routinen — beim Öffnen, nach jeder Antwort und nach jedem Speichern in der App neu laden. */
  const routinenLaden = useCallback(async () => {
    const r = await anfrage(`${api}/routinen`).catch(() => null);
    if (r?.ok) setRoutinen(((await r.json()) as { routinen: RoutineDaten[] }).routinen);
  }, [anfrage, api]);
  useEffect(() => { void routinenLaden(); }, [routinenLaden]);
  useEffect(() => beobachten((b) => { if (b.art === 'gespeichert') window.setTimeout(() => void routinenLaden(), 500); }), [routinenLaden]);

  const senden = useCallback(async (pfad: 'nachricht' | 'entscheidung' | 'morgen', body: Record<string, unknown>, anzeige: string) => {
    if (beschaeftigt) return;
    setFehler(null);
    setBeschaeftigt(true);
    zeile('nutzer', anzeige);
    setChips([]);
    setSchritt(null);
    try {
      const r = await anfrage(`${api}/${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const f = (await r.json().catch(() => ({}))) as { fehler?: string };
        throw new Error(f.fehler ?? `Fehler ${r.status}`);
      }
      const roh = (await r.json()) as AgentAntwortDaten & { antwort?: AgentAntwortDaten };
      // /morgen liefert { antwort } — die Übersicht liest nur, Schritte daraus führt die Oberfläche nicht aus
      const antwort = pfad === 'morgen' ? { ...roh.antwort!, steuerung: [] } : roh;
      const { verwerfen } = await verarbeiten(antwort);
      if (verwerfen) {
        const nein = await anfrage(`${api}/entscheidung`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sitzungId: antwort.sitzungId, wert: 'nein' }) });
        if (nein.ok) await verarbeiten((await nein.json()) as AgentAntwortDaten);
      }
    } catch (e) {
      setFehler((e as Error).message);
      zeile('agent', `Das hat nicht geklappt: ${(e as Error).message}`);
    } finally {
      setBeschaeftigt(false);
      void routinenLaden();
      void ergebnisseLaden();
    }
  }, [anfrage, api, beschaeftigt, ergebnisseLaden, routinenLaden, verarbeiten, zeile]);

  /** Eine Routine starten: der Auftrag geht an den Agenten, im Gespräch steht nur ihr Name. */
  const routineStarten = useCallback((r: RoutineDaten) => {
    void senden('nachricht', { sitzungId: sitzungId ?? undefined, text: r.auftrag, ort, kontext: { ...kontext, ...fokus } }, `▶ ${r.label}`);
  }, [fokus, kontext, ort, senden, sitzungId]);

  const nachricht = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setEingabe('');
    void senden('nachricht', { sitzungId: sitzungId ?? undefined, text: t, ort, kontext: { ...kontext, ...fokus } }, t);
  }, [fokus, kontext, ort, senden, sitzungId]);

  const chipWaehlen = useCallback((c: ChipDaten) => {
    if (c.art === 'entscheidung' && sitzungId && wartetAuf) {
      setWartetAuf(undefined);
      // „Ja“ gilt nur für den Eintrag, der beim Fragen offen war
      if (c.wert === 'ja' && wartetAuf.aktion.ziel && zielKontext(wartetAuf.aktion.ziel) !== wartKontext.current) {
        zeile('agent', 'Inzwischen ist ein anderer Eintrag offen — ich schicke nicht ab.');
        void senden('entscheidung', { sitzungId, wert: 'nein' }, 'Nein (anderer Eintrag)');
        return;
      }
      void senden('entscheidung', { sitzungId, wert: c.wert }, c.label);
    } else if (c.art === 'kontext') {
      if (c.wert.startsWith('weiter:')) void fadenLaden(c.wert.slice('weiter:'.length));
      // Tagesübersicht nur auf Wunsch — nur lesend, eigener Faden
      else if (c.wert === 'morgen') void senden('morgen', {}, c.label);
      else void kontextZeigen({ faehigkeiten: true });
    } else {
      nachricht(c.wert);
    }
  }, [fadenLaden, kontextZeigen, nachricht, senden, sitzungId, wartetAuf, zeile]);

  // Zuhören: Zwischenstand ins Eingabefeld, am Ende abschicken; kurze Bestätigungen treffen die Chips direkt
  const zuhoeren = useZuhoeren((text, fertig) => {
    // „Stopp“ bricht das Vorlesen ab und wird nicht als Auftrag geschickt
    if (istStoppwort(text)) { if (fertig) { vorlesen.stoppe(); setEingabe(''); } return; }
    setEingabe(text);
    if (!fertig || !text) return;
    const kurz = text.toLowerCase().replace(/[.!?]/g, '').trim();
    const treffer = chips.find((c) => c.label.toLowerCase() === kurz || c.wert.toLowerCase() === kurz) ?? (wartetAuf && /^(ja|ok|okay|abschicken|mach)$/.test(kurz) ? chips.find((c) => c.wert === 'ja') : undefined) ?? (wartetAuf && /^(nein|nicht|stopp?|abbrechen)$/.test(kurz) ? chips.find((c) => c.wert === 'nein') : undefined);
    if (treffer) chipWaehlen(treffer); else nachricht(text);
  }, { transkribieren, onFehler: setFehler, rufname, endwoerter, stumm: vorlesen.spricht || beschaeftigt || handelt });
  // Dauerhaft zuhören: war es an, geht es nach dem Öffnen gleich wieder an
  useEffect(() => {
    if (lesen(OHRMODUS) === 'an' && lesen(DAUERHOEREN) === 'an') zuhoeren.dauerSchalten(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dauerSchalten = (an: boolean) => { schreiben(DAUERHOEREN, an ? 'an' : null); zuhoeren.dauerSchalten(an); };
  const ohrSchalten = (an: boolean) => {
    setOhrModus(an);
    schreiben(OHRMODUS, an ? 'an' : null);
    if (!an && zuhoeren.dauer) dauerSchalten(false);
  };
  /** 🎤 (und der Kreis): mit 👂 bleibt es an bis zum nächsten Druck, sonst einmal sprechen bis zur Pause oder zum Endwort */
  const mikrofon = () => {
    if (ohrModus && zuhoeren.dauerMoeglich) { dauerSchalten(!zuhoeren.dauer); return; }
    if (zuhoeren.hoert) zuhoeren.stoppe(); else zuhoeren.starte();
  };
  const mikrofonAn = zuhoeren.dauer || zuhoeren.hoert;

  /** Ein neues Gespräch: die alte Sitzung bleibt in der Datenbank, der Faden beginnt frisch. */
  const neuesGespraech = useCallback(() => {
    setSitzungId(null);
    try { window.localStorage.removeItem(SITZUNG); } catch { /* privater Modus */ }
    setZeilen([]);
    setChips([]);
    setWartetAuf(undefined);
    setSchritt(null);
    setFehler(null);
    void kontextZeigen({ faehigkeiten: true });
  }, [kontextZeigen]);

  const gedaechtnisLaden = useCallback(async () => {
    const r = await anfrage(`${api}/gedaechtnis`);
    if (r.ok) setGedaechtnis(((await r.json()) as { eintraege: GedaechtnisEintragDaten[] }).eintraege);
  }, [anfrage, api]);
  useEffect(() => { if (gedaechtnisOffen) void gedaechtnisLaden(); }, [gedaechtnisOffen, gedaechtnisLaden]);

  // Esc bricht das Vorlesen ab — auch wenn der Fokus gerade woanders liegt
  useEffect(() => {
    if (!vorlesen.spricht) return;
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') vorlesen.stoppe(); };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [vorlesen]);

  const zustand: SprechkreisZustand = zuhoeren.hoert && (!zuhoeren.dauer || zuhoeren.wach) ? 'hoert' : vorlesen.spricht ? 'spricht' : beschaeftigt || handelt ? 'denkt' : 'ruhig';
  const letzteAgent = [...zeilen].reverse().find((z) => z.wer === 'agent');
  const letzteNutzer = [...zeilen].reverse().find((z) => z.wer === 'nutzer');
  const kreisGroesse = modus === 'seite' ? 140 : 110;

  // Ein Block über die ganze Breite (Wunsch des Auftraggebers, 26.09.): links der große Sprechkreis; daneben oben die
  // Agent-Blase mit den Chips rechts davon, darunter die Du-Blase mit dem Eingabefeld und allen Symbolknöpfen rechts.
  // Knöpfe nur mit Symbol — der Text erscheint beim Darüberfahren (`data-tipp`) und steht im aria-label.
  const naechsterStil = () => {
    const i = SPRECHKREIS_STILE.findIndex((x) => x.wert === stil);
    onStil?.(SPRECHKREIS_STILE[(i + 1) % SPRECHKREIS_STILE.length]!.wert);
  };
  const block = (
    <div className={`am-block ${modus === 'overlay' ? 'am-overlay-oben' : ''}`} data-agentmode-oben>
      <div className="am-kreis">
        <Sprechkreis stil={stil} zustand={zustand} pegel={zustand === 'hoert' ? zuhoeren.pegel : vorlesen.spricht ? 0.6 : 0} groesse={kreisGroesse} saat={saat} farbe={farbe} titel="Agent"
          onClick={vorlesen.spricht ? vorlesen.stoppe : zuhoeren.moeglich ? mikrofon : undefined} />
        {(schliessen || zurSeite) && (
          <div className="am-kreis-knoepfe">
            {zurSeite && <button type="button" className="am-symbol am-klein" aria-label="Zum Agent-Dialog" data-tipp="Zum Agent-Dialog" onClick={zurSeite}>↗</button>}
            {schliessen && <button type="button" className="am-symbol am-klein" aria-label="AgentMode schließen" data-tipp="Schließen" onClick={schliessen}>✕</button>}
          </div>
        )}
      </div>
      <div className="am-agent">
        {letzteAgent ? <Sprechblase wer="agent" text={letzteAgent.text} schluessel={letzteAgent.nr} lebendig /> : <div className="am-blase" data-wer="agent"><span className="am-wer">Agent</span>Ich höre. Sag mir, was ich tun soll — oder frag, was heute ansteht.</div>}
      </div>
      <div className="am-oben-rechts">
        <Chips chips={chips} waehlen={chipWaehlen} aus={beschaeftigt} />
        {!wartetAuf && routinen.map((r) => (
          <button key={r.id} type="button" className="am-chip" data-art="routine" aria-label={`Routine: ${r.label}`} disabled={beschaeftigt} onClick={() => routineStarten(r)}>▶ {r.label}</button>
        ))}
      </div>
      {ergebnisOffen ? (
        <ErgebnisBereich titel={fokusTitel} ergebnisse={ergebnisse} loeschen={ergebnisLoeschen}
          vergroessern={() => setErgebnisGross(true)} schliessen={() => setErgebnisOffen(false)} />
      ) : (<>
      <div className="am-du">
        {letzteNutzer ? <Sprechblase wer="nutzer" text={letzteNutzer.text} schluessel={letzteNutzer.nr} /> : <div className="am-blase" data-wer="nutzer"><span className="am-wer">Du</span>…</div>}
      </div>
      <form className="am-zeile" onSubmit={(e) => { e.preventDefault(); nachricht(eingabe); }}>
        <input className="am-eingabe" aria-label="Nachricht an den Agenten" placeholder="Nachricht … (Enter)" value={eingabe} onChange={(e) => setEingabe(e.currentTarget.value)} disabled={beschaeftigt} />
        {/* Abschicken auch per Klick — nur mit Enter sah man nicht, wie die Nachricht ankommt (Rückmeldung des Auftraggebers) */}
        <button type="submit" className="am-symbol am-senden" aria-label="Senden" data-tipp="Senden (Enter)" disabled={beschaeftigt || !eingabe.trim()}>➤</button>
        {zuhoeren.moeglich && (
          <div className="am-menue-anker am-mikrofon">
            <button type="button" className="am-symbol" aria-pressed={mikrofonAn} data-ohr={ohrModus} data-wach={zuhoeren.wach}
              aria-label={mikrofonAn ? 'Zuhören beenden' : 'Zuhören'}
              data-tipp={zuhoeren.dauer ? `Hört auf „${rufname}“ — drücken zum Ausschalten` : mikrofonAn ? 'Zuhören beenden' : ohrModus ? `Immer zuhören (auf „${rufname}“)` : 'Drücken und sprechen'}
              onClick={mikrofon}>🎤{ohrModus && <span className="am-ohr-marke" aria-hidden>👂</span>}</button>
            <button type="button" className="am-symbol am-pfeil" aria-haspopup="dialog" aria-expanded={sprachMenue} aria-label="Sprachoptionen" data-tipp="Sprachoptionen" onClick={() => setSprachMenue((o) => !o)}>▾</button>
            {sprachMenue && (
              <Sprachmenue ohr={ohrModus} ohrMoeglich={zuhoeren.dauerMoeglich} ohrSchalten={ohrSchalten}
                rufname={rufname} endwoerter={endwoerter} schliessen={() => setSprachMenue(false)}
                speichern={(r, e) => {
                  const n = r.trim() || RUFNAME;
                  setRufname(n); schreiben(RUFNAME_SCHLUESSEL, n === RUFNAME ? null : n);
                  const liste = e.split(',').map((w) => w.trim()).filter(Boolean);
                  setEndwoerter(liste); schreiben(ENDWOERTER_SCHLUESSEL, liste.join(', ') === ENDWOERTER.join(', ') ? null : liste.join(', '));
                }} />
            )}
          </div>
        )}
        <button type="button" className="am-symbol" aria-pressed={transkriptOffen} aria-label="Transkript" data-tipp="Transkript" onClick={() => setTranskriptOffen((o) => !o)}>📜</button>
        <button type="button" className="am-symbol" aria-pressed={gedaechtnisOffen} aria-label="Gedächtnis" data-tipp="Gedächtnis" onClick={() => setGedaechtnisOffen((o) => !o)}>🧠</button>
        <button type="button" className="am-symbol am-mit-zahl" aria-label={`Ergebnisse (${ergebnisse.length})`} data-tipp={`Ergebnisse — ${fokusTitel}`} onClick={() => { void ergebnisseLaden(); setErgebnisOffen(true); }}>
          🗂{!!ergebnisse.length && <span className="am-zahl">{ergebnisse.length}</span>}
        </button>
        {onStil && (
          <button type="button" className="am-symbol" aria-label="Stil des Sprechkreises wechseln" data-tipp={`Stil: ${SPRECHKREIS_STILE.find((x) => x.wert === stil)?.label ?? stil}`} onClick={naechsterStil}>✦</button>
        )}
        {vorlesen.spricht && (
          <button type="button" className="am-symbol am-stopp" aria-label="Vorlesen stoppen" data-tipp="Stopp (Esc, Kreis oder „Stopp“ sagen)" onClick={vorlesen.stoppe}>⏹</button>
        )}
        {vorlesen.moeglich && (
          <button type="button" className="am-symbol" aria-pressed={vorlesen.an} aria-label={vorlesen.an ? 'Vorlesen ausschalten' : 'Vorlesen einschalten'} data-tipp={vorlesen.an ? 'Vorlesen an' : 'Vorlesen aus'} onClick={() => vorlesen.schalte(!vorlesen.an)}>{vorlesen.an ? '🔊' : '🔇'}</button>
        )}
        <button type="button" className="am-symbol" aria-label="Neues Gespräch" data-tipp="Neues Gespräch" onClick={neuesGespraech}>↻</button>
        {einstellungen && <button type="button" className="am-symbol" aria-label="Einstellungen des Agenten" data-tipp="Einstellungen (Immer/Nie, Modell)" onClick={einstellungen}>⚙</button>}
      </form>
      </>)}
      {(fehler || transkriptOffen || gedaechtnisOffen) && (
        <div className="am-unterteil">
          {fehler && <span className="am-hinweis" role="alert">{fehler}</span>}
          {transkriptOffen && (
            <div className="am-transkript" aria-label="Transkript">
              {zeilen.map((z) => <Sprechblase key={z.nr} wer={z.wer} text={z.text} schluessel={z.nr} />)}
            </div>
          )}
          {gedaechtnisOffen && (
            <Gedaechtnisleiste eintraege={gedaechtnis}
              loeschen={(id) => anfrage(`${api}/gedaechtnis/${id}`, { method: 'DELETE' }).then(gedaechtnisLaden).then(routinenLaden)}
              bestaetigen={(id) => anfrage(`${api}/gedaechtnis/${id}/bestaetigen`, { method: 'POST' }).then(gedaechtnisLaden)} />
          )}
        </div>
      )}
      {ergebnisGross && <ErgebnisDialog titel={fokusTitel} ergebnisse={ergebnisse} loeschen={ergebnisLoeschen} schliessen={() => { setErgebnisGross(false); setErgebnisOffen(false); }} />}
    </div>
  );

  if (modus === 'seite') {
    return (
      <div className="am-seite" data-agentmode="seite">
        {block}
        <div className="am-seite-mitte">
          <div>{children}</div>
          <div className="am-karte">
            <h3>Gespräch</h3>
            <div className="am-transkript" style={{ maxHeight: 'none' }}>
              {zeilen.length ? zeilen.map((z) => <Sprechblase key={z.nr} wer={z.wer} text={z.text} schluessel={z.nr} />) : <p className="am-hinweis">Noch kein Gespräch.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-agentmode="overlay" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {block}
      <Schaufenster aktiv={handelt} schritt={schritt} uebernehmen={() => { abgebrochen.current = true; setHandelt(false); setSchritt(null); }}>
        {children}
      </Schaufenster>
    </div>
  );
}
