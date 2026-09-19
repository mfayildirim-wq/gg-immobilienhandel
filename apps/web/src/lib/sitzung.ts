/**
 * Anmeldung: die Supabase-Sitzung im Browser. Übernommen aus gg-immohandel src/lib/session.ts
 * (Beschluss wayfinder/tickets/009-auth-konzept.md): E-Mail und Passwort, supabase-js hält die Sitzung
 * im localStorage und erneuert sie selbst.
 *
 * Der Cookie-Spiegel `gg-auth` ist nötig, weil `<img src>` und Download-Links keinen Header tragen;
 * die API akzeptiert das Token deshalb auch aus dem Cookie. Er wird bei JEDEM Sitzungswechsel neu
 * geschrieben — auch beim Erneuern, sonst sind Bilder und Downloads tot, während die App weiterläuft.
 *
 * Ohne `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` ist dieses Modul still: lokal wird ohne
 * Anmeldung gearbeitet (die API lässt das mit AUTH_LOCAL_OPEN=1 zu).
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const umgebung = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const SUPABASE_URL = (umgebung.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (umgebung.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** Muss zum Cookie-Namen in der API passen. */
export const AUTH_COOKIE = 'gg-auth';

/** Ist eine Anmeldung überhaupt eingerichtet? */
export const anmeldungEingerichtet = () => SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

let klient: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (!anmeldungEingerichtet()) return null;
  klient ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return klient;
}

/** Cookie-Spiegel: Lebensdauer = Restlaufzeit des Tokens. */
export function cookieSchreiben(sitzung: Session | null): void {
  if (typeof document === 'undefined') return;
  const sicher = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  const token = sitzung?.access_token ?? '';
  if (!token) {
    document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${sicher}`;
    return;
  }
  const rest = (sitzung?.expires_at ?? 0) - Math.floor(Date.now() / 1000);
  document.cookie = `${AUTH_COOKIE}=${token}; Path=/; SameSite=Lax${rest > 0 ? `; Max-Age=${rest}` : ''}${sicher}`;
}

export type SitzungsHorcher = (sitzung: Session | null) => void;

/** Startet die Sitzungsverwaltung; ohne Einrichtung ein No-op, das `null` liefert. */
export async function sitzungStarten(beiWechsel?: SitzungsHorcher): Promise<Session | null> {
  const c = client();
  if (!c) return null;
  c.auth.onAuthStateChange((_ereignis, sitzung) => { cookieSchreiben(sitzung); beiWechsel?.(sitzung); });
  const { data } = await c.auth.getSession();
  cookieSchreiben(data.session ?? null);
  return data.session ?? null;
}

export async function aktuelleSitzung(): Promise<Session | null> {
  const c = client();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session ?? null;
}

/** Token für den Authorization-Header; getSession erneuert bei Bedarf selbst. */
export const zugriffsToken = async () => (await aktuelleSitzung())?.access_token ?? null;

export async function anmelden(email: string, passwort: string): Promise<{ ok: boolean; fehler?: string }> {
  const c = client();
  if (!c) return { ok: false, fehler: 'Für diese Umgebung ist keine Anmeldung eingerichtet.' };
  const { data, error } = await c.auth.signInWithPassword({ email, password: passwort });
  if (error) return { ok: false, fehler: error.message };
  cookieSchreiben(data.session ?? null);
  return { ok: true };
}

export async function abmelden(): Promise<void> {
  const c = client();
  // Cookie in jedem Fall löschen: ein zurückgelassener Spiegel wäre ein gültiger Schlüssel zur App.
  cookieSchreiben(null);
  if (!c) return;
  try { await c.auth.signOut(); } catch { /* offline abgemeldet ist auch abgemeldet */ }
}

/** Sitzung erneuern; `true`, wenn danach ein Token vorliegt (apiFetch nach einer 401 — genau einmal). */
export async function sitzungErneuern(): Promise<boolean> {
  const c = client();
  if (!c) return false;
  try {
    const { data, error } = await c.auth.refreshSession();
    if (error || !data.session) return false;
    cookieSchreiben(data.session);
    return true;
  } catch {
    return false;
  }
}
