import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/schema.ts';

const tabellen: PgTable[] = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));

describe('Fachschema', () => {
  it('enthält die 37 Tabellen aus Protokoll 07, den Anlässe-Zwischenspeicher (23.09.2026) und die 12 Tabellen des Schemas cosai (26.09. + Ergebnisse 27.09.2026)', () => {
    expect(tabellen).toHaveLength(50);
    expect(tabellen.filter((t) => getTableConfig(t).schema === 'cosai')).toHaveLength(12);
    expect(tabellen.map((t) => getTableConfig(t).name)).toContain('makler_anlaesse');
  });

  it('legt alle Tabellen in den Schemas „fach“ und „cosai“ mit RLS an', () => {
    for (const t of tabellen) {
      const cfg = getTableConfig(t);
      expect(['fach', 'cosai'], cfg.name).toContain(cfg.schema);
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
