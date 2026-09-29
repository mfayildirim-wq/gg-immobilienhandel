import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { letzterText, serverWerkzeuge, verlaufFenster, verwendeteWerkzeuge } from '../src/graph.ts';
import { anthropicModell, drehbuchModell } from '../src/modell.ts';

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

  it('trennt Text vor und nach einer Claude-Websuche durch einen Absatz, Zitat-Stücke bleiben zusammen', () => {
    const verlauf = [
      new HumanMessage('Webanalyse'),
      new AIMessage({ content: [
        { type: 'text', text: 'Ich recherchiere kurz.' },
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Esslingen' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
        { type: 'text', text: 'Die Preise liegen bei ' },
        { type: 'text', text: 'rund 4.000 €/m².', citations: [] },
      ] as never }),
    ];
    expect(letzterText(verlauf)).toBe('Ich recherchiere kurz.\n\nDie Preise liegen bei rund 4.000 €/m².');
  });

  it('Werkzeugaufrufe ohne Text zählen nicht', () => {
    expect(letzterText([new HumanMessage('los'), new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'lies', args: {} }] })])).toBe('');
  });
});

describe('verlaufFenster', () => {
  const zug = (n: number, groesse: number) => [
    new HumanMessage(`Frage ${n}`),
    new AIMessage({ content: '', tool_calls: [{ id: `t${n}`, name: 'lies', args: {} }] }),
    new ToolMessage({ content: 'x'.repeat(groesse), tool_call_id: `t${n}` }),
    new AIMessage(`Antwort ${n}`),
  ];

  it('lässt kurze Verläufe unverändert', () => {
    const v = [...zug(1, 10), ...zug(2, 10)];
    expect(verlaufFenster(v, 1000)).toEqual(v);
  });

  it('schneidet alte Züge ab — immer an einer Nutzernachricht, der aktuelle Zug bleibt ganz', () => {
    const v = [...zug(1, 5000), ...zug(2, 5000), ...zug(3, 5000)];
    const f = verlaufFenster(v, 12_000);
    expect(f[0]).toBeInstanceOf(HumanMessage);
    expect(f[0]!.content).toBe('Frage 2');
    expect(f.at(-1)!.content).toBe('Antwort 3');
    // Auch wenn schon der letzte Zug allein zu groß ist: er bleibt, sonst hätte das Modell keine Frage
    expect(verlaufFenster(v, 100)[0]!.content).toBe('Frage 3');
  });
});

describe('serverWerkzeuge', () => {
  it('bindet die Claude-Websuche nur bei Anthropic und nur, wenn sie eingeschaltet ist', () => {
    expect(serverWerkzeuge(anthropicModell('sk-test'), { claudeSuche: true })).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(serverWerkzeuge(anthropicModell('sk-test'), { claudeSuche: false })).toEqual([]);
    expect(serverWerkzeuge(drehbuchModell([]), { claudeSuche: true })).toEqual([]);
  });
});

describe('verwendeteWerkzeuge', () => {
  it('nimmt die Werkzeuge der letzten Züge — auch die Websuche von Claude —, ohne ergebnis_speichern', () => {
    const verlauf = [
      new HumanMessage('Alt'), new AIMessage({ content: '', tool_calls: [{ id: 'a', name: 'uralt', args: {} }] }),
      new HumanMessage('Analysiere die Lage'),
      new AIMessage({ content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }, { type: 'text', text: 'Analyse …' }] as never }),
      new AIMessage({ content: '', tool_calls: [{ id: 'b', name: 'seite_lesen', args: {} }] }),
      new HumanMessage('speichern'),
      new AIMessage({ content: '', tool_calls: [{ id: 'c', name: 'ergebnis_speichern', args: {} }] }),
    ];
    expect(verwendeteWerkzeuge(verlauf)).toEqual(['web_search', 'seite_lesen']);
  });
});

describe('Prompt-Caching', () => {
  it('teilt den Systemtext: fest (Karte, Regeln) vorn, wechselnd (Ort, Erinnerungen) hinten', async () => {
    const { systemteile } = await import('../src/graph.ts');
    const { DNA } = await import('../src/vertrag.ts');
    const dna = DNA.parse({ slug: 't', name: 'Agent', rolle: 'hilft' });
    const t = systemteile(dna, [{ ziel: 'nav.deals', beschreibung: 'Seite Deals', seite: '/deals' }], ['fakt a: b'], { ort: '/deals', kontext: { dealId: 'd1' } } as never);
    expect(t.fest).toContain('nav.deals: Seite Deals');
    expect(t.fest).toContain('Grundregeln');
    expect(t.fest).not.toContain('/deals mit Kontext');
    expect(t.wechselnd).toContain('fakt a: b');
    expect(t.wechselnd).toContain('Der Nutzer ist gerade auf Seite /deals mit Kontext {"dealId":"d1"}');
  });

  it('setzt für Anthropic zwei Marken: fester Systemteil und letzte Nutzernachricht — sonst ein schlichter Systemtext', async () => {
    const { mitCache } = await import('../src/graph.ts');
    const { HumanMessage, AIMessage, SystemMessage } = await import('@langchain/core/messages');
    const verlauf = [new HumanMessage('alt'), new AIMessage('ok'), new HumanMessage('Was ist fällig?'), new AIMessage('…')];
    const [sys, ...rest] = mitCache({ fest: 'FEST', wechselnd: 'ORT' }, verlauf, true);
    expect(sys).toBeInstanceOf(SystemMessage);
    expect(sys!.content).toEqual([{ type: 'text', text: 'FEST', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'ORT' }]);
    expect(rest[0]!.content).toBe('alt');
    expect(rest[2]!.content).toEqual([{ type: 'text', text: 'Was ist fällig?', cache_control: { type: 'ephemeral' } }]);
    expect(verlauf[2]!.content).toBe('Was ist fällig?');
    const schlicht = mitCache({ fest: 'FEST', wechselnd: 'ORT' }, verlauf, false);
    expect(schlicht[0]!.content).toBe('FEST\nORT');
    expect(schlicht.slice(1)).toEqual(verlauf);
  });
});

describe('nurEinWerkzeug', () => {
  it('lässt bei mehreren Werkzeugaufrufen in einer Antwort nur den ersten gelten', async () => {
    const { nurEinWerkzeug } = await import('../src/graph.ts');
    const zwei = new AIMessage({ content: 'Ich mache beides.', tool_calls: [{ id: 'a', name: 'steuere', args: {} }, { id: 'b', name: 'merke', args: {} }] });
    const eins = nurEinWerkzeug(zwei);
    expect(eins.tool_calls?.map((t) => t.id)).toEqual(['a']);
    expect(eins.content).toBe('Ich mache beides.');
    const einzeln = new AIMessage({ content: 'x', tool_calls: [{ id: 'a', name: 'steuere', args: {} }] });
    expect(nurEinWerkzeug(einzeln)).toBe(einzeln);
  });
});

describe('chipsAusText', () => {
  it('macht aus „Nächste Schritte:“ mit Punkten Chips und nimmt sie aus dem Text', async () => {
    const { chipsAusText } = await import('../src/graph.ts');
    expect(chipsAusText('Der Deal wurde als erledigt markiert. **Nächste Schritte:** - Nächsten Deal öffnen - Makler anzeigen')).toEqual({
      text: 'Der Deal wurde als erledigt markiert.', chips: [{ label: 'Nächsten Deal öffnen', wert: 'Nächsten Deal öffnen' }, { label: 'Makler anzeigen', wert: 'Makler anzeigen' }],
    });
    expect(chipsAusText('Heute sind **0 Deals fällig**. **Nächste Schritte:** - Kommunikation mit Makler Michael Schultz-Kranich (Tübinger Str.) einleiten - Deal als erledigt markieren').text).toBe('Heute sind **0 Deals fällig**.');
    expect(chipsAusText('Erledigt.\n\nNächste Schritte:\n• Nächsten Deal öffnen\n• Makler anzeigen').chips.map((c) => c.label)).toEqual(['Nächsten Deal öffnen', 'Makler anzeigen']);
  });
  it('liest <chips>-Blöcke und Markdown-Links auf Ziele', async () => {
    const { chipsAusText } = await import('../src/graph.ts');
    // Liste und Block zugleich: beides verschwindet, die Chips kommen aus dem Block
    expect(chipsAusText('Es sind 0 fällig. **Nächste Schritte:** - Makler anrufen - Deal erledigen\n<chips>\n{"label":"Makler anrufen","wert":"Makler anrufen"}\n</chips>')).toEqual({ text: 'Es sind 0 fällig.', chips: [{ label: 'Makler anrufen', wert: 'Makler anrufen' }] });
    expect(chipsAusText('Es sind 0 fällig. <chips> {"art": "vorschlag", "label": "Deal öffnen", "wert": "nav.deals"} {"label": "Makler zeigen", "wert": "Zeige die Makler"}')).toEqual({
      text: 'Es sind 0 fällig.', chips: [{ label: 'Deal öffnen', wert: 'Deal öffnen' }, { label: 'Makler zeigen', wert: 'Zeige die Makler' }],
    });
    expect(chipsAusText('Kommentar gespeichert.\n\nMöglichkeiten:\n- [Deal erledigt](#deal.erledigt)\n- [Nächster Kontakt](#deal.naechster)').chips.map((c) => c.label)).toEqual(['Deal erledigt', 'Nächster Kontakt']);
  });
  it('kürzt lange Punkte auf dem Chip — gesendet wird der ganze Satz', async () => {
    const { chipsAusText } = await import('../src/graph.ts');
    const r = chipsAusText('Fertig. **Nächste Schritte:** - Prüfe **Sandra Seibold** (Furtäcker 14A: 111 Tage nicht kontaktiert) auf Stagnation und aktualisiere den Status. - Makler anrufen');
    expect(r.text).toBe('Fertig.');
    expect(r.chips[0]!.wert).toBe('Prüfe Sandra Seibold (Furtäcker 14A: 111 Tage nicht kontaktiert) auf Stagnation und aktualisiere den Status');
    expect(r.chips[0]!.label.length).toBeLessThanOrEqual(50);
    expect(r.chips[1]).toEqual({ label: 'Makler anrufen', wert: 'Makler anrufen' });
  });

  it('lässt gewöhnliche Aufzählungen im Inhalt stehen', async () => {
    const { chipsAusText } = await import('../src/graph.ts');
    const t = 'Fällig sind:\n- Musterweg 1\n- Hauptstraße 2';
    expect(chipsAusText(t)).toEqual({ text: t, chips: [] });
    expect(chipsAusText('Alles erledigt.')).toEqual({ text: 'Alles erledigt.', chips: [] });
  });
});
