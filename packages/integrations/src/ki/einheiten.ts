// Einheiten aus Mieterliste/Flächenberechnung. Werkzeug und Prompt wörtlich aus gg-immohandel server/index.ts
// (POST /api/deals/:dealId/extract-units). Geändert: das PDF geht als Dokument an das Modell statt als
// JPEG-Seiten (der Neubau hat keinen Seiten-Renderer; das Modell rastert die Seiten selbst).
import type { KiClient } from './anthropic.ts';
import { SONNET, type KiAntwort } from './persona.ts';

export const EINHEITEN_TOOL = {
  name: 'extract_einheiten',
  description: 'Extrahiert die Einheitenliste aus einer Mieterliste/Flächenberechnung',
  input_schema: {
    type: 'object',
    properties: {
      einheiten: {
        type: 'array',
        description: 'Eine Zeile pro Einheit (inkl. Stellplätzen). Reihenfolge wie im Dokument.',
        items: {
          type: 'object',
          properties: {
            typ: { type: 'string', enum: ['Wohnung','Gewerbe','Stellplatz','Sonstiges'], description: 'Wohnung für reguläre WE, Gewerbe für Laden/Büro/Praxis, Stellplatz für TG/Carport/Außen' },
            lage: { type: 'string', description: 'Etage/Lage wie im Dokument, z.B. "EG li.", "1. OG re.", "DG", "TG-01", "Whg. 3". Exakte Schreibweise des Dokuments übernehmen.' },
            zimmer: { type: ['number','null'], description: 'Zimmerzahl bei Wohnungen (1.5, 2, 2.5, 3, ...). Bei Stellplätzen null.' },
            flaeche: { type: ['number','null'], description: 'Wohn-/Nutzfläche IST in m². Bei deutschem Komma 85,5 → 85.5 ausgeben. Bei Stellplätzen null. Wenn nicht im Dokument: null (nie raten).' },
            kaltmiete: { type: ['number','null'], description: 'Aktuelle monatliche Netto-Kaltmiete in EUR. NICHT Warmmiete/Bruttomiete/BKM. Bei Leerstand 0. Wenn nicht im Dokument: null.' },
            stk: { type: ['number','null'], description: 'Nur bei typ=Stellplatz: Anzahl der Stellplätze in dieser Zeile (z.B. wenn "10 Außenstellplätze" als eine Zeile aufgeführt sind: 10). Default 1.' },
          },
          required: ['typ', 'lage'],
        },
      },
    },
    required: ['einheiten'],
  },
};

export const EINHEITEN_SYSTEM_PROMPT = `Du extrahierst eine Einheitenliste aus einer deutschen Mieterliste, Wohnungsliste oder Flächenberechnung.

Pflichtfelder pro Einheit: typ + lage. Optional: zimmer, flaeche, kaltmiete, stk.

WICHTIG:
- JEDE Tabellenzeile = eine Einheit (auch wenn leer-stehend)
- Stellplätze als eigene Einträge (typ='Stellplatz', flaeche=null, zimmer=null)
- Bei mehreren Stellplätzen in einer Zeile ("10 TG-Plätze"): stk=10 setzen
- Kaltmiete IMMER netto kalt — wenn nur Warmmiete im Dokument: kaltmiete=null
- Bei Leerstand: kaltmiete=0
- Reihenfolge der Einheiten wie im Dokument
- NIE Werte raten — wenn unklar: null`;

export interface ExtrahierteEinheit { typ: string; lage?: string; zimmer?: number | null; flaeche?: number | null; kaltmiete?: number | null; stk?: number | null }

/** Wirft, wenn das Modell keine Einheitenliste liefert (alt: 500 „KI lieferte keine Einheitenliste“). */
export async function einheitenExtrahieren(ki: KiClient, pdf: Uint8Array, seiten: number): Promise<KiAntwort<ExtrahierteEinheit[]>> {
  const model = SONNET;
  const data = await ki.nachricht({
    model,
    max_tokens: 4000,
    system: EINHEITEN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } },
      { type: 'text', text: `Bitte alle Einheiten aus dieser Mieterliste/Flächenberechnung extrahieren (${seiten} Seite(n)).` },
    ] }],
    tools: [EINHEITEN_TOOL],
    tool_choice: { type: 'tool', name: 'extract_einheiten' },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = (data?.content || []).find((c: any) => c.type === 'tool_use' && c.name === 'extract_einheiten');
  if (!block?.input?.einheiten) throw new Error('KI lieferte keine Einheitenliste');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einheiten = (block.input.einheiten as any[]).filter((e) => e && e.typ);
  return { wert: einheiten, model, usage: data?.usage ?? {} };
}
