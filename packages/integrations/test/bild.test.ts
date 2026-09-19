import { describe, expect, it } from 'vitest';
import { bildTypErkennen, fotoSchluessel } from '../src/index.ts';

const bytes = (...teile: (string | number[])[]) =>
  new Uint8Array(teile.flatMap((t) => (typeof t === 'string' ? [...t].map((c) => c.charCodeAt(0)) : t)));

describe('bildTypErkennen', () => {
  it('erkennt die Formate an der Signatur', () => {
    expect(bildTypErkennen(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(bildTypErkennen(bytes('\x89PNG\r\n\x1a\n', [0]))).toBe('image/png');
    expect(bildTypErkennen(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp');
    expect(bildTypErkennen(bytes('GIF89a'))).toBe('image/gif');
    expect(bildTypErkennen(bytes([0, 0, 0, 24], 'ftypheic'))).toBe('image/heic');
  });
  it('lehnt Nicht-Bilder ab', () => {
    expect(bildTypErkennen(bytes('%PDF-1.7'))).toBeNull();
    expect(bildTypErkennen(bytes('<svg'))).toBeNull(); // SVG kann Skript enthalten
    expect(bildTypErkennen(new Uint8Array())).toBeNull();
  });
});

describe('fotoSchluessel', () => {
  it('endet wie in der alten App immer auf .jpg', () => expect(fotoSchluessel('o1', 'f1')).toBe('o1/f1.jpg'));
});
