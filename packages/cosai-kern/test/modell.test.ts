import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatAnthropic } from '@langchain/anthropic';
import { describe, expect, it } from 'vitest';
import type { ChatOpenAI } from '@langchain/openai';
import { ANBIETER, anthropicModell, attrappenModell, openaiKompatibel } from '../src/modell.ts';

/**
 * Die Klicktests laufen mit der Attrappe — ob das echte Modell die Aufrufparameter annimmt, prüft nur dieser Test.
 * Neuere Claude-Modelle lehnen eine gesetzte `temperature` ab („not supported … when set to non-default values“).
 */
describe('anthropicModell', () => {
  it('baut Aufrufparameter, die das Standardmodell annimmt', () => {
    const modell = anthropicModell('sk-test') as ChatAnthropic;
    expect(() => modell.invocationParams()).not.toThrow();
    expect(modell.invocationParams()).not.toHaveProperty('temperature', 0);
  });

  it('ruft Werkzeuge nacheinander auf — eine Rückfrage in einem Aufruf darf keinen parallelen verschlucken', () => {
    const werkzeug = { name: 'lies', description: 'liest', schema: { type: 'object', properties: {} } };
    const gebunden = anthropicModell('sk-test').bindTools!([werkzeug]) as unknown as { config: { tool_choice?: unknown } };
    expect(gebunden.config.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    // … und so geht es an die API
    const params = (anthropicModell('sk-test') as ChatAnthropic).invocationParams(gebunden.config as never);
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });
});

describe('Attrappe: Routinen', () => {
  const auftrag = 'Routine ausführen (3× so gemacht): 1. Neue Gesprächsnotiz (deal.kommentar), 2. Erledigt (deal.erledigt). Im gerade geöffneten Eintrag. Wortlaut für Neue Gesprächsnotiz: „Mailbox, Rückruf Montag“ (vorschlagen, der Nutzer kann ändern). Jedes Senden einzeln bestätigen lassen.';
  const aktionen = (m: AIMessage) => (m.tool_calls?.[0]?.args as { aktionen: { art: string; ziel: string; wert?: string }[] }).aktionen;

  it('führt eine Routine als Folge von Schritten aus — Notiz füllen und senden, dann Erledigt', async () => {
    const m = (await attrappenModell().invoke([new HumanMessage(auftrag)])) as AIMessage;
    expect(m.tool_calls?.[0]?.name).toBe('steuere');
    expect(aktionen(m).map((a) => `${a.art} ${a.ziel}${a.wert ? ` ${a.wert}` : ''}`)).toEqual([
      'oeffne deal.reiter.kommunikation', 'fuelle deal.kommentar.text Mailbox, Rückruf Montag', 'sende deal.kommentar.senden', 'sende deal.erledigt',
    ]);
  });

  it('steuert nach „Noch nicht ausgeführt“ die offenen Schritte erneut', async () => {
    const offen = [{ art: 'sende', ziel: 'deal.erledigt', text: 'Erledigt?' }];
    const m = (await attrappenModell().invoke([
      new HumanMessage(auftrag),
      new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'steuere', args: {} }] }),
      new ToolMessage({ content: `Der Nutzer hat bestätigt, gesendet. Noch nicht ausgeführt (jedes Senden einzeln bestätigen lassen, dafür steuere erneut aufrufen): ${JSON.stringify(offen)}`, tool_call_id: 't1' }),
    ])) as AIMessage;
    expect(m.tool_calls?.[0]?.name).toBe('steuere');
    expect(aktionen(m)).toEqual(offen);
  });
});

describe('openaiKompatibel (OpenAI, DeepSeek, Kimi)', () => {
  it('spricht die Adresse des Anbieters an und ruft Werkzeuge nacheinander auf', () => {
    const deepseek = ANBIETER.find((a) => a.id === 'deepseek')!;
    const m = openaiKompatibel('sk-test', 'deepseek-chat', deepseek.basisUrl) as ChatOpenAI;
    expect(m.model).toBe('deepseek-chat');
    expect((m as unknown as { clientConfig: { baseURL?: string } }).clientConfig.baseURL).toBe('https://api.deepseek.com');
    const werkzeug = { name: 'lies', description: 'liest', schema: { type: 'object', properties: {} } };
    const gebunden = m.bindTools([werkzeug]) as unknown as { defaultOptions: { parallel_tool_calls?: boolean } };
    expect(gebunden.defaultOptions.parallel_tool_calls).toBe(false);
  });

  it('kennt die unterstützten Anbieter mit ihrem Zugang', () => {
    expect(ANBIETER.map((a) => a.id)).toEqual(['anthropic', 'openai', 'deepseek', 'kimi']);
    expect(ANBIETER.every((a) => a.zugang.endsWith('-api-key'))).toBe(true);
  });
});

describe('Attrappe: Analyse speichern', () => {
  it('antwortet auf „Analysiere …“ mit einer Analyse und bietet das Speichern an', async () => {
    const m = (await attrappenModell().invoke([new HumanMessage('Analysiere die Lage')])) as AIMessage;
    expect(m.tool_calls?.[0]?.name).toBe('ergebnis_speichern');
    expect(m.tool_calls?.[0]?.args).toMatchObject({ titel: 'Analyse: Lage', art: 'recherche' });
  });
});
