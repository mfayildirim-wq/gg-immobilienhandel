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
