/**
 * Eine öffentliche Webseite als Text lesen — für den AgentMode („Seite lesen“). Die Adresse stammt vom Sprachmodell
 * und kann aus gelesenen Inhalten eingeschleust sein; deshalb strenger als die Zielprüfung des Auto-Imports:
 * Name UND aufgelöste IP-Adressen müssen öffentlich sein, jede Weiterleitung wird einzeln geprüft.
 */
import { lookup } from 'node:dns/promises';
import { zielPruefen } from '../autoimport/engine.ts';

export interface SeiteLesenOptionen {
  abruf?: typeof fetch;
  /** Namensauflösung (Test: fest); Vorgabe: alle Adressen über das System */
  aufloesen?: (host: string) => Promise<string[]>;
  zeitMs?: number;
  maxZeichen?: number;
}

const PRIVAT_V4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;

function ipIntern(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a.includes(':')) {
    const v4 = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (v4) return PRIVAT_V4.test(v4);
    return a === '::1' || a === '::' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a) || /^ff/.test(a);
  }
  return PRIVAT_V4.test(a);
}

const standardAufloesen = async (host: string) => (await lookup(host, { all: true })).map((e) => e.address);

async function pruefen(adresse: string, aufloesen: (host: string) => Promise<string[]>): Promise<URL> {
  const ziel = zielPruefen(adresse);
  if (!ziel.ok) throw new Error(ziel.grund);
  const host = ziel.url.hostname.replace(/^\[|\]$/g, '');
  const adressen = /^[\d.]+$/.test(host) || host.includes(':') ? [host] : await aufloesen(host);
  if (!adressen.length || adressen.some(ipIntern)) throw new Error('interne Adresse — wird nicht geöffnet');
  return ziel.url;
}

function entitaeten(text: string): string {
  const benannt: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', sup2: '²', sup3: '³' };
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, n: string) => benannt[n] ?? m);
}

/** HTML → lesbarer Text: Titel, dann Inhalt ohne Skripte, Stile, Navigation; Blöcke als Zeilen. */
export function htmlAlsText(html: string): string {
  const titel = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const rumpf = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = entitaeten(rumpf).split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return [titel ? entitaeten(titel) : '', text].filter(Boolean).join('\n\n');
}

export async function seiteLesen(adresse: string, opt: SeiteLesenOptionen = {}): Promise<string> {
  const abruf = opt.abruf ?? fetch;
  const aufloesen = opt.aufloesen ?? standardAufloesen;
  const maxZeichen = opt.maxZeichen ?? 60_000;
  let url = await pruefen(adresse, aufloesen);
  for (let sprung = 0; sprung < 4; sprung += 1) {
    const res = await abruf(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opt.zeitMs ?? 10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (GG-Immobilienhandel AgentMode)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400) {
      const weiter = res.headers.get('location');
      if (!weiter) throw new Error(`Weiterleitung ohne Ziel (${res.status})`);
      url = await pruefen(new URL(weiter, url).toString(), aufloesen);
      continue;
    }
    if (!res.ok) throw new Error(`Seite antwortet mit ${res.status}`);
    const art = res.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/.test(art)) throw new Error(`kein Text (${art || 'unbekannter Inhalt'})`);
    const roh = (await res.text()).slice(0, maxZeichen * 4);
    const text = /html|xml/.test(art) ? htmlAlsText(roh) : roh;
    return text.slice(0, maxZeichen);
  }
  throw new Error('zu viele Weiterleitungen');
}
