/**
 * Prüfung hochgeladener Dokumente: Allowlist UND Signatur (erste Bytes) statt des vom Browser gemeldeten Typs.
 * Wörtlich aus gg-immohandel server/upload-guard.ts (ohne Express/Multer-Teile); `path.extname` durch `endungVon` ersetzt, zwei `!` für noUncheckedIndexedAccess.
 */

const MB = 1024 * 1024;
/** Obergrenzen der Dokumentablage je Deal wie alt (DOC_GRENZEN): 200 MB je Datei, 20 Dateien je Upload. */
export const DOKUMENT_GRENZEN = { maxBytes: 200 * MB, maxDateien: 20 } as const;

/** Endung wie path.extname: ab dem letzten Punkt, nicht bei führendem Punkt. */
function endungVon(name: string): string {
  const basis = name.split(/[\\/]/).pop() ?? '';
  const i = basis.lastIndexOf('.');
  return i > 0 ? basis.slice(i) : '';
}

export const ERLAUBTE_DOKUMENT_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  // Eine Mail als Beleg gehört zum Alltag: Outlook-Mails landen per Drag & Drop
  // im Upload, und dabei greift das `accept`-Attribut der Oberfläche nicht.
  // Ohne die beiden Typen fiel der GANZE Stapel durch (alles oder nichts).
  'application/vnd.ms-outlook',
  'message/rfc822',
  'application/octet-stream',
]);

// ── Signatur-Erkennung ────────────────────────────────────────

/** Grobe Familie, die sich an den ersten Bytes ablesen lässt. `zip` und `ole`
 *  sind Container: aus ihnen allein folgt noch nicht, ob eine Word-Datei oder
 *  ein Archiv darin steckt — das entscheidet erst `mimeAusArt()`. */
export type Dateiart =
  | 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp' | 'heic'
  | 'zip' | 'ole' | 'text' | 'unbekannt';

function hatBytes(b: Buffer, bytes: number[], offset = 0): boolean {
  if (b.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (b[offset + i] !== bytes[i]) return false;
  return true;
}

function hatText(b: Buffer, text: string, offset = 0): boolean {
  if (b.length < offset + text.length) return false;
  return b.toString('latin1', offset, offset + text.length) === text;
}

/** Marken (Brands) der ISO-BMFF-Kiste, die für HEIC/HEIF stehen. */
const HEIF_MARKEN = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Sieht der Anfang wie Text aus? Nullbytes kommen in Text nie vor, und ein
 *  hoher Anteil an Steuerzeichen spricht für eine Binärdatei. */
function siehtNachTextAus(b: Buffer): boolean {
  const probe = b.subarray(0, 4096);
  if (probe.length === 0) return false;
  let steuer = 0;
  for (const byte of probe) {
    if (byte === 0) return false;
    // Erlaubt: Tab, LF, CR, FF, ESC — alles andere unter 0x20 ist verdächtig.
    if (byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12 && byte !== 27) steuer++;
  }
  return steuer / probe.length < 0.05;
}

export function erkenneDateiart(bytes: Buffer): Dateiart {
  if (!bytes || bytes.length === 0) return 'unbekannt';
  // `%PDF-` steht laut Norm am Anfang. In freier Wildbahn schieben Erzeuger
  // gelegentlich Leerzeilen davor, und jeder Betrachter akzeptiert das —
  // ein zu strenger Test hier hieße: gültiges Exposé, 415, kein Ausweg.
  const kopf = bytes.subarray(0, 1024).toString('latin1');
  if (kopf.includes('%PDF-')) return 'pdf';
  if (hatBytes(bytes, [0xFF, 0xD8, 0xFF])) return 'jpeg';
  if (hatBytes(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
  if (hatText(bytes, 'GIF87a') || hatText(bytes, 'GIF89a')) return 'gif';
  if (hatText(bytes, 'RIFF') && hatText(bytes, 'WEBP', 8)) return 'webp';
  if (hatText(bytes, 'ftyp', 4) && HEIF_MARKEN.has(bytes.toString('latin1', 8, 12))) return 'heic';
  // PK\x03\x04 (normal), PK\x05\x06 (leer), PK\x07\x08 (mehrteilig)
  if (hatBytes(bytes, [0x50, 0x4B]) && [0x03, 0x05, 0x07].includes(bytes[2]!)) return 'zip';
  if (hatBytes(bytes, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) return 'ole';
  if (siehtNachTextAus(bytes)) return 'text';
  return 'unbekannt';
}

const BILD_MIMES: Partial<Record<Dateiart, string>> = {
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
};

/** Word, Excel oder PowerPoint — die Frage, die Endung und gemeldeter Typ
 *  zuverlässig beantworten. Welche der beiden Fassungen daraus wird (neu = ZIP,
 *  alt = OLE), beantwortet nur die Signatur. */
type OfficeFamilie = 'word' | 'excel' | 'ppt';

/** Endung → Familie. Bewusst OHNE Fassung: `mieten.xls` mit XLSX-Inhalt ist der
 *  Normalfall, sobald ein Fremdsystem exportiert oder jemand „Speichern unter"
 *  benutzt hat, und `vertrag.doc` mit DOCX-Inhalt ebenso. Wer die Endung als
 *  Aussage über die Fassung liest, weist beides ab — auf `main` gingen sie durch. */
const FAMILIE_NACH_ENDUNG: Record<string, OfficeFamilie> = {
  '.docx': 'word',  '.doc': 'word',
  '.xlsx': 'excel', '.xls': 'excel',
  '.pptx': 'ppt',   '.ppt': 'ppt',
};
const OOXML_NACH_FAMILIE: Record<OfficeFamilie, string> = {
  word:  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const OLE_NACH_FAMILIE: Record<OfficeFamilie, string> = {
  word:  'application/msword',
  excel: 'application/vnd.ms-excel',
  ppt:   'application/vnd.ms-powerpoint',
};
const FAMILIE_NACH_MIME: Record<string, OfficeFamilie> = Object.fromEntries([
  ...Object.entries(OOXML_NACH_FAMILIE).map(([f, m]) => [m, f as OfficeFamilie]),
  ...Object.entries(OLE_NACH_FAMILIE).map(([f, m]) => [m, f as OfficeFamilie]),
]);

/** Outlook-Mail (OLE-Container) bzw. Mail als Text. */
const MSG_MIME = 'application/vnd.ms-outlook';
const EML_MIME = 'message/rfc822';

/** Zu welcher Office-Familie gehört das? `undefined` = zu keiner — dann bleibt es
 *  bei einem Archiv bzw. einem unbrauchbaren OLE-Container. */
function officeFamilie(endung: string, gemeldet: string): OfficeFamilie | undefined {
  return FAMILIE_NACH_MIME[gemeldet] || FAMILIE_NACH_ENDUNG[endung];
}

/** Der Typ, unter dem die Datei gespeichert wird — aus der Signatur, nicht aus
 *  dem, was der Browser behauptet. `null` = die Art ist nicht erlaubt. */
function mimeAusArt(art: Dateiart, name: string, gemeldet: string): string | null {
  if (art === 'pdf') return 'application/pdf';
  if (BILD_MIMES[art]) return BILD_MIMES[art]!;
  const endung = endungVon(name || '');
  if (art === 'zip') {
    // Ohne erkennbare Familie bleibt der ZIP-Container ein Archiv — genau das
    // soll die Prüfung abweisen, daran ändert die Nachsicht oben nichts.
    const familie = officeFamilie(endung, gemeldet);
    return familie ? OOXML_NACH_FAMILIE[familie] : null;
  }
  if (art === 'ole') {
    if (gemeldet === MSG_MIME || endung === '.msg') return MSG_MIME;
    const familie = officeFamilie(endung, gemeldet);
    return familie ? OLE_NACH_FAMILIE[familie] : null;
  }
  if (art === 'text') {
    if (gemeldet === EML_MIME || (endung === '.eml' && gemeldet === 'application/octet-stream')) return EML_MIME;
    return gemeldet === 'text/plain' || gemeldet === 'application/octet-stream' ? 'text/plain' : null;
  }
  // Unbekannte Binärdatei: nur durchlassen, wenn der Browser nichts über den
  // Inhalt behauptet hat. `text/plain` ist genau das — die Ansage stammt aus der
  // Endung `.txt`, nicht aus dem Inhalt. Sie muss deshalb wie `octet-stream`
  // zählen, sonst fällt jede als UTF-16 („Unicode" in Notepad) gespeicherte
  // Textdatei durch: ihre Nullbytes sind für siehtNachTextAus() nicht von einer
  // Binärdatei zu unterscheiden.
  if (gemeldet === 'text/plain') return 'text/plain';
  return gemeldet === 'application/octet-stream' ? 'application/octet-stream' : null;
}

/** Dieselbe Office-Familie in der jeweils anderen Fassung? Dann ist die
 *  Abweichung folgenlos wie die zwischen zwei Bildformaten: der Inhalt bleibt
 *  eine Excel-Tabelle, nur eben die neue statt der alten. */
function gleicheOfficeFamilie(echt: string, gemeldet: string): boolean {
  const a = FAMILIE_NACH_MIME[echt];
  return !!a && a === FAMILIE_NACH_MIME[gemeldet];
}

export interface RohDatei {
  name: string;
  /** Was der Browser gemeldet hat (`file.mimetype`). */
  gemeldeterTyp: string;
  bytes: Buffer;
}

// Die Felder der jeweils anderen Seite stehen als `?: undefined` mit drin: das
// Projekt übersetzt mit `strict: false`, und ohne strictNullChecks verengt
// TypeScript eine Union nicht am booleschen Unterscheidungsfeld (dasselbe
// Muster wie CallbackUriResult in server/oauth-redirect.ts).
export type PruefErgebnis =
  | { ok: true; mime: string; grund?: undefined }
  | { ok: false; mime?: undefined; grund: string };

function normalisiere(mime: string): string {
  return (mime || 'application/octet-stream').toLowerCase().split(';')[0]!.trim();
}

const ART_KLARTEXT: Record<Dateiart, string> = {
  pdf: 'PDF', jpeg: 'JPEG-Bild', png: 'PNG-Bild', gif: 'GIF-Bild', webp: 'WebP-Bild',
  heic: 'HEIC-Bild', zip: 'gepacktes Archiv', ole: 'altes Office-Dokument',
  text: 'Textdatei', unbekannt: 'unbekanntes Format',
};

/** Eine Datei gegen Allowlist UND Signatur prüfen. Erfolg liefert den Typ, unter
 *  dem gespeichert werden soll — er kommt aus dem Inhalt, damit ein als
 *  `application/octet-stream` gemeldetes PDF später auch als PDF angezeigt wird. */
export function pruefeDatei(datei: RohDatei): PruefErgebnis {
  const name = datei.name || 'unbenannt';
  if (!datei.bytes || datei.bytes.length === 0) {
    return { ok: false, grund: `„${name}" ist leer (0 Bytes).` };
  }
  const gemeldet = normalisiere(datei.gemeldeterTyp);
  if (!ERLAUBTE_DOKUMENT_MIMES.has(gemeldet)) {
    return { ok: false, grund: `Dateityp nicht erlaubt: ${gemeldet} („${name}").` };
  }
  const art = erkenneDateiart(datei.bytes);
  const echt = mimeAusArt(art, name, gemeldet);
  if (!echt) {
    return { ok: false, grund: `„${name}" ist ein ${ART_KLARTEXT[art]} — diese Dateiart wird nicht angenommen.` };
  }
  // Inhalt und Ansage müssen zusammenpassen. Innerhalb der Bilder ist die
  // Abweichung folgenlos (ein PNG mit .jpg-Endung bleibt ein Bild), zwischen
  // den Familien nicht: ein Archiv, das sich als PDF ausgibt, ist keins.
  const passt = echt === gemeldet
    || gemeldet === 'application/octet-stream'
    || (echt.startsWith('image/') && gemeldet.startsWith('image/'))
    || gleicheOfficeFamilie(echt, gemeldet);
  if (!passt) {
    return { ok: false, grund: `„${name}" wurde als ${gemeldet} gemeldet, der Inhalt ist aber ein ${ART_KLARTEXT[art]}.` };
  }
  return { ok: true, mime: echt };
}

export type StapelErgebnis =
  | { ok: true; dateien: Array<{ mime: string }>; grund?: undefined }
  | { ok: false; dateien?: undefined; grund: string };

/** Den ganzen Stapel vorab prüfen. Erst wenn jede Datei durchkommt, darf
 *  geschrieben werden — sonst hängen beim Abbruch schon Dokumente am Deal. */
export function pruefeDateien(dateien: RohDatei[]): StapelErgebnis {
  const geprueft: Array<{ mime: string }> = [];
  for (const datei of dateien) {
    const ergebnis = pruefeDatei(datei);
    if (!ergebnis.ok) return { ok: false, grund: ergebnis.grund };
    geprueft.push({ mime: ergebnis.mime });
  }
  return { ok: true, dateien: geprueft };
}

