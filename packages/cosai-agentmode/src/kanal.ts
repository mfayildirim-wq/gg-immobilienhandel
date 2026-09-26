/**
 * Der Kanal zwischen Oberfläche und Agent — die Seite der Oberfläche.
 *
 * Steuerung (Agent → Oberfläche): `ausfuehren` findet das Ziel über `data-agent="<ziel>"` (Listeneinträge zusätzlich
 * über `data-agent-wert`), klickt, füllt (so, dass React es merkt) oder navigiert über den Host.
 * Beobachtung (Oberfläche → Agent): `beobachten` meldet Klicks auf markierte Elemente; `melden('gespeichert', …)` rufen
 * Host-Komponenten nach erfolgreichem Speichern auf — der Agent lernt daraus Formulierungen.
 */

export type SteuerungArt = 'navigiere' | 'oeffne' | 'fuelle' | 'sende' | 'markiere' | 'zeige' | 'sprich';
export interface Steuerung { art: SteuerungArt; ziel?: string; wert?: string; text?: string }
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
      klicken(el);
      return el;
    }
    case 'fuelle': {
      const el = await zielAbwarten(s.ziel!, undefined, wartenMs);
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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
