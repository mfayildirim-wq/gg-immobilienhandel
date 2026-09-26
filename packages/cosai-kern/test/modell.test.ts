import type { ChatAnthropic } from '@langchain/anthropic';
import { describe, expect, it } from 'vitest';
import { anthropicModell } from '../src/modell.ts';

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
