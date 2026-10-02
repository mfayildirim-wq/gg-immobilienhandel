// Bank-Präsentation: die beiden KI-Texte (Lage und Objekt). Prompts und Werkzeuge wörtlich aus gg-immohandel
// src/modules/finanzpraes/finanzpraes-ki.ts. Geändert: der Aufruf läuft über die API statt aus dem Browser, und
// was in den Aufruf geht (Adresse, Fakten, Bestand), sammelt @gg/domain (lageKiEingabe, objektKiEingabe).
import type { LageKiEingabe, ObjektKiEingabe } from '@gg/domain';
import type { KiClient } from './anthropic.ts';
import { HAIKU, type KiAntwort } from './persona.ts';

export const LAGE_TOOL = {
  name: 'lagebeschreibung_speichern',
  description: 'Speichert die generierten Bullet-Listen für Standort und Anbindung.',
  input_schema: {
    type: 'object',
    properties: {
      standortBullets: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 kurze Bullets über die Lage und das Umfeld — die bereits erfassten Punkte zuerst',
      },
      anbindungBullets: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 kurze Bullets über ÖPNV und Auto-Anbindung — die bereits erfassten Punkte zuerst',
      },
    },
    required: ['standortBullets', 'anbindungBullets'],
  },
};

export const OBJEKT_TOOL = {
  name: 'objektbeschreibung_speichern',
  description: 'Speichert den generierten Objekt-Beschreibungstext.',
  input_schema: {
    type: 'object',
    properties: {
      beschreibung: {
        type: 'string',
        description: '4-7-sätziger Beschreibungstext im IVT-Stil. Faktisch, sachlich, ohne Werbesprache.',
      },
    },
    required: ['beschreibung'],
  },
};

export function lagePrompt({ fullAdresse, stadt, plz, istStuttgart, bestandStandort, bestandAnbindung }: LageKiEingabe): { system: string; user: string } {
  const hatBestand = bestandStandort.length > 0 || bestandAnbindung.length > 0;
  const stuttgartHinweis = istStuttgart
    ? `- DIESE ADRESSE IST IN STUTTGART. Nutze echte Stuttgarter Geographie: Stadtteile, S-Bahn-Linien (S1-S6, U-Stadtbahn), Autobahnen (A8, A81, B10, B27).`
    : `- DIESE ADRESSE IST NICHT IN STUTTGART (sondern in ${stadt || 'einer anderen Stadt'}). Erfinde KEINE Stuttgarter S-Bahn-Linien, Autobahnen oder Stadtteile.
- Wenn du echtes Wissen über die genannte Stadt/PLZ hast, nutze es (lokale Stadtteile, korrekte ÖPNV-Linien, Autobahnen der Region).
- Wenn du dir nicht sicher bist, bleibe allgemein aber plausibel: "Gute ÖPNV-Anbindung", "Schnelle Autobahnanbindung" — KEINE erfundenen Linien-Nummern oder Straßennamen.`;

  const system = `Du bist ein erfahrener Immobilien-Vertriebsmitarbeiter.
Du erstellst Lagebeschreibungen für Bank-Finanzierungspräsentationen im Stil etablierter Immobilien-Investoren.

STILVORGABEN basierend auf realen IVT-Pitches:
- Kurze, präzise Bullet-Punkte (3-5 Stichpunkte pro Sektion, je 4-10 Wörter)
- Keine Werbesprache, keine Übertreibungen, keine Adjektiv-Häufungen
- Faktisch, sachlich, banker-tauglich
- Konkrete Distanzen (z.B. "S-Bahn in 4 Minuten Fußweg") nur wenn realistisch und verifizierbar

GEOGRAPHISCHE GENAUIGKEIT (KRITISCH):
${stuttgartHinweis}
- Bei unbekannten Mikro-Lagen: bleibe allgemein aber plausibel (z.B. "Gute ÖPNV-Anbindung" statt erfundene Linien)
- ERFINDE NIEMALS Linien-Nummern, Straßennamen oder Stadtteile, die du nicht kennst.

VORHANDENE EINGABEN DES NUTZERS:
- Was der Nutzer bereits erfasst hat, ist RECHERCHIERT und hat Vorrang vor deiner Vermutung.
- Übernimm jeden dieser Punkte inhaltlich; du darfst ihn sprachlich glätten, aber nichts davon weglassen und nichts daran umdeuten.
- Ergänze nur, was fehlt, bis die Sektion 3-5 Punkte hat.`;

  const bestandsBlock = hatBestand
    ? `BEREITS ERFASST (übernehmen, nicht verwerfen):
Standort:
${bestandStandort.map((z) => '- ' + z).join('\n') || '(noch nichts)'}
Anbindung:
${bestandAnbindung.map((z) => '- ' + z).join('\n') || '(noch nichts)'}

`
    : '';

  const user = `Generiere eine Lagebeschreibung für folgendes Objekt:

ADRESSE: ${fullAdresse}
STADT: ${stadt || '(unbekannt)'}
PLZ: ${plz || '(unbekannt)'}

${bestandsBlock}Liefere zwei Sektionen:
1. **Standort** — 3-5 Bullets über den Stadtteil, die Wohnumgebung, Infrastruktur (Schulen, Einkauf, Erholung) — passend zu ${stadt || 'der genannten Adresse'}
2. **Anbindung** — 3-5 Bullets über ÖPNV (S-Bahn, U-Bahn, Bus) und Auto (Autobahn, Hauptstraßen) — passend zu ${stadt || 'der genannten Region'}

${hatBestand ? 'Die oben bereits erfassten Punkte müssen in deiner Antwort wieder auftauchen — zuerst und inhaltlich unverändert.\n\n' : ''}Gib das Ergebnis als JSON via dem bereitgestellten Tool zurück.`;
  return { system, user };
}

export function objektPrompt({ fakten, aktuelleBeschreibung }: ObjektKiEingabe): { system: string; user: string } {
  const system = `Du bist ein erfahrener Immobilien-Investment-Manager bei der IVT AG in Stuttgart.
Du verfasst Objektbeschreibungen für Bank-Finanzierungspräsentationen — IVT braucht eine Bank-Finanzierung für den ANKAUF dieser Immobilie.

WICHTIGSTE REGEL — POSITIVE BANKER-VERMARKTUNGSSPRACHE:
Du SCHREIBST FÜR DIE BANK, um sie vom Wert des Objekts zu überzeugen. Das Objekt ist eine WERTHALTIGE INVESTITION.
- Niemals Mängel oder Probleme schreiben
- Niemals selbstabwertend formulieren ("schlecht geschnitten", "veraltete Heizung", "schlechter Zustand")
- Stattdessen: SUBSTANZ und WERTSTABILITÄT betonen, Modernisierungen positiv darstellen, Mieterstruktur und Cashflow positiv hervorheben

POSITIVE FORMULIERUNGEN — Beispiele aus echten IVT-Pitches:
- "gut geschnittene 2-4 Zimmer Wohnungen" (statt "ältere Wohnungen")
- "Alle Gebäude befinden sich in sehr gutem Zustand"
- "umfangreich kernsaniert", "umfassend modernisiert"
- "Solide Bausubstanz aus den 1960er Jahren mit nachhaltig durchgeführten Modernisierungen"
- "Wertstabile Lage mit etablierter Mieterstruktur"
- "Verlässlicher Bestandsmieter-Cashflow"
- Leerstände UMRAHMEN als Chance: "Leerstände bieten Mietanpassungspotenzial" (NICHT "Wohnungen stehen leer")
- Energiekennwert "E" oder schlechter? Nicht erwähnen oder rahmen als "energetisches Optimierungspotenzial nach Sanierung"

STIL — exakt wie echte IVT-Pitches:
- Länge: 4-7 Sätze, ca. 80-150 Wörter
- Aufbau:
  1. Einstieg: "Bei dem Objekt handelt es sich um ein [Baujahr] gebautes [Typ] mit [Einheiten]..."
  2. Beschreibung der Einheiten: Geschnittenheit, Stellplätze, Balkone (POSITIV)
  3. Modernisierungen: chronologisch mit konkreten Bauteilen
  4. Bausubstanz / Lage / Mieterstruktur — positiv abschließen
- Faktisch, banker-tauglich, aber selbstbewusst-überzeugend
- KEINE Werbesprache à la "traumhaft", "einmalig" — das wäre unprofessionell
- KEINE Übertreibungen — sondern souveräne, sachliche Wertbetonung

ANTI-HALLUZINATION:
- Erfinde KEINE konkreten Modernisierungs-Details, Jahreszahlen oder Bauteile, die NICHT in den Fakten stehen
- Wenn nur Baujahr/Einheiten/Fläche bekannt: kürzerer Text — nur was sicher ist
- Generische positive Aussagen wie "solide Bausubstanz", "etablierte Lage", "wertstabile Mieterstruktur" sind OK auch ohne Fakten

REFERENZBEISPIELE (echte IVT-Pitches — bemerke den selbstbewussten, positiv-substanzbetonten Ton):

Beispiel 1 (Aldinger Straße 86):
"Bei dem Objekt handelt es sich um ein 1964 gebautes 6-Familienhaus mit einer Gewerbeeinheit (Lager) im Souterrain und einem angebauten Lager im Hof, welches nicht erworben wird. Die gut geschnittenen 2-4 Zimmer Wohnungen haben jeweils einen Stellplatz und 5 Wohnungen einen Balkon. Seit 2000 wurden alle Wohnungen bereits renoviert: doppelverglaste Isolierglasfenster im Jahr 2001, gedämmte oberste Geschossdecke, 3-adrige Elektrik, alle Bäder und Oberflächen in den Wohnungen, Elektrosteigleitungen, Gas-Etagenheizungen. Zwei Wohnungen stehen derzeit leer und bieten Mietanpassungspotenzial."

Beispiel 2 (Bergstraße Leonberg):
"Bei den Objekten handelt es sich um Mehrfamilienhäuser aus den Baujahren 2018, 1972 und 1960, sowie ein Garagengebäude. Alle Gebäude befinden sich in sehr gutem Zustand. Die Gebäude aus 1972 und 1960 wurden bereits umfassend modernisiert: Dach inkl. Dämmung, 3-adrige Elektrik in Gebäude und in Wohnungen, doppelverglaste Isolierglasfenster, Bäder inkl. Wasser- & Abwasserleitungen neu, Hauseingangstüren neu."

Beispiel 3 (Gablenberger Hauptstraße):
"Bei dem Objekt handelt es sich um ein Mehrfamilienhaus mit 8 Wohnungen und zwei kleinen Gewerbeeinheiten (Kiosk und Bar). Das Gebäude wurde in den 1990ern umfangreich kernsaniert. Hierbei wurde eine Gas-Zentralheizung inkl. Heizleitungen und Heizkörpern eingebaut, die Wohnungs- und Gebäudeelektrik vollständig 3-adrig erneuert und Bäder inkl. Wasser- und Abwasserleitungen erneuert, die Hauseingangstür erneuert, das Dach neu gedeckt und 2015 neu gedämmt. Die Fassade wurde überarbeitet. Fenster sind doppelverglaste Holz-Isolierglasfenster."`;

  const user = `Generiere die Objektbeschreibung für folgendes Objekt — ZWECK: Bank vom Wert überzeugen, damit sie unseren Ankauf finanziert.

VORHANDENE FAKTEN:
${fakten.map(f => '- ' + f).join('\n')}

${aktuelleBeschreibung ? `BISHERIGE BESCHREIBUNG (übernimm faktische Details, aber UMFORMULIERE in positive Banker-Sprache wenn nötig):\n"${aktuelleBeschreibung}"\n` : ''}
Schreibe einen 4-7-sätzigen Beschreibungstext im IVT-Stil (siehe Referenzbeispiele im System-Prompt).

ABSOLUT KRITISCH:
- POSITIVE Vermarktungssprache — niemals selbst-abwertend
- Erfinde KEINE konkreten Modernisierungs-Details die nicht in den Fakten stehen
- Wenn nur Baujahr/Einheiten/Fläche bekannt: kürzerer Text, dafür Substanz/Lage/Mieterstruktur generisch positiv hervorheben

Gib das Ergebnis als JSON via dem bereitgestellten Tool zurück.`;
  return { system, user };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const werkzeugAntwort = (data: any, name: string) => (data?.content || []).find((c: any) => c.type === 'tool_use' && c.name === name)?.input;

/** Standort- und Anbindungs-Punkte zur Adresse. Die Antwort kommt roh zurück; ob sie taugt, prüft lageKiUebernehmen. */
export async function lagebeschreibungGenerieren(ki: KiClient, eingabe: LageKiEingabe): Promise<KiAntwort<{ standortBullets?: unknown; anbindungBullets?: unknown } | undefined>> {
  const { system, user } = lagePrompt(eingabe);
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 600, system, messages: [{ role: 'user', content: user }],
    tools: [LAGE_TOOL], tool_choice: { type: 'tool', name: LAGE_TOOL.name },
  });
  return { wert: werkzeugAntwort(data, LAGE_TOOL.name), model: HAIKU, usage: data?.usage ?? {} };
}

/** Beschreibungstext aus den bekannten Fakten. Die Antwort kommt roh zurück; ob sie taugt, prüft objektKiUebernehmen. */
export async function objektbeschreibungGenerieren(ki: KiClient, eingabe: ObjektKiEingabe): Promise<KiAntwort<{ beschreibung?: unknown } | undefined>> {
  const { system, user } = objektPrompt(eingabe);
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 700, system, messages: [{ role: 'user', content: user }],
    tools: [OBJEKT_TOOL], tool_choice: { type: 'tool', name: OBJEKT_TOOL.name },
  });
  return { wert: werkzeugAntwort(data, OBJEKT_TOOL.name), model: HAIKU, usage: data?.usage ?? {} };
}
