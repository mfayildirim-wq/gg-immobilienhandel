/**
 * Der Vertrag des CoSAi-Kerns — sprachneutral, hier als zod, als JSON-Schema exportierbar (`vertragAlsJsonSchema`).
 *
 * Alles, was zwischen Oberfläche, Kern und Host läuft, hat hier seine Form: die DNA eines Agenten, die
 * Ereignisse des Kanals in beide Richtungen, Chips, Gedächtnis-Einträge und die Antwort des Agenten.
 * Eine zweite Ausgabe des Kerns (Python) erfüllt denselben Vertrag — die Testdaten in `test/vertrag` gelten für beide.
 */
import { z } from 'zod';

/** Ein Ziel in der Oberfläche: `bereich.objekt.aktion`, z. B. `deal.kommentar.senden`. Steht als `data-agent` am Element. */
export const Ziel = z.string().regex(/^[a-z0-9]+(\.[a-z0-9_-]+)+$/, 'Ziel hat die Form bereich.objekt.aktion');
export type Ziel = z.infer<typeof Ziel>;

/** Was die Oberfläche dem Agenten meldet. */
export const Beobachtung = z.object({
  art: z.enum(['navigation', 'klick', 'eingabe', 'gespeichert']),
  ziel: Ziel,
  wert: z.string().optional(),
  /** Fachbezug als Werte, nie als Fremdschlüssel: { dealId, maklerId, objektId, … } */
  kontext: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  zeit: z.string().datetime().optional(),
});
export type Beobachtung = z.infer<typeof Beobachtung>;

/** Was der Agent die Oberfläche tun lässt — sichtbar, Schritt für Schritt. */
export const Steuerung = z.object({
  /** `werkzeug`: Rückfrage vor einem MCP-Werkzeug — läuft im Kern, nicht in der Oberfläche */
  art: z.enum(['navigiere', 'oeffne', 'fuelle', 'sende', 'markiere', 'zeige', 'sprich', 'werkzeug']),
  ziel: Ziel.optional(),
  wert: z.string().optional(),
  /** Was das Etikett im Schaufenster sagt („öffnet Reiter Kommunikation“) */
  text: z.string().optional(),
  /** Nur der Kern setzt das — nach dem „Ja“ des Nutzers; die Oberfläche führt schreibende Ziele nur damit aus */
  bestaetigt: z.boolean().optional(),
});
export type Steuerung = z.infer<typeof Steuerung>;

/** Eine Antwortmöglichkeit unter dem Gespräch. */
export const Chip = z.object({
  label: z.string().min(1),
  /** Was gesendet wird, wenn der Chip gewählt wird (Text an den Agenten oder Entscheidung) */
  wert: z.string().min(1),
  art: z.enum(['entscheidung', 'vorschlag']).default('vorschlag'),
});
export type Chip = z.infer<typeof Chip>;

/** Ein Werkzeug im Katalog — aus einer OpenAPI-Operation oder vom Kern selbst. */
export const Werkzeug = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  beschreibung: z.string(),
  methode: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  pfad: z.string().optional(),
  lesend: z.boolean(),
});
export type Werkzeug = z.infer<typeof Werkzeug>;

/** Die DNA eines Agenten: was er ist, darf und wie er sich benimmt. Daten, kein Code. */
export const DNA = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  rolle: z.string().min(1),
  /** Namen erlaubter Werkzeuge aus dem Katalog; `*` = alle lesenden */
  werkzeuge: z.array(z.string()).default(['*']),
  /** „Immer“ (Dos) — in den Einstellungen ergänzbar */
  regeln: z.array(z.string()).default([]),
  /** „Nie“ (Don'ts) — in den Einstellungen ergänzbar */
  nie: z.array(z.string()).default([]),
  /** Modellanbieter und Modell; leer = Vorgabe des Hosts */
  anbieter: z.string().default(''),
  modell: z.string().default(''),
  /** MCP-Server (Internet-Adresse); `kopf` nur verschlüsselt (Host-Funktion `geheimnis`) */
  mcp: z.array(z.object({ name: z.string(), url: z.string(), kopf: z.string().default(''), aktiv: z.boolean().default(true) })).default([]),
  /** MCP-Werkzeuge, die ohne Rückfrage laufen dürfen (in den Einstellungen freigegeben) */
  frei: z.array(z.string()).default([]),
  beispiele: z.array(z.object({ nutzer: z.string(), agent: z.string() })).default([]),
  version: z.number().int().min(1).default(1),
  /** Hash von OpenAPI + Oberflächenkarte, gegen den die DNA entworfen wurde */
  fingerabdruck: z.string().optional(),
});
export type DNA = z.infer<typeof DNA>;

const Regel = z.string().trim().min(1).max(300);
/** Was die Einstellungsseite ändern darf — die Grundregeln gehören nicht dazu */
export const AgentEinstellungen = z.object({
  regeln: z.array(Regel).max(30),
  nie: z.array(Regel).max(30),
  anbieter: z.string().max(40).default(''),
  modell: z.string().max(100).default(''),
});
export type AgentEinstellungen = z.infer<typeof AgentEinstellungen>;

export const McpServerNeu = z.object({
  name: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u, 'Nur Buchstaben, Ziffern, Leerzeichen, - und _'),
  url: z.string().trim().url().max(500),
  kopf: z.string().trim().max(2000).default(''),
});
export type McpServerNeu = z.infer<typeof McpServerNeu>;

export const GedaechtnisArt = z.enum(['episode', 'formulierung', 'fakt', 'routine']);
export const GedaechtnisEintrag = z.object({
  id: z.string().optional(),
  art: GedaechtnisArt,
  /** Kontext-Schlüssel, z. B. `deal.kommentar` für Formulierungen im Kommentarfeld */
  schluessel: z.string().min(1),
  inhalt: z.string().min(1),
  kontext: z.record(z.string(), z.unknown()).default({}),
  haeufigkeit: z.number().int().min(1).default(1),
  zuletzt: z.string().datetime().optional(),
});
export type GedaechtnisEintrag = z.infer<typeof GedaechtnisEintrag>;

/** Was der Nutzer dem Agenten schickt. */
export const Eingabe = z.object({
  sitzungId: z.string().optional(),
  text: z.string().min(1),
  /** Wo der Nutzer gerade ist (Pfad der Oberfläche) */
  ort: z.string().default('/'),
  kontext: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type Eingabe = z.infer<typeof Eingabe>;

/** Die Antwort des Agenten auf eine Eingabe oder Entscheidung. */
export const AgentAntwort = z.object({
  sitzungId: z.string(),
  text: z.string(),
  steuerung: z.array(Steuerung).default([]),
  chips: z.array(Chip).default([]),
  /** Der Agent wartet auf eine Bestätigung, bevor er das Ziel sendet */
  wartetAuf: z.object({ frage: z.string(), aktion: Steuerung }).optional(),
});
export type AgentAntwort = z.infer<typeof AgentAntwort>;

export const Entscheidung = z.object({
  sitzungId: z.string().min(1),
  /** `ja` führt die wartende Aktion aus, alles andere bricht sie ab und geht als Text an den Agenten */
  wert: z.string().min(1),
});
export type Entscheidung = z.infer<typeof Entscheidung>;

/** Der Vertrag als JSON-Schema — für die Python-Ausgabe und andere Sprachen. */
export function vertragAlsJsonSchema() {
  const teile = { Beobachtung, Steuerung, Chip, Werkzeug, DNA, GedaechtnisEintrag, Eingabe, AgentAntwort, Entscheidung };
  return Object.fromEntries(Object.entries(teile).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
}
