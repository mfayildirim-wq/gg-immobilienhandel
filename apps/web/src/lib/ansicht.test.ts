import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUTS, leseEinstellung, leseZahl, teilerBegrenzen } from './ansicht.ts';

describe('leseEinstellung', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('liefert den gespeicherten erlaubten Wert', () => {
    localStorage.setItem('gg.layout', 'untereinander');
    expect(leseEinstellung('layout', LAYOUTS, 'nebeneinander')).toBe('untereinander');
  });

  it('ignoriert unbekannte Werte', () => {
    localStorage.setItem('gg.layout', 'diagonal');
    expect(leseEinstellung('layout', LAYOUTS, 'nebeneinander')).toBe('nebeneinander');
  });

  it('fällt ohne Speicherzugriff auf den Standard zurück', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blockiert');
    });
    expect(leseEinstellung('layout', LAYOUTS, 'nebeneinander')).toBe('nebeneinander');
  });
});

describe('leseZahl (gemerkte Größe, z. B. Breite der Liste)', () => {
  afterEach(() => localStorage.clear());

  it('liefert die gespeicherte Zahl, sonst null', () => {
    localStorage.setItem('gg.ankauf.deals.breite', '312');
    expect(leseZahl('ankauf.deals.breite')).toBe(312);
    expect(leseZahl('ankauf.makler.breite')).toBeNull();
  });

  it('ignoriert Unlesbares und Unsinniges', () => {
    localStorage.setItem('gg.a', 'breit');
    localStorage.setItem('gg.b', '-40');
    localStorage.setItem('gg.c', '');
    expect([leseZahl('a'), leseZahl('b'), leseZahl('c')]).toEqual([null, null, null]);
  });
});

describe('teilerBegrenzen (Liste und Detail behalten beim Ziehen eine Mindestgröße)', () => {
  it('lässt Werte im erlaubten Bereich stehen und rundet auf ganze Pixel', () => {
    expect(teilerBegrenzen(430, 1200)).toBe(430);
    expect(teilerBegrenzen(311.6, 1200)).toBe(312);
  });

  it('die Liste wird nicht schmaler als 240 px, das Detail nicht schmaler als 360 px', () => {
    expect(teilerBegrenzen(80, 1200)).toBe(240);
    expect(teilerBegrenzen(1100, 1200)).toBe(840);
  });

  it('ist der Platz zu klein für beide Mindestgrößen, geht die Liste vor dem Detail zurück', () => {
    expect(teilerBegrenzen(400, 500)).toBe(240);
  });
});
