import { describe, expect, it } from 'vitest';
import { kiAttrappe, lagebeschreibungGenerieren, lagePrompt, objektbeschreibungGenerieren, objektPrompt, type KiClient } from '../src/index.ts';

const stuttgart = { fullAdresse: 'Aldinger Straße 86, 70378, Stuttgart', stadt: 'Stuttgart', plz: '70378', istStuttgart: true, bestandStandort: [], bestandAnbindung: [] };

/** Attrappe, die mitschreibt, was an das Modell geht. */
function mitschrift() {
  const gesendet: any[] = [];
  const ki: KiClient = { ...kiAttrappe(), async nachricht(body) { gesendet.push(body); return kiAttrappe().nachricht(body); } };
  return { ki, gesendet };
}

describe('Bank-Präsentation: KI-Texte (Prompts wie alt)', () => {
  it('Lage: Haiku, 600 Tokens, erzwungenes Werkzeug; Adresse, Stadt und PLZ stehen in der Frage', async () => {
    const { ki, gesendet } = mitschrift();
    const a = await lagebeschreibungGenerieren(ki, stuttgart);
    expect(gesendet[0]).toMatchObject({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, tool_choice: { type: 'tool', name: 'lagebeschreibung_speichern' } });
    expect(gesendet[0].tools[0].input_schema.required).toEqual(['standortBullets', 'anbindungBullets']);
    expect(gesendet[0].messages[0].content).toContain('Generiere eine Lagebeschreibung für folgendes Objekt:\n\nADRESSE: Aldinger Straße 86, 70378, Stuttgart\nSTADT: Stuttgart\nPLZ: 70378\n\nLiefere zwei Sektionen:');
    expect(a).toMatchObject({ model: 'claude-haiku-4-5-20251001', wert: { standortBullets: ['Wohnlage in Stuttgart (Test-Modus)'], anbindungBullets: ['ÖPNV in der Nähe (Test-Modus)'] } });
  });

  it('Lage: in Stuttgart echte Geographie, anderswo ausdrücklich keine Stuttgarter Linien', () => {
    expect(lagePrompt(stuttgart).system).toContain('- DIESE ADRESSE IST IN STUTTGART. Nutze echte Stuttgarter Geographie: Stadtteile, S-Bahn-Linien (S1-S6, U-Stadtbahn), Autobahnen (A8, A81, B10, B27).');
    const leonberg = lagePrompt({ ...stuttgart, stadt: 'Leonberg', plz: '71229', istStuttgart: false });
    expect(leonberg.system).toContain('- DIESE ADRESSE IST NICHT IN STUTTGART (sondern in Leonberg). Erfinde KEINE Stuttgarter S-Bahn-Linien, Autobahnen oder Stadtteile.');
    expect(leonberg.system).toContain('- ERFINDE NIEMALS Linien-Nummern, Straßennamen oder Stadtteile, die du nicht kennst.');
    expect(leonberg.user).toContain('passend zu Leonberg');
  });

  it('Lage: getippter Bestand geht als Vorgabe in die Frage und kommt zuerst zurück', async () => {
    const { ki, gesendet } = mitschrift();
    const a = await lagebeschreibungGenerieren(ki, { ...stuttgart, bestandStandort: ['Ruhige Wohnlage'], bestandAnbindung: [] });
    const frage = gesendet[0].messages[0].content as string;
    expect(frage).toContain('BEREITS ERFASST (übernehmen, nicht verwerfen):\nStandort:\n- Ruhige Wohnlage\nAnbindung:\n(noch nichts)\n\nLiefere zwei Sektionen:');
    expect(frage).toContain('Die oben bereits erfassten Punkte müssen in deiner Antwort wieder auftauchen — zuerst und inhaltlich unverändert.');
    expect(gesendet[0].system).toContain('- Was der Nutzer bereits erfasst hat, ist RECHERCHIERT und hat Vorrang vor deiner Vermutung.');
    expect(a.wert).toEqual({ standortBullets: ['Ruhige Wohnlage', 'Wohnlage in Stuttgart (Test-Modus)'], anbindungBullets: ['ÖPNV in der Nähe (Test-Modus)'] });
  });

  it('Objekt: Haiku, 700 Tokens; Fakten als Liste, vorhandene Beschreibung als Vorlage', async () => {
    const { ki, gesendet } = mitschrift();
    const a = await objektbeschreibungGenerieren(ki, { fakten: ['Adresse: Aldinger Straße 86, 70378 Stuttgart', 'Baujahr: 1964'], aktuelleBeschreibung: 'Solides Haus.' });
    expect(gesendet[0]).toMatchObject({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, tool_choice: { type: 'tool', name: 'objektbeschreibung_speichern' } });
    const frage = gesendet[0].messages[0].content as string;
    expect(frage).toContain('VORHANDENE FAKTEN:\n- Adresse: Aldinger Straße 86, 70378 Stuttgart\n- Baujahr: 1964\n\nBISHERIGE BESCHREIBUNG (übernimm faktische Details, aber UMFORMULIERE in positive Banker-Sprache wenn nötig):\n"Solides Haus."\n');
    expect(gesendet[0].system).toContain('ANTI-HALLUZINATION:\n- Erfinde KEINE konkreten Modernisierungs-Details, Jahreszahlen oder Bauteile, die NICHT in den Fakten stehen');
    expect(gesendet[0].system).toContain('Beispiel 3 (Gablenberger Hauptstraße):');
    expect(a.wert).toEqual({ beschreibung: 'Bei dem Objekt handelt es sich um ein Mehrfamilienhaus in solider Bausubstanz (Test-Modus, 2 Fakten).' });
  });

  it('Objekt: ohne vorhandene Beschreibung fehlt der Vorlage-Block', () => {
    expect(objektPrompt({ fakten: ['Baujahr: 1964'], aktuelleBeschreibung: '' }).user).not.toContain('BISHERIGE BESCHREIBUNG');
  });
});
