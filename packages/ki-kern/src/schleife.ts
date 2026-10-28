/**
 * Die Agentenschleife: Modell fragen, gewünschte Werkzeuge aufrufen, Ergebnisse zurückgeben — bis das Modell fertig ist,
 * höchstens `maxSchritte` Runden und nie länger als `fristMs` (online endet eine Function nach 300 s).
 * Die Websuche führt der Anbieter selbst aus (Server-Werkzeug); hier wird sie nur mitgezählt.
 */
import type { KiQuelle, KiSchritt } from './vertrag.ts';
import type { Block, Modell, ModellNachricht } from './modell.ts';
import type { Werkzeug, WerkzeugQuelle } from './werkzeuge.ts';

/** So viel Text eines Werkzeugergebnisses bekommt das Modell; der Rest kostet nur. */
const MAX_ERGEBNIS = 20_000;
const WEBSUCHE = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as const;

export interface SchleifeEingabe {
  modell: Modell;
  system: string;
  verlauf: { rolle: 'nutzer' | 'ki'; text: string }[];
  frage: string;
  werkzeuge: Werkzeug[];
  quelle: WerkzeugQuelle;
  websuche: boolean;
  maxSchritte?: number;
  fristMs?: number;
  maxTokens?: number;
}
export interface SchleifeErgebnis { text: string; schritte: KiSchritt[]; quellen: KiQuelle[]; modell?: string }

const kurz = (v: unknown, n = 120) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export async function kiAntworten(e: SchleifeEingabe): Promise<SchleifeErgebnis> {
  const ende = Date.now() + (e.fristMs ?? 240_000);
  const maxSchritte = e.maxSchritte ?? 8;
  const messages: ModellNachricht[] = [
    ...e.verlauf.filter((n) => n.text.trim()).map((n): ModellNachricht => ({ role: n.rolle === 'nutzer' ? 'user' : 'assistant', content: n.text })),
    { role: 'user', content: e.frage },
  ];
  const tools: Record<string, unknown>[] = [
    ...e.werkzeuge.map((w) => ({ name: w.name, description: w.description, input_schema: w.inputSchema })),
    ...(e.websuche ? [WEBSUCHE] : []),
  ];
  const schritte: KiSchritt[] = [];
  const quellen = new Map<string, KiQuelle>();
  let texte: string[] = [];
  let modell: string | undefined;

  for (let runde = 0; runde < maxSchritte; runde++) {
    if (Date.now() > ende) {
      texte.push('\n\n_(Abgebrochen: die Antwort dauerte zu lange.)_');
      break;
    }
    const antwort = await e.modell({ system: e.system, messages, tools, max_tokens: e.maxTokens ?? 8000 });
    modell = antwort.model ?? modell;
    // Denkblöcke bleiben in der Folge erhalten — der Anbieter verlangt sie zurück, wenn Werkzeuge im Spiel sind
    messages.push({ role: 'assistant', content: antwort.content });

    for (const b of antwort.content) {
      if (b.type === 'text') {
        texte.push(String(b.text ?? ''));
        for (const c of (b.citations ?? []) as Block[]) if (c.url) quellen.set(String(c.url), { url: String(c.url), titel: String(c.title ?? c.url) });
      }
      if (b.type === 'server_tool_use' && b.name === 'web_search') schritte.push({ art: 'websuche', name: 'web_search', ok: true, kurz: kurz(b.input?.query ?? '') });
    }

    if (antwort.stop_reason === 'pause_turn') continue;
    if (antwort.stop_reason !== 'tool_use') return { text: texte.join('').trim(), schritte, quellen: [...quellen.values()], modell };

    // Zwischentexte („Ich schaue nach …“) gehören nicht in die Antwort
    texte = [];
    const ergebnisse: Block[] = [];
    for (const b of antwort.content.filter((x) => x.type === 'tool_use')) {
      const argumente = (b.input ?? {}) as Record<string, unknown>;
      let r: { text: string; fehler: boolean };
      try {
        r = await e.quelle.aufrufen(String(b.name), argumente);
      } catch (f) {
        r = { text: `Werkzeug nicht erreichbar: ${(f as Error).message}`, fehler: true };
      }
      schritte.push({ art: 'werkzeug', name: String(b.name), ok: !r.fehler, kurz: kurz(argumente) });
      ergebnisse.push({ type: 'tool_result', tool_use_id: b.id, content: r.text.slice(0, MAX_ERGEBNIS) || '(leer)', ...(r.fehler ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: ergebnisse });
  }
  const bisher = texte.join('').trim();
  return {
    text: bisher || `_(Keine abschließende Antwort nach ${maxSchritte} Schritten — bitte die Frage enger stellen.)_`,
    schritte, quellen: [...quellen.values()], modell,
  };
}

