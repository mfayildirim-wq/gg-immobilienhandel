/** Testdatenbank: die lokale Supabase (DATABASE_URL). Nie gegen die Cloud — Tests löschen und schreiben Zeilen. */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/schema.ts';

const LOKAL = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const url = process.env.DATABASE_URL && LOKAL.includes(new URL(process.env.DATABASE_URL).hostname) ? process.env.DATABASE_URL : undefined;
if (process.env.DATABASE_URL && !url) throw new Error('cosai-kern-Tests laufen nur gegen eine lokale Datenbank');

export function testDb() {
  const client = postgres(url!, { prepare: false, max: 3 });
  return { db: drizzle(client, { schema }), client };
}
