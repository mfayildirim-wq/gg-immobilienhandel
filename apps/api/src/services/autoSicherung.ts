/**
 * Automatische Sicherungen im Bucket `backups` (alt: server/backup.ts, „📦 Auto-Backups verwalten").
 *
 * Der Inhalt ist dieselbe Datei wie der Export von Hand (`sicherungErstellen`) — eine zweite Form wäre eine zweite
 * Wahrheit. Neu sind nur Ablage, Stufe und Aufbewahrung; die Regeln dazu stehen geprüft in `@gg/domain`.
 *
 *  • Der Dateiname trägt die Kopfdaten: die Liste kommt allein aus dem Auflisten des Buckets, ohne einen Download.
 *  • Aufgeräumt wird nach einer geglückten Sicherung, nie davor — und eine unlesbare Liste lässt den Schritt ausfallen,
 *    statt alles für überzählig zu halten. Objekte, deren Name nicht dem Muster entspricht, fasst niemand an.
 *  • Wiederherstellen legt vorher eine Sicherheitskopie (`safety`) an: erst der Rückweg, dann das Überschreiben.
 *    Scheitert die Kopie, passiert nichts.
 */
import type { Db } from '@gg/db';
import { aufbewahrungPlanen, geplanteStufe, sicherungSchluessel, sicherungSchluesselLesen, type SicherungsEintrag, type SicherungsStufe } from '@gg/domain';
import { BUCKETS, type Dateispeicher } from '@gg/integrations';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { sicherungEinspielen, sicherungErstellen, sicherungPlan } from './sicherung.ts';

export async function autoSicherungListe(speicher: Dateispeicher): Promise<SicherungsEintrag[]> {
  const objekte = await speicher.auflisten(BUCKETS.backups);
  return objekte
    .map((o) => { const kopf = sicherungSchluesselLesen(o.key); return kopf ? { ...kopf, groesseBytes: o.groesse } : null; })
    .filter((e): e is SicherungsEintrag => e !== null)
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

async function aufbewahrungAnwenden(speicher: Dateispeicher) {
  let eintraege: SicherungsEintrag[];
  try {
    eintraege = await autoSicherungListe(speicher);
  } catch (e) {
    return { entfernt: [] as string[], behalten: 0, hinweis: `Aufbewahrung übersprungen — die Liste war nicht lesbar (${e instanceof Error ? e.message : String(e)}). Es wurde nichts gelöscht.` };
  }
  const plan = aufbewahrungPlanen(eintraege);
  if (plan.entfernen.length) await speicher.loeschen(BUCKETS.backups, plan.entfernen.map((e) => e.key));
  return { entfernt: plan.entfernen.map((e) => e.key), behalten: plan.behalten.length, hinweis: plan.hinweise[0] ?? null };
}

export async function autoSicherungErstellen(db: Db, speicher: Dateispeicher, stufe: SicherungsStufe, quelle: string, jetzt = new Date()) {
  const datei = await sicherungErstellen(db);
  const anzahl = (t: string) => datei.tabellen[t]?.length ?? 0;
  const zahlen = { deals: anzahl('deals'), objekte: anzahl('objekte'), makler: anzahl('makler'), zeilen: Object.values(datei.tabellen).reduce((s, z) => s + z.length, 0) };
  const key = sicherungSchluessel(jetzt, stufe, zahlen);
  const bytes = new TextEncoder().encode(JSON.stringify(datei));
  await speicher.ablegen(BUCKETS.backups, key, bytes, 'application/json');
  const aufbewahrung = await aufbewahrungAnwenden(speicher);
  await auditSchreiben(db, { type: 'backup', action: 'create', source: quelle, metadata: { key, stufe, ...zahlen, groesseBytes: bytes.byteLength, entfernt: aufbewahrung.entfernt.length } });
  const eintrag: SicherungsEintrag = { ...sicherungSchluesselLesen(key)!, groesseBytes: bytes.byteLength };
  return { eintrag, aufbewahrung };
}

/** Der tägliche Lauf: die Stufe ergibt sich aus dem Datum. */
export const geplanteSicherung = (db: Db, speicher: Dateispeicher, jetzt = new Date()) => autoSicherungErstellen(db, speicher, geplanteStufe(jetzt), '/api/cron/sicherung', jetzt);

/** Nur Schlüssel im Muster — so lässt sich über diese Routen nichts anderes aus dem Bucket lesen. */
async function datei(speicher: Dateispeicher, key: string) {
  if (!sicherungSchluesselLesen(key)) throw new FachFehler(400, 'Ungültiger Sicherungsname.');
  const bytes = await speicher.holen(BUCKETS.backups, key).catch(() => { throw new FachFehler(404, 'Sicherung nicht gefunden.'); });
  return bytes;
}

export const autoSicherungDatei = datei;

const alsJson = (bytes: Uint8Array): unknown => {
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new FachFehler(422, 'Die Sicherung ist nicht lesbar (kein gültiges JSON).'); }
};

export async function autoSicherungPlan(db: Db, speicher: Dateispeicher, key: string) {
  return { kopf: sicherungSchluesselLesen(key)!, ...(await sicherungPlan(db, alsJson(await datei(speicher, key)))) };
}

export async function autoSicherungEinspielen(db: Db, speicher: Dateispeicher, key: string) {
  const inhalt = alsJson(await datei(speicher, key));
  const sicherheitskopie = await autoSicherungErstellen(db, speicher, 'safety', '/api/sicherung/auto/einspielen');
  const ergebnis = await sicherungEinspielen(db, inhalt);
  return { ...ergebnis, sicherheitskopie: sicherheitskopie.eintrag.key };
}
