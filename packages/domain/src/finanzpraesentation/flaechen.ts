/**
 * Bank-Präsentation, Folie „Objektbeschreibung“: Mietfläche, Wohn- und Gewerbefläche.
 * Fachentscheidung 06.10.2026 (Neuerung, die alte App kannte nur die Wohnfläche).
 */
type Daten = Record<string, any>;

const zahl = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
/** „1.200,5“ → 1200.5 (Formularfelder); leere oder ungültige Werte zählen 0. */
const deZahl = (v: unknown) => { const n = Number(String(v ?? '').trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const m2 = (n: number) => (n ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '');

/**
 * „Aus Deal/Objekt vorbelegen“: Wohnfläche = Wohnungen + Sonstiges, Gewerbefläche = Gewerbe aus den Einheiten;
 * Stellplätze zählen nicht. Haben die Einheiten keine Fläche, bleibt die Wohnfläche aus dem Objekt.
 * Mietfläche und alles andere (Kaufpreis pro m² …) bleiben, wie sie sind — die Mietfläche setzt der Knopf daneben
 * (`mietflaecheSumme`). Läuft nach `objektbeschreibungVorbelegen` (Golden Master der alten App).
 */
export function flaechenVorbelegen(data: Daten, deal: any | null, objekt: any | null): Daten {
  const einheiten: any[] = Array.isArray(deal?.einheiten) ? deal.einheiten : [];
  const summe = (passt: (typ: string) => boolean) => einheiten.filter((e) => passt(String(e.typ ?? ''))).reduce((s, e) => s + zahl(e.fl), 0);
  const gewerbe = summe((t) => t === 'Gewerbe');
  const wohnen = summe((t) => t !== 'Gewerbe' && t !== 'Stellplatz');
  return {
    ...data,
    wohnflaeche: wohnen || gewerbe ? m2(wohnen) : data.wohnflaeche || String(objekt?.wohnflaeche || ''),
    gewerbeflaeche: m2(gewerbe),
  };
}

/** Knopf neben der Mietfläche: Wohnfläche + Gewerbefläche aus dem Formular (deutsche Schreibweise), sonst nichts. */
export function mietflaecheSumme(wohnflaeche: unknown, gewerbeflaeche: unknown): string {
  return m2(deZahl(wohnflaeche) + deZahl(gewerbeflaeche));
}

/**
 * Eckdaten der Objekt-Folie in der Reihenfolge der Präsentation; Zeilen ohne Wert fallen weg.
 * Eine Quelle für die Ansicht (HTML/PDF) und den PowerPoint-Export.
 */
export function objektFakten(d: Daten): [string, string][] {
  const flaeche = (v: unknown) => (v ? `${v} m²` : '');
  return ([
    ['Adresse', d.adresse],
    ['Baujahr', d.baujahr],
    ['Einheiten', d.einheiten],
    ['Stellplätze', d.stellplaetze],
    ['Mietfläche', flaeche(d.mietflaeche)],
    ['Wohnfläche', flaeche(d.wohnflaeche)],
    ['Gewerbefläche', flaeche(d.gewerbeflaeche)],
    ['Grundstück', flaeche(d.grundstueck)],
    ['Kaufpreis', d.gik],
    ['Kaufpreis pro m²', d.kaufpreisPerM2],
    ['Jahresnettokaltmiete', d.jnkm],
    ['Rendite IST', d.renditeIst],
  ] as [string, unknown][]).filter(([, v]) => !!v).map(([k, v]) => [k, String(v)]);
}
