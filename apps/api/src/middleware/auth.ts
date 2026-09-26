import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

declare module 'hono' {
  interface ContextVariableMap {
    /** Wer angemeldet ist (E-Mail); lokal offen: „lokal“. Der AgentMode hängt Sitzungen und Gedächtnis daran. */
    nutzer: string;
  }
}

export interface AuthOptionen {
  /** Nur außerhalb von Produktion wirksam. */
  lokalOffen: boolean;
  produktion: boolean;
  supabaseUrl?: string;
  erlaubteEmails: string[];
}

/**
 * Supabase-Login wie in der alten App: JWT per JWKS prüfen, danach Allowlist.
 * Lokal (AUTH_LOCAL_OPEN=1, nicht Produktion) wird die Prüfung übersprungen.
 */
export function auth(opt: AuthOptionen): MiddlewareHandler {
  const jwks = opt.supabaseUrl
    ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', opt.supabaseUrl))
    : null;

  return async (c, next) => {
    if (opt.lokalOffen && !opt.produktion) {
      c.set('nutzer', 'lokal');
      return next();
    }

    // Header zuerst; Bilder und Download-Links tragen keinen — dort steht das Token im Cookie `gg-auth`
    const ausKopf = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const ausCookie = /(?:^|;\s*)gg-auth=([^;]+)/.exec(c.req.header('cookie') ?? '')?.[1];
    const token = ausKopf || (ausCookie ? decodeURIComponent(ausCookie) : '');
    if (!token || !jwks) return c.json({ fehler: 'Nicht angemeldet' }, 401);
    try {
      const { payload } = await jwtVerify(token, jwks);
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
      if (!opt.erlaubteEmails.includes(email)) return c.json({ fehler: 'Kein Zugriff' }, 403);
      c.set('nutzer', email);
    } catch {
      return c.json({ fehler: 'Anmeldung ungültig' }, 401);
    }
    return next();
  };
}
