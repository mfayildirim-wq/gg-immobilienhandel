/**
 * Dateiablage hinter einer Schnittstelle (Protokoll 08: Speicherzugriff austauschbar halten).
 * Buckets und Schlüssel wie in der alten App (server/storage.ts): pdfs/<dealId>.pdf, deal-docs/<dealId>/<docId>_<name>,
 * obj-photos/<objId>/<photoId>.jpg; neue Uploads zunächst unter pdfs/_eingang/<uuid>.
 */
export const BUCKETS = { pdfs: 'pdfs', dealDocs: 'deal-docs', objPhotos: 'obj-photos' } as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Speicherschlüssel eines Objektfotos wie in der alten App (server/storage.ts photoKey): immer `.jpg`, auch bei PNG. */
export const fotoSchluessel = (objektId: string, fotoId: string) => `${objektId}/${fotoId}.jpg`;

/** Speicherschlüssel eines Deal-Dokuments wie in der alten App (server/storage.ts docKey). */
export const dokumentSchluessel = (dealId: string, dokId: string, dateiname: string) =>
  `${dealId}/${dokId}_${dateiname.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 180)}`;

export const EINGANG = '_eingang';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nur Schlüssel `_eingang/<uuid>` – so kann niemand über die Analyse ein fremdes Exposé auslesen lassen. */
export function istEingangsSchluessel(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const teile = key.split('/');
  return teile.length === 2 && teile[0] === EINGANG && UUID.test(teile[1]!);
}

export interface Dateispeicher {
  ablegen(bucket: Bucket, key: string, bytes: Uint8Array, typ: string): Promise<void>;
  holen(bucket: Bucket, key: string): Promise<Uint8Array>;
  verschieben(bucket: Bucket, von: string, nach: string): Promise<void>;
  kopieren(bucket: Bucket, von: string, zielBucket: Bucket, nach: string): Promise<void>;
  loeschen(bucket: Bucket, keys: string[]): Promise<void>;
}

/** Supabase Storage über die REST-API (Service-Schlüssel, nur serverseitig). */
export function supabaseSpeicher(url: string, serviceKey: string): Dateispeicher & { bucketsSicherstellen(): Promise<void> } {
  const kopf = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const basis = `${url.replace(/\/$/, '')}/storage/v1`;
  const pfad = (key: string) => key.split('/').map(encodeURIComponent).join('/');
  const pruefe = async (r: Response, was: string) => {
    if (!r.ok) throw new Error(`Speicher: ${was} fehlgeschlagen (${r.status}) ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  const kopieOderVerschiebe = async (art: 'copy' | 'move', body: object, was: string) =>
    pruefe(await fetch(`${basis}/object/${art}`, { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), was);

  const bucketsSicherstellen = async () => {
      const vorhanden = new Set(((await (await pruefe(await fetch(`${basis}/bucket`, { headers: kopf }), 'Buckets lesen')).json()) as { id: string }[]).map((b) => b.id));
      for (const id of Object.values(BUCKETS)) {
        if (vorhanden.has(id)) continue;
        const r = await fetch(`${basis}/bucket`, { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id, public: false }) });
        // gleichzeitig von anderer Stelle angelegt: kein Fehler
        if (!r.ok && (await r.clone().text()).includes('already exists')) continue;
        await pruefe(r, `Bucket ${id} anlegen`);
      }
  };

  return {
    bucketsSicherstellen,
    async ablegen(bucket, key, bytes, typ) {
      const senden = () => fetch(`${basis}/object/${bucket}/${pfad(key)}`, { method: 'POST', headers: { ...kopf, 'Content-Type': typ, 'x-upsert': 'true' }, body: new Uint8Array(bytes) });
      let r = await senden();
      // Bucket fehlt (z. B. nach `supabase db reset` bei laufender API): anlegen und einmal wiederholen
      if (!r.ok && (await r.clone().text()).includes('Bucket not found')) {
        await bucketsSicherstellen();
        r = await senden();
      }
      await pruefe(r, `Ablegen ${bucket}/${key}`);
    },
    async holen(bucket, key) {
      const r = await pruefe(await fetch(`${basis}/object/authenticated/${bucket}/${pfad(key)}`, { headers: kopf }), `Holen ${bucket}/${key}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async verschieben(bucket, von, nach) {
      await kopieOderVerschiebe('move', { bucketId: bucket, sourceKey: von, destinationKey: nach }, `Verschieben ${von} → ${nach}`);
    },
    async kopieren(bucket, von, zielBucket, nach) {
      await kopieOderVerschiebe('copy', { bucketId: bucket, sourceKey: von, destinationBucket: zielBucket, destinationKey: nach }, `Kopieren ${von} → ${zielBucket}/${nach}`);
    },
    async loeschen(bucket, keys) {
      if (!keys.length) return;
      await pruefe(await fetch(`${basis}/object/${bucket}`, { method: 'DELETE', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: keys }) }), `Löschen in ${bucket}`);
    },
  };
}

/** Im Speicher, für Tests. */
export function speicherImSpeicher(): Dateispeicher & { inhalt: Map<string, Uint8Array> } {
  const inhalt = new Map<string, Uint8Array>();
  const k = (b: string, key: string) => `${b}/${key}`;
  const hole = (b: string, key: string) => {
    const d = inhalt.get(k(b, key));
    if (!d) throw new Error(`Speicher: ${b}/${key} nicht gefunden`);
    return d;
  };
  return {
    inhalt,
    async ablegen(b, key, bytes) { inhalt.set(k(b, key), bytes); },
    async holen(b, key) { return hole(b, key); },
    async verschieben(b, von, nach) { inhalt.set(k(b, nach), hole(b, von)); inhalt.delete(k(b, von)); },
    async kopieren(b, von, zb, nach) { inhalt.set(k(zb, nach), hole(b, von)); },
    async loeschen(b, keys) { keys.forEach((key) => inhalt.delete(k(b, key))); },
  };
}
