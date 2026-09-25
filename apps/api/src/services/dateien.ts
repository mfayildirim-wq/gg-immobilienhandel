/**
 * Dokumente an Geschäftsobjekten (Protokoll 19, Phase 2) — vorher nur Deal-Dokumente (alt: /api/docs/:dealId).
 *
 *  • Bezug: Deal oder Objekt. Ein Deal-Dokument liegt fachlich beim Objekt des Deals (ein Objekt kann mehrere Deals haben).
 *  • Ablage je Dokument: `supabase` (Bucket + Schlüssel, wie bisher) oder `sharepoint` (Item-Kennung, Pfad, Link).
 *    Neue Dokumente gehen nach SharePoint, wenn es eingerichtet ist — Bestände bleiben, wo sie sind, und werden
 *    über ihre eigene Ablage gelesen. So ist die Migration ein eigener Schritt, kein Stichtag.
 *  • SharePoint-Ordnung: `Objekte/<Adresse> [<objekt-id>]/<Datei>` und `…/Deals/<deal-id>/<Datei>` — die ID im
 *    Ordnernamen hält ihn eindeutig, gefunden wird über die stabile Item-Kennung.
 */
import type { Dokument, DokumentBezug } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { type Bucket, BUCKETS, type Dateispeicher, DOKUMENT_GRENZEN, dokumentSchluessel, einheitenExtrahieren, istEingangsSchluessel, type ExtrahierteEinheit, type KiClient, kostenBuchung, pdfSeitenzahl, pruefeDateien, type SharepointAblage, sharepointName } from '@gg/integrations';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { objektTitel } from './objekte.ts';
import { FachFehler } from '../fehler.ts';

export interface DateienKontext {
  db: Db;
  /** Supabase Storage — Bestand und Rückfall */
  speicher: Dateispeicher;
  /** SharePoint, wenn eingerichtet — dann gehen neue Dokumente dorthin */
  sharepoint?: SharepointAblage | null;
}

type Zeile = typeof schema.dokumente.$inferSelect;

const alsDokument = (d: Zeile): Dokument => ({
  id: d.id, dateiname: d.dateiname ?? '', mimeType: d.mimeType ?? 'application/octet-stream', groesseBytes: d.groesseBytes ?? 0, label: d.label ?? '',
  hochgeladenAm: d.hochgeladenAm, istExpose: Boolean(d.istExpose), ablage: d.ablage as Dokument['ablage'],
  pfad: d.ablage === 'sharepoint' ? d.spPfad ?? '' : `${d.bucket}/${d.storageKey ?? ''}`, webUrl: d.spWebUrl ?? null, fehltSeit: d.spFehltSeit ?? null,
  bezug: d.objektId && !d.dealId ? { art: 'objekt', id: d.objektId } : { art: 'deal', id: d.dealId ?? '' },
});

/** Audit wie alt (logAudit in server/index.ts: Bezeichnung ändern, Löschen). */
async function audit(db: Db, e: { type: 'mutation' | 'delete'; dokId: string; action: 'update' | 'delete'; fieldName?: string; oldValue?: string | null; newValue?: string; metadata?: object }) {
  await auditSchreiben(db, {
    type: e.type, entity: 'doc', entityId: e.dokId, action: e.action, collection: 'dokumente', source: '/api/{bezug}/{id}/dokumente/{dokId}',
    fieldName: e.fieldName, oldValue: e.oldValue ?? null, newValue: e.newValue, metadata: e.metadata ?? null,
  });
}

/** Bezug prüfen und das Objekt dazu holen — der SharePoint-Ordner heißt nach dem Objekt. */
async function bezugPruefen(db: Db, bezug: DokumentBezug) {
  if (bezug.art === 'deal') {
    const [d] = await db.select({ id: schema.deals.id, objektId: schema.deals.objektId }).from(schema.deals).where(and(eq(schema.deals.id, bezug.id), isNull(schema.deals.deletedAt)));
    if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
    return { dealId: d.id, objektId: d.objektId };
  }
  const [o] = await db.select({ id: schema.objekte.id }).from(schema.objekte).where(and(eq(schema.objekte.id, bezug.id), isNull(schema.objekte.deletedAt)));
  if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
  return { dealId: null, objektId: o.id };
}

const bezugBedingung = (bezug: DokumentBezug) => (bezug.art === 'deal' ? eq(schema.dokumente.dealId, bezug.id) : and(eq(schema.dokumente.objektId, bezug.id), isNull(schema.dokumente.dealId)));

/** `Objekte/<Adresse> [<objekt-id>]` — Ordner je Objekt; Deal-Dokumente darunter in `Deals/<deal-id>` */
export async function sharepointOrdner(db: Db, objektId: string, dealId: string | null): Promise<string> {
  const [o] = await db.select({ strasse: schema.objekte.strasse, hausnr: schema.objekte.hausnr, stadt: schema.objekte.stadt }).from(schema.objekte).where(eq(schema.objekte.id, objektId));
  const adresse = o ? [objektTitel(o), o.stadt].filter(Boolean).join(', ') : 'Objekt';
  const objektOrdner = `Objekte/${sharepointName(`${adresse} [${objektId}]`)}`;
  return dealId ? `${objektOrdner}/Deals/${sharepointName(dealId)}` : objektOrdner;
}

/** listDocs: neueste zuerst. Am Objekt zusätzlich mit `mitDeals`: auch die Dokumente seiner Deals (dort steht alles zu einer Immobilie). */
export async function dokumenteListe(db: Db, bezug: DokumentBezug, mitDeals = false): Promise<Dokument[]> {
  await bezugPruefen(db, bezug);
  const wo = bezug.art === 'objekt' && mitDeals ? eq(schema.dokumente.objektId, bezug.id) : bezugBedingung(bezug);
  return (await db.select().from(schema.dokumente).where(wo).orderBy(desc(schema.dokumente.hochgeladenAm), desc(schema.dokumente.id))).map(alsDokument);
}

const grenzenPruefen = (dateien: { name: string }[]) => {
  if (!dateien.length) throw new FachFehler(400, 'Keine Dateien hochgeladen');
  if (dateien.length > DOKUMENT_GRENZEN.maxDateien) throw new FachFehler(413, `Zu viele Dateien — höchstens ${DOKUMENT_GRENZEN.maxDateien} pro Upload.`);
};
const HINWEIS_TYP = 'Erlaubt sind PDF, Bilder, Office-Dateien und Text. Es wurde nichts gespeichert — bitte die beanstandete Datei aus der Auswahl nehmen und erneut hochladen.';

interface Eintragung { id: string; name: string; mime: string; groesse: number; istExpose?: boolean; label?: string }

/**
 * Eine Zeile eintragen — nach dem Ablegen. Bei SharePoint werden Item-Kennung, Pfad und Link nachgeschlagen; ohne sie
 * wäre die Zeile blind (Pfad allein reicht nicht, wenn jemand in SharePoint verschiebt).
 */
async function eintragen(k: DateienKontext, bezug: { dealId: string | null; objektId: string }, e: Eintragung, ablage: { art: 'supabase'; bucket: string; key: string } | { art: 'sharepoint'; key: string }) {
  const sp = ablage.art === 'sharepoint' ? await k.sharepoint!.item(BUCKETS.dokumente, ablage.key) : null;
  if (ablage.art === 'sharepoint' && !sp) throw new FachFehler(500, `„${e.name}" wurde in SharePoint nicht wiedergefunden.`);
  await k.db.insert(schema.dokumente).values({
    id: e.id, dealId: bezug.dealId, objektId: bezug.objektId, dateiname: e.name, mimeType: e.mime, groesseBytes: e.groesse, label: e.label ?? '', istExpose: e.istExpose ?? false,
    ablage: ablage.art, bucket: ablage.art === 'supabase' ? ablage.bucket : BUCKETS.dokumente, storageKey: ablage.key,
    spItemId: sp?.id ?? null, spPfad: sp?.pfad ?? null, spWebUrl: sp?.webUrl ?? null, spEtag: sp?.eTag ?? null,
  });
}

/** Wohin neue Dokumente gehen: SharePoint, wenn eingerichtet. */
export const neueAblage = (k: DateienKontext): 'sharepoint' | 'supabase' => (k.sharepoint ? 'sharepoint' : 'supabase');
const speicherFuer = (k: DateienKontext, ablage: string) => (ablage === 'sharepoint' ? k.sharepoint?.speicher : k.speicher) ?? k.speicher;
const bucketFuer = (ablage: string) => (ablage === 'sharepoint' ? BUCKETS.dokumente : BUCKETS.dealDocs);

/**
 * Stapel hochladen (POST …/dokumente, mehrteilig): erst jede Datei prüfen (Signatur), dann schreiben;
 * scheitert das Schreiben, wird Geschriebenes zurückgenommen (deal-docs.ts).
 */
export async function dokumenteHochladen(k: DateienKontext, bezug: DokumentBezug, dateien: { name: string; typ: string; bytes: Uint8Array }[], vorgabe: { istExpose?: boolean; label?: string } = {}): Promise<Dokument[]> {
  const b = await bezugPruefen(k.db, bezug);
  grenzenPruefen(dateien);
  const zuGross = dateien.find((d) => d.bytes.byteLength > DOKUMENT_GRENZEN.maxBytes);
  if (zuGross) throw new FachFehler(413, `„${zuGross.name}" ist größer als ${DOKUMENT_GRENZEN.maxBytes / 1024 / 1024} MB.`);
  const stapel = pruefeDateien(dateien.map((d) => ({ name: d.name, gemeldeterTyp: d.typ, bytes: Buffer.from(d.bytes) })));
  if (!stapel.ok) throw new FachFehler(415, stapel.grund, { hint: HINWEIS_TYP });

  const ablage = neueAblage(k);
  const speicher = speicherFuer(k, ablage);
  const bucket = bucketFuer(ablage);
  const ordner = ablage === 'sharepoint' ? await sharepointOrdner(k.db, b.objektId, b.dealId) : null;
  const geschrieben: { id: string; key: string }[] = [];
  try {
    for (const [i, d] of dateien.entries()) {
      const id = crypto.randomUUID();
      const key = ordner ? `${ordner}/${sharepointName(d.name)}` : dokumentSchluessel(bezug.id, id, d.name);
      await speicher.ablegen(bucket, key, d.bytes, stapel.dateien[i]!.mime);
      geschrieben.push({ id, key });
      await eintragen(k, b, { id, name: d.name, mime: stapel.dateien[i]!.mime, groesse: d.bytes.byteLength, ...vorgabe }, ablage === 'sharepoint' ? { art: 'sharepoint', key } : { art: 'supabase', bucket, key });
    }
  } catch (err) {
    for (const g of geschrieben) {
      await k.db.delete(schema.dokumente).where(eq(schema.dokumente.id, g.id)).catch(() => {});
      await speicher.loeschen(bucket, [g.key]).catch(() => {});
    }
    throw err;
  }
  const ids = geschrieben.map((g) => g.id);
  return (await dokumenteListe(k.db, bezug)).filter((d) => ids.includes(d.id));
}

/**
 * Direkt-Upload, Schritt 3: die Dateien liegen unter `<bucket>/_eingang/<uuid>` — in der Ablage, die das Ticket ausgegeben
 * hat. Dieselben Regeln wie `dokumenteHochladen`, nur dass der Server die Bytes erst sieht, wenn sie liegen: er holt je
 * Datei die ersten 4 KB (Signatur) und die Größe. Fällt eine Datei durch, wird der Stapel aus dem Eingang gelöscht.
 */
export async function dokumenteUebernehmen(k: DateienKontext, bezug: DokumentBezug, dateien: { key: string; name: string; typ: string }[]): Promise<Dokument[]> {
  const b = await bezugPruefen(k.db, bezug);
  grenzenPruefen(dateien);
  if (dateien.some((d) => !istEingangsSchluessel(d.key)) || new Set(dateien.map((d) => d.key)).size !== dateien.length) throw new FachFehler(400, 'Ungültiger Upload-Schlüssel.');
  const ablage = neueAblage(k);
  const speicher = speicherFuer(k, ablage);
  const bucket = bucketFuer(ablage);
  const eingangLeeren = () => speicher.loeschen(bucket, dateien.map((d) => d.key)).catch(() => {});

  const koepfe: { bytes: Uint8Array; groesse: number }[] = [];
  for (const d of dateien) {
    koepfe.push(await speicher.anfang(bucket, d.key, 4096).catch(async () => { await eingangLeeren(); throw new FachFehler(404, `„${d.name}" wurde nicht gefunden — bitte erneut hochladen.`); }));
  }
  const zuGross = dateien.find((_, i) => koepfe[i]!.groesse > DOKUMENT_GRENZEN.maxBytes);
  if (zuGross) { await eingangLeeren(); throw new FachFehler(413, `„${zuGross.name}" ist größer als ${DOKUMENT_GRENZEN.maxBytes / 1024 / 1024} MB.`); }
  const stapel = pruefeDateien(dateien.map((d, i) => ({ name: d.name, gemeldeterTyp: d.typ, bytes: Buffer.from(koepfe[i]!.bytes) })));
  if (!stapel.ok) { await eingangLeeren(); throw new FachFehler(415, stapel.grund, { hint: HINWEIS_TYP }); }

  const ordner = ablage === 'sharepoint' ? await sharepointOrdner(k.db, b.objektId, b.dealId) : null;
  const geschrieben: { id: string; key: string }[] = [];
  try {
    for (const [i, d] of dateien.entries()) {
      const id = crypto.randomUUID();
      const key = ordner ? `${ordner}/${sharepointName(d.name)}` : dokumentSchluessel(bezug.id, id, d.name);
      await speicher.verschieben(bucket, d.key, key);
      geschrieben.push({ id, key });
      await eintragen(k, b, { id, name: d.name, mime: stapel.dateien[i]!.mime, groesse: koepfe[i]!.groesse }, ablage === 'sharepoint' ? { art: 'sharepoint', key } : { art: 'supabase', bucket, key });
    }
  } catch (err) {
    for (const g of geschrieben) {
      await k.db.delete(schema.dokumente).where(eq(schema.dokumente.id, g.id)).catch(() => {});
      await speicher.loeschen(bucket, [g.key]).catch(() => {});
    }
    await eingangLeeren();
    throw err;
  }
  const ids = geschrieben.map((g) => g.id);
  return (await dokumenteListe(k.db, bezug)).filter((d) => ids.includes(d.id));
}

/**
 * Ein Dokument über seinen Bezug — am Objekt auch die Dokumente seiner Deals, am Deal auch die seines Objekts
 * (beide Listen zeigen sie mit). Über einen fremden Deal oder ein fremdes Objekt bleibt es unerreichbar.
 */
async function dokument(db: Db, bezug: DokumentBezug, dokId: string): Promise<Zeile> {
  const b = await bezugPruefen(db, bezug);
  const wo = bezug.art === 'objekt'
    ? eq(schema.dokumente.objektId, bezug.id)
    : or(eq(schema.dokumente.dealId, bezug.id), and(eq(schema.dokumente.objektId, b.objektId), isNull(schema.dokumente.dealId)));
  const [d] = await db.select().from(schema.dokumente).where(and(eq(schema.dokumente.id, dokId), wo));
  if (!d) throw new FachFehler(404, 'Dokument nicht gefunden');
  return d;
}

const schluesselVon = (d: Zeile) => d.storageKey ?? dokumentSchluessel(d.dealId ?? d.objektId ?? '', d.id, d.dateiname ?? '');

/**
 * Datei ausliefern: aus Supabase als Strom (inline nur für PDF und Bilder), aus SharePoint als Weiterleitung auf die
 * kurzlebige Download-Adresse — der Browser lädt direkt, ohne die 4,5-MB-Grenze der Function und ohne eigene SharePoint-Rechte.
 */
export async function dokumentDatei(k: DateienKontext, bezug: DokumentBezug, dokId: string): Promise<{ art: 'bytes'; bytes: Uint8Array; mime: string; disposition: string } | { art: 'weiterleitung'; url: string }> {
  const d = await dokument(k.db, bezug, dokId);
  if (d.ablage === 'sharepoint') {
    if (!k.sharepoint) throw new FachFehler(404, 'SharePoint ist nicht eingerichtet — die Datei liegt dort');
    // über die stabile Kennung: findet die Datei auch, wenn sie in SharePoint verschoben wurde; sonst über den Pfad
    const it = d.spItemId ? await k.sharepoint.itemNachId(d.spItemId) : null;
    const url = it?.downloadUrl ?? (await k.sharepoint.downloadUrl(d.bucket as Bucket, schluesselVon(d)));
    if (!url) throw new FachFehler(404, 'Datei fehlt in SharePoint');
    return { art: 'weiterleitung', url };
  }
  const mime = d.mimeType ?? 'application/octet-stream';
  let bytes: Uint8Array;
  try {
    bytes = await k.speicher.holen(d.bucket as Bucket, schluesselVon(d));
  } catch {
    throw new FachFehler(404, 'Datei fehlt in der Ablage');
  }
  const inline = mime === 'application/pdf' || mime.startsWith('image/');
  const name = (d.dateiname ?? 'dokument').replace(/[^\w\s.\-äöüÄÖÜß]/g, '_');
  return { art: 'bytes', bytes, mime, disposition: `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(d.dateiname ?? name)}` };
}

export async function dokumentBezeichnen(db: Db, bezug: DokumentBezug, dokId: string, label: string) {
  const d = await dokument(db, bezug, dokId);
  await db.update(schema.dokumente).set({ label }).where(eq(schema.dokumente.id, dokId));
  await audit(db, { type: 'mutation', dokId, action: 'update', fieldName: 'label', oldValue: d.label, newValue: label });
  return { ok: true as const };
}

/** Zeile zuerst: scheitert das Entfernen in der Ablage, bleibt eine unsichtbare Datei statt eines toten Eintrags. */
export async function dokumentLoeschen(k: DateienKontext, bezug: DokumentBezug, dokId: string) {
  const d = await dokument(k.db, bezug, dokId);
  await k.db.delete(schema.dokumente).where(eq(schema.dokumente.id, dokId));
  await audit(k.db, { type: 'delete', dokId, action: 'delete', metadata: { deal_id: d.dealId, objekt_id: d.objektId, original_name: d.dateiname, ablage: d.ablage } });
  await speicherFuer(k, d.ablage).loeschen(d.bucket as Bucket, [schluesselVon(d)]).catch((e) => console.error('[dokumente] Datei nicht gelöscht:', e));
  return { ok: true as const };
}

/** listExposeDocIds: je Deal das Exposé-Dokument (Bezeichnung „Expos…“ vor Dateiname mit „expos“, dann das neueste). */
export async function exposeDokumentIds(db: Db): Promise<Record<string, string>> {
  const zeilen = await db.selectDistinctOn([schema.dokumente.dealId], { dealId: schema.dokumente.dealId, id: schema.dokumente.id })
    .from(schema.dokumente)
    .where(and(sql`${schema.dokumente.dealId} is not null`, or(sql`${schema.dokumente.label} ilike 'expos%'`, sql`${schema.dokumente.dateiname} ilike '%expos%'`)))
    .orderBy(schema.dokumente.dealId, sql`(${schema.dokumente.label} ilike 'expos%') desc`, desc(schema.dokumente.hochgeladenAm));
  return Object.fromEntries(zeilen.filter((z) => z.dealId).map((z) => [z.dealId!, z.id]));
}

/**
 * Einheiten aus Mieterliste/Flächenberechnung (POST /api/deals/:dealId/extract-units): PDF zuerst in den Dokumenten des Deals
 * ablegen, dann per KI auslesen. Scheitert die KI, bleibt die Datei im Deal (docId geht mit zurück).
 */
export async function einheitenAusMieterliste(
  k: DateienKontext, ki: KiClient | null | undefined, dealId: string, datei: { name: string; typ: string; bytes: Uint8Array } | null,
): Promise<{ docId: string; einheiten: ExtrahierteEinheit[]; pages: number }> {
  if (!datei) throw new FachFehler(400, 'Keine Datei hochgeladen');
  await bezugPruefen(k.db, { art: 'deal', id: dealId });
  if (datei.bytes.byteLength > 50 * 1024 * 1024) throw new FachFehler(413, `„${datei.name}" ist größer als 50 MB.`);
  const geprueft = pruefeDateien([{ name: datei.name, gemeldeterTyp: datei.typ, bytes: Buffer.from(datei.bytes) }]);
  if (!geprueft.ok || geprueft.dateien[0]!.mime !== 'application/pdf') {
    throw new FachFehler(415, geprueft.ok ? `„${datei.name}" ist kein PDF.` : geprueft.grund);
  }
  const [dok] = await dokumenteHochladen(k, { art: 'deal', id: dealId }, [datei], { label: 'Mieterliste (für Einheiten-Extraktion)' });
  const docId = dok!.id;
  try {
    if (!ki) throw new Error('KI ist nicht eingerichtet (ANTHROPIC_API_KEY)');
    const pages = await pdfSeitenzahl(Buffer.from(datei.bytes));
    const a = await einheitenExtrahieren(ki, datei.bytes, pages);
    const b = kostenBuchung(a.model, a.usage, 'deals/extract-units', { deal_id: dealId });
    await auditSchreiben(k.db, { type: b.type, aiModel: b.ai_model, aiFunction: 'deals/extract-units', source: 'deals/extract-units', inputTokens: b.input_tokens, outputTokens: b.output_tokens, costEur: b.cost_eur, metadata: b.metadata });
    await auditSchreiben(k.db, { type: 'auto_import', source: '/api/deals/:dealId/extract-units', metadata: { deal_id: dealId, doc_id: docId, einheiten_count: a.wert.length, pages } });
    return { docId, einheiten: a.wert, pages };
  } catch (e) {
    console.error('[deals/extract-units] Einheiten-Extraktion fehlgeschlagen:', e);
    throw new FachFehler(500, `Einheiten-Extraktion fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, {
      docId, hint: 'Das PDF liegt trotzdem im Deal. Anthropic-Key prüfen oder die Einheiten von Hand erfassen.',
    });
  }
}
