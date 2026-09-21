import type { MiddlewareHandler } from 'hono';

/**
 * Begrenzung der teuren und der zugangsnahen Wege (alt: server/rate-limits.ts, express-rate-limit).
 *
 * Das Limit trifft eine Schleife, nicht den Alltag: ein Fehler in der Oberfläche oder ein gekapertes Konto soll nicht
 * in Minuten KI-Guthaben verbrennen oder Zugangsdaten durchprobieren können. Gezählt wird je Anmeldung (Token) bzw.
 * je Adresse, im Arbeitsspeicher der Instanz — wie in der alten App. Auf Vercel gibt es mehrere Instanzen; die Grenze
 * gilt also je Instanz und ist eine Bremse, keine Abrechnung.
 */
export interface Grenze { fensterMs: number; max: number; meldung: string }

export const GRENZEN = {
  /** Zugangsdaten (M365, Propstack): absichtlich eng. */
  zugang: { fensterMs: 60_000, max: 5, meldung: 'Zu viele Anfragen – bitte warte eine Minute' },
  /** Posteingang und öffentliche Suche. */
  abruf: { fensterMs: 60_000, max: 20, meldung: 'Zu viele Anfragen – bitte warte eine Minute' },
  /** Transkription: jeder Aufruf kostet Geld und lädt bis zu 25 MB hoch. */
  diktat: { fensterMs: 60_000, max: 12, meldung: 'Zu viele Transkriptionen – bitte warte eine Minute' },
  /** KI-Aufrufe: ein Mensch schafft keine 60 Auswertungen in der Minute. */
  ki: { fensterMs: 60_000, max: 60, meldung: 'Zu viele KI-Anfragen – bitte warte eine Minute' },
} as const satisfies Record<string, Grenze>;

export function begrenzung(grenze: Grenze, jetzt: () => number = Date.now): MiddlewareHandler {
  const treffer = new Map<string, number[]>();
  return async (c, next) => {
    const t = jetzt();
    // Das Token ist die Anmeldung; ohne Token (lokal offen) zählt die Adresse
    const wer = c.req.header('authorization')?.slice(-24) ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'lokal';
    const frisch = (treffer.get(wer) ?? []).filter((z) => t - z < grenze.fensterMs);
    if (frisch.length >= grenze.max) {
      treffer.set(wer, frisch);
      c.header('Retry-After', String(Math.ceil((grenze.fensterMs - (t - frisch[0]!)) / 1000)));
      return c.json({ fehler: grenze.meldung }, 429);
    }
    frisch.push(t);
    treffer.set(wer, frisch);
    // Nicht unbegrenzt wachsen: abgelaufene Einträge anderer Anmeldungen gelegentlich wegräumen
    if (treffer.size > 500) for (const [k, z] of treffer) if (z.every((x) => t - x >= grenze.fensterMs)) treffer.delete(k);
    return next();
  };
}
