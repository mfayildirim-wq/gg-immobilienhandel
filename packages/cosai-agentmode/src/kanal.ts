/**
 * Der Kanal zwischen Oberfläche und Agent — die Seite der Oberfläche.
 *
 * Steuerung (Agent → Oberfläche): `ausfuehren` findet das Ziel über `data-agent="<ziel>"` (Listeneinträge zusätzlich
 * über `data-agent-wert`), klickt, füllt (so, dass React es merkt) oder navigiert über den Host.
 * Beobachtung (Oberfläche → Agent): `beobachten` meldet Klicks auf markierte Elemente; `melden('gespeichert', …)` rufen
 * Host-Komponenten nach erfolgreichem Speichern auf — der Agent lernt daraus Formulierungen.
 */

export type SteuerungArt = 'navigiere' | 'oeffne' | 'fuelle' | 'sende' | 'markiere' | 'zeige' | 'sprich' | 'werkzeug';
export interface Steuerung { art: SteuerungArt; ziel?: string; wert?: string; text?: string; bestaetigt?: boolean }
export type BeobachtungArt = 'navigation' | 'klick' | 'eingabe' | 'gespeichert';
export interface Beobachtung { art: BeobachtungArt; ziel: string; wert?: string; kontext?: Record<string, string | number | boolean | null> }

const EREIGNIS = 'cosai:beobachtung';

/**
 * Findet das Element eines Ziels; `wert` wählt einen Listeneintrag (`data-agent-wert`), sonst den ersten Treffer.
 * Ein Element kann neben `data-agent` weitere Ziele in `data-agent-auch` tragen (z. B. der erste Eintrag einer Liste).
 */
export function zielFinden(ziel: string, wert?: string, root: ParentNode = document): HTMLElement | null {
  const z = CSS.escape(ziel);
  const alle = Array.from(root.querySelectorAll<HTMLElement>(`[data-agent="${z}"], [data-agent-auch~="${z}"]`));
  if (!alle.length) return null;
  if (wert !== undefined) return alle.find((e) => e.dataset.agentWert === wert) ?? null;
  return alle[0]!;
}

/** Setzt einen Wert in ein Eingabefeld so, dass React (kontrollierte Felder) die Änderung sieht. */
export function wertSetzen(el: HTMLElement, wert: string): void {
  const feld = el.matches('input, textarea') ? el : el.querySelector<HTMLElement>('input, textarea');
  if (!feld) throw new Error('Kein Eingabefeld unter dem Ziel');
  const proto = feld instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter ? setter.call(feld, wert) : ((feld as HTMLInputElement).value = wert);
  feld.dispatchEvent(new Event('input', { bubbles: true }));
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Zweite Sperre neben dem Kern: Ziele mit `data-agent-schreibt` (speichern etwas) klickt oder füllt die Oberfläche nur,
 * wenn der Kern die Aktion nach dem „Ja“ des Nutzers als `bestaetigt` markiert hat.
 */
function schreibSperre(el: HTMLElement, s: Steuerung): void {
  if (el.closest('[data-agent-schreibt]') && !s.bestaetigt) throw new Error(`${s.ziel} speichert — nur nach Bestätigung`);
}

/** Klickt das Ziel selbst — oder, wenn markiert, das klickbare Element darin (`data-agent-klick`). */
export function klicken(el: HTMLElement): void {
  (el.querySelector<HTMLElement>('[data-agent-klick]') ?? el).click();
}

export interface AusfuehrenOptionen {
  /** Seitenwechsel — der Host kennt seinen Router; das Ziel `nav.<seite>` liefert er als Pfad */
  navigiere: (ziel: string) => Promise<void> | void;
  /** Wartet, bis ein Ziel im DOM ist (nach Navigation oder Laden) */
  wartenMs?: number;
}

/** Wartet, bis das Ziel erscheint — nach Navigation oder während Daten laden. */
export async function zielAbwarten(ziel: string, wert: string | undefined, ms: number): Promise<HTMLElement> {
  const bis = Date.now() + ms;
  for (;;) {
    const el = zielFinden(ziel, wert);
    if (el) return el;
    if (Date.now() > bis) throw new Error(`Ziel „${ziel}“ nicht gefunden`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

/** Führt eine Steuerung aus. Wirft, wenn das Ziel fehlt — der Agent erfährt es als Fehler, nichts wird geraten. */
export async function ausfuehren(s: Steuerung, opt: AusfuehrenOptionen): Promise<HTMLElement | null> {
  const wartenMs = opt.wartenMs ?? 4000;
  switch (s.art) {
    case 'sprich':
      return null;
    case 'navigiere': {
      if (!s.ziel) throw new Error('navigiere ohne Ziel');
      await opt.navigiere(s.ziel);
      return null;
    }
    case 'zeige':
    case 'markiere': {
      const el = await zielAbwarten(s.ziel!, s.wert, wartenMs);
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return el;
    }
    case 'oeffne':
    case 'sende': {
      const el = await zielAbwarten(s.ziel!, s.wert, wartenMs);
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      schreibSperre(el, s);
      klicken(el);
      return el;
    }
    case 'fuelle': {
      const el = await zielAbwarten(s.ziel!, undefined, wartenMs);
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      schreibSperre(el, s);
      wertSetzen(el, s.wert ?? '');
      return el;
    }
    default:
      return null;
  }
}

/** Host-Komponenten melden, was passiert ist — z. B. nach dem Speichern einer Notiz. Ohne AgentMode verhallt es. */
export function melden(b: Beobachtung): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent<Beobachtung>(EREIGNIS, { detail: b }));
}

/**
 * Der Fokus der App: was gerade offen ist, markiert mit `data-agent-fokus='{"dealId":"…","deal":"Musterweg 1"}'`.
 * Mehrere Marken werden zusammengeführt. Jeder Schlüssel `<typ>Id` ist ein Objekt, auf das sich Ergebnisse beziehen.
 */
export function fokusLesen(root: Document = document): Record<string, string | number | boolean | null> {
  const fokus: Record<string, string | number | boolean | null> = {};
  for (const el of root.querySelectorAll<HTMLElement>('[data-agent-fokus]')) {
    try { Object.assign(fokus, JSON.parse(el.dataset.agentFokus ?? '{}')); } catch { /* ungültige Marke überspringen */ }
  }
  return fokus;
}

/** Die Objekte im Fokus: `<typ>Id` → { typ, id, name } */
export function fokusBezuege(fokus: Record<string, unknown>): { typ: string; id: string; name: string }[] {
  return Object.entries(fokus)
    .filter(([k, v]) => /^[a-z][a-zA-Z0-9]*Id$/.test(k) && typeof v === 'string' && v !== '')
    .map(([k, v]) => ({ typ: k.slice(0, -2), id: v as string, name: typeof fokus[k.slice(0, -2)] === 'string' ? (fokus[k.slice(0, -2)] as string) : '' }));
}

/** Der Kontext eines Ziels (z. B. welcher Deal offen ist) als Text — zum Vergleich vor einer Bestätigung. */
/** Der Bereich einer Seite: erster Teil des Pfads (`/deals/abc` → `/deals`) — wie im Kern, je Bereich ein Gesprächsfaden */
export function bereichVon(ort: string): string {
  const erster = (ort.split(/[?#]/)[0] ?? '/').split('/').filter(Boolean)[0];
  return erster ? `/${erster}` : '/';
}

export function zielKontext(ziel: string): string | null {
  const el = zielFinden(ziel);
  return el ? JSON.stringify(kontextVon(el)) : null;
}

/** Kontext aus dem nächsten markierten Vorfahren: `data-agent-kontext='{"dealId":"…"}'` */
function kontextVon(el: HTMLElement): Record<string, string | number | boolean | null> {
  const traeger = el.closest<HTMLElement>('[data-agent-kontext]');
  if (!traeger?.dataset.agentKontext) return {};
  try {
    return JSON.parse(traeger.dataset.agentKontext) as Record<string, string | number | boolean | null>;
  } catch {
    return {};
  }
}

/** Beobachtet Klicks auf markierte Elemente und Meldungen der Host-Komponenten; liefert die Abmeldung. */
export function beobachten(senden: (b: Beobachtung) => void, root: Document = document): () => void {
  const aufKlick = (e: Event) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-agent]');
    if (!el || el.dataset.agentStumm !== undefined) return;
    senden({ art: 'klick', ziel: el.dataset.agent!, wert: el.dataset.agentWert, kontext: kontextVon(el) });
  };
  const aufMeldung = (e: Event) => senden((e as CustomEvent<Beobachtung>).detail);
  root.addEventListener('click', aufKlick, true);
  root.addEventListener(EREIGNIS, aufMeldung);
  return () => {
    root.removeEventListener('click', aufKlick, true);
    root.removeEventListener(EREIGNIS, aufMeldung);
  };
}

/**
 * Liest einen Strom aus Server-Sent Events (`event:` + `data:` je Block) und ruft `auf` je Ereignis mit den JSON-Daten.
 * Für die Antworten des Kerns mit `Accept: text/event-stream` (schritt, text, antwort, fehler).
 */
export async function stromLesen(antwort: Response, auf: (art: string, daten: Record<string, unknown>) => void): Promise<void> {
  const leser = antwort.body!.pipeThrough(new TextDecoderStream()).getReader();
  let puffer = '';
  const block = (roh: string) => {
    let art = 'message';
    const daten: string[] = [];
    for (const zeile of roh.split(/\r?\n/)) {
      if (zeile.startsWith('event:')) art = zeile.slice(6).trim();
      else if (zeile.startsWith('data:')) daten.push(zeile.slice(5).replace(/^ /, ''));
    }
    if (!daten.length) return;
    try { auf(art, JSON.parse(daten.join('\n')) as Record<string, unknown>); } catch { /* unvollständiger Block — ignorieren */ }
  };
  for (;;) {
    const { value, done } = await leser.read();
    if (done) break;
    puffer += value;
    const teile = puffer.split(/\r?\n\r?\n/);
    puffer = teile.pop() ?? '';
    for (const t of teile) block(t);
  }
  if (puffer.trim()) block(puffer);
}
