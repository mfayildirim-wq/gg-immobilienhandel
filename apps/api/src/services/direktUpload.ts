import { BUCKETS, type Bucket, DOKUMENT_GRENZEN, EINGANG } from '@gg/integrations';
import { FachFehler } from '../fehler.ts';
import { type DateienKontext, neueAblage } from './dateien.ts';
import { MAX_EXPOSE_BYTES } from './expose.ts';

/**
 * Direkt-Upload, Schritt 1 von 3 — wie `server/direkt-upload.ts` der alten App.
 *
 *   1. POST /api/upload/ticket        → signierte Adresse auf `_eingang/<uuid>` im Zielbucket
 *   2. PUT  <diese Adresse>           → der Browser lädt direkt in den Speicher, an der Function vorbei (Grenze 4,5 MB)
 *   3. POST …/uebernehmen             → der Server prüft die liegende Datei und verschiebt sie an ihren Platz
 *
 * Der Schlüssel kommt vom Server, nie vom Browser: die Übernahme nimmt nur `_eingang/<uuid>` an. Sonst könnte ein
 * angemeldeter Nutzer eine beliebige Datei des Buckets als „sein" Dokument verschieben lassen.
 * Der Eingang liegt im Zielbucket, damit Schritt 3 ein Verschieben bleibt — keine Bytes durch die Function.
 */
export const UPLOAD_ZWECKE = { expose: { bucket: BUCKETS.pdfs, maxBytes: MAX_EXPOSE_BYTES }, dokument: { bucket: BUCKETS.dealDocs, maxBytes: DOKUMENT_GRENZEN.maxBytes } } as const satisfies Record<string, { bucket: Bucket; maxBytes: number }>;
export type UploadZweck = keyof typeof UPLOAD_ZWECKE;

/**
 * Dokumente gehen in die Ablage, die auch die Übernahme nimmt (SharePoint, wenn eingerichtet — dort ist das Ticket eine
 * Upload-Session). Exposés bleiben im Supabase-Eingang: die Analyse liest sie dort, erst die Übernahme legt das Dokument ab.
 */
export async function uploadTicket(k: DateienKontext, zweck: UploadZweck, groesse?: number) {
  const { maxBytes } = UPLOAD_ZWECKE[zweck];
  // Die Größe kommt vom Browser und ist keine Zusage — sie erspart nur den vergeblichen Upload. Verbindlich ist die Übernahme.
  if (groesse !== undefined && groesse > maxBytes) throw new FachFehler(413, `Datei zu groß — höchstens ${maxBytes / 1024 / 1024} MB.`);
  const key = `${EINGANG}/${crypto.randomUUID()}`;
  const sharepoint = zweck === 'dokument' && neueAblage(k) === 'sharepoint';
  const speicher = sharepoint ? k.sharepoint!.speicher : k.speicher;
  const bucket = sharepoint ? BUCKETS.dokumente : UPLOAD_ZWECKE[zweck].bucket;
  const { url, art = 'put' } = await speicher.uploadTicket(bucket, key);
  return { url, key, art };
}
