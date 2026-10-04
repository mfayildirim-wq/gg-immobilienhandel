/** Eine Stufe der Brotkrumen in der Kopfzeile; mit `to` ist sie ein Verweis zurück. */
export interface Krume { label: string; to?: string }

/** Seiten ohne Eintrag in der Seitenleiste. */
const EINZELSEITEN: Record<string, string> = { 'expose-import': 'Exposé importieren', praesentationen: 'Bank-Präsentation' };
/** Wie der einzelne Eintrag hinter einer Liste heißt (`/projekte/…` → „Projekt“). */
const EINTRAG: Record<string, string> = { kundenkalkulationen: 'Kalkulation', vertriebslisten: 'Vertriebsliste', projekte: 'Projekt', begleitscheine: 'Begleitschein' };

/**
 * Brotkrumen der Kopfzeile: auf welcher Seite man ist. Die Namen kommen aus der Seitenleiste (`seiten`) und dem
 * Untermenü der Einstellungen, damit Kopfzeile und Navigation nie verschieden heißen.
 */
export function brotkrumen(pfad: string, seiten: readonly { to: string; label: string }[], einstellungen: readonly { pfad: string; label: string }[]): Krume[] {
  const [erste = '', zweite] = pfad.split('/').filter(Boolean);
  if (erste === 'einstellungen') {
    const unter = einstellungen.find((e) => e.pfad === zweite);
    return unter ? [{ label: 'Einstellungen' }, { label: unter.label }] : [{ label: 'Einstellungen' }];
  }
  const seite = seiten.find((s) => s.to === `/${erste}`);
  if (seite) return zweite && EINTRAG[erste] ? [{ label: seite.label, to: seite.to }, { label: EINTRAG[erste] }] : [{ label: seite.label }];
  return EINZELSEITEN[erste] ? [{ label: EINZELSEITEN[erste] }] : [];
}
