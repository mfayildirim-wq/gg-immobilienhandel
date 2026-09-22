// Übernommen aus gg-immohandel server/auto-import-engine.ts (rankLinksForTrial, pickExposeLink, Stand 9d693b8),
// inhaltlich unverändert: Vorfilter, Heuristik und Prompts wörtlich. Die KI kommt über den KiClient des Neubaus.
/* eslint-disable @typescript-eslint/no-explicit-any -- KI-Antworten sind ungetypt */
import type { KiClient } from '../ki/anthropic.ts';


/** Ordnet alle plausiblen Links nach Trial-Wahrscheinlichkeit.
 *  Gibt bis zu 6 Links zurück, ersten 2-3 sind heuristisch top, danach KI-Ranking.
 *  Caller probiert sie der Reihe nach durch (Multi-Link-Trial). */
export async function rankLinksForTrial(
  mailBody: string,
  links: string[],
  ki: KiClient,
  context: { mailSubject?: string; senderDomain?: string },
): Promise<string[]> {
  // Vorfilter — Tracking/Bilder/Datenschutz
  const negative = /\/(widerruf|datenschutz|impressum|cookies|disclaimer|unsubscribe|abmelden|abbestellen|newsletter|kontakt-formular|hs_preferences-center|preferences-center)\b|\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|ttf)(\?|$)|^tel:|^mailto:/i;
  // Positiv-Pattern
  const positive = /(expose|exposee|webexpose|landingpage|webexposee|\/objekt|\/einheit|\/property|\/immobilie|\/immobilien\/|onoffice\.de\/.*expose|smart\/app|cancelation\/AppAgreement|immobilien?angebot|immobilie\/)/i;

  const clean = links.filter(l => !negative.test(l));
  if (clean.length === 0) return [];
  if (clean.length === 1) return clean;

  // Sortierung: positive Pattern zuerst, dann nach Länge (Token-spezifischer)
  clean.sort((a, b) => {
    const pa = positive.test(a) ? 0 : 1;
    const pb = positive.test(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return b.length - a.length;
  });

  // Wenn nur 2-3 Links → ALLE versuchen, kein KI-Call nötig
  if (clean.length <= 3) return clean.slice(0, 6);

  // KI-Sortierung für die Reihenfolge — null erlaubt
  try {
    const linksFormatted = clean.map((l, i) => `${i}: ${l}`).join('\n');
    const ctxBlock = [
      context.mailSubject ? `Mail-Betreff: "${context.mailSubject}"` : '',
      context.senderDomain ? `Absender: ${context.senderDomain}` : '',
    ].filter(Boolean).join('\n');

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'Du sortierst Links aus einer deutschen Makler-Mail nach Wahrscheinlichkeit zum Exposé. Gib eine sortierte Liste der Indizes zurück (beste zuerst).',
      messages: [{
        role: 'user',
        content: `${ctxBlock}\n\nE-Mail-Body (Auszug):\n${mailBody.substring(0, 2000)}\n\nLinks:\n${linksFormatted}\n\nSortiere die Indizes nach Wahrscheinlichkeit zum Exposé. Bevorzuge:\n- Links mit /expose/, /landingpage/, /einheit/, /objekt/, /immobilie/\n- onoffice.de/smart/app/* oder cancelation/AppAgreement (führen zum Exposé via Submit)\n- Lange Token-Strings (>40 Zeichen Base64)\n\nGeringe Priorität:\n- HubSpot/Tracking-Redirects (eu1.hubspotlinks, hs-XXXXX.s.hubspotemail)\n- Generische Maklerhomepage ohne spezifischen Pfad\n\nGib alle Indizes zurück (auch unwahrscheinliche zuletzt), kein null.`,
      }],
      tools: [{
        name: 'rank',
        input_schema: {
          type: 'object',
          properties: {
            orderedIndices: { type: 'array', items: { type: 'integer' } },
          },
          required: ['orderedIndices'],
        },
      }],
      tool_choice: { type: 'tool', name: 'rank' },
    };
    const resp = await ki.nachricht(body);
    const toolUse = (resp.content || []).find((c: any) => c.type === 'tool_use');
    const idxs = toolUse?.input?.orderedIndices as number[] | undefined;
    if (Array.isArray(idxs) && idxs.length > 0) {
      const seen = new Set<number>();
      const ordered: string[] = [];
      for (const i of idxs) {
        if (i >= 0 && i < clean.length && !seen.has(i)) {
          seen.add(i);
          ordered.push(clean[i]!);
        }
      }
      // Nicht-genannte hinten anhängen
      for (let i = 0; i < clean.length; i++) {
        if (!seen.has(i)) ordered.push(clean[i]!);
      }
      return ordered.slice(0, 6);
    }
  } catch { /* fallthrough zu heuristik */ }

  return clean.slice(0, 6);
}

export async function pickExposeLink(
  mailBody: string,
  links: string[],
  ki: KiClient,
  context?: { mailSubject?: string; senderDomain?: string },
): Promise<{ selectedIndex: number | null; reason: string; }> {

  // Heuristik-Vorfilter
  const negative = /\/(widerruf|datenschutz|impressum|cookies|agb|disclaimer|unsubscribe|abmelden|abbestellen|newsletter|kontakt|team|leistungen|ueber-uns|over)\b|\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|ttf)(\?|$)/i;
  const positiveHints = /(expose|exposee|webexpose|landingpage|\/objekt|\/einheit|\/property|\/immobilie|onoffice\.de\/expose)/i;
  const skippedIndices: number[] = [];
  const cleanLinks: { idx: number; url: string; positive: boolean }[] = [];
  links.forEach((l, i) => {
    if (negative.test(l)) { skippedIndices.push(i); return; }
    cleanLinks.push({ idx: i, url: l, positive: positiveHints.test(l) });
  });

  const positives = cleanLinks.filter(c => c.positive);
  // 1 positiver Treffer → direkt nehmen ohne KI
  if (positives.length === 1) {
    return { selectedIndex: positives[0]!.idx, reason: 'einziger Exposé-Link-Pattern (Heuristik)' };
  }
  // KEINE Links übrig nach Filter
  if (cleanLinks.length === 0) {
    return { selectedIndex: null, reason: `Alle ${links.length} Links sind Tracking/Datenschutz/Bilder` };
  }
  // Mehrere positive Treffer → längsten nehmen wenn alle ähnliche Pattern (KI würde dasselbe sagen, spart 1.5s)
  if (positives.length > 1) {
    positives.sort((a, b) => b.url.length - a.url.length);
    const longest = positives[0]!;
    // Wenn klar der längste: direkt nehmen
    if (longest.url.length > positives[1]!.url.length * 1.3) {
      return { selectedIndex: longest.idx, reason: 'längster Exposé-Pattern-Link (Heuristik)' };
    }
  }

  const linksFormatted = links.map((l, i) => {
    const skipped = skippedIndices.includes(i);
    return `${i}: ${l}${skipped ? '  [bereits vom Vorfilter verworfen — Datenschutz/Bild/Tracking]' : ''}`;
  }).join('\n');

  const ctxLines: string[] = [];
  if (context?.mailSubject) ctxLines.push(`Mail-Betreff: "${context.mailSubject}"`);
  if (context?.senderDomain) ctxLines.push(`Absender-Domain: ${context.senderDomain}`);
  const ctxBlock = ctxLines.length ? '\n' + ctxLines.join('\n') + '\n' : '';

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: 'Du bist Experte für deutsche Makler-E-Mails und findest den EINEN Link der zum Exposé führt. Antworte nur über das Tool.',
    messages: [{
      role: 'user',
      content: `${ctxBlock}E-Mail-Body (gekürzt):
${mailBody.substring(0, 2500)}

Links:
${linksFormatted}

WAS ist ein Exposé-Link?
- Enthält Pfad-Segmente: /expose/, /exposee/, /webexposee/, /landingpage/, /objekt/, /einheit/, /immobilie/, /property/
- Lange Token-Zeichenfolge (>30 Zeichen Base64/Hex) — signalisiert dass Token einen spezifischen Datensatz öffnet
- Domain enthält "landingpage", "expose", oder Makler-Subdomain wie "<makler>.landingpage.immobilien"
- Hat KEINEN Pfad zu Datenschutz/Widerruf/AGB/Impressum/Newsletter

WAS ist KEIN Exposé:
- Links zu LinkedIn/XING/Facebook/Twitter/YouTube
- Bilder (URLs mit .jpg .png .gif .svg)
- "image.onoffice.de" → das sind nur Bilder, NICHT Exposé!
- "/datenschutz", "/impressum", "/widerruf", "/agb"
- Hauptdomain ohne weiteren Pfad (z.B. "https://makler.de/")
- Telefon/E-Mail-Links (tel:, mailto:)

ENTSCHEIDUNG:
1. Wenn ein klar passender Link existiert → seinen Index zurückgeben
2. Wenn mehrere passen → den längsten (= spezifischster Token)
3. Wenn KEINER passt → selectedIndex=null
4. Lass dich vom Mail-Betreff helfen: betrifft der Link plausibel dieses Objekt?`,
    }],
    tools: [{
      name: 'pick_link',
      description: 'Wähle Exposé-Link aus oder null',
      input_schema: {
        type: 'object',
        properties: {
          selectedIndex: { type: ['integer', 'null'] },
          reason:        { type: 'string' },
        },
        required: ['selectedIndex', 'reason'],
      },
    }],
    tool_choice: { type: 'tool', name: 'pick_link' },
  };

  const resp = await ki.nachricht(body);
  const toolUse = (resp.content || []).find((c: any) => c.type === 'tool_use');
  if (!toolUse?.input) return { selectedIndex: null, reason: 'KI-Antwort fehlte' };
  return toolUse.input;
}
