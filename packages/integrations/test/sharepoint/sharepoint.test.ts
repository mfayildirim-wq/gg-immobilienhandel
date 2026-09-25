import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appToken, BUCKETS, graphDrive, KLEIN_BIS, sharepointName, sharepointPfad, sharepointSpeicher, STUECK, type Dateispeicher, type GraphDrive } from '../../src/index.ts';
import { type GraphNachbau, graphNachbauStarten } from './graph-nachbau.ts';

describe('SharePoint-Namen', () => {
  it('bereinigt verbotene Zeichen, Punkte am Rand, reservierte Namen und Überlänge — Endung bleibt', () => {
    expect(sharepointName('Exposé: Musterstraße 1 <2024>?.pdf')).toBe('Exposé_ Musterstraße 1 _2024__.pdf');
    expect(sharepointName('..versteckt.')).toBe('versteckt');
    expect(sharepointName('CON')).toBe('_CON');
    expect(sharepointName('~$temp.docx')).toBe('_~$temp.docx');
    expect(sharepointName('')).toBe('_');
    const lang = sharepointName(`${'a'.repeat(200)}.pdf`);
    expect(lang.length).toBe(120);
    expect(lang.endsWith('.pdf')).toBe(true);
  });
  it('bereinigt jedes Segment eines Schlüssels, der Schrägstrich bleibt Trenner', () => {
    expect(sharepointPfad('_eingang/abc?/Datei:1.pdf')).toBe('_eingang/abc_/Datei_1.pdf');
    expect(sharepointPfad('//doppelt//')).toBe('doppelt');
  });
});

describe('SharePoint über den Graph-Nachbau', () => {
  let nachbau: GraphNachbau;
  let drive: GraphDrive;
  let speicher: Dateispeicher;

  beforeAll(async () => {
    nachbau = await graphNachbauStarten();
    const token = appToken({ tenantId: 'tenant', clientId: 'client', clientSecret: 'geheim' }, nachbau.loginBasis);
    drive = graphDrive(token, nachbau.siteId, nachbau.basis);
    speicher = sharepointSpeicher(drive, { wurzel: 'GG Immohandel' });
  });
  afterAll(() => nachbau.stop());

  it('App-Token: ein Aufruf, danach aus dem Cache; falsches Secret ist ein klarer Fehler', async () => {
    const vorher = nachbau.anfragen.filter((a) => a.includes('/token')).length;
    await drive.driveId(); await drive.driveId();
    expect(nachbau.anfragen.filter((a) => a.includes('/token')).length).toBe(vorher <= 1 ? 1 : vorher);
    const falsch = appToken({ tenantId: 'tenant', clientId: 'client', clientSecret: 'falsch' }, nachbau.loginBasis);
    await expect(falsch()).rejects.toThrow(/401.*falsches Secret/);
  });

  it('ablegen legt fehlende Ordner an; holen liest über die Download-Adresse; auflisten nennt Größe und eTag', async () => {
    await speicher.ablegen(BUCKETS.pdfs, 'deal-1.pdf', new TextEncoder().encode('%PDF-1.4 klein'), 'application/pdf');
    await speicher.ablegen(BUCKETS.dealDocs, 'deal-1/dok-1_Grundbuch: Auszug.pdf', new TextEncoder().encode('grundbuch'), 'application/pdf');
    expect(nachbau.eintraege.has('GG Immohandel/pdfs/deal-1.pdf')).toBe(true);
    expect(nachbau.eintraege.has('GG Immohandel/deal-docs/deal-1/dok-1_Grundbuch_ Auszug.pdf')).toBe(true);
    expect(new TextDecoder().decode(await speicher.holen(BUCKETS.pdfs, 'deal-1.pdf'))).toBe('%PDF-1.4 klein');
    const liste = await speicher.auflisten(BUCKETS.dealDocs);
    expect(liste).toEqual([expect.objectContaining({ key: 'deal-1/dok-1_Grundbuch_ Auszug.pdf', groesse: 9 })]);
    expect(liste[0]!.kennung).toMatch(/^"/);
    expect(await speicher.auflisten(BUCKETS.objPhotos)).toEqual([]); // Ordner gibt es noch nicht — leer, kein Fehler
  });

  it('anfang liest nur die ersten Bytes (Range) und kennt die Gesamtgröße', async () => {
    const a = await speicher.anfang(BUCKETS.pdfs, 'deal-1.pdf', 5);
    expect(new TextDecoder().decode(a.bytes)).toBe('%PDF-');
    expect(a.groesse).toBe(14);
    await expect(speicher.anfang(BUCKETS.pdfs, 'gibt-es-nicht.pdf', 5)).rejects.toThrow(/nicht gefunden/);
  });

  it('Upload-Ticket ist eine Upload-Session: der Browser schickt Stücke mit Content-Range, ohne Token', async () => {
    const ticket = await speicher.uploadTicket(BUCKETS.pdfs, '_eingang/11111111-2222-4333-8444-555555555555');
    expect(ticket.art).toBe('upload-session');
    const daten = new Uint8Array(3 * 1024 * 1024).fill(7);
    const stueck = 1024 * 1024;
    for (let von = 0; von < daten.byteLength; von += stueck) {
      const bis = Math.min(von + stueck, daten.byteLength);
      const r = await fetch(ticket.url, { method: 'PUT', body: daten.subarray(von, bis), headers: { 'content-range': `bytes ${von}-${bis - 1}/${daten.byteLength}` } });
      expect(r.status).toBe(bis < daten.byteLength ? 202 : 201);
    }
    const a = await speicher.anfang(BUCKETS.pdfs, '_eingang/11111111-2222-4333-8444-555555555555', 4);
    expect(a.groesse).toBe(daten.byteLength);
    expect([...a.bytes]).toEqual([7, 7, 7, 7]);
  });

  it('große Dateien legt der Server selbst in Stücken über eine Upload-Session ab', async () => {
    const gross = new Uint8Array(KLEIN_BIS + 1).fill(1);
    await speicher.ablegen(BUCKETS.dealDocs, 'deal-2/gross.bin', gross, 'application/octet-stream');
    expect(nachbau.eintraege.get('GG Immohandel/deal-docs/deal-2/gross.bin')?.bytes.byteLength).toBe(KLEIN_BIS + 1);
    expect(STUECK % (320 * 1024)).toBe(0);
  });

  it('verschieben (Eingang → Ziel), kopieren (202 + Nachfragen) und löschen — Löschen von Fehlendem ist kein Fehler', async () => {
    await speicher.verschieben(BUCKETS.pdfs, '_eingang/11111111-2222-4333-8444-555555555555', 'deal-9.pdf');
    expect(nachbau.eintraege.has('GG Immohandel/pdfs/deal-9.pdf')).toBe(true);
    expect(nachbau.eintraege.has('GG Immohandel/pdfs/_eingang/11111111-2222-4333-8444-555555555555')).toBe(false);
    await speicher.kopieren(BUCKETS.pdfs, 'deal-9.pdf', BUCKETS.archiv, 'pdfs/deal-9.pdf');
    expect(nachbau.eintraege.get('GG Immohandel/archive/pdfs/deal-9.pdf')?.bytes.byteLength).toBe(3 * 1024 * 1024);
    await speicher.loeschen(BUCKETS.pdfs, ['deal-9.pdf', 'gibt-es-nicht.pdf']);
    expect(nachbau.eintraege.has('GG Immohandel/pdfs/deal-9.pdf')).toBe(false);
  });

  it('auflisten blättert über mehrere Seiten und Unterordner', async () => {
    for (let i = 0; i < 5; i++) await speicher.ablegen(BUCKETS.objPhotos, `obj-1/foto-${i}.jpg`, new Uint8Array([i]), 'image/jpeg');
    await speicher.ablegen(BUCKETS.objPhotos, 'obj-2/unter/foto.jpg', new Uint8Array([9]), 'image/jpeg');
    const liste = await speicher.auflisten(BUCKETS.objPhotos);
    expect(liste.map((e) => e.key)).toEqual(['obj-1/foto-0.jpg', 'obj-1/foto-1.jpg', 'obj-1/foto-2.jpg', 'obj-1/foto-3.jpg', 'obj-1/foto-4.jpg', 'obj-2/unter/foto.jpg']);
    expect((await speicher.auflisten(BUCKETS.objPhotos, 'obj-2')).map((e) => e.key)).toEqual(['obj-2/unter/foto.jpg']);
  });

  it('Drosselung (429 mit Retry-After) wird wiederholt, ohne dass der Aufrufer es merkt', async () => {
    nachbau.drosselnEinmal('deal-1.pdf');
    const vorher = nachbau.anfragen.length;
    expect(new TextDecoder().decode(await speicher.holen(BUCKETS.pdfs, 'deal-1.pdf'))).toBe('%PDF-1.4 klein');
    expect(nachbau.anfragen.slice(vorher).filter((a) => a.includes('deal-1.pdf')).length).toBeGreaterThanOrEqual(2);
  });

  it('delta liefert Einträge samt Gelöschtem und einen Folge-Token', async () => {
    const d = await drive.delta();
    expect(d.eintraege.some((e) => e.pfad === 'GG Immohandel/pdfs/deal-1.pdf' && !e.geloescht)).toBe(true);
    expect(d.eintraege.some((e) => e.geloescht)).toBe(true);
    expect(d.token).toContain('token=');
  });
});
