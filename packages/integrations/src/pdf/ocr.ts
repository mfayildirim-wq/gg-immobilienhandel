// OCR mit Tesseract (WebAssembly, deutsch) für Bild-Seiten (Protokoll 30, P1). Ein Worker je Analyse, danach beendet.
// Nur Wörter mit Sicherheit ≥ 60 zählen; Zeilen aus den Blöcken, Zellen per Abstand wie beim Textlayer.
//
// Betrieb (Protokoll 31, B1/B6): tesseract.js startet einen Worker-Thread aus einer Datei. Im Vercel-Bündel zeigt der
// Standardpfad ins Leere, und Node meldet eine fehlende Worker-Datei nicht als Ausnahme, sondern beendet den Prozess.
// Deshalb: Pfad vorher prüfen — fehlt er, läuft die Analyse ohne OCR weiter (Bild-Seiten bleiben ohne Text, Teil A
// geht wie bisher den PDF-Weg). Sprachdaten kommen aus einem mitgelieferten Ordner (`langPath`, keine Netzlast,
// kein Schreiben); ohne Angabe lädt tesseract.js sie vom CDN und legt sie unter `cachePath` ab (online: /tmp).
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ocr, OcrErgebnis } from './dokument.ts';

const MIN_SICHERHEIT = 60;
const SPRACHE = 'deu';

export interface OcrOptionen {
  /** Worker-Skript von tesseract.js. Ohne Angabe das Skript aus node_modules (lokal); im Vercel-Bündel `dist/ocr-worker.cjs`. */
  workerPath?: string;
  /** Ordner mit `deu.traineddata.gz`. Ohne Angabe lädt tesseract.js vom CDN (jsdelivr). */
  langPath?: string;
  /** Ablage der vom CDN geladenen Sprachdaten (nur ohne `langPath`); Standard: Temp-Ordner des Systems. */
  cachePath?: string;
}

export interface Texterkennung {
  /** `undefined`, wenn OCR nicht einsatzbereit ist — `grund` sagt warum. */
  ocr: Ocr | undefined;
  grund?: string;
  beenden: () => Promise<void>;
}

/** Erzeugt eine OCR-Funktion und eine Aufräumfunktion. Sprache wird beim ersten Aufruf geladen. */
export function tesseractOcr(o: OcrOptionen = {}): Texterkennung {
  if (o.workerPath && !existsSync(o.workerPath)) {
    return { ocr: undefined, grund: `OCR-Worker fehlt: ${o.workerPath}`, beenden: async () => {} };
  }
  let langPath = o.langPath;
  if (langPath && !existsSync(join(langPath, `${SPRACHE}.traineddata.gz`))) {
    console.warn(`[ocr] Sprachdaten fehlen unter ${langPath} — lade vom CDN`);
    langPath = undefined;
  }
  const optionen = {
    ...(o.workerPath ? { workerPath: o.workerPath } : {}),
    ...(langPath ? { langPath, cacheMethod: 'none' as const } : { cachePath: o.cachePath ?? tmpdir() }),
    gzip: true,
  };
  // Stürzt der Worker-Thread ab (fehlendes Core, Speicher), meldet Node das als `error`-Ereignis am Worker — ohne Zuhörer
  // endet der Prozess. tesseract.js gibt den Worker erst nach dem Laden heraus; Node meldet aber jeden neuen Thread über
  // `process.on('worker')`, dort hängen wir uns an. Ein Absturz lässt den laufenden Aufruf scheitern statt die Function.
  let absturz: ((e: unknown) => void) | undefined;
  const abgestuerzt = new Promise<never>((_, reject) => { absturz = reject; });
  abgestuerzt.catch(() => {});
  let worker: Promise<any> | undefined;
  const holen = () => (worker ??= (async () => {
    const t = await import('tesseract.js');
    const beiThread = (w: any) => w.on?.('error', (e: unknown) => { console.warn('[ocr] Worker-Thread abgestürzt:', e instanceof Error ? e.message : e); absturz?.(e); });
    process.on('worker', beiThread);
    try {
      // errorHandler: ohne ihn wirft tesseract.js bei einem abgelehnten Auftrag im Nachrichten-Handler — unbehandelt
      return await Promise.race([t.createWorker(SPRACHE, 1, { ...optionen, errorHandler: () => {} }), abgestuerzt]);
    } finally {
      process.off('worker', beiThread);
    }
  })());
  const ocr: Ocr = async (png) => {
    const w = await holen();
    const { data } = await Promise.race([w.recognize(Buffer.from(png), {}, { blocks: true }), abgestuerzt]);
    const zeilen: string[][] = [];
    const sicherheiten: number[] = [];
    for (const block of data.blocks ?? []) {
      for (const absatz of block.paragraphs ?? []) {
        for (const zeile of absatz.lines ?? []) {
          const woerter = (zeile.words ?? []).filter((x: any) => x.confidence >= MIN_SICHERHEIT && x.text.trim());
          if (!woerter.length) continue;
          sicherheiten.push(...woerter.map((x: any) => x.confidence));
          const zellen: string[] = [];
          let zelle = '';
          let ende = -Infinity;
          for (const x of woerter) {
            const hoehe = x.bbox.y1 - x.bbox.y0;
            if (zelle && x.bbox.x0 - ende > 1.5 * hoehe) { zellen.push(zelle); zelle = ''; }
            zelle += (zelle ? ' ' : '') + x.text;
            ende = x.bbox.x1;
          }
          if (zelle) zellen.push(zelle);
          zeilen.push(zellen);
        }
      }
    }
    const e: OcrErgebnis = { zeilen, woerter: sicherheiten.length, sicherheit: sicherheiten.length ? sicherheiten.reduce((a, b) => a + b, 0) / sicherheiten.length : 0 };
    return e;
  };
  return {
    ocr,
    beenden: async () => {
      if (!worker) return;
      try { await (await worker).terminate(); } catch { /* Worker kam nie hoch — nichts zu beenden */ }
    },
  };
}
