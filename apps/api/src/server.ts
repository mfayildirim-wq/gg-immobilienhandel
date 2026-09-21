import { serve } from '@hono/node-server';
import { createDb } from '@gg/db';
import { rueckwegRegelnAusUmgebung } from '@gg/domain';
import { anthropicClient, kiAttrappe, supabaseSpeicher, graphAttrappe, propstackAttrappe } from '@gg/integrations';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt (siehe .env.example)');

const { db } = createDb(url);
const produktion = process.env.NODE_ENV === 'production';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const speicher = process.env.SUPABASE_URL && serviceKey ? supabaseSpeicher(process.env.SUPABASE_URL, serviceKey) : null;
if (speicher) await speicher.bucketsSicherstellen().catch((e) => console.error('[speicher] Buckets:', e.message));
/**
 * `KI_ATTRAPPE=1` entscheidet, nicht der Schlüssel: nur so lässt sich zwischen „echt prüfen" und
 * „Tests fahren" umschalten, ohne die .env zu bearbeiten — und die Klicktests erwarten die Attrappe.
 * Ohne den Schalter gilt der Schlüssel; in Produktion gibt es nie eine Attrappe.
 */
const attrappe = process.env.KI_ATTRAPPE === '1' && !produktion;
const ki = attrappe ? kiAttrappe() : process.env.ANTHROPIC_API_KEY ? anthropicClient(process.env.ANTHROPIC_API_KEY) : null;

// Fremdsysteme lokal ohne Zugang: Attrappen nur ausdrücklich und nie in Produktion
const graph = process.env.M365_ATTRAPPE === '1' && !produktion ? graphAttrappe() : null;
const propstack = process.env.PROPSTACK_ATTRAPPE === '1' && !produktion ? propstackAttrappe() : null;

const app = createApp({
  expose: speicher ? { speicher, ki, attrappe } : undefined,
  ki,
  graph,
  propstack,
  openaiKey: process.env.OPENAI_API_KEY,
  speicher: speicher ?? undefined,
  oauthRueckweg: rueckwegRegelnAusUmgebung(process.env),
  db,
  auth: {
    lokalOffen: process.env.AUTH_LOCAL_OPEN === '1',
    produktion,
    supabaseUrl: process.env.SUPABASE_URL,
    erlaubteEmails: (process.env.AUTH_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
});

const port = Number(process.env.API_PORT ?? 3101);
serve({ fetch: app.fetch, port }, () => console.log(`API läuft auf http://localhost:${port}`));
