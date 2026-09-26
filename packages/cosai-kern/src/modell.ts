/**
 * Das Sprachmodell hinter dem Agenten — ein LangChain-`BaseChatModel`, damit der Graph jeden Anbieter nimmt.
 * `anthropicModell` für den Betrieb, `drehbuchModell` für Tests und Klicktests (gibt vorbereitete Antworten der Reihe nach).
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export type Modell = BaseChatModel;

export function anthropicModell(apiKey: string, model = 'claude-sonnet-5'): Modell {
  return new ChatAnthropic({ apiKey, model, temperature: 0, maxTokens: 1500 });
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
