/**
 * Das Sprachmodell hinter dem Agenten — ein LangChain-`BaseChatModel`, damit der Graph jeden Anbieter nimmt.
 * `anthropicModell` für den Betrieb, `drehbuchModell` für Tests und Klicktests (gibt vorbereitete Antworten der Reihe nach).
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export type Modell = BaseChatModel;

/**
 * Werkzeuge nacheinander: eine Rückfrage (`interrupt` in `steuere`) hält den ganzen Werkzeug-Schritt an — parallele
 * Aufrufe aus derselben Antwort gingen dabei verloren oder liefen nach dem „Ja“ doppelt.
 */
class SeriellesAnthropic extends ChatAnthropic {
  override bindTools(...[werkzeuge, optionen]: Parameters<ChatAnthropic['bindTools']>) {
    return super.bindTools(werkzeuge, { tool_choice: { type: 'auto', disable_parallel_tool_use: true } as never, ...optionen });
  }
}

export function anthropicModell(apiKey: string, model = 'claude-sonnet-5'): Modell {
  // Keine temperature: neuere Claude-Modelle lehnen gesetzte Werte ab
  return new SeriellesAnthropic({ apiKey, model, maxTokens: 1500 });
}

/**
 * Die Anbieter, zwischen denen die Einstellungen wählen. OpenAI, DeepSeek und Kimi sprechen dieselbe Schnittstelle
 * (Chat Completions mit Werkzeugen) — nur Adresse und Schlüssel unterscheiden sich. `vorgabeModell` leer heißt: das
 * Modell muss in den Einstellungen eingetragen werden (die Namen wechseln bei diesen Anbietern häufig).
 */
export const ANBIETER = [
  { id: 'anthropic', label: 'Anthropic (Claude)', zugang: 'anthropic-api-key', vorgabeModell: 'claude-sonnet-5', schnellesModell: 'claude-haiku-4-5-20251001', basisUrl: undefined, lokal: false },
  { id: 'openai', label: 'OpenAI', zugang: 'openai-api-key', vorgabeModell: '', schnellesModell: '', basisUrl: undefined, lokal: false },
  { id: 'deepseek', label: 'DeepSeek', zugang: 'deepseek-api-key', vorgabeModell: 'deepseek-chat', schnellesModell: '', basisUrl: 'https://api.deepseek.com', lokal: false },
  { id: 'kimi', label: 'Kimi (Moonshot)', zugang: 'moonshot-api-key', vorgabeModell: '', schnellesModell: '', basisUrl: 'https://api.moonshot.ai/v1', lokal: false },
  // OpenRouter: viele Anbieter hinter einem Schlüssel, auch kostenlose Modelle (Name endet auf „:free“); `openrouter/free`
  // wählt selbst ein freies Modell. Die Liste kommt aus `modellListe` (öffentlich, ohne Schlüssel).
  { id: 'openrouter', label: 'OpenRouter (auch kostenlose Modelle)', zugang: 'openrouter-api-key', vorgabeModell: 'openrouter/free', schnellesModell: '', basisUrl: 'https://openrouter.ai/api/v1', lokal: false },
  // Ollama: offene Modelle auf dem eigenen Rechner — ohne Schlüssel, ohne Kosten, Daten bleiben lokal. Die Adresse gibt
  // der Host (`ollamaUrl`); online (Vercel) gibt es kein lokales Ollama.
  { id: 'ollama', label: 'Ollama (lokal, offene Modelle)', zugang: '', vorgabeModell: '', schnellesModell: '', basisUrl: 'http://localhost:11434', lokal: true },
] as const;
export type AnbieterId = (typeof ANBIETER)[number]['id'];

/**
 * Braucht die Nachricht das gründliche Modell? Recherche, Analyse, Vergleich, Dokumente, Erklärungen — ja; bedienen,
 * lesen, bestätigen — nein (dort zählt Tempo).
 */
export function aufgabeGruendlich(text: string): boolean {
  // Nur den Auftrag ansehen, nicht den Wortlaut: „Kommentar: Exposé angefragt“ ist Bedienen, keine Dokumentanalyse
  const auftrag = text.replace(/^(.{0,60}?\b(kommentar|notiz|gesprächsnotiz|text|nachricht|mail|betreff|wortlaut)\b[^:]{0,20}):[\s\S]*$/i, '$1');
  return /recherch|analys|vergleich|bewert|einschätz|web|internet|markt|lage\b|umfeld|dokument|exposé|expose|miet|zusammenfass|bericht|warum|erklär|strategie|empfiehl|empfehl/i.test(auftrag);
}

/** Werkzeuge nacheinander — aus demselben Grund wie bei Anthropic (Rückfrage in `steuere`). */
class SeriellesOpenAI extends ChatOpenAI {
  override bindTools(...[werkzeuge, optionen]: Parameters<ChatOpenAI['bindTools']>) {
    return super.bindTools(werkzeuge, { parallel_tool_calls: false, ...optionen });
  }
}

/** OpenAI oder ein Anbieter mit derselben Schnittstelle (DeepSeek, Kimi, OpenRouter) — über die Basis-Adresse. */
export function openaiKompatibel(apiKey: string, model: string, basisUrl?: string): Modell {
  // OpenRouter ordnet Aufrufe über diese Kopfzeilen der Anwendung zu (optional, sonst „unbekannt“)
  const kopf = basisUrl?.includes('openrouter.ai') ? { defaultHeaders: { 'X-Title': 'CoSAi AgentMode' } } : {};
  return new SeriellesOpenAI({ apiKey, model, maxTokens: 1500, ...(basisUrl ? { configuration: { baseURL: basisUrl, ...kopf } } : {}) });
}

export const OLLAMA_URL = 'http://localhost:11434';

/**
 * Ein Modell über Ollama. 32k Kontext: der Agent schickt je Schritt 11–25k Tokens (Werkzeuge, Karte, Regeln) — mit der
 * Vorgabe von Ollama schnitte er still ab. Ohne „Denken“ (qwen3 denkt sonst vor jeder Antwort lange).
 */
export function ollamaModell(model: string, baseUrl = OLLAMA_URL): Modell {
  return new ChatOllama({ model, baseUrl, numCtx: 32_768, think: false, numPredict: 1500 });
}

/** Ein Modell zur Auswahl in den Einstellungen */
export interface ModellEintrag { id: string; name: string; frei: boolean; werkzeuge: boolean; kontext: number }

/** Die installierten Ollama-Modelle mit Werkzeugen (lokal: `api/tags`, Fähigkeiten aus `api/show`). */
export async function ollamaModelle(baseUrl = OLLAMA_URL, holen: typeof fetch = fetch): Promise<ModellEintrag[]> {
  const r = await holen(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`Ollama antwortet mit ${r.status}`);
  const namen = (((await r.json()) as { models?: { name: string }[] }).models ?? []).map((m) => m.name);
  const liste = await Promise.all(namen.map(async (name) => {
    const s = await holen(`${baseUrl}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(3000) });
    const d = s.ok ? ((await s.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> }) : {};
    const kontext = Object.entries(d.model_info ?? {}).find(([k]) => k.endsWith('.context_length'))?.[1];
    return { id: name, name, frei: true, werkzeuge: !!d.capabilities?.includes('tools'), kontext: Number(kontext ?? 0) };
  }));
  // Ohne Werkzeuge kann der Agent weder lesen noch bedienen
  return liste.filter((m) => m.werkzeuge).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Die Modelle von OpenRouter (öffentliche Liste, ohne Schlüssel) — nur solche mit Werkzeugen (der Agent braucht sie),
 * kostenlose zuerst. `holen` ist austauschbar (Tests).
 */
export async function openrouterModelle(holen: typeof fetch = fetch): Promise<ModellEintrag[]> {
  const r = await holen('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`OpenRouter antwortet mit ${r.status}`);
  const d = (await r.json()) as { data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[] };
  return (d.data ?? [])
    .map((m) => ({ id: m.id, name: m.name ?? m.id, frei: Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0, werkzeuge: !!m.supported_parameters?.includes('tools'), kontext: m.context_length ?? 0 }))
    .filter((m) => m.werkzeuge)
    .sort((a, b) => Number(b.frei) - Number(a.frei) || a.id.localeCompare(b.id));
}

/** Ein Drehbuch-Modell: antwortet mit den vorbereiteten Nachrichten der Reihe nach; danach mit einem festen Satz. */
export class DrehbuchModell extends BaseChatModel {
  private index = 0;
  readonly aufrufe: BaseMessage[][] = [];

  constructor(private readonly drehbuch: AIMessage[], private readonly danach = 'Erledigt.', felder?: BaseChatModelParams) {
    super(felder ?? {});
  }

  override _llmType(): string {
    return 'drehbuch';
  }

  override bindTools(): this {
    return this;
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.aufrufe.push(messages);
    const message = this.drehbuch[this.index] ?? new AIMessage(this.danach);
    this.index += 1;
    return { generations: [{ text: typeof message.content === 'string' ? message.content : '', message }] };
  }
}

export const drehbuchModell = (drehbuch: AIMessage[], danach?: string) => new DrehbuchModell(drehbuch, danach);

let laufendeNummer = 0;

/** Eine Werkzeug-Antwort im Drehbuch: `ki('Ich öffne den Deal.', [['steuere', { aktionen: [...] }]])` */
export function ki(text: string, werkzeuge: [string, Record<string, unknown>][] = []): AIMessage {
  return new AIMessage({
    content: text,
    // Eindeutige Kennungen: zwei gleiche IDs im Verlauf lassen den Werkzeug-Knoten Antworten verwechseln
    tool_calls: werkzeuge.map(([name, args]) => ({ name, args, id: `aufruf_${(laufendeNummer += 1)}`, type: 'tool_call' as const })),
  });
}

/**
 * Die Attrappe für Klicktests und Entwicklung ohne Schlüssel: versteht ein paar feste Muster und antwortet
 * deterministisch — wie das echte Modell über Werkzeugaufrufe, damit der ganze Weg (Graph, Bestätigung,
 * Oberfläche) ohne Anbieter durchläuft. Kein Sprachverständnis, nur Muster.
 */
export class AttrappenModell extends BaseChatModel {
  constructor() {
    super({});
  }

  override _llmType(): string {
    return 'attrappe';
  }

  override bindTools(): this {
    return this;
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = attrappenAntwort(messages);
    return { generations: [{ text: typeof message.content === 'string' ? message.content : '', message }] };
  }
}

export const attrappenModell = () => new AttrappenModell();

function attrappenAntwort(messages: BaseMessage[]): AIMessage {
  let letzteMensch = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.getType() === 'human') { letzteMensch = i; break; }
  const text = String(letzteMensch >= 0 ? messages[letzteMensch]!.content : '').trim();
  const danach = messages.slice(letzteMensch + 1);
  const werkzeugAntworten = danach.filter((m) => m.getType() === 'tool').map((m) => String(m.content));
  const t = text.toLowerCase();

  // Nach `chips` ist der Zug zu Ende: den Satz noch einmal ohne Werkzeugaufruf, sonst liefe die Schleife weiter
  if (werkzeugAntworten.at(-1) === 'Chips gesetzt.') {
    const letzteAi = [...danach].reverse().find((m) => m.getType() === 'ai');
    return new AIMessage(String(letzteAi?.content ?? 'Erledigt.'));
  }

  // Nach „Ja“ noch offene Schritte (das nächste Senden braucht seine eigene Bestätigung): erneut steuern
  const offen = werkzeugAntworten.at(-1)?.match(/Noch nicht ausgeführt[^:]*: (\[.*\])$/s)?.[1];
  if (offen) return ki('', [['steuere', { aktionen: JSON.parse(offen) as unknown[] }]]);

  // „Analysiere …“ / „Recherchiere …“: eine feste Kurzanalyse und das Angebot, sie zu speichern (Klicktests)
  if (/^(analysiere|recherchiere)\b/.test(t) && !werkzeugAntworten.length) {
    const thema = text.replace(/^(analysiere|recherchiere)\s+(die|den|das)?\s*/i, '').replace(/[.!?]+$/, '').trim() || 'Objekt';
    const titel = `Analyse: ${thema[0]!.toUpperCase()}${thema.slice(1)}`;
    return ki(`Kurzanalyse (Attrappe): ${thema} — ruhige Wohnlage, Preise seitwärts.`, [['ergebnis_speichern', { titel, art: 'recherche', inhalt: `**${titel}**\n\n- ruhige Wohnlage\n- Preise seitwärts (Attrappe)`, quellen: [{ titel: 'Attrappe', url: 'https://example.org/attrappe' }] }]]);
  }
  if (werkzeugAntworten.at(-1)?.startsWith('Gespeichert:')) return ki('Gespeichert — unter 🗂 Ergebnisse zu finden.');

  // Routine: „… 1. Name (schritt), 2. Name (schritt) … Wortlaut für …: „…““ → die Schritte der Reihe nach
  if (/^routine ausführen/.test(t) && !werkzeugAntworten.length) {
    const schritte = [...text.matchAll(/\d+\. [^(]+\(([a-z0-9.\-]+)\)/g)].map((m) => m[1]!);
    const wortlaut = text.match(/Wortlaut für [^:]+: „([^“]+)“/)?.[1] ?? '';
    const aktionen = [
      { art: 'oeffne', ziel: 'deal.reiter.kommunikation', text: 'öffnet Reiter Kommunikation' },
      ...schritte.flatMap((s) => s === 'deal.kommentar'
        ? [{ art: 'fuelle', ziel: 'deal.kommentar.text', wert: wortlaut, text: 'schreibt die Notiz' }, { art: 'sende', ziel: 'deal.kommentar.senden', text: 'Notiz abschicken?' }]
        : [{ art: 'sende', ziel: s, text: `${s} ausführen?` }]),
    ];
    return ki('Ich führe die Routine aus.', [['steuere', { aktionen }]]);
  }

  // Bestätigung („ja“) oder Ablehnung nach einer Unterbrechung
  if (werkzeugAntworten.some((w) => w.startsWith('Der Nutzer hat bestätigt'))) {
    return ki('Erledigt — gespeichert.', [['chips', { liste: [{ label: 'Nächster Deal', wert: 'Nächster Deal' }, { label: 'Was ist heute fällig?', wert: 'Was ist heute fällig?' }] }]]);
  }
  if (werkzeugAntworten.some((w) => w.startsWith('Der Nutzer hat nicht bestätigt'))) {
    return ki('Gut, nicht gesendet. Was soll ich stattdessen tun?', [['chips', { liste: [{ label: 'Text ändern', wert: 'Ich möchte den Text ändern' }, { label: 'Abbrechen', wert: 'Abbrechen' }] }]]);
  }

  // Kommentar/Notiz erfassen: „… Kommentar: <Wortlaut>. Abschicken.“
  if (/kommentar|notiz/.test(t) && text.includes(':')) {
    if (werkzeugAntworten.length) return ki('Die Notiz ist erfasst.', [['chips', { liste: [{ label: 'Nächster Deal', wert: 'Nächster Deal' }] }]]);
    const wortlaut = text.slice(text.indexOf(':') + 1).replace(/\s*(abschicken|absenden|senden)\s*\.?\s*$/i, '').replace(/\.\s*$/, '').trim();
    const aktionen = [
      ...(/ankauf/.test(t) ? [{ art: 'navigiere', ziel: 'nav.ankauf', text: 'öffnet Ankauf' }] : []),
      ...(/erste[nr]?\s+deal/.test(t) ? [{ art: 'oeffne', ziel: 'ankauf.deals.erster', text: 'öffnet den ersten Deal' }] : []),
      { art: 'oeffne', ziel: 'deal.reiter.kommunikation', text: 'öffnet Reiter Kommunikation' },
      { art: 'fuelle', ziel: 'deal.kommentar.text', wert: wortlaut, text: 'schreibt die Notiz' },
      { art: 'sende', ziel: 'deal.kommentar.senden', text: 'Notiz abschicken?' },
    ];
    return ki(`Ich erfasse die Notiz „${wortlaut}“.`, [['steuere', { aktionen }]]);
  }

  // Was ist fällig? → Cockpit lesen, dann zusammenfassen
  if (/fällig|faellig|heute|steht an|anstehen/.test(t)) {
    const cockpit = werkzeugAntworten.find((w) => w.startsWith('{'));
    if (!cockpit) return ki('', [['get_api_ankauf', {}]]);
    try {
      const daten = JSON.parse(cockpit) as { deals?: { objekt?: { titel?: string }; makler?: { name?: string } }[]; makler?: unknown[] };
      const erster = daten.deals?.[0];
      const satz = `Heute sind ${daten.deals?.length ?? 0} Deals und ${daten.makler?.length ?? 0} Makler fällig.${erster ? ` Der erste: ${erster.objekt?.titel ?? 'ohne Titel'}${erster.makler?.name ? `, Makler ${erster.makler.name}` : ''}.` : ''}`;
      return ki(satz, [['chips', { liste: [{ label: 'Ersten Deal öffnen', wert: 'Öffne den ersten Deal' }, { label: 'Makler zeigen', wert: 'Zeige die fälligen Makler' }] }]]);
    } catch {
      return ki('Das Cockpit konnte ich nicht lesen.');
    }
  }

  if (/öffne|oeffne|zeig/.test(t) && /erste[nr]?\s+deal/.test(t)) {
    if (werkzeugAntworten.length) return ki('Der erste Deal ist offen.', [['chips', { liste: [{ label: 'Notiz erfassen', wert: 'Kommentar: ' }, { label: 'Erledigt', wert: 'Markiere als erledigt' }] }]]);
    return ki('Ich öffne den ersten Deal.', [['steuere', { aktionen: [{ art: 'navigiere', ziel: 'nav.ankauf', text: 'öffnet Ankauf' }, { art: 'oeffne', ziel: 'ankauf.deals.erster', text: 'öffnet den ersten Deal' }, { art: 'oeffne', ziel: 'deal.reiter.kommunikation', text: 'öffnet Reiter Kommunikation' }] }]]);
  }

  if (werkzeugAntworten.length) return ki('Erledigt.');
  return ki(`Ich habe verstanden: „${text}“. Was soll ich tun?`, [['chips', { liste: [{ label: 'Was ist heute fällig?', wert: 'Was ist heute fällig?' }, { label: 'Ersten Deal öffnen', wert: 'Öffne den ersten Deal' }] }]]);
}
