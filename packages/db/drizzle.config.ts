import { defineConfig } from 'drizzle-kit';

// Drizzle erzeugt nur die SQL-Dateien. Angewendet wird bewusst mit der Supabase-CLI
// (lokal `pnpm db:reset`, Produktion `supabase db push`), wie in Protokoll 08 festgelegt.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: '../../supabase/migrations',
  schemaFilter: ['fach'],
  migrations: { prefix: 'supabase' },
  casing: 'snake_case',
});
