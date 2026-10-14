/**
 * Dokument (Protokoll 30, P1): das Exposé so, wie es ohne KI aus dem PDF gelesen wird — je Seite die Zeilen mit ihren
 * Zellen (aus den Textpositionen), Seitentyp und bei Bild-Seiten der OCR-Text. Das ist die Rohdaten-Grundlage: es wird
 * unverändert gespeichert; Angaben, Tabellen und Zuordnung werden daraus im Code abgeleitet und sind jederzeit neu
 * berechenbar.
 */
import { z } from 'zod';

export const DOKUMENT_VERSION = 'gg-dokument-v1' as const;

export const DokumentSeite = z.object({
  nr: z.number().int(),
  /** text = Textlayer; bild = kein Textlayer (Scan/Foto) → ggf. OCR; leer = nichts lesbar */
  typ: z.enum(['text', 'bild', 'leer']),
  /** Zeilen von oben nach unten, je Zeile die Zellen von links nach rechts (Abstand trennt Zellen) */
  zeilen: z.array(z.array(z.string())),
  /** Nur bei Bild-Seiten: OCR gelaufen und mittlere Sicherheit 0–100 */
  ocr: z.object({ sicherheit: z.number(), woerter: z.number().int() }).nullable(),
});
export type DokumentSeite = z.infer<typeof DokumentSeite>;

export const Dokument = z.object({
  version: z.literal(DOKUMENT_VERSION),
  seitenGesamt: z.number().int(),
  seiten: z.array(DokumentSeite),
});
export type Dokument = z.infer<typeof Dokument>;

/** Zeile als Text: Zellen mit zwei Leerzeichen — dasselbe Format wie der bisherige Textlayer (`pdfText`). */
export const zeileText = (zellen: string[]) => zellen.join('  ');

/** Seitentext einer Seite. */
export const seitenText = (s: DokumentSeite) => s.zeilen.map(zeileText).join('\n');

/** Ganzes Dokument mit Seitenmarkern — Eingabe für Teil A und Grundlage der Belegprüfung. */
export const dokumentText = (d: Dokument) => d.seiten.map((s) => `──────── Seite ${s.nr}\n${seitenText(s)}`).join('\n\n');

/** Zeichen ohne Leerraum — Maß, ob das Dokument Text trägt. */
export const dokumentZeichen = (d: Dokument) => dokumentText(d).replace(/\s/g, '').length;
