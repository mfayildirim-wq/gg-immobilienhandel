import { describe, expect, it } from 'vitest';
import { istLokaleDatenbank, verlangeLokaleDatenbank } from '../src/client.ts';

describe('Prod-Schutz: lokale Datenbank', () => {
  it('erkennt den Host, nicht den Text', () => {
    expect(istLokaleDatenbank('postgresql://postgres:postgres@127.0.0.1:55422/postgres')).toBe(true);
    expect(istLokaleDatenbank('postgresql://u:p@localhost:5432/db')).toBe(true);
    expect(istLokaleDatenbank('postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')).toBe(false);
    expect(istLokaleDatenbank('postgresql://u:p@localhost.boese.example:5432/db')).toBe(false);
    expect(istLokaleDatenbank('postgresql://u:p@db.example/127.0.0.1')).toBe(false);
    expect(istLokaleDatenbank('kein-url')).toBe(false);
  });
  it('bricht mit dem Host in der Meldung ab — ohne das Passwort zu nennen', () => {
    expect(() => verlangeLokaleDatenbank('postgresql://u:geheim@db.example:6543/x', 'Testlauf')).toThrow(/Testlauf.*db\.example:6543.*nicht lokal/);
    try { verlangeLokaleDatenbank('postgresql://u:geheim@db.example:6543/x', 'Testlauf'); } catch (e) { expect(String(e)).not.toContain('geheim'); }
  });
});
