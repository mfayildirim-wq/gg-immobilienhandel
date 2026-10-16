// Modellwahl (Einstellungen → KI-Modelle): eine Anfrage, die für Haiku 4.5 geschrieben ist, auf ein anderes Modell umlenken.
// Die neuen Modelle nehmen nicht alles an, was die alten nehmen (Anthropic-Doku, Stand 10/2026):
//  • ab Opus 4.7, Sonnet 5 und Haiku 5.5: `temperature`/`top_p`/`top_k` mit anderem als dem Standardwert → 400
//  • die 5.5-Generation (und Fable/Mythos 5.1): erzwungenes Werkzeug (`tool_choice` „tool“/„any“) → 400
//  • sie denken adaptiv: vor Text und Werkzeug können `thinking`-Blöcke stehen, und `max_tokens` zählt das Denken mit
// Alle Aufrufe lesen `content[0].text` oder suchen den Werkzeugblock — deshalb räumt die Hülle die Antwort auf,
// statt jede Funktion einzeln anzupassen.
import type { KiClient } from './anthropic.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- Anfragen und Antworten der Messages-API */

const OHNE_SAMPLING = /opus-4-[7-9]|opus-5|sonnet-5|haiku-5|fable|mythos/;
const OHNE_ERZWUNGENES_WERKZEUG = /-5-5|fable-5-1|mythos-5-1/;
/** Denken braucht Platz: unter dieser Grenze bliebe für die eigentliche Antwort zu wenig. */
const MIN_TOKENS_MIT_DENKEN = 4096;

export const nimmtSampling = (modell: string) => !OHNE_SAMPLING.test(modell);
export const nimmtErzwungenesWerkzeug = (modell: string) => !OHNE_ERZWUNGENES_WERKZEUG.test(modell);

function systemMitHinweis(system: unknown, hinweis: string): unknown {
  if (Array.isArray(system)) return [...system, { type: 'text', text: hinweis }];
  return typeof system === 'string' && system ? `${system}\n\n${hinweis}` : hinweis;
}

/** Die Anfrage so umschreiben, dass das Modell sie annimmt. Ohne `modell` bleibt es beim Modell der Anfrage. */
export function anfrageFuerModell(body: any, modell?: string | null): any {
  const ziel = modell || body?.model;
  if (!body || typeof body !== 'object' || !ziel) return body;
  const neu: any = { ...body, model: ziel };
  if (!nimmtSampling(ziel)) {
    delete neu.temperature; delete neu.top_p; delete neu.top_k;
  }
  if (!nimmtErzwungenesWerkzeug(ziel)) {
    const tc = neu.tool_choice;
    if (tc?.type === 'tool' || tc?.type === 'any') {
      const name = tc.type === 'tool' ? tc.name : neu.tools?.[0]?.name;
      neu.tool_choice = { type: 'auto' };
      neu.system = systemMitHinweis(neu.system, `Antworte ausschließlich, indem du das Werkzeug „${name}“ aufrufst — kein Text außerhalb davon.`);
    }
    neu.max_tokens = Math.max(Number(neu.max_tokens) || 0, MIN_TOKENS_MIT_DENKEN);
    neu.output_config = { effort: 'low', ...(neu.output_config ?? {}) };
  }
  return neu;
}

/** Denkblöcke heraus (die Aufrufer lesen den ersten Block als Antwort), Modell vermerkt (für die Kostenbuchung). */
export function antwortBereinigen(data: any, modell: string): any {
  if (!data || typeof data !== 'object') return data;
  const content = Array.isArray(data.content) ? data.content.filter((c: any) => c?.type !== 'thinking' && c?.type !== 'redacted_thinking') : data.content;
  return { ...data, content, model: typeof data.model === 'string' && data.model ? data.model : modell };
}

/**
 * Die KI für einen Bereich: lenkt jede Anfrage auf `modell` um (null = Modell der Anfrage) und passt sie an,
 * was das Modell annimmt. Gilt auch ohne Umlenkung — eine Funktion mit fest hinterlegtem neuem Modell braucht es ebenso.
 */
export function kiMitModell(ki: KiClient, modell: string | null): KiClient {
  return {
    ...ki,
    async nachricht(body, zeitlimitMs) {
      const anfrage = anfrageFuerModell(body, modell);
      return antwortBereinigen(await ki.nachricht(anfrage, zeitlimitMs), anfrage?.model);
    },
  };
}

/** Welches Modell geantwortet hat: laut Antwort, sonst das fest hinterlegte (Attrappe). */
export const genutztesModell = (data: any, fallback: string): string => (typeof data?.model === 'string' && data.model ? data.model : fallback);
