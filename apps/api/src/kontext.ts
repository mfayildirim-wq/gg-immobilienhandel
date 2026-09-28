import { createDb, verlangeLokaleDatenbank } from '@gg/db';
import { rueckwegRegelnAusUmgebung } from '@gg/domain';
import { anthropicClient, kiAttrappe, supabaseSpeicher, graphAttrappe, propstackAttrappe } from '@gg/integrations';
import { ANBIETER, anthropicModell, attrappenModell, OLLAMA_URL, ollamaModell, openaiKompatibel, type ModellWahl } from '@cosai/kern';
import { createApp } from './app.ts';
import { sharepointAblageBauen } from './services/sharepoint.ts';
import { ZUGAENGE, zugangLesen, type ZugangSchluessel } from './services/zugaenge.ts';

/**
 * Der AgentMode schickt, was der Nutzer lesen darf, an den Modellanbieter — online deshalb erst nach ausdrücklicher
 * Freigabe (`AGENTMODE_AKTIV=ja`), nicht schon, weil ein ANTHROPIC_API_KEY für andere KI-Funktionen gesetzt ist.
 * Lokal an; `AGENTMODE_AKTIV=nein` schaltet ab. (Muster wie AUTO_IMPORT_AKTIV.)
 */
export function agentModusAn(env: Record<string, string | undefined>): boolean {
  if (env.AGENTMODE_AKTIV) return env.AGENTMODE_AKTIV === 'ja';
  return !env.VERCEL && env.NODE_ENV !== 'production';
}

/**
 * Baut die App aus der Umgebung — der eine Ort dafür. Der lokale Server (`server.ts`) und der Einstieg auf
 * Vercel (`vercel.ts`) rufen beide hier hinein; zwei Zusammenbauten liefen beim ersten neuen Schalter auseinander.
 */
export function appAusUmgebung(env: Record<string, string | undefined> = process.env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL fehlt (siehe .env.example)');

  const produktion = env.NODE_ENV === 'production';
  // Ein lokal gestarteter Server ist meist offen (AUTH_LOCAL_OPEN=1) und wird von Klicktests und Demo-Daten beschrieben.
  // Zeigt seine .env auf die Cloud, träfe das alles den echten Bestand — ohne dass irgendwo eine Anmeldung stünde.
  if (!produktion && !env.VERCEL && env.FREMDE_DB_FREIGABE !== 'ja') verlangeLokaleDatenbank(url, 'Lokaler API-Server');
  const { db } = createDb(url);
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

  // AgentMode: dasselbe Prinzip wie die KI — Attrappe nur ausdrücklich und nie in Produktion. Sonst das Modell des in
  // den AgentMode-Einstellungen gewählten Anbieters; Schlüssel aus Einstellungen → Zugänge, ersatzweise aus der Umgebung.
  // Ollama (lokale, offene Modelle): kein Schlüssel; nur außerhalb der Produktion oder mit ausdrücklicher OLLAMA_URL
  const ollamaUrl = env.OLLAMA_URL || (produktion ? '' : OLLAMA_URL);
  const ollamaErreichbar = async () => !!ollamaUrl && (await fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false));
  const agentSchluessel = async (a: (typeof ANBIETER)[number]) => {
    if (a.lokal) return (await ollamaErreichbar()) ? 'lokal' : '';
    const umgebung = ZUGAENGE.find((z) => z.schluessel === a.zugang)?.umgebung;
    return (await zugangLesen(db, a.zugang as ZugangSchluessel)) || (umgebung ? env[umgebung] : '') || '';
  };
  const agentWahl: ModellWahl = async ({ anbieter, modell }) => {
    const a = ANBIETER.find((x) => x.id === (anbieter || 'anthropic'));
    if (!a) return null;
    const name = modell || (a.id === 'anthropic' ? env.AGENT_MODELL || a.vorgabeModell : a.vorgabeModell);
    if (a.lokal) return ollamaUrl && name ? ollamaModell(name, ollamaUrl) : null;
    const schluessel = await agentSchluessel(a);
    if (!schluessel || !name) return null;
    return a.id === 'anthropic' ? anthropicModell(schluessel, name) : openaiKompatibel(schluessel, name, a.basisUrl);
  };
  const agentModell = !agentModusAn(env) ? null : attrappe ? attrappenModell() : agentWahl;
  const anbieterListe = async () => Promise.all(ANBIETER.map(async (a) => ({ id: a.id, label: a.label, vorgabeModell: a.vorgabeModell, verfuegbar: !!(await agentSchluessel(a)) })));

  const app = createApp({
    agent: { modell: agentModell, anbieterListe, ollamaUrl: ollamaUrl || undefined },
    expose: speicher ? { speicher, ki, attrappe } : undefined,
    ki,
    graph,
    propstack,
    openaiKey: env.OPENAI_API_KEY,
    speicher: speicher ?? undefined,
    oauthRueckweg: rueckwegRegelnAusUmgebung(env),
    cronGeheimnis: env.CRON_SECRET,
    // SharePoint als Dokumentablage, wenn unter Einstellungen → SharePoint aktiv (Protokoll 19)
    sharepoint: () => sharepointAblageBauen(db),
    // Der Bot ist online ausgeschaltet, bis AUTO_IMPORT_AKTIV=ja gesetzt ist (lokal an, AUTO_IMPORT_AKTIV=nein schaltet ab).
    // Online endet die Function nach 300 s — das Zeitlimit des Bots bleibt darunter, damit das Ergebnis noch geschrieben wird
    autoImport: {
      aktiv: env.AUTO_IMPORT_AKTIV ? env.AUTO_IMPORT_AKTIV === 'ja' : !env.VERCEL,
      maxZeitlimitSek: env.VERCEL ? 240 : undefined,
    },
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
