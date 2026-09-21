import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

/** prepare:false wegen Supabase-Pooler (Transaction Mode); int8 als Number wie in der alten App. */
export function createDb(url: string) {
  const client = postgres(url, {
    prepare: false,
    max: 5,
    types: { bigint: postgres.BigInt },
  });
  return { db: drizzle(client, { schema }), client };
}

/** Zeigt die Adresse auf diesen Rechner? Geprüft wird der Host — nicht, ob irgendwo „local" im Text steht. */
export function istLokaleDatenbank(url: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Für alles, was Bestände verändert, ohne dass jemand angemeldet ist: Tests, Demo-Daten, ein lokal offener Server.
 * Seit es eine Cloud-Datenbank mit echtem Bestand gibt, reicht eine vertauschte Zeile in der `.env`, damit ein
 * Testlauf dort Zeilen löscht. Bewusst OHNE Freigabe-Schalter: wer wirklich gegen die Cloud arbeiten will, benutzt die
 * Werkzeuge, die dafür gebaut sind (`pnpm umzug` mit `UMZUG_ZIEL_FREIGABE`), nicht die Testläufe.
 */
export function verlangeLokaleDatenbank(url: string, zweck: string): string {
  if (!istLokaleDatenbank(url)) {
    let host = 'unlesbar';
    try { host = new URL(url).host; } catch { /* bleibt „unlesbar" */ }
    throw new Error(`${zweck}: die Datenbank „${host}" ist nicht lokal. Abgebrochen, bevor etwas verändert wird — DATABASE_URL in der .env prüfen.`);
  }
  return url;
}
