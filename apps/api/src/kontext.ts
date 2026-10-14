import { createDb, verlangeLokaleDatenbank } from '@gg/db';
import { rueckwegRegelnAusUmgebung } from '@gg/domain';
import { anthropicClient, kiAttrappe, nominatimGeocoder, supabaseSpeicher, graphAttrappe, propstackAttrappe, tesseractOcr } from '@gg/integrations';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

/**
 * Texterkennung (OCR) für Bild-Seiten im Exposé-Import. `OCR=aus` schaltet sie ab; dann bleiben Bild-Seiten ohne Text
 * und Scans gehen wie vor Protokoll 30 komplett an das gründliche Modell.
 * Pfade: Im Vercel-Bündel liegt der Worker als `dist/ocr-worker.cjs` neben dieser Datei (bau-vercel.mjs); lokal (tsx) gibt
 * es ihn nicht, dann nimmt tesseract.js sein Skript aus node_modules. Die Sprachdaten liegen in `apps/api/assets`
 * (von `src/` wie von `dist/` aus `../assets`), damit online nichts vom CDN geladen und nichts geschrieben werden muss.
 */
export function texterkennungAusUmgebung(env: Record<string, string | undefined> = process.env): (() => ReturnType<typeof tesseractOcr>) | null {
  if (env.OCR === 'aus') return null;
  const worker = fileURLToPath(new URL('./ocr-worker.cjs', import.meta.url));
  const sprachdaten = fileURLToPath(new URL('../assets/', import.meta.url));
  return () => tesseractOcr({ ...(existsSync(worker) ? { workerPath: worker } : {}), langPath: sprachdaten });
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

  /**
   * Kartendienst für den Stadtteil in der KI-Lagebeschreibung (OpenStreetMap/Nominatim, frei, ohne Schlüssel).
   * Mit KI-Attrappe aus: Tests fragen keinen Fremddienst. `GEOCODING=aus` schaltet ihn ab; die Kennung im
   * User-Agent verlangen die Nutzungsregeln (`NOMINATIM_KENNUNG`, sonst der Projektname).
   */
  const geocoder = attrappe || env.GEOCODING === 'aus' ? null : nominatimGeocoder({ kennung: env.NOMINATIM_KENNUNG || 'gg-immobilienhandel/1.0 (Lagebeschreibung)' });

  // Fremdsysteme lokal ohne Zugang: Attrappen nur ausdrücklich und nie in Produktion
  const graph = env.M365_ATTRAPPE === '1' && !produktion ? graphAttrappe() : null;
  const propstack = env.PROPSTACK_ATTRAPPE === '1' && !produktion ? propstackAttrappe() : null;

  const app = createApp({
    expose: speicher ? { speicher, ki, attrappe, texterkennung: texterkennungAusUmgebung(env) } : undefined,
    ki,
    geocoder,
    graph,
    propstack,
    openaiKey: env.OPENAI_API_KEY,
    speicher: speicher ?? undefined,
    oauthRueckweg: rueckwegRegelnAusUmgebung(env),
    cronGeheimnis: env.CRON_SECRET,
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
