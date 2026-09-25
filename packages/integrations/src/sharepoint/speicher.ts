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
}

export function sharepointSpeicher(drive: GraphDrive, opt: SharepointSpeicherOptionen): Dateispeicher {
  const wurzel = sharepointPfad(opt.wurzel);
  const pfad = (bucket: Bucket, key: string) => `${wurzel}/${bucket}/${sharepointPfad(key)}`;
  const praefixPfad = (bucket: Bucket, praefix: string) => (praefix ? `${wurzel}/${bucket}/${sharepointPfad(praefix)}` : `${wurzel}/${bucket}`);

  return {
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
      const basis = `${wurzel}/${bucket}/`;
      const dateien = await drive.dateienUnter(praefixPfad(bucket, praefix));
      const aus: SpeicherEintrag[] = dateien
        .filter((d) => d.pfad.startsWith(basis))
        .map((d) => ({ key: d.pfad.slice(basis.length), groesse: d.groesse, geaendert: d.geaendert, kennung: d.eTag }));
      return aus.sort((a, b) => a.key.localeCompare(b.key));
    },
  };
}
