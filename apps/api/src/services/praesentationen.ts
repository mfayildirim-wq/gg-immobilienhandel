import type { Praesentation, PraesentationKi, PraesentationSpeichern, PraesentationVorbelegen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  deckblattVorbelegen, type FinanzPraes, type FinanzpraesDefaults, finanzierungVorbelegen, finanzpraesDefaultsZusammenfuehren, kiFehlerHinweis,
  LAGE_KI_OHNE_ADRESSE, lageKiEingabe, lageKiHinweis, lageKiUebernehmen, leereFolie, mietenaufstellungVorbelegen, mitStandards, OBJEKT_KI_OHNE_DATEN,
  flaechenVorbelegen, objektbeschreibungVorbelegen, objektKiEingabe, objektKiHinweis, objektKiUebernehmen, projektkalkulationVorbelegen, type Slide, type SlideTyp,
  STANDARD_PRESET_ORDER, verkaufspreiseVorbelegen,
} from '@gg/domain';
import { type KiAntwort, type KiClient, kostenBuchung, lagebeschreibungGenerieren, objektbeschreibungGenerieren } from '@gg/integrations';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';
import { dealUndObjektAlt } from './altformat.ts';

const STANDARD_SCHLUESSEL = 'finanzpraes-standard';

export async function praesentationStandardLesen(db: Db): Promise<FinanzpraesDefaults> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, STANDARD_SCHLUESSEL));
  return finanzpraesDefaultsZusammenfuehren(z?.wert);
}

export async function praesentationStandardSpeichern(db: Db, wert: FinanzpraesDefaults): Promise<FinanzpraesDefaults> {
  await db.insert(schema.einstellungen).values({ schluessel: STANDARD_SCHLUESSEL, wert, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert, updatedAt: sql`now()` } });
  return praesentationStandardLesen(db);
}

async function laden(db: Db, id: string): Promise<Praesentation> {
  const [p] = await db.select().from(schema.finanzpraesentationen).where(and(eq(schema.finanzpraesentationen.id, id), isNull(schema.finanzpraesentationen.deletedAt)));
  if (!p) throw new FachFehler(404, 'Präsentation nicht gefunden');
  const folien = await db.select().from(schema.praesentationFolien).where(eq(schema.praesentationFolien.praesentationId, id)).orderBy(asc(schema.praesentationFolien.sort));
  return {
    id: p.id, dealId: p.dealId, bankName: p.bankName ?? '', internNotiz: p.internNotiz ?? '', version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
    slides: folien.map((f) => ({ id: f.id, typ: f.typ ?? '', visible: f.sichtbar !== false, data: (f.daten as Record<string, unknown> | null) ?? {} })),
  };
}

export const praesentationDetail = laden;

/** Die (höchstens eine) aktive Präsentation eines Deals; bei Altbestand mit mehreren die älteste (alt: erste im Array). */
export async function praesentationZumDeal(db: Db, dealId: string): Promise<Praesentation | null> {
  const [p] = await db.select({ id: schema.finanzpraesentationen.id }).from(schema.finanzpraesentationen)
    .where(and(eq(schema.finanzpraesentationen.dealId, dealId), isNull(schema.finanzpraesentationen.deletedAt)))
    .orderBy(asc(schema.finanzpraesentationen.createdAt), asc(schema.finanzpraesentationen.id)).limit(1);
  return p ? laden(db, p.id) : null;
}

async function folienSchreiben(tx: Parameters<Parameters<Db['transaction']>[0]>[0], praesentationId: string, slides: PraesentationSpeichern['slides']) {
  await tx.delete(schema.praesentationFolien).where(eq(schema.praesentationFolien.praesentationId, praesentationId));
  if (slides.length) {
    await tx.insert(schema.praesentationFolien).values(slides.map((s, sort) => ({ id: s.id, praesentationId, typ: s.typ, sichtbar: s.visible, sort, daten: s.data })));
  }
}

/** Pro Deal höchstens eine aktive Präsentation (alte App: getFinanzPraesForDeal). Vorlage „standard“ = IVT-Pitch mit 13 Folien. */
export async function praesentationAnlegen(db: Db, dealId: string, vorlage: 'leer' | 'standard'): Promise<Praesentation> {
  const [deal] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
  if (!deal) throw new FachFehler(404, 'Deal nicht gefunden');
  if (await praesentationZumDeal(db, dealId)) throw new FachFehler(409, 'Für diesen Deal gibt es bereits eine Präsentation');
  const defaults = await praesentationStandardLesen(db);
  const id = crypto.randomUUID();
  const slides: Slide[] = vorlage === 'standard' ? STANDARD_PRESET_ORDER.map((t) => leereFolie(t, defaults, crypto.randomUUID())) : [];
  await db.transaction(async (tx) => {
    await tx.insert(schema.finanzpraesentationen).values({ id, dealId, bankName: '', internNotiz: '' });
    await folienSchreiben(tx, id, slides);
  });
  return laden(db, id);
}

export async function praesentationSpeichern(db: Db, id: string, e: PraesentationSpeichern): Promise<Praesentation> {
  const ids = new Set<string>();
  for (const s of e.slides) {
    if (ids.has(s.id)) throw new FachFehler(422, `Folien-ID doppelt: ${s.id}`);
    ids.add(s.id);
  }
  await db.transaction(async (tx) => {
    const [neu] = await tx.update(schema.finanzpraesentationen)
      .set({ bankName: e.bankName, internNotiz: e.internNotiz, version: sql`${schema.finanzpraesentationen.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.finanzpraesentationen.id, id), eq(schema.finanzpraesentationen.version, e.version), isNull(schema.finanzpraesentationen.deletedAt)))
      .returning({ id: schema.finanzpraesentationen.id });
    if (!neu) {
      const [da] = await tx.select({ v: schema.finanzpraesentationen.version }).from(schema.finanzpraesentationen).where(and(eq(schema.finanzpraesentationen.id, id), isNull(schema.finanzpraesentationen.deletedAt)));
      if (!da) throw new FachFehler(404, 'Präsentation nicht gefunden');
      throw new FachFehler(409, 'Präsentation wurde zwischenzeitlich geändert', { aktuelleVersion: da.v });
    }
    await folienSchreiben(tx, id, e.slides);
  });
  return laden(db, id);
}

export async function praesentationLoeschen(db: Db, id: string) {
  const [p] = await db.update(schema.finanzpraesentationen).set({ deletedAt: sql`now()` })
    .where(and(eq(schema.finanzpraesentationen.id, id), isNull(schema.finanzpraesentationen.deletedAt))).returning({ id: schema.finanzpraesentationen.id });
  if (!p) throw new FachFehler(404, 'Präsentation nicht gefunden');
  return { id };
}

const HINWEIS: Record<PraesentationVorbelegen['art'], string> = {
  deckblatt: 'Kein Deal/Objekt verknüpft',
  objektbeschreibung: 'Kein Deal/Objekt verknüpft',
  flaechen: 'Kein Deal/Objekt verknüpft',
  projektkalkulation: 'Deal hat keinen Kaufpreis in der Kalkulation',
  verkaufspreise: 'Keine Einheiten im Deal',
  mietenaufstellung: 'Keine Einheiten im Deal oder keine Spalte gewählt',
  finanzierung: 'Deal hat keinen Kaufpreis in der Kalkulation',
};

/** Wohn-, Gewerbe- und Mietfläche nach der Vorbelegung der alten App (Neuerung 06.10.2026). */
const flaechenNachVorbelegung = (d: Record<string, unknown> | null, deal: unknown, objekt: unknown) => (d ? flaechenVorbelegen(d, deal, objekt) : null);

/**
 * Vorbelegung einer Folie aus Deal/Objekt; speichert nicht (der Editor übernimmt das Ergebnis und speichert selbst).
 * `flaechen`: nur Wohn-, Gewerbe- und Mietfläche (Knopf neben der Mietfläche), der Rest der Folie bleibt.
 */
export async function praesentationVorbelegen(db: Db, id: string, v: PraesentationVorbelegen) {
  const p = await laden(db, id);
  const { deal, objekt } = await dealUndObjektAlt(db, p.dealId);
  const scope = v.scope ?? 'aufteiler';
  const data =
    v.art === 'deckblatt' ? deckblattVorbelegen(v.data, deal, objekt)
      : v.art === 'objektbeschreibung' ? flaechenNachVorbelegung(objektbeschreibungVorbelegen(v.data, deal, objekt), deal, objekt)
        : v.art === 'flaechen' ? (deal || objekt ? flaechenVorbelegen(v.data, deal, objekt) : null)
        : v.art === 'projektkalkulation' ? projektkalkulationVorbelegen(v.data, deal, scope)
          : v.art === 'verkaufspreise' ? verkaufspreiseVorbelegen(v.data, deal)
            : v.art === 'mietenaufstellung' ? mietenaufstellungVorbelegen(v.data, deal, v.spalten ?? [])
              : finanzierungVorbelegen(v.data, deal, scope);
  return { data, hinweis: data ? null : HINWEIS[v.art] };
}

/**
 * Die beiden KI-Texte (finanzpraesGenerateLageKI, finanzpraesGenerateObjektKI). Wie die Vorbelegung speichert der
 * Aufruf nicht: der Editor übernimmt das Ergebnis und speichert selbst. Fehlt die Grundlage (keine Adresse, keine
 * Fakten), kommt nur ein Hinweis zurück und die KI wird gar nicht gefragt.
 */
export async function praesentationKiText(db: Db, ki: KiClient | null | undefined, id: string, v: PraesentationKi) {
  const p = await laden(db, id);
  const { deal, objekt } = await dealUndObjektAlt(db, p.dealId);
  const lage = v.art === 'lage' ? lageKiEingabe(v.data, deal, objekt) : null;
  const objektEingabe = v.art === 'objekt' ? objektKiEingabe(v.data, deal, objekt) : null;
  if (!lage && !objektEingabe) return { data: null, hinweis: v.art === 'lage' ? LAGE_KI_OHNE_ADRESSE : OBJEKT_KI_OHNE_DATEN };
  if (!ki) throw new FachFehler(422, 'Keine KI eingerichtet: Anthropic-Schlüssel unter Einstellungen → Zugänge hinterlegen.');
  const quelle = `praesentation/${v.art}`;
  // Gebucht wird, sobald das Modell geantwortet hat — auch wenn die Antwort danach nicht taugt
  const buchen = async (a: KiAntwort<unknown>) => {
    try {
      const b = kostenBuchung(a.model, a.usage, quelle, { praesentation_id: id, deal_id: p.dealId });
      await auditSchreiben(db, { type: b.type, aiModel: b.ai_model, aiFunction: quelle, source: quelle, inputTokens: b.input_tokens, outputTokens: b.output_tokens, costEur: b.cost_eur, metadata: b.metadata });
    } catch (e) {
      console.error('[ki] Kostenbuchung fehlgeschlagen:', e);
    }
  };
  try {
    if (lage) {
      const a = await lagebeschreibungGenerieren(ki, lage);
      await buchen(a);
      const r = lageKiUebernehmen(v.data, a.wert);
      return { data: r.data, hinweis: lageKiHinweis(r.bullets) };
    }
    const a = await objektbeschreibungGenerieren(ki, objektEingabe!);
    await buchen(a);
    const r = objektKiUebernehmen(v.data, a.wert);
    return { data: r.data, hinweis: objektKiHinweis(r.woerter) };
  } catch (e) {
    console.error(`[${quelle}] KI-Text fehlgeschlagen:`, e);
    throw new FachFehler(500, kiFehlerHinweis(e instanceof Error ? e.message : 'Unbekannter Fehler'));
  }
}

/** Für den Export: gespeicherte Präsentation mit Einstellungs-Standards (expandWithDefaults). */
export async function praesentationFuerExport(db: Db, id: string): Promise<FinanzPraes> {
  const p = await laden(db, id);
  if (!p.slides.some((s) => s.visible)) throw new FachFehler(422, 'Keine sichtbaren Folien — bitte mindestens eine Folie einblenden');
  const praes: FinanzPraes = { ...p, slides: p.slides.map((s) => ({ ...s, typ: s.typ as SlideTyp, data: s.data as Record<string, unknown> })) };
  return mitStandards(praes, await praesentationStandardLesen(db));
}

export async function praesentationExportProtokollieren(db: Db, p: FinanzPraes, art: 'pdf' | 'pptx') {
  await auditSchreiben(db, {
    type: 'mutation', entity: 'finanzpraes', entityId: p.id, action: `${art}-export`, collection: 'finanzpraesentationen',
    source: `/api/praesentationen/{id}/${art}`, metadata: { bankName: p.bankName, slideCount: p.slides.length },
  });
}
