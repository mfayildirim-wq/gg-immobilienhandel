import { type Db, schema } from '@gg/db';
import { isNotNull } from 'drizzle-orm';
import { exposeAltimport } from './umformen.ts';
import { istObjekt } from './werte.ts';

export interface AltimporteErgebnis {
  /** Deals mit expose_rohdaten */
  geprueft: number;
  /** neu angelegte Zeilen expose_importe */
  angelegt: number;
  /** Deals, deren Zeile schon bestand (feste ID imp:<dealId> oder importId aus der Übernahme) */
  vorhanden: number;
  trocken: boolean;
}

class Zurueckrollen extends Error {
  constructor(readonly ergebnis: AltimporteErgebnis) {
    super('Altimporte zurückgerollt');
  }
}

/**
 * Überführt die Exposé-Rohdaten bereits bestehender Neubau-Deals (`fach.deals.expose_rohdaten`, Schema v0) in `expose_importe` —
 * für Deals, die im Neubau vor der Import-Tabelle angelegt wurden. Der Umzug aus der alten App macht dasselbe für Altdeals.
 * Idempotent: feste ID `imp:<dealId>`, vorhandene Zeilen bleiben unverändert (on conflict do nothing).
 * Aufruf: `pnpm umzug --altimporte` (mit `--trocken` nur zählen).
 */
export async function altimporteUeberfuehren(db: Db, opt: { trocken?: boolean } = {}): Promise<AltimporteErgebnis> {
  try {
    return await db.transaction(async (tx) => {
      const deals = await tx
        .select({ id: schema.deals.id, objektId: schema.deals.objektId, maklerId: schema.deals.maklerId, roh: schema.deals.exposeRohdaten })
        .from(schema.deals)
        .where(isNotNull(schema.deals.exposeRohdaten));
      const bestehend = new Set((await tx.select({ id: schema.exposeImporte.id }).from(schema.exposeImporte)).map((e) => e.id));
      const ergebnis: AltimporteErgebnis = { geprueft: 0, angelegt: 0, vorhanden: 0, trocken: !!opt.trocken };
      for (const d of deals) {
        if (!istObjekt(d.roh)) continue;
        ergebnis.geprueft++;
        const zeile = exposeAltimport(d.id, d.objektId, d.maklerId, d.roh);
        const importId = typeof d.roh.importId === 'string' ? d.roh.importId : null;
        if (bestehend.has(zeile.id) || (importId && bestehend.has(importId))) {
          ergebnis.vorhanden++;
          continue;
        }
        await tx.insert(schema.exposeImporte).values(zeile).onConflictDoNothing({ target: schema.exposeImporte.id });
        ergebnis.angelegt++;
      }
      if (opt.trocken) throw new Zurueckrollen(ergebnis);
      return ergebnis;
    });
  } catch (e) {
    if (e instanceof Zurueckrollen) return e.ergebnis;
    throw e;
  }
}
