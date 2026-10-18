/**
 * Übernahme `makler.firma` → `unternehmen` (18.10.2026), einmal je Umgebung nach der Migration `unternehmen`.
 *
 *   pnpm unternehmen:uebernahme                 Vorschau (liest nur) + Bericht in berichte/
 *   pnpm unternehmen:uebernahme --schreiben     schreibt in EINER Transaktion; erneut ausführbar
 *
 * Ziel ist `DATABASE_URL`. Außerhalb dieses Rechners schreibt das Werkzeug nur mit `UNTERNEHMEN_FREIGABE=<host>`
 * (genau der Host der Datenbank) — eine vertauschte Zeile in der `.env` reicht so nicht für einen Schreiblauf.
 */
import { createDb, istLokaleDatenbank } from '@gg/db';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unternehmenUebernahme } from '../services/unternehmen.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt (.env)');
const host = new URL(url).hostname;
const schreiben = process.argv.includes('--schreiben');
if (schreiben && !istLokaleDatenbank(url) && process.env.UNTERNEHMEN_FREIGABE !== host) {
  throw new Error(`Ziel „${host}“ ist nicht lokal. Schreiben nur mit UNTERNEHMEN_FREIGABE=${host} — zuerst die Vorschau ansehen.`);
}

const { db, client } = createDb(url);
try {
  const e = await unternehmenUebernahme(db, schreiben);
  const zeile = (...z: (string | number | null)[]) => `| ${z.map((x) => String(x ?? '–').replace(/\|/g, '\\|')).join(' | ')} |`;
  const bericht = [
    `# Unternehmen-Übernahme · ${host} · ${new Date().toISOString()}`,
    '',
    schreiben ? '**Geschrieben.**' : '**Vorschau** — nichts geschrieben. Schreiben mit `--schreiben`.',
    '',
    `- Makler ohne Unternehmen: ${e.makler}`,
    `- Unternehmen neu: ${e.neu} · vorhandene ergänzt: ${e.ergaenzt}`,
    `- Makler ohne Firma (bleiben ohne Unternehmen): ${e.ohneFirma}`,
    '',
    '## Bitte prüfen',
    '',
    '### Gleiche Domain, verschiedene Namen (gleiche Firma oder zwei Standorte?)',
    ...(e.pruefen.gleicheDomain.length ? e.pruefen.gleicheDomain.map((g) => `- **${g.domain}**: ${g.namen.join(' · ')}`) : ['- keine']),
    '',
    '### Mehrere Namen oder Zusätze in einem Feld',
    ...(e.pruefen.mehrteilig.length ? e.pruefen.mehrteilig.map((n) => `- ${n}`) : ['- keine']),
    '',
    '### Verschiedene Webseiten in einer Firma (übernommen: die häufigste)',
    ...(e.pruefen.webseitenKonflikt.length ? e.pruefen.webseitenKonflikt.map((w) => `- ${w.name}: ${w.webseiten.join(' · ')}`) : ['- keine']),
    '',
    '## Unternehmen',
    '',
    zeile('Name', 'Makler', 'Webseite', 'Domain', 'Anschrift', 'weitere Kontakte', 'vorhanden'),
    zeile('---', '---:', '---', '---', '---', '---:', '---'),
    ...e.unternehmen.sort((a, b) => b.makler - a.makler || a.name.localeCompare(b.name, 'de'))
      .map((x) => zeile(x.name, x.makler, x.webseite, x.domain, x.anschrift, x.weitereKontakte, x.vorhanden ? 'ja' : '')),
    '',
  ].join('\n');
  const ordner = fileURLToPath(new URL('../../../../berichte/', import.meta.url));
  mkdirSync(ordner, { recursive: true });
  const datei = `${ordner}unternehmen-uebernahme-${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  writeFileSync(datei, bericht);
  console.log(`${schreiben ? 'Geschrieben' : 'Vorschau'}: ${e.neu} neu, ${e.ergaenzt} ergänzt, ${e.makler} Makler, ${e.ohneFirma} ohne Firma`);
  console.log(`Prüfen: ${e.pruefen.gleicheDomain.length} gleiche Domain, ${e.pruefen.mehrteilig.length} mehrteilig, ${e.pruefen.webseitenKonflikt.length} Webseiten-Konflikte`);
  console.log(`Bericht: ${datei}`);
} finally {
  await client.end();
}
