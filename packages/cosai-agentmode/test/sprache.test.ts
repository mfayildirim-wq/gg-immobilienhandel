import { describe, expect, it } from 'vitest';
import { istStoppwort, sprechfassung } from '../src/sprache.ts';

describe('sprechfassung', () => {
  it('liest ohne Markdown vor und nur den ersten Absatz', () => {
    expect(sprechfassung('**53 Deals** sind fällig.\n\n- Obertürkheimer Straße 11\n- Tübinger Str. 91')).toBe('53 Deals sind fällig.');
    expect(sprechfassung('## Überblick\n`deal.erledigt` ist *wichtig*.')).toBe('Überblick deal.erledigt ist wichtig.');
  });

  it('kürzt lange Texte am Satzende', () => {
    const satz = 'Das ist ein Satz mit etwas Inhalt, damit er lang genug wird. ';
    const lang = satz.repeat(12);
    const kurz = sprechfassung(lang);
    expect(kurz.length).toBeLessThanOrEqual(280);
    expect(kurz.endsWith('.')).toBe(true);
  });
});

describe('istStoppwort', () => {
  it('erkennt Stopp, Halt, Ruhe — aber keinen Auftrag', () => {
    for (const w of ['Stopp', 'stop.', 'Halt!', 'Ruhe', 'sei still', 'genug']) expect(istStoppwort(w), w).toBe(true);
    for (const w of ['Stopp den Deal', 'Stoppuhr', 'nächster Deal']) expect(istStoppwort(w), w).toBe(false);
  });
});
