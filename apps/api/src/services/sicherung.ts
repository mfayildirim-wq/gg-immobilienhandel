/* eslint-disable @typescript-eslint/no-explicit-any -- je Tabelle andere Spalten */
/**
 * Sicherung und Wiederherstellung (alt: server/backup.ts, Einstellungen → 💾 Sicherung & Datenimport).
 * Gesichert wird der Datenbestand, nicht die Dateien im Bucket: Fotos und Dokumente liegen dort und
 * werden vom Speicher selbst gesichert — die Zeilen dazu (mit Schlüssel) sind Teil der Sicherung.
 *
 * Grundsätze aus der alten App:
 *  • Jede Tabelle ist entweder gesichert oder ausdrücklich ausgenommen (mit Begründung) — nichts fällt still heraus.
 *  • Wiederherstellen ist zweistufig: erst der Plan, dann das Einspielen in EINER Transaktion.
 *  • Eingespielt wird ergänzend: vorhandene Zeilen werden aktualisiert, fehlende angelegt, nichts gelöscht.
 */
import { type Db, schema } from '@gg/db';
import { sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';

/** Reihenfolge ist die Einspielreihenfolge: erst die Eltern, dann die Kinder. */
export const SICHERUNG_TABELLEN = [
  'makler', 'objekte', 'objektEinheiten', 'objektFotos', 'deals', 'dealEinheiten', 'dealSanierungen', 'dealKommentare',
  'dealKalkVarianten', 'dealDokumente', 'dealStatusHistorie', 'maklerKommunikation',
  'kundenkalkulationen', 'finanzpraesentationen', 'praesentationFolien', 'vertriebslisten', 'vertriebslisteZeilen',
  'projekte', 'projektEinheiten', 'projektMieterhistorie', 'projektAufgaben', 'projektGebaeudeMassnahmen',
  'begleitscheinVorlagen', 'begleitscheine', 'begleitscheinAktionen', 'vordrucke',
  'textvorlagen', 'ddChecklisteVorlage', 'einstellungen', 'gespeicherteFilter',
] as const;

/** Bewusst nicht in der Sicherung — mit Begründung, damit nichts unbemerkt fehlt. */
export const SICHERUNG_AUSGENOMMEN: Record<string, string> = {
  geheimnisse: 'Verschlüsselte Zugangsdaten — gehören nicht in eine Datei, die weitergereicht wird.',
  auditLog: 'Hash-Kette: ein Einspielen würde die Kette brechen. Der Verlauf wird getrennt exportiert.',
  mergeProtokoll: 'Nur 24 Stunden für Rückgängig gültig; danach ohne Wert.',
  oauthTokens: 'Zugangstoken sind gerätegebunden und laufen ab.',
  mailImportGesehen: 'Merkliste gesehener Mails; entsteht beim nächsten Lauf neu.',
  autoImportRuns: 'Protokoll der Importläufe; keine Geschäftsdaten.',
  archiveLedger: 'Ablage-Journal; wird aus den Dateien wieder aufgebaut.',
};

type Tabellenname = (typeof SICHERUNG_TABELLEN)[number];
const tabelle = (name: Tabellenname) => (schema as unknown as Record<string, any>)[name];

export interface Sicherungsdatei {
  version: 1;
  erzeugtAm: string;
  tabellen: Record<string, unknown[]>;
}

/** createBackup: alle gesicherten Tabellen in einer Datei. */
export async function sicherungErstellen(db: Db): Promise<Sicherungsdatei> {
  const tabellen: Record<string, unknown[]> = {};
  for (const name of SICHERUNG_TABELLEN) tabellen[name] = await db.select().from(tabelle(name));
  return { version: 1, erzeugtAm: new Date().toISOString(), tabellen };
}

export const sicherungZaehler = (datei: Sicherungsdatei) =>
  Object.fromEntries(Object.entries(datei.tabellen).map(([name, zeilen]) => [name, zeilen.length]));

/** parseBackupFile: nur Dateien im erwarteten Format, unbekannte Tabellen werden gemeldet. */
export function sicherungLesen(roh: unknown): { datei: Sicherungsdatei; unbekannt: string[] } {
  const d = roh as Sicherungsdatei | null;
  if (!d || typeof d !== 'object' || d.version !== 1 || !d.tabellen || typeof d.tabellen !== 'object') {
    throw new FachFehler(400, 'Keine Sicherungsdatei dieser App (erwartet wird „version: 1“ mit „tabellen“).');
  }
  const unbekannt = Object.keys(d.tabellen).filter((t) => !SICHERUNG_TABELLEN.includes(t as Tabellenname));
  for (const [name, zeilen] of Object.entries(d.tabellen)) {
    if (!Array.isArray(zeilen)) throw new FachFehler(400, `Tabelle „${name}“ enthält keine Zeilenliste.`);
  }
  return { datei: d, unbekannt };
}

/** planRestore: was das Einspielen ändern würde — je Tabelle neu und aktualisiert. */
export async function sicherungPlan(db: Db, roh: unknown) {
  const { datei, unbekannt } = sicherungLesen(roh);
  const zeilen: { tabelle: string; neu: number; aktualisiert: number; inDatei: number; imBestand: number }[] = [];
  for (const name of SICHERUNG_TABELLEN) {
    const ausDatei = (datei.tabellen[name] ?? []) as any[];
    const bestand = await db.select().from(tabelle(name));
    const schluessel = name === 'einstellungen' ? 'schluessel' : name === 'begleitscheinVorlagen' ? 'typ' : 'id';
    const vorhanden = new Set(bestand.map((z: any) => z[schluessel]));
    const neu = ausDatei.filter((z) => !vorhanden.has(z[schluessel])).length;
    zeilen.push({ tabelle: name, neu, aktualisiert: ausDatei.length - neu, inDatei: ausDatei.length, imBestand: bestand.length });
  }
  return { erzeugtAm: datei.erzeugtAm, unbekannt, zeilen, gesamtNeu: zeilen.reduce((s, z) => s + z.neu, 0), gesamtAktualisiert: zeilen.reduce((s, z) => s + z.aktualisiert, 0) };
}

/** restoreBackup: alles in einer Transaktion, ergänzend — es wird nichts gelöscht. */
export async function sicherungEinspielen(db: Db, roh: unknown) {
  const { datei } = sicherungLesen(roh);
  let geschrieben = 0;
  await db.transaction(async (tx) => {
    for (const name of SICHERUNG_TABELLEN) {
      const ausDatei = (datei.tabellen[name] ?? []) as any[];
      if (!ausDatei.length) continue;
      const t = tabelle(name);
      const schluessel = name === 'einstellungen' ? 'schluessel' : name === 'begleitscheinVorlagen' ? 'typ' : 'id';
      for (const zeile of ausDatei) {
        await tx.insert(t).values(zeile).onConflictDoUpdate({ target: t[schluessel], set: zeile });
        geschrieben++;
      }
    }
  });
  await auditSchreiben(db, { type: 'backup', action: 'restore', source: '/api/sicherung/einspielen', metadata: { erzeugtAm: datei.erzeugtAm, zeilen: geschrieben } });
  return { geschrieben };
}

/** Sicherung als Datei (Name mit Zeitpunkt wie alt: backupObjectKey). */
export async function sicherungExport(db: Db) {
  const datei = await sicherungErstellen(db);
  await auditSchreiben(db, { type: 'backup', action: 'export', source: '/api/sicherung/export', metadata: sicherungZaehler(datei) });
  const stempel = datei.erzeugtAm.replace(/[:.]/g, '-');
  return { inhalt: JSON.stringify(datei), name: `gg-sicherung-${stempel}.json` };
}

/** Kennzahlen für die Oberfläche, ohne die ganze Sicherung zu erzeugen. */
export async function sicherungUmfang(db: Db) {
  const zeilen: { tabelle: string; anzahl: number }[] = [];
  for (const name of SICHERUNG_TABELLEN) {
    const [z] = await db.select({ anzahl: sql<number>`count(*)::int` }).from(tabelle(name));
    zeilen.push({ tabelle: name, anzahl: Number(z?.anzahl ?? 0) });
  }
  return { zeilen, gesamt: zeilen.reduce((s, z) => s + z.anzahl, 0), ausgenommen: SICHERUNG_AUSGENOMMEN };
}
