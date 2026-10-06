/**
 * Bank-Präsentation, Folie „Objektbeschreibung“: Wohn-, Gewerbe- und Mietfläche.
 * Fachentscheidung 06.10.2026 (Neuerung, die alte App kannte nur die Wohnfläche).
 */
type Daten = Record<string, any>;

const zahl = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const m2 = (n: number) => (n ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '');

/**
 * Flächen aus den Einheiten des Deals: Wohnfläche = Wohnungen + Sonstiges, Gewerbefläche = Gewerbe, Mietfläche = beides.
 * Stellplätze zählen nicht. Haben die Einheiten keine Fläche, bleibt die Wohnfläche aus dem Objekt und die Mietfläche folgt ihr.
 * Kaufpreis pro m² bezieht sich auf die Mietfläche. Läuft nach `objektbeschreibungVorbelegen` (dessen Ergebnis
 * bleibt das der alten App, siehe Golden Master).
 */
export function flaechenVorbelegen(data: Daten, deal: any | null, objekt: any | null): Daten {
  const einheiten: any[] = Array.isArray(deal?.einheiten) ? deal.einheiten : [];
  const summe = (passt: (typ: string) => boolean) => einheiten.filter((e) => passt(String(e.typ ?? ''))).reduce((s, e) => s + zahl(e.fl), 0);
  const gewerbe = summe((t) => t === 'Gewerbe');
  const wohnen = summe((t) => t !== 'Gewerbe' && t !== 'Stellplatz');
  const d: Daten = { ...data };
  if (wohnen || gewerbe) d.wohnflaeche = m2(wohnen);
  else d.wohnflaeche = data.wohnflaeche || String(objekt?.wohnflaeche || '');
  d.gewerbeflaeche = m2(gewerbe);
  const miet = (wohnen || gewerbe) ? wohnen + gewerbe : zahl(d.wohnflaeche);
  d.mietflaeche = m2(miet);
  const kp = zahl(deal?.kalk?.kaufpreis);
  if (kp && miet) d.kaufpreisPerM2 = `${Math.round(kp / miet).toLocaleString('de-DE')} €/m²`;
  return d;
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
