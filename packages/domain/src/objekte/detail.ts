/**
 * Objekt-Detail: Kennzahlen, Recherchelinks und Einheitenaufstellung.
 * Nach gg-immohandel src/modules/objekte/objekte.ts objDetailHTML, objFormHTML, objRenderEinheiten, objAddEinheit, objUE.
 */
import { fe, nf } from '../listen/listen.ts';

export const OBJEKT_STATUS = ['In Prüfung', 'Über Zeit nachfassen', 'Angebot abgegeben', 'Closing Path', 'Angekauft', 'Archiv'] as const;
export const ENERGIE_KLASSEN = ['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const EINHEIT_TYPEN = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'] as const;
/** Auswahl in der Einheitenliste; alles außer „Leerstand“ gilt als vermietet. */
export const VERMIETUNG_OPTIONEN = [{ wert: 'Vermietet', label: '✅ Vermietet' }, { wert: 'Leerstand', label: '⬜ Leerstand' }] as const;
export const OBJEKT_LOESCHEN_FRAGE = 'Objekt in den Papierkorb legen?';
/** Fachentscheidung 02.10.2026 (anders als objDelete der alten App): ein Objekt mit Deal geht nicht in den Papierkorb. */
export const OBJEKT_HAT_DEAL_HINWEIS = 'Das Objekt hängt an einem Deal und kann nicht gelöscht werden. Lösche zuerst den Deal.';

export interface ObjektWerte {
  strasse?: string | null; hausnr?: string | null; plz?: string | null; stadt?: string | null;
  baujahr?: number | null; einheitenAnzahl?: number | null; wohnflaeche?: number | null; grundstueck?: number | null;
  energieklasse?: string | null; heizung?: string | null;
  angebotspreis?: number | null; zielpreis?: number | null; istMiete?: number | null; sollMiete?: number | null;
}

export interface ObjektEinheitWerte {
  typ?: string | null; lage?: string | null; zimmer?: number | null; stueck?: number | null;
  flaeche?: number | null; kaltmiete?: number | null; vermietung?: string | null;
}

/** Anzeigewerte von objDetailHTML (Lage, Gebäude, Kennzahlen). */
export function objektAnzeige(o: ObjektWerte) {
  const r = o.angebotspreis && o.istMiete ? `${(((o.istMiete * 12) / o.angebotspreis) * 100).toFixed(2)}%` : '–';
  const fak = o.angebotspreis && o.istMiete ? `${(o.angebotspreis / (o.istMiete * 12)).toFixed(1)}x` : '–';
  return {
    adresse: [o.strasse, o.hausnr].filter(Boolean).join(' ') || '–',
    plzStadt: [o.plz, o.stadt].filter(Boolean).join(' ') || '–',
    baujahr: o.baujahr ? String(o.baujahr) : '–',
    einheiten: o.einheitenAnzahl ? String(o.einheitenAnzahl) : '–',
    wohnflaeche: o.wohnflaeche ? `${nf(o.wohnflaeche)} m²` : '–',
    grundstueck: o.grundstueck ? `${nf(o.grundstueck)} m²` : '–',
    energieklasse: o.energieklasse || '–',
    heizung: o.heizung || '–',
    angebotspreis: fe(o.angebotspreis), zielpreis: fe(o.zielpreis), istMiete: fe(o.istMiete), sollMiete: fe(o.sollMiete),
    renditeBrutto: r, kpFaktor: fak,
  };
}

/** 🔗 Recherche: Google Maps, Street View, ImmoScout, Bodenrichtwert (wörtlich wie alt). */
export function objektRecherche(o: ObjektWerte) {
  const mapQ = encodeURIComponent([o.strasse, o.hausnr, o.plz, o.stadt].filter(Boolean).join(' '));
  const is24 = o.plz || encodeURIComponent(o.stadt || 'Suche');
  return [
    { label: '📍 Google Maps', url: `https://maps.google.com/?q=${mapQ}` },
    { label: '🏠 Street View', url: `https://maps.google.com/?q=${mapQ}&layer=c` },
    { label: '🔍 ImmoScout', url: `https://www.immobilienscout24.de/Suche/de/${is24}/haus-kaufen.html` },
    { label: '🏛 Bodenrichtwert', url: 'https://www.geoportal-bw.de/web/gis-bw' },
  ];
}

const istStellplatz = (e: ObjektEinheitWerte) => e.typ === 'Stellplatz';

/** Zeilen der Einheitenaufstellung (objDetailHTML) und die Summen der Bearbeitungsansicht (objRenderEinheiten). */
export function objektEinheitenAnzeige(einheiten: ObjektEinheitWerte[]) {
  const zeilen = einheiten.map((e) => {
    const stpl = istStellplatz(e);
    return {
      typ: e.typ || '–',
      lage: e.lage || '–',
      anzahl: stpl ? `${e.stueck || '–'} Stk` : `${e.zimmer || '–'} Zi`,
      flaeche: !stpl && e.flaeche ? `${nf(e.flaeche)} m²` : '–',
      kaltmiete: e.kaltmiete ? fe(e.kaltmiete) : '–',
      proQm: !stpl && e.flaeche && e.kaltmiete ? `${(e.kaltmiete / e.flaeche).toFixed(2)} €` : '–',
      vermietung: e.vermietung === 'Leerstand' ? '⬜ Leerstand' : '✅ Vermietet',
    };
  });
  const sf = einheiten.filter((e) => !istStellplatz(e)).reduce((s, e) => s + (+(e.flaeche ?? 0) || 0), 0);
  const sm = einheiten.reduce((s, e) => s + (+(e.kaltmiete ?? 0) || 0), 0);
  return {
    zeilen,
    summen: { flaeche: sf ? `${nf(sf)} m²` : '–', kaltmiete: sm ? fe(sm) : '–', proQm: sf && sm ? `${(sm / sf).toFixed(2)} €/m²` : '–' },
  };
}

/** objAddEinheit: neue Zeile mit Standardwerten. */
export const objektEinheitNeu = (typ: string = 'Wohnung'): ObjektEinheitWerte =>
  ({ typ, lage: '', zimmer: null, stueck: null, flaeche: 0, kaltmiete: 0, vermietung: 'Vermietet' });

/** objUE: Text bleibt Text, Zahlen werden mit parseFloat gelesen (ungültig → 0). */
export function objektEinheitAendern(e: ObjektEinheitWerte, feld: keyof ObjektEinheitWerte, wert: string): ObjektEinheitWerte {
  if (feld === 'typ' || feld === 'lage' || feld === 'vermietung') return { ...e, [feld]: wert };
  return { ...e, [feld]: parseFloat(wert) || 0 };
}
