// Übernommen aus gg-immohandel server/expose-extract.ts (Stand 9d693b8). Inhaltlich unverändert; Anpassungen sind markiert.
/**
 * Strukturierte Objektdaten aus reinem Text gewinnen.
 *
 * Wird von zwei Stellen gebraucht: vom Endpunkt /api/auto-import/extract-from-body
 * (Nutzer stößt es im Wizard an) und von der Import-Engine, wenn die Triage den
 * Mail-Text selbst als Exposé erkennt (R11 — ein Import braucht kein PDF).
 * Deshalb liegen Schema und Anweisung hier und nicht im Endpunkt.
 */

export type ExtractAiCall = (body: any) => Promise<any>;

export interface ExtractedExpose {
  objekt: Record<string, any>;
  makler: Record<string, any>;
  kalkulation: Record<string, any>;
  _konfidenz?: Record<string, 'hoch' | 'mittel' | 'niedrig'>;
}

export const EXTRACT_TOOL = {
  name: 'extract_expose_data',
  description: 'Extrahiert deutsche Immobilien-Eckdaten als strukturiertes JSON',
  input_schema: {
    type: 'object',
    properties: {
      objekt: {
        type: 'object',
        properties: {
          strasse: { type: 'string' }, hausnr: { type: 'string' }, plz: { type: 'string' }, stadt: { type: 'string' },
          bundesland: { type: 'string' },
          baujahr: { type: ['number', 'null'] }, wohnflaeche: { type: ['number', 'null'] }, grundstueck: { type: ['number', 'null'] },
          einheitenAnz: { type: ['number', 'null'] },
          angebotspreis: { type: ['number', 'null'] }, istmiete: { type: ['number', 'null'] }, bruttorendite: { type: ['number', 'null'] },
          heizungsart: { type: 'string' }, heizungsbaujahr: { type: ['number', 'null'] },
          energieausweis: { type: 'object', properties: { klasse: { type: 'string' }, kennwert: { type: ['number', 'null'] }, art: { type: 'string' } } },
          lagebeschreibung: { type: 'string' }, ausstattung: { type: 'string' }, notizen: { type: 'string' },
          einheiten: {
            type: 'array',
            items: {
              type: 'object', properties: {
                typ: { type: 'string', enum: ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'] },
                lage: { type: 'string' }, zimmer: { type: ['number', 'null'] },
                flaeche: { type: ['number', 'null'] }, kaltmiete: { type: ['number', 'null'] },
                vermiet: { type: 'string', enum: ['Vermietet', 'Leerstand'] },
              },
            },
          },
        },
      },
      makler: {
        type: 'object',
        properties: {
          name: { type: 'string' }, firma: { type: 'string' },
          mobiltel: { type: 'string' }, festnetztel: { type: 'string' }, tel: { type: 'string' },
          email: { type: 'string' }, webseite: { type: 'string' },
        },
      },
      kalkulation: {
        type: 'object',
        properties: {
          kaufpreis: { type: ['number', 'null'] }, notar: { type: ['number', 'null'] },
          gest: { type: ['number', 'null'] }, makler: { type: ['number', 'null'] },
          fk_p: { type: ['number', 'null'] }, ek_p: { type: ['number', 'null'] },
          euribor: { type: ['number', 'null'] }, margeB: { type: ['number', 'null'] },
          ek_r: { type: ['number', 'null'] }, halt: { type: ['number', 'null'] },
          rp: { type: ['number', 'null'] }, glo_m: { type: ['number', 'null'] },
        },
      },
      _konfidenz: { type: 'object', additionalProperties: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] } },
    },
    required: ['objekt', 'makler', 'kalkulation'],
  },
};

export const EXTRACT_SYSTEM_PROMPT = `Du extrahierst aus einer deutschen Makler-E-Mail die Immobilien-Eckdaten.
- NUR Werte übernehmen die im Text EXPLIZIT genannt sind — niemals raten
- Wenn ein Feld fehlt → null setzen
- Makler-Daten kommen aus der Mail-Signatur am Ende
- Bei Kaltmiete: NUR Netto-Kaltmiete, nie Warmmiete
- Bei Adresse: Straße + Hausnummer + PLZ + Stadt müssen alle genannt sein, sonst leer lassen
- Antworte nur über das Tool.`;

/** Vollständige Adresse = Straße, Hausnummer, PLZ und Ort. Alles darunter ist Teilwissen. */
export function hasCompleteAddress(extracted: ExtractedExpose | null | undefined): boolean {
  const o = extracted?.objekt;
  if (!o) return false;
  return Boolean(String(o.strasse || '').trim() && String(o.hausnr || '').trim()
    && String(o.plz || '').trim() && String(o.stadt || '').trim());
}

/** Welche Pflichtangaben fehlen — Grundlage für die Begründung im Wizard (R10). */
export function missingCoreFields(extracted: ExtractedExpose | null | undefined): string[] {
  const o = extracted?.objekt || {};
  const missing: string[] = [];
  if (!String(o.strasse || '').trim() || !String(o.hausnr || '').trim()) missing.push('Straße + Hausnummer');
  if (!String(o.plz || '').trim() || !String(o.stadt || '').trim()) missing.push('PLZ + Ort');
  const preis = o.angebotspreis ?? extracted?.kalkulation?.kaufpreis;
  if (!preis) missing.push('Kaufpreis');
  return missing;
}

/** Führt die Extraktion aus. Wirft, wenn die KI keine Struktur liefert. */
export async function extractExposeFromText(
  text: string,
  aiCall: ExtractAiCall,
  ctx: { from?: string; subject?: string } = {},
): Promise<ExtractedExpose> {
  const data = await aiCall({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 3000,
    system: EXTRACT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Absender: ${ctx.from || 'unbekannt'}\nBetreff: ${ctx.subject || ''}\n\nMail-Body:\n${text.substring(0, 12000)}`,
    }],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_expose_data' },
  });

  const toolBlock = (data?.content || []).find(
    (c: any) => c.type === 'tool_use' && c.name === 'extract_expose_data',
  );
  if (!toolBlock?.input) throw new Error('KI lieferte keine strukturierten Daten');
  return toolBlock.input as ExtractedExpose;
}
