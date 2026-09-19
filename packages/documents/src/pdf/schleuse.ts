// Port von gg-immohandel server/render-schleuse.ts (Kern ohne Express).
// ──────────────────────────────────────────────────────────────
// Wie viele Exporte gleichzeitig rendern dürfen
// ──────────────────────────────────────────────────────────────
// Jeder PDF-Export startet ein eigenes Chromium (pdf/render.ts). Ein Browser braucht je nach
// Präsentation mehrere hundert MB; fünf gleichzeitige Exporte reichen, um den
// Speicher der Function zu füllen. Das Ergebnis war kein langsamer Export,
// sondern ein toter Prozess — und mit ihm alle laufenden Anfragen, auch die,
// die mit dem Rendern nichts zu tun hatten.
//
// Die Schleuse ist deshalb kein Rate-Limit (das zählt Anfragen pro Minute und
// hilft gegen Wiederholung, nicht gegen Gleichzeitigkeit), sondern ein Zähler
// über tatsächlich laufende Renderläufe. Wer keinen Platz bekommt, wartet
// kurz — Warten ist für einen Export die richtige Antwort, denn er kostet
// ohnehin Sekunden. Erst wenn auch die Warteschlange voll ist, kommt eine
// ehrliche 503 mit Retry-After statt einer Antwort, die nie kommt.
// ──────────────────────────────────────────────────────────────

export class SchleuseVollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchleuseVollError';
  }
}

/** Der Wartende war weg, bevor er an die Reihe kam. Kein Fehlerfall, sondern der
 *  Alltag „Tab geschlossen" — und deshalb ein eigener Typ: auf ihn gehört keine
 *  503, es liest sie niemand mehr. */
export class AbbruchError extends Error {
  constructor(message = 'Der Aufrufer war weg, bevor ein Platz frei wurde.') {
    super(message);
    this.name = 'AbbruchError';
  }
}

export interface SchleusenOptionen {
  /** Wie viele Läufe gleichzeitig rendern dürfen. */
  maxParallel: number;
  /** Wie viele zusätzlich warten dürfen. */
  maxWartend: number;
  /** Wie lange ein Wartender höchstens ansteht, bevor er abgewiesen wird. */
  wartezeitMs: number;
}

export interface Schleuse {
  /** Platz belegen. Auflösung liefert die Freigabe-Funktion.
   *
   *  `abbruch` ist der Abmelde-Weg für die Wartezeit: wird er ausgelöst, fliegt
   *  der Aufruf aus der Schlange und lehnt mit `AbbruchError` ab. Ohne ihn bekäme
   *  ein längst verschwundener Wartender den nächsten frei werdenden Platz und
   *  gäbe ihn nie zurück. Nach dem Zuschlag hat das Signal keine Wirkung mehr —
   *  ab da ist die Freigabe-Funktion die einzige Zuständigkeit des Aufrufers. */
  betrete(abbruch?: AbortSignal): Promise<() => void>;
  laufend(): number;
  wartend(): number;
}

/** Sorgt dafür, dass eine Freigabe auch bei doppeltem Aufruf nur einmal zählt —
 *  `res.on('close')` kann zusammen mit einem eigenen finally feuern. */
function nurEinmal(fn: () => void): () => void {
  let benutzt = false;
  return () => {
    if (benutzt) return;
    benutzt = true;
    fn();
  };
}

export function erzeugeSchleuse(o: SchleusenOptionen): Schleuse {
  let laufend = 0;
  /** `aufraeumen` löst Timer und Abbruch-Horcher — egal, wie der Eintrag die
   *  Schlange verlässt (Zuschlag, Geduldsende, Abbruch). */
  interface Wartend { weiter: () => void; aufraeumen: () => void }
  const warteschlange: Wartend[] = [];

  const ausSchlange = (eintrag: Wartend) => {
    const i = warteschlange.indexOf(eintrag);
    if (i >= 0) warteschlange.splice(i, 1);
  };

  const freigeben = () => {
    laufend--;
    const naechster = warteschlange.shift();
    if (!naechster) return;
    naechster.aufraeumen();
    laufend++;
    naechster.weiter();
  };

  return {
    async betrete(abbruch?: AbortSignal): Promise<() => void> {
      // Wer schon weg ist, belegt keinen Platz: er käme nie dazu, ihn freizugeben.
      if (abbruch?.aborted) throw new AbbruchError();
      if (laufend < o.maxParallel) {
        laufend++;
        return nurEinmal(freigeben);
      }
      if (warteschlange.length >= o.maxWartend) {
        throw new SchleuseVollError(
          `Es rendern bereits ${o.maxParallel} Exporte und ${warteschlange.length} weitere warten.`,
        );
      }
      await new Promise<void>((weiter, ablehnen) => {
        const timer = setTimeout(() => {
          ausSchlange(eintrag);
          eintrag.aufraeumen();
          ablehnen(new SchleuseVollError(
            `Der Export kam in ${Math.round(o.wartezeitMs / 1000)} s nicht an die Reihe.`,
          ));
        }, o.wartezeitMs);
        timer.unref?.();
        const beiAbbruch = () => {
          ausSchlange(eintrag);
          eintrag.aufraeumen();
          ablehnen(new AbbruchError());
        };
        const eintrag: Wartend = {
          weiter,
          aufraeumen: () => {
            clearTimeout(timer);
            abbruch?.removeEventListener('abort', beiAbbruch);
          },
        };
        abbruch?.addEventListener('abort', beiAbbruch, { once: true });
        warteschlange.push(eintrag);
      });
      return nurEinmal(freigeben);
    },
    laufend: () => laufend,
    wartend: () => warteschlange.length,
  };
}

/** Zwei parallele Browser, vier Wartende, 45 s Geduld. Die Zahlen kommen aus der
 *  Nutzung: ein Export dauert 5–15 s, und mehr als eine Handvoll Menschen
 *  arbeitet nie gleichzeitig damit. */
export const SCHLEUSE_STANDARD: SchleusenOptionen = { maxParallel: 2, maxWartend: 4, wartezeitMs: 45_000 };
