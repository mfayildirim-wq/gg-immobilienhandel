/**
 * Ankauf-Cockpit, Wählmaschine und Anruf-Ergebnis: Regeln aus gg-immohandel
 * `src/modules/vertrieb/vertrieb.ts` und `src/modules/waehlmaschine/waehlmaschine.ts` (Stand 9d693b8).
 * Ist-Verhalten, auch wo es uneinheitlich ist (Befunde stehen an der jeweiligen Stelle).
 * Alle Daten sind Kalendertage 'YYYY-MM-DD'; „heute“ ist der deutsche Kalendertag.
 */
import { STATUS_SORT, type DealStatus } from '../deal-status.ts';
import { isoPlusTage } from '../nachfassen.ts';

const tagNummer = (iso: string) => {
  const [j, m, t] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(j!, m! - 1, t!) / 86_400_000);
};
export const tageBis = (von: string, bis: string) => tagNummer(bis) - tagNummer(von);
const istIsoTag = (s: string | null | undefined): s is string => !!s && s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * vtFreqDays. Ist-Verhalten (Golden Master): Die alte App bildete „Nie“ und „Nicht kontaktieren“ auf null ab
 * und schrieb dann `?? 7` – damit rechnen BEIDE wie „Wöchentlich“. Ausgeblendet werden solche Makler nur,
 * weil Cockpit-Spalte und Wählmaschine „Nicht kontaktieren“ vorher ausdrücklich überspringen; Deals mit „Nie“
 * werden nach einem Kontakt wöchentlich wieder fällig. Befund, Fachfrage 6 im Fragebogen.
 */
export function frequenzTageAlt(frequenz: string | null | undefined): number {
  const tage: Record<string, number> = {
    Täglich: 1, Wöchentlich: 7, Monatlich: 30, 'Alle 3 Monate': 90, 'Alle 6 Monate': 180, 'Alle 12 Monate': 365,
  };
  return frequenz && frequenz in tage ? tage[frequenz]! : 7;
}

export type FaelligkeitsKlasse = 'ueberfaellig' | 'heute' | 'woche';
export interface Faelligkeit {
  klasse: FaelligkeitsKlasse;
  tage: number;
  label: string;
  sort: 0 | 1 | 2;
}

/**
 * vtDueStatus. „Diese Woche“ = 1 bis 6 Tage: Die alte App verglich ein ISO-Datum (UTC-Mitternacht)
 * mit „heute + 7“ in Ortszeit; in Deutschland fällt der siebte Tag dadurch heraus.
 */
export function faelligkeit(termin: string | null, heute: string): Faelligkeit | null {
  if (!termin) return null;
  const d = tageBis(heute, termin);
  if (d < 0) return { klasse: 'ueberfaellig', tage: d, label: `${Math.abs(d)}T überfällig`, sort: 0 };
  if (d === 0) return { klasse: 'heute', tage: 0, label: 'Heute kontaktieren', sort: 1 };
  if (d <= 6) return { klasse: 'woche', tage: d, label: `Nächster Kontakt in ${d} Tag${d === 1 ? '' : 'en'}`, sort: 2 };
  return null;
}

/** vtNextDue: letzter Kontakt + Frequenz; ohne letzten Kontakt kein Termin. */
export function terminAusFrequenz(lastContact: string | null, frequenz: string | null | undefined): string | null {
  if (!lastContact) return null;
  return isoPlusTage(lastContact.slice(0, 10), frequenzTageAlt(frequenz));
}

/** Cockpit: ein gesetztes „nächster Kontakt“ hat immer Vorrang, sonst letzter Kontakt + Frequenz. */
export const naechsterTermin = (nextContact: string | null, lastContact: string | null, frequenz: string | null | undefined) =>
  istIsoTag(nextContact) ? nextContact : terminAusFrequenz(lastContact, frequenz);

export interface NachfassDaten {
  nextContact: string | null;
  lastContact: string | null;
}

/** Termin und Fälligkeit für Anzeigen (Deal-Detail, Makler-Detail). */
export function nachfassStand(d: NachfassDaten & { frequenz: string | null }, heute: string) {
  const termin = naechsterTermin(d.nextContact, d.lastContact, d.frequenz);
  return { termin, faellig: faelligkeit(termin, heute) };
}

export type MitFaelligkeit<T> = T & { termin: string; faellig: Faelligkeit };

/** Deals nachverfolgen: nur aktive Status, Standardfrequenz „Wöchentlich“, sortiert nach Termin, dann Status. */
export function cockpitDeals<T extends NachfassDaten & { status: DealStatus; nachfassFrequenz: string | null }>(
  deals: readonly T[],
  heute: string,
): MitFaelligkeit<T>[] {
  const ergebnis: MitFaelligkeit<T>[] = [];
  for (const d of deals) {
    if (STATUS_SORT[d.status] > 3) continue; // Angekauft, Archiv
    const termin = naechsterTermin(d.nextContact, d.lastContact, d.nachfassFrequenz || 'Wöchentlich');
    const faellig = faelligkeit(termin, heute);
    if (!termin || !faellig) continue;
    // heute Erledigtes nicht gleich wieder unter „Diese Woche“ zeigen
    if (faellig.klasse === 'woche' && d.lastContact === heute) continue;
    ergebnis.push({ ...d, termin, faellig });
  }
  return ergebnis.sort((a, b) => (a.termin !== b.termin ? (a.termin < b.termin ? -1 : 1) : STATUS_SORT[a.status] - STATUS_SORT[b.status]));
}

export const maklerPrioRang = (prio: string | null | undefined) => ({ A: 0, B: 1, C: 2 } as Record<string, number>)[prio ?? ''] ?? 2;

/**
 * „Nicht kontaktieren“ erscheint nie. Der Umzug vereinheitlicht es zu „Nie“; bei Maklern stammt „Nie“
 * praktisch immer aus „Nicht kontaktieren“, deshalb wird es hier genauso behandelt.
 */
const nieKontaktieren = (f: string | null | undefined) => f === 'Nicht kontaktieren' || f === 'Nie';

type MaklerNachfass = NachfassDaten & { prio: string | null; kontaktFrequenz: string | null };

/** Makler kontaktieren: Standardfrequenz „Monatlich“, sortiert nach Termin, dann Prio A/B/C. */
export function cockpitMakler<T extends MaklerNachfass>(makler: readonly T[], heute: string): MitFaelligkeit<T>[] {
  const ergebnis: MitFaelligkeit<T>[] = [];
  for (const m of makler) {
    const frequenz = m.kontaktFrequenz || 'Monatlich';
    if (nieKontaktieren(frequenz)) continue;
    const termin = naechsterTermin(m.nextContact, m.lastContact, frequenz);
    const faellig = faelligkeit(termin, heute);
    if (!termin || !faellig) continue;
    if (faellig.klasse === 'woche' && m.lastContact === heute) continue;
    ergebnis.push({ ...m, termin, faellig });
  }
  return ergebnis.sort((a, b) => (a.termin !== b.termin ? (a.termin < b.termin ? -1 : 1) : maklerPrioRang(a.prio) - maklerPrioRang(b.prio)));
}

export const TERMIN_GEAENDERT = 'Termin geändert';
export const TERMIN_GEAENDERT_HINWEIS = 'Der neue Termin ist gespeichert. Die Karte bleibt stehen, bis „Erledigt“ sie abschließt.';

/**
 * vtQuickDate/vtSetDealDate (und die Makler-Gegenstücke) der alten App schrieben nur den Termin und zeichneten die
 * Liste nicht neu: die Karte blieb stehen, bis „Erledigt“ sie abschloss. Dasselbe hier — `gehalten` sind die Karten,
 * deren Termin in dieser Ansicht gesetzt wurde (Stand der Karte beim ersten Setzen, mit neuem Termin und neuer Version).
 * Sie bleiben in ihrem Abschnitt und an ihrem Platz (alte Fälligkeit, alter Termin für die Reihenfolge), auch wenn der
 * Server sie nicht mehr als fällig liefert; liefert er sie weiter, gelten seine Daten.
 */
export function cockpitMitGehaltenen<T extends { id: string; termin: string; faellig: unknown }>(
  liste: readonly T[],
  gehalten: Readonly<Record<string, T>>,
): (T & { gehalten?: true })[] {
  const ids = Object.keys(gehalten);
  if (ids.length === 0) return [...liste];
  const vomServer = new Set(liste.map((k) => k.id));
  const alle: (T & { gehalten?: true })[] = [
    ...liste.map((k) => { const g = gehalten[k.id]; return g ? { ...k, termin: g.termin, faellig: g.faellig, gehalten: true as const } : k; }),
    ...ids.filter((id) => !vomServer.has(id)).map((id) => ({ ...gehalten[id]!, gehalten: true as const })),
  ];
  // nach dem (alten) Termin, bei Gleichstand in der gelieferten Reihenfolge
  return alle.map((k, i) => ({ k, i })).sort((x, y) => (x.k.termin < y.k.termin ? -1 : x.k.termin > y.k.termin ? 1 : x.i - y.i)).map((x) => x.k);
}

/** Reihenfolge der Abschnitte in „Nächste Kontakte“ und in der Wählmaschine: heute → überfällig → diese Woche. */
export const ABSCHNITT_REIHENFOLGE: readonly FaelligkeitsKlasse[] = ['heute', 'ueberfaellig', 'woche'];

/** Eine Liste in der Reihenfolge, in der sie auf der Ankaufseite steht: abschnittsweise, innerhalb unverändert. */
export const inAbschnittsreihenfolge = <T extends { faellig: Faelligkeit }>(liste: readonly T[]): T[] =>
  ABSCHNITT_REIHENFOLGE.flatMap((klasse) => liste.filter((e) => e.faellig.klasse === klasse));

/**
 * Wählmaschinen-Warteschlange der Makler = die Liste „Makler kontaktieren“ (`cockpitMakler`), in der Reihenfolge, in
 * der sie auf der Ankaufseite steht: Abschnitte heute → überfällig → diese Woche, darin nach Termin, dann Prio A/B/C.
 * Entscheidung des Auftraggebers vom 22.09.2026 (Fachfrage 7): ein gesetztes „nächster Kontakt“, etwa ein
 * vereinbarter Rückruf, zählt damit auch hier. Die alte App rechnete nur mit letztem Kontakt + Frequenz und
 * sortierte nach Klasse, dann Prio – die Wählmaschine zeigte deshalb eine andere Liste als das Cockpit.
 */
export function waehlmaschinenQueue<T extends MaklerNachfass>(makler: readonly T[], heute: string): MitFaelligkeit<T>[] {
  return inAbschnittsreihenfolge(cockpitMakler(makler, heute));
}

/**
 * „Liste durchwählen“ auf der Ankaufseite (22.09.2026): die Deals aus „Deals nachverfolgen“ in der angezeigten
 * Reihenfolge – heute → überfällig → diese Woche, darin nach Termin, dann Status. Je Halt wird der Makler des Deals
 * angerufen; das Ergebnis wird am Deal gebucht. Die alte App kannte nur das Durchwählen der Makler.
 */
export function dealWaehlliste<T extends NachfassDaten & { status: DealStatus; nachfassFrequenz: string | null }>(deals: readonly T[], heute: string): MitFaelligkeit<T>[] {
  return inAbschnittsreihenfolge(cockpitDeals(deals, heute));
}

/**
 * Makler ohne jeden Termin (weder nächster noch letzter Kontakt) einplanen: nächster Kontakt = heute + 1…Frequenztage,
 * je Frequenz reihum verteilt, damit nicht alle am selben Tag fällig werden. Reihenfolge = Reihenfolge der Liste.
 */
export function terminloseMaklerEinplanen(
  makler: readonly { id: string; kontaktFrequenz: string | null; nextContact: string | null; lastContact: string | null }[],
  heute: string,
): { id: string; nextContact: string }[] {
  const zaehler: Record<string, number> = {};
  const plan: { id: string; nextContact: string }[] = [];
  for (const m of makler) {
    const frequenz = m.kontaktFrequenz || 'Monatlich';
    if (nieKontaktieren(frequenz)) continue;
    if (istIsoTag(m.nextContact) || m.lastContact) continue;
    const tage = frequenzTageAlt(frequenz);
    const idx = (zaehler[frequenz] = (zaehler[frequenz] ?? 0) + 1);
    plan.push({ id: m.id, nextContact: isoPlusTage(heute, 1 + ((idx - 1) % tage)) });
  }
  return plan;
}

/**
 * „✓ Erledigt“ (vtDealDone/vtMaklerDone, auch Wählmaschine ohne Rückruf): letzter Kontakt = heute;
 * nächster = heute + Frequenz, außer ein vorhandener Termin liegt weiter in der Zukunft.
 * Ist-Verhalten: Auch „Nie“ ergibt heute + 7 (siehe frequenzTageAlt); der Zweig „kein Termin“ der alten App war tot.
 * Standardfrequenz beim Erledigen ist in der alten App für Deals UND Makler „Wöchentlich“.
 */
export function erledigtTermin(bestehend: string | null, heute: string, frequenz: string | null | undefined) {
  const berechnet = isoPlusTage(heute, frequenzTageAlt(frequenz || 'Wöchentlich'));
  const nextContact = istIsoTag(bestehend) && bestehend > berechnet ? bestehend : berechnet;
  return { lastContact: heute, nextContact };
}

export type AnrufErgebnis = 'erreicht' | 'nicht' | 'rueckruf' | null;

const ERGEBNIS_TEXT: Record<Exclude<AnrufErgebnis, null>, string> = {
  erreicht: 'Erreicht',
  nicht: 'Nicht erreicht',
  rueckruf: 'Rückruf vereinbart',
};

/** Datum wie `toLocaleDateString('de-DE')`: ohne führende Nullen (17.9.2026). */
export const deutschesDatum = (iso: string) => {
  const [j, m, t] = iso.split('-').map(Number);
  return `${t}.${m}.${j}`;
};

/**
 * Wählmaschine „Erledigt → Nächster Makler“ (wmWeiter): Frequenz übernehmen, letzter Kontakt = heute;
 * Rückruf mit Datum setzt den nächsten Kontakt auf dieses Datum (ohne Datum bleibt er unverändert),
 * sonst Erledigt-Regel. Eine Notiz wird mit „[T.M.JJJJ – Ergebnis] “ protokolliert.
 */
export function anrufErgebnisAnwenden(e: {
  ergebnis: AnrufErgebnis;
  notiz: string;
  frequenz: string;
  rueckrufDatum: string | null;
  bestehenderTermin: string | null;
  heute: string;
}): { kontaktFrequenz: string; lastContact: string; nextContact: string | null; notizEintrag: string | null } {
  const notiz = e.notiz.trim();
  const praefix = e.ergebnis ? `[${deutschesDatum(e.heute)} – ${ERGEBNIS_TEXT[e.ergebnis]}] ` : `[${deutschesDatum(e.heute)}] `;
  let nextContact = e.bestehenderTermin;
  if (e.ergebnis === 'rueckruf') {
    if (e.rueckrufDatum) nextContact = e.rueckrufDatum;
  } else {
    nextContact = erledigtTermin(e.bestehenderTermin, e.heute, e.frequenz).nextContact;
  }
  return { kontaktFrequenz: e.frequenz, lastContact: e.heute, nextContact, notizEintrag: notiz ? praefix + notiz : null };
}

/** Geburtstags-Hinweis (vtBirthdayDue): von gestern bis in 7 Tagen. Formate 'YYYY-MM-DD' oder 'MM-DD'. */
export function geburtstagHinweis(geburtsdatum: string | null | undefined, heute: string) {
  const roh = (geburtsdatum ?? '').trim();
  let monat: number, tag: number, jahr: number | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) [jahr, monat, tag] = roh.split('-').map(Number) as [number, number, number];
  else if (/^\d{2}-\d{2}$/.test(roh)) [monat, tag] = roh.split('-').map(Number) as [number, number];
  else return null;
  if (!monat || !tag || monat < 1 || monat > 12 || tag < 1 || tag > 31) return null;
  const diesesJahr = Number(heute.slice(0, 4));
  const iso = (j: number) => {
    // new Date(j, m-1, t) rollt ungültige Tage weiter (31.02. → 03.03.)
    const d = new Date(Date.UTC(j, monat - 1, tag));
    return d.toISOString().slice(0, 10);
  };
  let diff = tageBis(heute, iso(diesesJahr));
  if (diff < -1) diff = tageBis(heute, iso(diesesJahr + 1));
  if (diff > 7) return null;
  const alter = jahr ? diesesJahr - jahr + (diff < 0 ? 1 : 0) : undefined;
  const zusatz = alter ? ` (${alter}. Geburtstag!)` : '';
  const label =
    diff < 0 ? `🎂 Geburtstag war gestern${zusatz}` : diff === 0 ? `🎂 Geburtstag HEUTE!${zusatz}` : diff === 1 ? `🎂 Morgen Geburtstag!${zusatz}` : `🎂 Geburtstag in ${diff} Tagen${zusatz}`;
  return { inTagen: diff, alter, label, dringend: diff <= 2 };
}

/**
 * Deal-Stagnation (vtDealStagnation): erster aktiver Deal des Maklers (nicht Archiv/Angekauft),
 * dessen neuester Kommentar bzw. Angebotsdatum ≥ 14 Tage zurückliegt.
 */
export function dealStagnation(
  deals: readonly { status: DealStatus; titel: string; letzteAktivitaet: string | null }[],
  heute: string,
): string | null {
  for (const d of deals) {
    if (d.status === 'Archiv' || d.status === 'Angekauft' || !d.letzteAktivitaet) continue;
    const tage = tageBis(d.letzteAktivitaet.slice(0, 10), heute);
    if (tage >= 14) return `${d.titel}: ${tage} Tage kein Update`;
  }
  return null;
}

/** wa.me-Nummer (formatWhatsAppNumber): 0049/0… → +49…, Ziffern und + behalten. */
export function whatsappNummer(tel: string | null | undefined): string {
  if (!tel) return '';
  let n = tel.replace(/[^\d+]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  else if (n.startsWith('0')) n = `+49${n.slice(1)}`;
  else if (!n.startsWith('+')) n = `+${n}`;
  return n;
}
