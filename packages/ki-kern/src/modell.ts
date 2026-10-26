/* eslint-disable @typescript-eslint/no-explicit-any -- Inhaltsblöcke der Messages-API */
/**
 * Das Modell als Funktion im Format der Anthropic Messages-API — die Schleife spricht nur dieses Format.
 * Ein anderer Anbieter bekommt einen Übersetzer, die Schleife bleibt gleich.
 */

export type Block = { type: string; [feld: string]: any };
export interface ModellNachricht { role: 'user' | 'assistant'; content: string | Block[] }
export interface ModellAnfrage {
  system: string;
  messages: ModellNachricht[];
  tools: Record<string, unknown>[];
  max_tokens: number;
}
export interface ModellAntwort { content: Block[]; stop_reason: string | null; model?: string }
export type Modell = (anfrage: ModellAnfrage) => Promise<ModellAntwort>;

export const textAus = (content: string | Block[]): string =>
  typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');

/**
 * Attrappe für Klicktests und lokales Arbeiten ohne Schlüssel — antwortet sofort und vorhersagbar:
 * nennt Dialog und Zahl der Gedächtnis-Einträge (aus dem Systemtext) und wiederholt die Frage.
 * `werkzeug:<name> {json}` in der Frage ruft das Werkzeug auf; so lässt sich der Weg über MCP durchklicken.
 */
export function attrappenModell(): Modell {
  return async (a) => {
    const letzte = a.messages.at(-1);
    const ergebnisse = Array.isArray(letzte?.content) ? letzte.content.filter((b) => b.type === 'tool_result') : [];
    if (ergebnisse.length) {
      const inhalt = ergebnisse.map((b) => (Array.isArray(b.content) ? textAus(b.content) : String(b.content ?? ''))).join('\n');
      return { content: [{ type: 'text', text: `**Attrappe** — das Werkzeug hat geantwortet${ergebnisse.some((b) => b.is_error) ? ' (Fehler)' : ''}:\n\n${inhalt.slice(0, 300)}` }], stop_reason: 'end_turn', model: 'attrappe' };
    }
    const frage = letzte ? textAus(letzte.content) : '';
    const aufruf = /werkzeug:([\w-]+)\s*(\{[\s\S]*\})?/.exec(frage);
    if (aufruf) {
      return { content: [{ type: 'tool_use', id: `attrappe-${a.messages.length}`, name: aufruf[1], input: JSON.parse(aufruf[2] ?? '{}') }], stop_reason: 'tool_use', model: 'attrappe' };
    }
    const dialog = /^Dialog: (.+)$/m.exec(a.system)?.[1] ?? 'keiner';
    const eintraege = /^Gedächtnis-Einträge: (\d+)/m.exec(a.system)?.[1] ?? '0';
    return {
      content: [{ type: 'text', text: `**Attrappe** — Dialog: ${dialog} · Gedächtnis: ${eintraege} Einträge\n\nFrage: ${frage}` }],
      stop_reason: 'end_turn', model: 'attrappe',
    };
  };
}

/** Für Tests: gibt die Antworten der Reihe nach zurück und merkt sich jede Anfrage. */
export function drehbuchModell(antworten: ModellAntwort[]): Modell & { anfragen: ModellAnfrage[] } {
  const anfragen: ModellAnfrage[] = [];
  const f = async (a: ModellAnfrage) => {
    anfragen.push(structuredClone(a));
    const naechste = antworten[anfragen.length - 1];
    if (!naechste) throw new Error(`Drehbuch zu Ende (Anfrage ${anfragen.length})`);
    return naechste;
  };
  return Object.assign(f, { anfragen });
}
