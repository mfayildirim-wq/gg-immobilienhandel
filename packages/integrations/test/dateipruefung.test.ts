/* Wörtlich aus gg-immohandel server/upload-guard.test.ts (ohne die Express/Multer-Tests). */
import { describe, expect, it } from 'vitest';
import { erkenneDateiart, pruefeDatei, pruefeDateien } from '../src/speicher/dateipruefung.ts';

// ── Testdaten: nur der Kopf zählt, der Rest ist Füllung ───────
const fuellung = Buffer.alloc(64, 0x41);
const mit = (kopf: number[] | string) =>
  Buffer.concat([typeof kopf === 'string' ? Buffer.from(kopf, 'latin1') : Buffer.from(kopf), fuellung]);

const PDF  = mit('%PDF-1.7\n');
const JPEG = mit([0xFF, 0xD8, 0xFF, 0xE0]);
const PNG  = mit([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ZIP  = mit([0x50, 0x4B, 0x03, 0x04]);
const OLE  = mit([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const TEXT = Buffer.from('Sehr geehrte Damen und Herren,\nanbei das Exposé.\n', 'utf8');
const BINAER = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xFF, 0xFE, 0x00, 0x03]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), fuellung]);
// Notepad speichert unter „Unicode" UTF-16LE mit BOM. Jedes zweite Byte ist eine
// Null — für jede Heuristik sieht das binär aus, für den Anwender ist es .txt.
const TEXT_UTF16 = Buffer.from('﻿Sehr geehrte Damen und Herren,\nanbei die Mieten.\n', 'utf16le');
const EML = Buffer.from('From: makler@example.com\r\nSubject: Exposé\r\n\r\nAnbei.\r\n', 'utf8');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MSG  = 'application/vnd.ms-outlook';
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), fuellung]);

describe('erkenneDateiart', () => {
  it('erkennt die Familien an der Signatur', () => {
    expect(erkenneDateiart(PDF)).toBe('pdf');
    expect(erkenneDateiart(JPEG)).toBe('jpeg');
    expect(erkenneDateiart(PNG)).toBe('png');
    expect(erkenneDateiart(ZIP)).toBe('zip');
    expect(erkenneDateiart(OLE)).toBe('ole');
    expect(erkenneDateiart(HEIC)).toBe('heic');
    expect(erkenneDateiart(WEBP)).toBe('webp');
    expect(erkenneDateiart(TEXT)).toBe('text');
    expect(erkenneDateiart(BINAER)).toBe('unbekannt');
    expect(erkenneDateiart(Buffer.alloc(0))).toBe('unbekannt');
  });
});

describe('pruefeDatei', () => {
  it('nimmt ein PDF an und liefert den Typ aus dem Inhalt', () => {
    const r = pruefeDatei({ name: 'expose.pdf', gemeldeterTyp: 'application/pdf', bytes: PDF });
    expect(r).toEqual({ ok: true, mime: 'application/pdf' });
  });

  // Der Kern des Fundes: der gemeldete Typ ist die Dateiendung, nicht der Inhalt.
  it('lehnt ein Archiv ab, das sich als PDF ausgibt', () => {
    const r = pruefeDatei({ name: 'expose.pdf', gemeldeterTyp: 'application/pdf', bytes: ZIP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('Archiv');
  });

  it('nennt den Widerspruch, wenn Ansage und Inhalt sich unterscheiden', () => {
    // .docx-Name mit PDF-Inhalt: erlaubte Dateiart, aber nicht die gemeldete.
    const r = pruefeDatei({
      name: 'vertrag.docx',
      gemeldeterTyp: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: PDF,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('Inhalt');
  });

  it('lehnt eine .zip auch dann ab, wenn der Browser octet-stream meldet', () => {
    const r = pruefeDatei({ name: 'unterlagen.zip', gemeldeterTyp: 'application/octet-stream', bytes: ZIP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('Archiv');
  });

  it('nimmt eine .docx an — derselbe ZIP-Container, aber als Office-Datei benannt', () => {
    const r = pruefeDatei({
      name: 'kaufvertrag.docx',
      gemeldeterTyp: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: ZIP,
    });
    expect(r).toEqual({
      ok: true,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('nimmt eine alte .xls an (OLE-Container)', () => {
    const r = pruefeDatei({ name: 'mieten.xls', gemeldeterTyp: 'application/vnd.ms-excel', bytes: OLE });
    expect(r).toEqual({ ok: true, mime: 'application/vnd.ms-excel' });
  });

  it('macht aus einem als octet-stream gemeldeten PDF ein PDF', () => {
    // Das iPad meldet für manche Dateien nichts Genaues. Vorher wurde
    // octet-stream gespeichert und die Datei später nicht mehr inline angezeigt.
    const r = pruefeDatei({ name: 'scan', gemeldeterTyp: 'application/octet-stream', bytes: PDF });
    expect(r).toEqual({ ok: true, mime: 'application/pdf' });
  });

  it('lässt eine Abweichung innerhalb der Bilder zu', () => {
    const r = pruefeDatei({ name: 'foto.jpg', gemeldeterTyp: 'image/jpeg', bytes: PNG });
    expect(r).toEqual({ ok: true, mime: 'image/png' });
  });

  it('lehnt nicht erlaubte gemeldete Typen ab, bevor die Signatur zählt', () => {
    const r = pruefeDatei({ name: 'seite.html', gemeldeterTyp: 'text/html', bytes: TEXT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('nicht erlaubt');
  });

  it('lehnt leere Dateien ab', () => {
    const r = pruefeDatei({ name: 'leer.pdf', gemeldeterTyp: 'application/pdf', bytes: Buffer.alloc(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('leer');
  });

  it('lehnt unbekannte Binärformate mit konkreter Ansage ab', () => {
    const r = pruefeDatei({ name: 'zeichnung.dwg', gemeldeterTyp: 'application/pdf', bytes: BINAER });
    expect(r.ok).toBe(false);
  });
});

// ── Alltagsfälle, die die Signaturprüfung anfangs mit abgeräumt hat ──
// Alle drei gingen auf `main` durch und kamen mit der Prüfung als 415 zurück.
describe('pruefeDatei — Name und Inhalt gehen auseinander', () => {
  it('nimmt eine .xls an, in der in Wahrheit eine XLSX steckt', () => {
    // Typischer Fremdsystem-Export bzw. „Speichern unter": der Browser meldet
    // nach der Endung ms-excel, der Inhalt ist der ZIP-Container von XLSX.
    const r = pruefeDatei({ name: 'mieten.xls', gemeldeterTyp: 'application/vnd.ms-excel', bytes: ZIP });
    expect(r).toEqual({ ok: true, mime: XLSX });
  });

  it('nimmt eine .doc an, in der in Wahrheit eine DOCX steckt', () => {
    const r = pruefeDatei({ name: 'vertrag.doc', gemeldeterTyp: 'application/msword', bytes: ZIP });
    expect(r).toEqual({ ok: true, mime: DOCX });
  });

  it('nimmt eine .xlsx an, in der eine alte XLS steckt', () => {
    // Die Kreuzkombination auch andersherum — der Inhalt bestimmt den Typ.
    const r = pruefeDatei({ name: 'mieten.xlsx', gemeldeterTyp: XLSX, bytes: OLE });
    expect(r).toEqual({ ok: true, mime: 'application/vnd.ms-excel' });
  });

  it('nimmt eine .msg aus Outlook an — auch beim Ziehen, wo `accept` nicht greift', () => {
    const r = pruefeDatei({ name: 'Angebot.msg', gemeldeterTyp: MSG, bytes: OLE });
    expect(r).toEqual({ ok: true, mime: MSG });
  });

  it('nimmt eine .msg auch dann an, wenn der Browser nichts Genaues meldet', () => {
    const r = pruefeDatei({ name: 'Angebot.msg', gemeldeterTyp: 'application/octet-stream', bytes: OLE });
    expect(r).toEqual({ ok: true, mime: MSG });
  });

  it('nimmt eine .eml an', () => {
    const r = pruefeDatei({ name: 'Angebot.eml', gemeldeterTyp: 'message/rfc822', bytes: EML });
    expect(r).toEqual({ ok: true, mime: 'message/rfc822' });
  });

  it('nimmt eine als UTF-16 gespeicherte .txt an', () => {
    // Der Inhalt bleibt an der Signatur unerkennbar — die Nullbytes des
    // UTF-16-Textes sehen aus wie eine Binärdatei …
    expect(erkenneDateiart(TEXT_UTF16)).toBe('unbekannt');
    // … die Ansage `text/plain` ist aber genauso wenig eine Behauptung über den
    // Inhalt wie `octet-stream`, und `.txt` steht im accept der Oberfläche.
    const r = pruefeDatei({ name: 'notizen.txt', gemeldeterTyp: 'text/plain', bytes: TEXT_UTF16 });
    expect(r).toEqual({ ok: true, mime: 'text/plain' });
  });

  // Der Zweck der Prüfung — er darf durch die Nachsicht oben nicht wegfallen.
  it('lehnt ein echtes Archiv weiterhin ab', () => {
    const mitEndung = pruefeDatei({ name: 'unterlagen.zip', gemeldeterTyp: 'application/octet-stream', bytes: ZIP });
    expect(mitEndung.ok).toBe(false);
    if (!mitEndung.ok) expect(mitEndung.grund).toContain('Archiv');

    const ohneEndung = pruefeDatei({ name: 'download', gemeldeterTyp: 'application/octet-stream', bytes: ZIP });
    expect(ohneEndung.ok).toBe(false);

    const alsPdf = pruefeDatei({ name: 'expose.pdf', gemeldeterTyp: 'application/pdf', bytes: ZIP });
    expect(alsPdf.ok).toBe(false);
  });
});

describe('pruefeDateien', () => {
  const gut = { name: 'a.pdf', gemeldeterTyp: 'application/pdf', bytes: PDF };
  const schlecht = { name: 'c.zip', gemeldeterTyp: 'application/octet-stream', bytes: ZIP };

  it('gibt den ganzen Stapel frei, wenn jede Datei durchkommt', () => {
    const r = pruefeDateien([gut, gut, gut]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dateien).toHaveLength(3);
  });

  // Genau der gemeldete Ablauf: fünf Dateien, die dritte ist ein Archiv.
  // Vorher hingen 1 und 2 danach am Deal.
  it('lehnt den ganzen Stapel ab, sobald eine Datei durchfällt', () => {
    const r = pruefeDateien([gut, gut, schlecht, gut, gut]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain('c.zip');
  });

  // Dieselbe Alles-oder-nichts-Regel schlägt zurück, wenn eine harmlose Datei
  // fälschlich durchfällt: eine gezogene .msg nahm den ganzen Stapel mit.
  it('lässt einen Stapel mit einer gezogenen .msg darin durch', () => {
    const r = pruefeDateien([
      gut,
      { name: 'Angebot.msg', gemeldeterTyp: MSG, bytes: OLE },
      { name: 'foto.jpg', gemeldeterTyp: 'image/jpeg', bytes: JPEG },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dateien).toHaveLength(3);
  });
});
