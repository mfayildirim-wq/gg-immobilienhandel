/**
 * Die Fassade des Kerns — das, was eine Host-App einbaut: `agentKern({ db, modell, openapi, ziele, aufruf })`.
 *
 * Je Nutzer und Sitzung: Nachricht → Graph (aus dem Checkpoint) → Antwort mit Steuerung, Chips und ggf. einer
 * wartenden Bestätigung. Beobachtungen der Oberfläche landen im Ereignisprotokoll und — bei `gespeichert` — als
 * Formulierung und Episode im Gedächtnis. Der Kern hält keine Verbindung offen: jeder Aufruf ist für sich vollständig.
 */
import { HumanMessage, type AIMessage, type BaseMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DrizzleSaver } from './checkpointer.ts';
import { gedaechtnis as gedaechtnisBauen, type Db, type Gedaechtnis } from './gedaechtnis.ts';
import { graphBauen, GRUNDREGELN, letzterText, type Aufruf, type WebWerkzeuge, type ZielBeschreibung } from './graph.ts';
export { GRUNDREGELN } from './graph.ts';
import { katalogFingerabdruck, werkzeugeAusOpenapi, type KatalogWerkzeug, type OpenapiDokument } from './katalog.ts';
import { ergebnisseVon } from './ergebnisse.ts';
import { mcpVerbinden, mcpWerkzeugName, type McpWerkzeug } from './mcp.ts';
import { tool } from '@langchain/core/tools';
import type { z } from 'zod';
import { ANBIETER, aufgabeGruendlich, drehbuchModell, openrouterModelle, type Modell, type ModellEintrag } from './modell.ts';
import { routinenAus, type Routine } from './routinen.ts';
import { agenten, ereignisse, laeufe, nachrichten, sitzungen } from './schema.ts';
import { AgentEinstellungen, DNA, McpServerNeu, type AgentAntwort, type Beobachtung, type Chip, type Eingabe, type Entscheidung, type Steuerung } from './vertrag.ts';

/** Wer gerade spricht — und was der Host-Aufruf braucht, um in dessen Namen zu lesen (z. B. Authorization). */
export interface Nutzer {
  id: string;
  kopf?: Record<string, string>;
}

/** Der Host baut das Modell des in den Einstellungen gewählten Anbieters (null = kein Schlüssel, nicht unterstützt) */
export type ModellWahl = (wahl: { anbieter: string; modell: string }) => Promise<Modell | null> | Modell | null;

/** Eine Meldung für den Nutzer (z. B. kein Modell für den gewählten Anbieter) — keine Störung */
export class KernHinweis extends Error {}

export interface KernOptionen {
  db: Db;
  /** Ein festes Modell — oder die Wahl nach den Einstellungen */
  modell: Modell | ModellWahl;
  openapi: OpenapiDokument;
  ziele: ZielBeschreibung[];
  /** Lesender Aufruf einer Host-Operation im Namen des Nutzers */
  aufruf: (nutzer: Nutzer, methode: string, pfad: string, body?: unknown) => Promise<{ status: number; text: string }>;
  /** Die DNA des Meisters; Vorgabe: ein allgemeiner Assistent der Anwendung */
  dna?: Partial<DNA>;
  antwortGrenze?: number;
  /** Auftrag des Morgenvorschlags — nur lesen, nichts ändern */
  morgenAuftrag?: string;
  /** Web-Recherche (Suche, Seite lesen, Claude-Websuche) */
  web?: WebWerkzeuge;
  /** Verschlüsselung der MCP-Kopfzeilen (Zugangsdaten) — ohne sie werden keine Kopfzeilen angenommen */
  geheimnis?: { verpacken: (klar: string) => string; auspacken: (verpackt: string) => string };
  /** MCP-Server auf localhost/internen Adressen erlauben (nur Entwicklung und Tests) */
  mcpLokalErlaubt?: boolean;
  /** Lesende Werkzeuge des Hosts im Namen des Nutzers (z. B. Dokumente der App lesen) — erscheinen als Quelle „app“ */
  zusatzWerkzeuge?: (nutzer: Nutzer) => HostWerkzeug[];
  /** Für die Einstellungsseite: welche Anbieter der Host kennt und ob ein Schlüssel hinterlegt ist */
  anbieterListe?: () => Promise<AnbieterStand[]>;
}

/** Ein lesendes Werkzeug der App — ohne LangChain beim Host; der Kern macht daraus ein Werkzeug für das Modell. */
export interface HostWerkzeug {
  name: string;
  beschreibung: string;
  parameter: z.ZodObject<z.ZodRawShape>;
  ausfuehren: (args: Record<string, unknown>) => Promise<string>;
}

const alsWerkzeug = (w: HostWerkzeug) => tool(async (args) => {
  try { return await w.ausfuehren(args as Record<string, unknown>); } catch (e) { return `Fehler: ${(e as Error).message}`; }
}, { name: w.name, description: w.beschreibung, schema: w.parameter });

/** Zwischenstände eines Laufs für die Oberfläche (Streaming): welcher Schritt läuft, und der Text, wie er entsteht */
export type StromEreignis = { art: 'schritt'; text: string } | { art: 'text'; text: string };
export type Melden = (e: StromEreignis) => void;

/** Der Text in einem Stück der Modellantwort (Anthropic liefert Blöcke, OpenAI einen String) */
export function textAusStueck(inhalt: unknown): string {
  if (typeof inhalt === 'string') return inhalt;
  if (!Array.isArray(inhalt)) return '';
  return inhalt.map((b: { type?: string; text?: string }) => (b && (b.type === 'text' || b.type === 'text_delta') && typeof b.text === 'string' ? b.text : '')).join('');
}

export interface AnbieterStand { id: string; label: string; vorgabeModell: string; verfuegbar: boolean; schnellesModell?: string }

/** Ein Werkzeug für die Einstellungsseite: woher, was es darf */
export interface WerkzeugEintrag {
  name: string;
  beschreibung: string;
  quelle: 'app' | 'web' | 'mcp' | 'agent';
  /** lesen: ohne Rückfrage, liest nur · fragt: nur nach „Ja“ · frei: MCP, freigegeben · intern: Gespräch/Gedächtnis */
  recht: 'lesen' | 'fragt' | 'frei' | 'intern';
  server?: string;
  /** MCP: der Server kennzeichnet es als nur lesend (Hinweis) */
  liestNur?: boolean;
}

/** Werkzeuglisten der MCP-Server kurz zwischenspeichern — jede Nachricht baut den Graphen neu */
const MCP_CACHE_MS = 60_000;
/** DNA (Einstellungen) und gebaute Modelle kurz vorhalten — Speichern der Einstellungen leert den Vorrat sofort */
const DNA_CACHE_MS = 10_000;
const MODELL_CACHE_MS = 60_000;
/** Modelllisten der Anbieter (OpenRouter ändert sie oft, aber nicht minütlich) */
const LISTE_CACHE_MS = 10 * 60_000;
let openrouterVorrat: { zeit: number; liste: ModellEintrag[] } | null = null;
const mcpCache = new Map<string, { zeit: number; werkzeuge: McpWerkzeug[] }>();

/** Längste Notiz, die als Formulierung (Vorschlag) gemerkt wird */
export const FORMULIERUNG_MAX = 500;

/** Der Bereich einer Seite: erster Teil des Pfads (`/deals/abc` → `/deals`). Je Bereich ein Gesprächsfaden. */
export function bereichVon(ort: string): string {
  const pfad = ort.split(/[?#]/)[0] ?? '/';
  const erster = pfad.split('/').filter(Boolean)[0];
  return erster ? `/${erster}` : '/';
}

/** Antwort auf einen Ortswechsel oder das Öffnen — ohne Modellaufruf */
export interface KontextAntwort {
  art: 'tagesbeginn' | 'fortsetzen' | 'neu';
  bereich: string;
  name: string;
  /** Faden, den „Weitermachen“ fortsetzt (null = keiner) */
  sitzungId: string | null;
  text: string;
  chips: { label: string; wert: string; art: 'kontext' | 'vorschlag' }[];
}

export const MORGEN_AUFTRAG = 'Guten Morgen. Was steht heute an? Nenne, wie viele Einträge fällig sind, und schlage vor, womit ich anfange. Nur lesen, nichts ändern.';

/** Die vorgegebenen „Immer“-Regeln — in den Einstellungen änderbar */
export const MEISTER_REGELN = [
  'Wenn der Nutzer etwas erfassen will (Kommentar, Notiz), schreibe genau seinen Wortlaut ins Feld — nicht umformulieren.',
  'Wenn du nicht weißt, welcher Eintrag gemeint ist, lies die Liste und frage kurz nach — mit Chips.',
];

export const MEISTER_DNA: DNA = DNA.parse({
  slug: 'meister',
  name: 'Agent',
  rolle: 'Du hilfst dem Nutzer, die Anwendung zu bedienen: du liest nach, führst durch fällige Aufgaben, füllst Felder aus und schickst ab — immer sichtbar und nur nach Bestätigung.',
  regeln: MEISTER_REGELN,
});

export type Kern = ReturnType<typeof agentKern>;

export function agentKern(opt: KernOptionen) {
  const dna = DNA.parse({ ...MEISTER_DNA, ...opt.dna });
  const werkzeuge: KatalogWerkzeug[] = werkzeugeAusOpenapi(opt.openapi, { nurLesend: true });
  const fingerabdruck = katalogFingerabdruck(werkzeuge, opt.ziele.map((z) => z.ziel));
  const { db } = opt;

  /** Die DNA mit den gespeicherten Einstellungen (cosai.agenten, Version 1 des Slugs) — bei jedem Lauf frisch gelesen */
  let dnaVorrat: { zeit: number; dna: DNA } | null = null;
  async function dnaLaden(): Promise<DNA> {
    if (dnaVorrat && Date.now() - dnaVorrat.zeit < DNA_CACHE_MS) return dnaVorrat.dna;
    const [z] = await db.select({ dna: agenten.dna }).from(agenten).where(and(eq(agenten.slug, dna.slug), eq(agenten.version, 1))).limit(1);
    const d = z ? DNA.parse({ ...dna, ...(z.dna as Partial<DNA>), slug: dna.slug }) : dna;
    dnaVorrat = { zeit: Date.now(), dna: d };
    return d;
  }

  const modellVorrat = new Map<string, { zeit: number; modell: Modell }>();
  async function modellFuer(d: DNA, name = d.modell): Promise<Modell> {
    if (typeof opt.modell !== 'function') return opt.modell;
    const schluessel = `${d.anbieter}|${name}`;
    const vorrat = modellVorrat.get(schluessel);
    if (vorrat && Date.now() - vorrat.zeit < MODELL_CACHE_MS) return vorrat.modell;
    const m = await (opt.modell as ModellWahl)({ anbieter: d.anbieter, modell: name });
    if (!m) throw new KernHinweis(`Für den Anbieter „${d.anbieter || 'Standard'}“ ist kein Modell verfügbar — Schlüssel unter Einstellungen → Zugänge hinterlegen oder in den AgentMode-Einstellungen einen anderen Anbieter wählen.`);
    modellVorrat.set(schluessel, { zeit: Date.now(), modell: m });
    return m;
  }

  /** Das schnelle Modell für diese Aufgabe — oder `undefined` (dann das eingestellte) */
  function schnellesModellFuer(d: DNA, aufgabe: string | undefined): string | undefined {
    if (typeof opt.modell !== 'function' || d.tempo === 'gruendlich') return undefined;
    if (d.tempo === 'auto' && (aufgabe === undefined || aufgabeGruendlich(aufgabe))) return undefined;
    return d.schnellesModell || ANBIETER.find((a) => a.id === (d.anbieter || 'anthropic'))?.schnellesModell || undefined;
  }

  async function dnaSpeichern(neu: DNA): Promise<void> {
    dnaVorrat = null;
    await db.insert(agenten).values({ slug: dna.slug, version: 1, dna: neu, status: 'aktiv' })
      .onConflictDoUpdate({ target: [agenten.slug, agenten.version], set: { dna: neu, updatedAt: new Date().toISOString() } });
  }

  /** Die Werkzeuge der aktiven MCP-Server; ein Server, der nicht antwortet, fehlt eben (und steht im Protokoll). */
  async function mcpWerkzeuge(d: DNA): Promise<McpWerkzeug[]> {
    const listen = await Promise.all(d.mcp.filter((m) => m.aktiv).map(async (m) => {
      const kopf = m.kopf && opt.geheimnis ? opt.geheimnis.auspacken(m.kopf) : undefined;
      const schluessel = `${m.url}|${m.kopf}`;
      const vorrat = mcpCache.get(schluessel);
      if (vorrat && Date.now() - vorrat.zeit < MCP_CACHE_MS) return vorrat.werkzeuge;
      try {
        const w = await mcpVerbinden({ name: m.name, url: m.url }, kopf);
        mcpCache.set(schluessel, { zeit: Date.now(), werkzeuge: w });
        return w;
      } catch (e) {
        console.warn(`[cosai] MCP-Server „${m.name}“ nicht erreichbar:`, (e as Error).message);
        return [];
      }
    }));
    return listen.flat();
  }

  function mcpAdressePruefen(url: string): void {
    const u = new URL(url);
    if (opt.mcpLokalErlaubt) return;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const intern = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')
      || /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(':');
    if (u.protocol !== 'https:' || intern) throw new KernHinweis('MCP-Server bitte über eine öffentliche https-Adresse anbinden.');
  }

  /** `nurZustand`: nur den gespeicherten Zustand lesen — dafür wird kein Modell gebraucht (und keines gebaut). */
  const modellNamen = new WeakMap<object, string>();
  /** `aufgabe`: der Text des Nutzers — entscheidet mit `tempo` über schnelles oder gründliches Modell */
  const graphFuer = async (nutzer: Nutzer, gedaechtnis: Gedaechtnis, nurLesen = false, nurZustand = false, aufgabe?: string) => {
    const aufruf: Aufruf = (methode, pfad, body) => opt.aufruf(nutzer, methode, pfad, body);
    const d = await dnaLaden();
    const modell = nurZustand ? drehbuchModell([]) : await modellFuer(d, schnellesModellFuer(d, aufgabe) ?? d.modell);
    const mcp = nurZustand ? [] : await mcpWerkzeuge(d);
    const graph = graphBauen({ modell, dna: d, werkzeuge, ziele: opt.ziele, aufruf, gedaechtnis, antwortGrenze: opt.antwortGrenze, nurLesen, web: opt.web, mcp, frei: d.frei, ergebnisse: ergebnisseVon(db, nutzer.id), zusatz: opt.zusatzWerkzeuge?.(nutzer).map(alsWerkzeug) }, new DrizzleSaver(db));
    // Beim Streamen fehlt der Modellname in den Metadaten — für die Messung hier merken
    modellNamen.set(graph, (modell as { model?: string }).model ?? modell._llmType());
    return graph;
  };

  async function sitzungSicherstellen(nutzer: Nutzer, sitzungId: string | undefined, ort: string, kontext: Record<string, unknown>): Promise<string> {
    if (sitzungId) {
      // Ein Weg zur DB: nur die eigene Sitzung wird aktualisiert — sonst eine neue
      const [s] = await db.update(sitzungen).set({ ort, kontext, updatedAt: new Date().toISOString() })
        .where(and(eq(sitzungen.id, sitzungId), eq(sitzungen.nutzer, nutzer.id))).returning({ id: sitzungen.id });
      if (s) return s.id;
    }
    const [neu] = await db.insert(sitzungen).values({ nutzer: nutzer.id, agent: dna.slug, ort, kontext }).returning({ id: sitzungen.id });
    return neu!.id;
  }

  async function protokolliere(nutzer: Nutzer, sitzungId: string, richtung: 'beobachtung' | 'steuerung', art: string, ziel?: string, wert?: string, kontext: Record<string, unknown> = {}) {
    await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId, richtung, art, ziel: ziel ?? null, wert: wert ?? null, kontext });
  }

  /** Nachrichten im Zustand vor einem Lauf — der Antworttext kommt nur aus dem, was dieser Lauf hinzugefügt hat. */
  function anzahlNachrichten(stand: { values: unknown }): number {
    return (stand.values as { messages?: unknown[] }).messages?.length ?? 0;
  }

  /** Was die Oberfläche während eines Werkzeugaufrufs zeigt — `null`: nichts zeigen */
  function schrittText(name: string): string | null {
    const w = werkzeuge.find((x) => x.name === name);
    if (w) return `liest ${w.pfad}`;
    if (name.startsWith('mcp_')) return `fragt ${name.split('_')[1] ?? 'MCP'}`;
    const texte: Record<string, string | null> = {
      steuere: 'bereitet die Bedienung vor', seite_lesen: 'liest eine Webseite', ergebnis_speichern: 'bereitet das Speichern vor',
      ergebnisse_lesen: 'liest gespeicherte Ergebnisse', merke: 'merkt sich das', erinnere: 'schaut ins Gedächtnis', chips: null,
    };
    return name in texte ? texte[name]! : `nutzt ${name}`;
  }

  /** Den Graphen laufen lassen — mit `melden` als Strom (Text entsteht sichtbar, Schritte werden angesagt) */
  async function laufen(graph: Awaited<ReturnType<typeof graphFuer>>, eingang: unknown, config: { configurable: { thread_id: string } }, melden?: Melden): Promise<void> {
    type Eingang = Parameters<typeof graph.invoke>[0];
    if (!melden) { await graph.invoke(eingang as Eingang, config); return; }
    const strom = await graph.stream(eingang as Eingang, { ...config, streamMode: ['messages', 'updates'] });
    for await (const [modus, daten] of strom as unknown as AsyncIterable<[string, unknown]>) {
      if (modus === 'messages') {
        const [stueck, meta] = daten as [BaseMessage, { langgraph_node?: string } | undefined];
        if (meta?.langgraph_node !== 'meister') continue;
        const text = textAusStueck(stueck.content);
        if (text) melden({ art: 'text', text });
      } else if (modus === 'updates') {
        const letzte = (daten as { meister?: { messages?: BaseMessage[] } }).meister?.messages?.at(-1) as AIMessage | undefined;
        for (const t of letzte?.tool_calls ?? []) {
          const text = schrittText(t.name);
          if (text) melden({ art: 'schritt', text });
        }
      }
    }
  }

  /** Dauer, Modell, Modellschritte und Tokens des Laufs (aus `usage_metadata` der neuen Antworten des Modells) */
  function messen(neu: import('@langchain/core/messages').BaseMessage[], start: number): NonNullable<AgentAntwort['messung']> {
    const tokens = { eingabe: 0, cacheGelesen: 0, cacheGeschrieben: 0, ausgabe: 0 };
    let schritte = 0;
    let modell = '';
    for (const m of neu) {
      if (m.getType() !== 'ai') continue;
      schritte += 1;
      const u = (m as import('@langchain/core/messages').AIMessage).usage_metadata;
      modell = String((m.response_metadata as { model?: string; model_name?: string } | undefined)?.model ?? (m.response_metadata as { model_name?: string } | undefined)?.model_name ?? modell);
      if (!u) continue;
      tokens.eingabe += u.input_tokens ?? 0;
      tokens.ausgabe += u.output_tokens ?? 0;
      tokens.cacheGelesen += u.input_token_details?.cache_read ?? 0;
      tokens.cacheGeschrieben += u.input_token_details?.cache_creation ?? 0;
    }
    return { ms: Date.now() - start, modell, schritte, tokens };
  }

  /** Liest nach dem Lauf aus dem Zustand, was die Oberfläche bekommt — und ob der Graph auf eine Bestätigung wartet. */
  async function antwortAus(graph: Awaited<ReturnType<typeof graphFuer>>, nutzer: Nutzer, sitzungId: string, vorher: number, start = Date.now()): Promise<AgentAntwort> {
    const config = { configurable: { thread_id: sitzungId } };
    const stand = await graph.getState(config);
    const werte = stand.values as { messages: import('@langchain/core/messages').BaseMessage[]; steuerung: Steuerung[]; chips: Chip[] };
    const unterbrechung = stand.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as { frage: string; aktion: Steuerung; vorher: Steuerung[] } | undefined;
    const steuerung = [...werte.steuerung, ...(unterbrechung?.vorher ?? [])];
    const text = letzterText(werte.messages.slice(vorher)) || (unterbrechung ? unterbrechung.frage : '');
    const chips: Chip[] = unterbrechung
      ? [{ label: 'Ja, ausführen', wert: 'ja', art: 'entscheidung' }, { label: 'Nein', wert: 'nein', art: 'entscheidung' }]
      : werte.chips;
    const messung = messen(werte.messages.slice(vorher), start);
    messung.modell ||= modellNamen.get(graph) ?? '';
    const antwort: AgentAntwort = { sitzungId, text, steuerung, chips, ...(unterbrechung ? { wartetAuf: { frage: unterbrechung.frage, aktion: unterbrechung.aktion } } : {}), messung };
    // Die Schreibvorgänge sind unabhängig — gleichzeitig statt nacheinander
    await Promise.all([
      db.insert(nachrichten).values({ sitzungId, rolle: 'agent', text, steuerung, chips }),
      steuerung.length ? db.insert(ereignisse).values(steuerung.map((s) => ({ nutzer: nutzer.id, sitzungId, richtung: 'steuerung' as const, art: s.art, ziel: s.ziel ?? null, wert: s.wert ?? null, kontext: {} }))) : null,
      db.insert(laeufe).values({ sitzungId, status: unterbrechung ? 'wartet' : 'fertig', wartetAuf: unterbrechung ? { frage: unterbrechung.frage, aktion: unterbrechung.aktion } : null }),
    ]);
    return antwort;
  }

  /** `anzeige`: was im Verlauf als Nachricht des Nutzers steht (sonst der Text selbst) */
  async function nachricht(nutzer: Nutzer, eingabe: Eingabe, nurLesen = false, anzeige?: string, melden?: Melden): Promise<AgentAntwort> {
    const start = Date.now();
    const sitzungId = await sitzungSicherstellen(nutzer, eingabe.sitzungId, eingabe.ort, eingabe.kontext);
    const [graph] = await Promise.all([
      graphFuer(nutzer, gedaechtnisBauen(db, nutzer.id), nurLesen, false, eingabe.text),
      db.insert(nachrichten).values({ sitzungId, rolle: 'nutzer', text: anzeige ?? eingabe.text }),
    ]);
    const config = { configurable: { thread_id: sitzungId } };
    // Wartet der Graph noch auf eine Bestätigung, gilt der neue Text als Antwort darauf (kein „ja“ → abgebrochen)
    const stand = await graph.getState(config);
    const wartet = stand.tasks.some((t) => t.interrupts?.length);
    // `null` setzt Steuerung und Chips des vorigen Zugs zurück (Reducer); die Typen von LangGraph kennen den Reset nicht
    const zuruecksetzen = { steuerung: null, chips: null, ort: eingabe.ort, kontext: eingabe.kontext };
    const eingang = wartet
      ? new Command({ resume: eingabe.text, update: zuruecksetzen })
      : { messages: [new HumanMessage(eingabe.text)], ...zuruecksetzen };
    await laufen(graph, eingang, config, melden);
    return antwortAus(graph, nutzer, sitzungId, anzahlNachrichten(stand), start);
  }

  /** Kurzname eines Schritts aus der Oberflächenkarte: der Text in „…“ der Beschreibung, sonst der Schlüssel. */
  function kurzname(schluessel: string): string {
    const z = opt.ziele.find((x) => x.ziel === schluessel) ?? opt.ziele.find((x) => x.ziel.startsWith(`${schluessel}.`));
    return z?.beschreibung.match(/„([^“]+)“/)?.[1] ?? schluessel;
  }

  /**
   * Rechnet die Routinen aus den Episoden neu und legt sie als Gedächtnis-Einträge ab. Hat der Nutzer eine Routine
   * gelöscht, zählt für sie nur, was danach passiert ist.
   */
  async function routinenNeu(nutzer: Nutzer): Promise<void> {
    const g = gedaechtnisBauen(db, nutzer.id);
    const episoden = (await g.verlauf(300)).map((e) => ({ schluessel: e.schluessel, kontext: e.kontext, zeit: e.zuletzt! }));
    const geloescht = await db.select({ ziel: ereignisse.ziel, createdAt: ereignisse.createdAt }).from(ereignisse)
      .where(and(eq(ereignisse.nutzer, nutzer.id), eq(ereignisse.art, 'routine-geloescht')));
    const seit = new Map<string, number>();
    for (const m of geloescht) if (m.ziel) seit.set(m.ziel, Math.max(seit.get(m.ziel) ?? 0, new Date(m.createdAt).getTime()));
    const gleich = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const r of routinenAus(episoden)) {
      const schluessel = r.folge.join(' → ');
      let gilt: Routine | undefined = r;
      const ab = seit.get(schluessel);
      if (ab) gilt = routinenAus(episoden.filter((e) => Date.parse(e.zeit) > ab)).find((x) => gleich(x.folge, r.folge));
      if (gilt) await g.setze('routine', schluessel, r.folge.map(kurzname).join(' → '), gilt.anzahl, { folge: r.folge });
    }
  }

  /** Name eines Bereichs aus der Oberflächenkarte: „Seite Ankauf: …“ → „Ankauf“ */
  function bereichName(bereich: string): string {
    const nav = opt.ziele.find((z) => z.ziel.startsWith('nav.') && z.seite === bereich);
    const name = nav?.beschreibung.match(/^Seite\s+([^:(]+)/)?.[1]?.trim();
    if (name) return name;
    const teil = bereich.replace(/^\//, '');
    return teil ? `${teil[0]!.toUpperCase()}${teil.slice(1)}` : 'Start';
  }

  /** Vorschläge der App für einen Bereich (Oberflächenkarte) — sonst eine offene Frage */
  function vorschlaegeFuer(bereich: string): KontextAntwort['chips'] {
    const liste = opt.ziele.find((z) => z.ziel.startsWith('nav.') && z.seite === bereich)?.vorschlaege ?? [];
    return (liste.length ? liste : ['Was kann ich hier tun?']).slice(0, 4).map((v) => ({ label: v, wert: v, art: 'vorschlag' as const }));
  }

  /** Der jüngste Faden (mit einer Nachricht des Nutzers) — in einem Bereich oder überhaupt */
  async function letzterFaden(nutzer: Nutzer, bereich?: string): Promise<{ sitzungId: string; bereich: string; frage: string } | undefined> {
    const kandidaten = await db.select({ id: sitzungen.id, ort: sitzungen.ort }).from(sitzungen).where(eq(sitzungen.nutzer, nutzer.id)).orderBy(desc(sitzungen.updatedAt)).limit(50);
    for (const k of kandidaten) {
      if (bereich && bereichVon(k.ort ?? '/') !== bereich) continue;
      const [n] = await db.select({ text: nachrichten.text }).from(nachrichten).where(and(eq(nachrichten.sitzungId, k.id), eq(nachrichten.rolle, 'nutzer'))).orderBy(desc(nachrichten.createdAt)).limit(1);
      if (n?.text) return { sitzungId: k.id, bereich: bereichVon(k.ort ?? '/'), frage: n.text.length > 120 ? `${n.text.slice(0, 117)}…` : n.text };
    }
    return undefined;
  }

  return {
    dna,
    werkzeuge,
    fingerabdruck,

    nachricht,

    /**
     * Der Morgenvorschlag: beim ersten Öffnen des Tages (Datum `heute` aus dem Browser, JJJJ-MM-TT) einmal je Nutzer.
     * Der Merker steht vor dem Lauf in `ereignisse` — zwei Fenster gleichzeitig erzeugen so höchstens selten zwei.
     */
    /** Was heute ansteht — nur auf Wunsch des Nutzers („Heute zusammenfassen“), nur lesend, in einem eigenen Faden. */
    async morgen(nutzer: Nutzer): Promise<AgentAntwort> {
      return nachricht(nutzer, { text: opt.morgenAuftrag ?? MORGEN_AUFTRAG, ort: '/', kontext: {} }, true, 'Heute zusammenfassen');
    },

    /**
     * Beim Öffnen und bei jedem Ortswechsel: Tagesbeginn (einmal am Tag: weitermachen oder zusammenfassen?), sonst der
     * Faden des Bereichs (weitermachen oder neu?), sonst was es hier gibt. Ohne Modellaufruf, führt nichts aus.
     * `faehigkeiten`: nur sagen, was es hier gibt (nach „Neu beginnen“ oder wenn der Agent selbst hierher navigiert hat).
     */
    async kontext(nutzer: Nutzer, e: { ort: string; heute: string; faehigkeiten?: boolean }): Promise<KontextAntwort> {
      const bereich = bereichVon(e.ort);
      const name = bereichName(bereich);
      const neu: KontextAntwort = { art: 'neu', bereich, name, sitzungId: null, text: `Du bist bei ${name}. Womit kann ich helfen?`, chips: vorschlaegeFuer(bereich) };
      if (e.faehigkeiten) return neu;
      const [tag] = await db.select({ id: ereignisse.id }).from(ereignisse)
        .where(and(eq(ereignisse.nutzer, nutzer.id), eq(ereignisse.art, 'tag'), sql`${ereignisse.kontext}->>'datum' = ${e.heute}`)).limit(1);
      if (!tag) {
        await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: null, richtung: 'beobachtung', art: 'tag', ziel: null, wert: null, kontext: { datum: e.heute } });
        const letzte = await letzterFaden(nutzer);
        return {
          art: 'tagesbeginn', bereich, name, sitzungId: letzte?.sitzungId ?? null,
          text: letzte ? `Guten Morgen! Zuletzt bei ${bereichName(letzte.bereich)}: „${letzte.frage}“. Dort weitermachen, oder soll ich zusammenfassen, was heute ansteht?` : 'Guten Morgen! Soll ich zusammenfassen, was heute ansteht?',
          chips: [
            ...(letzte ? [{ label: 'Weitermachen', wert: `weiter:${letzte.sitzungId}`, art: 'kontext' as const }] : []),
            { label: 'Heute zusammenfassen', wert: 'morgen', art: 'kontext' },
            { label: 'Neu beginnen', wert: 'neu', art: 'kontext' },
          ],
        };
      }
      const faden = await letzterFaden(nutzer, bereich);
      if (!faden) return neu;
      return {
        art: 'fortsetzen', bereich, name, sitzungId: faden.sitzungId,
        text: `Hier bei ${name} waren wir zuletzt bei: „${faden.frage}“. Weitermachen oder neu beginnen?`,
        chips: [{ label: 'Weitermachen', wert: `weiter:${faden.sitzungId}`, art: 'kontext' }, { label: 'Neu beginnen', wert: 'neu', art: 'kontext' }],
      };
    },

    async entscheidung(nutzer: Nutzer, e: Entscheidung, melden?: Melden): Promise<AgentAntwort> {
      const start = Date.now();
      const [s] = await db.select().from(sitzungen).where(eq(sitzungen.id, e.sitzungId)).limit(1);
      if (!s || s.nutzer !== nutzer.id) throw new Error('Sitzung unbekannt');
      // Bestätigen ist Bedienen — das schnelle Modell genügt (bei `tempo: auto`)
      const [graph] = await Promise.all([
        graphFuer(nutzer, gedaechtnisBauen(db, nutzer.id), false, false, e.wert),
        db.insert(nachrichten).values({ sitzungId: e.sitzungId, rolle: 'nutzer', text: e.wert }),
      ]);
      const config = { configurable: { thread_id: e.sitzungId } };
      const stand = await graph.getState(config);
      if (!stand.tasks.some((t) => t.interrupts?.length)) throw new Error('Nichts wartet auf eine Entscheidung');
      await laufen(graph, new Command({ resume: e.wert, update: { steuerung: null } }), config, melden);
      return antwortAus(graph, nutzer, e.sitzungId, anzahlNachrichten(stand), start);
    },

    /** Die Oberfläche meldet, was der Nutzer tut. `gespeichert` mit Wert wird zur Formulierung und Episode. */
    async ereignis(nutzer: Nutzer, b: Beobachtung, sitzungId?: string): Promise<void> {
      await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: sitzungId ?? null, richtung: 'beobachtung', art: b.art, ziel: b.ziel, wert: b.wert ?? null, kontext: b.kontext });
      if (b.art === 'gespeichert') {
        const g = gedaechtnisBauen(db, nutzer.id);
        // Lange Texte (eingefügte Mails) taugen nicht als Vorschlag — und sprengen den eindeutigen Index
        if (b.wert?.trim() && b.wert.trim().length <= FORMULIERUNG_MAX) await g.merke('formulierung', b.ziel, b.wert, b.kontext);
        await g.merke('episode', b.ziel, b.wert?.trim() ? `${b.ziel}: ${b.wert.trim().slice(0, 200)}` : b.ziel, { ...b.kontext, ...(sitzungId ? { sitzungId } : {}) });
        // Bewusst abgewartet: der Browser wartet auf diese Meldung ohnehin nicht, und /routinen liest gleich danach
        await routinenNeu(nutzer);
      }
    },

    gedaechtnis(nutzer: Nutzer): Gedaechtnis {
      return gedaechtnisBauen(db, nutzer.id);
    },

    /** Vorschläge für ein Feld: die häufigsten Formulierungen dieses Nutzers an diesem Ziel. */
    async vorschlaege(nutzer: Nutzer, ziel: string, n = 5): Promise<string[]> {
      const e = await gedaechtnisBauen(db, nutzer.id).erinnere('formulierung', ziel, n);
      return e.map((x) => x.inhalt);
    },

    /** Die erkannten Routinen mit Label und Auftrag für den Agenten (jedes Senden wird einzeln bestätigt). */
    async routinen(nutzer: Nutzer, n = 3) {
      const g = gedaechtnisBauen(db, nutzer.id);
      const eintraege = await g.erinnere('routine', undefined, n);
      return Promise.all(eintraege.map(async (e) => {
        const folge = (e.kontext.folge as string[] | undefined) ?? e.schluessel.split(' → ');
        const woerter: string[] = [];
        for (const schritt of folge) {
          const [f] = await g.erinnere('formulierung', schritt, 1);
          if (f) woerter.push(` Wortlaut für ${kurzname(schritt)}: „${f.inhalt}“ (vorschlagen, der Nutzer kann ändern).`);
        }
        const schritte = folge.map((s, i) => `${i + 1}. ${kurzname(s)} (${s})`).join(', ');
        const auftrag = `Routine ausführen (${e.haeufigkeit}× so gemacht): ${schritte}. Im gerade geöffneten Eintrag.${woerter.join('')} Jedes Senden einzeln bestätigen lassen.`;
        return { id: e.id!, label: e.inhalt, folge, anzahl: e.haeufigkeit, auftrag };
      }));
    },

    /** Löscht einen Gedächtnis-Eintrag; eine gelöschte Routine wird erst nach neuen Abläufen wieder angeboten. */
    async loeschen(nutzer: Nutzer, id: string): Promise<boolean> {
      const g = gedaechtnisBauen(db, nutzer.id);
      const e = await g.eintrag(id);
      if (!e) return false;
      if (e.art === 'routine') await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: null, richtung: 'beobachtung', art: 'routine-geloescht', ziel: e.schluessel, wert: null, kontext: {} });
      return g.loeschen(id);
    },

    async verlauf(nutzer: Nutzer, sitzungId: string) {
      const [s] = await db.select().from(sitzungen).where(eq(sitzungen.id, sitzungId)).limit(1);
      if (!s || s.nutzer !== nutzer.id) return [];
      return db.select({ rolle: nachrichten.rolle, text: nachrichten.text, chips: nachrichten.chips, createdAt: nachrichten.createdAt }).from(nachrichten).where(eq(nachrichten.sitzungId, sitzungId)).orderBy(nachrichten.createdAt);
    },

    /** Wartet diese Sitzung noch auf eine Bestätigung? Beim Wiederaufnehmen muss die Oberfläche das zeigen. */
    async wartetAuf(nutzer: Nutzer, sitzungId: string): Promise<AgentAntwort['wartetAuf']> {
      const [s] = await db.select().from(sitzungen).where(eq(sitzungen.id, sitzungId)).limit(1);
      if (!s || s.nutzer !== nutzer.id) return undefined;
      const graph = await graphFuer(nutzer, gedaechtnisBauen(db, nutzer.id), false, true);
      const stand = await graph.getState({ configurable: { thread_id: sitzungId } });
      const u = stand.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as { frage: string; aktion: Steuerung } | undefined;
      return u ? { frage: u.frage, aktion: u.aktion } : undefined;
    },

    async letzteSitzung(nutzer: Nutzer): Promise<string | undefined> {
      const [s] = await db.select({ id: sitzungen.id }).from(sitzungen).where(eq(sitzungen.nutzer, nutzer.id)).orderBy(desc(sitzungen.updatedAt)).limit(1);
      return s?.id;
    },

    /** Für die Einstellungsseite: feste Grundregeln, änderbare Immer/Nie, Anbieter und Modell. */
    async einstellungen() {
      const d = await dnaLaden();
      return { grundregeln: GRUNDREGELN, regeln: d.regeln, nie: d.nie, anbieter: d.anbieter, modell: d.modell, tempo: d.tempo, schnellesModell: d.schnellesModell, anbieterListe: ((await opt.anbieterListe?.()) ?? []).map((a) => ({ ...a, schnellesModell: a.schnellesModell ?? ANBIETER.find((x) => x.id === a.id)?.schnellesModell ?? '' })),
        // Zugangsdaten nie zurück an die Oberfläche — nur, ob welche hinterlegt sind
        mcp: d.mcp.map((m) => ({ name: m.name, url: m.url, aktiv: m.aktiv, mitZugang: !!m.kopf })) };
    },

    /** Modelle zur Auswahl (heute: OpenRouter, mit „frei“ markiert) — andere Anbieter: leer, Name wird eingetragen */
    async modelle(anbieter: string): Promise<ModellEintrag[]> {
      if (anbieter !== 'openrouter') return [];
      if (openrouterVorrat && Date.now() - openrouterVorrat.zeit < LISTE_CACHE_MS) return openrouterVorrat.liste;
      const liste = await openrouterModelle();
      openrouterVorrat = { zeit: Date.now(), liste };
      return liste;
    },

    async einstellungenSpeichern(eingabe: AgentEinstellungen) {
      const e = AgentEinstellungen.parse(eingabe);
      await dnaSpeichern(DNA.parse({ ...(await dnaLaden()), ...e, slug: dna.slug }));
      return this.einstellungen();
    },

    /** Einen MCP-Server anbinden: erst verbinden und Werkzeuge lesen — antwortet er nicht, wird nichts gespeichert. */
    async mcpHinzufuegen(eingabe: McpServerNeu): Promise<{ werkzeuge: number }> {
      const m = McpServerNeu.parse(eingabe);
      mcpAdressePruefen(m.url);
      if (m.kopf && !opt.geheimnis) throw new KernHinweis('Zugangsdaten für MCP-Server lassen sich hier nicht sicher speichern.');
      let w: McpWerkzeug[];
      try { w = await mcpVerbinden({ name: m.name, url: m.url }, m.kopf || undefined); } catch (e) { throw new KernHinweis((e as Error).message); }
      const d = await dnaLaden();
      const eintrag = { name: m.name, url: m.url, kopf: m.kopf ? opt.geheimnis!.verpacken(m.kopf) : '', aktiv: true };
      await dnaSpeichern(DNA.parse({ ...d, mcp: [...d.mcp.filter((x) => x.name !== m.name), eintrag] }));
      return { werkzeuge: w.length };
    },

    async mcpEntfernen(name: string): Promise<void> {
      const d = await dnaLaden();
      const weg = d.mcp.find((x) => x.name === name);
      if (!weg) return;
      mcpCache.delete(`${weg.url}|${weg.kopf}`);
      const praefix = mcpWerkzeugName(name, '');
      await dnaSpeichern(DNA.parse({ ...d, mcp: d.mcp.filter((x) => x.name !== name), frei: d.frei.filter((f) => !f.startsWith(praefix)) }));
    },

    /** Ein MCP-Werkzeug ohne Rückfrage erlauben (oder wieder fragen lassen). Nur MCP — eigene Werkzeuge sind fest geregelt. */
    async werkzeugFrei(name: string, frei: boolean): Promise<void> {
      if (!name.startsWith('mcp_')) throw new KernHinweis('Nur Werkzeuge von MCP-Servern lassen sich freigeben.');
      const d = await dnaLaden();
      const rest = d.frei.filter((f) => f !== name);
      await dnaSpeichern(DNA.parse({ ...d, frei: frei ? [...rest, name] : rest }));
    },

    /** Ergebnisse zu einem Objekt der App (Typ + ID) — oder ohne Bezug die jüngsten. Für alle Nutzer der App sichtbar. */
    async ergebnisseListe(bezug?: { typ: string; id: string }) {
      return ergebnisseVon(db, '').liste(bezug);
    },
    async ergebnisseZaehlen(bezug: { typ: string; id: string }) {
      return ergebnisseVon(db, '').zaehlen(bezug);
    },
    async ergebnisLoeschen(id: string) {
      return ergebnisseVon(db, '').loeschen(id);
    },

    /** Alle Werkzeuge des Agenten mit Quelle und Recht — für die Einstellungsseite. */
    async werkzeugListe(): Promise<WerkzeugEintrag[]> {
      const d = await dnaLaden();
      const frei = new Set(d.frei);
      const liste: WerkzeugEintrag[] = [
        ...werkzeuge.map((w) => ({ name: w.name, beschreibung: w.beschreibung, quelle: 'app' as const, recht: 'lesen' as const })),
        ...(opt.web?.claudeSuche ? [{ name: 'web_search', beschreibung: 'Websuche von Claude (nur mit Anbieter Anthropic)', quelle: 'web' as const, recht: 'lesen' as const }] : []),
        ...(opt.web?.suche ? [{ name: 'websuche', beschreibung: 'Websuche (DuckDuckGo, Nachrichten) — mit anderen Anbietern', quelle: 'web' as const, recht: 'lesen' as const }] : []),
        ...(opt.web?.lesen ? [{ name: 'seite_lesen', beschreibung: 'Text einer öffentlichen Webseite lesen', quelle: 'web' as const, recht: 'lesen' as const }] : []),
        ...(await mcpWerkzeuge(d)).map((w) => ({ name: w.name, beschreibung: w.beschreibung, quelle: 'mcp' as const, recht: frei.has(w.name) ? 'frei' as const : 'fragt' as const, server: w.server, liestNur: w.liestNur })),
        ...(opt.zusatzWerkzeuge?.({ id: '' }) ?? []).map((w) => ({ name: w.name, beschreibung: w.beschreibung, quelle: 'app' as const, recht: 'lesen' as const })),
        { name: 'steuere', beschreibung: 'Bedient die Oberfläche sichtbar; alles, was speichert, erst nach „Ja“', quelle: 'agent', recht: 'fragt' },
        { name: 'ergebnis_speichern', beschreibung: 'Ergebnis (Recherche, Analyse) beim geöffneten Objekt speichern — erst nach „Ja“', quelle: 'agent', recht: 'fragt' },
        { name: 'ergebnisse_lesen', beschreibung: 'Gespeicherte Ergebnisse lesen', quelle: 'agent', recht: 'lesen' },
        { name: 'chips', beschreibung: 'Antwortmöglichkeiten anbieten', quelle: 'agent', recht: 'intern' },
        { name: 'merke', beschreibung: 'Etwas im Gedächtnis ablegen (sichtbar und löschbar)', quelle: 'agent', recht: 'intern' },
        { name: 'erinnere', beschreibung: 'Im Gedächtnis nachsehen', quelle: 'agent', recht: 'intern' },
      ];
      return liste;
    },

    stand() {
      return { dna, fingerabdruck, werkzeuge: werkzeuge.length, ziele: opt.ziele.length, modell: typeof opt.modell === 'function' ? 'wahl' : opt.modell._llmType() };
    },
  };
}
