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
import { type Db, schema } from '@gg/db';
import {
  LOKALE_SCOPES, MCP_FEHLERTEXTE, type McpFehlerCode, MCP_KEYS_ENV, type McpScope, MCP_SERVER_NAME, MCP_SERVER_VERSION,
  mcpSchluesselAusKopf, nachweislichLokal, schluesselVerzeichnis, type Umgebung, werkzeugErlaubt, werkzeugVerzeichnis,
} from '@gg/domain';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditListe, auditSchreiben } from './audit.ts';
import { dealDetail, dealListe } from './deals.ts';
import { dokumenteListe } from './dateien.ts';
import { freigabeBeantragen } from './outward.ts';
import { maklerDetail, maklerListe } from './makler.ts';
import { objektDetail, objekteListe } from './objekte.ts';

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

interface Werkzeug {
  name: string; scope: McpScope; title: string; description: string;
  inputSchema: Record<string, unknown>;
  run(db: Db, args: Record<string, unknown>, sitzung: McpSitzung): Promise<unknown>;
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
    description: 'Liest einen Deal, Makler oder ein Objekt mit allen Feldern.',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: [...BEREICHE] }, id: { type: 'string' } }, required: ['collection', 'id'], additionalProperties: false },
    async run(db, args) {
      const bereich = text(args, 'collection');
      const id = text(args, 'id');
      if (bereich === 'deals') return dealDetail(db, id);
      if (bereich === 'makler') return maklerDetail(db, id);
      if (bereich === 'objekte') return objektDetail(db, id);
      throw new McpWerkzeugFehler(`Unbekannter Bestand "${bereich}".`);
    },
  },
  {
    name: 'list_files', scope: 'read', title: 'Dateien eines Deals auflisten',
    description: 'Nennt die Dokumente eines Deals (Name, Bezeichnung, Größe).',
    inputSchema: { type: 'object', properties: { dealId: { type: 'string' } }, required: ['dealId'], additionalProperties: false },
    async run(db, args) {
      return { dateien: await dokumenteListe(db, { art: 'deal', id: text(args, 'dealId') }) };
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
    name: 'add_note', scope: 'write', title: 'Notiz anlegen',
    description: 'Hängt einen Kommentar an einen Deal — der einzige Schreibweg dieses Servers.',
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
export async function mcpAufruf(db: Db, nachricht: any, sitzung: McpSitzung) {
  const id: RpcId = nachricht?.id ?? null;
  const benachrichtigung = nachricht?.id === undefined;
  if (nachricht?.jsonrpc !== '2.0') return benachrichtigung ? null : fehler(id, RPC.INVALID_REQUEST, 'Feld "jsonrpc" muss "2.0" sein.');

  switch (nachricht.method) {
    case 'initialize':
      return ergebnis(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: `Angemeldet als "${sitzung.label}" mit den Bereichen ${sitzung.scopes.join(', ')}.`,
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
        const wert = await werkzeug.run(db, (nachricht.params?.arguments ?? {}) as Record<string, unknown>, sitzung);
        return ergebnis(id, { content: [{ type: 'text', text: JSON.stringify(wert, null, 1) }], isError: false });
      } catch (e) {
        if (e instanceof McpWerkzeugFehler) return ergebnis(id, { content: [{ type: 'text', text: e.message }], isError: true });
        console.error(`[mcp] Werkzeug "${name}" fehlgeschlagen:`, e);
        return ergebnis(id, { content: [{ type: 'text', text: `Das Werkzeug "${name}" ist fehlgeschlagen. Einzelheiten stehen im Server-Log.` }], isError: true });
      }
    }
    default:
      return benachrichtigung ? null : fehler(id, RPC.METHOD_NOT_FOUND, `Unbekannte Methode "${String(nachricht.method)}".`);
  }
}

/** Ein Rumpf kann eine Nachricht oder ein Stapel sein. */
export async function mcpVerarbeiten(db: Db, rumpf: unknown, sitzung: McpSitzung) {
  if (Array.isArray(rumpf)) {
    const antworten = (await Promise.all(rumpf.map((n) => mcpAufruf(db, n, sitzung)))).filter(Boolean);
    return antworten.length ? antworten : null;
  }
  return mcpAufruf(db, rumpf, sitzung);
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
