/**
 * Türsteher vor Render-Routen (Port von gg-immohandel server/render-schleuse.ts: renderTor, für Hono).
 *
 * Der Platz wird immer freigegeben, sobald der Handler fertig ist. Der Abbruch-Melder ist das Signal der
 * Anfrage: schließt der Nutzer den Tab, während sein Export noch wartet, verlässt er die Schlange, statt später
 * einen Platz zu belegen, den niemand zurückgibt. Ein Abgebrochener bekommt keine 503 (liest niemand mehr).
 */
import { AbbruchError, type Schleuse, SchleuseVollError } from '@gg/documents/pdf';
import type { MiddlewareHandler } from 'hono';

export function renderTor(schleuse: Schleuse): MiddlewareHandler {
  return async (c, next) => {
    const signal = c.req.raw.signal;
    let freigeben: () => void;
    try {
      freigeben = await schleuse.betrete(signal);
    } catch (e) {
      if (e instanceof AbbruchError) return new Response(null, { status: 499 });
      if (e instanceof SchleuseVollError) {
        console.error(`[render-schleuse] ${c.req.method} ${c.req.path} abgewiesen: ${e.message}`);
        c.header('Retry-After', '30');
        return c.json({ fehler: `Es laufen gerade zu viele Exporte. ${e.message}`, details: { hinweis: 'In einer halben Minute erneut versuchen — der Export ist danach unverändert möglich.', quelle: 'render-schleuse' } }, 503);
      }
      throw e;
    }
    try {
      // Kam der Zuschlag, als der Aufrufer schon weg war, startet kein Browser.
      if (signal.aborted) return new Response(null, { status: 499 });
      await next();
    } finally {
      freigeben();
    }
  };
}
