import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { letzterText } from '../src/graph.ts';

describe('letzterText', () => {
  it('sammelt alle Agenten-Texte seit der letzten Nutzernachricht — das echte Modell antwortet oft neben einem Werkzeugaufruf', () => {
    const verlauf = [
      new HumanMessage('Alte Frage'),
      new AIMessage('Alte Antwort'),
      new HumanMessage('Wie viele Deals heute?'),
      new AIMessage({ content: [{ type: 'text', text: 'Heute sind 12 Deals fällig.' }, { type: 'tool_use', id: 't1', name: 'zeige_chips', input: {} }] }),
      new ToolMessage({ content: 'Chips gesetzt.', tool_call_id: 't1' }),
      new AIMessage('Sag Bescheid, wenn ich einen öffnen soll.'),
    ];
    expect(letzterText(verlauf)).toBe('Heute sind 12 Deals fällig.\n\nSag Bescheid, wenn ich einen öffnen soll.');
  });

  it('wiederholt einen Satz nicht, den das Modell nach einem Werkzeugaufruf noch einmal sagt', () => {
    const verlauf = [
      new HumanMessage('nein'),
      new AIMessage({ content: 'Gut, nicht gesendet.', tool_calls: [{ id: 't', name: 'chips', args: {} }] }),
      new ToolMessage({ content: 'Chips gesetzt.', tool_call_id: 't' }),
      new AIMessage('Gut, nicht gesendet.'),
    ];
    expect(letzterText(verlauf)).toBe('Gut, nicht gesendet.');
  });

  it('Werkzeugaufrufe ohne Text zählen nicht', () => {
    expect(letzterText([new HumanMessage('los'), new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'lies', args: {} }] })])).toBe('');
  });
});
