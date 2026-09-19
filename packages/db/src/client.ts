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
