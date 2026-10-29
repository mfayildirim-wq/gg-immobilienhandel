/**
 * Gedächtnis-Dienst (24.10.2026): zentrales Gedächtnis für Apps und KI (`dienste/gedaechtnis`, Mem0 mit Mandanten,
 * Freigaben, Ersetzen und Protokoll). gg spricht REST; Mandant und App stehen im Schlüssel, nicht im Aufruf.
 */

export interface GedaechtnisEintrag {
  id: string; text: string; app: string; objekt: string | null; art: string | null;
  quelle: string | null; von: string | null; score: number | null; am: string | null;
  /** nur bei abgelegten Ergebnissen (quelle 'ablage') */
  titel?: string | null;
}
export interface GedaechtnisAblage { neu: GedaechtnisEintrag[]; abgeloest: GedaechtnisEintrag[] }

/** Gespräch einer KI-Leiste: wörtliches Chat-Protokoll der eigenen App, kein Wissen (26.10.2026). Nachrichten: @gg/ki-kern. */
export interface GedaechtnisGespraechKopf {
  id: string; bezug: { art: string; id: string } | null; titel: string; von: string | null; am: string | null; anzahl: number;
}
export interface GedaechtnisGespraech extends GedaechtnisGespraechKopf { nachrichten: unknown[] }

export interface GedaechtnisDienst {
  /** App-Ereignis wörtlich (ohne KI); ersetzt den letzten Eintrag gleicher Art am selben Bezug. */
  ereignis(e: { text: string; objekt: string; art: string; von?: string }): Promise<GedaechtnisAblage>;
  /** Ergebnis wörtlich als genau einen Eintrag ablegen (Markdown); derselbe Titel am selben Bezug ersetzt den alten. */
  ablegen(e: { titel: string; text: string; objekt: string; von?: string }): Promise<GedaechtnisAblage>;
  /** Text merken: der Dienst zieht die Fakten heraus und löst Überholtes am selben Bezug ab. */
  merken(e: { text: string; objekt?: string; von?: string }): Promise<GedaechtnisAblage>;
  suchen(e: { frage: string; objekt?: string; anzahl?: number }): Promise<{ treffer: GedaechtnisEintrag[] }>;
  eintraege(objekt: string): Promise<{ eintraege: GedaechtnisEintrag[] }>;
  aendern(id: string, text: string): Promise<GedaechtnisEintrag>;
  vergessen(id: string): Promise<{ id: string; geloescht: boolean }>;
  /** Gespräche zum Bezug (ohne Bezug: die allgemeinen), zuletzt fortgesetzte zuerst */
  gespraeche(bezug: { art: string; id: string } | null, anzahl?: number): Promise<{ gespraeche: GedaechtnisGespraechKopf[] }>;
  gespraech(id: string): Promise<GedaechtnisGespraech>;
  gespraechSpeichern(g: GedaechtnisGespraech): Promise<GedaechtnisGespraechKopf>;
  gespraechLoeschen(id: string): Promise<{ id: string; geloescht: boolean }>;
}

export class GedaechtnisFehler extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

/** `zeitMs` für einfache Aufrufe; `merken` ruft im Dienst die KI (Faktenextraktion, Abgleich) und bekommt `kiZeitMs`. */
export function gedaechtnisClient(url: string, schluessel: string, abruf: Abruf = fetch, zeitMs = 20_000, kiZeitMs = 90_000): GedaechtnisDienst {
  const basis = url.replace(/\/+$/, '');
  const rufe = async <T>(methode: string, pfad: string, rumpf?: unknown, frist = zeitMs): Promise<T> => {
    let res: Response;
    try {
      res = await abruf(`${basis}${pfad}`, {
        method: methode,
        headers: { authorization: `Bearer ${schluessel}`, ...(rumpf === undefined ? {} : { 'content-type': 'application/json' }) },
        body: rumpf === undefined ? undefined : JSON.stringify(rumpf),
        signal: AbortSignal.timeout(frist),
      });
    } catch (e) {
      throw new GedaechtnisFehler(503, `Gedächtnis-Dienst nicht erreichbar (${(e as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : (e as Error).message}).`);
    }
    const daten = await res.json().catch(() => ({})) as { fehler?: string };
    if (!res.ok) throw new GedaechtnisFehler(res.status, daten.fehler ?? `Gedächtnis-Dienst antwortet mit ${res.status}.`);
    return daten as T;
  };
  return {
    ereignis: (e) => rufe('POST', '/v1/ereignis', e),
    ablegen: (e) => rufe('POST', '/v1/ablegen', e),
    merken: (e) => rufe('POST', '/v1/merken', e, kiZeitMs),
    suchen: (e) => rufe('POST', '/v1/suchen', e),
    eintraege: (objekt) => rufe('GET', `/v1/eintraege?objekt=${encodeURIComponent(objekt)}`),
    aendern: (id, text) => rufe('PATCH', `/v1/eintraege/${encodeURIComponent(id)}`, { text }),
    vergessen: (id) => rufe('DELETE', `/v1/eintraege/${encodeURIComponent(id)}`),
    gespraeche: (bezug, anzahl = 20) => rufe('GET', `/v1/gespraeche?${new URLSearchParams({ ...(bezug ? { bezug_art: bezug.art, bezug_id: bezug.id } : {}), anzahl: String(anzahl) })}`),
    gespraech: (id) => rufe('GET', `/v1/gespraeche/${encodeURIComponent(id)}`),
    gespraechSpeichern: ({ id, ...g }) => rufe('PUT', `/v1/gespraeche/${encodeURIComponent(id)}`, g),
    gespraechLoeschen: (id) => rufe('DELETE', `/v1/gespraeche/${encodeURIComponent(id)}`),
  };
}

/** Attrappe für Tests und KI_ATTRAPPE: im Speicher, mit derselben Ersetzen-Regel für Ereignisse wie der Dienst. */
export function gedaechtnisAttrappe(app = 'gg'): GedaechtnisDienst & { alle: () => GedaechtnisEintrag[] } {
  const liste: (GedaechtnisEintrag & { abgeloest?: boolean })[] = [];
  const gueltig = () => liste.filter((x) => !x.abgeloest);
  const gespraeche = new Map<string, GedaechtnisGespraech & { geaendert: number }>();
  const kopf = ({ nachrichten: _n, geaendert: _g, ...k }: GedaechtnisGespraech & { geaendert: number }): GedaechtnisGespraechKopf => k;
  const neu = (text: string, objekt: string | null, art: string | null, quelle: string, von?: string, titel: string | null = null): GedaechtnisEintrag => {
    const x = { id: crypto.randomUUID(), text, app, objekt, art, quelle, von: von ?? app, score: null, am: new Date().toISOString(), titel };
    liste.push(x);
    return x;
  };
  return {
    alle: () => gueltig().map((x) => ({ ...x })),
    async ereignis(e) {
      const alt = gueltig().filter((x) => x.objekt === e.objekt && x.art === e.art);
      for (const x of alt) x.abgeloest = true;
      return { neu: [neu(e.text, e.objekt, e.art, 'api', e.von)], abgeloest: alt };
    },
    async ablegen(e) {
      const art = `ablage:${e.titel.toLowerCase()}`;
      const alt = gueltig().filter((x) => x.objekt === e.objekt && x.art === art);
      for (const x of alt) x.abgeloest = true;
      return { neu: [neu(e.text, e.objekt, art, 'ablage', e.von, e.titel)], abgeloest: alt };
    },
    async merken(e) {
      return { neu: [neu(e.text, e.objekt ?? null, null, 'ki', e.von)], abgeloest: [] };
    },
    async suchen(e) {
      const woerter = e.frage.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const treffer = gueltig()
        .filter((x) => !e.objekt || x.objekt === e.objekt)
        .map((x) => ({ ...x, score: woerter.filter((w) => x.text.toLowerCase().includes(w)).length / Math.max(woerter.length, 1) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      return { treffer: treffer.slice(0, e.anzahl ?? 8) };
    },
    async eintraege(objekt) {
      return { eintraege: gueltig().filter((x) => x.objekt === objekt) };
    },
    async aendern(id, text) {
      const x = gueltig().find((y) => y.id === id);
      if (!x) throw new GedaechtnisFehler(404, 'Eintrag nicht gefunden.');
      Object.assign(x, { text, quelle: 'hand' });
      return { ...x };
    },
    async vergessen(id) {
      const i = liste.findIndex((y) => y.id === id);
      if (i < 0) throw new GedaechtnisFehler(404, 'Eintrag nicht gefunden.');
      liste.splice(i, 1);
      return { id, geloescht: true };
    },
    async gespraeche(bezug, anzahl = 20) {
      const passt = (g: GedaechtnisGespraech) => (bezug ? g.bezug?.art === bezug.art && g.bezug?.id === bezug.id : !g.bezug);
      return { gespraeche: [...gespraeche.values()].filter(passt).sort((a, b) => b.geaendert - a.geaendert).slice(0, anzahl).map(kopf) };
    },
    async gespraech(id) {
      const g = gespraeche.get(id);
      if (!g) throw new GedaechtnisFehler(404, 'Gespräch nicht gefunden.');
      const { geaendert: _g, ...rest } = structuredClone(g);
      return rest;
    },
    async gespraechSpeichern(g) {
      // je Speichern ein späterer Zeitpunkt, auch wenn zwei in derselben Millisekunde liegen
      const zuletzt = Math.max(0, ...[...gespraeche.values()].map((x) => x.geaendert));
      const neu = { ...structuredClone(g), geaendert: Math.max(Date.now(), zuletzt + 1) };
      gespraeche.set(g.id, neu);
      return kopf(neu);
    },
    async gespraechLoeschen(id) {
      return { id, geloescht: gespraeche.delete(id) };
    },
  };
}
