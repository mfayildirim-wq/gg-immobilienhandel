/**
 * Testseiten für den Auto-Import: ein kleiner HTTP-Server mit den Seitenformen, an denen die Engine gewachsen ist.
 * Jede Form ist ein Pfad; die Zustände (AGB bestätigt?) hängen am Cookie — wie bei echten Portalen.
 */
import { createServer, type Server } from 'node:http';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function testPdf(titel: string, seiten = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const schrift = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < seiten; i++) {
    const s = doc.addPage([595, 842]);
    s.drawText(`${titel} — Seite ${i + 1}`, { x: 50, y: 780, size: 18, font: schrift });
    // genug Inhalt, damit die Datei über der 1-KB-Schwelle der Engine liegt
    for (let z = 0; z < 40; z++) s.drawText(`Zeile ${z}: Mehrfamilienhaus, Kaufpreis, Wohnflaeche, Baujahr, Einheiten`, { x: 50, y: 740 - z * 16, size: 9, font: schrift });
  }
  return doc.save();
}

const html = (titel: string, koerper: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${titel}</title></head><body>${koerper}</body></html>`;
const EXPOSE_TEXT = '<h1>Mehrfamilienhaus Musterstraße 12</h1><p>Kaufpreis 1.250.000 € · Wohnfläche 480 m² · Baujahr 1978 · 6 Einheiten · Kaltmiete 5.400 €</p>';

export interface Testseiten { basis: string; aufrufe: string[]; stop(): Promise<void> }

export async function testseitenStarten(): Promise<Testseiten> {
  const voll = await testPdf('Expose vollstaendig', 5);
  const vorschau = await testPdf('Expose vorschau', 1);
  const agb = await testPdf('AGB Widerruf', 2);
  const aufrufe: string[] = [];
  const pdfAntwort = (res: import('node:http').ServerResponse, bytes: Uint8Array, name: string, alsAnhang: boolean) => {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': bytes.byteLength, ...(alsAnhang ? { 'content-disposition': `attachment; filename="${name}"` } : {}) });
    res.end(Buffer.from(bytes));
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const bestaetigt = /agb=ja/.test(req.headers.cookie ?? '');
    aufrufe.push(`${req.method} ${url.pathname}`);
    const seite = (titel: string, k: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html(titel, k)); };

    switch (url.pathname) {
      // ── Dateien ──
      case '/dateien/expose-vollstaendig.pdf': return pdfAntwort(res, voll, 'Expose-OBJ-4711.pdf', url.searchParams.has('anhang'));
      case '/dateien/expose-vorschau.pdf': return pdfAntwort(res, vorschau, 'vorschau.pdf', url.searchParams.has('anhang'));
      case '/dateien/agb.pdf': return pdfAntwort(res, agb, 'AGB.pdf', true);
      case '/direkt/expose-vollstaendig.pdf': return pdfAntwort(res, voll, 'x.pdf', false);

      // ── AGB-Formular vor dem Exposé ──
      case '/portal/expose': {
        if (!bestaetigt) return seite('Provisionsbestätigung', `<h1>Bitte bestätigen</h1><form method="post" action="/portal/bestaetigen">
          <label><input type="checkbox" name="agb"> Ich akzeptiere die AGB</label>
          <label><input type="checkbox" name="prov"> Ich bestätige die Provisionsvereinbarung</label>
          <a href="/dateien/agb.pdf">Widerrufsbelehrung herunterladen</a>
          <button type="submit">Bestätigen und zum Exposé</button></form>`);
        return seite('Exposé', `${EXPOSE_TEXT}<a href="/dateien/agb.pdf?x">AGB herunterladen</a> <a href="/dateien/expose-vollstaendig.pdf?anhang">Exposé herunterladen</a>`);
      }
      case '/portal/bestaetigen': res.writeHead(303, { location: '/portal/expose', 'set-cookie': 'agb=ja; Path=/' }); return res.end();

      // ── Cookie-Banner + AGB im Modal über der Exposé-Seite ──
      case '/modal/expose': {
        const banner = '<div id="cookie-consent" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#eee"><p>Wir verwenden Cookies</p><button onclick="this.parentElement.remove()">Alle akzeptieren</button></div>';
        if (!bestaetigt) return seite('Exposé', `${EXPOSE_TEXT}${banner}<div role="dialog" aria-modal="true" style="position:fixed;top:10%;left:10%;width:80%;height:70%;background:#fff;border:1px solid #000">
          <p>Provisionsvereinbarung: Vor dem Öffnen des vollständigen Exposés bestätigen Sie bitte.</p>
          <label><input type="checkbox"> Einverstanden</label>
          <button onclick="document.cookie='agb=ja; path=/'; location.reload()">Exposé freischalten</button></div>`);
        return seite('Exposé', `${EXPOSE_TEXT}${banner}<a href="/dateien/expose-vollstaendig.pdf?anhang">Exposé herunterladen</a>`);
      }

      // ── Dokumentliste: die Einträge sind keine PDF-Links, sondern klickbare Zeilen ──
      case '/liste': return seite('Objektunterlagen', `${EXPOSE_TEXT}<ul>
          <li class="document" onclick="location.href='/dateien/agb.pdf'">Widerrufsbelehrung</li>
          <li class="document" onclick="location.href='/dateien/expose-vollstaendig.pdf?anhang'">Exposé komplett</li>
          <li class="document" onclick="location.href='/dateien/expose-vorschau.pdf?anhang'">Grundriss</li></ul>`);

      // ── Exposé öffnet sich im neuen Tab (Browser-Viewer) ──
      case '/neuer-tab': return seite('Exposé', `${EXPOSE_TEXT}<a href="/direkt/expose-vollstaendig.pdf" target="_blank">Exposé herunterladen</a>`);

      // ── Nur Vorschau, vollständiges Exposé nicht erreichbar ──
      case '/nur-vorschau': return seite('Exposé', `${EXPOSE_TEXT}<a href="/dateien/expose-vorschau.pdf?anhang">Exposé herunterladen</a>`);

      // ── Abgelaufener Link ──
      case '/abgelaufen': return seite('Fehler', '<p>Dieser Link ist leider nicht mehr gültig.</p>');

      // ── Weiterleitung ins interne Netz ──
      case '/weiter-intern': res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end();

      // ── Hängende Seite ──
      case '/haengt': return; // antwortet nie
      default: res.writeHead(404, { 'content-type': 'text/html' }); return res.end(html('404', '<p>Seite nicht gefunden</p>'));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { basis: `http://127.0.0.1:${port}`, aufrufe, stop: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}

/**
 * KI-Attrappe: beantwortet die vier Fragen der Engine nach festen Regeln — am Dateinamen bzw. an der Signatur, die
 * die Engine in die Frage schreibt. Zählt mit, damit Tests prüfen können, dass KEINE KI gefragt wurde, wo keine nötig ist.
 */
export function kiAttrappeAutoImport() {
  const fragen: string[] = [];
  return {
    fragen,
    async nachricht(body: any) {
      const werkzeug = body.tool_choice?.name as string;
      fragen.push(werkzeug);
      const text = JSON.stringify(body.messages);
      const antwort = (input: unknown) => ({ content: [{ type: 'tool_use', input }] });
      if (werkzeug === 'classify') {
        if (/agb|widerruf/i.test(text.match(/Dateiname: ([^\\\n]*)/)?.[1] ?? '')) return antwort({ type: 'agb', confidence: 0.95, completeness: 'unklar', missingFields: [], extractedAddress: '', reason: 'Rechtsdokument' });
        if (/vorschau|grundriss/i.test(text.match(/Dateiname: ([^\\\n]*)/)?.[1] ?? '')) return antwort({ type: 'expose', confidence: 0.8, completeness: 'eingeschraenkt', missingFields: ['adresse', 'fotos'], extractedAddress: '', reason: 'Teaser' });
        if (/landing-print/.test(text)) return antwort({ type: 'expose', confidence: 0.7, completeness: 'eingeschraenkt', missingFields: ['adresse'], extractedAddress: '', reason: 'gedruckte Seite' });
        return antwort({ type: 'expose', confidence: 0.92, completeness: 'vollstaendig', missingFields: [], extractedAddress: 'Musterstraße 12, 70178 Stuttgart', reason: 'vollständig' });
      }
      if (werkzeug === 'classify_page') return antwort({ type: 'agb-form' });
      if (werkzeug === 'rank') return antwort({ orderedIndices: [] });
      if (werkzeug === 'pick_link') return antwort({ selectedIndex: 0, reason: 'Attrappe' });
      // Mailtext-Auswertung (extractExposeFromText)
      return antwort({ objekt: { strasse: 'Musterstraße', hausnr: '12', plz: '70178', stadt: 'Stuttgart', angebotspreis: 1250000, wohnflaeche: 480, einheitenAnz: 6, baujahr: 1978 }, makler: { name: 'Erika Beispiel' } });
    },
    async dateiHochladen() { return 'datei-attrappe'; },
    async dateiLoeschen() { /* nichts */ },
  };
}
