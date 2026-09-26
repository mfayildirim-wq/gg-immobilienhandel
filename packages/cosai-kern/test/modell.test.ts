import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatAnthropic } from '@langchain/anthropic';
import { describe, expect, it } from 'vitest';
import { anthropicModell, attrappenModell } from '../src/modell.ts';

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
