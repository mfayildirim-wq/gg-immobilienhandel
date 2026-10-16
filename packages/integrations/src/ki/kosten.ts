// Kosten eines KI-Aufrufs. Übernommen aus gg-immohandel server/ki-kosten.ts (Rechnung unverändert).
// Preistabelle um die wählbaren neuen Modelle ergänzt (Einstellungen → KI-Modelle; Anthropic-Preisliste 10/2026).

interface Preis { ein: number; aus: number }

/** US-$ je Million Token. Neue Modelle mit eigenem Preis zuerst; sonst Sonnet/Opus wie ihre Vorgänger, Haiku und Unbekanntes als billigste alte Stufe. */
function preisFuer(model: string): Preis {
  const m = (model || '').toLowerCase();
  if (m.includes('opus-5-5')) return { ein: 4, aus: 20 };
  if (m.includes('opus')) return { ein: 5, aus: 25 };
  if (m.includes('sonnet-5')) return { ein: 2, aus: 10 };
  if (m.includes('sonnet')) return { ein: 3, aus: 15 };
  // Haiku 5.5 bis 100.000 Token Eingabe; darüber teurer — so lange Eingaben schicken wir nicht
  if (m.includes('haiku-5')) return { ein: 0.1, aus: 0.5 };
  return { ein: 1, aus: 5 };
}

const USD_ZU_EUR = 0.92;

export interface Verbrauch {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function kostenEur(model: string, usage: Verbrauch): number {
  const { ein, aus } = preisFuer(model);
  const usd = ((usage.input_tokens || 0) * ein + (usage.output_tokens || 0) * aus
    + (usage.cache_creation_input_tokens || 0) * ein * 1.25 + (usage.cache_read_input_tokens || 0) * ein * 0.1) / 1_000_000;
  return +(usd * USD_ZU_EUR).toFixed(4);
}

/** Eine Buchungszeile für das Audit (type 'kicall'), wie in der alten App. */
export function kostenBuchung(model: string, usage: Verbrauch, source: string, metadata: Record<string, unknown> = {}) {
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return {
    type: 'kicall', ai_model: model, source,
    input_tokens: (usage.input_tokens || 0) + cacheWrite + cacheRead,
    output_tokens: usage.output_tokens || 0,
    cost_eur: kostenEur(model, usage),
    metadata: { ...metadata, cache_write: cacheWrite, cache_read: cacheRead },
  };
}

