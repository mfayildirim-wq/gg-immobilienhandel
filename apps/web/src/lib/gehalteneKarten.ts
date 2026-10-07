import { useSyncExternalStore } from 'react';

/**
 * Karten im Ankauf-Cockpit, deren Termin gesetzt wurde, bleiben stehen, bis „Erledigt“ sie abschließt (wie in der alten
 * App). Der Termin kann an zwei Stellen gesetzt werden: auf der Karte (Datum, 1W/1M/3M/6M) und rechts im Deal-Detail,
 * Reiter Kommunikation (1 Wo/1 Mo/3 Mo/6 Mo). Damit beide dieselbe Karte festhalten, liegt der Zustand hier statt in der
 * Seite.
 *
 * Ablauf: `vormerken` vor dem Speichern merkt sich die Karte, wie sie gerade angezeigt wird (Platz und Abschnitt), denn
 * nach dem Speichern lädt die Liste neu und die Karte fehlt dort oder steht mit neuem Termin woanders. `bestaetigen` nach
 * dem Speichern hält sie fest. Jede spätere Änderung an Deal oder Makler zieht die Version nach (`version`), sonst
 * scheitert „Erledigt“ auf der Karte am Versionsvergleich. Die Ankaufseite verwirft gehaltene Karten beim Öffnen und Verlassen.
 */
export type KartenArt = 'deals' | 'makler';
type Halt = { basis: { id: string; version: number }; nextContact: string | null; version: number; bestaetigt: boolean };

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
  /** Vor dem Speichern eines Termins: die angezeigte Karte merken (unbekannte Karten werden nicht gehalten). */
  vormerken(art: KartenArt, id: string) {
    const alt = gehaltenJe[art][id];
    const basis = alt?.basis ?? angezeigtJe[art].get(id);
    if (!basis || alt) return;
    setzen(art, { ...gehaltenJe[art], [id]: { basis, nextContact: null, version: basis.version, bestaetigt: false } });
  },
  /** Nach erfolgreichem Speichern: die Karte festhalten, mit neuem Termin und neuer Version. */
  bestaetigen(art: KartenArt, id: string, e: { version: number; nextContact: string | null }) {
    const alt = gehaltenJe[art][id];
    if (!alt) return;
    setzen(art, { ...gehaltenJe[art], [id]: { ...alt, ...e, bestaetigt: true } });
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
    return Object.fromEntries(Object.entries(gehaltenJe[art]).filter(([, h]) => h.bestaetigt).map(([id, h]) => {
      const version = Math.max(h.version, aktuell.get(id)?.version ?? 0);
      return [id, { ...(h.basis as T), nextContact: h.nextContact, version }];
    }));
  },
};

/** Für die Ankaufseite: neu zeichnen, sobald sich gehaltene Karten ändern. */
export function useGehalteneKarten() {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h); }; }, () => gehaltenJe);
}
