import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARITAET_BESTAND } from './datenbestand.ts';

export const ALT_API = process.env.ALT_API ?? 'http://localhost:3001';
export const ALT_WEB = process.env.ALT_WEB ?? 'http://localhost:5173';
export const NEU_WEB = process.env.NEU_WEB ?? 'http://localhost:5273';
export const BERICHTE = join(import.meta.dirname, '../../berichte/paritaet');
const SICHERUNG = join(BERICHTE, 'alt-sicherung.json');
const WURZEL = join(import.meta.dirname, '../..');

async function kv(schluessel: string, wert: unknown | undefined) {
  const r = wert === undefined
    ? await fetch(`${ALT_API}/api/kv/${schluessel}`, { method: 'DELETE' })
    : await fetch(`${ALT_API}/api/kv/${schluessel}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: wert }) });
  if (!r.ok) throw new Error(`Alte App: ${schluessel} schreiben fehlgeschlagen (${r.status}) ${await r.text()}`);
}

/** Alten Stand sichern, Prüfbestand in die alte App schreiben, echten Umzug in den Neubau laufen lassen. */
export default async function vorbereiten() {
  mkdirSync(BERICHTE, { recursive: true });
  const gesund = await fetch(`${ALT_API}/api/health`).catch(() => null);
  if (!gesund?.ok) throw new Error(`Alte App nicht erreichbar unter ${ALT_API} — in ../gg-immohandel „npm run dev“ starten`);
  if (existsSync(SICHERUNG)) throw new Error(`Sicherung aus einem abgebrochenen Lauf liegt noch da: ${SICHERUNG}. Erst „pnpm paritaet:wiederherstellen“.`);
  const alles = (await (await fetch(`${ALT_API}/api/kv`)).json()) as Record<string, unknown>;
  const sicherung = Object.fromEntries(Object.keys(PARITAET_BESTAND).map((k) => [k, k in alles ? alles[k] : null]));
  writeFileSync(SICHERUNG, JSON.stringify(sicherung));
  for (const [k, v] of Object.entries(PARITAET_BESTAND)) await kv(k, v);
  const ausgabe = execSync('pnpm --silent umzug', { cwd: WURZEL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(BERICHTE, 'umzug.txt'), ausgabe);
  if (!ausgabe.includes('alle Prüfungen bestanden')) throw new Error(`Umzug nicht bestanden:\n${ausgabe}`);
  return wiederherstellen;
}

/** Alten Stand der alten App zurückschreiben; der Neubau bekommt seine Demodaten zurück. */
export async function wiederherstellen() {
  if (existsSync(SICHERUNG)) {
    const sicherung = JSON.parse(readFileSync(SICHERUNG, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(sicherung)) await kv(k, v === null ? undefined : v);
    execSync(`rm ${JSON.stringify(SICHERUNG)}`);
  }
  if (process.env.PARITAET_NEU_BEHALTEN !== '1') execSync('pnpm --silent db:reset', { cwd: WURZEL, stdio: 'ignore' });
}
