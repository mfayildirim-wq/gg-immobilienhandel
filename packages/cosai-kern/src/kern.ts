/**
 * Die Fassade des Kerns — das, was eine Host-App einbaut: `agentKern({ db, modell, openapi, ziele, aufruf })`.
 *
 * Je Nutzer und Sitzung: Nachricht → Graph (aus dem Checkpoint) → Antwort mit Steuerung, Chips und ggf. einer
 * wartenden Bestätigung. Beobachtungen der Oberfläche landen im Ereignisprotokoll und — bei `gespeichert` — als
 * Formulierung und Episode im Gedächtnis. Der Kern hält keine Verbindung offen: jeder Aufruf ist für sich vollständig.
 */
import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DrizzleSaver } from './checkpointer.ts';
import { gedaechtnis as gedaechtnisBauen, type Db, type Gedaechtnis } from './gedaechtnis.ts';
import { graphBauen, GRUNDREGELN, letzterText, type Aufruf, type ZielBeschreibung } from './graph.ts';
export { GRUNDREGELN } from './graph.ts';
import { katalogFingerabdruck, werkzeugeAusOpenapi, type KatalogWerkzeug, type OpenapiDokument } from './katalog.ts';
import { drehbuchModell, type Modell } from './modell.ts';
import { routinenAus, type Routine } from './routinen.ts';
import { agenten, ereignisse, laeufe, nachrichten, sitzungen } from './schema.ts';
import { AgentEinstellungen, DNA, type AgentAntwort, type Beobachtung, type Chip, type Eingabe, type Entscheidung, type Steuerung } from './vertrag.ts';

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
}

/** Längste Notiz, die als Formulierung (Vorschlag) gemerkt wird */
export const FORMULIERUNG_MAX = 500;

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
  async function dnaLaden(): Promise<DNA> {
    const [z] = await db.select({ dna: agenten.dna }).from(agenten).where(and(eq(agenten.slug, dna.slug), eq(agenten.version, 1))).limit(1);
    return z ? DNA.parse({ ...dna, ...(z.dna as Partial<DNA>), slug: dna.slug }) : dna;
  }

  async function modellFuer(d: DNA): Promise<Modell> {
    if (typeof opt.modell !== 'function') return opt.modell;
    const m = await (opt.modell as ModellWahl)({ anbieter: d.anbieter, modell: d.modell });
    if (!m) throw new KernHinweis(`Für den Anbieter „${d.anbieter || 'Standard'}“ ist kein Modell verfügbar — Schlüssel unter Einstellungen → Zugänge hinterlegen oder in den AgentMode-Einstellungen einen anderen Anbieter wählen.`);
    return m;
  }

  /** `nurZustand`: nur den gespeicherten Zustand lesen — dafür wird kein Modell gebraucht (und keines gebaut). */
  const graphFuer = async (nutzer: Nutzer, gedaechtnis: Gedaechtnis, nurLesen = false, nurZustand = false) => {
    const aufruf: Aufruf = (methode, pfad, body) => opt.aufruf(nutzer, methode, pfad, body);
    const d = await dnaLaden();
    const modell = nurZustand ? drehbuchModell([]) : await modellFuer(d);
    return graphBauen({ modell, dna: d, werkzeuge, ziele: opt.ziele, aufruf, gedaechtnis, antwortGrenze: opt.antwortGrenze, nurLesen }, new DrizzleSaver(db));
  };

  async function sitzungSicherstellen(nutzer: Nutzer, sitzungId: string | undefined, ort: string, kontext: Record<string, unknown>): Promise<string> {
    if (sitzungId) {
      const [s] = await db.select().from(sitzungen).where(eq(sitzungen.id, sitzungId)).limit(1);
      if (s && s.nutzer === nutzer.id) {
        await db.update(sitzungen).set({ ort, kontext, updatedAt: new Date().toISOString() }).where(eq(sitzungen.id, sitzungId));
        return sitzungId;
      }
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

  /** Liest nach dem Lauf aus dem Zustand, was die Oberfläche bekommt — und ob der Graph auf eine Bestätigung wartet. */
  async function antwortAus(graph: Awaited<ReturnType<typeof graphFuer>>, nutzer: Nutzer, sitzungId: string, vorher: number): Promise<AgentAntwort> {
    const config = { configurable: { thread_id: sitzungId } };
    const stand = await graph.getState(config);
    const werte = stand.values as { messages: import('@langchain/core/messages').BaseMessage[]; steuerung: Steuerung[]; chips: Chip[] };
    const unterbrechung = stand.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as { frage: string; aktion: Steuerung; vorher: Steuerung[] } | undefined;
    const steuerung = [...werte.steuerung, ...(unterbrechung?.vorher ?? [])];
    const text = letzterText(werte.messages.slice(vorher)) || (unterbrechung ? unterbrechung.frage : '');
    const chips: Chip[] = unterbrechung
      ? [{ label: 'Ja, ausführen', wert: 'ja', art: 'entscheidung' }, { label: 'Nein', wert: 'nein', art: 'entscheidung' }]
      : werte.chips;
    const antwort: AgentAntwort = { sitzungId, text, steuerung, chips, ...(unterbrechung ? { wartetAuf: { frage: unterbrechung.frage, aktion: unterbrechung.aktion } } : {}) };
    await db.insert(nachrichten).values({ sitzungId, rolle: 'agent', text, steuerung, chips });
    for (const s of steuerung) await protokolliere(nutzer, sitzungId, 'steuerung', s.art, s.ziel, s.wert);
    await db.insert(laeufe).values({ sitzungId, status: unterbrechung ? 'wartet' : 'fertig', wartetAuf: unterbrechung ? { frage: unterbrechung.frage, aktion: unterbrechung.aktion } : null });
    return antwort;
  }

  async function nachricht(nutzer: Nutzer, eingabe: Eingabe, nurLesen = false): Promise<AgentAntwort> {
    const sitzungId = await sitzungSicherstellen(nutzer, eingabe.sitzungId, eingabe.ort, eingabe.kontext);
    await db.insert(nachrichten).values({ sitzungId, rolle: 'nutzer', text: eingabe.text });
    const graph = await graphFuer(nutzer, gedaechtnisBauen(db, nutzer.id), nurLesen);
    const config = { configurable: { thread_id: sitzungId } };
    // Wartet der Graph noch auf eine Bestätigung, gilt der neue Text als Antwort darauf (kein „ja“ → abgebrochen)
    const stand = await graph.getState(config);
    const wartet = stand.tasks.some((t) => t.interrupts?.length);
    // `null` setzt Steuerung und Chips des vorigen Zugs zurück (Reducer); die Typen von LangGraph kennen den Reset nicht
    type Eingang = Parameters<typeof graph.invoke>[0];
    const zuruecksetzen = { steuerung: null, chips: null, ort: eingabe.ort, kontext: eingabe.kontext };
    const eingang = (wartet
      ? new Command({ resume: eingabe.text, update: zuruecksetzen })
      : { messages: [new HumanMessage(eingabe.text)], ...zuruecksetzen }) as unknown as Eingang;
    await graph.invoke(eingang, config);
    return antwortAus(graph, nutzer, sitzungId, anzahlNachrichten(stand));
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

  return {
    dna,
    werkzeuge,
    fingerabdruck,

    nachricht,

    /**
     * Der Morgenvorschlag: beim ersten Öffnen des Tages (Datum `heute` aus dem Browser, JJJJ-MM-TT) einmal je Nutzer.
     * Der Merker steht vor dem Lauf in `ereignisse` — zwei Fenster gleichzeitig erzeugen so höchstens selten zwei.
     */
    async morgen(nutzer: Nutzer, heute: string): Promise<AgentAntwort | null> {
      const [schon] = await db.select({ id: ereignisse.id }).from(ereignisse)
        .where(and(eq(ereignisse.nutzer, nutzer.id), eq(ereignisse.art, 'morgen'), sql`${ereignisse.kontext}->>'datum' = ${heute}`)).limit(1);
      if (schon) return null;
      await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: null, richtung: 'steuerung', art: 'morgen', ziel: null, wert: null, kontext: { datum: heute } });
      // Niemand hat ihn ausdrücklich angestoßen — deshalb nur lesend: kein steuere, kein merke, keine offene Rückfrage
      return nachricht(nutzer, { text: opt.morgenAuftrag ?? MORGEN_AUFTRAG, ort: '/', kontext: {} }, true);
    },

    async entscheidung(nutzer: Nutzer, e: Entscheidung): Promise<AgentAntwort> {
      const [s] = await db.select().from(sitzungen).where(eq(sitzungen.id, e.sitzungId)).limit(1);
      if (!s || s.nutzer !== nutzer.id) throw new Error('Sitzung unbekannt');
      await db.insert(nachrichten).values({ sitzungId: e.sitzungId, rolle: 'nutzer', text: e.wert });
      const graph = await graphFuer(nutzer, gedaechtnisBauen(db, nutzer.id));
      const config = { configurable: { thread_id: e.sitzungId } };
      const stand = await graph.getState(config);
      if (!stand.tasks.some((t) => t.interrupts?.length)) throw new Error('Nichts wartet auf eine Entscheidung');
      await graph.invoke(new Command({ resume: e.wert, update: { steuerung: null } }) as unknown as Parameters<typeof graph.invoke>[0], config);
      return antwortAus(graph, nutzer, e.sitzungId, anzahlNachrichten(stand));
    },

    /** Die Oberfläche meldet, was der Nutzer tut. `gespeichert` mit Wert wird zur Formulierung und Episode. */
    async ereignis(nutzer: Nutzer, b: Beobachtung, sitzungId?: string): Promise<void> {
      await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: sitzungId ?? null, richtung: 'beobachtung', art: b.art, ziel: b.ziel, wert: b.wert ?? null, kontext: b.kontext });
      if (b.art === 'gespeichert') {
        const g = gedaechtnisBauen(db, nutzer.id);
        // Lange Texte (eingefügte Mails) taugen nicht als Vorschlag — und sprengen den eindeutigen Index
        if (b.wert?.trim() && b.wert.trim().length <= FORMULIERUNG_MAX) await g.merke('formulierung', b.ziel, b.wert, b.kontext);
        await g.merke('episode', b.ziel, b.wert?.trim() ? `${b.ziel}: ${b.wert.trim().slice(0, 200)}` : b.ziel, { ...b.kontext, ...(sitzungId ? { sitzungId } : {}) });
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
      return { grundregeln: GRUNDREGELN, regeln: d.regeln, nie: d.nie, anbieter: d.anbieter, modell: d.modell };
    },

    async einstellungenSpeichern(eingabe: AgentEinstellungen) {
      const e = AgentEinstellungen.parse(eingabe);
      const neu = DNA.parse({ ...(await dnaLaden()), ...e, slug: dna.slug });
      await db.insert(agenten).values({ slug: dna.slug, version: 1, dna: neu, status: 'aktiv' })
        .onConflictDoUpdate({ target: [agenten.slug, agenten.version], set: { dna: neu, updatedAt: new Date().toISOString() } });
      return this.einstellungen();
    },

    stand() {
      return { dna, fingerabdruck, werkzeuge: werkzeuge.length, ziele: opt.ziele.length, modell: typeof opt.modell === 'function' ? 'wahl' : opt.modell._llmType() };
    },
  };
}
