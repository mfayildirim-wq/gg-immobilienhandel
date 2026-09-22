import type { KiClient } from './anthropic.ts';

/**
 * KI-Attrappe für Tests und lokale Entwicklung ohne API-Schlüssel (KI_ATTRAPPE=1).
 * Liest einfache „Feld: Wert“-Zeilen aus dem Text, den die Analyse schickt, und antwortet im Format des Tools.
 * Kein Ersatz für die echte Auswertung – die Oberfläche kennzeichnet den Test-Modus.
 *
 *   Adresse: Lindenstraße 12, 70178 Stuttgart
 *   Kaufpreis: 1.250.000 €        Wohnfläche: 480 m²        Baujahr: 1978
 *   Makler: Anna Beispiel | Beispiel Immobilien GmbH | 0171 1234567 | anna@beispiel.test
 *   Einheit: Wohnung | EG links | 3 | 78 | 780
 */
export function kiAttrappe(): KiClient {
  // erste Zahl im Wert („240 m2“ → 240, „1.250.000 EUR“ → 1250000)
  const zahl = (s: string | undefined) => { const m = s?.match(/\d[\d.,]*/)?.[0]; return m ? Number(m.replace(/\./g, '').replace(',', '.')) || null : null; };
  return {
    async nachricht(body: any) {
      // Aufrufe ohne Werkzeug (Makler-KI, Persona): feste, erkennbare Textantworten
      if (!body?.tools) return { content: [{ type: 'text', text: textAntwort(String(body?.messages?.[0]?.content ?? '')) }], usage: { input_tokens: 0, output_tokens: 0 } };
      if (body.tools[0]?.name === 'extract_einheiten') {
        // Einheiten-Zeilen „Einheit: Typ | Lage | Zimmer | Fläche | Kaltmiete“ direkt aus dem (unkomprimierten) Test-PDF
        const dok = body.messages?.[0]?.content?.find?.((c: any) => c.type === 'document')?.source?.data ?? '';
        const roh = Buffer.from(dok, 'base64').toString('latin1');
        const einheiten = [...roh.matchAll(/\(Einheit:\s*([^)]*)\)/g)].map((m) => {
          const [typ, lage, zimmer, flaeche, kaltmiete] = m[1]!.split('|').map((s) => s.trim());
          return { typ: typ || 'Wohnung', lage: lage ?? '', zimmer: zahl(zimmer), flaeche: zahl(flaeche), kaltmiete: zahl(kaltmiete) };
        });
        return { content: [{ type: 'tool_use', name: 'extract_einheiten', input: { einheiten } }], usage: { input_tokens: 0, output_tokens: 0 } };
      }
      // Auto-Import: die vier engen Fragen des Bots, nach festen Regeln am Dateinamen beantwortet (Test-Modus)
      const werkzeug = body.tools[0]?.name as string | undefined;
      const ohneKosten = { input_tokens: 0, output_tokens: 0 };
      if (werkzeug === 'classify') {
        const dateiname = /Dateiname: ([^\\\n"]*)/.exec(JSON.stringify(body.messages))?.[1] ?? '';
        const input = /agb|widerruf|datenschutz/i.test(dateiname)
          ? { type: 'agb', confidence: 0.95, completeness: 'unklar', missingFields: [], extractedAddress: '', reason: 'Rechtsdokument (Test-Modus)' }
          : /vorschau|teaser/i.test(dateiname)
            ? { type: 'expose', confidence: 0.8, completeness: 'eingeschraenkt', missingFields: ['adresse', 'fotos'], extractedAddress: '', reason: 'Vorschau (Test-Modus)' }
            : { type: 'expose', confidence: 0.9, completeness: 'vollstaendig', missingFields: [], extractedAddress: 'Musterweg 1, 89073 Ulm', reason: 'vollständig (Test-Modus)' };
        return { content: [{ type: 'tool_use', name: werkzeug, input }], usage: ohneKosten };
      }
      if (werkzeug === 'classify_page') return { content: [{ type: 'tool_use', name: werkzeug, input: { type: 'agb-form' } }], usage: ohneKosten };
      if (werkzeug === 'rank') return { content: [{ type: 'tool_use', name: werkzeug, input: { orderedIndices: [] } }], usage: ohneKosten };
      if (werkzeug === 'pick_link') return { content: [{ type: 'tool_use', name: werkzeug, input: { selectedIndex: 0, reason: 'Test-Modus' } }], usage: ohneKosten };

      const text = JSON.stringify(body?.messages ?? []).replace(/\\n/g, '\n');
      const feld = (name: string) => new RegExp(`${name}:\\s*([^\\n"]+)`).exec(text)?.[1]?.trim();
      const adresse = /^(.+?)\s+(\d+\s*\w?),\s*(\d{5})\s+(.+)$/.exec(feld('Adresse') ?? '');
      const makler = (feld('Makler') ?? '').split('|').map((s) => s.trim());
      const einheiten = [...text.matchAll(/Einheit:\s*([^\n"]+)/g)].map((m) => {
        const [typ, lage, zimmer, flaeche, kaltmiete] = m[1]!.split('|').map((s) => s.trim());
        return { typ: typ || 'Wohnung', lage, zimmer: zahl(zimmer), flaeche: zahl(flaeche), kaltmiete: zahl(kaltmiete), vermiet: 'Vermietet' };
      });
      const input = {
        objekt: {
          strasse: adresse?.[1] ?? '', hausnr: adresse?.[2] ?? '', plz: adresse?.[3] ?? '', stadt: adresse?.[4] ?? '',
          angebotspreis: zahl(feld('Kaufpreis')), wohnflaeche: zahl(feld('Wohnfläche') ?? feld('Wohnflaeche')), baujahr: zahl(feld('Baujahr')),
          einheitenAnz: einheiten.length || null, einheiten,
        },
        makler: { name: makler[0] ?? '', firma: makler[1] ?? '', mobiltel: makler[2] ?? '', email: makler[3] ?? '' },
        kalkulation: { kaufpreis: zahl(feld('Kaufpreis')) },
        _konfidenz: { strasse: adresse ? 'hoch' : 'niedrig', angebotspreis: feld('Kaufpreis') ? 'hoch' : 'niedrig', wohnflaeche: 'mittel' },
      };
      return { content: [{ type: 'tool_use', name: 'extract_expose_data', input }], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    async dateiHochladen() { return 'attrappe'; },
    async dateiLoeschen() {},
  };
}

/** Textantworten der Attrappe je Prompt-Art (Test-Modus, keine echte Auswertung). */
function textAntwort(prompt: string): string {
  if (prompt.includes('{"mentions":')) {
    const m = /TEXT: ([\s\S]*?)\n\nSuche nach/.exec(prompt)?.[1] ?? '';
    return JSON.stringify({ mentions: /urlaub/i.test(m) ? [{ thema: 'Urlaub', detail: 'Erwähnt Urlaub (Test-Modus)' }] : [] });
  }
  if (prompt.includes('"geburtsdatum": "MM-DD oder YYYY-MM-DD"')) {
    const geb = /Geburtstag(?: am)?:?\s*(\d{2}-\d{2})/i.exec(prompt)?.[1];
    return JSON.stringify({ ...(geb ? { geburtsdatum: geb } : {}), hobbies: ['Test-Modus'] });
  }
  if (prompt.includes('{"wa":"...","email"')) return JSON.stringify({ wa: 'Hallo, kurze Nachfrage zum Objekt (Test-Modus).', email: { subject: 'Nachfrage (Test-Modus)', body: 'Guten Tag,\n\nkurze Nachfrage (Test-Modus).' } });
  if (prompt.includes('"rawAnalysis"')) {
    return JSON.stringify({ anrede: 'Hallo', abschluss: { wa: 'VG', email: 'Viele Grüße' }, tonWA: 'kurz', tonEmail: 'sachlich', themenMuster: 'Objekt, Preis', vokabular: 'Objekt', laenge: { wa: '2 Sätze', email: '4 Sätze' }, rawAnalysis: 'Test-Modus: direkt und freundlich.' });
  }
  if (prompt.startsWith('Analysiere die Kommunikation zwischen')) return 'Test-Modus: sachlich-freundliche Beziehung per Sie.';
  return 'Test-Modus: Zusammenfassung der Kommunikation.';
}
