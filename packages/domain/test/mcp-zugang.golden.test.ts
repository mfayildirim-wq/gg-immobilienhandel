/** Golden Master: MCP-Zugang (Schlüsselverzeichnis, lokale Umgebung, Bereichsprüfung) wie server/mcp.ts + auth.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpSchluesselAusKopf, nachweislichLokal, schluesselVerzeichnis, verlangterBereich, werkzeugErlaubt, werkzeugVerzeichnis } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/mcp-zugang.json'), 'utf8')) as { faelle: any[] };

describe('MCP-Zugang (Golden Master)', () => {
  it.each(g.faelle.map((f) => [`${f.art}/${f.name}`, f] as const))('%s', (_n, f) => {
    if (f.art === 'verzeichnis') expect(schluesselVerzeichnis(f.roh ?? undefined)).toEqual({ keys: f.keys, rejected: f.rejected });
    if (f.art === 'umgebung') expect(nachweislichLokal(f.env)).toBe(f.lokal);
    if (f.art === 'werkzeug') {
      expect(verlangterBereich(f.spec)).toEqual(f.bereich);
      expect(werkzeugErlaubt(f.spec, ['read'])).toBe(f.erlaubt.read);
      expect(werkzeugErlaubt(f.spec, ['read', 'write', 'outward'])).toBe(f.erlaubt.alle);
      expect(werkzeugErlaubt(f.spec, [])).toBe(f.erlaubt.keine);
    }
  });
});

describe('MCP-Zugang: Verzeichnis der Werkzeuge und Schlüssel aus den Kopfzeilen', () => {
  it('nimmt nur vollständige Werkzeuge auf', () => {
    const r = werkzeugVerzeichnis([
      { name: 'read_collection', scope: 'read' }, { name: 'create_entity', scope: 'write' },
      { name: 'ohne_bereich' }, { name: 'falscher_bereich', scope: 'admin' }, { name: 'Falscher Name', scope: 'read' },
      { name: 'read_collection', scope: 'read' },
    ]);
    expect(r.werkzeuge.map((w) => w.name)).toEqual(['read_collection', 'create_entity']);
    expect(r.rejected).toHaveLength(4);
  });

  it('liest den Schlüssel nur aus den Kopfzeilen', () => {
    expect(mcpSchluesselAusKopf({ authorization: 'Bearer abc123' })).toBe('abc123');
    expect(mcpSchluesselAusKopf({ 'x-mcp-key': 'direkt' })).toBe('direkt');
    expect(mcpSchluesselAusKopf({ cookie: 'gg-auth=token' })).toBeNull();
    expect(mcpSchluesselAusKopf({})).toBeNull();
  });
});
