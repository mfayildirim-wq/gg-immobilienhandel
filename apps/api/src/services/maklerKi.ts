import type { NachrichtEntwurf, PersonaStand } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { collectOutgoingComm, erwaehnungenAnhaengen, geburtstagHinweis, erwaehnungenPruefen, kommZeitstempel, type PersonaProfile, personaGetConfidence, persoenlichesZusammenfuehren } from '@gg/domain';
import {
  beziehungsprofil, erwaehnungenExtrahieren, gespraechsoeffner, type KontaktAnlass, kontaktAnlaesse, type Nachricht, osintSuche, type WebTreffer, type KiAntwort, type KiClient, kostenBuchung, maklerZusammenfassung, nachrichtEntwerfen, persoenlichesExtrahieren, stilAnalysieren, transkribieren,
} from '@gg/integrations';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';

const PERSONA_PROFIL = 'persona-profil';

async function kostenBuchen(db: Db, a: KiAntwort<unknown>, quelle: string, metadata: Record<string, unknown>) {
  try {
    const b = kostenBuchung(a.model, a.usage, quelle, metadata);
    await auditSchreiben(db, { type: b.type, aiModel: b.ai_model, aiFunction: quelle, source: quelle, inputTokens: b.input_tokens, outputTokens: b.output_tokens, costEur: b.cost_eur, metadata: b.metadata });
  } catch (e) {
    console.error('[ki] Kostenbuchung fehlgeschlagen:', e);
  }
}

const kiPruefen = (ki: KiClient | null | undefined) => {
  if (!ki) throw new FachFehler(422, 'KI ist nicht eingerichtet (ANTHROPIC_API_KEY).');
  return ki;
};

/** Makler und Kommunikation im Altformat (neueste zuerst, `ts` wie die alte Sammlung). */
async function maklerMitKomm(db: Db, id: string) {
  const [m] = await db.select().from(schema.makler).where(and(eq(schema.makler.id, id), isNull(schema.makler.deletedAt)));
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  const zeilen = await db.select().from(schema.maklerKommunikation).where(eq(schema.maklerKommunikation.maklerId, id)).orderBy(sql`${schema.maklerKommunikation.zeitpunkt} desc nulls last`, desc(schema.maklerKommunikation.id));
  const komm = zeilen.filter((k) => k.text).map((k) => ({ id: k.id, ts: kommZeitstempel(k.zeitpunkt), kanal: k.kanal ?? 'notiz', richtung: k.richtung, betreff: k.betreff, text: k.text! }));
  return { m, komm };
}

/** mkTriggerAISummary: nach jedem Eintrag; schreibt ai_summary frisch (parallel laufende Erwähnungen bleiben erhalten). */
export async function zusammenfassungErstellen(db: Db, ki: KiClient | null | undefined, id: string) {
  const { m, komm } = await maklerMitKomm(db, id);
  const a = await maklerZusammenfassung(kiPruefen(ki), m, komm);
  if (!a) return { kiSummary: m.kiSummary, kiSummaryAt: m.kiSummaryAt ? kommZeitstempel(m.kiSummaryAt) : null };
  await kostenBuchen(db, a, 'makler/zusammenfassung', { makler_id: id });
  const [neu] = await db.update(schema.makler).set({ kiSummary: a.wert, kiSummaryAt: sql`now()` }).where(eq(schema.makler.id, id)).returning({ at: schema.makler.kiSummaryAt });
  return { kiSummary: a.wert, kiSummaryAt: neu?.at ? kommZeitstempel(neu.at) : null };
}

/** personaExtractMentions: nur für Texte ab 25 Zeichen; Erwähnungen vorn in persoenlich.letzteErwaehnung. */
export async function erwaehnungenErgaenzen(db: Db, ki: KiClient | null | undefined, id: string, text: string, kanal: string, heuteDe: string) {
  if (!erwaehnungenPruefen(text)) return { neu: 0 };
  const a = await erwaehnungenExtrahieren(kiPruefen(ki), text.trim(), kanal);
  await kostenBuchen(db, a, 'makler/erwaehnungen', { makler_id: id });
  if (!a.wert.length) return { neu: 0 };
  await db.transaction(async (tx) => {
    const [m] = await tx.select({ p: schema.makler.persoenlich }).from(schema.makler).where(eq(schema.makler.id, id)).for('update');
    if (!m) return;
    await tx.update(schema.makler).set({ persoenlich: erwaehnungenAnhaengen(m.p as never, a.wert, heuteDe) }).where(eq(schema.makler.id, id));
  });
  return { neu: a.wert.length };
}

/** personaExtractRelationshipNote: Profil erzeugen und als Beziehungsnotiz speichern. */
export async function beziehungsprofilErstellen(db: Db, ki: KiClient | null | undefined, id: string) {
  const { m, komm } = await maklerMitKomm(db, id);
  let a: KiAntwort<string>;
  try {
    a = await beziehungsprofil(kiPruefen(ki), m, komm);
  } catch (e) {
    if (e instanceof FachFehler) throw e;
    throw new FachFehler(422, (e as Error).message);
  }
  await kostenBuchen(db, a, 'makler/beziehungsprofil', { makler_id: id });
  if (a.wert) await db.update(schema.makler).set({ beziehungsNotiz: a.wert, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.makler.id, id));
  return { beziehungsNotiz: a.wert };
}

/** personaExtractPersonalDetails: extrahieren und mit Vorrang für gefüllte manuelle Werte zusammenführen. */
export async function persoenlichesErgaenzen(db: Db, ki: KiClient | null | undefined, id: string) {
  const { m, komm } = await maklerMitKomm(db, id);
  if (!komm.length) return { persoenlich: m.persoenlich ?? {} };
  const a = await persoenlichesExtrahieren(kiPruefen(ki), m, komm);
  if (!a) throw new FachFehler(422, 'Persönlichkeitsanalyse fehlgeschlagen');
  await kostenBuchen(db, a, 'makler/persoenliches', { makler_id: id });
  const persoenlich = persoenlichesZusammenfuehren((m.persoenlich ?? {}) as never, a.wert);
  await db.update(schema.makler).set({ persoenlich, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.makler.id, id));
  return { persoenlich };
}

/** Alle Makler mit ihrer Kommunikation im Altformat (für Konfidenz und Stilanalyse). */
async function alleMaklerMitKomm(db: Db) {
  const makler = await db.select({ id: schema.makler.id, name: schema.makler.name }).from(schema.makler).where(isNull(schema.makler.deletedAt));
  const komm = makler.length ? await db.select().from(schema.maklerKommunikation).where(inArray(schema.maklerKommunikation.maklerId, makler.map((x) => x.id))) : [];
  return makler.map((mk) => ({ name: mk.name, komm: komm.filter((k) => k.maklerId === mk.id).map((k) => ({ ts: kommZeitstempel(k.zeitpunkt), kanal: k.kanal, richtung: k.richtung, betreff: k.betreff, text: k.text })) }));
}

export async function personaStand(db: Db): Promise<PersonaStand> {
  const alle = await alleMaklerMitKomm(db);
  const [z] = await db.select({ w: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, PERSONA_PROFIL));
  return {
    profil: (z?.w as PersonaProfile | undefined) ?? null,
    konfidenz: personaGetConfidence(alle),
    ausgehend: alle.reduce((s, mk) => s + mk.komm.filter((k) => k.richtung === 'ausgehend').length, 0),
  };
}

/** personaAnalyse (Sonnet): Kommunikationsstil aus den neuesten 80 ausgehenden Nachrichten. */
export async function personaAnalysieren(db: Db, ki: KiClient | null | undefined): Promise<PersonaStand> {
  const alle = await alleMaklerMitKomm(db);
  const { entries, total } = collectOutgoingComm(alle);
  let a: KiAntwort<PersonaProfile>;
  try {
    a = await stilAnalysieren(kiPruefen(ki), entries, total, personaGetConfidence(alle), new Date().toISOString());
  } catch (e) {
    if (e instanceof FachFehler) throw e;
    throw new FachFehler(422, (e as Error).message);
  }
  await kostenBuchen(db, a, 'persona/analyse', { eintraege: total });
  await db.insert(schema.einstellungen).values({ schluessel: PERSONA_PROFIL, wert: a.wert, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: a.wert, updatedAt: sql`now()` } });
  return personaStand(db);
}

/** personaDraftMessage: WhatsApp + E-Mail (braucht ein analysiertes Profil). */
export async function entwurfErstellen(db: Db, ki: KiClient | null | undefined, id: string): Promise<NachrichtEntwurf> {
  const stand = await personaStand(db);
  if (!stand.profil) throw new FachFehler(422, 'Bitte zuerst Kommunikationsstil analysieren');
  const { m, komm } = await maklerMitKomm(db, id);
  const deals = await db.select({ status: schema.deals.status, adresse: schema.objekte.strasse, stadt: schema.objekte.stadt }).from(schema.deals)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(eq(schema.deals.maklerId, id), isNull(schema.deals.deletedAt), ne(schema.deals.status, 'Archiv')));
  let a: KiAntwort<NachrichtEntwurf>;
  try {
    a = await nachrichtEntwerfen(kiPruefen(ki), stand.profil, { name: m.name, firma: m.firma, lastContact: m.lastContact, erstellt: m.createdAt.slice(0, 10), relationshipNote: m.beziehungsNotiz, personal: m.persoenlich as never }, komm, deals, new Date());
  } catch (e) {
    if (e instanceof FachFehler) throw e;
    throw new FachFehler(422, `Entwurf fehlgeschlagen: ${(e as Error).message}`);
  }
  await kostenBuchen(db, a, 'persona/entwurf', { makler_id: id });
  return a.wert;
}

/** POST /api/transcribe: Whisper; Fehler von OpenAI mit Grund, 429 bleibt 429. */
export async function transkription(db: Db, openaiKey: string | undefined, audio: Uint8Array, typ: string) {
  if (!openaiKey) throw new FachFehler(422, 'OpenAI-Key nicht konfiguriert. Bitte in den Einstellungen hinterlegen.');
  if (!audio.byteLength) throw new FachFehler(400, 'Keine Audio-Datei');
  if (audio.byteLength > 25 * 1024 * 1024) throw new FachFehler(413, 'Die Aufnahme ist größer als 25 MB.');
  try {
    const text = await transkribieren(openaiKey, audio, typ);
    await auditSchreiben(db, { type: 'kicall', aiModel: 'whisper-1', aiFunction: 'transcribe', source: '/api/transkription', metadata: { audio_size: audio.byteLength, text_chars: text.length } });
    return { text };
  } catch (e) {
    throw new FachFehler(503, `Transkription fehlgeschlagen: ${(e as Error).message}`, { hint: 'OpenAI-Key in den Einstellungen prüfen; bei „insufficient_quota" ist das Guthaben aufgebraucht.' });
  }
}

// ── Anreicherung: Kontakt-Anlässe, Gesprächsöffner, OSINT ─────
export interface Suchdienste { web: (q: string) => Promise<WebTreffer[]>; news: (q: string) => Promise<Nachricht[]> }

/**
 * Anlässe 24 Stunden je Makler zwischenspeichern — in der Datenbank (alt: localStorage immo-hooks-<id>, je Browser).
 * So kostet ein Makler einen Aufruf am Tag, egal wie oft, wo und von welcher Function-Instanz er angesehen wird.
 */
const TAG_MS = 24 * 60 * 60 * 1000;

async function anlaesseAusSpeicher(db: Db, id: string, jetzt = Date.now()): Promise<KontaktAnlass[] | null> {
  const [z] = await db.select({ am: schema.maklerAnlaesse.ermitteltAt, anlaesse: schema.maklerAnlaesse.anlaesse }).from(schema.maklerAnlaesse).where(eq(schema.maklerAnlaesse.maklerId, id));
  if (!z || jetzt - Date.parse(z.am) >= TAG_MS) return null;
  return z.anlaesse as KontaktAnlass[];
}

/** fetchAiHooks: Web-Suche + News → Haiku; ohne Treffer keine Anlässe. */
export async function kontaktAnlaesseErmitteln(db: Db, ki: KiClient | null | undefined, suche: Suchdienste, id: string, heute: string) {
  const gecacht = await anlaesseAusSpeicher(db, id);
  if (gecacht) return { anlaesse: gecacht };
  const { m } = await maklerMitKomm(db, id);
  const persoenlich = (m.persoenlich ?? {}) as { geburtsdatum?: string };
  const a = await kontaktAnlaesse(kiPruefen(ki), m.name ?? '', m.firma ?? undefined, persoenlich.geburtsdatum, new Date(`${heute}T12:00:00`), suche.web, suche.news);
  if (a) await kostenBuchen(db, a, 'makler/anlaesse', { makler_id: id });
  const anlaesse = a?.wert ?? [];
  await db.insert(schema.maklerAnlaesse).values({ maklerId: id, anlaesse, ermitteltAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.maklerAnlaesse.maklerId, set: { anlaesse, ermitteltAt: sql`now()` } });
  return { anlaesse };
}

/** vtGenerateCallOpener: Geburtstag, Anlässe (aus dem Zwischenspeicher), Erwähnungen, Beziehung, letzte Kommunikation. */
export async function gespraechsoeffnerErstellen(db: Db, ki: KiClient | null | undefined, id: string, heute: string) {
  const { m, komm } = await maklerMitKomm(db, id);
  const persoenlich = (m.persoenlich ?? {}) as { geburtsdatum?: string; letzteErwaehnung?: { thema: string; detail: string }[] };
  const gb = geburtstagHinweis(persoenlich.geburtsdatum, heute);
  const gecacht = await anlaesseAusSpeicher(db, id);
  const a = await gespraechsoeffner(kiPruefen(ki), { name: m.name, firma: m.firma, relationshipNote: m.beziehungsNotiz }, {
    geburtstagLabel: gb?.label ?? null, anlaesse: gecacht ?? [],
    erwaehnungen: persoenlich.letzteErwaehnung ?? [], letzteKommunikation: komm[0]?.text ?? null,
  });
  await kostenBuchen(db, a, 'makler/gespraechsoeffner', { makler_id: id });
  return { text: a.wert || 'Gesprächsöffner konnte nicht generiert werden.' };
}

/** mkRunOSINT: Ergebnis in persoenlich.personenInfo (frisch gelesen, andere Felder bleiben). */
export async function osintAusfuehren(db: Db, suche: Suchdienste, id: string) {
  const { m } = await maklerMitKomm(db, id);
  const info = await osintSuche(m.name ?? '', m.firma ?? '', new Date().toISOString(), suche.web);
  const persoenlich = await db.transaction(async (tx) => {
    const [f] = await tx.select({ p: schema.makler.persoenlich }).from(schema.makler).where(eq(schema.makler.id, id)).for('update');
    const neu = { ...((f?.p as Record<string, unknown> | null) ?? {}), personenInfo: info };
    await tx.update(schema.makler).set({ persoenlich: neu, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.makler.id, id));
    return neu;
  });
  return { persoenlich };
}
