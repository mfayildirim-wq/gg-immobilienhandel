/* eslint-disable @typescript-eslint/no-explicit-any -- Werkzeug-Argumente kommen als JSON vom Aufrufer */
/**
 * MCP-Server: Transport (JSON-RPC über HTTP), Anmeldung mit Schlüssel und die Werkzeuge.
 * Nach gg-immohandel server/mcp.ts und server/mcp-tools.ts. Die reinen Regeln (Bereiche, Verzeichnis,
 * „nachweislich lokal“) liegen in @gg/domain; hier steht der Rand: wer ruft, was darf er, und was tut das Werkzeug.
 *
 * Grundsätze der alten App, unverändert:
 *  • Voreinstellung gesperrt: ein Werkzeug ohne gültigen Bereich ist weder auflistbar noch aufrufbar.
 *  • Schlüssel liegen nur als SHA-256 vor, verglichen wird in konstanter Zeit.
 *  • Kein Cookie-Pfad — ein Browser schickt Cookies bei jedem fremden POST mit.
 *  • Scharf ist der Endpunkt überall außer „nachweislich lokal“; dort gilt der volle Bereichssatz.
 *  • Protokollfehler sind JSON-RPC-Fehler, Werkzeugfehler ein Ergebnis mit `isError`.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { AnrufErgebnisSpeichern, KommunikationAnlegen, MaklerAendern, MaklerAnlegen, MaklerPersoenlich, ObjektAendern, ObjektAnlegen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  anlegenTrotzTreffern, feldAenderungen, type GedaechtnisArt, LOKALE_SCOPES, maklerKandidaten, maklerSuchen, MCP_FEHLERTEXTE, type McpFehlerCode,
  MCP_KEYS_ENV, type McpScope, MCP_SERVER_NAME, MCP_SERVER_VERSION, mcpSchluesselAusKopf, nachweislichLokal, objektKandidaten,
  schluesselVerzeichnis, type Umgebung, werkzeugErlaubt, werkzeugVerzeichnis,
} from '@gg/domain';
import type { GedaechtnisDienst } from '@gg/integrations';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FachFehler } from '../fehler.ts';
import { anrufErgebnis, dealAnrufErgebnis, terminSetzen } from './ankauf.ts';
import { auditListe, auditSchreiben } from './audit.ts';
import { dealDetail, dealErledigt, dealListe } from './deals.ts';
import { dokumenteListe } from './dealDokumente.ts';
import { gedaechtnisAblegen, gedaechtnisEintraege, gedaechtnisSuchen } from './gedaechtnis.ts';
import { freigabeBeantragen } from './outward.ts';
import { begleitscheinDetail } from './begleitscheine.ts';
import { kundenkalkulationDetail } from './kundenkalkulationen.ts';
import { kommunikationAnlegen, maklerAendern, maklerAnlegen, maklerDetail, maklerErledigt, maklerListe, maklerPersoenlichSpeichern } from './makler.ts';
import { objektAendern, objektAnlegen, objektDetail, objekteListe } from './objekte.ts';
import { projektDetail } from './projekte.ts';
import { vertriebslisteDetail } from './vertriebslisten.ts';

/** Kopfzeilen von Hono kommen als flaches Objekt; die Regel erwartet die lose Form. */
export const mcpSchluesselAusKopfOderNull = (kopf: Record<string, string | undefined>) => mcpSchluesselAusKopf(kopf);

export interface McpSitzung { label: string; scopes: readonly McpScope[]; modus: 'key' | 'local' }
export type McpAnmeldung = { ok: true; sitzung: McpSitzung } | { ok: false; code: McpFehlerCode; status: number; message: string; detail?: string };

/** authenticateMcp: vergleicht den SHA-256 in konstanter Zeit und ohne vorzeitigen Ausstieg. */
export function mcpAnmelden(vorgelegt: string | null, env: Umgebung): McpAnmeldung {
  if (nachweislichLokal(env)) return { ok: true, sitzung: { label: 'local', scopes: LOKALE_SCOPES, modus: 'local' } };
  const verzeichnis = schluesselVerzeichnis(env[MCP_KEYS_ENV]);
  if (verzeichnis.rejected.length) console.warn('[mcp] verworfene Schlüsseleinträge:', verzeichnis.rejected.join(' | '));
  if (!verzeichnis.keys.length) return { ok: false, code: 'not-configured', ...MCP_FEHLERTEXTE['not-configured'], detail: `${MCP_KEYS_ENV} enthält keinen brauchbaren Eintrag` };
  if (!vorgelegt) return { ok: false, code: 'no-key', ...MCP_FEHLERTEXTE['no-key'] };

  const digest = createHash('sha256').update(vorgelegt, 'utf8').digest();
  let treffer: { label: string; scopes: McpScope[] } | null = null;
  for (const k of verzeichnis.keys) {
    const hinterlegt = Buffer.from(k.hash, 'hex');
    if (hinterlegt.length === digest.length && timingSafeEqual(hinterlegt, digest)) treffer = k;
  }
  if (!treffer) return { ok: false, code: 'invalid-key', ...MCP_FEHLERTEXTE['invalid-key'] };
  return { ok: true, sitzung: { label: treffer.label, scopes: treffer.scopes, modus: 'key' } };
}

// ── Werkzeuge ───────────────────────────────────────────────

export class McpWerkzeugFehler extends Error {}

/** Was ein Werkzeug außer der Datenbank braucht; der Gedächtnis-Dienst wird erst beim Aufruf aufgelöst. */
export interface McpUmfeld { gedaechtnis: () => Promise<GedaechtnisDienst | null> }
const OHNE_UMFELD: McpUmfeld = { gedaechtnis: async () => null };

interface Werkzeug {
  name: string; scope: McpScope; title: string; description: string;
  inputSchema: Record<string, unknown>;
  run(db: Db, args: Record<string, unknown>, sitzung: McpSitzung, umfeld: McpUmfeld): Promise<unknown>;
}

const text = (args: Record<string, unknown>, feld: string, pflicht = true): string => {
  const v = args[feld];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (pflicht) throw new McpWerkzeugFehler(`Feld "${feld}" fehlt oder ist leer.`);
  return '';
};
const zahl = (args: Record<string, unknown>, feld: string, standard: number) => {
  const v = args[feld];
  return typeof v === 'number' && Number.isFinite(v) ? v : standard;
};

const BEREICHE = ['deals', 'makler', 'objekte'] as const;

/** Einzeln lesbar ist alles, was in gg einen eigenen Dialog hat — dieselben Bestände haben ein Gedächtnis. */
const EINZELN: Record<string, { art: GedaechtnisArt; lesen: (db: Db, id: string) => Promise<unknown> }> = {
  deals: { art: 'deal', lesen: dealDetail },
  makler: { art: 'makler', lesen: maklerDetail },
  objekte: { art: 'objekt', lesen: objektDetail },
  projekte: { art: 'projekt', lesen: projektDetail },
  kundenkalkulationen: { art: 'kundenkalkulation', lesen: kundenkalkulationDetail },
  vertriebslisten: { art: 'vertriebsliste', lesen: vertriebslisteDetail },
  begleitscheine: { art: 'begleitschein', lesen: begleitscheinDetail },
};
/** Bestand zur Gedächtnis-Art, z. B. für die KI-Leiste: 'objekt' → 'objekte'. */
export const mcpBestandZu = (art: GedaechtnisArt) => Object.entries(EINZELN).find(([, e]) => e.art === art)?.[0] ?? null;

const GEDAECHTNIS_BEREICHE: Record<string, GedaechtnisArt> = Object.fromEntries(Object.entries(EINZELN).map(([b, e]) => [b, e.art]));
const gedaechtnisBezugArgs = { collection: { type: 'string', enum: Object.keys(GEDAECHTNIS_BEREICHE) }, id: { type: 'string' } };
function gedaechtnisBezugAus(args: Record<string, unknown>, pflicht: true): { art: GedaechtnisArt; id: string };
function gedaechtnisBezugAus(args: Record<string, unknown>, pflicht: false): { art: GedaechtnisArt; id: string } | undefined;
function gedaechtnisBezugAus(args: Record<string, unknown>, pflicht: boolean) {
  const bereich = text(args, 'collection', pflicht);
  const id = text(args, 'id', pflicht);
  if (!bereich && !id) return undefined;
  const art = GEDAECHTNIS_BEREICHE[bereich];
  if (!art) throw new McpWerkzeugFehler(`Gedächtnis gibt es für ${Object.keys(GEDAECHTNIS_BEREICHE).join(', ')}, nicht für "${bereich}".`);
  if (!id) throw new McpWerkzeugFehler('Feld "id" fehlt oder ist leer.');
  return { art, id };
}
/** Fehler des Dienstes (nicht eingerichtet, nicht erreichbar, nicht erlaubt) gehen als Werkzeugfehler an die KI. */
async function ausDemGedaechtnis<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof FachFehler) throw new McpWerkzeugFehler(e.message);
    throw e;
  }
}

// ── Schreiben (29.10.2026): dieselben Verträge und Services wie die App ──

const heuteBerlin = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

/** Werkzeug-Argumente gegen den Vertrag der App; ein unbekanntes Feld ist ein Fehler, kein stilles Weglassen. */
function pruefen<S extends z.ZodObject>(vertrag: S, args: Record<string, unknown>): z.output<S> {
  const r = vertrag.strict().safeParse(args);
  if (r.success) return r.data as z.output<S>;
  throw new McpWerkzeugFehler(`Eingabe ungültig: ${r.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ')}`);
}
/** Eingabeschema für Claude aus demselben Vertrag — was hier steht, ist zugleich die Liste der erlaubten Felder. */
const alsSchema = (vertrag: z.ZodObject) => z.toJSONSchema(vertrag.strict(), { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;

/** Jede Änderung über Claude steht im Audit-Log: alter und neuer Wert, Werkzeug und Schlüssel. */
const protokollieren = (db: Db, sitzung: McpSitzung, e: { werkzeug: string; entity: string; entityId: string; action: string; alt?: unknown; neu?: unknown }) =>
  auditSchreiben(db, {
    type: 'mutation', entity: e.entity, entityId: e.entityId, action: e.action, collection: e.entity, source: `mcp/${e.werkzeug}`,
    // Die KI-Leiste schreibt nur, was der angemeldete Nutzer per Karte übernommen hat (Label `leiste:<nutzer>`)
    oldValue: e.alt, newValue: e.neu, metadata: { mcp: sitzung.label, ueber: sitzung.label.startsWith('leiste:') ? 'KI-Leiste (vom Nutzer übernommen)' : 'Claude (MCP)' },
  });

const Id = z.string().trim().min(1);
const Version = z.number().int().describe('Version aus read_entity. Hat jemand den Datensatz inzwischen geändert, lehnt gg ab: neu lesen, dann erneut.');
const TrotzdemAnlegen = z.boolean().optional().describe('Nur setzen, wenn die gemeldeten ähnlichen Einträge geprüft wurden und keiner gemeint ist.');
const Ziel = z.enum(['makler', 'deals']);

/** Makler ändern: alle Felder der App außer „letzter Kontakt“ (den setzt die Kommunikation), dazu der Persönlich-Reiter. */
const MaklerAendernMcp = MaklerAendern.omit({ lastContact: true }).extend({
  id: Id, version: Version,
  geburtsdatum: MaklerPersoenlich.shape.geburtsdatum.optional(), anredeForm: MaklerPersoenlich.shape.anredeForm.optional(),
});
/** Makler anlegen: Grundfelder wie im Dialog „Neuer Makler“, dazu Kontakt- und Herkunftsfelder. */
const MaklerZusatz = MaklerAendern.pick({ webseite: true, mobil: true, festnetz: true, strasse: true, plz: true, ort: true, anrede: true, position: true, hinweis: true, quelle: true, nextContact: true });
const MaklerNeuMcp = MaklerAnlegen.extend({ ...MaklerZusatz.shape, trotzdemAnlegen: TrotzdemAnlegen });
const KommunikationMcp = KommunikationAnlegen.extend({ maklerId: Id });
const TerminMcp = z.object({ collection: Ziel, id: Id, version: Version, nextContact: z.iso.date().nullable().describe('JJJJ-MM-TT; null entfernt den Termin') });
const ErledigtMcp = z.object({ collection: Ziel, id: Id, version: Version });
const AnrufMcp = AnrufErgebnisSpeichern.extend({
  collection: Ziel, id: Id, version: Version,
  notiz: AnrufErgebnisSpeichern.shape.notiz.optional(),
  frequenz: AnrufErgebnisSpeichern.shape.frequenz.optional().describe('Ohne Angabe bleibt die bisherige Frequenz'),
  rueckrufDatum: AnrufErgebnisSpeichern.shape.rueckrufDatum.optional(),
});
const ObjektNeuMcp = ObjektAnlegen.extend({ trotzdemAnlegen: TrotzdemAnlegen });
/** Objekt ändern ohne die Einheitenaufstellung — die ersetzt die ganze Liste und bleibt der App vorbehalten. */
const ObjektAendernMcp = ObjektAendern.omit({ einheiten: true }).extend({ id: Id, version: Version });

const maklerKurz = (m: { id: string; name: string | null; firma: string | null; email: string | null; tel: string | null; prio: string | null; version: number }) =>
  ({ id: m.id, name: m.name, firma: m.firma, email: m.email, tel: m.tel, prio: m.prio, version: m.version });

export const MCP_WERKZEUGE: Werkzeug[] = [
  {
    name: 'list_collections', scope: 'read', title: 'Bestände auflisten',
    description: 'Nennt die lesbaren Bestände (Deals, Makler, Objekte) mit ihrer Größe.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(db) {
      const zaehle = async (t: any) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(t).where(isNull(t.deletedAt)))[0]?.n ?? 0);
      return {
        collections: [
          { name: 'deals', anzahl: await zaehle(schema.deals) },
          { name: 'makler', anzahl: await zaehle(schema.makler) },
          { name: 'objekte', anzahl: await zaehle(schema.objekte) },
        ],
      };
    },
  },
  {
    name: 'read_collection', scope: 'read', title: 'Bestand lesen',
    description: 'Liest einen Bestand (deals, makler, objekte); `limit` begrenzt die Zeilen (Standard 50).',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: [...BEREICHE] }, limit: { type: 'number' } }, required: ['collection'], additionalProperties: false },
    async run(db, args) {
      const bereich = text(args, 'collection');
      const limit = Math.min(Math.max(zahl(args, 'limit', 50), 1), 500);
      if (!BEREICHE.includes(bereich as never)) throw new McpWerkzeugFehler(`Unbekannter Bestand "${bereich}" (erlaubt: ${BEREICHE.join(', ')}).`);
      const zeilen = bereich === 'deals' ? await dealListe(db) : bereich === 'makler' ? await maklerListe(db) : await objekteListe(db);
      return { collection: bereich, zeilen: zeilen.slice(0, limit) };
    },
  },
  {
    name: 'read_entity', scope: 'read', title: 'Datensatz lesen',
    description: 'Liest einen Datensatz mit allen Feldern: Deal, Makler, Objekt, Projekt, Kundenkalkulation, Vertriebsliste oder Begleitschein.',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: Object.keys(EINZELN) }, id: { type: 'string' } }, required: ['collection', 'id'], additionalProperties: false },
    async run(db, args) {
      const bereich = text(args, 'collection');
      const id = text(args, 'id');
      const e = EINZELN[bereich];
      if (!e) throw new McpWerkzeugFehler(`Unbekannter Bestand "${bereich}".`);
      return e.lesen(db, id);
    },
  },
  {
    name: 'list_files', scope: 'read', title: 'Dateien eines Deals auflisten',
    description: 'Nennt die Dokumente eines Deals (Name, Bezeichnung, Größe).',
    inputSchema: { type: 'object', properties: { dealId: { type: 'string' } }, required: ['dealId'], additionalProperties: false },
    async run(db, args) {
      return { dateien: await dokumenteListe(db, text(args, 'dealId')) };
    },
  },
  {
    name: 'read_audit_log', scope: 'read', title: 'Audit-Log lesen',
    description: 'Liest den Verlauf; Filter wie in der App (type, entity, suche, limit).',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, entity: { type: 'string' }, suche: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
    async run(db, args) {
      return auditListe(db, {
        type: text(args, 'type', false) || undefined, entity: text(args, 'entity', false) || undefined,
        suche: text(args, 'suche', false) || undefined, limit: Math.min(Math.max(zahl(args, 'limit', 50), 1), 500),
      });
    },
  },
  {
    name: 'find_makler', scope: 'read', title: 'Makler suchen',
    description: 'Sucht Makler nach Name, Firma, E-Mail oder Telefon (jedes Wort muss vorkommen). Vor dem Anlegen oder Ändern nutzen.',
    inputSchema: { type: 'object', properties: { suche: { type: 'string' }, limit: { type: 'number' } }, required: ['suche'], additionalProperties: false },
    async run(db, args) {
      const treffer = maklerSuchen(await maklerListe(db), text(args, 'suche'), Math.min(Math.max(zahl(args, 'limit', 20), 1), 100));
      return { treffer: treffer.map(maklerKurz) };
    },
  },
  {
    name: 'create_makler', scope: 'write', title: 'Makler anlegen',
    description: 'Legt einen Makler an. Vorher prüft gg auf Dubletten: gleiche E-Mail oder Telefonnummer sperrt (dann update_makler), '
      + 'ein ähnlicher Name sperrt, bis "trotzdemAnlegen": true gesetzt ist. Gibt die Kandidaten zurück.',
    inputSchema: alsSchema(MaklerNeuMcp),
    async run(db, args, sitzung) {
      const { trotzdemAnlegen, ...e } = pruefen(MaklerNeuMcp, args);
      if (!e.name?.trim() && !e.firma?.trim()) throw new McpWerkzeugFehler('Name oder Firma angeben.');
      const kandidaten = maklerKandidaten(e, await maklerListe(db));
      const darf = anlegenTrotzTreffern(kandidaten, trotzdemAnlegen ?? false);
      if (!darf.ok) return { angelegt: false, grund: darf.grund, kandidaten: kandidaten.map((k) => ({ ...maklerKurz(k.eintrag), sicherheit: k.sicherheit, grund: k.grund })) };
      const { vorname, name, firma, tel, email, prio, kontaktFrequenz, ...zusatz } = e;
      const neu = await maklerAnlegen(db, { vorname, name, firma, tel, email, prio, kontaktFrequenz });
      const version = Object.values(zusatz).some((v) => v !== undefined) ? (await maklerAendern(db, neu.id, { version: neu.version, ...zusatz })).version : neu.version;
      await protokollieren(db, sitzung, { werkzeug: 'create_makler', entity: 'makler', entityId: neu.id, action: 'mcp-create', neu: e });
      return { angelegt: true, id: neu.id, version };
    },
  },
  {
    name: 'update_makler', scope: 'write', title: 'Makler ändern',
    description: 'Ändert Felder eines Maklers (Kontakt, Firma, Webseite, Anschrift, Prio, Frequenz, Hinweis, Geburtstag …). '
      + 'Nur mitgegebene Felder ändern sich; "" leert ein Feld. Firma, Webseite und Anschrift gelten für das Unternehmen.',
    inputSchema: alsSchema(MaklerAendernMcp),
    async run(db, args, sitzung) {
      const { id, geburtsdatum, anredeForm, ...e } = pruefen(MaklerAendernMcp, args);
      const vorher = await maklerDetail(db, id);
      const { version } = await maklerAendern(db, id, e);
      const persoenlich = (vorher.persoenlich ?? {}) as { geburtsdatum?: string; anredeForm?: '' | 'du' | 'sie' };
      if (geburtsdatum !== undefined || anredeForm !== undefined) {
        await maklerPersoenlichSpeichern(db, id, { geburtsdatum: geburtsdatum ?? persoenlich.geburtsdatum ?? '', anredeForm: anredeForm ?? persoenlich.anredeForm ?? '' });
      }
      const aenderungen = feldAenderungen({ ...vorher, ...persoenlich }, { ...e, geburtsdatum, anredeForm });
      await protokollieren(db, sitzung, { werkzeug: 'update_makler', entity: 'makler', entityId: id, action: 'mcp-update', alt: Object.fromEntries(aenderungen.map((a) => [a.feld, a.alt])), neu: Object.fromEntries(aenderungen.map((a) => [a.feld, a.neu])) });
      return { id, version: (await maklerDetail(db, id)).version, geaendert: aenderungen.map((a) => a.feld) };
    },
  },
  {
    name: 'add_communication', scope: 'write', title: 'Kommunikation beim Makler eintragen',
    description: 'Trägt eine Mail, einen Anruf, eine WhatsApp oder eine Notiz in die Kommunikation des Maklers ein. '
      + 'Mit "datum" (Tag der Mail) rückt der letzte Kontakt auf diesen Tag, ohne auf heute — nie zurück.',
    inputSchema: alsSchema(KommunikationMcp),
    async run(db, args, sitzung) {
      const { maklerId, ...e } = pruefen(KommunikationMcp, args);
      const neu = await kommunikationAnlegen(db, maklerId, e, heuteBerlin());
      await protokollieren(db, sitzung, { werkzeug: 'add_communication', entity: 'makler', entityId: maklerId, action: 'mcp-kommunikation', neu: e });
      return { id: neu.id, maklerId };
    },
  },
  {
    name: 'set_next_contact', scope: 'write', title: 'Nächsten Kontakt setzen',
    description: 'Setzt den nächsten Kontakttermin eines Maklers oder Deals (null entfernt ihn).',
    inputSchema: alsSchema(TerminMcp),
    async run(db, args, sitzung) {
      const e = pruefen(TerminMcp, args);
      const r = await terminSetzen(db, e.collection, e.id, e.version, e.nextContact);
      await protokollieren(db, sitzung, { werkzeug: 'set_next_contact', entity: e.collection === 'deals' ? 'deal' : 'makler', entityId: e.id, action: 'mcp-termin', neu: { nextContact: e.nextContact } });
      return r;
    },
  },
  {
    name: 'mark_done', scope: 'write', title: 'Als erledigt markieren',
    description: '„Erledigt“ wie im Cockpit: letzter Kontakt heute, nächster nach der Kontakt- bzw. Nachfassfrequenz.',
    inputSchema: alsSchema(ErledigtMcp),
    async run(db, args, sitzung) {
      const e = pruefen(ErledigtMcp, args);
      const r = e.collection === 'deals' ? await dealErledigt(db, e.id, e.version, heuteBerlin()) : await maklerErledigt(db, e.id, e.version, heuteBerlin());
      await protokollieren(db, sitzung, { werkzeug: 'mark_done', entity: e.collection === 'deals' ? 'deal' : 'makler', entityId: e.id, action: 'mcp-erledigt', neu: r });
      return r;
    },
  },
  {
    name: 'log_call_result', scope: 'write', title: 'Anruf-Ergebnis eintragen',
    description: 'Wie in der Wählmaschine: Ergebnis (erreicht, nicht, rueckruf) mit Notiz; setzt letzten und nächsten Kontakt. '
      + 'Am Makler wird die Notiz ein Anruf in der Kommunikation, am Deal ein Kommentar.',
    inputSchema: alsSchema(AnrufMcp),
    async run(db, args, sitzung) {
      const { collection, id, ...e } = pruefen(AnrufMcp, args);
      const deal = collection === 'deals';
      const frequenz = e.frequenz ?? (deal ? (await dealDetail(db, id)).nachfassFrequenz : (await maklerDetail(db, id)).kontaktFrequenz) ?? 'Monatlich';
      const eingabe = { version: e.version, ergebnis: e.ergebnis, notiz: e.notiz ?? '', frequenz, rueckrufDatum: e.rueckrufDatum ?? null };
      const r = deal ? await dealAnrufErgebnis(db, id, eingabe, heuteBerlin()) : await anrufErgebnis(db, id, eingabe, heuteBerlin());
      await protokollieren(db, sitzung, { werkzeug: 'log_call_result', entity: deal ? 'deal' : 'makler', entityId: id, action: 'mcp-anruf', neu: eingabe });
      return r;
    },
  },
  {
    name: 'create_objekt', scope: 'write', title: 'Objekt anlegen',
    description: 'Legt ein Objekt an. Gleiche Adresse sperrt (dann update_objekt), eine ähnliche Adresse sperrt, bis "trotzdemAnlegen": true gesetzt ist.',
    inputSchema: alsSchema(ObjektNeuMcp),
    async run(db, args, sitzung) {
      const { trotzdemAnlegen, ...e } = pruefen(ObjektNeuMcp, args);
      if (!e.strasse?.trim() && !e.stadt?.trim()) throw new McpWerkzeugFehler('Straße oder Stadt angeben.');
      const kandidaten = objektKandidaten(e, await objekteListe(db));
      const darf = anlegenTrotzTreffern(kandidaten, trotzdemAnlegen ?? false);
      if (!darf.ok) return { angelegt: false, grund: darf.grund, kandidaten: kandidaten.map((k) => ({ ...k.eintrag, sicherheit: k.sicherheit, grund: k.grund })) };
      const neu = await objektAnlegen(db, e);
      await protokollieren(db, sitzung, { werkzeug: 'create_objekt', entity: 'objekt', entityId: neu.id, action: 'mcp-create', neu: e });
      return { angelegt: true, id: neu.id, version: neu.version };
    },
  },
  {
    name: 'update_objekt', scope: 'write', title: 'Objekt ändern',
    description: 'Ändert Felder eines Objekts (Adresse, Baujahr, Flächen, Preise, Mieten, Notizen …); null leert eine Zahl. Die Einheitenaufstellung bleibt der App vorbehalten.',
    inputSchema: alsSchema(ObjektAendernMcp),
    async run(db, args, sitzung) {
      const { id, ...e } = pruefen(ObjektAendernMcp, args);
      const vorher = await objektDetail(db, id);
      const r = await objektAendern(db, id, e);
      const aenderungen = feldAenderungen(vorher, e);
      await protokollieren(db, sitzung, { werkzeug: 'update_objekt', entity: 'objekt', entityId: id, action: 'mcp-update', alt: Object.fromEntries(aenderungen.map((a) => [a.feld, a.alt])), neu: Object.fromEntries(aenderungen.map((a) => [a.feld, a.neu])) });
      return { ...r, geaendert: aenderungen.map((a) => a.feld) };
    },
  },
  {
    name: 'add_note', scope: 'write', title: 'Notiz anlegen',
    description: 'Hängt einen Kommentar an einen Deal.',
    inputSchema: { type: 'object', properties: { dealId: { type: 'string' }, text: { type: 'string' } }, required: ['dealId', 'text'], additionalProperties: false },
    async run(db, args, sitzung) {
      const dealId = text(args, 'dealId');
      const inhalt = text(args, 'text');
      const [deal] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
      if (!deal) throw new McpWerkzeugFehler('Deal nicht gefunden.');
      const [neu] = await db.insert(schema.dealKommentare)
        .values({ id: `${dealId}:${crypto.randomUUID()}`, dealId, text: `${inhalt}\n\n(über MCP: ${sitzung.label})`, zeitpunkt: sql`now()` })
        .returning({ id: schema.dealKommentare.id });
      await auditSchreiben(db, { type: 'mutation', entity: 'deal', entityId: dealId, action: 'mcp-note', collection: 'deal_kommentare', source: 'mcp/add_note', newValue: inhalt, metadata: { mcp: sitzung.label } });
      return { id: neu!.id, dealId };
    },
  },
  {
    name: 'gedaechtnis_suchen', scope: 'read', title: 'Im Gedächtnis suchen',
    description: 'Sucht im zentralen Gedächtnis (gg-Ereignisse, gemerkte Notizen, KI-Gespräche, freigegebene andere Apps). '
      + 'Mit `collection` und `id` nur zu einem Datensatz (Deal, Makler, Objekt, Projekt …).',
    inputSchema: { type: 'object', properties: { frage: { type: 'string' }, ...gedaechtnisBezugArgs }, required: ['frage'], additionalProperties: false },
    async run(_db, args, _sitzung, umfeld) {
      const frage = text(args, 'frage');
      const bezug = gedaechtnisBezugAus(args, false);
      return ausDemGedaechtnis(async () => gedaechtnisSuchen(await umfeld.gedaechtnis(), frage, bezug));
    },
  },
  {
    name: 'gedaechtnis_eintraege', scope: 'read', title: 'Gedächtnis zu einem Datensatz',
    description: 'Alle gültigen Gedächtnis-Einträge zu einem Deal, Makler, Objekt, Projekt … — neueste zuerst (wie in der KI-Leiste der App).',
    inputSchema: { type: 'object', properties: gedaechtnisBezugArgs, required: ['collection', 'id'], additionalProperties: false },
    async run(_db, args, _sitzung, umfeld) {
      const { art, id } = gedaechtnisBezugAus(args, true);
      return ausDemGedaechtnis(async () => gedaechtnisEintraege(await umfeld.gedaechtnis(), art, id));
    },
  },
  {
    // 26.10.2026: wörtlich als EIN Eintrag — die Faktenextraktion zerlegte eine Recherche in viele Einzeleinträge
    name: 'gedaechtnis_merken', scope: 'write', title: 'Im Gedächtnis ablegen',
    description: 'Legt ein Ergebnis zu einem Datensatz (Deal, Makler, Objekt, Projekt …) im Gedächtnis ab, z. B. eine Recherche, eine Zusammenfassung oder Absprachen. '
      + 'Gespeichert wird genau ein Eintrag mit `titel` und dem vollständigen `text` (Markdown: Überschriften, Listen, Tabellen, Links); '
      + 'in gg ist er in der KI-Leiste und im Reiter „Gedächtnis“ zu sehen. Derselbe Titel am selben Datensatz ersetzt den alten Eintrag — '
      + 'für eine neue Fassung also denselben Titel nehmen, für ein anderes Thema einen anderen.',
    inputSchema: {
      type: 'object',
      properties: { ...gedaechtnisBezugArgs, titel: { type: 'string', description: 'kurz, z. B. „Vergleichsangebote Umgebung“' }, text: { type: 'string' } },
      required: ['collection', 'id', 'titel', 'text'], additionalProperties: false,
    },
    async run(_db, args, sitzung, umfeld) {
      const { art, id } = gedaechtnisBezugAus(args, true);
      const titel = text(args, 'titel').slice(0, 200);
      const inhalt = text(args, 'text');
      if (inhalt.length > 100_000) throw new McpWerkzeugFehler('Der Text ist zu lang (höchstens 100 000 Zeichen).');
      return ausDemGedaechtnis(async () => gedaechtnisAblegen(await umfeld.gedaechtnis(), art, id, titel, inhalt, `mcp:${sitzung.label}`));
    },
  },
  {
    name: 'request_outward_approval', scope: 'outward', title: 'Freigabe für eine Aktion nach außen beantragen',
    description: 'Legt einen Freigabe-Antrag an. Es wird NICHTS ausgeführt: die Freigabe erfolgt in der App, '
      + 'und auch danach läuft die Aktion nur, wenn das Default-Deny-Gate sie durchlässt.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, url: { type: 'string' }, grund: { type: 'string' }, bezug: { type: 'string' } },
      required: ['action', 'url', 'grund'], additionalProperties: false,
    },
    async run(db, args, sitzung) {
      const antrag = await freigabeBeantragen(db, {
        action: text(args, 'action'), url: text(args, 'url'), grund: text(args, 'grund'),
        bezug: text(args, 'bezug', false) || undefined, beantragtVon: `mcp:${sitzung.label}`,
      });
      return { antrag, hinweis: 'Der Antrag wartet in der App unter Einstellungen → Aktionen nach außen.' };
    },
  },
];

const VERZEICHNIS = werkzeugVerzeichnis(MCP_WERKZEUGE);
if (VERZEICHNIS.rejected.length) console.warn('[mcp] verworfene Werkzeuge:', VERZEICHNIS.rejected.join(' | '));
const WERKZEUGE = new Map(VERZEICHNIS.werkzeuge.map((w) => [w.name, w as Werkzeug]));

// ── JSON-RPC ────────────────────────────────────────────────

const RPC = { PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603, FORBIDDEN: -32003 } as const;
type RpcId = string | number | null;
const ergebnis = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const fehler = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });

/** Ein JSON-RPC-Aufruf. `null` bedeutet: Benachrichtigung, es geht keine Antwort zurück. */
export async function mcpAufruf(db: Db, nachricht: any, sitzung: McpSitzung, umfeld: McpUmfeld = OHNE_UMFELD) {
  const id: RpcId = nachricht?.id ?? null;
  const benachrichtigung = nachricht?.id === undefined;
  if (nachricht?.jsonrpc !== '2.0') return benachrichtigung ? null : fehler(id, RPC.INVALID_REQUEST, 'Feld "jsonrpc" muss "2.0" sein.');

  switch (nachricht.method) {
    case 'initialize':
      return ergebnis(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: `Angemeldet als "${sitzung.label}" mit den Bereichen ${sitzung.scopes.join(', ')}.`
          + (sitzung.scopes.includes('write')
            ? ' Vor dem Anlegen mit find_makler bzw. read_collection prüfen, ob es den Eintrag schon gibt; vor dem Ändern mit read_entity die aktuelle "version" lesen. Jede Änderung steht im Audit-Log.'
            : ''),
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return ergebnis(id, {});
    case 'tools/list':
      return ergebnis(id, {
        tools: [...WERKZEUGE.values()]
          .filter((w) => werkzeugErlaubt(w, sitzung.scopes))
          .map((w) => ({ name: w.name, title: w.title, description: w.description, inputSchema: w.inputSchema })),
      });
    case 'tools/call': {
      const name = String(nachricht.params?.name ?? '');
      const werkzeug = WERKZEUGE.get(name);
      if (!werkzeug) return fehler(id, RPC.METHOD_NOT_FOUND, `Unbekanntes Werkzeug "${name}".`);
      if (!werkzeugErlaubt(werkzeug, sitzung.scopes)) {
        return fehler(id, RPC.FORBIDDEN, `Werkzeug "${name}" verlangt den Bereich "${werkzeug.scope}"; dieser Schlüssel hat ${sitzung.scopes.join(', ') || 'keinen'}.`);
      }
      try {
        const wert = await werkzeug.run(db, (nachricht.params?.arguments ?? {}) as Record<string, unknown>, sitzung, umfeld);
        return ergebnis(id, { content: [{ type: 'text', text: JSON.stringify(wert, null, 1) }], isError: false });
      } catch (e) {
        if (e instanceof McpWerkzeugFehler) return ergebnis(id, { content: [{ type: 'text', text: e.message }], isError: true });
        // Fachfehler der Services (nicht gefunden, Version veraltet …) sagen Claude, was zu tun ist
        if (e instanceof FachFehler) return ergebnis(id, { content: [{ type: 'text', text: e.details ? `${e.message} ${JSON.stringify(e.details)}` : e.message }], isError: true });
        console.error(`[mcp] Werkzeug "${name}" fehlgeschlagen:`, e);
        return ergebnis(id, { content: [{ type: 'text', text: `Das Werkzeug "${name}" ist fehlgeschlagen. Einzelheiten stehen im Server-Log.` }], isError: true });
      }
    }
    default:
      return benachrichtigung ? null : fehler(id, RPC.METHOD_NOT_FOUND, `Unbekannte Methode "${String(nachricht.method)}".`);
  }
}

/** Ein Rumpf kann eine Nachricht oder ein Stapel sein. */
export async function mcpVerarbeiten(db: Db, rumpf: unknown, sitzung: McpSitzung, umfeld: McpUmfeld = OHNE_UMFELD) {
  if (Array.isArray(rumpf)) {
    const antworten = (await Promise.all(rumpf.map((n) => mcpAufruf(db, n, sitzung, umfeld)))).filter(Boolean);
    return antworten.length ? antworten : null;
  }
  return mcpAufruf(db, rumpf, sitzung, umfeld);
}

/** Übersicht für die Oberfläche: Bereiche, Werkzeuge, hinterlegte Schlüssel (nur Label und Bereiche). */
export function mcpStand(env: Umgebung) {
  const verzeichnis = schluesselVerzeichnis(env[MCP_KEYS_ENV]);
  return {
    lokal: nachweislichLokal(env),
    schluessel: verzeichnis.keys.map((k) => ({ label: k.label, scopes: k.scopes })),
    verworfen: verzeichnis.rejected,
    werkzeuge: [...WERKZEUGE.values()].map((w) => ({ name: w.name, scope: w.scope, title: w.title, description: w.description })),
  };
}
