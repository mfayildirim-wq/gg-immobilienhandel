/**
 * Die Oberflächenkarte für den AgentMode: jedes Ziel, das der Agent bedienen darf, mit Beschreibung.
 *
 * Die Web-App setzt die Ziele als `data-agent="<ziel>"` an die Elemente (Marken), die API gibt die Liste dem
 * Kern als Wissen über die Bedienung. Ein Klicktest prüft, dass jedes Ziel hier auch im Quelltext vorkommt und umgekehrt.
 * Ziele mit `wert` sind Listeneinträge: `oeffne ankauf.deals.eintrag wert=<dealId>` öffnet genau diesen Eintrag.
 */
export interface ZielBeschreibung {
  ziel: string;
  beschreibung: string;
  /** Auf welcher Seite das Ziel liegt (Pfad) — der Agent navigiert zuerst dorthin */
  seite?: string;
  /** Das Ziel speichert etwas — jede Aktion darauf braucht das „Ja“ des Nutzers (Marke dazu: `data-agent-schreibt`) */
  schreibt?: boolean;
}

export const OBERFLAECHENKARTE: readonly ZielBeschreibung[] = [
  // Navigation (Seitenleiste) — `navigiere` mit diesem Ziel wechselt die Seite
  { ziel: 'nav.ankauf', beschreibung: 'Seite Ankauf: Cockpit mit fälligen Deals und Maklern', seite: '/' },
  { ziel: 'nav.deals', beschreibung: 'Seite Deals: alle Deals als Liste mit Detail', seite: '/deals' },
  { ziel: 'nav.objekte', beschreibung: 'Seite Objekte', seite: '/objekte' },
  { ziel: 'nav.makler', beschreibung: 'Seite Makler', seite: '/makler' },
  { ziel: 'nav.angebote', beschreibung: 'Seite Angebote (Posteingang, Exposés)', seite: '/angebote' },

  // Ankauf (Cockpit)
  { ziel: 'ankauf.reiter.deals', beschreibung: 'Reiter „Deals kontaktieren“ im Ankauf', seite: '/' },
  { ziel: 'ankauf.reiter.makler', beschreibung: 'Reiter „Makler kontaktieren“ im Ankauf', seite: '/' },
  { ziel: 'ankauf.deals.erster', beschreibung: 'Der erste (dringendste) Deal in der Liste „Deals nachverfolgen“ — öffnet ihn rechts im Detail', seite: '/' },
  { ziel: 'ankauf.deals.eintrag', beschreibung: 'Ein Deal in der Liste „Deals nachverfolgen“; wert = Deal-ID (aus GET /api/ankauf)', seite: '/' },
  { ziel: 'ankauf.makler.erster', beschreibung: 'Der erste Makler in der Liste „Makler kontaktieren“', seite: '/' },
  { ziel: 'ankauf.makler.eintrag', beschreibung: 'Ein Makler in der Liste „Makler kontaktieren“; wert = Makler-ID', seite: '/' },

  // Deal-Detail (im Ankauf rechts und auf der Deals-Seite)
  { ziel: 'deal.reiter.uebersicht', beschreibung: 'Reiter „Übersicht“ im Deal' },
  { ziel: 'deal.reiter.kommunikation', beschreibung: 'Reiter „Kommunikation“ im Deal: Nachfassen und Gesprächslog' },
  { ziel: 'deal.reiter.kalkulation', beschreibung: 'Reiter „Kalkulation“ im Deal' },
  { ziel: 'deal.reiter.dateien', beschreibung: 'Reiter „Dateien“ im Deal' },
  { ziel: 'deal.kommentar.text', beschreibung: 'Feld „Neue Gesprächsnotiz“ im Reiter Kommunikation (fuelle mit dem Wortlaut)' },
  { ziel: 'deal.kommentar.senden', beschreibung: 'Knopf, der die Gesprächsnotiz speichert (sende)', schreibt: true },
  { ziel: 'deal.erledigt', beschreibung: 'Knopf „Erledigt“: setzt den letzten Kontakt auf heute und berechnet den nächsten (sende)', schreibt: true },
  { ziel: 'deal.naechster-kontakt.datum', beschreibung: 'Datumsfeld „Nächster Kontakt“ (fuelle mit JJJJ-MM-TT)', schreibt: true },

  // Deals-Seite
  { ziel: 'deals.liste.eintrag', beschreibung: 'Ein Deal in der Liste der Deals-Seite; wert = Deal-ID (aus GET /api/deals)', seite: '/deals' },

  // Makler-Detail
  { ziel: 'makler.reiter.profil', beschreibung: 'Reiter „Profil“ im Makler' },
  { ziel: 'makler.reiter.kommunikation', beschreibung: 'Reiter „Kommunikation“ im Makler' },
];
