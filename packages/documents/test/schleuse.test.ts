// Port von gg-immohandel server/render-schleuse.test.ts (Teil erzeugeSchleuse; das Tor testet apps/api).
import { describe, expect, it } from 'vitest';
import { AbbruchError, erzeugeSchleuse, SchleuseVollError } from '../src/pdf/schleuse.ts';

const gleich = () => new Promise(r => setImmediate(r));

describe('erzeugeSchleuse', () => {
  it('lässt bis zur Grenze sofort durch', async () => {
    const s = erzeugeSchleuse({ maxParallel: 2, maxWartend: 2, wartezeitMs: 1000 });
    await s.betrete();
    await s.betrete();
    expect(s.laufend()).toBe(2);
    expect(s.wartend()).toBe(0);
  });

  it('hält den dritten Lauf an, bis ein Platz frei wird', async () => {
    const s = erzeugeSchleuse({ maxParallel: 2, maxWartend: 2, wartezeitMs: 1000 });
    const frei1 = await s.betrete();
    await s.betrete();

    let drin = false;
    const dritter = s.betrete().then(f => { drin = true; return f; });
    await gleich();
    expect(drin).toBe(false);
    expect(s.wartend()).toBe(1);

    frei1();
    await dritter;
    expect(drin).toBe(true);
    expect(s.laufend()).toBe(2);
    expect(s.wartend()).toBe(0);
  });

  it('weist ab, wenn auch die Warteschlange voll ist', async () => {
    const s = erzeugeSchleuse({ maxParallel: 1, maxWartend: 1, wartezeitMs: 1000 });
    await s.betrete();
    void s.betrete().catch(() => { /* bleibt bis zum Testende stehen */ });
    await gleich();
    await expect(s.betrete()).rejects.toBeInstanceOf(SchleuseVollError);
  });

  it('weist einen Wartenden nach Ablauf der Geduld ab und räumt ihn aus der Schlange', async () => {
    const s = erzeugeSchleuse({ maxParallel: 1, maxWartend: 5, wartezeitMs: 10 });
    await s.betrete();
    await expect(s.betrete()).rejects.toBeInstanceOf(SchleuseVollError);
    expect(s.wartend()).toBe(0);
  });

  it('nimmt einen abgebrochenen Wartenden aus der Schlange, statt ihm den Platz zu geben', async () => {
    const s = erzeugeSchleuse({ maxParallel: 1, maxWartend: 2, wartezeitMs: 1000 });
    const frei = await s.betrete();

    const abbruch = new AbortController();
    const wartend = s.betrete(abbruch.signal);
    await gleich();
    expect(s.wartend()).toBe(1);

    abbruch.abort();
    await expect(wartend).rejects.toBeInstanceOf(AbbruchError);
    expect(s.wartend()).toBe(0);

    // Der frei werdende Platz darf nicht an den Abgebrochenen gehen — der gäbe
    // ihn nie zurück.
    frei();
    expect(s.laufend()).toBe(0);
  });

  it('lässt einen bereits abgebrochenen Aufruf gar nicht erst ein', async () => {
    const s = erzeugeSchleuse({ maxParallel: 2, maxWartend: 2, wartezeitMs: 1000 });
    const abbruch = new AbortController();
    abbruch.abort();
    await expect(s.betrete(abbruch.signal)).rejects.toBeInstanceOf(AbbruchError);
    expect(s.laufend()).toBe(0);
  });

  it('zählt eine doppelte Freigabe nur einmal', async () => {
    // res.on('close') und ein eigenes finally können beide feuern — ohne Schutz
    // liefe der Zähler ins Minus und die Grenze wäre wirkungslos.
    const s = erzeugeSchleuse({ maxParallel: 1, maxWartend: 1, wartezeitMs: 1000 });
    const frei = await s.betrete();
    frei();
    frei();
    expect(s.laufend()).toBe(0);
  });
});
