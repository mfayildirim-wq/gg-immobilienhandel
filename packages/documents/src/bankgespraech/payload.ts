/**
 * Baut den Bankgespräch-Payload aus Kundenkalkulation + Engine-Ergebnis.
 * Port von `buildPdfPayload` (gg-immohandel src/modules/kundenkalk/kundenkalk.ts), geprüft per Golden Master.
 *
 * Unterschiede nur in der Herkunft der Werte, nicht in der Rechnung:
 * - `ersteller` (alt: localStorage „immo-mein-name“) und `disclaimer` (alt: localStorage) kommen als Parameter.
 * - `heute` ersetzt `new Date()`; Datumsanzeigen in Europe/Berlin, damit Server und Browser gleich formatieren.
 * - `bilder` sind die bereits auflösten Impressionen (alt: `k.impressionen`).
 * - Veraltete Altfelder `stellplatzKaufpreis` und `anhaengeNamen` hat der Neubau nicht mehr (siehe Umzug);
 *   die Vorlage zeigt beide nicht an bzw. nur bei Inhalt, der nie gepflegt werden konnte.
 */
import { splitSanierung, type KKalkInputs, type KKalkOutputs } from '@gg/domain';
import { DEFAULT_DISCLAIMER, type BankgespraechPayload } from './vorlage.ts';

export interface KundenkalkFuerPdf {
  name: string;
  scope: 'global' | 'aufteiler';
  createdAt: string;
  projektTitel?: string | null;
  kaufpreisWohnung?: number | null;
  kaufpreisStellplatz?: number | null;
  stellplaetzeAnzahl?: number | null;
  wertsteigerungSichtbar?: boolean | null;
  wertsteigerungBullets?: string[] | null;
  objSnapshot: { adresse: string; wohnflaecheGesamt: number };
  inputs: KKalkInputs;
}

export interface PdfKontext {
  /** Name des Erstellers; leer → „GG Immohandel“ wie in der alten App. */
  ersteller?: string;
  /** Zentraler Disclaimer aus den Einstellungen; leer → DEFAULT_DISCLAIMER. */
  disclaimer?: string;
  heute: Date;
  bilder?: string[];
}

const ZEITZONE = 'Europe/Berlin';
const datumDe = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: ZEITZONE });
const jahrIn = (d: Date) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: ZEITZONE, year: 'numeric' }).format(d));

export function bankgespraechPayload(k: KundenkalkFuerPdf, out: KKalkOutputs, ctx: PdfKontext): BankgespraechPayload {
  const me = ctx.ersteller || 'GG Immohandel';
  const dauerJahre = k.inputs.betrachtungsdauerJahre ?? 10;
  const m = out.matrix;
  const startYear = k.inputs.kaufjahr ?? jahrIn(ctx.heute);
  // Single Source of Truth (identisch zur Engine): WEG-Sanierung ist Teil des
  // Jahr-1-Sofortabzugs (san.sofortAbzug = sofort + weg) und NICHT der Wertbasis.
  const san = splitSanierung(k.inputs.sanierungsposten);
  const sanSofortTotal = san.sofortAbzug;
  const afaPaTotal = out.investition.afaProJahrTotal;
  // Indexzugriffe wie im Original ungeprüft: fehlende Jahre ergeben NaN in der Anzeige (Ist-Verhalten).
  const cashflowYears = Array.from({ length: dauerJahre }, (_, i) => {
    const miete = m.miete_pro_jahr[i]!;
    const bewirtPa = -12 * k.inputs.nichtUmlagefaehig
                     * Math.pow(1 + (k.inputs.kostensteigerungJaehrlich ?? 0), i);
    const zinsen = -m.zinsen_pro_jahr[i]!;
    const tilgung = -m.tilgung_pro_jahr[i]!;
    const cfOp = m.cashflow_op_jahr[i]!;
    const cfNs = m.cashflow_ns_jahr[i]!;
    const steuern = m.steuern_jahr[i]!;
    // zu versteuerndes Einkommen aus V&V: Miete + Bewirtschaftung + Zinsen − AfA − Sofort-Sanierung (nur Jahr 1).
    // Tilgung ist KEINE Werbungskostenposition.
    let zuVersteuern = miete + bewirtPa + zinsen - afaPaTotal;
    if (i === 0) zuVersteuern -= sanSofortTotal;
    return {
      year: startYear + i,
      kaltmiete: miete,
      bewirtschaftung: bewirtPa,
      investitionsmassnahme: 0,
      tilgungszuschuss: 0,
      bewirtschaftungSumme: bewirtPa,
      zinsen,
      tilgung,
      cashflowVorSteuer: cfOp,
      steuerErstattungLast: -steuern,
      cashflowNachSteuern: cfNs,
      kumuliert: 0,
      tax_zuVersteuerndesEinkommen: zuVersteuern,
    };
  });
  let kum = 0;
  cashflowYears.forEach((y) => { kum += y.cashflowNachSteuern; y.kumuliert = kum; });

  const summeNs = cashflowYears.reduce((s, y) => s + y.cashflowNachSteuern, 0);
  const durchschnitt_cashflowProMonat = summeNs / (dauerJahre * 12);
  const wertEnde = m.wert_pro_jahr[dauerJahre - 1]!;
  const wertStart = k.inputs.kaufpreis + san.investor;
  const wertWachs = wertEnde - wertStart;
  const tilgungSum = m.tilgung_pro_jahr.slice(0, dauerJahre).reduce((s, t) => s + t, 0);
  const durchschnitt_tilgungProMonat = tilgungSum / (dauerJahre * 12);
  const durchschnitt_vermoegensaufbauProMonat = (wertWachs + tilgungSum + summeNs) / (dauerJahre * 12);

  const erstesDarlehen = k.inputs.darlehen[0];
  const zinsAnzeige = erstesDarlehen?.zinssatz ?? out.finanzierung.gewichteterZinssatz;
  const tilgungAnzeige = erstesDarlehen?.tilgung ?? out.finanzierung.gewichteteTilgung;

  // Monatliche Investitionen Basisjahr ab 2. Jahr (Index 1 in den Engine-Matrizen)
  const j2Idx = 1;
  const zinsM = -(m.zinsen_pro_jahr[j2Idx] || 0) / 12;
  const tilgungM = -(m.tilgung_pro_jahr[j2Idx] || 0) / 12;
  const nuMonat = -(k.inputs.nichtUmlagefaehig || 0)
                  * Math.pow(1 + (k.inputs.kostensteigerungJaehrlich ?? 0), j2Idx);
  const kaltMonat = (m.miete_pro_jahr[j2Idx] || 0) / 12;
  const einnahmenVorSteuer = kaltMonat + nuMonat + zinsM + tilgungM;
  const steuernJ2Monat = -(m.steuern_jahr[j2Idx] || 0) / 12;
  const einnahmenNachSteuer = einnahmenVorSteuer + steuernJ2Monat;

  const hv = out.bankgespraech.hochrechnungVerkauf;
  return {
    kalkName: k.name,
    projektTitel: k.projektTitel || `Projekt: ${k.objSnapshot.adresse}`,
    adresse: k.objSnapshot.adresse,
    scope: k.scope,
    headerSubtitle: `Stand ${datumDe(ctx.heute)}`,
    kaufpreis: k.inputs.kaufpreis,
    kaufpreisWohnung: k.kaufpreisWohnung ?? k.inputs.kaufpreis,
    kaufpreisStellplatz: k.kaufpreisStellplatz ?? 0,
    nebenkosten: out.investition.nebenkostenEuroTotal,
    nebenkosten_notar: k.inputs.kaufpreis * k.inputs.notarPct,
    nebenkosten_grundbuch: k.inputs.kaufpreis * k.inputs.grundbuchPct,
    nebenkosten_grunderwerbsteuer: k.inputs.kaufpreis * k.inputs.grundsteuerPct,
    nebenkosten_makler: k.inputs.kaufpreis * k.inputs.maklerPct,
    nebenkosten_sonstige: k.inputs.kaufpreis * k.inputs.sonstigePct,
    renovierung: out.investition.renovierungSumme,
    renovierungWegRuecklage: out.investition.renovierungWegRuecklage,
    gik: out.investition.gik,
    fremdkapital: out.finanzierung.darlehensummeGesamt,
    eigenkapital: out.finanzierung.eigenkapital,
    cf_jahr1_zuzahlungProMonat: out.bankgespraech.cashflow_jahr_1.zuzahlungProMonat,
    cf_jahr1_zuzahlungProJahr: out.bankgespraech.cashflow_jahr_1.zuzahlungProJahr,
    cf_jahr1_rueckerstattung: out.bankgespraech.cashflow_jahr_1.rueckerstattungVomFinanzamt,
    cf_jahr1_nachSteuer: out.bankgespraech.cashflow_jahr_1.cashflowProJahrNachSteuer,
    cf_jahr1_tilgungProMonat: m.tilgung_pro_jahr[0]! / 12,
    cf_jahr1_kaltmieteMonat: m.miete_pro_jahr[0]! / 12,
    cf_jahr1_zinsMonat: -m.zinsen_pro_jahr[0]! / 12,
    cf_jahr1_nichtUmlagefaehigMonat: -(k.inputs.nichtUmlagefaehig || 0),
    cf_jahr1_einnahmenVorSteuerMonat: m.cashflow_op_jahr[0]! / 12,
    cf_jahr1_steuerrueckerstattungMonat: -m.steuern_jahr[0]! / 12,
    cf_jahr1_einnahmenNachSteuerMonat: m.cashflow_ns_jahr[0]! / 12,
    cf_jahr2_zuzahlungProMonat: out.bankgespraech.cashflow_ab_jahr_2.zuzahlungProMonat,
    cf_jahr2_zuzahlungProJahr: out.bankgespraech.cashflow_ab_jahr_2.zuzahlungProJahr,
    cf_jahr2_rueckerstattung: out.bankgespraech.cashflow_ab_jahr_2.rueckerstattungVomFinanzamt,
    cf_jahr2_nachSteuer: out.bankgespraech.cashflow_ab_jahr_2.cashflowProJahrNachSteuer,
    cf_jahr2_tilgungProMonat: m.tilgung_pro_jahr[1]! / 12,
    hv_renditeAufRestschuld: hv.restschuld > 0 ? m.miete_pro_jahr[dauerJahre - 1]! / hv.restschuld : 0,
    stellplaetzeAnzahl: k.stellplaetzeAnzahl ?? 0,
    stellplatzKaufpreis: 0,
    impressionen: ctx.bilder ?? [],
    anhaengeNamen: [],
    durchschnitt_cashflowProMonat,
    durchschnitt_tilgungProMonat,
    durchschnitt_vermoegensaufbauProMonat,
    hv_dauerJahre: dauerJahre,
    hv_verkaufspreis: hv.verkaufspreis,
    hv_restschuld: hv.restschuld,
    hv_erloes: hv.erloes,
    hv_eingesetztesEK: hv.eingesetztes_oder_entnommenes_EK,
    kumul_cashflow_summe: out.bankgespraech.kumulierterCashflow[(k.inputs.betrachtungsdauerJahre ?? 10) - 1]!,
    hv_steuerfreierVermoegenszuwachs: hv.steuerfreierVermoegenszuwachs,
    hv_eigenkapitalRenditePA: hv.nettoEKRenditePA_IRR,
    hv_mieteEndjahr: hv.mieteEndjahr,
    // Nur anzeigen, wenn ausdrücklich aktiviert.
    wertsteigerungBullets: (k.wertsteigerungSichtbar && k.wertsteigerungBullets && k.wertsteigerungBullets.length > 0)
      ? k.wertsteigerungBullets
      : [],
    disclaimer: ctx.disclaimer || DEFAULT_DISCLAIMER,
    cashflowYears,
    tax_afaProJahrTotal: afaPaTotal,
    tax_sanSofort: sanSofortTotal,
    wohnflaeche: k.objSnapshot.wohnflaecheGesamt,
    kaufpreisProQm: k.objSnapshot.wohnflaecheGesamt > 0
      ? Math.round((k.kaufpreisWohnung ?? k.inputs.kaufpreis) / k.objSnapshot.wohnflaecheGesamt)
      : 0,
    basisjahr2_zinsMonat: zinsM,
    basisjahr2_tilgungMonat: tilgungM,
    basisjahr2_nichtUmlagefaehigMonat: nuMonat,
    basisjahr2_kaltmieteMonat: kaltMonat,
    basisjahr2_einnahmenVorSteuerMonat: einnahmenVorSteuer,
    basisjahr2_steuerrueckerstattungMonat: steuernJ2Monat,
    basisjahr2_einnahmenNachSteuerMonat: einnahmenNachSteuer,
    zins: zinsAnzeige,
    tilgung: tilgungAnzeige,
    wertzuwachsPa: k.inputs.wertsteigerungJaehrlich,
    mietentwicklungPa: k.inputs.mieterhoehungJaehrlich,
    steuersatz: k.inputs.grenzsteuersatz,
    afaSatz: k.inputs.afaSatz,
    afaBemessungsgrundlage: out.investition.afaBasisLangfristig,
    ersteller: me,
    erstelltAm: datumDe(new Date(k.createdAt)),
  };
}

/**
 * Impressionen fürs Dokument: Foto-Verweise (`photo:<objektId>/<fotoId>`) und eingebettete Bilder (data:image/, Altformat).
 * Anderes (z. B. fremde URLs) fällt heraus. Höchstens 9 wie in der Vorlage.
 */
export const dokumentBilder = (refs: string[]) =>
  refs.filter((r) => /^photo:[^/\s]+\/[^/\s]+$/.test(r) || /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]*$/i.test(r)).slice(0, 9);

/** Für die Vorschau im Browser: `photo:`-Verweis → Bildadresse der API (wie resolveBildForPreview der alten App). */
export const bildFuerVorschau = (ref: string) => (ref.startsWith('photo:') ? `/api/photos/${ref.slice('photo:'.length)}` : ref);

/** Dateiname wie in der alten Route: alles außer [a-zA-Z0-9-_] wird „_“, höchstens 80 Zeichen. */
export function pdfDateiname(kalkName: string): string {
  return `${kalkName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 80)}.pdf`;
}
