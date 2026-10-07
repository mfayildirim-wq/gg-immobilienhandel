import { useSyncExternalStore } from 'react';

/**
 * Karten im Ankauf-Cockpit, deren Termin gesetzt wurde, bleiben stehen, bis „Erledigt“ sie abschließt (wie in der alten
 * App). Der Termin kann an zwei Stellen gesetzt werden: auf der Karte (Datum, 1W/1M/3M/6M) und rechts im Deal-Detail,
 * Reiter Kommunikation (1 Wo/1 Mo/3 Mo/6 Mo). Damit beide dieselbe Karte festhalten, liegt der Zustand hier statt in der
 * Seite.
 *
 * Ablauf: `vormerken` hält die Karte **schon beim Klick** fest, so wie sie gerade angezeigt wird (Platz und Abschnitt).
 * Online kommen Antworten unterschiedlich schnell: eine Liste, die ein anderer Klick neu lädt, kann vor der Antwort auf
 * diesen Termin eintreffen und die Karte nicht mehr enthalten. Würde erst die Antwort festhalten, wäre die Karte dann schon
 * weg (Kundenmeldung 07.10.2026). `bestaetigen` zieht danach die Version nach, `zurueck` nimmt den Klick bei einem Fehler
 * zurück. Aufgerufen wird das in den Datenaufrufen (`api.ts`), nicht in den Karten — eine Karte kann verschwinden, ein
 * Datenaufruf läuft zu Ende. Jede spätere Änderung an Deal oder Makler zieht die Version nach (`version`), sonst scheitert
 * „Erledigt“ auf der Karte am Versionsvergleich. Die Ankaufseite verwirft gehaltene Karten beim Öffnen und Verlassen.
 */
export type KartenArt = 'deals' | 'makler';
type Halt = { basis: { id: string; version: number }; nextContact: string | null; version: number };
/** Stand vor einem Klick, für `zurueck`. */
export type Vorher = Halt | null | undefined;

const angezeigtJe: Record<KartenArt, Map<string, { id: string; version: number }>> = { deals: new Map(), makler: new Map() };
let gehaltenJe: Record<KartenArt, Record<string, Halt>> = { deals: {}, makler: {} };
const hoerer = new Set<() => void>();
const melden = () => hoerer.forEach((h) => h());
const setzen = (art: KartenArt, neu: Record<string, Halt>) => { gehaltenJe = { ...gehaltenJe, [art]: neu }; melden(); };

export const gehalteneKarten = {
  /** Die Ankaufseite meldet bei jeder Anzeige die Karten, wie sie gerade zu sehen sind. */
  angezeigt<T extends { id: string; version: number }>(art: KartenArt, karten: readonly T[]) {
    for (const k of karten) angezeigtJe[art].set(k.id, k);
  },
  /** Beim Klick auf einen Termin: die angezeigte Karte sofort festhalten (unbekannte Karten werden nicht gehalten).
   *  Gibt den Stand davor zurück — `undefined`, wenn nichts zu halten war. */
  vormerken(art: KartenArt, id: string, nextContact: string | null): Vorher {
    const alt = gehaltenJe[art][id];
    const basis = alt?.basis ?? angezeigtJe[art].get(id);
    if (!basis) return undefined;
    setzen(art, { ...gehaltenJe[art], [id]: { basis, nextContact, version: alt?.version ?? basis.version } });
    return alt ?? null;
  },
  /** Nach erfolgreichem Speichern: neue Version (und Termin) übernehmen. */
  bestaetigen(art: KartenArt, id: string, e: { version: number; nextContact: string | null }) {
    const alt = gehaltenJe[art][id];
    if (!alt) return;
    setzen(art, { ...gehaltenJe[art], [id]: { ...alt, ...e, version: Math.max(alt.version, e.version) } });
  },
  /** Speichern gescheitert: auf den Stand vor dem Klick zurück. */
  zurueck(art: KartenArt, id: string, vorher: Vorher) {
    if (vorher === undefined) return;
    if (vorher === null) { gehalteneKarten.loslassen(art, id); return; }
    setzen(art, { ...gehaltenJe[art], [id]: vorher });
  },
  /** Nach jeder anderen Änderung an Deal/Makler: Version einer gehaltenen Karte nachziehen. */
  version(art: KartenArt, id: string, version: number) {
    const alt = gehaltenJe[art][id];
    if (!alt || alt.version >= version) return;
    setzen(art, { ...gehaltenJe[art], [id]: { ...alt, version } });
  },
  loslassen(art: KartenArt, id: string) {
    if (!gehaltenJe[art][id]) return;
    const { [id]: _weg, ...rest } = gehaltenJe[art];
    setzen(art, rest);
  },
  /** Gehaltene Karten verwerfen (Ankaufseite öffnen/verlassen). Die zuletzt angezeigten Karten bleiben bekannt, damit
   *  ein Termin gleich nach dem Öffnen — noch vor dem nächsten Neuzeichnen — die Karte festhält. */
  leeren() {
    gehaltenJe = { deals: {}, makler: {} };
    melden();
  },
  /** Gehaltene Karten für `cockpitMitGehaltenen`: Basis von vorher, neuer Termin, die neueste bekannte Version. */
  karten<T extends { id: string; version: number; nextContact: string | null }>(art: KartenArt, server: readonly T[]): Record<string, T> {
    const aktuell = new Map(server.map((k) => [k.id, k]));
    return Object.fromEntries(Object.entries(gehaltenJe[art]).map(([id, h]) => {
      const version = Math.max(h.version, aktuell.get(id)?.version ?? 0);
      return [id, { ...(h.basis as T), nextContact: h.nextContact, version }];
    }));
  },
};

/** Für die Ankaufseite: neu zeichnen, sobald sich gehaltene Karten ändern. */
export function useGehalteneKarten() {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h); }; }, () => gehaltenJe);
}
