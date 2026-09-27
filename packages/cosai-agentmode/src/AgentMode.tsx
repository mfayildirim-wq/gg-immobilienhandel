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
import { ausfuehren, beobachten, zielFinden, zielKontext, type Beobachtung, type Steuerung } from './kanal.ts';
import { saatAus } from './konstellation.ts';
import { heuteLokal } from './lernen.tsx';
import { Sprechkreis, SPRECHKREIS_STILE, type SprechkreisStil, type SprechkreisZustand } from './Sprechkreis.tsx';
import { istStoppwort, useVorlesen, useZuhoeren } from './sprache.ts';

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
}

const SITZUNG = 'cosai.sitzung';

export function AgentMode({ api, anfrage, modus, navigiere, ort, kontext = {}, stil, onStil, children, schliessen, schrittMs = 700, farbe, onSteuerung, transkribieren, einstellungen }: AgentModeProps) {
  const [sitzungId, setSitzungId] = useState<string | null>(() => { try { return window.localStorage.getItem(SITZUNG); } catch { return null; } });
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [chips, setChips] = useState<ChipDaten[]>([]);
  const [wartetAuf, setWartetAuf] = useState<AgentAntwortDaten['wartetAuf']>(undefined);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const [handelt, setHandelt] = useState(false);
  const [schritt, setSchritt] = useState<Schritt | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [transkriptOffen, setTranskriptOffen] = useState(false);
  const [gedaechtnisOffen, setGedaechtnisOffen] = useState(false);
  const [gedaechtnis, setGedaechtnis] = useState<GedaechtnisEintragDaten[]>([]);
  const [routinen, setRoutinen] = useState<RoutineDaten[]>([]);
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

  // Beim Öffnen: den Verlauf der letzten Sitzung holen
  useEffect(() => {
    let aktiv = true;
    anfrage(`${api}/sitzung${sitzungId ? `?sitzungId=${encodeURIComponent(sitzungId)}` : ''}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { sitzungId: string | null; verlauf: { rolle: string; text: string; chips?: ChipDaten[] | null }[]; wartetAuf?: AgentAntwortDaten['wartetAuf'] | null }) : null))
      .then((d) => {
        if (!aktiv) return;
        if (d?.sitzungId) sitzungMerken(d.sitzungId);
        if (d?.verlauf.length) {
          const alt = d.verlauf.filter((v) => v.text).map((v) => ({ wer: v.rolle === 'agent' ? 'agent' as const : 'nutzer' as const, text: v.text, nr: (nr.current += 1) }));
          setZeilen(alt.slice(-100));
          // Wartet die Sitzung noch auf eine Bestätigung, zeigt die Oberfläche das — sonst würde die
          // nächste Nachricht stumm als Antwort auf eine längst vergessene Frage gedeutet.
          if (d.wartetAuf && d.sitzungId) {
            // Eine Rückfrage von vorhin verfällt: der vorbereitete Stand (gefülltes Feld, offener Deal) ist nach dem
            // Neuladen weg — ein „Ja“ träfe, was gerade offen ist. Der Kern bekommt ein „Nein“, der Nutzer einen Satz.
            void anfrage(`${api}/entscheidung`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sitzungId: d.sitzungId, wert: 'nein' }) }).catch(() => undefined);
            zeile('agent', 'Die Rückfrage von vorhin ist verfallen — sag mir bitte noch einmal, was ich tun soll.');
            return;
          }
          const letzte = [...d.verlauf].reverse().find((v) => v.rolle === 'agent');
          if (letzte?.chips?.length) setChips(letzte.chips);
        }
        // Einmal am Tag: der Morgenvorschlag — nur lesend, Steuerungen daraus werden nicht ausgeführt
        return anfrage(`${api}/morgen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ heute: heuteLokal() }) })
          .then(async (r) => (r.ok ? ((await r.json()) as { antwort: AgentAntwortDaten | null }).antwort : null))
          .then((m) => {
            if (!aktiv || !m) return;
            sitzungMerken(m.sitzungId);
            zeile('agent', m.text);
            setChips(m.chips);
          });
      })
      .catch(() => { /* ohne Verlauf beginnt das Gespräch leer */ });
    return () => { aktiv = false; };
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

  /** Erkannte Routinen — beim Öffnen, nach jeder Antwort und nach jedem Speichern in der App neu laden. */
  const routinenLaden = useCallback(async () => {
    const r = await anfrage(`${api}/routinen`).catch(() => null);
    if (r?.ok) setRoutinen(((await r.json()) as { routinen: RoutineDaten[] }).routinen);
  }, [anfrage, api]);
  useEffect(() => { void routinenLaden(); }, [routinenLaden]);
  useEffect(() => beobachten((b) => { if (b.art === 'gespeichert') window.setTimeout(() => void routinenLaden(), 500); }), [routinenLaden]);

  const senden = useCallback(async (pfad: 'nachricht' | 'entscheidung', body: Record<string, unknown>, anzeige: string) => {
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
      const antwort = (await r.json()) as AgentAntwortDaten;
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
    }
  }, [anfrage, api, beschaeftigt, routinenLaden, verarbeiten, zeile]);

  /** Eine Routine starten: der Auftrag geht an den Agenten, im Gespräch steht nur ihr Name. */
  const routineStarten = useCallback((r: RoutineDaten) => {
    void senden('nachricht', { sitzungId: sitzungId ?? undefined, text: r.auftrag, ort, kontext }, `▶ ${r.label}`);
  }, [kontext, ort, senden, sitzungId]);

  const nachricht = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setEingabe('');
    void senden('nachricht', { sitzungId: sitzungId ?? undefined, text: t, ort, kontext }, t);
  }, [kontext, ort, senden, sitzungId]);

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
    } else {
      nachricht(c.wert);
    }
  }, [nachricht, senden, sitzungId, wartetAuf, zeile]);

  // Zuhören: Zwischenstand ins Eingabefeld, am Ende abschicken; kurze Bestätigungen treffen die Chips direkt
  const zuhoeren = useZuhoeren((text, fertig) => {
    // „Stopp“ bricht das Vorlesen ab und wird nicht als Auftrag geschickt
    if (istStoppwort(text)) { if (fertig) { vorlesen.stoppe(); setEingabe(''); } return; }
    setEingabe(text);
    if (!fertig || !text) return;
    const kurz = text.toLowerCase().replace(/[.!?]/g, '').trim();
    const treffer = chips.find((c) => c.label.toLowerCase() === kurz || c.wert.toLowerCase() === kurz) ?? (wartetAuf && /^(ja|ok|okay|abschicken|mach)$/.test(kurz) ? chips.find((c) => c.wert === 'ja') : undefined) ?? (wartetAuf && /^(nein|nicht|stopp?|abbrechen)$/.test(kurz) ? chips.find((c) => c.wert === 'nein') : undefined);
    if (treffer) chipWaehlen(treffer); else nachricht(text);
  }, { transkribieren, onFehler: setFehler });

  /** Ein neues Gespräch: die alte Sitzung bleibt in der Datenbank, der Faden beginnt frisch. */
  const neuesGespraech = useCallback(() => {
    setSitzungId(null);
    try { window.localStorage.removeItem(SITZUNG); } catch { /* privater Modus */ }
    setZeilen([]);
    setChips([]);
    setWartetAuf(undefined);
    setSchritt(null);
    setFehler(null);
  }, []);

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

  const zustand: SprechkreisZustand = zuhoeren.hoert ? 'hoert' : vorlesen.spricht ? 'spricht' : beschaeftigt || handelt ? 'denkt' : 'ruhig';
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
        <Sprechkreis stil={stil} zustand={zustand} pegel={zuhoeren.hoert ? zuhoeren.pegel : vorlesen.spricht ? 0.6 : 0} groesse={kreisGroesse} saat={saat} farbe={farbe} titel="Agent"
          onClick={vorlesen.spricht ? vorlesen.stoppe : zuhoeren.moeglich ? (zuhoeren.hoert ? zuhoeren.stoppe : zuhoeren.starte) : undefined} />
      </div>
      <div className="am-agent">
        {letzteAgent ? <Sprechblase wer="agent" text={letzteAgent.text} schluessel={letzteAgent.nr} lebendig /> : <div className="am-blase" data-wer="agent"><span className="am-wer">Agent</span>Ich höre. Sag mir, was ich tun soll — oder frag, was heute ansteht.</div>}
      </div>
      <div className="am-oben-rechts">
        <Chips chips={chips} waehlen={chipWaehlen} aus={beschaeftigt} />
        {!wartetAuf && routinen.map((r) => (
          <button key={r.id} type="button" className="am-chip" data-art="routine" aria-label={`Routine: ${r.label}`} disabled={beschaeftigt} onClick={() => routineStarten(r)}>▶ {r.label}</button>
        ))}
        {schliessen && <button type="button" className="am-symbol" aria-label="AgentMode schließen" data-tipp="Schließen" onClick={schliessen}>✕</button>}
      </div>
      <div className="am-du">
        {letzteNutzer ? <Sprechblase wer="nutzer" text={letzteNutzer.text} schluessel={letzteNutzer.nr} /> : <div className="am-blase" data-wer="nutzer"><span className="am-wer">Du</span>…</div>}
      </div>
      <form className="am-zeile" onSubmit={(e) => { e.preventDefault(); nachricht(eingabe); }}>
        <input className="am-eingabe" aria-label="Nachricht an den Agenten" placeholder="Nachricht … (Enter)" value={eingabe} onChange={(e) => setEingabe(e.currentTarget.value)} disabled={beschaeftigt} />
        {/* Abschicken auch per Klick — nur mit Enter sah man nicht, wie die Nachricht ankommt (Rückmeldung des Auftraggebers) */}
        <button type="submit" className="am-symbol am-senden" aria-label="Senden" data-tipp="Senden (Enter)" disabled={beschaeftigt || !eingabe.trim()}>➤</button>
        {zuhoeren.moeglich && (
          <button type="button" className="am-symbol" aria-pressed={zuhoeren.hoert} aria-label={zuhoeren.hoert ? 'Zuhören beenden' : 'Zuhören'} data-tipp={zuhoeren.hoert ? 'Zuhören beenden' : 'Zuhören'} onClick={zuhoeren.hoert ? zuhoeren.stoppe : zuhoeren.starte}>🎤</button>
        )}
        <button type="button" className="am-symbol" aria-pressed={transkriptOffen} aria-label="Transkript" data-tipp="Transkript" onClick={() => setTranskriptOffen((o) => !o)}>📜</button>
        <button type="button" className="am-symbol" aria-pressed={gedaechtnisOffen} aria-label="Gedächtnis" data-tipp="Gedächtnis" onClick={() => setGedaechtnisOffen((o) => !o)}>🧠</button>
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
