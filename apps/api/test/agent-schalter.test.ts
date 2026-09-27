import { describe, expect, it } from 'vitest';
import { agentModusAn } from '../src/kontext.ts';

describe('AgentMode-Schalter', () => {
  it('ist lokal an, online erst mit AGENTMODE_AKTIV=ja', () => {
    expect(agentModusAn({})).toBe(true);
    expect(agentModusAn({ AGENTMODE_AKTIV: 'nein' })).toBe(false);
    expect(agentModusAn({ VERCEL: '1' })).toBe(false);
    expect(agentModusAn({ NODE_ENV: 'production' })).toBe(false);
    expect(agentModusAn({ VERCEL: '1', AGENTMODE_AKTIV: 'ja' })).toBe(true);
  });
});
