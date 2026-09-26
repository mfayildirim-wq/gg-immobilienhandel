/**
 * Der Graph des Agenten (LangGraph): ein Meister-Knoten (Sprachmodell mit Werkzeugen) und ein Werkzeug-Knoten.
 *
 * Werkzeuge: die lesenden Operationen der Host-App (aus dem Katalog), `steuere` (Oberfläche bedienen — sichtbar),
 * `chips` (Antwortmöglichkeiten), `merke`/`erinnere` (Gedächtnis). Vor jedem `sende` steht eine Unterbrechung:
 * der Nutzer bestätigt, dann läuft der Graph aus dem Checkpoint weiter. Das Modell entwirft, geprüfter Code führt aus —
 * ein Werkzeug, das es im Katalog nicht gibt, existiert für das Modell nicht.
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { Annotation, Command, END, interrupt, MessagesAnnotation, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { adresse, type KatalogWerkzeug } from './katalog.ts';
import type { Gedaechtnis } from './gedaechtnis.ts';
import type { Modell } from './modell.ts';
import { Chip, DNA, Steuerung } from './vertrag.ts';

/** Ein Ziel der Oberfläche, wie der Host es beschreibt (aus den `data-agent`-Marken). */
export const ZielBeschreibung = z.object({ ziel: z.string(), beschreibung: z.string(), seite: z.string().optional() });
export type ZielBeschreibung = z.infer<typeof ZielBeschreibung>;

/** Ruft eine Operation der Host-App auf — in gg-immo in-process über `app.request` mit dem Token des Nutzers. */
export type Aufruf = (methode: string, pfad: string, body?: unknown) => Promise<{ status: number; text: string }>;

export const AgentZustand = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** Steuerungen dieses Zugs; `null` setzt zurück (zu Beginn eines Zugs) */
  steuerung: Annotation<Steuerung[], Steuerung[] | null>({ reducer: (a, b) => (b === null ? [] : a.concat(b)), default: () => [] }),
  chips: Annotation<Chip[], Chip[] | null>({ reducer: (_a, b) => (b === null ? [] : b), default: () => [] }),
  ort: Annotation<string>({ reducer: (_a, b) => b, default: () => '/' }),
  kontext: Annotation<Record<string, unknown>>({ reducer: (_a, b) => b, default: () => ({}) }),
});
export type AgentZustand = typeof AgentZustand.State;

export interface GraphOptionen {
  modell: Modell;
  dna: DNA;
  werkzeuge: KatalogWerkzeug[];
  ziele: ZielBeschreibung[];
  aufruf: Aufruf;
  gedaechtnis: Gedaechtnis;
  /** Wie viele Zeichen einer Werkzeug-Antwort das Modell sieht */
  antwortGrenze?: number;
}

const ANTWORT_GRENZE = 8000;

function systemtext(dna: DNA, ziele: ZielBeschreibung[], erinnerungen: string[], zustand: AgentZustand): string {
  const zielListe = ziele.map((z) => `- ${z.ziel}: ${z.beschreibung}${z.seite ? ` (Seite ${z.seite})` : ''}`).join('\n');
  return [
    `Du bist „${dna.name}“, ein Agent in einer Anwendung. Rolle: ${dna.rolle}`,
    'Du sprichst Deutsch, kurz und klar, wie ein guter Assistent am Telefon. Du erfindest keine Daten: was du nicht über ein Werkzeug gelesen hast, weißt du nicht.',
    'Die Anwendung bedienst du NUR über das Werkzeug `steuere` mit Zielen aus dieser Liste — andere Ziele gibt es nicht:',
    zielListe,
    'Reihenfolge einer Bedienung: navigiere (Seite) → oeffne (Eintrag/Reiter) → fuelle (Feld) → sende (Knopf). Vor jedem `sende` wird der Nutzer gefragt; das übernimmt die Anwendung.',
    'Lesen (Listen, Details) machst du direkt über die GET-Werkzeuge. Antworte danach mit dem, was für den Nutzer wichtig ist, nicht mit Rohdaten.',
    'Biete am Ende deiner Antwort mit `chips` passende nächste Schritte an (2–6 kurze Möglichkeiten).',
    'Merke dir mit `merke` Fakten, die der Nutzer dir sagt (art „fakt“) und Formulierungen, die er in Felder schreibt (art „formulierung“, schluessel = Ziel des Feldes).',
    ...(dna.regeln.length ? ['Regeln:', ...dna.regeln.map((r) => `- ${r}`)] : []),
    ...(dna.beispiele.length ? ['Beispiele:', ...dna.beispiele.map((b) => `Nutzer: ${b.nutzer}\nDu: ${b.agent}`)] : []),
    ...(erinnerungen.length ? ['Aus deinem Gedächtnis:', ...erinnerungen.map((e) => `- ${e}`)] : []),
    `Der Nutzer ist gerade auf Seite ${zustand.ort}${Object.keys(zustand.kontext).length ? ` mit Kontext ${JSON.stringify(zustand.kontext)}` : ''}.`,
  ].join('\n');
}

/**
 * Kürzt eine Werkzeug-Antwort für das Modell. JSON bleibt gültig: Listen werden von hinten beschnitten (oben und eine
 * Ebene tiefer), mit Hinweis `_gekuerzt` — ein abgeschnittener Text wäre für das Modell wertlos.
 */
export function kuerzen(text: string, grenze: number): string {
  if (text.length <= grenze) return text;
  try {
    let daten = JSON.parse(text) as unknown;
    const gesamt = text.length;
    for (let runde = 0; runde < 12; runde += 1) {
      daten = listenBeschneiden(daten, 0.6);
      const kurz = JSON.stringify(daten);
      if (kurz.length <= grenze) return kurz;
    }
  } catch {
    // kein JSON
  }
  return `${text.slice(0, grenze)}\n… (gekürzt, ${text.length} Zeichen insgesamt — enger abfragen)`;
}

function listenBeschneiden(wert: unknown, anteil: number): unknown {
  if (Array.isArray(wert)) {
    const n = Math.max(1, Math.floor(wert.length * anteil));
    return n < wert.length ? [...wert.slice(0, n), { _gekuerzt: `${wert.length - n} weitere Einträge weggelassen` }] : wert;
  }
  if (wert && typeof wert === 'object') {
    return Object.fromEntries(Object.entries(wert as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? listenBeschneiden(v, anteil) : v]));
  }
  return wert;
}

/** Baut die Werkzeuge: lesende Operationen des Hosts, Steuerung, Chips, Gedächtnis. */
export function werkzeugeBauen(opt: GraphOptionen): StructuredToolInterface[] {
  const erlaubt = new Set(opt.dna.werkzeuge);
  const alle = erlaubt.has('*');
  const lesend = opt.werkzeuge.filter((w) => w.lesend && (alle || erlaubt.has(w.name)));
  const grenze = opt.antwortGrenze ?? ANTWORT_GRENZE;
  const zielNamen = new Set(opt.ziele.map((z) => z.ziel));

  const hostWerkzeuge = lesend.map((w) =>
    tool(async (args) => {
      const antwort = await opt.aufruf(w.methode, adresse(w, args as Record<string, string | undefined>));
      return antwort.status >= 400 ? `Fehler ${antwort.status}: ${kuerzen(antwort.text, 500)}` : kuerzen(antwort.text, grenze);
    }, { name: w.name, description: w.beschreibung, schema: w.parameter }),
  );

  const steuere = tool(async ({ aktionen }, config) => {
    const unbekannt = aktionen.filter((a) => a.ziel && !zielNamen.has(a.ziel)).map((a) => a.ziel);
    if (unbekannt.length) return `Unbekannte Ziele: ${unbekannt.join(', ')}. Erlaubt sind nur die Ziele aus der Liste.`;
    const erstesSenden = aktionen.findIndex((a) => a.art === 'sende');
    const toolCallId = (config as { toolCall?: { id?: string } }).toolCall?.id ?? '';
    if (erstesSenden < 0) {
      return new Command({ update: { steuerung: aktionen, messages: [new ToolMessage({ content: `Ausgeführt: ${aktionen.map((a) => a.art).join(', ')}`, tool_call_id: toolCallId })] } });
    }
    const vorher = aktionen.slice(0, erstesSenden);
    const senden = aktionen[erstesSenden]!;
    const danach = aktionen.slice(erstesSenden + 1);
    // Die Unterbrechung: die Schritte davor führt die Oberfläche schon aus, das Senden wartet auf den Nutzer.
    const antwort = interrupt({ frage: senden.text ?? `${senden.ziel} ausführen?`, aktion: senden, vorher }) as string;
    if (antwort.trim().toLowerCase() === 'ja') {
      return new Command({ update: { steuerung: [senden, ...danach], messages: [new ToolMessage({ content: 'Der Nutzer hat bestätigt, gesendet.', tool_call_id: toolCallId })] } });
    }
    return new Command({ update: { messages: [new ToolMessage({ content: `Der Nutzer hat nicht bestätigt: „${antwort}“. Nicht gesendet.`, tool_call_id: toolCallId })] } });
  }, {
    name: 'steuere',
    description: 'Bedient die Oberfläche sichtbar für den Nutzer: eine Folge von Aktionen mit Zielen aus der Liste. `text` ist das Etikett, das der Nutzer beim Schritt sieht.',
    schema: z.object({ aktionen: z.array(Steuerung).min(1) }),
  });

  const chips = tool(async ({ liste }, config) => {
    const toolCallId = (config as { toolCall?: { id?: string } }).toolCall?.id ?? '';
    return new Command({ update: { chips: liste, messages: [new ToolMessage({ content: 'Chips gesetzt.', tool_call_id: toolCallId })] } });
  }, { name: 'chips', description: 'Setzt die Antwortmöglichkeiten unter dem Gespräch (2–6 kurze Labels).', schema: z.object({ liste: z.array(Chip).min(1).max(6) }) });

  const merke = tool(async ({ art, schluessel, inhalt }) => {
    const e = await opt.gedaechtnis.merke(art, schluessel, inhalt);
    return `Gemerkt (${e.art} ${e.schluessel}, ${e.haeufigkeit}×).`;
  }, { name: 'merke', description: 'Merkt sich einen Fakt, eine Formulierung oder eine Routine des Nutzers.', schema: z.object({ art: z.enum(['fakt', 'formulierung', 'routine']), schluessel: z.string(), inhalt: z.string() }) });

  const erinnere = tool(async ({ art, schluessel }) => {
    const e = await opt.gedaechtnis.erinnere(art, schluessel, 8);
    return e.length ? e.map((x) => `- ${x.schluessel}: ${x.inhalt} (${x.haeufigkeit}×)`).join('\n') : 'Nichts gemerkt.';
  }, { name: 'erinnere', description: 'Liest Gemerktes: Fakten, Formulierungen (je Feld-Ziel) oder Routinen.', schema: z.object({ art: z.enum(['fakt', 'formulierung', 'routine', 'episode']), schluessel: z.string().optional() }) });

  return [...hostWerkzeuge, steuere, chips, merke, erinnere];
}

export function graphBauen(opt: GraphOptionen, checkpointer: BaseCheckpointSaver) {
  const werkzeuge = werkzeugeBauen(opt);
  const modell = opt.modell.bindTools ? opt.modell.bindTools(werkzeuge) : opt.modell;

  const meister = async (zustand: AgentZustand): Promise<Partial<AgentZustand>> => {
    const [fakten, routinen] = await Promise.all([opt.gedaechtnis.erinnere('fakt', undefined, 10), opt.gedaechtnis.erinnere('routine', undefined, 5)]);
    const erinnerungen = [...fakten, ...routinen].map((e) => `${e.art} ${e.schluessel}: ${e.inhalt}`);
    const system = new SystemMessage(systemtext(opt.dna, opt.ziele, erinnerungen, zustand));
    const antwort = (await modell.invoke([system, ...zustand.messages])) as AIMessage;
    return { messages: [antwort] };
  };

  const weiter = (zustand: AgentZustand) => {
    const letzte = zustand.messages.at(-1);
    return letzte instanceof AIMessage && letzte.tool_calls?.length ? 'werkzeuge' : END;
  };

  return new StateGraph(AgentZustand)
    .addNode('meister', meister)
    .addNode('werkzeuge', new ToolNode(werkzeuge))
    .addEdge(START, 'meister')
    .addConditionalEdges('meister', weiter, { werkzeuge: 'werkzeuge', [END]: END })
    .addEdge('werkzeuge', 'meister')
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof graphBauen>;

/** Text der letzten Agenten-Antwort — Werkzeugaufrufe ohne Text zählen nicht. */
export function letzterText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m instanceof HumanMessage) break;
    if (m instanceof AIMessage && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
    if (m instanceof AIMessage && Array.isArray(m.content)) {
      const text = m.content.map((t) => (t.type === 'text' ? t.text : '')).join('').trim();
      if (text) return text;
    }
  }
  return '';
}
