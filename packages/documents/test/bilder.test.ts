// Port von gg-immohandel server/finanzpraes-bilder.test.ts
// ── Foto-Verweise serverseitig auflösen ───────────────────────────────────
// Der Fund, der diesen Code ausgelöst hat: der Browser löste die Verweise vor
// dem Absenden auf und schickte 6,73 MB an eine Function, die 4,5 MB annimmt —
// 413 bei jedem Export der Bank-Präsentation, und latent derselbe Fehler in der
// Kundenkalkulation.
//
// Getestet wird mit einem Fake-Port statt `vi.mock`, wie überall im server/-Teil
// (Vorbild: server/backup.test.ts, server/archive-mirror.test.ts). Die Attrappe
// ist hier eine Map — mehr braucht der eine Port nicht.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loeseVerweiseAuf,
  legeVerweiseAb,
  sammleVerweise,
  zerlegeVerweis,
  istFotoVerweis,
  mimeAusSignatur,
  type BilderDeps,
} from '../src/pdf/bilder.ts';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0, 1, 2, 3])]);

/** Ein Storage aus Speicher, plus ein Zähler — der ist die halbe Miete: an ihm
 *  hängt der Nachweis, dass derselbe Verweis nicht zweimal gelesen wird. */
function welt(inhalt: Record<string, Buffer>) {
  const abrufe: string[] = [];
  const deps: BilderDeps = {
    holeFoto: async (objId, photoId) => {
      abrufe.push(`${objId}/${photoId}`);
      return inhalt[`${objId}/${photoId}`] ?? null;
    },
  };
  return { deps, abrufe };
}

describe('istFotoVerweis / zerlegeVerweis', () => {
  it('erkennt einen Verweis und zerlegt ihn', () => {
    expect(istFotoVerweis('photo:obj1/foto1')).toBe(true);
    expect(zerlegeVerweis('photo:obj1/foto1')).toEqual({ objId: 'obj1', photoId: 'foto1' });
  });

  it('haelt Data-URLs und gewoehnlichen Text heraus', () => {
    expect(istFotoVerweis('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(istFotoVerweis('Tölzer Straße 21')).toBe(false);
    expect(istFotoVerweis(42)).toBe(false);
    expect(istFotoVerweis(null)).toBe(false);
  });

  it('gibt bei kaputter Form null statt einer Ausnahme', () => {
    // Ein halber Verweis darf keinen Export abbrechen.
    expect(zerlegeVerweis('photo:nurEinTeil')).toBeNull();
    expect(zerlegeVerweis('photo:a/b/c')).toBeNull();
    expect(zerlegeVerweis('photo:/leer')).toBeNull();
  });
});

describe('mimeAusSignatur', () => {
  it('liest den Typ aus den Bytes, nicht aus der Endung', () => {
    // Der Schluessel im Bucket endet immer auf .jpg (storage.ts: photoKey) —
    // der Inhalt muss das nicht sein.
    expect(mimeAusSignatur(JPEG)).toBe('image/jpeg');
    expect(mimeAusSignatur(PNG)).toBe('image/png');
    expect(mimeAusSignatur(Buffer.concat([
      Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1'),
    ]))).toBe('image/webp');
  });

  it('faellt auf jpeg zurueck, wenn nichts passt', () => {
    expect(mimeAusSignatur(Buffer.from([1, 2, 3]))).toBe('image/jpeg');
  });
});

describe('sammleVerweise', () => {
  it('findet Verweise in allen bildtragenden Feldern der Slide-Typen', () => {
    // Die Namen stehen in src/lib/finanzpraesSlideData.ts. Eine Namensliste im
    // Auflöser waere eine zweite Wahrheit — deshalb laeuft er feld-agnostisch,
    // und dieser Test haelt genau das fest.
    const praes = {
      slides: [
        { data: { bilder: ['photo:o/a', 'photo:o/b'] } },
        { data: { bildPath: 'photo:o/c' } },
        { data: { bild: 'photo:o/d' } },
        { data: { bild1: 'photo:o/e', bild2: 'photo:o/f' } },
      ],
    };
    expect([...sammleVerweise(praes)].sort()).toEqual(
      ['photo:o/a', 'photo:o/b', 'photo:o/c', 'photo:o/d', 'photo:o/e', 'photo:o/f'],
    );
  });

  it('zaehlt denselben Verweis nur einmal', () => {
    const praes = { slides: [{ data: { bild: 'photo:o/a' } }, { data: { bild1: 'photo:o/a' } }] };
    expect([...sammleVerweise(praes)]).toEqual(['photo:o/a']);
  });
});

describe('loeseVerweiseAuf', () => {
  it('ersetzt einen Verweis durch die eingebettete Data-URL', async () => {
    const { deps } = welt({ 'obj1/foto1': JPEG });
    const aus = await loeseVerweiseAuf(
      { slides: [{ data: { bild: 'photo:obj1/foto1' } }] }, deps,
    );
    expect(aus.slides[0]!.data.bild).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
  });

  it('macht aus einem fehlenden Foto eine leere Stelle, keine Ausnahme', async () => {
    // Genau das Verhalten, das der Client vorher hatte (applyPhotoRefMap).
    // Ein geloeschtes Foto darf den ganzen Export nicht mitnehmen.
    const { deps } = welt({});
    const aus = await loeseVerweiseAuf(
      { slides: [{ data: { bild: 'photo:weg/weg', titel: 'bleibt' } }] }, deps,
    );
    expect(aus.slides[0]!.data.bild).toBe('');
    expect(aus.slides[0]!.data.titel).toBe('bleibt');
  });

  it('reicht Alt-base64 und alles Uebrige unveraendert durch', async () => {
    const { deps, abrufe } = welt({});
    const alt = 'data:image/png;base64,AAAA';
    const aus = await loeseVerweiseAuf(
      { slides: [{ data: { bild: alt, zahl: 42, an: true, nichts: null } }] }, deps,
    );
    expect(aus.slides[0]!.data).toEqual({ bild: alt, zahl: 42, an: true, nichts: null });
    expect(abrufe).toEqual([]);
  });

  it('liest denselben Verweis nur einmal, auch wenn er mehrfach vorkommt', async () => {
    const { deps, abrufe } = welt({ 'obj1/foto1': JPEG });
    await loeseVerweiseAuf({
      slides: [
        { data: { bild: 'photo:obj1/foto1' } },
        { data: { bilder: ['photo:obj1/foto1', 'photo:obj1/foto1'] } },
      ],
    }, deps);
    expect(abrufe).toEqual(['obj1/foto1']);
  });

  it('laesst captions unberuehrt, obwohl sie neben bilder stehen', async () => {
    const { deps } = welt({ 'o/a': JPEG });
    const aus = await loeseVerweiseAuf({
      slides: [{ data: { bilder: ['photo:o/a'], captions: ['Vorderansicht'] } }],
    }, deps);
    expect(aus.slides[0]!.data.captions).toEqual(['Vorderansicht']);
  });

  it('fasst die Eingabe nicht an — der Aufrufer behaelt seine Verweise', async () => {
    const { deps } = welt({ 'o/a': JPEG });
    const ein = { slides: [{ data: { bild: 'photo:o/a' } }] };
    await loeseVerweiseAuf(ein, deps);
    expect(ein.slides[0]!.data.bild).toBe('photo:o/a');
  });

  it('gibt ohne Verweise dasselbe Objekt zurueck, ohne zu kopieren', async () => {
    const { deps } = welt({});
    const ein = { slides: [{ data: { titel: 'ohne Bild' } }] };
    expect(await loeseVerweiseAuf(ein, deps)).toBe(ein);
  });

  it('greift auch fuer die Kundenkalkulation (impressionen auf oberster Ebene)', async () => {
    const { deps } = welt({ 'o/a': PNG });
    const aus = await loeseVerweiseAuf({ kalkName: 'X', impressionen: ['photo:o/a'] }, deps);
    expect(aus.impressionen[0]).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });
});

describe('die Nutzlast, um die es geht', () => {
  it('bleibt klein — der Server bekommt Verweise, keine Bilder', () => {
    // Der eigentliche Regressionstest. Zehn Fotos zu je 500 KB sind die
    // gemessene Groessenordnung der echten Praesentation (6,73 MB als base64).
    // Was RAUSGEHT, muss die gespeicherte Form sein.
    const praes = {
      id: 'p1',
      slides: Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`, visible: true, data: { bild: `photo:obj/foto${i}` },
      })),
    };
    const nutzlast = Buffer.byteLength(JSON.stringify(praes), 'utf8');
    expect(nutzlast).toBeLessThan(512 * 1024);
    expect(JSON.stringify(praes)).not.toContain('data:image');
  });

  it('waere mit eingebetteten Bildern ueber der Grenze der Function', async () => {
    // Die Gegenrechnung, damit die Zahl oben nicht nur behauptet ist: dieselben
    // zehn Fotos aufgeloest sprengen die 4,5 MB, an denen der Export scheiterte.
    const halbesMB = Buffer.concat([JPEG, Buffer.alloc(500 * 1024 - JPEG.length, 0x41)]);
    const inhalt: Record<string, Buffer> = {};
    for (let i = 0; i < 10; i++) inhalt[`obj/foto${i}`] = halbesMB;
    const { deps } = welt(inhalt);

    const aufgeloest = await loeseVerweiseAuf({
      slides: Array.from({ length: 10 }, (_, i) => ({ data: { bild: `photo:obj/foto${i}` } })),
    }, deps);

    expect(Buffer.byteLength(JSON.stringify(aufgeloest), 'utf8')).toBeGreaterThan(4.5 * 1024 * 1024);
  });
});

describe('legeVerweiseAb', () => {
  it('schreibt jedes Foto als Datei und ersetzt den Verweis durch ihren Namen', async () => {
    const { deps } = welt({ 'obj1/f1': JPEG });
    const ablage = await legeVerweiseAb({ data: { bild: 'photo:obj1/f1' } }, deps);
    try {
      const name = (ablage.wert as { data: { bild: string } }).data.bild;
      expect(name).toBe('b0.jpg');
      // Ein blosser Dateiname, kein Pfad — im file://-Dokument muss er die
      // Nachbardatei treffen, nicht irgendetwas Absolutes.
      expect(path.basename(name)).toBe(name);
      expect(fs.readFileSync(path.join(ablage.verzeichnis, name))).toEqual(JPEG);
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('richtet die Endung nach der Signatur, nicht nach dem Schluessel', async () => {
    // Der Schluessel im Bucket endet immer auf .jpg (server/storage.ts:
    // photoKey), der Inhalt muss das nicht sein.
    const { deps } = welt({ 'obj1/f1': PNG });
    const ablage = await legeVerweiseAb({ bild: 'photo:obj1/f1' }, deps);
    try {
      expect((ablage.wert as { bild: string }).bild).toBe('b0.png');
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('legt denselben Verweis nur einmal ab', async () => {
    const { deps, abrufe } = welt({ 'obj1/f1': JPEG });
    const ablage = await legeVerweiseAb({
      a: 'photo:obj1/f1', b: 'photo:obj1/f1', c: ['photo:obj1/f1'],
    }, deps);
    try {
      expect(abrufe).toEqual(['obj1/f1']);
      expect(fs.readdirSync(ablage.verzeichnis)).toEqual(['b0.jpg']);
      const w = ablage.wert as { a: string; b: string; c: string[] };
      expect([w.a, w.b, w.c[0]]).toEqual(['b0.jpg', 'b0.jpg', 'b0.jpg']);
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('macht aus einem unbekannten Verweis einen Leerstring, keine Datei', async () => {
    // Gleiches Verhalten wie im Data-URL-Zweig: ein geloeschtes Foto laesst eine
    // leere Stelle, es bricht nicht den Export ab.
    const { deps } = welt({});
    const ablage = await legeVerweiseAb({ bild: 'photo:weg/weg' }, deps);
    try {
      expect((ablage.wert as { bild: string }).bild).toBe('');
      expect(fs.readdirSync(ablage.verzeichnis)).toEqual([]);
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('legt auch ohne einen einzigen Verweis ein Verzeichnis an', async () => {
    // Das HTML muss irgendwo liegen, auch wenn die Praesentation bildlos ist.
    const { deps } = welt({});
    const ablage = await legeVerweiseAb({ titel: 'ohne Bilder' }, deps);
    try {
      expect(fs.existsSync(ablage.verzeichnis)).toBe(true);
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('raeumt das Verzeichnis weg und vertraegt einen zweiten Aufruf', async () => {
    const { deps } = welt({ 'obj1/f1': JPEG });
    const ablage = await legeVerweiseAb({ bild: 'photo:obj1/f1' }, deps);
    await ablage.aufraeumen();
    expect(fs.existsSync(ablage.verzeichnis)).toBe(false);
    // Der Aufrufer ruft es im Fehlerfall zweimal — das darf nicht werfen.
    await expect(ablage.aufraeumen()).resolves.toBeUndefined();
  });

  it('laesst Data-URLs aus dem Anfragekoerper unberuehrt', async () => {
    // Organigramm und Abschlussbild kommen als base64 aus dem localStorage. Sie
    // sind kein `photo:`-Verweis, bleiben also im HTML — zusammen 0,22 MB.
    const { deps, abrufe } = welt({});
    const vorhanden = 'data:image/png;base64,AAAA';
    const ablage = await legeVerweiseAb({ bild: vorhanden }, deps);
    try {
      expect((ablage.wert as { bild: string }).bild).toBe(vorhanden);
      expect(abrufe).toEqual([]);
    } finally {
      await ablage.aufraeumen();
    }
  });

  it('haelt zehn Fotos aus dem HTML heraus — der Grund fuer diesen Weg', async () => {
    // Der Test mit Unterscheidungskraft. Zehn Fotos zu je 500 KB ergaben als
    // base64 gut 7 MB HTML; ab etwa 5 MB kommt der String nicht mehr durch die
    // DevTools-Verbindung und `setContent` reisst nach 180 Sekunden das
    // Zeitlimit (gemessen 05.08.2026 gegen die Produktion). Als Dateinamen sind
    // es ein paar Dutzend Bytes. Baut jemand auf `loeseVerweiseAuf` zurueck,
    // wird dieser Test rot.
    const halbesMB = Buffer.concat([JPEG, Buffer.alloc(500 * 1024 - JPEG.length, 0x41)]);
    const inhalt: Record<string, Buffer> = {};
    for (let i = 0; i < 10; i++) inhalt[`obj/foto${i}`] = halbesMB;
    const { deps } = welt(inhalt);

    const ablage = await legeVerweiseAb({
      slides: Array.from({ length: 10 }, (_, i) => ({ data: { bild: `photo:obj/foto${i}` } })),
    }, deps);
    try {
      const alsText = JSON.stringify(ablage.wert);
      expect(alsText).not.toContain('data:image');
      expect(Buffer.byteLength(alsText, 'utf8')).toBeLessThan(1024);
      expect(fs.readdirSync(ablage.verzeichnis)).toHaveLength(10);
    } finally {
      await ablage.aufraeumen();
    }
  });
});
