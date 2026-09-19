// Portiert aus gg-immohandel src/lib/kundenKalkEngine.ts (Stand 9d693b8), fachlich unverändert.
// Änderungen nur für TypeScript strict (noUncheckedIndexedAccess). Gleichheit sichern
// test/kundenkalkulation.test.ts (übernommene Tests) und test/golden/kundenkalkulation.json.
// ──────────────────────────────────────────────────────────────
// Kundenkalkulations-Engine
// ──────────────────────────────────────────────────────────────
// Pure TypeScript-Übersetzung des Python-Prototyps
// (siehe scripts/kkalk-engine-prototype.py).
//
// Verifiziert gegen Real-Case Excel-Wahrheit:
// e2e/fixtures/kundenkalkulation/case-real-9fh.json
// → 34/35 Werte exakt (1 Diff ist Excel-Cruft, fachlich nicht relevant)
//
// Pure Function: keine Side-Effects, deterministisch, voll testbar.
// ──────────────────────────────────────────────────────────────

// ── Datenmodell ────────────────────────────────────────────

export type SanierungsModus = 'sofort' | 'aktivieren' | 'weg_ruecklage';
//  'sofort'        = vom Käufer bezahlt, Steuersofortabzug Jahr 1 (Erhaltungsaufwand)
//  'aktivieren'    = vom Käufer bezahlt, Aktivierung → erhöht AfA-Bemessungsgrundlage
//  'weg_ruecklage' = aus WEG-Instandhaltungsrücklage bezahlt: Liquidität ist WEDER
//                    Eigen- NOCH Fremdkapital (nicht in GIK, erhöht NICHT den
//                    Immobilien-Startwert), aber steuerlich SOFORT abzugsfähig Jahr 1.
//                    (User-Vorgabe 2026-06-26.)

export interface Sanierungsposten {
  label: string;
  amount: number;
  modus: SanierungsModus;
}

// ── Sanierungs-Aufteilung (Single Source of Truth) ─────────
// WICHTIG: Diese Funktion ist die EINZIGE Stelle, an der Sanierungsbeträge nach
// Modus aufgeteilt werden. Engine UND buildPdfPayload UND UI-Buttons nutzen sie,
// damit GIK, AfA-Basis, Wertbasis und Steuerabzug NIE auseinanderlaufen können.
export interface SanierungSplit {
  total: number;            // alle Posten
  investor: number;         // vom Käufer finanziert (sofort + aktivieren) → in GIK & Wertbasis
  weg: number;              // aus WEG-Rücklage → NICHT in GIK/EK/FK, NICHT in Wertbasis
  aktivieren: number;       // Teil der investor-Summe, der die AfA-Basis erhöht
  sofort: number;           // vom Käufer bezahlter Sofortabzug
  sofortAbzug: number;      // sofort + weg = im Jahr 1 sofort steuerlich abzugsfähig
}

export function splitSanierung(posten: Sanierungsposten[]): SanierungSplit {
  let total = 0, investor = 0, weg = 0, aktivieren = 0, sofort = 0;
  for (const p of posten) {
    const a = p.amount || 0;
    total += a;
    if (p.modus === 'weg_ruecklage') {
      weg += a;
    } else {
      investor += a;
      if (p.modus === 'aktivieren') aktivieren += a;
      else sofort += a;   // 'sofort' (Default)
    }
  }
  return { total, investor, weg, aktivieren, sofort, sofortAbzug: sofort + weg };
}

export interface Darlehen {
  label: string;
  summe: number;
  zinssatz: number;  // p.a. (z.B. 0.0404 für 4,04%)
  tilgung: number;   // anf. Tilgung p.a. (z.B. 0.01 für 1%)
  // Hinweis: KfW-Förderkredit-Logik (plan_overrides, sondertilgung,
  // tilgungsfreie Jahre, Tilgungszuschuss) wurde entfernt am 2026-05-01.
  // Wird in einer zukünftigen Version 2 wieder ergänzt sobald die UI
  // dafür ausgebaut ist (User-Entscheid).
}

export interface KKalkInputs {
  // Investition + Nebenkosten
  kaufpreis: number;
  notarPct: number;
  grundbuchPct: number;
  grundsteuerPct: number;
  maklerPct: number;
  sonstigePct: number;

  // Sanierung
  sanierungsposten: Sanierungsposten[];

  // Miete
  nettokaltmieteMonat: number;
  stellplatzMiete: number;
  sonstigeMiete: number;
  umlagefaehig: number;
  mieterhoehungJaehrlich: number;

  // Bewirtschaftung
  nichtUmlagefaehig: number;        // €/Monat
  kostensteigerungJaehrlich: number; // default 0.02 = 2%

  // Wertentwicklung + AfA
  wertsteigerungJaehrlich: number;
  anteilGebaeudeKaufpreis: number;
  afaSatz: number;
  afaTypDenkmal?: boolean;
  denkmalAfaBasis?: number;
  denkmalAfaSatz?: number;

  // Steuer
  grenzsteuersatz: number;

  // Finanzierung
  darlehen: Darlehen[];

  // Hochrechnungs-Dauer in vollen Jahren (Default 10 = 120 Monate)
  // Die Engine garantiert: am Ende des N-ten Jahres wird der Verkaufswert realisiert.
  betrachtungsdauerJahre?: number;
  kaufjahr?: number;

  // Wohnfläche (für KP/m²)
  wohnflaecheGesamt?: number;
}

export interface KKalkOutputs {
  investition: {
    kaufpreisProQm: number | null;
    nebenkostenEuroTotal: number;
    renovierungSumme: number;          // vom Käufer finanzierte Sanierung (in GIK)
    renovierungWegRuecklage: number;   // aus WEG-Rücklage (nicht in GIK, sofort abzugsf.)
    gik: number;
    afaBasisLangfristig: number;
    afaProJahrRegulaer: number;
    afaProJahrTotal: number;
  };
  miete: {
    nettokaltmieteMonat: number;
    warmmieteMonat: number;
    jahresmiete: number;
  };
  finanzierung: {
    darlehensummeGesamt: number;
    eigenkapital: number;
    gewichteterZinssatz: number;
    gewichteteTilgung: number;
    kapitaldienstProMonat: number;
  };
  kennzahlen_jahr_1: {
    bruttomietrendite: number;
    faktor: number;
    nettomietrendite: number;
    warmmiete: number;
    bewirtschaftung: number;
    zinsen: number;
    tilgung: number;
    cashflowOperativ: number;       // €/Monat (Cockpit Q23)
  };
  kennzahlen_zukunft: {
    zieljahr: number;
    jahresmiete: number;
    wertImmobilie: number;
    warmmiete: number;
    bewirtschaftung: number;
    zinsen: number;
    tilgung: number;
    cashflowOperativ: number;
  };
  profikennzahlen: {
    wertImmobilie: number;
    minusRestschuld: number;
    minusEigenkapitalEinsatz: number;
    plusKumulierterCashflow: number;
    vermoegenszuwachsTotal: number;
    beleihungsreserve: number;
  };
  bankgespraech: {
    cashflow_jahr_1: {
      zuzahlungProMonat: number;
      zuzahlungProJahr: number;
      rueckerstattungVomFinanzamt: number;
      cashflowProJahrNachSteuer: number;
    };
    cashflow_ab_jahr_2: {
      zuzahlungProMonat: number;
      zuzahlungProJahr: number;
      rueckerstattungVomFinanzamt: number;
      cashflowProJahrNachSteuer: number;
    };
    /** kumulierter Cashflow nach Steuern, Jahr 1-50 */
    kumulierterCashflow: number[];
    hochrechnungVerkauf: {
      zieljahr: number;
      verkaufspreis: number;
      restschuld: number;
      erloes: number;
      eingesetztes_oder_entnommenes_EK: number;
      steuerfreierVermoegenszuwachs: number;
      nettoEKRenditePA_IRR: number | null;
      mieteEndjahr: number;
    };
  };
  /** Zwischenwerte für Charts + Debug. 50 Jahre lang. */
  matrix: {
    miete_pro_jahr: number[];
    wert_pro_jahr: number[];
    zinsen_pro_jahr: number[];
    tilgung_pro_jahr: number[];
    restschuld_pro_jahr: number[];
    cashflow_op_jahr: number[];
    cashflow_ns_jahr: number[];
    steuern_jahr: number[];
  };
}

// ── Engine ─────────────────────────────────────────────────

export function computeKKalk(inputs: KKalkInputs): KKalkOutputs {
  const YEARS = 50;

  // ── 1. Investition + Nebenkosten ────────────────────────
  const kp = inputs.kaufpreis;
  const nkPct = inputs.notarPct + inputs.grundbuchPct + inputs.grundsteuerPct
                 + inputs.maklerPct + inputs.sonstigePct;
  const nkEur = kp * nkPct;
  // Sanierungs-Aufteilung über den zentralen Helper (Single Source of Truth).
  // san.investor = vom Käufer finanziert (sofort + aktivieren) → in GIK & Wertbasis
  // san.weg      = aus WEG-Rücklage → NICHT in GIK/EK/FK, NICHT in Wertbasis
  // san.aktivieren = erhöht AfA-Basis;  san.sofortAbzug = sofort + weg (Jahr-1-Abzug)
  const san = splitSanierung(inputs.sanierungsposten);
  const gik = kp + nkEur + san.investor;   // WEG-Sanierung bewusst NICHT in GIK
  const kpQm = inputs.wohnflaecheGesamt ? kp / inputs.wohnflaecheGesamt : null;

  // ── 2. AfA-Basis ───────────────────────────────────────
  // Excel H22 = anteilGebäude × (kp + nk) + Σ aktivierte Sanierung
  // (WEG-Sanierung ist sofort abzugsfähig → NICHT aktiviert → nicht in der AfA-Basis)
  let afaBasisLangfr = inputs.anteilGebaeudeKaufpreis * (kp + nkEur) + san.aktivieren;
  if (inputs.afaTypDenkmal && inputs.denkmalAfaBasis) {
    afaBasisLangfr -= inputs.denkmalAfaBasis;
  }
  const afaPaRegulaer = afaBasisLangfr * inputs.afaSatz;
  const afaPaDenkmal = (inputs.afaTypDenkmal && inputs.denkmalAfaBasis && inputs.denkmalAfaSatz)
    ? inputs.denkmalAfaBasis * inputs.denkmalAfaSatz
    : 0;
  const afaPaTotal = afaPaRegulaer + afaPaDenkmal;

  // ── 3. Eigenkapital ───────────────────────────────────
  const darlehenTotal = inputs.darlehen.reduce((s, d) => s + d.summe, 0);
  const eigenkapital = gik - darlehenTotal;

  // ── 4. Gewichtete Finanzierungs-Kennzahlen ─────────────
  const zinsGewichtet = darlehenTotal > 0
    ? inputs.darlehen.reduce((s, d) => s + d.summe * d.zinssatz, 0) / darlehenTotal
    : 0;
  const tilgGewichtet = darlehenTotal > 0
    ? inputs.darlehen.reduce((s, d) => s + d.summe * d.tilgung, 0) / darlehenTotal
    : 0;
  const kapitaldienstMo = inputs.darlehen.reduce(
    (s, d) => s + d.summe * (d.zinssatz + d.tilgung) / 12,
    0
  );

  // ── 5. Tilgungsplan pro Tranche, mit Plan-Overrides ────
  const zinsenProJahr = new Array<number>(YEARS).fill(0);
  const tilgungProJahr = new Array<number>(YEARS).fill(0);
  const restschuldProJahr = new Array<number>(YEARS).fill(0);

  // Annuitätentilgung pro Tranche, konstante Annuität.
  // (KfW-spezifische Sonderlogik mit plan_overrides/sondertilgung/tilgungsfreien
  //  Jahren wurde am 2026-05-01 entfernt — kommt in V2 wieder.)
  for (const d of inputs.darlehen) {
    let rs = d.summe;
    const tilgJahr1 = d.tilgung * rs;
    const annuitaet = rs * d.zinssatz + tilgJahr1;

    for (let y = 0; y < YEARS; y++) {
      if (rs <= 0) break;
      const zinsY = rs * d.zinssatz;
      const tilgY = (y === 0)
        ? tilgJahr1
        : Math.min(rs, Math.max(annuitaet - zinsY, 0));
      zinsenProJahr[y] = zinsenProJahr[y]! + zinsY;
      tilgungProJahr[y] = tilgungProJahr[y]! + tilgY;
      rs = Math.max(rs - tilgY, 0);
      restschuldProJahr[y] = restschuldProJahr[y]! + rs;
    }
  }

  // ── 6. Mietverlauf (50 Jahre) ──────────────────────────
  const monatsmieteBasis = inputs.nettokaltmieteMonat + inputs.stellplatzMiete + inputs.sonstigeMiete;
  const mieteProJahr = new Array<number>(YEARS).fill(0).map((_, y) =>
    12 * monatsmieteBasis * Math.pow(1 + inputs.mieterhoehungJaehrlich, y)
  );

  // ── 7. Wertverlauf (50 Jahre) ──────────────────────────
  // Konvention: wertProJahr[y] = Wert am ENDE des (y+1)-ten Jahres.
  // y=0 = Ende Jahr 1 = wertAnfang × (1+w)^1
  // y=9 = Ende Jahr 10 = wertAnfang × (1+w)^10  ← bei 10 Jahren Haltedauer Verkaufswert
  // WEG-Sanierung erhöht den Startwert NICHT (User-Vorgabe 2026-06-26): der Käufer
  // hat sie nicht aus eigener Liquidität bezahlt → nur san.investor zählt zur Wertbasis.
  const wertAnfang = kp + san.investor;
  const wertProJahr = new Array<number>(YEARS).fill(0).map((_, y) =>
    wertAnfang * Math.pow(1 + inputs.wertsteigerungJaehrlich, y + 1)
  );

  // ── 8. Cashflow-Berechnung pro Jahr ────────────────────
  const cashflowOpJahr = new Array<number>(YEARS).fill(0);
  const cashflowNsJahr = new Array<number>(YEARS).fill(0);
  const steuernJahr = new Array<number>(YEARS).fill(0);

  const bewirtBasisPa = -12 * inputs.nichtUmlagefaehig;
  // Sanierungskosten werden NICHT als operativer Cashflow im Jahr 1 verbucht.
  // Käufer-finanzierte Sanierung (sofort/aktivieren) ist Teil der Initial-Investition
  // (in GIK enthalten) und wird über EK + FK finanziert.
  // WEG-Rücklagen-Sanierung wird vom Käufer gar nicht bezahlt (Liquidität aus der
  // Rücklage) → ebenfalls KEIN operativer Cashflow.
  // (User-Entscheid 2026-05-01 / 2026-06-26.)
  //
  // Steuer-Effekt (Jahr 1): Sofort-Sanierung UND WEG-Sanierung senken als
  // Werbungskosten das zu versteuernde Einkommen → erhöhen die Erstattung
  // (san.sofortAbzug). Aktivierte Sanierung wirkt über die AfA-Basis.

  for (let y = 0; y < YEARS; y++) {
    const miete = mieteProJahr[y]!;
    const bewirtY = bewirtBasisPa * Math.pow(1 + inputs.kostensteigerungJaehrlich, y);
    const zinsY = -zinsenProJahr[y]!;
    const tilgY = -tilgungProJahr[y]!;

    cashflowOpJahr[y] = miete + bewirtY + zinsY + tilgY;

    let zuVersteuern = miete + bewirtY + zinsY - afaPaTotal;
    // Sofort abzugsfähig in Jahr 1: vom Käufer bezahlte Sofort-Sanierung PLUS
    // die aus WEG-Rücklage bezahlte Sanierung (User-Vorgabe: "trotzdem sofort
    // abschreibefähig"). Beide senken das zu versteuernde Einkommen Jahr 1.
    if (y === 0) zuVersteuern -= san.sofortAbzug;

    const steuer = zuVersteuern * inputs.grenzsteuersatz;
    steuernJahr[y] = steuer;
    cashflowNsJahr[y] = cashflowOpJahr[y]! - steuer;
  }

  // ── 9. Standard-Kennzahlen Jahr 1 (= Cockpit Q23, ohne Sofort/Förderkredit) ──
  const standardCfOpJahr1Mo = (mieteProJahr[0]! + bewirtBasisPa - zinsenProJahr[0]! - tilgungProJahr[0]!) / 12;

  // ── 10. Kumulierter Cashflow nach Steuern ──────────────
  const kumulCfNs: number[] = [];
  let acc = 0;
  for (const cf of cashflowNsJahr) {
    acc += cf;
    kumulCfNs.push(acc);
  }

  // ── 11. Hochrechnung Verkauf ────────────────────────────
  // Betrachtungsdauer in Jahren (Default 10).
  // zielIdx = N-1 (0-indexed): wertProJahr[N-1] = Wert am ENDE des N-ten Jahres
  // (= nach 12·N Monaten Wertentwicklung mit (1+w)^N hochgerechnet, weil
  // wertProJahr[y] = wertAnfang × (1+w)^(y+1)).
  const kaufjahr = inputs.kaufjahr ?? new Date().getFullYear();
  // Die Betrachtungsdauer zählt Jahre und indiziert damit die Jahresreihen.
  // Ungerundet oder über YEARS hinaus bricht beides still:
  //   10,5  → zielIdx 9,5 → wertProJahr[9,5]! ist undefined → im PDF steht NaN €,
  //           während das Eingabefeld unverändert „11" anzeigt
  //   60    → zielIdx klemmt auf 49, zieljahr nicht: das Bank-PDF beschriftet
  //           Werte aus Jahr 50 als „Hochrechnung in 60 Jahren", und die
  //           IRR-Schleife liest über das Ende der Reihen hinaus
  // Deshalb hier, an der einen Stelle, auf ganze Jahre im gültigen Bereich.
  const dauerJahre = Math.min(YEARS, Math.max(1, Math.round(inputs.betrachtungsdauerJahre ?? 10) || 10));
  const zieljahr = kaufjahr + dauerJahre;
  const zielIdx = Math.max(0, Math.min(dauerJahre - 1, YEARS - 1));
  const verkaufspreis = wertProJahr[zielIdx]!;
  const restschuldZiel = restschuldProJahr[zielIdx]!;
  const erloes = verkaufspreis - restschuldZiel;
  // "Eingesetztes EK"-Anzeige bleibt zur Diagnose: -EK + Σ Cashflow n.St.
  // (negativ = mehr Geld eingesetzt; positiv = Geld zurück bekommen)
  const eingesetztesEK = -eigenkapital + kumulCfNs[zielIdx]!;
  // Vermögenszuwachs = TOTAL RETURN (mathematisch korrekt, User-Entscheid 2026-05-01).
  //   = Verkaufserlös + Σ Cashflow n.St. − initial eingesetztes EK
  // Vorher Excel-Formel `erloes - eingesetztesEK` hatte ein Vorzeichen-Paradox:
  // Sofort-Sanierung mit höherer Steuererstattung zeigte fälschlich KLEINEREN
  // Vermögenszuwachs als aktivierte Sanierung. Audit bestätigte: Total Return ist
  // wirtschaftlich korrekt → sofort um die zusätzliche Steuerersparnis besser.
  const steuerfreierVermoegenszuwachs = erloes + kumulCfNs[zielIdx]! - eigenkapital;
  const mieteEndjahr = mieteProJahr[zielIdx]! / 12;

  // IRR-Berechnung — TEXTBOOK-Periodisierung:
  //   Periode 0 = heute (Anfangsinvestition)             → -EK
  //   Periode 1 = Ende Jahr 1                            → cashflowNsJahr[0]!
  //   Periode N = Ende Jahr N (Verkauf + letztes Jahres) → cashflowNsJahr[N-1]! + (Verkaufspreis - Restschuld)
  // (Vorher: cfNs[0] auf Periode 0 → +0,4 bis +0,6 pp Überschätzung der EK-Rendite. Fix: 2026-05-01)
  const irrReihe: number[] = [-eigenkapital];
  for (let i = 0; i < dauerJahre; i++) {
    let v = cashflowNsJahr[i]!;
    if (i === dauerJahre - 1) v += verkaufspreis - restschuldZiel;
    irrReihe.push(v);
  }
  const irr = computeIRR(irrReihe);

  // ── 12. Output zusammenstellen ──────────────────────────
  return {
    investition: {
      kaufpreisProQm: kpQm,
      nebenkostenEuroTotal: nkEur,
      renovierungSumme: san.investor,          // in GIK enthaltene (käuferfinanzierte) Sanierung
      renovierungWegRuecklage: san.weg,        // aus WEG-Rücklage (separat, nicht in GIK)
      gik,
      afaBasisLangfristig: afaBasisLangfr,
      afaProJahrRegulaer: afaPaRegulaer,
      afaProJahrTotal: afaPaTotal,
    },
    miete: {
      nettokaltmieteMonat: monatsmieteBasis,
      warmmieteMonat: monatsmieteBasis + inputs.umlagefaehig,
      jahresmiete: mieteProJahr[0]!,
    },
    finanzierung: {
      darlehensummeGesamt: darlehenTotal,
      eigenkapital,
      gewichteterZinssatz: zinsGewichtet,
      gewichteteTilgung: tilgGewichtet,
      kapitaldienstProMonat: kapitaldienstMo,
    },
    kennzahlen_jahr_1: {
      bruttomietrendite: kp > 0 ? mieteProJahr[0]! / kp : 0,
      faktor: mieteProJahr[0]! > 0 ? kp / mieteProJahr[0]! : 0,
      nettomietrendite: gik > 0 ? (mieteProJahr[0]! + bewirtBasisPa) / gik : 0,
      warmmiete: monatsmieteBasis,
      bewirtschaftung: -inputs.nichtUmlagefaehig,
      zinsen: -zinsenProJahr[0]! / 12,
      tilgung: -tilgungProJahr[0]! / 12,
      cashflowOperativ: standardCfOpJahr1Mo,
    },
    kennzahlen_zukunft: {
      zieljahr,
      jahresmiete: mieteProJahr[zielIdx]!,
      wertImmobilie: verkaufspreis,
      warmmiete: mieteProJahr[zielIdx]! / 12,
      bewirtschaftung: bewirtBasisPa * Math.pow(1 + inputs.kostensteigerungJaehrlich, zielIdx) / 12,
      zinsen: -zinsenProJahr[zielIdx]! / 12,
      tilgung: -tilgungProJahr[zielIdx]! / 12,
      cashflowOperativ: (mieteProJahr[zielIdx]!
                        + bewirtBasisPa * Math.pow(1 + inputs.kostensteigerungJaehrlich, zielIdx)
                        - zinsenProJahr[zielIdx]!
                        - tilgungProJahr[zielIdx]!) / 12,
    },
    profikennzahlen: {
      wertImmobilie: verkaufspreis,
      minusRestschuld: -restschuldZiel,
      minusEigenkapitalEinsatz: -eigenkapital,
      plusKumulierterCashflow: kumulCfNs[zielIdx]!,
      vermoegenszuwachsTotal: verkaufspreis - restschuldZiel - eigenkapital + kumulCfNs[zielIdx]!,
      beleihungsreserve: erloes,
    },
    bankgespraech: {
      cashflow_jahr_1: {
        zuzahlungProMonat: cashflowOpJahr[0]! / 12,
        zuzahlungProJahr: cashflowOpJahr[0]!,
        rueckerstattungVomFinanzamt: -steuernJahr[0]!,
        cashflowProJahrNachSteuer: cashflowNsJahr[0]!,
      },
      cashflow_ab_jahr_2: {
        zuzahlungProMonat: cashflowOpJahr[1]! / 12,
        zuzahlungProJahr: cashflowOpJahr[1]!,
        rueckerstattungVomFinanzamt: -steuernJahr[1]!,
        cashflowProJahrNachSteuer: cashflowNsJahr[1]!,
      },
      kumulierterCashflow: kumulCfNs,
      hochrechnungVerkauf: {
        zieljahr,
        verkaufspreis,
        restschuld: restschuldZiel,
        erloes,
        eingesetztes_oder_entnommenes_EK: eingesetztesEK,
        steuerfreierVermoegenszuwachs,
        nettoEKRenditePA_IRR: irr,
        mieteEndjahr,
      },
    },
    matrix: {
      miete_pro_jahr: mieteProJahr,
      wert_pro_jahr: wertProJahr,
      zinsen_pro_jahr: zinsenProJahr,
      tilgung_pro_jahr: tilgungProJahr,
      restschuld_pro_jahr: restschuldProJahr,
      cashflow_op_jahr: cashflowOpJahr,
      cashflow_ns_jahr: cashflowNsJahr,
      steuern_jahr: steuernJahr,
    },
  };
}

// ── IRR via Newton-Raphson ─────────────────────────────────

export function computeIRR(cashflows: number[], guess = 0.1, tol = 1e-7, maxIter = 100): number | null {
  let r = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    let npv = 0, dnpv = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const denom = Math.pow(1 + r, i);
      npv += cashflows[i]! / denom;
      dnpv += -i * cashflows[i]! / (denom * (1 + r));
    }
    if (Math.abs(npv) < tol) return r;
    if (Math.abs(dnpv) < 1e-12) return null;
    let rNew = r - npv / dnpv;
    if (rNew < -0.99) rNew = -0.99;
    if (Math.abs(rNew - r) < tol) return rNew;
    r = rNew;
  }
  return null;  // Konvergiert nicht
}
