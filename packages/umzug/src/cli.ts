import { mkdirSync, writeFileSync } from 'node:fs';
import { createDb } from '@gg/db';
import { altimporteUeberfuehren } from './altimporte.ts';
import { berichtText } from './bericht.ts';
import { quelleLaden } from './quelle.ts';
import { umzugAusfuehren } from './umzug.ts';

/**
 * pnpm umzug            → schreibt in die Zieldatenbank (nur wenn alle Prüfungen bestehen)
 * pnpm umzug --trocken  → Probelauf: alles wird geschrieben, geprüft und zurückgerollt
 * … --nachsichtig      → unbekannte Felder nur berichten statt abbrechen (Standard ist scharf)
 * pnpm umzug --altimporte [--trocken] → nur Ziel: expose_rohdaten bestehender Deals als expose_importe (v0) anlegen
 *
 * QUELLE_DATABASE_URL  alte App (Standard: lokale gg-immohandel-Supabase, Port 54322)
 * DATABASE_URL         Neubau (Schema fach)
 */
const trocken = process.argv.includes('--trocken');
const nurAltimporte = process.argv.includes('--altimporte');
const quelleUrl = process.env.QUELLE_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const zielUrl = process.env.DATABASE_URL;

const host = (url: string) => new URL(url).host;
const lokal = (url: string) => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);

if (!zielUrl) throw new Error('DATABASE_URL (Ziel) fehlt');
if (!nurAltimporte && host(quelleUrl) === host(zielUrl)) throw new Error('Quelle und Ziel sind dieselbe Datenbank');
if (!lokal(zielUrl) && !trocken && process.env.UMZUG_ZIEL_FREIGABE !== 'ja') {
  throw new Error('Ziel ist nicht lokal. Schreiben nur mit UMZUG_ZIEL_FREIGABE=ja (oder zuerst --trocken).');
}

if (nurAltimporte) {
  const { db, client } = createDb(zielUrl);
  try {
    const e = await altimporteUeberfuehren(db, { trocken });
    console.log(`Altimporte in ${host(zielUrl)}${trocken ? ' · Probelauf' : ''}: ${e.geprueft} Deals mit Exposé-Rohdaten, ${e.angelegt} als expose_importe (v0) angelegt, ${e.vorhanden} schon vorhanden`);
  } finally {
    await client.end();
  }
  process.exit(0);
}

console.log(`Quelle: ${host(quelleUrl)} (nur lesend) → Ziel: ${host(zielUrl)}${trocken ? ' · Probelauf' : ''}\n`);
const kv = await quelleLaden(quelleUrl);
const { db, client } = createDb(zielUrl);
try {
  const bericht = await umzugAusfuehren(db, kv, { trocken, streng: !process.argv.includes('--nachsichtig') });
  console.log(berichtText(bericht));
  mkdirSync('berichte', { recursive: true });
  const datei = `berichte/umzug-${bericht.zeitpunkt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(datei, JSON.stringify(bericht, null, 2));
  console.log(`\nBericht: packages/umzug/${datei}`);
  process.exitCode = bericht.ok ? 0 : 1;
} finally {
  await client.end();
}
