/**
 * HubSpot-Übernahme (Baustein C, 17.10.2026, Protokoll 32) — von Hand, kein Cron.
 *
 *   pnpm hubspot <datei.xlsx> --trocken              Probelauf: alles schreiben, zählen, zurückrollen; Bericht ansehen
 *   pnpm hubspot <datei.xlsx> --trocken --ohne-netz  Probelauf ohne Impressumsabruf (schnell, keine KI-Kosten)
 *   pnpm hubspot <datei.xlsx>                         schreiben (Ziel nicht lokal: nur mit UMZUG_ZIEL_FREIGABE=ja)
 *
 * DATABASE_URL        Ziel (Schema fach)
 * ANTHROPIC_API_KEY   für die Impressum-Deutung mit Haiku; fehlt er, gilt der in Einstellungen → Zugänge hinterlegte Schlüssel
 *                     (braucht GG_ENCRYPTION_KEY), sonst nur Regeln
 *
 * Bericht: berichte/hubspot-<zeit>.md und .json im Repo-Wurzelverzeichnis (nicht eingecheckt).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createDb, istLokaleDatenbank } from '@gg/db';
import { kiModellFuer } from '@gg/domain';
import { anthropicClient, istTabelle, type KiClient, kiMitModell, tabelleLesen } from '@gg/integrations';
import { kiModellwahlLesen } from '../services/einstellungen.ts';
import { hubspotBerichtText, hubspotUebernehmen } from '../services/hubspotUebernahme.ts';
import { zugangLesen } from '../services/zugaenge.ts';

const argumente = process.argv.slice(2);
const trocken = argumente.includes('--trocken');
const ohneNetz = argumente.includes('--ohne-netz');
const datei = argumente.find((a) => !a.startsWith('--'));
const zielUrl = process.env.DATABASE_URL;

if (!datei) throw new Error('Datei fehlt: pnpm hubspot <export.xlsx> [--trocken] [--ohne-netz]');
if (!zielUrl) throw new Error('DATABASE_URL (Ziel) fehlt');
if (!istLokaleDatenbank(zielUrl) && !trocken && process.env.UMZUG_ZIEL_FREIGABE !== 'ja') {
  throw new Error('Ziel ist nicht lokal. Schreiben nur mit UMZUG_ZIEL_FREIGABE=ja (oder zuerst --trocken).');
}

// pnpm startet das Skript in apps/api — relative Pfade gelten vom Aufrufort (INIT_CWD) aus
const dateiPfad = resolve(process.env.INIT_CWD ?? process.cwd(), datei);
const bytes = new Uint8Array(readFileSync(dateiPfad));
if (!istTabelle(bytes)) throw new Error('Keine Excel-Datei (.xlsx/.xls)');
const tabelle = tabelleLesen(bytes);

const { db, client } = createDb(zielUrl);
try {
  let ki: KiClient | null = null;
  if (!ohneNetz) {
    let key = process.env.ANTHROPIC_API_KEY ?? '';
    if (!key) { try { key = await zugangLesen(db, 'anthropic-api-key'); } catch { key = ''; } }
    if (key) ki = kiMitModell(anthropicClient(key), kiModellFuer(await kiModellwahlLesen(db), 'makler'));
    console.log(ki ? 'Impressum: Regeln + Haiku' : 'Impressum: nur Regeln (kein Anthropic-Schlüssel)');
  }
  console.log(`Ziel: ${new URL(zielUrl).host}${trocken ? ' · Probelauf' : ' · SCHREIBEN'}${ohneNetz ? ' · ohne Netz' : ''} · ${tabelle.zeilen.length} Zeilen aus ${basename(datei)}\n`);
  const bericht = await hubspotUebernehmen(db, ki, tabelle, basename(datei), {
    trocken, ohneNetz, fortschritt: (fertig, gesamt) => process.stdout.write(`\r  ${fertig}/${gesamt}`),
  });
  process.stdout.write('\n\n');
  const text = hubspotBerichtText(bericht);
  console.log(text);
  mkdirSync(resolve(import.meta.dirname, '../../../../berichte'), { recursive: true });
  const stamm = resolve(import.meta.dirname, `../../../../berichte/hubspot-${bericht.zeitpunkt.replace(/[:.]/g, '-')}`);
  writeFileSync(`${stamm}.json`, JSON.stringify(bericht, null, 2));
  writeFileSync(`${stamm}.md`, `${text}\n\n## Zeilen\n\n| HubSpot-ID | Name | E-Mail | Klasse | Ergebnis | über | ergänzt | Unternehmen |\n|---|---|---|---|---|---|---|---|\n${bericht.zeilen.map((z) => `| ${z.id} | ${z.name} | ${z.email ?? ''} | ${z.klassifizierung ?? ''} | ${z.ergebnis}${z.grund ? ` (${z.grund})` : ''} | ${z.ueber ?? ''} | ${(z.ergaenzt ?? []).join(', ')} | ${z.unternehmen ? `${z.unternehmen.name} (${z.unternehmen.weg})` : ''} |`).join('\n')}\n`);
  console.log(`\nBericht: berichte/${basename(stamm)}.md`);
} finally {
  await client.end();
}
