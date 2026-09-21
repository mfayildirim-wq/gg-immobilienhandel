import { describe, expect, it } from 'vitest';
import { alsStrom } from '../src/strom.ts';

describe('alsStrom', () => {
  it('liefert die Bytes unverändert — auch über mehrere Stücke — und nennt keine Länge', async () => {
    const daten = new Uint8Array(6 * 1024 * 1024 + 123).map((_, i) => i % 251);
    const r = alsStrom(daten, { 'Content-Type': 'application/pdf', 'Content-Length': String(daten.byteLength) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    // Mit Längenangabe wertet Vercel die Antwort nicht als Strom — und die 4,5-MB-Grenze gilt wieder
    expect(r.headers.get('content-length')).toBeNull();
    let stuecke = 0;
    const teile: Uint8Array[] = [];
    for await (const t of r.body as unknown as AsyncIterable<Uint8Array>) { stuecke++; teile.push(t); }
    expect(stuecke).toBeGreaterThan(1);
    expect(Buffer.concat(teile).equals(Buffer.from(daten))).toBe(true);
  });

  it('nimmt auch Text (Sicherung, Audit-Export) und eine leere Datei', async () => {
    expect(await alsStrom('{"a":"ä"}', {}).text()).toBe('{"a":"ä"}');
    expect((await alsStrom(new Uint8Array(0), {}).arrayBuffer()).byteLength).toBe(0);
  });
});
