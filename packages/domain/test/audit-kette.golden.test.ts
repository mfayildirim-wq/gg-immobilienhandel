/** Golden Master: Audit-Hash-Kette (Nutzinhalt, Verkettung, Anker, Prüfung) wie server/audit-chain.ts der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditNutzinhalt, auditWert, auditZeile, kettenStart, ketteRechnen } from '../src/index.ts';

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/audit-kette.json'), 'utf8')) as { faelle: any[] };

describe('Audit-Hash-Kette (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    expect(f.zeilen.map((z: any) => auditNutzinhalt(z))).toEqual(f.nutzinhalt);
    const start = kettenStart(f.zeilen);
    expect({ prev: start.prev, anchor: start.anker }).toEqual({ prev: f.start.prev, anchor: f.start.anchor });
    const befund = ketteRechnen(sha256, f.zeilen);
    expect({ ...befund, anker: undefined, anchor: befund.anker }).toEqual({ ...f.befund, anker: undefined });
  });
});

describe('Audit-Anzeige', () => {
  it('Kopf- und Wertzeile wie renderAuditRow', () => {
    const z = auditZeile({ ts: 1_789_000_000, type: 'mutation', entity: 'doc', entityId: 'abcdef123456', action: 'update', collection: 'deal_documents', fieldName: 'label', oldValue: null, newValue: 'Exposé', source: '/api/x' });
    expect(z.kopf).toBe('✏️ 10.09.2026, 02:26:40 · doc #123456 update · Feld: label · deal_documents (/api/x)');
    expect(z.wert).toBe('– → Exposé');
    const ki = auditZeile({ ts: 1_789_000_000, type: 'kicall', aiModel: 'claude-haiku-4-5-20251001', aiFunction: 'makler/zusammenfassung', inputTokens: 1200, outputTokens: 300, costEur: 0.0123 });
    expect(ki.wert).toBe('claude-haiku-4-5-20251001 makler/zusammenfassung · 1200 in / 300 out · 0.0123€');
  });

  it('Werte werden gekürzt und JSON kompakt gezeigt', () => {
    expect(auditWert('{"a": 1,  "b": 2}')).toBe('{"a":1,"b":2}');
    expect(auditWert('x'.repeat(200))).toHaveLength(118);
    expect(auditWert(null)).toBe('–');
  });
});
