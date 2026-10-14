// Zuordnung unbekannter Bezeichnungen (Protokoll 30, P1): Die Rohdaten entstehen ohne KI; nur Bezeichnungen, die das
// Wörterbuch nicht kennt, gehen als kurze Liste an die KI — Antwort je Nummer: Standard-Pfad und gg-Ziel (Vorschlag).
// Kleine Eingabe, kleine Ausgabe; Katalog und Ziele stehen im zwischengespeicherten System-Prompt.
import { type ErfassteAngabe, GG_ZIELE, KATALOG, katalogFuerPrompt, MAPPING, zieleFuerPrompt } from '@gg/domain';
import type { KiClient } from '../ki/anthropic.ts';
import type { Verbrauch } from '../ki/kosten.ts';
import { genutztesModell } from '../ki/modelle.ts';

/** Fassung der Exposé-Erfassung (Teil A = bisheriger Prompt, Rohdaten im Code, diese Zuordnung). */
export const PROMPT_VERSION_V2 = 'v3.0';
export const BEZEICHNUNGEN_TOOL_NAME = 'bezeichnungen_zuordnen';
const MODELL = 'claude-haiku-4-5-20251001';
const MAX_BEZEICHNUNGEN = 150;

export const BEZEICHNUNGEN_SYSTEM_PROMPT = `Du ordnest Bezeichnungen aus deutschen Immobilien-Exposés zu.
Du bekommst nummerierte Zeilen „Nr. Bezeichnung = Wert“. Gib je Nummer an:
- "pfad": den passenden Standard-Pfad aus der Liste PFADE, sonst null.
- "gg": das passende gg-Feld aus der Liste GG-ZIELE, sonst null.
Nur zuordnen, wenn Bezeichnung und Wert eindeutig passen. Lieber null als falsch. Periodische Mieten: "_jahr" nur, wenn der Wert ausdrücklich jährlich ist.

═══ PFADE (pfad — Bedeutung) ═══
${katalogFuerPrompt()}

═══ GG-ZIELE (gg — Bedeutung) ═══
${zieleFuerPrompt()}`;

export const BEZEICHNUNGEN_TOOL = {
  name: BEZEICHNUNGEN_TOOL_NAME,
  description: 'Ordnet nummerierte Bezeichnungen einem Standard-Pfad und einem gg-Feld zu.',
  input_schema: {
    type: 'object',
    properties: {
      zuordnungen: {
        type: 'array',
        items: {
          type: 'object',
          properties: { nr: { type: 'integer' }, pfad: { type: ['string', 'null'] }, gg: { type: ['string', 'null'] } },
          required: ['nr', 'pfad', 'gg'],
        },
      },
    },
    required: ['zuordnungen'],
  },
};

const schluessel = (a: ErfassteAngabe) => a.bezeichnung.trim().toLowerCase().replace(/[:\s]+$/g, '');

/**
 * Angaben ohne verwertbaren Pfad (null oder ohne Mapping) und ohne gg-Vorschlag → eine Anfrage (höchstens 150
 * verschiedene Bezeichnungen). Ergebnis: Index → Pfad/gg (nur gültige Werte); null, wenn nichts zu fragen war.
 */
export async function bezeichnungenZuordnen(
  ki: KiClient, angaben: ErfassteAngabe[], vermerke: (model: string, usage: Verbrauch | undefined, quelle: string) => Promise<void>,
): Promise<Map<number, { pfad: string | null; gg: string | null }> | null> {
  const gruppen = new Map<string, number[]>();
  angaben.forEach((a, i) => {
    if (a.gg || (a.pfad && MAPPING[a.pfad])) return;
    const k = schluessel(a);
    if (!k) return;
    gruppen.set(k, [...(gruppen.get(k) ?? []), i]);
  });
  const liste = [...gruppen.values()].slice(0, MAX_BEZEICHNUNGEN);
  if (!liste.length) return null;
  const zeilen = liste.map((ix, n) => { const a = angaben[ix[0]!]!; return `${n + 1}. ${a.bezeichnung} = ${a.wert.replace(/\s+/g, ' ').slice(0, 80)}`; });
  const data = await ki.nachricht({
    model: MODELL, max_tokens: 4000,
    system: [{ type: 'text', text: BEZEICHNUNGEN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{ ...BEZEICHNUNGEN_TOOL, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: BEZEICHNUNGEN_TOOL_NAME },
    messages: [{ role: 'user', content: [{ type: 'text', text: zeilen.join('\n') }] }],
  });
  await vermerke(genutztesModell(data, MODELL), data?.usage, 'expose-analyse/bezeichnungen');
  const block = (data?.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === BEZEICHNUNGEN_TOOL_NAME);
  const aus = new Map<number, { pfad: string | null; gg: string | null }>();
  for (const z of block?.input?.zuordnungen ?? []) {
    const ix = liste[(z?.nr ?? 0) - 1];
    if (!ix) continue;
    const pfad = typeof z.pfad === 'string' && z.pfad in KATALOG ? z.pfad : null;
    const gg = typeof z.gg === 'string' && z.gg in GG_ZIELE ? z.gg : null;
    if (!pfad && !gg) continue;
    for (const i of ix) aus.set(i, { pfad, gg });
  }
  return aus;
}
