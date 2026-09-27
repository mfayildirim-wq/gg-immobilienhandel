/**
 * MCP-Server als Werkzeugquelle des Agenten — nur über eine Internet-Adresse (Streamable HTTP, ersatzweise SSE), damit
 * es lokal wie online (Vercel) läuft. Jedes Werkzeug heißt `mcp_<server>_<werkzeug>`; ob es ohne Rückfrage laufen darf,
 * entscheidet der Kern (Freigabe in den Einstellungen), nicht der fremde Server.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpServerAngabe { name: string; url: string }

export interface McpWerkzeug {
  /** Name für das Modell: `mcp_<server>_<werkzeug>` */
  name: string;
  server: string;
  /** Name beim Server */
  original: string;
  beschreibung: string;
  /** JSON-Schema der Argumente (vom Server) */
  schema: Record<string, unknown>;
  /** Der Server sagt „nur lesend“ — nur ein Hinweis, die Freigabe entscheidet der Nutzer */
  liestNur: boolean;
  aufrufen: (args: Record<string, unknown>) => Promise<string>;
}

const ZEIT_MS = 10_000;

const kurz = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const mcpWerkzeugName = (server: string, werkzeug: string) => `mcp_${kurz(server)}_${kurz(werkzeug)}`.slice(0, 64);

/** „Authorization: Bearer …“ → Kopfzeilen; leer → keine */
export function kopfzeilen(kopf?: string): Record<string, string> {
  if (!kopf?.trim()) return {};
  const i = kopf.indexOf(':');
  if (i < 1) throw new Error('Kopfzeile bitte als „Name: Wert“ angeben, z. B. „Authorization: Bearer …“');
  return { [kopf.slice(0, i).trim()]: kopf.slice(i + 1).trim() };
}

async function verbinden(s: McpServerAngabe, kopf?: string): Promise<Client> {
  const adresse = new URL(s.url);
  const requestInit = { headers: kopfzeilen(kopf) };
  const mitZeit = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, nein) => setTimeout(() => nein(new Error(`MCP-Server „${s.name}“ antwortet nicht`)), ZEIT_MS))]);
  const client = new Client({ name: 'cosai-agentmode', version: '1.0.0' });
  try {
    await mitZeit(client.connect(new StreamableHTTPClientTransport(adresse, { requestInit })));
    return client;
  } catch (e) {
    await client.close().catch(() => undefined);
    // Ältere Server sprechen nur SSE — ein zweiter Versuch, dann die erste Fehlermeldung
    const alt = new Client({ name: 'cosai-agentmode', version: '1.0.0' });
    try {
      await mitZeit(alt.connect(new SSEClientTransport(adresse, { requestInit })));
      return alt;
    } catch {
      await alt.close().catch(() => undefined);
      throw new Error(`MCP-Server „${s.name}“: ${(e as Error).message}`);
    }
  }
}

/** Text aus dem Ergebnis eines MCP-Aufrufs (Textteile; andere Inhalte als Hinweis) */
function ergebnisText(r: { content?: unknown; isError?: boolean }): string {
  const teile = Array.isArray(r.content) ? r.content as { type: string; text?: string }[] : [];
  const text = teile.map((t) => (t.type === 'text' ? t.text ?? '' : `[${t.type}]`)).join('\n').trim();
  return r.isError ? `Fehler des Werkzeugs: ${text || 'ohne Meldung'}` : text || '(leer)';
}

/**
 * Verbindet sich, listet die Werkzeuge und trennt wieder. Jeder spätere Aufruf verbindet sich neu — ohne offene
 * Verbindung zwischen zwei Anfragen (Vercel-Funktionen leben nicht so lange).
 */
export async function mcpVerbinden(s: McpServerAngabe, kopf?: string): Promise<McpWerkzeug[]> {
  const client = await verbinden(s, kopf);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: mcpWerkzeugName(s.name, t.name),
      server: s.name,
      original: t.name,
      beschreibung: t.description ?? t.title ?? t.name,
      schema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      liestNur: t.annotations?.readOnlyHint === true,
      aufrufen: async (args) => {
        const c = await verbinden(s, kopf);
        try {
          return ergebnisText(await c.callTool({ name: t.name, arguments: args }) as { content?: unknown; isError?: boolean });
        } finally {
          await c.close().catch(() => undefined);
        }
      },
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}
