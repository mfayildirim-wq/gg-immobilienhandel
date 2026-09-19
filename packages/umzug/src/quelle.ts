import postgres from 'postgres';
import { DOKUMENT_TABELLE, FOTO_TABELLE, type KvDaten } from './umformen.ts';

/** Liest alle Sammlungen der alten App in einer schreibgeschützten Transaktion. Geheimnisse bleiben draußen. */
export async function quelleLaden(url: string): Promise<KvDaten> {
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const zeilen = await sql.begin('read only', (tx) =>
      tx<{ key: string; value: unknown }[]>`
        select key, value from app.kv_store
        where key like 'immo-%' and key not in ('immo-pin')
        order by key`,
    );
    // Foto-Metadaten liegen in einer eigenen Tabelle; die Dateien bleiben im Bucket obj-photos (gleiches Projekt).
    const fotos = await sql.begin('read only', (tx) =>
      tx`select id, obj_id, original_name, mime_type, size_bytes::float8 as size_bytes, sort_order, uploaded_at::float8 as uploaded_at
         from app.obj_photos order by obj_id, sort_order, uploaded_at, id`,
    );
    // Deal-Dokumente ebenso (Dateien im Bucket deal-docs)
    const dokumente = await sql.begin('read only', (tx) =>
      tx`select id, deal_id, original_name, mime_type, size_bytes::float8 as size_bytes, label, uploaded_at::float8 as uploaded_at
         from app.deal_documents order by deal_id, uploaded_at, id`,
    );
    return { ...Object.fromEntries(zeilen.map((z) => [z.key, z.value])), [FOTO_TABELLE]: [...fotos], [DOKUMENT_TABELLE]: [...dokumente] };
  } finally {
    await sql.end();
  }
}
