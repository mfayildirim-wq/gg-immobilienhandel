// Anthropic-Aufrufe (Messages + Files API). Übernommen aus gg-immohandel server/anthropic.ts;
// geändert: der Schlüssel wird übergeben statt aus dem verschlüsselten KV gelesen (Quelle regelt die API).

const ZEITLIMIT_MS = 120_000;
const FILES_BETA = 'files-api-2025-04-14';
const BASIS = 'https://api.anthropic.com/v1';

/** Anthropic lehnt den Schlüssel ab (401/403): ungültig, gesperrt oder ohne Rechte. Die API macht daraus eine klare Meldung. */
export class KiSchluesselFehler extends Error {
  constructor(readonly status: number, readonly antwort: string) {
    super(`Anthropic ${status}: ${antwort}`);
    this.name = 'KiSchluesselFehler';
  }
}

export type KiFehlerArt = 'limit' | 'guthaben' | 'rate' | 'ueberlastet' | 'stoerung' | 'anfrage' | 'zeitlimit' | 'netz';

/**
 * Anthropic antwortet mit einem Fehler (Nutzungslimit, Guthaben, zu viele Anfragen, Überlast, Störung, abgelehnte Anfrage)
 * oder ist nicht erreichbar. `meldung` ist für Menschen und geht so an die Oberfläche; `antwort` ist der Rohtext fürs Log.
 */
export class KiDienstFehler extends Error {
  constructor(readonly status: number, readonly art: KiFehlerArt, readonly meldung: string, readonly antwort = '') {
    super(meldung);
    this.name = 'KiDienstFehler';
  }
}

const UTC_DATUM = /(\d{4})-(\d{2})-(\d{2})(?: at (\d{2}:\d{2}))?/;

/** Fehlerantwort von Anthropic in Art und deutsche Meldung übersetzen. */
export function kiFehlerDeuten(status: number, text: string): { art: KiFehlerArt; meldung: string } {
  let nachricht = text;
  try { nachricht = (JSON.parse(text) as { error?: { message?: string } })?.error?.message || text; } catch { /* kein JSON */ }
  nachricht = nachricht.replace(/\s+/g, ' ').trim().substring(0, 300);
  if (/usage limit/i.test(nachricht)) {
    const d = nachricht.match(UTC_DATUM);
    const ab = d ? ` Wieder verfügbar ab ${d[3]}.${d[2]}.${d[1]}${d[4] ? `, ${d[4]} UTC` : ''}.` : '';
    return { art: 'limit', meldung: `Das Nutzungslimit des Anthropic-Kontos ist erreicht — die KI-Auswertung ist gesperrt.${ab} Das Limit lässt sich in der Anthropic-Konsole (Settings → Limits) erhöhen.` };
  }
  if (/credit balance|billing/i.test(nachricht)) {
    return { art: 'guthaben', meldung: 'Das Guthaben des Anthropic-Kontos ist aufgebraucht — bitte in der Anthropic-Konsole (Billing) aufladen.' };
  }
  if (status === 429) return { art: 'rate', meldung: 'Anthropic meldet zu viele Anfragen in kurzer Zeit — bitte in einer Minute erneut versuchen.' };
  if (status === 529 || /overloaded/i.test(nachricht)) return { art: 'ueberlastet', meldung: 'Anthropic ist gerade überlastet — bitte in ein paar Minuten erneut versuchen.' };
  if (status >= 500) return { art: 'stoerung', meldung: `Anthropic hat eine Störung (${status}) — bitte später erneut versuchen.` };
  return { art: 'anfrage', meldung: `Anthropic lehnt die Anfrage ab (${status}): ${nachricht}` };
}

async function fehlerAus(resp: Response, was: string): Promise<Error> {
  const voll = await resp.text();
  const text = voll.substring(0, 200);
  if (resp.status === 401 || resp.status === 403) return new KiSchluesselFehler(resp.status, text);
  const { art, meldung } = kiFehlerDeuten(resp.status, voll);
  return new KiDienstFehler(resp.status, art, meldung, `${was} ${resp.status}: ${text}`);
}

/**
 * „Schlüssel testen“: fragt die Modellliste ab — kostet nichts und braucht nur einen gültigen Schlüssel.
 * `abruf` ist für Tests austauschbar.
 */
export async function anthropicSchluesselPruefen(apiKey: string, abruf: typeof fetch = fetch): Promise<{ gueltig: boolean; meldung: string }> {
  try {
    const resp = await abruf(`${BASIS}/models?limit=1`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
    if (resp.ok) return { gueltig: true, meldung: 'Schlüssel gültig — Anthropic hat ihn angenommen.' };
    if (resp.status === 401 || resp.status === 403) return { gueltig: false, meldung: `Schlüssel abgelehnt (${resp.status}): ungültig, gesperrt oder ohne Rechte.` };
    return { gueltig: false, meldung: `Anthropic antwortete mit ${resp.status} — bitte später erneut testen.` };
  } catch {
    return { gueltig: false, meldung: 'Anthropic ist nicht erreichbar — bitte später erneut testen.' };
  }
}

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
    if ((e as Error)?.name === 'AbortError') throw new KiDienstFehler(0, 'zeitlimit', `${was} dauerte länger als ${zeitlimitMs / 1000} s — bitte erneut versuchen.`);
    throw new KiDienstFehler(0, 'netz', `Anthropic ist nicht erreichbar (${(e as Error)?.message ?? 'Netzwerkfehler'}) — bitte Verbindung prüfen und erneut versuchen.`);
  } finally {
    clearTimeout(timer);
  }
}

export function anthropicClient(apiKey: string): KiClient {
  const kopf = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': FILES_BETA };
  return {
    async nachricht(body, zeitlimitMs = ZEITLIMIT_MS) {
      const resp = await mitZeitlimit(`${BASIS}/messages`, { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, zeitlimitMs, 'Die Antwort von Anthropic');
      if (!resp.ok) throw await fehlerAus(resp, 'Anthropic');
      return resp.json();
    },
    async dateiHochladen(bytes, dateiname, typ = 'application/pdf', zeitlimitMs = ZEITLIMIT_MS) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: typ }), dateiname);
      const resp = await mitZeitlimit(`${BASIS}/files`, { method: 'POST', headers: kopf, body: form }, zeitlimitMs, 'Der Upload zu Anthropic');
      if (!resp.ok) throw await fehlerAus(resp, 'Anthropic-Upload');
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
