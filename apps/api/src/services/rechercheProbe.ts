/**
 * Probe Makler-Recherche (21.10.2026): Kommen die Wege von Vercel aus durch? Nur Messung, schreibt nichts in die
 * Datenbank. Wird entfernt, sobald entschieden ist, welche Wege die Recherche nutzt.
 * Je Fall: Firmen-Webseite direkt (Start + Impressum/Team/Kontakt), DuckDuckGo-HTML, Bing-HTML,
 * ImmoScout24-Anbieterprofil per Suche gefunden und mit Chromium geöffnet.
 */
import type { Browser } from 'playwright-core';

export interface ProbeFall { name: string; firma?: string | null; webseite?: string | null; ort?: string | null }

const BROWSER_KOPF = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9',
};
const SPERRE = /captcha|robot|roboter|unusual traffic|ungewöhnliche|access denied|zugriff verweigert|anomaly|blocked|challenge/i;
const TEL = /(?:\+49|0049|\b0)[\s\-/()]*\d(?:[\s\-/()]*\d){6,}/g;
const MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const warten = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const enthaeltName = (t: string, name: string) => {
  const teile = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const klein = t.toLowerCase();
  return teile.length > 0 && teile.every((w) => klein.includes(w));
};

async function holen(url: string, ms = 12_000) {
  const start = Date.now();
  try {
    const r = await fetch(url, { headers: BROWSER_KOPF, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    const html = await r.text();
    return { status: r.status, html, ms: Date.now() - start, url: r.url };
  } catch (e) {
    return { status: 0, html: '', ms: Date.now() - start, url, fehler: (e as Error).message };
  }
}

function linksAus(html: string, basis: string) {
  const ziele: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const ziel = `${m[1]} ${m[2]}`.toLowerCase();
    if (!/impressum|team|kontakt|ueber-uns|über uns|ansprechpartner|mitarbeiter/.test(ziel)) continue;
    try { ziele.push(new URL(m[1]!, basis).href); } catch { /* ungültiger Link */ }
  }
  return [...new Set(ziele)].slice(0, 4);
}

async function webseitePruefen(f: ProbeFall) {
  if (!f.webseite) return null;
  const start = /^https?:\/\//.test(f.webseite) ? f.webseite : `https://${f.webseite}`;
  const seite = await holen(start);
  const seiten = [{ url: seite.url, status: seite.status, ms: seite.ms, fehler: (seite as { fehler?: string }).fehler }];
  let gesamt = text(seite.html);
  for (const url of linksAus(seite.html, seite.url)) {
    await warten(800);
    const s = await holen(url);
    seiten.push({ url: s.url, status: s.status, ms: s.ms, fehler: (s as { fehler?: string }).fehler });
    gesamt += ` ${text(s.html)}`;
  }
  return {
    seiten,
    personGenannt: enthaeltName(gesamt, f.name),
    telefonnummern: [...new Set(gesamt.match(TEL) ?? [])].length,
    emails: [...new Set(gesamt.match(MAIL) ?? [])].length,
    gesperrt: SPERRE.test(gesamt.slice(0, 3000)) && gesamt.length < 5000,
  };
}

async function suche(maschine: 'duckduckgo' | 'bing', q: string) {
  const url = maschine === 'duckduckgo'
    ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
    : `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=de&cc=DE`;
  const r = await holen(url);
  const treffer = maschine === 'duckduckgo'
    ? [...r.html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)].map((m) => {
      const roh = m[1]!;
      return roh.includes('uddg=') ? decodeURIComponent(roh.replace(/.*uddg=/, '').replace(/&.*$/, '')) : roh;
    })
    : [...r.html.matchAll(/<li class="b_algo"[\s\S]*?<a[^>]+href="(https?:[^"]+)"/g)].map((m) => m[1]!);
  return { status: r.status, ms: r.ms, treffer: treffer.slice(0, 8), gesperrt: treffer.length === 0 && SPERRE.test(r.html), fehler: (r as { fehler?: string }).fehler };
}

async function immoscoutLesen(browser: Browser | null, url: string, name: string) {
  if (!browser) return { fehler: 'kein Browser' };
  const start = Date.now();
  const kontext = await browser.newContext({ userAgent: BROWSER_KOPF['User-Agent'], locale: 'de-DE' });
  try {
    const seite = await kontext.newPage();
    const antwort = await seite.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await seite.waitForTimeout(2500);
    const titel = await seite.title();
    const inhalt = (await seite.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ');
    return {
      status: antwort?.status() ?? 0, ms: Date.now() - start, titel: titel.slice(0, 120),
      gesperrt: SPERRE.test(`${titel} ${inhalt.slice(0, 2000)}`), personGenannt: enthaeltName(inhalt, name),
      telefonnummern: [...new Set(inhalt.match(TEL) ?? [])].length, zeichen: inhalt.length,
    };
  } catch (e) {
    return { ms: Date.now() - start, fehler: (e as Error).message.slice(0, 200) };
  } finally {
    await kontext.close();
  }
}

export async function rechercheProbe(faelle: ProbeFall[], browserStarten: () => Promise<Browser>) {
  const browser = await browserStarten().catch(() => null);
  const ergebnisse = [];
  try {
    for (const f of faelle) {
      const q = `${f.name} ${f.firma ?? 'Immobilienmakler'} ${f.ort ?? ''}`.trim();
      const webseite = await webseitePruefen(f);
      await warten(1500);
      const ddg = await suche('duckduckgo', q);
      await warten(1500);
      const bing = await suche('bing', q);
      await warten(1500);
      const isSuche = await suche('duckduckgo', `${f.name} immobilienscout24`);
      const isUrl = [...isSuche.treffer, ...bing.treffer, ...ddg.treffer].find((u) => /immobilienscout24\.de\/(anbieter|profil|makler)/i.test(u)) ?? null;
      const immoscout = isUrl ? { url: isUrl, ...(await immoscoutLesen(browser, isUrl, f.name)) } : null;
      ergebnisse.push({ name: f.name, firma: f.firma ?? null, webseite, duckduckgo: ddg, bing, immoscoutSuche: { status: isSuche.status, treffer: isSuche.treffer.length, gesperrt: isSuche.gesperrt }, immoscout });
      await warten(1500);
    }
  } finally {
    await browser?.close();
  }
  return { zeitpunkt: new Date().toISOString(), ergebnisse };
}
