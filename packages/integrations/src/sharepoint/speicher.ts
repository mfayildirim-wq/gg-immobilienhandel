/**
 * SharePoint als Dateispeicher (Protokoll 19, Weg A): zweite Umsetzung der Schnittstelle `Dateispeicher`, damit
 * Exposé-Import und -Analyse, Dokumentliste, Eingang und Direkt-Upload unverändert weiterlaufen.
 *
 * Abbildung: Bucket und Schlüssel werden zu einem Pfad in der Dokumentbibliothek — `<wurzel>/<bucket>/<schlüssel>`.
 * Was SharePoint in Namen nicht erlaubt, wird bereinigt (`sharepointName`). Das Upload-Ticket ist eine Upload-Session:
 * der Browser schickt die Datei in Stücken mit `Content-Range` (Art `upload-session`), nicht per einfachem PUT.
 */
import { type Bucket, type Dateispeicher, type SpeicherEintrag } from '../speicher/speicher.ts';
import { type GraphDrive } from './graphDrive.ts';

/** In SharePoint verbotene Zeichen und Formen — der Name wird bereinigt, nicht abgewiesen. */
const VERBOTEN = /["*:<>?\\|#%]/g;
/** Ein Segment (Ordner- oder Dateiname) höchstens so lang — der Gesamtpfad darf 400 Zeichen nicht überschreiten. */
const SEGMENT_MAX = 120;

export function sharepointName(segment: string): string {
  let s = segment.replace(VERBOTEN, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, ''); // führende und schließende Punkte/Leerzeichen sind nicht erlaubt
  if (/^(_vti_|~\$)/i.test(s) || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (s.length > SEGMENT_MAX) {
    const punkt = s.lastIndexOf('.');
    const endung = punkt > 0 && s.length - punkt <= 12 ? s.slice(punkt) : '';
    s = s.slice(0, SEGMENT_MAX - endung.length) + endung;
  }
  return s || '_';
}

/** Ein Speicherschlüssel (`ordner/unter/datei.pdf`) als bereinigter SharePoint-Pfad. */
export const sharepointPfad = (key: string) => key.split('/').filter(Boolean).map(sharepointName).join('/');

export interface SharepointSpeicherOptionen {
  /** Wurzelordner der App in der Bibliothek, z. B. „GG Immohandel“ */
  wurzel: string;
  /**
   * Ordnername je Bucket; Standard ist der Bucket-Name. Leer (`''`) heißt: kein eigener Ordner — der Schlüssel liegt
   * direkt unter der Wurzel. So landen Dokumente unter `<wurzel>/Objekte/…` statt `<wurzel>/dokumente/Objekte/…`.
   */
  ordner?: Partial<Record<Bucket, string>>;
}

/** Der Adapter samt Zugriff auf Item-Kennung, Link und Download-Adresse — die Datenbank merkt sich die Kennung. */
export interface SharepointAblage {
  speicher: Dateispeicher;
  item(bucket: Bucket, key: string): Promise<{ id: string; pfad: string; webUrl: string; eTag: string } | null>;
  downloadUrl(bucket: Bucket, key: string): Promise<string | null>;
  /** Item über die gemerkte Kennung — für den Abgleich; Pfad relativ zur Bibliothek */
  itemNachId(id: string): Promise<{ id: string; pfad: string; webUrl: string; eTag: string; downloadUrl?: string } | null>;
  /** Speicherschlüssel zu einem Bibliothekspfad — null, wenn die Datei außerhalb des Bucket-Ordners liegt */
  schluessel(bucket: Bucket, pfad: string): string | null;
}

export function sharepointSpeicher(drive: GraphDrive, opt: SharepointSpeicherOptionen): Dateispeicher {
  return sharepointAblage(drive, opt).speicher;
}

export function sharepointAblage(drive: GraphDrive, opt: SharepointSpeicherOptionen): SharepointAblage {
  const wurzel = sharepointPfad(opt.wurzel);
  const ordnerVon = (bucket: Bucket) => { const o = opt.ordner?.[bucket]; return o === undefined ? bucket : o; };
  const bucketPfad = (bucket: Bucket) => [wurzel, sharepointPfad(ordnerVon(bucket))].filter(Boolean).join('/');
  const pfad = (bucket: Bucket, key: string) => `${bucketPfad(bucket)}/${sharepointPfad(key)}`;
  const praefixPfad = (bucket: Bucket, praefix: string) => (praefix ? `${bucketPfad(bucket)}/${sharepointPfad(praefix)}` : bucketPfad(bucket));

  const speicher: Dateispeicher = {
    async ablegen(bucket, key, bytes, typ) {
      await drive.ablegen(pfad(bucket, key), bytes, typ);
    },
    async holen(bucket, key) {
      return drive.holen(pfad(bucket, key));
    },
    async verschieben(bucket, von, nach) {
      await drive.verschieben(pfad(bucket, von), pfad(bucket, nach));
    },
    async kopieren(bucket, von, zielBucket, nach) {
      await drive.kopieren(pfad(bucket, von), pfad(zielBucket, nach));
    },
    async loeschen(bucket, keys) {
      for (const key of keys) await drive.loeschen(pfad(bucket, key));
    },
    async uploadTicket(bucket, key) {
      const { uploadUrl } = await drive.uploadSession(pfad(bucket, key));
      return { url: uploadUrl, art: 'upload-session' };
    },
    async anfang(bucket, key, bytes) {
      const it = await drive.item(pfad(bucket, key));
      if (!it || it.ordner) throw new Error(`Speicher: ${bucket}/${key} nicht gefunden`);
      const teil = it.groesse === 0 ? new Uint8Array(0) : await drive.holen(pfad(bucket, key), { von: 0, bis: Math.min(bytes, it.groesse) - 1 });
      return { bytes: teil.subarray(0, bytes), groesse: it.groesse };
    },
    async auflisten(bucket, praefix = '') {
      const basis = `${bucketPfad(bucket)}/`;
      const dateien = await drive.dateienUnter(praefixPfad(bucket, praefix));
      const aus: SpeicherEintrag[] = dateien
        .filter((d) => d.pfad.startsWith(basis))
        .map((d) => ({ key: d.pfad.slice(basis.length), groesse: d.groesse, geaendert: d.geaendert, kennung: d.eTag }));
      return aus.sort((a, b) => a.key.localeCompare(b.key));
    },
  };

  return {
    speicher,
    async item(bucket, key) {
      const it = await drive.item(pfad(bucket, key));
      return it && !it.ordner ? { id: it.id, pfad: it.pfad, webUrl: it.webUrl, eTag: it.eTag } : null;
    },
    async downloadUrl(bucket, key) {
      const it = await drive.item(pfad(bucket, key));
      return it?.downloadUrl ?? null;
    },
    async itemNachId(id) {
      const it = await drive.itemNachId(id);
      return it && !it.ordner ? { id: it.id, pfad: it.pfad, webUrl: it.webUrl, eTag: it.eTag, downloadUrl: it.downloadUrl } : null;
    },
    schluessel(bucket, pfad) {
      const basis = `${bucketPfad(bucket)}/`;
      return pfad.startsWith(basis) ? pfad.slice(basis.length) : null;
    },
  };
}
