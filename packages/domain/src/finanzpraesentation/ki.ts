/**
 * Bank-Präsentation: Regeln der beiden KI-Texte (Lage und Objekt).
 * Nach gg-immohandel src/modules/finanzpraes/finanzpraes-ki.ts (finanzpraesGenerateLageKI, finanzpraesGenerateObjektKI):
 * was in den Aufruf geht und wie die Antwort in die Folie kommt. Die Prompts selbst liegen in @gg/integrations.
 * Für beide gilt: Was schon getippt ist, geht in den Aufruf und wird nicht von nichts überschrieben.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Deal und Objekt im Altformat, wie die Vorbelegung */

type Daten = Record<string, unknown>;

export const LAGE_KI_OHNE_ADRESSE = '⚠️ Keine Adresse im Deal/Objekt — bitte zuerst Deal-Daten füllen';
export const OBJEKT_KI_OHNE_DATEN = '⚠️ Keine Daten zum Objekt — bitte zuerst Deal/Objekt-Felder befüllen';
export const KI_DENKT = '⏳ KI denkt nach…';
export const LAGE_KI_KNOPF = '🤖 KI: Lagebeschreibung generieren';
export const OBJEKT_KI_KNOPF = '🤖 KI: Beschreibung generieren';
export const lageKiHinweis = (bullets: number) => `✅ Lagebeschreibung generiert (${bullets} Bullets)`;
export const objektKiHinweis = (woerter: number) => `✅ Objektbeschreibung generiert (${woerter} Wörter)`;
export const kiFehlerHinweis = (grund: string) => `❌ KI-Generierung fehlgeschlagen: ${grund}`;

const text = (v: unknown) => String(v ?? '').trim();
/** Mehrzeiliges Feld → Liste, ohne Leerzeilen. */
const alsZeilen = (wert: unknown) => String(wert ?? '').split('\n').map((z) => z.trim()).filter(Boolean);

export interface Anschrift { strasse: string; hausnr: string; plz: string; stadt: string }

/**
 * Wo die Adresse liegt, laut Kartendienst (OpenStreetMap). Neu gegenüber der alten App: dort bekam die KI nur den
 * Adresstext und riet den Stadtteil — mal „Kaltental“, mal „Feuerbach“. Fachentscheidung 13.10.2026: Der Stadtteil
 * kommt als Fakt in den Aufruf; ohne ihn nennt die KI keinen.
 * `stadtteil` ist der Stadtbezirk bzw. Ortsteil (Stuttgart: „Vaihingen“), `viertel` das Wohnviertel darunter („Vaihingen-Mitte“).
 */
export interface Verortung { stadtteil: string; viertel: string; ort: string; plz: string }

export interface LageKiEingabe {
  fullAdresse: string; stadt: string; plz: string; istStuttgart: boolean;
  /** Bestand vor dem Aufruf — er ist Vorgabe, nicht Opfer. */
  bestandStandort: string[]; bestandAnbindung: string[];
  /** Die Adresse in Teilen, für den Kartendienst. */
  anschrift: Anschrift;
  /** Ermittelte Lage; `null`/fehlend = unbekannt, dann nennt die KI keinen Stadtteil. */
  verortung?: Verortung | null;
}

/** Adresse aus dem Objekt (führend), sonst aus dem Deal. `null`, wenn weder Straße noch Stadt bekannt sind. */
export function lageKiEingabe(data: Daten, deal: any | null, objekt: any | null): LageKiEingabe | null {
  const stadt = text(objekt?.stadt || deal?.stadt);
  const strasse = text(objekt?.strasse || deal?.adresse);
  const hausnr = text(objekt?.hausnr || deal?.hausnr);
  const plz = text(objekt?.plz || deal?.plz);
  if (!stadt && !strasse) return null;
  const adresse = [strasse, hausnr].filter(Boolean).join(' ');
  return {
    fullAdresse: [adresse, plz, stadt].filter(Boolean).join(', '),
    stadt, plz,
    istStuttgart: /stuttgart/i.test(stadt) || /^70\d{3}$/.test(plz),
    bestandStandort: alsZeilen(data.standortBullets),
    bestandAnbindung: alsZeilen(data.anbindungBullets),
    anschrift: { strasse, hausnr, plz, stadt },
  };
}

const klein = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Schlüssel für den Zwischenspeicher: dieselbe Adresse, anders geschrieben (Groß/klein, Leerzeichen), fragt nicht neu an. */
export function verortungSchluessel(a: Anschrift): string {
  return [klein(`${a.strasse} ${a.hausnr}`), klein(a.plz), klein(a.stadt)].join('|');
}

/** Ohne Straße lässt sich kein Stadtteil bestimmen — eine Stadt allein hat viele. */
export const verortungMoeglich = (a: Anschrift) => a.strasse.trim().length > 0;

/**
 * Welcher Treffer des Kartendienstes gilt. Der Dienst liefert auch Nahverwandtes: „Marktplatz 1, 70173 Stuttgart“
 * ergab den Marktplatz in Bad Cannstatt (70372). Deshalb muss die PLZ stimmen, wenn eine bekannt ist; ohne PLZ der Ort.
 * Kein passender Treffer oder keiner mit Stadtteil → `null` (dann lieber kein Stadtteil als ein falscher).
 */
export function verortungWaehlen(a: Anschrift, kandidaten: Verortung[]): Verortung | null {
  const plz = a.plz.trim();
  const stadt = klein(a.stadt);
  const passt = (v: Verortung) => (plz ? v.plz.trim() === plz : !stadt || klein(v.ort) === stadt || klein(v.ort).includes(stadt) || stadt.includes(klein(v.ort)));
  return kandidaten.find((v) => passt(v) && v.stadtteil.trim()) ?? null;
}

/**
 * Antwort in die Folie: je Sektion eine Zeile pro Punkt. Eine leere Sektion lässt den Bestand stehen;
 * kommen gar keine Punkte, ist das ein Ausfall und keine Antwort.
 */
export function lageKiUebernehmen(data: Daten, antwort: { standortBullets?: unknown; anbindungBullets?: unknown } | undefined): { data: Daten; bullets: number } {
  if (!Array.isArray(antwort?.standortBullets) || !Array.isArray(antwort?.anbindungBullets)) throw new Error('KI lieferte unerwartetes Format');
  const neuStandort = antwort.standortBullets.filter((z) => String(z).trim());
  const neuAnbindung = antwort.anbindungBullets.filter((z) => String(z).trim());
  if (neuStandort.length === 0 && neuAnbindung.length === 0) throw new Error('KI lieferte keine Punkte');
  const neu: Daten = { ...data };
  if (neuStandort.length > 0) neu.standortBullets = neuStandort.join('\n');
  if (neuAnbindung.length > 0) neu.anbindungBullets = neuAnbindung.join('\n');
  return { data: neu, bullets: neuStandort.length + neuAnbindung.length };
}

export interface ObjektKiEingabe { fakten: string[]; aktuelleBeschreibung: string }

/** Alle bekannten Fakten — die KI darf nur diese verwenden. Werte der Folie haben Vorrang vor Deal und Objekt. `null` ohne jede Angabe. */
export function objektKiEingabe(data: Daten, deal: any | null, objekt: any | null): ObjektKiEingabe | null {
  const fakten: string[] = [];
  const adresse = [deal?.adresse || objekt?.strasse, deal?.hausnr || objekt?.hausnr].filter(Boolean).join(' ');
  const stadtZeile = [deal?.plz || objekt?.plz, deal?.stadt || objekt?.stadt].filter(Boolean).join(' ');
  if (adresse || stadtZeile) fakten.push(`Adresse: ${[adresse, stadtZeile].filter(Boolean).join(', ')}`);
  const baujahr = data.baujahr || objekt?.baujahr;
  if (baujahr) fakten.push(`Baujahr: ${baujahr}`);
  const einheiten = data.einheiten || objekt?.einheitenAnz;
  if (einheiten) fakten.push(`Einheiten: ${einheiten}`);
  const wfl = data.wohnflaeche || objekt?.wohnflaeche;
  if (wfl) fakten.push(`Wohnfläche: ${wfl} m²`);
  const grundst = data.grundstueck || objekt?.grundstueck;
  if (grundst) fakten.push(`Grundstück: ${grundst} m²`);
  if (data.stellplaetze) fakten.push(`Stellplätze: ${data.stellplaetze}`);
  const gik = data.gik || (deal?.kalk?.kaufpreis ? `${Number(deal.kalk.kaufpreis).toLocaleString('de-DE')} €` : null);
  if (gik) fakten.push(`Kaufpreis/GIK: ${gik}`);
  if (objekt?.energie) fakten.push(`Energiekennwert: ${objekt.energie}`);
  if (objekt?.heizung) fakten.push(`Heizung: ${objekt.heizung}`);
  if (fakten.length === 0) return null;
  // Was schon in der Folie steht, geht als Vorlage mit
  return { fakten, aktuelleBeschreibung: text(data.beschreibung) };
}

export function objektKiUebernehmen(data: Daten, antwort: { beschreibung?: unknown } | undefined): { data: Daten; woerter: number } {
  const roh = typeof antwort?.beschreibung === 'string' ? antwort.beschreibung : '';
  if (roh.length < 30) throw new Error('KI lieferte unerwartet kurzen Text');
  return { data: { ...data, beschreibung: roh.trim() }, woerter: roh.trim().split(/\s+/).length };
}
