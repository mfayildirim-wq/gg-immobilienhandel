/**
 * Anreicherung von Maklern mit öffentlichen Quellen und KI. Wörtlich aus gg-immohandel:
 * server/index.ts (/api/enrich/osint: DuckDuckGo-HTML, /api/enrich/news: Google-News-RSS),
 * src/modules/enrich/enrich.ts (fetchAiHooks), src/modules/vertrieb/vertrieb.ts (vtGenerateCallOpener),
 * src/modules/makler/makler.ts (mkRunOSINT). Suchen scheitern leise (Beiwerk); die Such-URL wird nie geloggt.
 */
import type { PersonenInfo } from '@gg/domain';
import { HAIKU, type KiAntwort } from './persona.ts';
import type { KiClient } from './anthropic.ts';

export interface WebTreffer { titel: string; url: string; snippet: string }
export interface Nachricht { titel: string; quelle: string; datum: string; snippet: string }
export interface KontaktAnlass { emoji: string; text: string; priority: 'hoch' | 'mittel' | 'niedrig'; quelleUrl?: string }

const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

/** DuckDuckGo-HTML: bis zu 5 organische Treffer. */
export function duckduckgoAuswerten(html: string): WebTreffer[] {
  const results: WebTreffer[] = [];
  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && results.length < 5) {
    const rawUrl = m[1]!;
    const title = m[2]!.replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    const cleanUrl = rawUrl.startsWith('//duckduckgo.com/l/?') ? decodeURIComponent(rawUrl.replace(/.*uddg=/, '')) : rawUrl;
    results.push({ titel: title, url: cleanUrl, snippet: '' });
  }
  return results;
}

export async function webSuche(q: string, abruf: typeof fetch = fetch): Promise<WebTreffer[]> {
  if (!q.trim()) return [];
  try {
    const resp = await abruf(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q.trim())}`, { headers: BROWSER });
    return resp.ok ? duckduckgoAuswerten(await resp.text()) : [];
  } catch (e) {
    console.error('[anreicherung] DuckDuckGo-Suche fehlgeschlagen:', (e as Error).message);
    return [];
  }
}

/** Google-News-RSS: bis zu 5 Meldungen. */
export function newsAuswerten(xml: string): Nachricht[] {
  const items: Nachricht[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null && items.length < 5) {
    const item = match[1]!;
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(item) || /<title>(.*?)<\/title>/.exec(item))?.[1] || '';
    const link = /<link>(.*?)<\/link>/.exec(item)?.[1] || '';
    const pub = /<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || '';
    const desc = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(item) || /<description>(.*?)<\/description>/.exec(item))?.[1] || '';
    if (!title) continue;
    items.push({
      titel: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(),
      quelle: link.trim(),
      datum: pub ? new Date(pub).toLocaleDateString('de-DE') : '',
      snippet: desc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').substring(0, 160).trim(),
    });
  }
  return items;
}

export async function nachrichtenSuche(q: string, abruf: typeof fetch = fetch): Promise<Nachricht[]> {
  if (!q.trim()) return [];
  try {
    const resp = await abruf(`https://news.google.com/rss/search?q=${encodeURIComponent(q.trim())}&hl=de&gl=DE&ceid=DE:de`, { headers: BROWSER });
    return resp.ok ? newsAuswerten(await resp.text()) : [];
  } catch (e) {
    console.error('[anreicherung] Google-News-RSS nicht abrufbar:', (e as Error).message);
    return [];
  }
}

/** fetchAiHooks: Web-Suche + News → Haiku → 2-4 Kontakt-Anlässe. Ohne Suchtreffer keine KI. */
export async function kontaktAnlaesse(
  ki: KiClient, name: string, firma: string | undefined, geburtsdatum: string | undefined, jetzt: Date,
  suche: (q: string) => Promise<WebTreffer[]> = webSuche, news: (q: string) => Promise<Nachricht[]> = nachrichtenSuche,
): Promise<KiAntwort<KontaktAnlass[]> | null> {
  const q = [name, firma, 'Immobilien'].filter(Boolean).join(' ');
  const newsQ = [firma || name, 'Immobilien'].filter(Boolean).join(' ');
  const [ddgResults, newsItems] = await Promise.all([suche(q), news(newsQ)]);
  if (!ddgResults.length && !newsItems.length) return null;
  const parts: string[] = [];
  if (ddgResults.length) {
    parts.push('WEB-SUCHE:');
    ddgResults.slice(0, 5).forEach((r, i) => parts.push(`${i + 1}. ${r.titel}\n   ${r.url}`));
  }
  if (newsItems.length) {
    parts.push('\nAKTUELLE NACHRICHTEN:');
    newsItems.slice(0, 3).forEach((n, i) => parts.push(`${i + 1}. ${n.titel} (${n.datum})\n   ${n.quelle}`));
  }
  if (geburtsdatum) {
    const today = new Date(jetzt); today.setHours(0, 0, 0, 0);
    let month = 0, day = 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(geburtsdatum)) { const p = geburtsdatum.split('-').map(Number); month = p[1]!; day = p[2]!; }
    else if (/^\d{2}-\d{2}$/.test(geburtsdatum)) { const p = geburtsdatum.split('-').map(Number); month = p[0]!; day = p[1]!; }
    if (month && day) {
      const bday = new Date(today.getFullYear(), month - 1, day);
      let diff = Math.round((bday.getTime() - today.getTime()) / 86_400_000);
      if (diff < -1) diff += 365;
      if (diff >= -1 && diff <= 7) {
        const label = diff === 0 ? 'HEUTE!' : diff === 1 ? 'morgen!' : `in ${diff} Tagen`;
        parts.push(`\n⚠️ GEBURTSTAG: ${label}`);
      }
    }
  }
  const prompt = `Analysiere diese Informationen über den Immobilienmakler "${name}"${firma ? ` von "${firma}"` : ''} und erstelle 2-4 konkrete Kontakt-Anlässe für ein Vertriebsgespräch.

${parts.join('\n')}

Antworte NUR mit einem JSON-Array, kein Text davor/danach:
[{"emoji":"📰","text":"Kurzer Anlass max 65 Zeichen","priority":"hoch|mittel|niedrig","quelleUrl":"https://...optional"}]

Regeln:
- Nur konkrete Anlässe aus den Suchergebnissen, keine Erfindungen
- Geburtstag → priority "hoch", emoji "🎂"
- Firmennews/Expansion/Award → priority "mittel"
- Interessante Fakten/Marktinfos → priority "niedrig"
- Leeres Array [] wenn nichts Relevantes gefunden`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
  const raw = ((data?.content?.[0]?.text as string) || '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  let anlaesse: KontaktAnlass[] = [];
  try {
    const parsed = match ? JSON.parse(match[0]) : [];
    anlaesse = Array.isArray(parsed) ? parsed.filter((h: any) => h.emoji && h.text && typeof h.text === 'string').slice(0, 4) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch { anlaesse = []; }
  return { wert: anlaesse, model: HAIKU, usage: data?.usage ?? {} };
}

/** vtGenerateCallOpener: 1-2 Sätze Gesprächseinstieg. */
export async function gespraechsoeffner(
  ki: KiClient,
  m: { name?: string | null; firma?: string | null; relationshipNote?: string | null },
  kontext: { geburtstagLabel?: string | null; anlaesse: KontaktAnlass[]; erwaehnungen: { thema: string; detail: string }[]; letzteKommunikation?: string | null },
): Promise<KiAntwort<string>> {
  const context = [
    kontext.geburtstagLabel ? `⚠️ WICHTIG: ${kontext.geburtstagLabel} — Glückwunsch einbauen!` : '',
    kontext.anlaesse.length ? `Aktuelle Kontakt-Anlässe:\n${kontext.anlaesse.map((h) => `- ${h.emoji} ${h.text}`).join('\n')}` : '',
    kontext.erwaehnungen.length ? `Persönliche Erwähnungen: ${kontext.erwaehnungen.slice(0, 3).map((e) => `${e.thema}: ${e.detail}`).join('; ')}` : '',
    m.relationshipNote ? `Beziehung: ${m.relationshipNote.substring(0, 150)}` : '',
    kontext.letzteKommunikation ? `Letzte Komm: ${kontext.letzteKommunikation.substring(0, 100)}` : '',
  ].filter(Boolean).join('\n');
  const prompt = `Schreibe einen natürlichen Gesprächseinstieg (1-2 Sätze) für einen Anruf beim Immobilienmakler ${m.name}${m.firma ? ' von ' + m.firma : ''}.
${context ? 'Kontext:\n' + context : ''}
Kurz, persönlich, keine Floskeln. Nutze Geburtstag oder aktuelle Anlässe wenn vorhanden — dezent und natürlich.`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 120, messages: [{ role: 'user', content: prompt }] });
  return { wert: ((data?.content?.[0]?.text as string) || '').trim(), model: HAIKU, usage: data?.usage ?? {} };
}

/** mkRunOSINT: allgemeine Suche + Handelsregister-Suche; XING/LinkedIn, HR-Nummer, Amtsgericht, Rechtsform. */
export async function osintSuche(name: string, firma: string, jetzt: string, suche: (q: string) => Promise<WebTreffer[]> = webSuche): Promise<PersonenInfo> {
  const [general, hrRaw] = await Promise.all([
    suche([name, firma, 'Immobilien'].filter(Boolean).join(' ')),
    firma ? suche('"' + firma + '" Handelsregister HRB HRA') : Promise.resolve([] as WebTreffer[]),
  ]);
  const xingEntry = general.find((r) => r.url.includes('xing.com'));
  const linkedinEntry = general.find((r) => r.url.includes('linkedin.com'));
  let hrNummer: string | undefined;
  let amtsgericht: string | undefined;
  let hrQuelle: string | undefined;
  const hrPattern = /\b(HRB|HRA|VR|GnR)\s*(\d{1,6})\b/i;
  for (const r of hrRaw) {
    const text = r.titel + ' ' + r.snippet;
    const m = hrPattern.exec(text);
    if (m) { hrNummer = m[0]; hrQuelle = r.url; }
    const agMatch = /Amtsgericht\s+([A-ZÄÖÜa-zäöü-]+)/i.exec(text);
    if (agMatch) amtsgericht = agMatch[1];
    if (hrNummer) break;
  }
  const rechtsformMatch = /(GmbH\s*&\s*Co\.?\s*KG|GmbH|AG|UG|OHG|KG|GbR|e\.K\.)/i.exec(firma);
  const rechtsform = rechtsformMatch ? rechtsformMatch[1] : undefined;
  return {
    ts: jetzt, allgemein: general.slice(0, 5), xingUrl: xingEntry?.url, linkedinUrl: linkedinEntry?.url,
    handelsregister: hrNummer || amtsgericht || rechtsform ? { hrNummer, amtsgericht, rechtsform, quelleUrl: hrQuelle } : undefined,
  };
}
