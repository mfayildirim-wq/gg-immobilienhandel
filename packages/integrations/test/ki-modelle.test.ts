import { describe, expect, it } from 'vitest';
import { anfrageFuerModell, antwortBereinigen, kiAttrappe, kiMitModell, kostenEur, lagebeschreibungGenerieren, type KiClient } from '../src/index.ts';

const lage = {
  model: 'claude-haiku-4-5-20251001', max_tokens: 600, temperature: 0, system: 'Du bist …', messages: [{ role: 'user', content: 'x' }],
  tools: [{ name: 'lagebeschreibung_speichern' }], tool_choice: { type: 'tool', name: 'lagebeschreibung_speichern' },
};

describe('Modellwahl: Anfrage an das gewählte Modell anpassen', () => {
  it('ohne Wahl und bei Haiku 4.5 / Sonnet 4.5 bleibt die Anfrage wie sie ist', () => {
    expect(anfrageFuerModell(lage, null)).toEqual(lage);
    expect(anfrageFuerModell(lage, 'claude-sonnet-4-5-20250929')).toEqual({ ...lage, model: 'claude-sonnet-4-5-20250929' });
  });

  it('5.5-Modelle: ohne temperature, Werkzeug per Anweisung statt erzwungen, Platz zum Denken, wenig Aufwand', () => {
    const a = anfrageFuerModell(lage, 'claude-sonnet-5-5');
    expect(a).toMatchObject({ model: 'claude-sonnet-5-5', tool_choice: { type: 'auto' }, max_tokens: 4096, output_config: { effort: 'low' } });
    expect(a).not.toHaveProperty('temperature');
    expect(a.system).toBe('Du bist …\n\nAntworte ausschließlich, indem du das Werkzeug „lagebeschreibung_speichern“ aufrufst — kein Text außerhalb davon.');
    // System als Blockliste (Exposé-Analyse mit Cache-Markierung) bekommt einen Block dazu
    const b = anfrageFuerModell({ ...lage, system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }] }, 'claude-opus-5-5');
    expect(b.system).toHaveLength(2);
    expect(b.system[0]).toEqual({ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } });
  });

  it('Sonnet 5 nimmt das erzwungene Werkzeug, aber keine temperature', () => {
    const a = anfrageFuerModell(lage, 'claude-sonnet-5');
    expect(a.tool_choice).toEqual(lage.tool_choice);
    expect(a).not.toHaveProperty('temperature');
  });

  it('Antwort: Denkblöcke heraus, damit der erste Block die Antwort ist; das Modell steht dabei', () => {
    const roh = { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'Hallo' }], usage: { input_tokens: 1 } };
    expect(antwortBereinigen(roh, 'claude-haiku-5-5')).toEqual({ content: [{ type: 'text', text: 'Hallo' }], usage: { input_tokens: 1 }, model: 'claude-haiku-5-5' });
    expect(antwortBereinigen({ ...roh, model: 'claude-haiku-5-5-x' }, 'claude-haiku-5-5').model).toBe('claude-haiku-5-5-x');
  });

  it('die Hülle lenkt um, und die Funktion meldet das tatsächlich genutzte Modell (für die Kostenbuchung)', async () => {
    const gesendet: any[] = [];
    const ki: KiClient = { ...kiAttrappe(), async nachricht(body) { gesendet.push(body); return kiAttrappe().nachricht(body); } };
    const a = await lagebeschreibungGenerieren(kiMitModell(ki, 'claude-sonnet-5-5'), {
      fullAdresse: 'Weg 1, 70173, Stuttgart', stadt: 'Stuttgart', plz: '70173', istStuttgart: true, bestandStandort: [], bestandAnbindung: [],
      anschrift: { strasse: 'Weg', hausnr: '1', plz: '70173', stadt: 'Stuttgart' },
    });
    expect(gesendet[0].model).toBe('claude-sonnet-5-5');
    expect(a.model).toBe('claude-sonnet-5-5');
    expect(a.wert).toMatchObject({ standortBullets: ['Wohnlage in Stuttgart (Test-Modus)'] });
  });

  it('Kosten: die neuen Modelle mit ihrem Preis', () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(kostenEur('claude-haiku-4-5-20251001', u)).toBe(+(6 * 0.92).toFixed(4));
    expect(kostenEur('claude-haiku-5-5', u)).toBe(+(0.6 * 0.92).toFixed(4));
    expect(kostenEur('claude-sonnet-5-5', u)).toBe(+(12 * 0.92).toFixed(4));
    expect(kostenEur('claude-sonnet-4-5-20250929', u)).toBe(+(18 * 0.92).toFixed(4));
    expect(kostenEur('claude-opus-5-5', u)).toBe(+(24 * 0.92).toFixed(4));
  });
});
