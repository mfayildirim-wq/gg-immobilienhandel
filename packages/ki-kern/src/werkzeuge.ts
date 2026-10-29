/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC-Antworten */
/**
 * Werkzeuge kommen aus dem MCP-Server der App — dieselben, die Claude und Cowork sehen. In gg ruft die Leiste das MCP
 * im selben Prozess (`mcpAufruf`); als eigener Dienst über HTTP (`mcpUeberHttp`). Die Quelle sieht in beiden Fällen gleich aus.
 */

export interface Werkzeug { name: string; title?: string; description: string; inputSchema: Record<string, unknown> }
export interface WerkzeugErgebnis { text: string; fehler: boolean }
export interface WerkzeugQuelle {
  liste(): Promise<Werkzeug[]>;
  aufrufen(name: string, argumente: Record<string, unknown>): Promise<WerkzeugErgebnis>;
}

/** Ein JSON-RPC-Aufruf an einen MCP-Server: Nachricht hinein, Antwort heraus. */
export type McpRpc = (nachricht: { jsonrpc: '2.0'; id: number; method: string; params?: unknown }) => Promise<any>;

export function quelleAusMcp(rpc: McpRpc): WerkzeugQuelle {
  let n = 0;
  const rufe = (method: string, params?: unknown) => rpc({ jsonrpc: '2.0', id: ++n, method, params });
  return {
    async liste() {
      const a = await rufe('tools/list');
      if (a?.error) throw new Error(`MCP tools/list: ${a.error.message}`);
      return (a?.result?.tools ?? []).map((t: any) => ({ name: t.name, ...(t.title ? { title: String(t.title) } : {}), description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' } }));
    },
    async aufrufen(name, argumente) {
      const a = await rufe('tools/call', { name, arguments: argumente });
      if (a?.error) return { text: String(a.error.message ?? 'Fehler'), fehler: true };
      const inhalt = (a?.result?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
      return { text: inhalt, fehler: Boolean(a?.result?.isError) };
    },
  };
}

/** MCP über HTTP (Streamable HTTP, nur die JSON-Antwort) — für den KI-Dienst außerhalb der App. */
export function mcpUeberHttp(url: string, schluessel: string, abruf: typeof fetch = fetch, zeitMs = 60_000): McpRpc {
  return async (nachricht) => {
    const res = await abruf(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${schluessel}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(nachricht),
      signal: AbortSignal.timeout(zeitMs),
    });
    const daten = await res.json().catch(() => null);
    if (!daten) return { jsonrpc: '2.0', id: nachricht.id, error: { code: res.status, message: `MCP antwortet mit ${res.status}` } };
    return daten;
  };
}
