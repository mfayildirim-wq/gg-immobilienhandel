/**
 * Die Leiste rechts: oben der grüne Sprechkreis mit dem Dialog, in dem man gerade ist, und ⚙ für Modell und Gedächtnis;
 * darunter der Chat; unten Verlauf und Gedächtnis zu diesem Dialog. Jede Antwort lässt sich mit Titel im Gedächtnis ablegen.
 * Schlägt die KI Änderungen an Daten vor, stehen sie als Karten unter der Antwort — gespeichert wird erst mit „Übernehmen“.
 *
 * Kein UI-Baukasten, nur React und `ki-leiste.css` (Farben über --ki-*), damit jede App sie einbauen kann.
 * Markdown wandelt die App (`darstellen`, muss bereinigtes HTML liefern); ohne sie erscheint der Text unverändert.
 */
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { KiAenderung, KiBezugSicht, KiEinstellungen, KiGedaechtnisEintrag, KiGespraech, KiGespraechKopf, KiNachricht, KiStand } from '@gg/ki-kern/vertrag';
import { useKiLeiste } from './kontext.tsx';
import { Sprechkreis } from './Sprechkreis.tsx';

export const KI_GRUEN = '#2b8a3e';

export interface KiLeisteProps {
  /** Markdown → bereinigtes HTML */
  darstellen?: (markdown: string) => string;
  /** Nach einer übernommenen Änderung: die App lädt ihre Daten neu */
  nachAenderung?: () => void;
}

const QUELLE: Record<string, string> = { api: 'aus der App', ki: 'gemerkt', hand: 'korrigiert', ablage: 'abgelegt', mcp: 'Claude' };
const datum = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fehlerText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Inhalt({ text, darstellen }: { text: string; darstellen?: (md: string) => string }) {
  if (!darstellen) return <div className="kl-text kl-roh">{text}</div>;
  return <div className="kl-text" dangerouslySetInnerHTML={{ __html: darstellen(text) }} />;
}

export function KiLeiste({ darstellen, nachAenderung }: KiLeisteProps) {
  const { transport, bezug, setOffen } = useKiLeiste();
  const [stand, setStand] = useState<KiStand | null>(null);
  const [sicht, setSicht] = useState<KiBezugSicht | null>(null);
  const [allgemein, setAllgemein] = useState<KiGespraechKopf[]>([]);
  const [gespraech, setGespraech] = useState<KiGespraech | null>(null);
  const [wartend, setWartend] = useState<string | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [fehler, setFehler] = useState('');
  const [einstellungenOffen, setEinstellungenOffen] = useState(false);
  const [unten, setUnten] = useState<'verlauf' | 'gedaechtnis'>('verlauf');
  const ende = useRef<HTMLDivElement>(null);
  const bezugSchluessel = bezug ? `${bezug.art}:${bezug.id}` : '';

  const standLaden = useCallback(() => { transport.stand().then(setStand, (e) => setFehler(fehlerText(e))); }, [transport]);
  useEffect(standLaden, [standLaden]);

  const sichtLaden = useCallback(async () => {
    try {
      if (bezug) {
        setSicht(await transport.bezug(bezug));
      } else {
        setSicht(null);
        setAllgemein((await transport.allgemein()).gespraeche);
      }
    } catch (e) {
      setSicht(null);
      setFehler(fehlerText(e));
    }
    // `bezug` bleibt dasselbe Objekt, solange derselbe Dialog gemeldet ist (KiLeisteRahmen)
  }, [transport, bezug]);

  // Neuer Dialog → neues Gespräch, Verlauf und Gedächtnis dieses Dialogs
  useEffect(() => {
    setGespraech(null);
    setFehler('');
    void sichtLaden();
  }, [sichtLaden]);

  useEffect(() => { ende.current?.scrollIntoView?.({ block: 'end' }); }, [gespraech, wartend]);

  async function senden(e?: FormEvent) {
    e?.preventDefault();
    const text = eingabe.trim();
    if (!text || wartend) return;
    setWartend(text);
    setEingabe('');
    setFehler('');
    try {
      const g = await transport.senden({ gespraechId: gespraech?.id ?? null, bezug, text });
      setGespraech(g);
      void sichtLaden();
    } catch (f) {
      setFehler(fehlerText(f));
      setEingabe(text);
    } finally {
      setWartend(null);
    }
  }

  function taste(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void senden();
    }
  }

  async function oeffnen(id: string) {
    try { setGespraech(await transport.gespraech(id)); } catch (e) { setFehler(fehlerText(e)); }
  }

  const gespraeche = sicht ? sicht.gespraeche : allgemein;
  const gedaechtnis = sicht?.gedaechtnis;
  const nachrichten: KiNachricht[] = [...(gespraech?.nachrichten ?? []), ...(wartend ? [{ rolle: 'nutzer' as const, text: wartend, am: '' }] : [])];
  // Ablegen geht in das Gedächtnis des Dialogs, in dem das Gespräch begann
  const ablegenMoeglich = Boolean(gedaechtnis?.verbunden && (gespraech?.bezug ?? bezug));

  return (
    <section className="kl-leiste" aria-label="KI-Leiste">
      <header className="kl-kopf">
        <Sprechkreis groesse={40} farbe={KI_GRUEN} zustand={wartend ? 'denkt' : 'ruhig'} titel="KI-Assistent" saat={11} />
        <div className="kl-kopf-text">
          <strong>KI-Assistent</strong>
          <span className="kl-bezug" data-ki-bezug={bezugSchluessel || 'keiner'}>
            {sicht ? `${sicht.label}: ${sicht.titel}` : bezug ? '…' : 'Kein Datensatz geöffnet'}
          </span>
        </div>
        <button type="button" className="kl-symbol" aria-label="Neues Gespräch" title="Neues Gespräch" onClick={() => { setGespraech(null); setFehler(''); }} disabled={!gespraech}>＋</button>
        <button type="button" className="kl-symbol" aria-label="Einstellungen der KI-Leiste" title="Einstellungen" aria-pressed={einstellungenOffen} onClick={() => setEinstellungenOffen(!einstellungenOffen)}>⚙</button>
        <button type="button" className="kl-symbol" aria-label="KI-Leiste schließen" title="Schließen" onClick={() => setOffen(false)}>✕</button>
      </header>

      {einstellungenOffen && stand && (
        <Einstellungen stand={stand} speichern={async (e) => { await transport.einstellungenSpeichern(e); standLaden(); setEinstellungenOffen(false); }} />
      )}
      {stand && !stand.verfuegbar && <p className="kl-hinweis" role="status">Die KI ist nicht eingerichtet (Anthropic-Schlüssel fehlt).</p>}

      <div className="kl-chat" aria-live="polite">
        {!nachrichten.length && (
          <p className="kl-leer">
            {sicht ? `Frag etwas zu „${sicht.titel}“ — z. B. „Fass den Stand zusammen“ oder „Gibt es ähnliche Angebote in der Umgebung?“` : 'Frag etwas — öffnest du einen Deal, Makler, ein Objekt …, bezieht sich die Leiste darauf.'}
          </p>
        )}
        {nachrichten.map((n, i) => (
          <Nachricht key={`${i}-${n.am}`} n={n} darstellen={darstellen} frage={nachrichten[i - 1]?.text}
            ablegen={ablegenMoeglich && n.rolle === 'ki' && gespraech ? async (titel, text) => {
              const ziel = gespraech.bezug ?? bezug;
              if (!ziel) return;
              await transport.ablegen({ bezug: ziel, titel, text, gespraechId: gespraech.id, nachricht: i });
              setGespraech(await transport.gespraech(gespraech.id));
              void sichtLaden();
            } : undefined}
            verwerfen={gespraech ? async () => setGespraech(await transport.vorschlagVerwerfen({ gespraechId: gespraech.id, nachricht: i })) : undefined}
            entscheiden={gespraech ? async (aenderung, aktion) => {
              const g = await transport.aenderungEntscheiden({ gespraechId: gespraech.id, nachricht: i, aenderung, aktion });
              setGespraech(g);
              if (g.nachrichten[i]?.aenderungen?.[aenderung]?.status === 'uebernommen') { nachAenderung?.(); void sichtLaden(); }
            } : undefined} />
        ))}
        {wartend && <p className="kl-denkt" role="status">Denkt nach …</p>}
        <div ref={ende} />
      </div>

      {fehler && <p className="kl-fehler" role="alert">{fehler}</p>}

      <form className="kl-eingabe" onSubmit={senden}>
        <textarea aria-label="Frage an die KI" placeholder={gespraech ? 'Weiter fragen …' : 'Frage stellen … (Enter sendet)'} value={eingabe}
          onChange={(e) => setEingabe(e.target.value)} onKeyDown={taste} rows={2} disabled={stand?.verfuegbar === false} />
        <button type="submit" className="kl-senden" disabled={!eingabe.trim() || Boolean(wartend)}>Senden</button>
      </form>

      <div className="kl-unten">
        <div className="kl-reiter" role="tablist">
          <button type="button" role="tab" aria-selected={unten === 'verlauf'} onClick={() => setUnten('verlauf')}>🕘 Verlauf ({gespraeche.length})</button>
          {sicht && (
            <button type="button" role="tab" aria-selected={unten === 'gedaechtnis'} onClick={() => setUnten('gedaechtnis')}>
              🧠 Gedächtnis ({gedaechtnis?.eintraege.length ?? 0})
            </button>
          )}
        </div>
        <div className="kl-unten-inhalt" role="tabpanel">
          {unten === 'verlauf' || !sicht ? (
            <Verlauf gespraeche={gespraeche} aktiv={gespraech?.id} oeffnen={oeffnen} loeschen={async (id) => {
              try {
                await transport.gespraechLoeschen(id);
                if (gespraech?.id === id) setGespraech(null);
                void sichtLaden();
              } catch (e) { setFehler(fehlerText(e)); }
            }} />
          ) : (
            <Gedaechtnis g={gedaechtnis} darstellen={darstellen} />
          )}
        </div>
      </div>
    </section>
  );
}

type Ablegen = (titel: string, text: string) => Promise<void>;
type Entscheiden = (aenderung: number, aktion: 'uebernehmen' | 'verwerfen') => Promise<void>;

function Nachricht({ n, darstellen, frage, ablegen, verwerfen, entscheiden }: {
  n: KiNachricht; darstellen?: (md: string) => string; frage?: string; ablegen?: Ablegen; verwerfen?: () => Promise<void>; entscheiden?: Entscheiden;
}) {
  if (n.rolle === 'nutzer') return <div className="kl-nutzer" data-ki-nachricht="nutzer">{n.text}</div>;
  const werkzeuge = (n.schritte ?? []).filter((s) => s.art === 'werkzeug' && s.name !== 'gedaechtnis_vorschlagen');
  const suchen = (n.schritte ?? []).filter((s) => s.art === 'websuche');
  const offenerVorschlag = n.vorschlag && !n.vorschlag.status ? n.vorschlag : null;
  return (
    <article className="kl-ki" data-ki-nachricht="ki">
      <Inhalt text={n.text} darstellen={darstellen} />
      {Boolean(n.quellen?.length) && (
        <ul className="kl-quellen" aria-label="Quellen">
          {n.quellen!.map((q) => <li key={q.url}><a href={q.url} target="_blank" rel="noopener noreferrer">{q.titel}</a></li>)}
        </ul>
      )}
      <div className="kl-fuss">
        {werkzeuge.length > 0 && <span title={werkzeuge.map((s) => `${s.name} ${s.kurz ?? ''}`).join('\n')}>🔧 {werkzeuge.map((s) => s.name).join(', ')}</span>}
        {suchen.length > 0 && <span title={suchen.map((s) => s.kurz).join('\n')}>🌐 {suchen.length}× gesucht</span>}
        {n.gedaechtnis !== undefined && <span>🧠 {n.gedaechtnis} aus dem Gedächtnis</span>}
      </div>
      {n.aenderungen?.map((a, j) => <Aenderung key={j} a={a} entscheiden={entscheiden ? (aktion) => entscheiden(j, aktion) : undefined} />)}
      {n.abgelegt ? <p className="kl-abgelegt" role="status">✓ Im Gedächtnis abgelegt: {n.abgelegt}</p>
        : offenerVorschlag && ablegen ? <Vorschlag titel={offenerVorschlag.titel} text={offenerVorschlag.text} ablegen={ablegen} verwerfen={verwerfen} />
        : n.vorschlag?.status === 'verworfen' ? <p className="kl-leer kl-klein">Vorschlag fürs Gedächtnis verworfen.</p>
        : ablegen ? <Ablegen vorschlag={titelVorschlag(n.text, frage)} text={n.text} ablegen={ablegen} /> : null}
    </article>
  );
}

/** Wert für die Karte: Text unverändert, sonst kurz als JSON */
const wertText = (v: unknown) => (v === null ? '(leer)' : typeof v === 'string' ? (v || '(leer)') : JSON.stringify(v));
/** Technisches für die Prüfung weglassen — die Version prüft der Server beim Übernehmen */
const VERBORGEN = new Set(['version']);

/** Die KI schlägt eine Änderung an Daten vor — erst „Übernehmen“ führt sie aus. */
function Aenderung({ a, entscheiden }: { a: KiAenderung; entscheiden?: (aktion: 'uebernehmen' | 'verwerfen') => Promise<void> }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const felder = Object.entries(a.argumente).filter(([k]) => !VERBORGEN.has(k));
  const tun = async (aktion: 'uebernehmen' | 'verwerfen') => {
    if (!entscheiden) return;
    setLaeuft(true);
    setFehler('');
    try { await entscheiden(aktion); } catch (e) { setFehler(fehlerText(e)); } finally { setLaeuft(false); }
  };
  return (
    <div className="kl-vorschlag kl-aenderung" role="group" aria-label={`Änderung: ${a.titel}`} data-ki-aenderung={a.status ?? 'offen'}>
      <strong>✏️ {a.titel}</strong>
      <dl className="kl-felder">
        {felder.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{wertText(v)}</dd></div>)}
      </dl>
      {a.status === 'uebernommen' ? <p className="kl-abgelegt" role="status">✓ Übernommen</p>
        : a.status === 'verworfen' ? <p className="kl-leer kl-klein">Verworfen.</p>
        : a.status === 'fehler' ? <p className="kl-fehler" role="alert">Nicht übernommen: {a.ergebnis}</p>
        : entscheiden && (
          <div className="kl-knoepfe">
            <button type="button" disabled={laeuft} onClick={() => void tun('uebernehmen')}>Übernehmen</button>
            <button type="button" className="kl-zweit" disabled={laeuft} onClick={() => void tun('verwerfen')}>Verwerfen</button>
          </div>
        )}
      {fehler && <span className="kl-fehler" role="alert">{fehler}</span>}
    </div>
  );
}

/** Erste Überschrift der Antwort, sonst die Frage */
export function titelVorschlag(antwort: string, frage?: string): string {
  const h = /^#{1,3}\s+(.+)$/m.exec(antwort)?.[1];
  const t = (h ?? frage ?? 'KI-Ergebnis').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

/** Die KI schlägt vor — der Nutzer legt ab, ändert vorher Titel und Text oder verwirft. */
function Vorschlag({ titel: start, text: startText, ablegen, verwerfen }: { titel: string; text: string; ablegen: Ablegen; verwerfen?: () => Promise<void> }) {
  const [titel, setTitel] = useState(start);
  const [text, setText] = useState(startText);
  const [aendern, setAendern] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const tun = async (f: () => Promise<void>) => {
    setLaeuft(true);
    setFehler('');
    try { await f(); } catch (e) { setFehler(fehlerText(e)); } finally { setLaeuft(false); }
  };
  return (
    <div className="kl-vorschlag" role="group" aria-label="Vorschlag fürs Gedächtnis" data-ki-vorschlag>
      <strong>🧠 Im Gedächtnis ablegen?</strong>
      {aendern ? (
        <>
          <input aria-label="Titel im Gedächtnis" value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} />
          <textarea aria-label="Text im Gedächtnis" value={text} onChange={(e) => setText(e.target.value)} rows={5} />
        </>
      ) : (
        <>
          <span className="kl-zeile-titel">{titel}</span>
          <span className="kl-auszug">{text}</span>
        </>
      )}
      <div className="kl-knoepfe">
        <button type="button" disabled={laeuft || !titel.trim() || !text.trim()} onClick={() => void tun(() => ablegen(titel.trim(), text.trim()))}>Ablegen</button>
        {!aendern && <button type="button" className="kl-zweit" onClick={() => setAendern(true)}>Ändern</button>}
        {verwerfen && <button type="button" className="kl-zweit" disabled={laeuft} onClick={() => void tun(verwerfen)}>Verwerfen</button>}
      </div>
      {fehler && <span className="kl-fehler" role="alert">{fehler}</span>}
      <small>Gleicher Titel ersetzt den alten Eintrag.</small>
    </div>
  );
}

function Ablegen({ vorschlag, text, ablegen }: { vorschlag: string; text: string; ablegen: Ablegen }) {
  const [offen, setOffen] = useState(false);
  const [titel, setTitel] = useState(vorschlag);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  if (!offen) return <button type="button" className="kl-ablegen" onClick={() => setOffen(true)}>🧠 Im Gedächtnis ablegen</button>;
  return (
    <form className="kl-ablegen-form" onSubmit={async (e) => {
      e.preventDefault();
      setLaeuft(true);
      setFehler('');
      try { await ablegen(titel.trim(), text); } catch (f) { setFehler(fehlerText(f)); setLaeuft(false); }
    }}>
      <input aria-label="Titel im Gedächtnis" value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} />
      <button type="submit" disabled={!titel.trim() || laeuft}>Ablegen</button>
      <button type="button" onClick={() => setOffen(false)}>Abbrechen</button>
      {fehler && <span className="kl-fehler" role="alert">{fehler}</span>}
      <small>Gleicher Titel ersetzt den alten Eintrag.</small>
    </form>
  );
}

function Verlauf({ gespraeche, aktiv, oeffnen, loeschen }: { gespraeche: KiGespraechKopf[]; aktiv?: string; oeffnen: (id: string) => void; loeschen: (id: string) => Promise<void> }) {
  const [fragen, setFragen] = useState<string | null>(null);
  if (!gespraeche.length) return <p className="kl-leer">Noch keine Gespräche zu diesem Dialog.</p>;
  return (
    <ul className="kl-liste">
      {gespraeche.map((g) => (
        <li key={g.id} className="kl-verlauf-zeile">
          <button type="button" className="kl-zeile" aria-current={g.id === aktiv || undefined} onClick={() => oeffnen(g.id)} data-ki-gespraech={g.id}>
            <span className="kl-zeile-titel">{g.titel}</span>
            <small>{datum(g.am)} · {g.von} · {Math.ceil(g.anzahl / 2)} Fragen</small>
          </button>
          {fragen === g.id ? (
            <span className="kl-knoepfe">
              <button type="button" className="kl-loeschen" onClick={() => { setFragen(null); void loeschen(g.id); }}>Wirklich löschen</button>
              <button type="button" className="kl-symbol" aria-label="Nicht löschen" onClick={() => setFragen(null)}>✕</button>
            </span>
          ) : (
            <button type="button" className="kl-symbol" aria-label={`Gespräch löschen: ${g.titel}`} title="Gespräch löschen" onClick={() => setFragen(g.id)}>🗑</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Gedaechtnis({ g, darstellen }: { g?: KiBezugSicht['gedaechtnis']; darstellen?: (md: string) => string }) {
  const [auf, setAuf] = useState<string | null>(null);
  if (!g?.verbunden) return <p className="kl-leer">Der Gedächtnis-Dienst ist nicht eingerichtet.</p>;
  if (g.fehler) return <p className="kl-fehler" role="alert">{g.fehler}</p>;
  if (!g.eintraege.length) return <p className="kl-leer">Noch nichts im Gedächtnis.</p>;
  return (
    <ul className="kl-liste">
      {g.eintraege.map((e: KiGedaechtnisEintrag) => (
        <li key={e.id} data-ki-gedaechtnis={e.id}>
          <button type="button" className="kl-zeile" aria-expanded={auf === e.id} onClick={() => setAuf(auf === e.id ? null : e.id)}>
            {e.titel && <span className="kl-zeile-titel">{e.titel}</span>}
            {auf !== e.id && <span className="kl-auszug">{e.text}</span>}
            <small>{[e.quelle && (QUELLE[e.quelle] ?? e.quelle), e.von, datum(e.am)].filter(Boolean).join(' · ')}</small>
          </button>
          {auf === e.id && <Inhalt text={e.text} darstellen={darstellen} />}
        </li>
      ))}
    </ul>
  );
}

function Einstellungen({ stand, speichern }: { stand: KiStand; speichern: (e: KiEinstellungen) => Promise<void> }) {
  const [e, setE] = useState(stand.einstellungen);
  const [fehler, setFehler] = useState('');
  return (
    <form className="kl-einstellungen" aria-label="Einstellungen der KI-Leiste" onSubmit={async (ev) => {
      ev.preventDefault();
      try { await speichern(e); } catch (f) { setFehler(fehlerText(f)); }
    }}>
      <label>Modell
        <select value={e.modell} onChange={(x) => setE({ ...e, modell: x.target.value })}>
          {stand.modelle.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="kl-schalter"><input type="checkbox" checked={e.websuche} onChange={(x) => setE({ ...e, websuche: x.target.checked })} /> Websuche erlauben</label>
      <label className="kl-schalter"><input type="checkbox" checked={e.gedaechtnis} onChange={(x) => setE({ ...e, gedaechtnis: x.target.checked })} /> Gedächtnis des Dialogs mitgeben</label>
      <small>Gedächtnis-Dienst: {stand.gedaechtnis ? 'verbunden' : 'nicht eingerichtet'}</small>
      <small>Verlauf: {stand.verlaufDauerhaft ? 'im Gedächtnis-Dienst, getrennt vom Wissen; nach 90 Tagen ohne Fortsetzung gelöscht' : 'nur bis zum Neustart (ohne Gedächtnis-Dienst)'}</small>
      {fehler && <span className="kl-fehler" role="alert">{fehler}</span>}
      <button type="submit">Speichern</button>
    </form>
  );
}
