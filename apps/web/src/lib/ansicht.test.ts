import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUTS, leseEinstellung } from './ansicht.ts';

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
