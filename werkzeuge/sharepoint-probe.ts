/**
 * Verbindungstest gegen eine echte SharePoint-Site über den Dateispeicher-Adapter (Protokoll 19, Phase 1):
 * App-Token, Ordner, Datei ablegen, Anfang lesen, Upload-Session mit 5 MB, verschieben, auflisten, löschen.
 * Schreibt nur unter `<wurzel>/_probe/` und räumt danach auf.
 *
 *   pnpm sharepoint:probe
 *
 * Braucht in der Umgebung: M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, SHAREPOINT_SITE_ID,
 * optional SHAREPOINT_WURZEL (Standard „GG Immohandel“). Keine Werte in dieser Datei.
 */
import { appToken, BUCKETS, graphDrive, sharepointSpeicher } from '@gg/integrations';

const env = (name: string) => {
  const v = process.env[name];
  if (!v) { console.error(`${name} fehlt in der Umgebung.`); process.exit(2); }
  return v;
};
const cfg = { tenantId: env('M365_TENANT_ID'), clientId: env('M365_CLIENT_ID'), clientSecret: env('M365_CLIENT_SECRET') };
const siteId = env('SHAREPOINT_SITE_ID');
const wurzel = process.env.SHAREPOINT_WURZEL ?? 'GG Immohandel';

const drive = graphDrive(appToken(cfg), siteId);
const speicher = sharepointSpeicher(drive, { wurzel });
const kennung = `_probe/${new Date().toISOString().replace(/[:.]/g, '-')}`;
let schritt = 0;
const ok = (was: string, detail = '') => console.log(`  ${++schritt}. ${was}${detail ? ` — ${detail}` : ''} ✓`);
const start = Date.now();

try {
  console.log(`SharePoint-Probe · Site ${siteId.split(',')[0]} · Wurzel „${wurzel}“`);
  ok('App-Token und Bibliothek', await drive.driveId());
  await speicher.ablegen(BUCKETS.pdfs, `${kennung}/klein.txt`, new TextEncoder().encode('GG Immohandel Probe'), 'text/plain');
  ok('kleine Datei abgelegt', `pdfs/${kennung}/klein.txt`);
  const a = await speicher.anfang(BUCKETS.pdfs, `${kennung}/klein.txt`, 5);
  if (new TextDecoder().decode(a.bytes) !== 'GG Im' || a.groesse !== 19) throw new Error('Anfang stimmt nicht');
  ok('Anfang gelesen (Range)', `${a.groesse} Bytes gesamt`);

  const ticket = await speicher.uploadTicket(BUCKETS.pdfs, `${kennung}/gross.bin`);
  const gross = new Uint8Array(5 * 1024 * 1024).fill(42);
  const stueck = 320 * 1024 * 4;
  for (let von = 0; von < gross.byteLength; von += stueck) {
    const bis = Math.min(von + stueck, gross.byteLength);
    const r = await fetch(ticket.url, { method: 'PUT', body: gross.subarray(von, bis), headers: { 'content-range': `bytes ${von}-${bis - 1}/${gross.byteLength}` } });
    if (!r.ok) throw new Error(`Upload-Stück ${von}: ${r.status}`);
  }
  ok('5 MB über die Upload-Session (ohne Token, in Stücken)', ticket.art);
  const g = await speicher.anfang(BUCKETS.pdfs, `${kennung}/gross.bin`, 1);
  if (g.groesse !== gross.byteLength || g.bytes[0] !== 42) throw new Error('große Datei unvollständig');
  ok('große Datei vollständig', `${g.groesse} Bytes`);

  await speicher.verschieben(BUCKETS.pdfs, `${kennung}/klein.txt`, `${kennung}/verschoben/klein.txt`);
  ok('verschoben in Unterordner');
  const liste = await speicher.auflisten(BUCKETS.pdfs, kennung);
  if (liste.length !== 2) throw new Error(`auflisten: ${liste.length} statt 2`);
  ok('aufgelistet', liste.map((e) => `${e.key} (${e.groesse} B)`).join(', '));
  const inhalt = await speicher.holen(BUCKETS.pdfs, `${kennung}/verschoben/klein.txt`);
  if (new TextDecoder().decode(inhalt) !== 'GG Immohandel Probe') throw new Error('Inhalt stimmt nicht');
  ok('gelesen über Download-Adresse');
} finally {
  await drive.loeschen(`${wurzel}/${BUCKETS.pdfs}/${kennung.split('/')[0]}`);
  console.log(`  aufgeräumt · ${((Date.now() - start) / 1000).toFixed(1)} s`);
}
