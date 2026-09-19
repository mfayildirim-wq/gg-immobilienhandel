// Port von gg-immohandel server/finanzpraes-bilder.ts. Abweichung: der Foto-Port ist Pflicht (kein Storage-Import hier).
// ──────────────────────────────────────────────────────────────
// Foto-Verweise auflösen — serverseitig, aus dem Storage
// ──────────────────────────────────────────────────────────────
// Bis zum 05.08.2026 machte das der Browser: vor jedem Export lud er jedes Foto
// einzeln über GET /api/photos/:objId/:photoId herunter, wandelte es in eine
// base64-Data-URL und schickte das Ergebnis im Anfragekörper wieder an denselben
// Server zurück. Aus einer gespeicherten Präsentation von 6 407 Bytes wurden so
// 7 056 411 Bytes — Faktor 1000 — und damit ein
//
//   413 Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE
//
// weil eine Vercel-Function höchstens 4,5 MB entgegennimmt. Die Grenze lässt
// sich nicht anheben (vercel.com/docs/functions/limitations); sie gilt für
// Anfrage UND Antwort.
//
// Der Server hat die Bilder ohnehin: derselbe Prozess liest den Bucket
// `obj-photos` mit dem service_role-Schlüssel. Der Umweg über den Browser war
// reine Mechanik, keine Absicht — die Charta schreibt vor, dass Fotos als
// Verweise gespeichert und erst beim Export zu base64 werden, nicht WO das
// geschieht (wayfinder/research/002-workflow-charta.md:103-106).
//
// Warum die Auflösung überhaupt nötig ist: pptxgenjs kennt nur
// addImage({ data }), also eine Data-URL — die Bytes müssen eingebettet sein.
//
// ── Zwei Betriebsarten, und warum es nicht eine tut ───────────
//
// `loeseVerweiseAuf` macht Data-URLs. Das ist für PPTX richtig und war anfangs
// auch der PDF-Weg — bis sich zeigte, dass er nicht trägt: base64 wächst um ein
// Drittel, und der fertige HTML-String geht über die DevTools-Verbindung in den
// Renderer. Ab etwa 5 MB kommt er dort nicht mehr an, `networkidle0` wird nie
// erreicht, und nach 180 Sekunden endet der Export mit
//
//   Navigation timeout of 180000 ms exceeded
//
// Gemessen am 05.08.2026 gegen die Produktion: acht Fotos (3,74 MB) liefen in
// 14,3 Sekunden durch, zehn (5,36 MB) rissen zweimal das Zeitlimit. Eine
// angehobene Function-Groesse verschob die Schwelle, beseitigte sie nicht.
//
// `legeVerweiseAb` ist die Antwort darauf: die Fotos werden Dateien, der Verweis
// wird ihr Dateiname, und der Renderer laedt die HTML-Datei daneben per
// `file://`. Damit geht kein einziges base64-Byte mehr durch die Verbindung —
// Chromium liest die Bilder von der Platte, wie ein Browser das sonst auch tut.
// Die Fotoanzahl ist danach kein Faktor mehr.
//
// Beide Ausgaenge teilen sich Traversierung, Dedup und Signaturerkennung; nur
// der letzte Schritt unterscheidet sich.
// ──────────────────────────────────────────────────────────────

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Was dieses Modul von aussen braucht. Ein einziger Port — bewusst so schmal,
 *  damit der Test keine Storage-Attrappe bauen muss, sondern eine Map. */
export interface BilderPorts {
  /** Die Bytes eines Objektfotos, oder `null`, wenn es sie nicht (mehr) gibt. */
  holeFoto(objId: string, photoId: string): Promise<Buffer | null>;
}

/** Im Neubau Pflicht: die Ablage kommt vom Aufrufer (apps/api), nicht aus einem Modul-Import. */
export type BilderDeps = BilderPorts;

const VERWEIS_PRAEFIX = 'photo:';

/** Wie viele Fotos gleichzeitig gelesen werden. Nicht als Schutz des Storage
 *  gedacht, sondern des Speichers der Function: jedes Foto liegt als Buffer und
 *  danach nochmal als base64 im RAM, base64 wächst um ein Drittel. */
const GLEICHZEITIG = 6;

export function istFotoVerweis(wert: unknown): wert is string {
  return typeof wert === 'string' && wert.startsWith(VERWEIS_PRAEFIX);
}

/** `photo:<objId>/<photoId>` → seine beiden Teile. `null`, wenn die Form nicht
 *  stimmt — ein kaputter Verweis darf keinen Export abbrechen. */
export function zerlegeVerweis(verweis: string): { objId: string; photoId: string } | null {
  const rest = verweis.slice(VERWEIS_PRAEFIX.length);
  const teile = rest.split('/');
  if (teile.length !== 2 || !teile[0] || !teile[1]) return null;
  return { objId: teile[0], photoId: teile[1] };
}

/** Der Bildtyp aus den ersten Bytes, nicht aus der Dateiendung. Der Schlüssel
 *  im Bucket endet immer auf `.jpg` (server/storage.ts: photoKey), der Inhalt
 *  muss das nicht sein — hochgeladen wird, was der Browser komprimiert hat. */
export function mimeAusSignatur(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 6).startsWith('GIF8')) return 'image/gif';
  return 'image/jpeg';
}

/** Alle Verweise irgendwo in der Struktur, einmal je Wert.
 *  Bewusst feld-agnostisch: die bildtragenden Felder heissen je nach Slide-Typ
 *  `bilder`, `bildPath`, `bild`, `bild1`, `bild2` (src/lib/finanzpraesSlideData.ts),
 *  und `impressionen` bei der Kundenkalkulation. Eine Namensliste hier wäre eine
 *  zweite Wahrheit, die beim nächsten Slide-Typ still veraltet. */
export function sammleVerweise(wert: unknown, gefunden = new Set<string>()): Set<string> {
  if (istFotoVerweis(wert)) { gefunden.add(wert); return gefunden; }
  if (Array.isArray(wert)) {
    for (const eintrag of wert) sammleVerweise(eintrag, gefunden);
    return gefunden;
  }
  if (wert && typeof wert === 'object') {
    for (const eintrag of Object.values(wert as Record<string, unknown>)) sammleVerweise(eintrag, gefunden);
  }
  return gefunden;
}

/** Tiefe Kopie, in der jeder Verweis durch seine Data-URL ersetzt ist.
 *  Ein Verweis ohne Eintrag in der Karte wird zum Leerstring — genau das
 *  Verhalten, das der Client vorher hatte (src/lib/photoStorage.ts:
 *  applyPhotoRefMap). Ein gelöschtes Foto lässt eine leere Stelle, es bricht
 *  nicht den ganzen Export ab. */
function ersetze<T>(wert: T, karte: Map<string, string>): T {
  if (istFotoVerweis(wert)) return (karte.get(wert) ?? '') as unknown as T;
  if (Array.isArray(wert)) return wert.map((eintrag) => ersetze(eintrag, karte)) as unknown as T;
  if (wert && typeof wert === 'object') {
    const neu: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) neu[k] = ersetze(v, karte);
    return neu as unknown as T;
  }
  return wert;
}

/**
 * Ersetzt in einer Präsentation (oder jeder anderen Struktur) alle
 * `photo:`-Verweise durch eingebettete Data-URLs.
 *
 * Enthält die Struktur keinen Verweis, wird sie unverändert zurückgegeben —
 * dann entsteht auch keine Kopie.
 */
export async function loeseVerweiseAuf<T>(wert: T, deps: BilderDeps): Promise<T> {
  return await verarbeite(wert, deps, async (verweis, bytes, karte) => {
    karte.set(verweis, `data:${mimeAusSignatur(bytes)};base64,${bytes.toString('base64')}`);
  });
}

/** Der gemeinsame Teil beider Betriebsarten: einsammeln, stapelweise laden,
 *  ersetzen. Was mit den Bytes geschieht, entscheidet `verwerte`. */
async function verarbeite<T>(
  wert: T,
  deps: BilderDeps,
  verwerte: (verweis: string, bytes: Buffer, karte: Map<string, string>) => Promise<void>,
): Promise<T> {
  const verweise = [...sammleVerweise(wert)];
  if (verweise.length === 0) return wert;

  const ports = deps;
  const karte = new Map<string, string>();

  for (let i = 0; i < verweise.length; i += GLEICHZEITIG) {
    const stapel = verweise.slice(i, i + GLEICHZEITIG);
    await Promise.all(stapel.map(async (verweis) => {
      const teile = zerlegeVerweis(verweis);
      if (!teile) return;
      const bytes = await ports.holeFoto(teile.objId, teile.photoId);
      if (!bytes || bytes.length === 0) return;
      await verwerte(verweis, bytes, karte);
    }));
  }

  return ersetze(wert, karte);
}

// ── Betriebsart 2: Fotos als Dateien ──────────────────────────

/** Ein Verzeichnis mit den Fotos einer Präsentation, in dem auch die
 *  HTML-Datei landet. Die Struktur in `wert` verweist auf sie mit blossen
 *  Dateinamen — relativ, damit sie im `file://`-Dokument die Nachbardatei
 *  treffen. */
export interface Bildablage<T> {
  wert: T;
  verzeichnis: string;
  /** Verzeichnis samt Inhalt entfernen. Wirft nicht. */
  aufraeumen(): Promise<void>;
}

const ABLAGE_PRAEFIX = 'gg-pdf-';

/** Wie lange eine liegengebliebene Ablage geduldet wird, bevor der nächste Lauf
 *  sie mitnimmt. Grosszügig gegenüber der laengsten Function-Laufzeit (800 s). */
const ALTLAST_MS = 60 * 60 * 1000;

/** Die Dateiendung zum Bildtyp. `mimeAusSignatur` liefert nur bekannte Typen,
 *  der Rückfall trifft also nie — er steht da, damit es kein `undefined` gibt. */
function endungZuMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

/** Ablagen früherer Läufe entfernen, die älter als eine Stunde sind.
 *
 *  Nicht Vorsicht, sondern die Lehre aus dem Fehler, den dieses Modul behebt:
 *  reisst der Renderer sein Zeitlimit, stirbt die Function mitten im Lauf und
 *  `aufraeumen()` kommt nie dran. Online werden Instanzen wiederverwendet und
 *  teilen sich dasselbe /tmp — dort liegt ausserdem das entpackte Chromium.
 *  Ohne diesen Schritt waechst der Rest still, bis nichts mehr hineinpasst.
 *
 *  Fehler werden geschluckt: ein Aufraeumproblem darf keinen Export kosten. */
function raeumeAltlasten(basis: string): void {
  try {
    const grenze = Date.now() - ALTLAST_MS;
    for (const eintrag of fs.readdirSync(basis)) {
      if (!eintrag.startsWith(ABLAGE_PRAEFIX)) continue;
      const voll = path.join(basis, eintrag);
      try {
        if (fs.statSync(voll).mtimeMs < grenze) fs.rmSync(voll, { recursive: true, force: true });
      } catch { /* schon weg oder fremd — nicht unser Problem */ }
    }
  } catch { /* Basisverzeichnis nicht lesbar — dann eben nicht */ }
}

/**
 * Schreibt jedes referenzierte Foto als eigene Datei und ersetzt den Verweis
 * durch ihren Dateinamen.
 *
 * Der Aufrufer legt sein HTML in dasselbe Verzeichnis und lädt es per `file://`.
 * Er ist auch für `aufraeumen()` zuständig — und zwar **erst, wenn der Druck
 * durch ist**: der Renderer gibt einen Strom zurück, Chromium liest die Bilder
 * unter Umständen noch.
 *
 * Enthält die Struktur keinen Verweis, entsteht trotzdem ein Verzeichnis — das
 * HTML muss ja irgendwo liegen.
 */
export async function legeVerweiseAb<T>(wert: T, deps: BilderDeps): Promise<Bildablage<T>> {
  const basis = os.tmpdir();
  raeumeAltlasten(basis);

  const verzeichnis = path.join(basis, ABLAGE_PRAEFIX + randomUUID());
  fs.mkdirSync(verzeichnis, { recursive: true });

  let lfd = 0;
  const neu = await verarbeite(wert, deps, async (verweis, bytes, karte) => {
    const name = `b${lfd++}.${endungZuMime(mimeAusSignatur(bytes))}`;
    await fs.promises.writeFile(path.join(verzeichnis, name), bytes);
    karte.set(verweis, name);
  });

  return {
    wert: neu,
    verzeichnis,
    aufraeumen: async () => {
      try {
        await fs.promises.rm(verzeichnis, { recursive: true, force: true });
      } catch { /* siehe raeumeAltlasten */ }
    },
  };
}
