import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/schema.ts';

const tabellen: PgTable[] = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));

describe('Fachschema', () => {
  it('enthält die 37 Tabellen aus Protokoll 07, die Zwischenspeicher für Anlässe (23.09.2026) und Verortung (13.10.2026), die Exposé-Importe (10.10.2026; Wörterbuch und Korrekturen am 16.10.2026 wieder entfernt)', () => {
    expect(tabellen).toHaveLength(42);
    expect(tabellen.map((t) => getTableConfig(t).name)).toEqual(expect.arrayContaining(['makler_anlaesse', 'geo_verortungen', 'expose_importe', 'firmen_auskuenfte']));
  });

  it('legt alle Tabellen im Schema „fach“ mit RLS an', () => {
    for (const t of tabellen) {
      const cfg = getTableConfig(t);
      expect(cfg.schema, cfg.name).toBe('fach');
      expect(cfg.enableRLS, cfg.name).toBe(true);
    }
  });

  it('gibt jeder Tabelle einen Primärschlüssel', () => {
    for (const t of tabellen) {
      const cfg = getTableConfig(t);
      const pk = cfg.columns.some((c) => c.primary) || cfg.primaryKeys.length > 0;
      expect(pk, cfg.name).toBe(true);
    }
  });

  it('macht makler_id am Deal optional (Ist-Verhalten, Fachfrage 1)', () => {
    const cfg = getTableConfig(schema.deals);
    expect(cfg.columns.find((c) => c.name === 'makler_id')?.notNull).toBe(false);
    expect(cfg.columns.find((c) => c.name === 'objekt_id')?.notNull).toBe(true);
  });
});
