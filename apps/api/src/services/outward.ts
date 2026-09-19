import type { OutwardFreigabe, OutwardStand } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { evaluateOutward, type OutwardDecision, OUTWARD_ACTIONS, OUTWARD_SETTINGS_KEY } from '@gg/domain';
import { eq, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';

const FREIGABEN_SCHLUESSEL = 'mcp-freigaben';

async function einstellung<T>(db: Db, schluessel: string, standard: T): Promise<T> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, schluessel));
  return (z?.wert as T | null) ?? standard;
}

async function einstellungSpeichern(db: Db, schluessel: string, wert: unknown) {
  await db.insert(schema.einstellungen).values({ schluessel, wert })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert, updatedAt: sql`now()` } });
}

export interface GateSchalter { allowAgbSubmit: boolean; allowPropstackWrite: boolean; extraAgbHosts: string[] }
const STANDARD: GateSchalter = { allowAgbSubmit: false, allowPropstackWrite: false, extraAgbHosts: [] };

export const gateEinstellungen = (db: Db) => einstellung<GateSchalter>(db, OUTWARD_SETTINGS_KEY, STANDARD);

/** Stand für die Oberfläche: Schalter, Umgebung und je Aktion die aktuelle Entscheidung an einem Beispielziel. */
export async function outwardStand(db: Db): Promise<OutwardStand> {
  const schalter = { ...STANDARD, ...(await gateEinstellungen(db)) };
  const env = process.env;
  const proben: { action: string; url: string }[] = [
    { action: OUTWARD_ACTIONS.AGB_SUBMIT, url: 'https://immo.fio.de/' },
    { action: OUTWARD_ACTIONS.PROPSTACK_UNIT_CREATE, url: 'https://api.propstack.de/v1/units' },
  ];
  return {
    schalter,
    scharfeUmgebung: env.VERCEL === '1' && env.VERCEL_ENV === 'production',
    notAus: Boolean(env.OUTWARD_GATE_KILL),
    proben: proben.map((p) => {
      const e = evaluateOutward({ ...p, env, settings: schalter });
      return { action: p.action, url: p.url, erlaubt: e.allowed, failed: e.failed, grund: e.reason };
    }),
    freigaben: await einstellung<OutwardFreigabe[]>(db, FREIGABEN_SCHLUESSEL, []),
  };
}

export async function gateSpeichern(db: Db, schalter: Partial<GateSchalter>) {
  const alt = { ...STANDARD, ...(await gateEinstellungen(db)) };
  const neu: GateSchalter = {
    allowAgbSubmit: schalter.allowAgbSubmit ?? alt.allowAgbSubmit,
    allowPropstackWrite: schalter.allowPropstackWrite ?? alt.allowPropstackWrite,
    extraAgbHosts: schalter.extraAgbHosts ?? alt.extraAgbHosts,
  };
  await einstellungSpeichern(db, OUTWARD_SETTINGS_KEY, neu);
  await auditSchreiben(db, { type: 'mutation', entity: 'outward-gate', action: 'update', source: '/api/outward-gate', oldValue: alt, newValue: neu });
  return neu;
}

/**
 * Freigabe-Antrag (alt: MCP-Werkzeug `request_outward_approval`): es wird nichts ausgeführt —
 * der Antrag wartet auf eine Entscheidung in der App, und auch danach entscheidet das Gate.
 */
export async function freigabeBeantragen(db: Db, e: { action: string; url: string; grund: string; bezug?: string; beantragtVon?: string }) {
  const liste = await einstellung<OutwardFreigabe[]>(db, FREIGABEN_SCHLUESSEL, []);
  const antrag: OutwardFreigabe = {
    id: crypto.randomUUID(), ts: new Date().toISOString(), action: e.action, url: e.url, grund: e.grund,
    bezug: e.bezug ?? null, beantragtVon: e.beantragtVon ?? 'mcp',
  };
  await einstellungSpeichern(db, FREIGABEN_SCHLUESSEL, [antrag, ...liste].slice(0, 100));
  await auditSchreiben(db, { type: 'mutation', entity: 'outward-gate', entityId: antrag.id, action: 'approval-requested', source: '/api/outward-gate/freigaben', metadata: { action: e.action, url: e.url, grund: e.grund } });
  return antrag;
}

export async function freigabeEntscheiden(db: Db, id: string, entscheidung: 'erlaubt' | 'abgelehnt') {
  const liste = await einstellung<OutwardFreigabe[]>(db, FREIGABEN_SCHLUESSEL, []);
  const antrag = liste.find((a) => a.id === id);
  if (!antrag) throw new FachFehler(404, 'Antrag nicht gefunden');
  await einstellungSpeichern(db, FREIGABEN_SCHLUESSEL, liste.filter((a) => a.id !== id));
  await auditSchreiben(db, {
    type: 'mutation', entity: 'outward-gate', entityId: id, action: entscheidung === 'erlaubt' ? 'approval-granted' : 'approval-denied',
    source: '/api/outward-gate/freigaben/{id}', metadata: { action: antrag.action, url: antrag.url, grund: antrag.grund },
  });
  return { id, entscheidung };
}

/** Laufzeitprüfung für Aufrufstellen (alt: checkOutwardAction): jede Entscheidung steht im Audit-Log. */
export async function outwardPruefen(db: Db, action: string, url: string, quelle: string, bezug?: string): Promise<OutwardDecision> {
  const e = evaluateOutward({ action, url, env: process.env, settings: await gateEinstellungen(db) });
  await auditSchreiben(db, {
    type: 'mutation', entity: 'outward-gate', entityId: bezug ?? null, action: e.allowed ? 'outward-allowed' : 'outward-blocked',
    source: quelle, metadata: { action: e.action, host: e.host, failed: e.failed, reason: e.reason },
  });
  return e;
}
