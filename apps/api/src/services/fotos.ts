import type { ObjektFoto } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { bildTypErkennen, BUCKETS, type Dateispeicher, fotoSchluessel, MAX_FOTO_BYTES } from '@gg/integrations';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';

type Zeile = typeof schema.objektFotos.$inferSelect;

export const fotoRef = (objektId: string, fotoId: string) => `photo:${objektId}/${fotoId}`;

const alsFoto = (f: Zeile): ObjektFoto => ({
  id: f.id, objektId: f.objektId, dateiname: f.dateiname, mimeType: f.mimeType ?? 'image/jpeg', groesseBytes: f.groesseBytes ?? 0,
  sort: f.sort ?? 0, hochgeladenAm: f.hochgeladenAm, ref: fotoRef(f.objektId, f.id), url: `/api/photos/${f.objektId}/${f.id}`,
});

async function audit(db: Db, action: 'create' | 'delete', fotoId: string, metadata: object) {
  await auditSchreiben(db, {
    type: action === 'delete' ? 'delete' : 'mutation', entity: 'photo', entityId: fotoId, action,
    collection: 'objekt_fotos', source: '/api/objekte/{id}/fotos', metadata,
  });
}

/** Fotos eines Objekts in der Reihenfolge der alten App (sort, dann Hochladezeit). */
export async function fotosListe(db: Db, objektId: string): Promise<ObjektFoto[]> {
  const zeilen = await db.select().from(schema.objektFotos).where(eq(schema.objektFotos.objektId, objektId))
    .orderBy(asc(schema.objektFotos.sort), asc(schema.objektFotos.hochgeladenAm), asc(schema.objektFotos.id));
  return zeilen.map(alsFoto);
}

/** Datei zuerst in die Ablage, dann die Zeile: scheitert der Upload, bleibt keine Zeile ohne Datei zurück. */
export async function fotoHochladen(db: Db, speicher: Dateispeicher, objektId: string, bytes: Uint8Array, dateiname: string | undefined): Promise<ObjektFoto> {
  const [objekt] = await db.select({ id: schema.objekte.id }).from(schema.objekte).where(and(eq(schema.objekte.id, objektId), isNull(schema.objekte.deletedAt)));
  if (!objekt) throw new FachFehler(404, 'Objekt nicht gefunden');
  if (bytes.byteLength > MAX_FOTO_BYTES) throw new FachFehler(422, 'Bild zu groß (> 8 MB nach Kompression)');
  const typ = bildTypErkennen(bytes);
  if (!typ) throw new FachFehler(422, 'Die Datei ist kein unterstütztes Bild (JPEG, PNG, WebP, GIF, HEIC).');
  const id = crypto.randomUUID();
  await speicher.ablegen(BUCKETS.objPhotos, fotoSchluessel(objektId, id), bytes, typ);
  const [zeile] = await db.insert(schema.objektFotos).values({
    id, objektId, storageKey: fotoSchluessel(objektId, id), dateiname: dateiname?.slice(0, 300) || `upload-${id}.jpg`, mimeType: typ,
    groesseBytes: bytes.byteLength,
    sort: sql`(select coalesce(max(${schema.objektFotos.sort}) + 1, 0) from ${schema.objektFotos} where ${schema.objektFotos.objektId} = ${objektId})`,
  }).returning();
  await audit(db, 'create', id, { objekt_id: objektId, size_bytes: bytes.byteLength, mime: typ });
  return alsFoto(zeile!);
}

export async function fotoDatei(db: Db, speicher: Dateispeicher, objektId: string, fotoId: string) {
  // „cover“ wie alt (/api/photos/:objId/cover): erstes Foto in der Sortierung, für die Vorschaubilder der Listen
  const [f] = fotoId === 'cover'
    ? await db.select().from(schema.objektFotos).where(eq(schema.objektFotos.objektId, objektId)).orderBy(asc(schema.objektFotos.sort), asc(schema.objektFotos.hochgeladenAm)).limit(1)
    : await db.select().from(schema.objektFotos).where(and(eq(schema.objektFotos.id, fotoId), eq(schema.objektFotos.objektId, objektId)));
  if (!f) throw new FachFehler(404, 'Foto nicht gefunden');
  try {
    return { bytes: await speicher.holen(BUCKETS.objPhotos, f.storageKey ?? fotoSchluessel(objektId, f.id)), mimeType: f.mimeType ?? 'image/jpeg' };
  } catch {
    throw new FachFehler(404, 'Fotodatei fehlt in der Ablage');
  }
}

/** Bytes zu einem `photo:`-Verweis für den Export; fehlt etwas, entsteht eine leere Stelle statt eines Abbruchs. */
export const fotoPort = (db: Db, speicher: Dateispeicher | undefined) => ({
  holeFoto: async (objektId: string, fotoId: string) => {
    if (!speicher) return null;
    try {
      return Buffer.from((await fotoDatei(db, speicher, objektId, fotoId)).bytes);
    } catch {
      return null;
    }
  },
});

/** Zeile zuerst, dann die Datei (Reihenfolge der alten App): ein Verweis auf eine fehlende Datei ist harmloser als umgekehrt. */
export async function fotoLoeschen(db: Db, speicher: Dateispeicher, objektId: string, fotoId: string) {
  const [f] = await db.delete(schema.objektFotos).where(and(eq(schema.objektFotos.id, fotoId), eq(schema.objektFotos.objektId, objektId))).returning();
  if (!f) throw new FachFehler(404, 'Foto nicht gefunden');
  await speicher.loeschen(BUCKETS.objPhotos, [f.storageKey ?? fotoSchluessel(objektId, f.id)]).catch((e) => console.error('[fotos] Datei nicht gelöscht:', e));
  await audit(db, 'delete', fotoId, { objekt_id: objektId });
  return { id: fotoId };
}

export async function fotosSortieren(db: Db, objektId: string, ids: string[]): Promise<ObjektFoto[]> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.update(schema.objektFotos).set({ sort: i }).where(and(eq(schema.objektFotos.id, id), eq(schema.objektFotos.objektId, objektId)));
    }
  });
  return fotosListe(db, objektId);
}
