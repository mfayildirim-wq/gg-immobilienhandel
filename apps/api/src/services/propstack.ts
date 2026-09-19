import type { PropstackBewertung } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { type BewertungsDaten, bewertungMerken, bewertungVorbelegen, OUTWARD_ACTIONS, propstackPayload, propstackUnitUrl, PROPSTACK_STELLPLATZ_HINWEIS } from '@gg/domain';
import { PROPSTACK_BASIS, type PropstackClient, propstackClient } from '@gg/integrations';
import { and, eq, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { outwardPruefen } from './outward.ts';
import { zugangLesen } from './zugaenge.ts';

/** Der Status, unter dem neue Einheiten im CRM landen (alt: immo-propstack-status-id). */
const STATUS_SCHLUESSEL = 'propstack-status-id';

async function statusId(db: Db): Promise<number | null> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, STATUS_SCHLUESSEL));
  const wert = (z?.wert as { id?: unknown } | null)?.id;
  return typeof wert === 'number' ? wert : null;
}

/**
 * Statusliste aus dem CRM, mit Vorschlag (alt: „📋 Statuses laden").
 * Der Vorschlag ist der Status, dessen Name „Kaufangebot" enthält — ohne ihn müsste man die Zahl
 * im CRM suchen und abtippen. Gespeichert wird erst auf Zuruf, nicht automatisch.
 */
export async function propstackStatusListe(db: Db, ki: PropstackClient | null | undefined) {
  const antwort = await (await client(db, ki)).statusListe();
  if (!antwort.ok) throw new FachFehler(422, `Propstack antwortete mit ${antwort.status}.`, { hint: 'Schlüssel prüfen (Einstellungen → Zugänge).' });
  // Propstack liefert je nach Endpunkt das Array direkt oder in `data` verpackt.
  const roh = antwort.daten as unknown;
  const liste = (Array.isArray(roh) ? roh : ((roh as { data?: unknown[] })?.data ?? []))
    .map((s) => s as { id?: unknown; name?: unknown })
    .filter((s) => typeof s.id === 'number' && typeof s.name === 'string')
    .map((s) => ({ id: s.id as number, name: s.name as string }));
  const vorschlag = liste.find((s) => /kaufangebot/i.test(s.name))?.id ?? null;
  return { liste, vorschlag, gewaehlt: await statusId(db) };
}

/** Zielstatus festlegen; `null` nimmt die Festlegung zurück. */
export async function propstackStatusSpeichern(db: Db, id: number | null) {
  if (id === null) {
    await db.delete(schema.einstellungen).where(eq(schema.einstellungen.schluessel, STATUS_SCHLUESSEL));
  } else {
    await db.insert(schema.einstellungen).values({ schluessel: STATUS_SCHLUESSEL, wert: { id }, updatedAt: sql`now()` })
      .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: { id }, updatedAt: sql`now()` } });
  }
  await auditSchreiben(db, { type: 'einstellungen', action: 'save', entityId: STATUS_SCHLUESSEL, source: '/api/propstack/status', metadata: { id } });
  return { gewaehlt: await statusId(db) };
}

async function einheitMitObjekt(db: Db, dealId: string, einheitId: string) {
  const [zeile] = await db
    .select({ einheit: schema.dealEinheiten, objekt: schema.objekte })
    .from(schema.dealEinheiten)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.dealEinheiten.dealId))
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(eq(schema.dealEinheiten.id, einheitId), eq(schema.dealEinheiten.dealId, dealId)));
  if (!zeile) throw new FachFehler(404, 'Einheit nicht gefunden');
  if (zeile.einheit.typ === 'Stellplatz') throw new FachFehler(422, PROPSTACK_STELLPLATZ_HINWEIS);
  return zeile;
}

const gemerkt = (bewertung: unknown) => (bewertung && typeof bewertung === 'object' ? (bewertung as Record<string, unknown>) : {});

/** Vorbelegung des Bewertungsdialogs; `unitId` zeigt, ob die Einheit schon im CRM liegt. */
export async function propstackVorbelegen(db: Db, dealId: string, einheitId: string): Promise<PropstackBewertung> {
  const { einheit, objekt } = await einheitMitObjekt(db, dealId, einheitId);
  const b = gemerkt(einheit.bewertung);
  const daten = bewertungVorbelegen(objekt, {
    flaeche: einheit.flaeche, zimmer: einheit.zimmer,
    propstack: {
      unitId: (b._psUnitId as string | number | undefined) ?? null,
      letzteModernisierung: b._psLetzteModernisierung as string | undefined,
      etage: b._psEtage as string | undefined,
      etagenzahl: b._psEtagenzahl as string | undefined,
      balkonFlaeche: b._psBalkonFlaeche as string | undefined,
      qualitaet: b._psQualitaet as BewertungsDaten['qualitaet'] | undefined,
    },
  });
  const unitId = (b._psUnitId as string | number | undefined) ?? null;
  return { dealId, einheitId, daten, unitId: unitId === null ? null : String(unitId), url: unitId ? propstackUnitUrl(unitId) : null };
}

async function client(db: Db, vorgegeben?: PropstackClient | null): Promise<PropstackClient> {
  if (vorgegeben) return vorgegeben;
  const key = await zugangLesen(db, 'propstack-api-key');
  if (!key) throw new FachFehler(422, 'Propstack-Schlüssel nicht hinterlegt (Einstellungen → Zugänge).');
  return propstackClient(key);
}

/**
 * Einheit im CRM anlegen. Der Schreibzugriff ist gegatet (Default-Deny): erst wenn Umgebung, Schalter
 * und Ziel-Host stimmen, geht die Anfrage überhaupt hinaus. Die Angaben bleiben an der Einheit.
 */
export async function propstackAnlegen(db: Db, ki: PropstackClient | null | undefined, dealId: string, einheitId: string, daten: BewertungsDaten) {
  const { einheit } = await einheitMitObjekt(db, dealId, einheitId);
  const entscheidung = await outwardPruefen(db, OUTWARD_ACTIONS.PROPSTACK_UNIT_CREATE, `${PROPSTACK_BASIS}/units`, '/api/deals/{id}/einheiten/{einheitId}/propstack', dealId);
  if (!entscheidung.allowed) {
    throw new FachFehler(403, entscheidung.reason, {
      failed: entscheidung.failed,
      hint: 'Schalter „Einheit in Propstack anlegen“ unter Einstellungen → Aktionen nach außen; scharf ist die Aktion nur in der Produktion.',
    });
  }
  const antwort = await (await client(db, ki)).einheitAnlegen(propstackPayload(daten, await statusId(db)));
  const unitId = (antwort.daten as { id?: string | number } | null)?.id ?? null;
  const bewertung = { ...gemerkt(einheit.bewertung), ...umbenennen(bewertungMerken(daten, unitId)) };
  await db.update(schema.dealEinheiten).set({ bewertung }).where(eq(schema.dealEinheiten.id, einheitId));
  await auditSchreiben(db, {
    type: 'mutation', entity: 'deal-einheit', entityId: einheitId, action: 'propstack-unit-create', collection: 'deal_einheiten',
    source: '/api/deals/{id}/einheiten/{einheitId}/propstack', metadata: { dealId, unitId, status: antwort.status },
  });
  if (!antwort.ok) throw new FachFehler(503, `Propstack antwortete mit ${antwort.status}`, { daten: antwort.daten });
  return { unitId: unitId === null ? null : String(unitId), url: unitId ? propstackUnitUrl(unitId) : null, daten: antwort.daten };
}

/** Die gemerkten Angaben liegen unter den alten Feldnamen (_ps…), damit Altbestand und Neubau dasselbe lesen. */
const umbenennen = (m: ReturnType<typeof bewertungMerken>) => ({
  ...(m.unitId ? { _psUnitId: m.unitId } : {}),
  _psLetzteModernisierung: m.letzteModernisierung, _psEtage: m.etage, _psEtagenzahl: m.etagenzahl,
  _psBalkonFlaeche: m.balkonFlaeche, _psQualitaet: m.qualitaet,
});

/** Bewertung nachlesen (GET /units/:id) — Lesen ist nicht gegatet. */
export async function propstackLesen(db: Db, ki: PropstackClient | null | undefined, dealId: string, einheitId: string) {
  const v = await propstackVorbelegen(db, dealId, einheitId);
  if (!v.unitId) throw new FachFehler(422, 'Diese Einheit liegt noch nicht in Propstack.');
  const antwort = await (await client(db, ki)).einheitLesen(v.unitId);
  if (!antwort.ok) throw new FachFehler(503, `Propstack antwortete mit ${antwort.status}`, { daten: antwort.daten });
  return { unitId: v.unitId, url: v.url, daten: antwort.daten };
}
