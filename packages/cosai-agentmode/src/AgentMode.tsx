/**
 * AgentMode — Overlay über der laufenden App oder eigene Seite, aus einer Komponente.
 *
 * Oben: Sprechkreis und die zwei letzten Sprechblasen. Mitte: im Overlay die App im Schaufenster (sehen, nicht
 * klicken, solange der Agent handelt), auf der Seite der Inhalt des Hosts (Kontextkarte, Todos) und der Zeitstrahl.
 * Unten: Mikrofon, Chips, Eingabe, Transkript, Gedächtnis. Der Kanal läuft über `anfrage` des Hosts (mit dessen
 * Anmeldung) gegen die Routen des Kerns; Steuerungen führt die Oberfläche Schritt für Schritt sichtbar aus.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chips, Gedaechtnisleiste, Schaufenster, Sprechblase, type ChipDaten, type GedaechtnisEintragDaten, type Schritt } from './Bausteine.tsx';
import { ausfuehren, beobachten, type Beobachtung, type Steuerung } from './kanal.ts';
import { saatAus } from './konstellation.ts';
import { Sprechkreis, SPRECHKREIS_STILE, type SprechkreisStil, type SprechkreisZustand } from './Sprechkreis.tsx';
import { useVorlesen, useZuhoeren } from './sprache.ts';

export interface AgentAntwortDaten {
  sitzungId: string;
  text: string;
  steuerung: Steuerung[];
  chips: ChipDaten[];
  wartetAuf?: { frage: string; aktion: Steuerung };
}

interface Zeile { wer: 'agent' | 'nutzer'; text: string; nr: number }

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
}

const SITZUNG = 'cosai.sitzung';

export function AgentMode({ api, anfrage, modus, navigiere, ort, kontext = {}, stil, onStil, children, schliessen, schrittMs = 700, farbe, onSteuerung }: AgentModeProps) {
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
  const nr = useRef(0);
  const abgebrochen = useRef(false);
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
      .then(async (r) => (r.ok ? ((await r.json()) as { sitzungId: string | null; verlauf: { rolle: string; text: string; chips?: ChipDaten[] | null }[] }) : null))
      .then((d) => {
        if (!aktiv || !d) return;
        if (d.sitzungId) sitzungMerken(d.sitzungId);
        const alt = d.verlauf.filter((v) => v.text).map((v) => ({ wer: v.rolle === 'agent' ? 'agent' as const : 'nutzer' as const, text: v.text, nr: (nr.current += 1) }));
        setZeilen(alt.slice(-100));
        const letzte = [...d.verlauf].reverse().find((v) => v.rolle === 'agent');
        if (letzte?.chips?.length) setChips(letzte.chips);
      })
      .catch(() => { /* ohne Verlauf beginnt das Gespräch leer */ });
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Beobachtung: Klicks und Meldungen der App an den Kern — solange AgentMode offen ist
  useEffect(() => beobachten((b: Beobachtung) => {
    void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, kontext: b.kontext ?? {}, sitzungId: sitzungId ?? undefined }) }).catch(() => undefined);
  }), [anfrage, api, sitzungId]);

  /** Führt die Steuerungen sichtbar aus — Schritt für Schritt, mit Etikett und Hervorhebung. */
  const steuern = useCallback(async (steuerung: Steuerung[]) => {
    if (!steuerung.length) return;
    setHandelt(true);
    abgebrochen.current = false;
    try {
      for (const s of steuerung) {
        if (abgebrochen.current) break;
        if (s.art === 'sprich') { zeile('agent', s.text ?? ''); continue; }
        setSchritt({ el: null, text: s.text ?? `${s.art} ${s.ziel ?? ''}`.trim() });
        try {
          const el = await ausfuehren(s, { navigiere });
          setSchritt({ el, text: s.text ?? `${s.art} ${s.ziel ?? ''}`.trim() });
          onSteuerung?.(s);
        } catch (e) {
          setFehler((e as Error).message);
          void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ art: 'klick', ziel: s.ziel ?? 'unbekannt', wert: `FEHLER: ${(e as Error).message}`, kontext: {}, sitzungId: sitzungId ?? undefined }) }).catch(() => undefined);
          break;
        }
        await new Promise((r) => setTimeout(r, schrittMs));
      }
    } finally {
      setSchritt(null);
      setHandelt(false);
    }
  }, [anfrage, api, navigiere, onSteuerung, schrittMs, sitzungId, zeile]);

  const verarbeiten = useCallback(async (antwort: AgentAntwortDaten) => {
    sitzungMerken(antwort.sitzungId);
    setWartetAuf(antwort.wartetAuf);
    setChips(antwort.chips ?? []);
    if (antwort.text) zeile('agent', antwort.text);
    const sprechen = antwort.text ? vorlesen.sprich(antwort.text) : Promise.resolve();
    await steuern(antwort.steuerung ?? []);
    await sprechen;
    if (antwort.wartetAuf && antwort.wartetAuf.frage !== antwort.text) {
      zeile('agent', antwort.wartetAuf.frage);
      await vorlesen.sprich(antwort.wartetAuf.frage);
    }
  }, [sitzungMerken, steuern, vorlesen, zeile]);

  const senden = useCallback(async (pfad: 'nachricht' | 'entscheidung', body: Record<string, unknown>, anzeige: string) => {
    if (beschaeftigt) return;
    setFehler(null);
    setBeschaeftigt(true);
    zeile('nutzer', anzeige);
    setChips([]);
    try {
      const r = await anfrage(`${api}/${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const f = (await r.json().catch(() => ({}))) as { fehler?: string };
        throw new Error(f.fehler ?? `Fehler ${r.status}`);
      }
      await verarbeiten((await r.json()) as AgentAntwortDaten);
    } catch (e) {
      setFehler((e as Error).message);
      zeile('agent', `Das hat nicht geklappt: ${(e as Error).message}`);
    } finally {
      setBeschaeftigt(false);
    }
  }, [anfrage, api, beschaeftigt, verarbeiten, zeile]);

  const nachricht = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setEingabe('');
    void senden('nachricht', { sitzungId: sitzungId ?? undefined, text: t, ort, kontext }, t);
  }, [kontext, ort, senden, sitzungId]);

  const chipWaehlen = useCallback((c: ChipDaten) => {
    if (c.art === 'entscheidung' && sitzungId && wartetAuf) {
      setWartetAuf(undefined);
      void senden('entscheidung', { sitzungId, wert: c.wert }, c.label);
    } else {
      nachricht(c.wert);
    }
  }, [nachricht, senden, sitzungId, wartetAuf]);

  // Zuhören: Zwischenstand ins Eingabefeld, am Ende abschicken; kurze Bestätigungen treffen die Chips direkt
  const zuhoeren = useZuhoeren((text, fertig) => {
    setEingabe(text);
    if (!fertig || !text) return;
    const kurz = text.toLowerCase().replace(/[.!?]/g, '').trim();
    const treffer = chips.find((c) => c.label.toLowerCase() === kurz || c.wert.toLowerCase() === kurz) ?? (wartetAuf && /^(ja|ok|okay|abschicken|mach)$/.test(kurz) ? chips.find((c) => c.wert === 'ja') : undefined) ?? (wartetAuf && /^(nein|nicht|stopp?|abbrechen)$/.test(kurz) ? chips.find((c) => c.wert === 'nein') : undefined);
    if (treffer) chipWaehlen(treffer); else nachricht(text);
  });

  const gedaechtnisLaden = useCallback(async () => {
    const r = await anfrage(`${api}/gedaechtnis`);
    if (r.ok) setGedaechtnis(((await r.json()) as { eintraege: GedaechtnisEintragDaten[] }).eintraege);
  }, [anfrage, api]);
  useEffect(() => { if (gedaechtnisOffen) void gedaechtnisLaden(); }, [gedaechtnisOffen, gedaechtnisLaden]);

  const zustand: SprechkreisZustand = zuhoeren.hoert ? 'hoert' : vorlesen.spricht ? 'spricht' : beschaeftigt || handelt ? 'denkt' : 'ruhig';
  const letzteAgent = [...zeilen].reverse().find((z) => z.wer === 'agent');
  const letzteNutzer = [...zeilen].reverse().find((z) => z.wer === 'nutzer');
  const kreisGroesse = modus === 'seite' ? 140 : 56;

  const oben = (
    <div className={`am-leiste am-oben ${modus === 'overlay' ? 'am-overlay-oben' : ''}`} data-agentmode-oben>
      <Sprechkreis stil={stil} zustand={zustand} pegel={zuhoeren.hoert ? zuhoeren.pegel : vorlesen.spricht ? 0.6 : 0} groesse={kreisGroesse} saat={saat} farbe={farbe} titel="Agent"
        onClick={zuhoeren.moeglich ? (zuhoeren.hoert ? zuhoeren.stoppe : zuhoeren.starte) : undefined} />
      <div className="am-blasen">
        {letzteAgent ? <Sprechblase wer="agent" text={letzteAgent.text} schluessel={letzteAgent.nr} lebendig /> : <div className="am-blase" data-wer="agent"><span className="am-wer">Agent</span>Ich höre. Sag mir, was ich tun soll — oder frag, was heute ansteht.</div>}
        {letzteNutzer && <Sprechblase wer="nutzer" text={letzteNutzer.text} schluessel={letzteNutzer.nr} />}
      </div>
      <div className="am-rechts">
        {onStil && (
          <select className="am-knopf" aria-label="Stil des Sprechkreises" value={stil} onChange={(e) => onStil(e.currentTarget.value as SprechkreisStil)}>
            {SPRECHKREIS_STILE.map((s) => <option key={s.wert} value={s.wert}>{s.label}</option>)}
          </select>
        )}
        {vorlesen.moeglich && <button type="button" className="am-knopf" aria-pressed={vorlesen.an} onClick={() => vorlesen.schalte(!vorlesen.an)}>{vorlesen.an ? '🔊 Vorlesen an' : '🔇 Vorlesen aus'}</button>}
        {schliessen && <button type="button" className="am-knopf" aria-label="AgentMode schließen" onClick={schliessen}>✕</button>}
      </div>
    </div>
  );

  const unten = (
    <div className={`am-leiste am-unten ${modus === 'overlay' ? 'am-overlay-unten' : ''}`} data-agentmode-unten>
      {zuhoeren.moeglich && (
        <button type="button" className="am-knopf" aria-pressed={zuhoeren.hoert} aria-label={zuhoeren.hoert ? 'Zuhören beenden' : 'Zuhören'} onClick={zuhoeren.hoert ? zuhoeren.stoppe : zuhoeren.starte}>🎤</button>
      )}
      <Chips chips={chips} waehlen={chipWaehlen} aus={beschaeftigt} />
      <form style={{ display: 'contents' }} onSubmit={(e) => { e.preventDefault(); nachricht(eingabe); }}>
        <input className="am-eingabe" aria-label="Nachricht an den Agenten" placeholder="Sag dem Agenten, was er tun soll …" value={eingabe} onChange={(e) => setEingabe(e.currentTarget.value)} disabled={beschaeftigt} />
        <button type="submit" className="am-knopf" disabled={beschaeftigt || !eingabe.trim()}>Senden</button>
      </form>
      <div className="am-rechts">
        {fehler && <span className="am-hinweis" role="alert">{fehler}</span>}
        <button type="button" className="am-knopf" aria-pressed={transkriptOffen} onClick={() => setTranskriptOffen((o) => !o)}>Transkript ▾</button>
        <button type="button" className="am-knopf" aria-pressed={gedaechtnisOffen} onClick={() => setGedaechtnisOffen((o) => !o)}>Gedächtnis ▾</button>
      </div>
      {transkriptOffen && (
        <div className="am-transkript" style={{ flexBasis: '100%' }} aria-label="Transkript">
          {zeilen.map((z) => <Sprechblase key={z.nr} wer={z.wer} text={z.text} schluessel={z.nr} />)}
        </div>
      )}
      {gedaechtnisOffen && (
        <div style={{ flexBasis: '100%' }}>
          <Gedaechtnisleiste eintraege={gedaechtnis}
            loeschen={(id) => anfrage(`${api}/gedaechtnis/${id}`, { method: 'DELETE' }).then(gedaechtnisLaden)}
            bestaetigen={(id) => anfrage(`${api}/gedaechtnis/${id}/bestaetigen`, { method: 'POST' }).then(gedaechtnisLaden)} />
        </div>
      )}
    </div>
  );

  if (modus === 'seite') {
    return (
      <div className="am-seite" data-agentmode="seite">
        {oben}
        <div className="am-seite-mitte">
          <div>{children}</div>
          <div className="am-karte">
            <h3>Gespräch</h3>
            <div className="am-transkript" style={{ maxHeight: 'none' }}>
              {zeilen.length ? zeilen.map((z) => <Sprechblase key={z.nr} wer={z.wer} text={z.text} schluessel={z.nr} />) : <p className="am-hinweis">Noch kein Gespräch.</p>}
            </div>
          </div>
        </div>
        {unten}
      </div>
    );
  }

  return (
    <div data-agentmode="overlay" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {oben}
      <Schaufenster aktiv={handelt} schritt={schritt} uebernehmen={() => { abgebrochen.current = true; setHandelt(false); setSchritt(null); }}>
        {children}
      </Schaufenster>
      {unten}
    </div>
  );
}
