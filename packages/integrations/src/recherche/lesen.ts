/**
 * Makler-Recherche (21.10.2026): öffentliche Seiten lesen — Firmen-Webseite (Start, Impressum, Team, Kontakt) und
 * ImmoScout24-Anbieterprofil. Ohne Browser: die Probe vom 21.10. zeigte, dass beide per einfachem Abruf von Vercel aus
 * durchkommen (Suchmaschinen dagegen nicht). Höflich: robots.txt, Pause zwischen den Abrufen, wenige Seiten je Firma.
 * Interne Adressen werden nie geöffnet (`zielPruefen`, auch nach Weiterleitungen). `abruf` ist für Tests austauschbar.
 */
import { zielPruefen } from '../autoimport/engine.ts';

export type Abruf = typeof fetch;

export interface GeleseneSeite { url: string; titel: string; text: string }

const KOPF = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};
/** Höchstens so viele Unterseiten je Firma (zusätzlich zur Startseite) */
const MAX_UNTERSEITEN = 4;
/** Je Seite an die Auswertung — Team-Seiten großer Büros sind lang, die Kontaktangaben stehen meist vorn */
const MAX_ZEICHEN = 8000;
const ZEITLIMIT_MS = 10_000;
const LINK_WORTE = /impressum|team|kontakt|ueber-uns|über uns|uber-uns|about|ansprechpartner|mitarbeiter|makler/i;

const warten = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function htmlZuText(html: string): string {
  return html
    .replace(/<(head|script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

const titelAus = (html: string) => htmlZuText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200);

/** Abruf mit Zeitlimit; Weiterleitungen werden selbst verfolgt, damit auch deren Ziel geprüft wird. */
export async function seiteHolen(url: string, abruf: Abruf = fetch): Promise<{ url: string; status: number; html: string } | null> {
  let ziel = url;
  for (let i = 0; i < 4; i++) {
    const pruefung = zielPruefen(ziel);
    if (!pruefung.ok) return null;
    let r: Response;
    try {
      r = await abruf(pruefung.url.href, { headers: KOPF, redirect: 'manual', signal: AbortSignal.timeout(ZEITLIMIT_MS) });
    } catch {
      return null;
    }
    const weiter = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && weiter) { ziel = new URL(weiter, pruefung.url).href; continue; }
    const typ = r.headers.get('content-type') ?? '';
    if (typ && !/html|text\/plain/i.test(typ)) return { url: pruefung.url.href, status: r.status, html: '' };
    return { url: pruefung.url.href, status: r.status, html: (await r.text()).slice(0, 1_500_000) };
  }
  return null;
}

/** robots.txt, Abschnitt „User-agent: *“: erlaubt dieser Pfad das Lesen? Fehlt die Datei, ist alles erlaubt. */
export function robotsErlaubt(robots: string, pfad: string): boolean {
  let fuerAlle = false;
  const verboten: string[] = [];
  const erlaubt: string[] = [];
  for (const zeile of robots.split(/\r?\n/)) {
    const [k, ...rest] = zeile.split(':');
    const wert = rest.join(':').trim();
    const schluessel = k?.trim().toLowerCase();
    if (schluessel === 'user-agent') fuerAlle = wert === '*';
    else if (fuerAlle && schluessel === 'disallow' && wert) verboten.push(wert);
    else if (fuerAlle && schluessel === 'allow' && wert) erlaubt.push(wert);
  }
  const passt = (muster: string) => pfad.startsWith(muster.replace(/\*.*$/, ''));
  const v = verboten.filter(passt).sort((a, b) => b.length - a.length)[0];
  const e = erlaubt.filter(passt).sort((a, b) => b.length - a.length)[0];
  return !v || (!!e && e.length >= v.length);
}

/** Links zu Impressum, Team, Kontakt usw. auf derselben Website. */
export function unterseitenAus(html: string, basis: string): string[] {
  const host = new URL(basis).hostname.replace(/^www\./, '');
  const ziele: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!LINK_WORTE.test(`${m[1]} ${htmlZuText(m[2]!)}`)) continue;
    try {
      const u = new URL(m[1]!, basis);
      if (u.hostname.replace(/^www\./, '') !== host || /\.(pdf|jpe?g|png|zip)$/i.test(u.pathname)) continue;
      u.hash = '';
      ziele.push(u.href);
    } catch { /* ungültiger Link */ }
  }
  // Impressum zuerst: dort stehen Anschrift, Zentrale und Fax sicher
  return [...new Set(ziele)].sort((a, b) => Number(!/impressum/i.test(a)) - Number(!/impressum/i.test(b))).slice(0, MAX_UNTERSEITEN);
}

export interface WebseiteGelesen { seiten: GeleseneSeite[]; startUrl: string | null; erreichbar: boolean; gesperrtDurchRobots: number }

/** Startseite + bis zu vier Unterseiten. `pauseMs` zwischen den Abrufen (Tests: 0). */
export async function webseiteLesen(start: string, abruf: Abruf = fetch, pauseMs = 700): Promise<WebseiteGelesen> {
  const lesbar = (s: Awaited<ReturnType<typeof seiteHolen>>) => !!s && s.status < 400 && !!s.html;
  let erste = await seiteHolen(start, abruf);
  if (!lesbar(erste)) {
    // Manche Seiten liefern die Startseite nicht (404 für Abrufe ohne Browser, nur mit/ohne „www.“): andere Einstiege versuchen
    const u = new URL(start);
    const anderer = new URL(u.href);
    anderer.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
    for (const versuch of [anderer.origin + '/', `${u.origin}/impressum`, `${u.origin}/kontakt`]) {
      if (pauseMs) await warten(pauseMs);
      erste = await seiteHolen(versuch, abruf);
      if (lesbar(erste)) break;
    }
  }
  if (!erste || !lesbar(erste)) return { seiten: [], startUrl: erste?.url ?? null, erreichbar: false, gesperrtDurchRobots: 0 };
  const basis = new URL(erste.url);
  const robots = await seiteHolen(`${basis.origin}/robots.txt`, abruf);
  const robotsText = robots && robots.status < 400 ? robots.html : '';
  const seiten: GeleseneSeite[] = [{ url: erste.url, titel: titelAus(erste.html), text: htmlZuText(erste.html).slice(0, MAX_ZEICHEN) }];
  let gesperrt = 0;
  for (const url of unterseitenAus(erste.html, erste.url)) {
    if (!robotsErlaubt(robotsText, new URL(url).pathname)) { gesperrt++; continue; }
    if (pauseMs) await warten(pauseMs);
    const s = await seiteHolen(url, abruf);
    if (s && s.status < 400 && s.html) seiten.push({ url: s.url, titel: titelAus(s.html), text: htmlZuText(s.html).slice(0, MAX_ZEICHEN) });
  }
  return { seiten, startUrl: erste.url, erreichbar: true, gesperrtDurchRobots: gesperrt };
}

/** ImmoScout24-Anbieterprofil: gilt nur, wenn die Seite wirklich ein Profil ist (Titel „… bei ImmoScout24“), keine Fehlerseite. */
export async function immoscoutLesen(url: string, abruf: Abruf = fetch): Promise<GeleseneSeite | null> {
  const s = await seiteHolen(url, abruf);
  if (!s || s.status >= 400 || !s.html) return null;
  const titel = titelAus(s.html);
  if (!/immoscout24/i.test(titel) || /nicht gefunden|404|fehler/i.test(titel)) return null;
  return { url: s.url, titel, text: htmlZuText(s.html).slice(0, MAX_ZEICHEN) };
}

/** Steht der Name auf der Seite? Alle Namensteile ab drei Buchstaben, ohne Groß/Klein. */
export function nameGenannt(text: string, name: string | null | undefined): boolean {
  const teile = (name ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
  const klein = text.toLowerCase();
  return teile.length > 0 && teile.every((w) => klein.includes(w));
}
