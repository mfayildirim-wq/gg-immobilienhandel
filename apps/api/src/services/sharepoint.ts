/**
 * SharePoint als Dokumentablage (Protokoll 19, Phase 3): Konfiguration, Aufbau der Ablage aus der Datenbank und
 * der Verbindungstest. Die App-Registrierung (Client-ID, Tenant, Geheimnis) ist dieselbe wie für das Postfach
 * (Einstellungen → Microsoft 365); hier kommen nur Site und Wurzelordner dazu — plus der Schalter „aktiv“.
 *
 * Solange nichts eingerichtet oder der Schalter aus ist, bleibt alles in Supabase. Die fertige Ablage wird kurz
 * zwischengehalten (App-Token, Drive-Kennung), aber bei jeder Konfigurationsänderung neu aufgebaut.
 */
import type { SharepointStand } from '@gg/api-contract';
import type { Db } from '@gg/db';
import { appToken, BUCKETS, graphDrive, type SharepointAblage, sharepointAblage, siteIdAusUrl } from '@gg/integrations';
import { auditSchreiben } from './audit.ts';
import { einstellung, einstellungSpeichern, m365KonfigurationLesen } from './m365.ts';
import { FachFehler } from '../fehler.ts';

const KONFIG_SCHLUESSEL = 'sharepoint-konfiguration';
export const WURZEL_STANDARD = 'GG Immohandel';

export interface SharepointKonfiguration { siteUrl: string; wurzel: string; aktiv: boolean }

export const sharepointKonfigurationLesen = async (db: Db): Promise<SharepointKonfiguration> => {
  const roh = await einstellung<Partial<SharepointKonfiguration> | null>(db, KONFIG_SCHLUESSEL, null);
  return { siteUrl: roh?.siteUrl ?? '', wurzel: roh?.wurzel || WURZEL_STANDARD, aktiv: Boolean(roh?.aktiv) };
};

export async function sharepointKonfigurationSpeichern(db: Db, e: SharepointKonfiguration) {
  const neu = { siteUrl: e.siteUrl.trim().replace(/\/$/, ''), wurzel: e.wurzel.trim() || WURZEL_STANDARD, aktiv: e.aktiv };
  if (neu.aktiv && !neu.siteUrl) throw new FachFehler(400, 'Ohne Site-Adresse kann SharePoint nicht aktiv sein.');
  await einstellungSpeichern(db, KONFIG_SCHLUESSEL, neu);
  await auditSchreiben(db, { type: 'mutation', entity: 'sharepoint', action: 'config', source: '/api/sharepoint/konfiguration', metadata: neu });
  cache = null;
  return { ok: true as const };
}

export async function sharepointStand(db: Db): Promise<SharepointStand> {
  const k = await sharepointKonfigurationLesen(db);
  const m365 = await m365KonfigurationLesen(db);
  return { ...k, m365Eingerichtet: Boolean(m365?.clientSecret), wurzelStandard: WURZEL_STANDARD };
}

let cache: { schluessel: string; ablage: SharepointAblage } | null = null;

/**
 * Die Ablage für neue Dokumente — oder null, wenn SharePoint nicht aktiv oder nicht vollständig eingerichtet ist.
 * Der Aufbau ist billig (Token und Drive werden erst beim ersten Aufruf geholt), deshalb reicht ein Cache je Konfiguration.
 */
export async function sharepointAblageBauen(db: Db): Promise<SharepointAblage | null> {
  const k = await sharepointKonfigurationLesen(db);
  if (!k.aktiv || !k.siteUrl) return null;
  const m365 = await m365KonfigurationLesen(db);
  if (!m365?.clientSecret) return null;
  const schluessel = JSON.stringify([k.siteUrl, k.wurzel, m365.clientId, m365.tenantId]);
  if (cache?.schluessel === schluessel) return cache.ablage;
  const token = appToken({ tenantId: m365.tenantId, clientId: m365.clientId, clientSecret: m365.clientSecret });
  const drive = graphDrive(token, siteIdAusUrl(k.siteUrl));
  const ablage = sharepointAblage(drive, { wurzel: k.wurzel, ordner: { [BUCKETS.dokumente]: '' } });
  cache = { schluessel, ablage };
  return ablage;
}

/** Verbindungstest: Token, Bibliothek, eine Probedatei unter `<wurzel>/_probe/` schreiben, lesen, löschen. */
export async function sharepointVerbindungTesten(db: Db) {
  const k = await sharepointKonfigurationLesen(db);
  const m365 = await m365KonfigurationLesen(db);
  if (!k.siteUrl) throw new FachFehler(422, 'Site-Adresse fehlt.');
  if (!m365?.clientSecret) throw new FachFehler(422, 'Die Azure-App unter Microsoft 365 ist nicht eingerichtet (Client-ID, Tenant, Geheimnis).');
  const start = Date.now();
  const schritte: string[] = [];
  try {
    const token = appToken({ tenantId: m365.tenantId, clientId: m365.clientId, clientSecret: m365.clientSecret });
    await token();
    schritte.push('App-Token erhalten');
    const drive = graphDrive(token, siteIdAusUrl(k.siteUrl));
    await drive.driveId();
    schritte.push('Dokumentbibliothek gefunden');
    const ablage = sharepointAblage(drive, { wurzel: k.wurzel, ordner: { [BUCKETS.dokumente]: '' } });
    const key = `_probe/${crypto.randomUUID()}.txt`;
    await ablage.speicher.ablegen(BUCKETS.dokumente, key, new TextEncoder().encode('GG Immohandel Verbindungstest'), 'text/plain');
    schritte.push(`Probedatei geschrieben (${k.wurzel}/_probe)`);
    const it = await ablage.item(BUCKETS.dokumente, key);
    if (!it) throw new Error('Probedatei nicht wiedergefunden');
    const inhalt = new TextDecoder().decode(await ablage.speicher.holen(BUCKETS.dokumente, key));
    if (inhalt !== 'GG Immohandel Verbindungstest') throw new Error('Probedatei falsch gelesen');
    schritte.push('Probedatei gelesen (Download-Adresse)');
    await ablage.speicher.loeschen(BUCKETS.dokumente, [key]);
    schritte.push('Probedatei gelöscht');
    await auditSchreiben(db, { type: 'mutation', entity: 'sharepoint', action: 'test', source: '/api/sharepoint/test', metadata: { ok: true, dauerMs: Date.now() - start } });
    return { ok: true as const, schritte, webUrl: it.webUrl.replace(/\/[^/]*$/, ''), dauerMs: Date.now() - start };
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e);
    await auditSchreiben(db, { type: 'mutation', entity: 'sharepoint', action: 'test', source: '/api/sharepoint/test', metadata: { ok: false, grund: grund.slice(0, 300) } });
    throw new FachFehler(502, `Verbindung fehlgeschlagen nach: ${schritte.join(' → ') || 'Start'} — ${grund}`, { schritte });
  }
}
