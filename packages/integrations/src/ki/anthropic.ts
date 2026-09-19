// Anthropic-Aufrufe (Messages + Files API). Übernommen aus gg-immohandel server/anthropic.ts;
// geändert: der Schlüssel wird übergeben statt aus dem verschlüsselten KV gelesen (Quelle regelt die API).

const ZEITLIMIT_MS = 120_000;
const FILES_BETA = 'files-api-2025-04-14';
const BASIS = 'https://api.anthropic.com/v1';

export interface KiClient {
  nachricht(body: unknown, zeitlimitMs?: number): Promise<any>;
  dateiHochladen(bytes: Uint8Array, dateiname: string, typ?: string, zeitlimitMs?: number): Promise<string>;
  dateiLoeschen(fileId: string): Promise<void>;
}

async function mitZeitlimit(url: string, init: RequestInit, zeitlimitMs: number, was: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), zeitlimitMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error(`${was} dauerte länger als ${zeitlimitMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function anthropicClient(apiKey: string): KiClient {
  const kopf = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': FILES_BETA };
  return {
    async nachricht(body, zeitlimitMs = ZEITLIMIT_MS) {
      const resp = await mitZeitlimit(`${BASIS}/messages`, { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, zeitlimitMs, 'Die Antwort von Anthropic');
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
      return resp.json();
    },
    async dateiHochladen(bytes, dateiname, typ = 'application/pdf', zeitlimitMs = ZEITLIMIT_MS) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: typ }), dateiname);
      const resp = await mitZeitlimit(`${BASIS}/files`, { method: 'POST', headers: kopf, body: form }, zeitlimitMs, 'Der Upload zu Anthropic');
      if (!resp.ok) throw new Error(`Anthropic-Upload ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
      const data = (await resp.json()) as { id?: string };
      if (!data?.id) throw new Error('Anthropic hat keine Datei-Kennung zurückgegeben');
      return data.id;
    },
    async dateiLoeschen(fileId) {
      // Wirft nicht: Aufräumen darf ein fertiges Ergebnis nicht nachträglich scheitern lassen.
      try {
        await fetch(`${BASIS}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: kopf });
      } catch (e) {
        console.warn('[anthropic] Datei konnte nicht gelöscht werden:', fileId, e);
      }
    },
  };
}
