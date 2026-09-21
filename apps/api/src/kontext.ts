import { createDb } from '@gg/db';
import { rueckwegRegelnAusUmgebung } from '@gg/domain';
import { anthropicClient, kiAttrappe, supabaseSpeicher, graphAttrappe, propstackAttrappe } from '@gg/integrations';
import { createApp } from './app.ts';

/**
 * Baut die App aus der Umgebung — der eine Ort dafür. Der lokale Server (`server.ts`) und der Einstieg auf
 * Vercel (`vercel.ts`) rufen beide hier hinein; zwei Zusammenbauten liefen beim ersten neuen Schalter auseinander.
 */
export function appAusUmgebung(env: Record<string, string | undefined> = process.env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL fehlt (siehe .env.example)');

  const { db } = createDb(url);
  const produktion = env.NODE_ENV === 'production';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const speicher = env.SUPABASE_URL && serviceKey ? supabaseSpeicher(env.SUPABASE_URL, serviceKey) : null;
  /**
   * `KI_ATTRAPPE=1` entscheidet, nicht der Schlüssel: nur so lässt sich zwischen „echt prüfen" und
   * „Tests fahren" umschalten, ohne die .env zu bearbeiten — und die Klicktests erwarten die Attrappe.
   * Ohne den Schalter gilt der Schlüssel; in Produktion gibt es nie eine Attrappe.
   */
  const attrappe = env.KI_ATTRAPPE === '1' && !produktion;
  const ki = attrappe ? kiAttrappe() : env.ANTHROPIC_API_KEY ? anthropicClient(env.ANTHROPIC_API_KEY) : null;

  // Fremdsysteme lokal ohne Zugang: Attrappen nur ausdrücklich und nie in Produktion
  const graph = env.M365_ATTRAPPE === '1' && !produktion ? graphAttrappe() : null;
  const propstack = env.PROPSTACK_ATTRAPPE === '1' && !produktion ? propstackAttrappe() : null;

  const app = createApp({
    expose: speicher ? { speicher, ki, attrappe } : undefined,
    ki,
    graph,
    propstack,
    openaiKey: env.OPENAI_API_KEY,
    speicher: speicher ?? undefined,
    oauthRueckweg: rueckwegRegelnAusUmgebung(env),
    db,
    auth: {
      lokalOffen: env.AUTH_LOCAL_OPEN === '1',
      produktion,
      supabaseUrl: env.SUPABASE_URL,
      erlaubteEmails: (env.AUTH_ALLOWED_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    },
  });
  return { app, speicher };
}
