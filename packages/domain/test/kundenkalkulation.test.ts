// Übernommen aus gg-immohandel src/lib/kundenKalkEngine.test.ts (Stand 9d693b8).
// ──────────────────────────────────────────────────────────────
// Kundenkalkulations-Engine — Goldene Tests gegen Excel-Wahrheit
// ──────────────────────────────────────────────────────────────
//
// Alle Werte sind aus echten Excel-Dateien extrahiert
// (siehe e2e/fixtures/kundenkalkulation/*.json).
//
// HAFTUNGS-BRÜCKE: Solange diese Tests grün sind, ist die Engine
// bewiesen-äquivalent zum Excel-Tool. Wenn sie rot werden, ist die
// Engine nicht mehr für Investor-Pitches verwendbar.
// ──────────────────────────────────────────────────────────────

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { computeKKalk, computeIRR, splitSanierung, type KKalkInputs, type Sanierungsposten } from '../src/kundenkalkulation/engine.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/kundenkalkulation');

interface FixtureJson {
  case_id: string | number;
  name: string;
  scope: 'global' | 'aufteiler';
  objSnapshot: { wohnflaecheGesamt: number };
  inputs: any;  // tolerant gegen JSON-Doc-Felder mit _comment_*
  expected: any;
}

function loadFixture(filename: string): FixtureJson {
  const p = path.join(FIXTURES_DIR, filename);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inputsFromFixture(f: FixtureJson): KKalkInputs {
  const i = f.inputs;
  return {
    kaufpreis: i.kaufpreis,
    notarPct: i.notarPct,
    grundbuchPct: i.grundbuchPct,
    grundsteuerPct: i.grundsteuerPct,
    maklerPct: i.maklerPct,
    sonstigePct: i.sonstigePct,
    sanierungsposten: (i.sanierungsposten ?? []) as Sanierungsposten[],
    nettokaltmieteMonat: i.nettokaltmieteMonat,
    stellplatzMiete: i.stellplatzMiete ?? 0,
    sonstigeMiete: i.sonstigeMiete ?? 0,
    umlagefaehig: i.umlagefaehig ?? 0,
    mieterhoehungJaehrlich: i.mieterhoehungJaehrlich ?? 0.02,
    nichtUmlagefaehig: i.nichtUmlagefaehig ?? i.sonstigeNichtUmlagefaehig ?? 0,
    kostensteigerungJaehrlich: i.kostensteigerungJaehrlich ?? 0.02,
    wertsteigerungJaehrlich: i.wertsteigerungJaehrlich ?? 0.02,
    anteilGebaeudeKaufpreis: i.anteilGebaeudeKaufpreis ?? 0.7,
    afaSatz: i.afaSatz ?? 0.02,
    afaTypDenkmal: i.afaTypDenkmal ?? false,
    denkmalAfaBasis: i.denkmalAfaBasis,
    denkmalAfaSatz: i.denkmalAfaSatz,
    grenzsteuersatz: i.grenzsteuersatz,
    darlehen: i.darlehen,
    // Backward-compat: alte Fixtures nutzen 'zieljahr', neue 'betrachtungsdauerJahre'
    betrachtungsdauerJahre: i.betrachtungsdauerJahre ?? (i.zieljahr ? i.zieljahr - 2025 : 10),
    kaufjahr: 2025,
    wohnflaecheGesamt: f.objSnapshot.wohnflaecheGesamt,
  };
}

// ── Test-Helper: assertions mit Toleranz ──────────────────

function expectClose(actual: number, expected: number, tol: number, label = '') {
  const diff = Math.abs(actual - expected);
  expect(diff, `${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}, diff ${diff.toFixed(4)} > tol ${tol}`).toBeLessThanOrEqual(tol);
}

// ── REAL-CASE: 9-Familienhaus mit Komplettsanierung ────────

describe('Goldener Test: Real-Case 9-Familienhaus (komplexester Case)', () => {
  const fixture = loadFixture('case-real-9fh.json');
  const inputs = inputsFromFixture(fixture);
  const exp = fixture.expected;
  const TOL_EUR = 1.0;
  const TOL_PCT = 0.0001;

  const result = computeKKalk(inputs);

  test('Investition: GIK + Nebenkosten + AfA-Basis', () => {
    expectClose(result.investition.gik, exp.investition.gik, TOL_EUR, 'GIK');
    expectClose(result.investition.nebenkostenEuroTotal, exp.investition.nebenkostenEuroTotal, TOL_EUR, 'Nebenkosten');
    expectClose(result.investition.afaBasisLangfristig, exp.investition.afaBasisLangfristig, TOL_EUR, 'AfA-Basis');
  });

  test('Finanzierung: 3 Tranchen, gewichtete Werte', () => {
    expectClose(result.finanzierung.darlehensummeGesamt, exp.finanzierung.darlehensummeGesamt, TOL_EUR);
    expectClose(result.finanzierung.eigenkapital, exp.finanzierung.eigenkapital, TOL_EUR);
    expectClose(result.finanzierung.gewichteterZinssatz, exp.finanzierung.gewichteterZinssatz, TOL_PCT);
    expectClose(result.finanzierung.gewichteteTilgung, exp.finanzierung.gewichteteTilgung, TOL_PCT);
    expectClose(result.finanzierung.kapitaldienstProMonat, exp.finanzierung.kapitaldienstProMonat, TOL_EUR);
  });

  test('Kennzahlen Jahr 1: Renditen + Cashflow', () => {
    expectClose(result.kennzahlen_jahr_1.bruttomietrendite, exp.kennzahlen_jahr_1.bruttomietrendite, TOL_PCT);
    expectClose(result.kennzahlen_jahr_1.nettomietrendite, exp.kennzahlen_jahr_1.nettomietrendite, TOL_PCT);
    expectClose(result.kennzahlen_jahr_1.cashflowOperativ, exp.kennzahlen_jahr_1.cashflowOperativ, TOL_EUR);
  });

  // Wertberechnungs-Basis: Engine nutzt wertAnfang = Kaufpreis + Σ Sanierung
  // (NICHT GIK — Nebenkosten werden nicht wertgesteigert).
  // Real-Case: 1.550.000 + 896.800 = 2.446.800
  const WERT_ANFANG = 1550000 + 896800;

  test('Kennzahlen Zukunft nach 10 Jahren: Wert (mathematisch sauber)', () => {
    // Engine: wertProJahr[y] = wertAnfang × (1+w)^(y+1)
    // 10 Jahre Haltedauer → zielIdx = 9 → wertAnfang × 1.02^10
    const wertSauber = WERT_ANFANG * Math.pow(1.02, 10);
    expectClose(result.kennzahlen_zukunft.wertImmobilie, wertSauber, TOL_EUR, 'Wert nach 10 Jahren');
  });

  test('Profi-Kennzahlen: Verkaufswert nach 10 Jahren', () => {
    const wertSauber = WERT_ANFANG * Math.pow(1.02, 10);
    expectClose(result.profikennzahlen.wertImmobilie, wertSauber, TOL_EUR);
    expect(result.profikennzahlen.vermoegenszuwachsTotal).toBeGreaterThan(0);
  });

  test('Bankgespräch — Cashflow Jahr 1 stabil (Engine als Wahrheit nach 2026-05-01)', () => {
    // HINWEIS: Die alten Excel-Erwartungswerte (-21.018 € Zuzahlung J1) sind seit
    // der Engine-Vereinfachung nicht mehr direkt anwendbar. Die alte Excel-Logik
    // hatte: Sanierung als Cashflow J1 + KfW-Plan-Overrides + Sondertilgung 185k.
    // Neue Engine: Sanierung ist Initial-Investition, KfW-Spezifika kommen in V2.
    // Dieser Test sichert die NEUE Engine als Regression-Anker — Werte stammen
    // aus dem ersten Run nach der Vereinfachung am 2026-05-01.
    const cf1 = result.bankgespraech.cashflow_jahr_1;
    // Operativer Cashflow J1 = Miete - Bewirt - Zinsen - Tilgung (keine Sanierung mehr)
    expect(cf1.zuzahlungProJahr).toBeGreaterThan(-15000);
    expect(cf1.zuzahlungProJahr).toBeLessThan(0);
    // Rückerstattung Finanzamt: Sofort-Sanierung 887k senkt zu versteuerndes
    // Einkommen drastisch → hohe Erstattung, hier ~408k bei 45% Steuersatz
    expect(cf1.rueckerstattungVomFinanzamt).toBeGreaterThan(390000);
    expect(cf1.rueckerstattungVomFinanzamt).toBeLessThan(420000);
    // CF n. St. = CF op + Erstattung
    expect(cf1.cashflowProJahrNachSteuer).toBeGreaterThan(380000);
  });

  test('Bankgespräch — Kumulierter Cashflow nach 10 Jahren positiv (durch Sofort-Sanierung)', () => {
    // Sofort-Sanierung 887k erzeugt im J1 massive Steuererstattung (~408k)
    // → kumul. CF bleibt über alle 10 Jahre positiv, auch nach den negativen
    // Folge-Jahren mit normaler Bewirtschaftung.
    const kumul = result.bankgespraech.kumulierterCashflow;
    expect(kumul[0]).toBeGreaterThan(380000);   // J1
    expect(kumul[9]).toBeGreaterThan(300000);   // J10 immer noch positiv
  });

  test('Bankgespräch — Hochrechnung Verkauf nach 10 Jahren (mathematisch sauber)', () => {
    const got = result.bankgespraech.hochrechnungVerkauf;
    const verkaufSauber = WERT_ANFANG * Math.pow(1.02, 10);
    expectClose(got.verkaufspreis, verkaufSauber, TOL_EUR);
    expect(got.erloes).toBeGreaterThan(0);
    expect(got.restschuld).toBeLessThan(2295500);
    // Miete Endjahr = Monatsmiete × (1+m)^9 (Index 9 = Ende Jahr 10)
    const mieteSauber = 8369 * Math.pow(1.02, 9);
    expectClose(got.mieteEndjahr, mieteSauber, TOL_EUR);
  });
});

// ── WEG-Rücklagen-Sanierung (User-Vorgabe 2026-06-26) ──────
// Neue Sanierungs-Option: aus WEG-Instandhaltungsrücklage bezahlt.
//   - weder Eigen- noch Fremdkapital → NICHT in GIK
//   - erhöht den Immobilien-Startwert NICHT
//   - aber steuerlich SOFORT abzugsfähig im Jahr 1
//
// HAFTUNG: Jeder Erwartungswert ist hier per Hand gerechnet und dokumentiert.

describe('splitSanierung — zentraler Aufteilungs-Helper (Single Source of Truth)', () => {
  test('teilt nach Modus korrekt auf', () => {
    const s = splitSanierung([
      { label: 'A', amount: 10000, modus: 'sofort' },
      { label: 'B', amount: 20000, modus: 'weg_ruecklage' },
      { label: 'C', amount: 5000, modus: 'aktivieren' },
    ]);
    expect(s.total).toBe(35000);
    expect(s.investor).toBe(15000);      // sofort + aktivieren (käuferfinanziert)
    expect(s.weg).toBe(20000);           // WEG-Rücklage
    expect(s.aktivieren).toBe(5000);     // → AfA-Basis
    expect(s.sofort).toBe(10000);        // käufer-Sofortabzug
    expect(s.sofortAbzug).toBe(30000);   // sofort + weg = Jahr-1-Abzug
  });

  test('leere Liste → alles 0', () => {
    const s = splitSanierung([]);
    expect(s).toEqual({ total: 0, investor: 0, weg: 0, aktivieren: 0, sofort: 0, sofortAbzug: 0 });
  });
});

describe('WEG-Rücklagen-Sanierung: handverifizierte Werte', () => {
  // Basis-Szenario (bewusst einfach für exakte Handrechnung):
  //   kp=300.000, notar 2% → NK=6.000, sonst 0% NK
  //   Miete 1.000 €/Mo → 12.000 €/Jahr (keine Steigerung)
  //   keine Bewirtschaftung, 0% Wertsteigerung, kein Darlehen
  //   anteilGebäude 70%, AfA 2%, Steuersatz 42%
  //   Haltedauer 1 Jahr
  const base = {
    kaufpreis: 300000,
    notarPct: 0.02, grundbuchPct: 0, grundsteuerPct: 0, maklerPct: 0, sonstigePct: 0,
    nettokaltmieteMonat: 1000, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
    mieterhoehungJaehrlich: 0, nichtUmlagefaehig: 0, kostensteigerungJaehrlich: 0,
    wertsteigerungJaehrlich: 0,
    anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02,
    grenzsteuersatz: 0.42,
    darlehen: [] as any[],
    betrachtungsdauerJahre: 1, kaufjahr: 2025, wohnflaecheGesamt: 100,
  };
  const TOL = 0.01;

  const weg = computeKKalk({ ...base, sanierungsposten: [{ label: 'Dach', amount: 20000, modus: 'weg_ruecklage' }] });

  test('GIK schließt WEG-Sanierung aus: 300.000 + 6.000 = 306.000', () => {
    expectClose(weg.investition.gik, 306000, TOL, 'GIK');
    expectClose(weg.investition.renovierungSumme, 0, TOL, 'renovierungSumme (käuferfinanziert)');
    expectClose(weg.investition.renovierungWegRuecklage, 20000, TOL, 'renovierungWegRuecklage');
  });

  test('Eigenkapital schließt WEG-Sanierung aus (kein Darlehen): 306.000', () => {
    expectClose(weg.finanzierung.eigenkapital, 306000, TOL, 'EK');
  });

  test('AfA-Basis enthält WEG-Sanierung NICHT: 0,7 × 306.000 = 214.200; AfA p.a. = 4.284', () => {
    expectClose(weg.investition.afaBasisLangfristig, 214200, TOL, 'AfA-Basis');
    expectClose(weg.investition.afaProJahrTotal, 4284, TOL, 'AfA p.a.');
  });

  test('Immobilien-Startwert OHNE WEG: Verkaufspreis nach 1 J (0% Wertsteig.) = 300.000', () => {
    expectClose(weg.bankgespraech.hochrechnungVerkauf.verkaufspreis, 300000, TOL, 'Verkaufspreis');
  });

  test('Steuer Jahr 1: zu verst. = 12.000 − 4.284 − 20.000 = −12.284 → Erstattung 5.159,28', () => {
    // steuern_jahr negativ = Erstattung
    expectClose(weg.matrix.steuern_jahr[0]!, -5159.28, TOL, 'Steuer J1');
    expectClose(-weg.bankgespraech.cashflow_jahr_1.rueckerstattungVomFinanzamt * -1, 5159.28, TOL, 'Erstattung J1');
  });

  test('Operativer Cashflow J1 = nur Miete (WEG zahlt Käufer nicht): 12.000', () => {
    expectClose(weg.matrix.cashflow_op_jahr[0]!, 12000, TOL, 'CF op J1');
  });

  test('Cashflow nach Steuern J1 = 12.000 + 5.159,28 = 17.159,28', () => {
    expectClose(weg.matrix.cashflow_ns_jahr[0]!, 17159.28, TOL, 'CF n.St. J1');
  });

  test('Steuerfreier Vermögenszuwachs = 300.000 + 17.159,28 − 306.000 = 11.159,28', () => {
    expectClose(weg.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs, 11159.28, TOL, 'Vermögenszuwachs');
  });

  test('IRR = 317.159,28 / 306.000 − 1 = 3,6468 %', () => {
    const irr = weg.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR;
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 0.0364682, 0.0001, 'IRR');
  });

  // ── Vergleich identisches Szenario, nur Modus unterschiedlich ──
  const sofort = computeKKalk({ ...base, sanierungsposten: [{ label: 'Dach', amount: 20000, modus: 'sofort' }] });
  const aktiv = computeKKalk({ ...base, sanierungsposten: [{ label: 'Dach', amount: 20000, modus: 'aktivieren' }] });

  test('Vergleich GIK: sofort/aktivieren enthalten Sanierung (326.000), WEG nicht (306.000)', () => {
    expectClose(sofort.investition.gik, 326000, TOL, 'GIK sofort');
    expectClose(aktiv.investition.gik, 326000, TOL, 'GIK aktiv');
    expectClose(weg.investition.gik, 306000, TOL, 'GIK weg');
  });

  test('Vergleich Verkaufspreis: sofort/aktiv erhöhen Startwert (320.000), WEG nicht (300.000)', () => {
    expectClose(sofort.bankgespraech.hochrechnungVerkauf.verkaufspreis, 320000, TOL, 'VK sofort');
    expectClose(aktiv.bankgespraech.hochrechnungVerkauf.verkaufspreis, 320000, TOL, 'VK aktiv');
    expectClose(weg.bankgespraech.hochrechnungVerkauf.verkaufspreis, 300000, TOL, 'VK weg');
  });

  test('Steuer J1: WEG identisch zu sofort (−5.159,28), aktiv positiv (+3.072,72)', () => {
    expectClose(weg.matrix.steuern_jahr[0]!, -5159.28, TOL, 'Steuer weg');
    expectClose(sofort.matrix.steuern_jahr[0]!, -5159.28, TOL, 'Steuer sofort');
    // aktiv: (12.000 − 4.684) × 42% = 7.316 × 0,42 = 3.072,72 (AfA-Basis 234.200 → AfA 4.684)
    expectClose(aktiv.investition.afaProJahrTotal, 4684, TOL, 'AfA aktiv');
    expectClose(aktiv.matrix.steuern_jahr[0]!, 3072.72, TOL, 'Steuer aktiv');
  });

  test('Vermögenszuwachs: WEG == sofort bei 0% Wertsteig. (11.159,28), beide > aktiv (2.927,28)', () => {
    const vWeg = weg.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs;
    const vSofort = sofort.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs;
    const vAktiv = aktiv.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs;
    expectClose(vWeg, 11159.28, TOL, 'V weg');
    expectClose(vSofort, 11159.28, TOL, 'V sofort');
    expectClose(vAktiv, 2927.28, TOL, 'V aktiv');
    expect(vWeg).toBeGreaterThan(vAktiv);
  });

  test('IRR: WEG (3,6468 %) > sofort (3,4231 %) — gleiche Wirkung mit weniger EK', () => {
    const iWeg = weg.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR!;
    const iSofort = sofort.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR!;
    expectClose(iWeg, 0.0364682, 0.0001, 'IRR weg');
    expectClose(iSofort, 0.0342310, 0.0001, 'IRR sofort');
    expect(iWeg).toBeGreaterThan(iSofort);
  });

  // ── Gemischtes Szenario ──
  test('Gemischt [sofort 10k + weg 20k + aktivieren 5k]: alle Aggregate korrekt', () => {
    const mix = computeKKalk({
      ...base,
      sanierungsposten: [
        { label: 'S', amount: 10000, modus: 'sofort' },
        { label: 'W', amount: 20000, modus: 'weg_ruecklage' },
        { label: 'A', amount: 5000, modus: 'aktivieren' },
      ],
    });
    // GIK = 300.000 + 6.000 + investor(15.000) = 321.000
    expectClose(mix.investition.gik, 321000, TOL, 'GIK mix');
    expectClose(mix.investition.renovierungSumme, 15000, TOL, 'renovierungSumme mix');
    expectClose(mix.investition.renovierungWegRuecklage, 20000, TOL, 'WEG mix');
    // AfA-Basis = 0,7 × 306.000 + aktivieren(5.000) = 219.200
    expectClose(mix.investition.afaBasisLangfristig, 219200, TOL, 'AfA-Basis mix');
    // AfA p.a. = 219.200 × 2% = 4.384
    expectClose(mix.investition.afaProJahrTotal, 4384, TOL, 'AfA p.a. mix');
    // Verkaufspreis = wertAnfang(315.000) × 1 = 315.000
    expectClose(mix.bankgespraech.hochrechnungVerkauf.verkaufspreis, 315000, TOL, 'VK mix');
    // Steuer J1: zu verst. = 12.000 − 4.384 − sofortAbzug(30.000) = −22.384 → ×42% = −9.401,28
    expectClose(mix.matrix.steuern_jahr[0]!, -9401.28, TOL, 'Steuer mix');
    // CF n.St. J1 = 12.000 + 9.401,28 = 21.401,28
    expectClose(mix.matrix.cashflow_ns_jahr[0]!, 21401.28, TOL, 'CF n.St. mix');
  });

  test('Regression: ohne WEG-Posten ist renovierungWegRuecklage = 0 und GIK enthält Sanierung', () => {
    expectClose(sofort.investition.renovierungWegRuecklage, 0, TOL, 'kein WEG');
    expectClose(sofort.investition.renovierungSumme, 20000, TOL, 'Sanierung in GIK');
  });
});

// ── IRR-Spezial-Tests ──────────────────────────────────────

describe('IRR (Internal Rate of Return) — Newton-Raphson Implementation', () => {
  test('Bekanntes Beispiel: -100 + 5×30 → ~15,24%', () => {
    const irr = computeIRR([-100, 30, 30, 30, 30, 30]);
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 0.152382, 0.0001);
  });

  test('Sofort-Return: -100 + 200 → 100%', () => {
    const irr = computeIRR([-100, 200]);
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 1.0, 0.0001);
  });

  test('Verlust: alle Cashflows < Initial → negativ', () => {
    const irr = computeIRR([-1000, 100, 100, 100, 100, 100]);
    expect(irr).toBeLessThan(0);
  });

  test('Konvergenz-Failure liefert null (kein Crash)', () => {
    // Ohne Vorzeichenwechsel gibt es keine Nullstelle: Newton läuft nach oben
    // weg, die Ableitung wird flach, und die Funktion steigt mit `null` aus.
    // Ausgeschrieben statt „null ODER Zahl" — letzteres ist beim Rückgabetyp
    // `number | null` immer wahr und konnte nie rot werden.
    expect(computeIRR([100, 100, 100, 100])).toBeNull();
    expect(computeIRR([-100, -100, -100])).toBeNull();
    expect(computeIRR([100])).toBeNull();          // ein einziger Cashflow: keine Periode
  });

  test('Periodisierung — bekannte Cash-on-Cash-Rendite: -100 → +110 = 10 %', () => {
    // 100 € heute investiert, 110 € in einem Jahr zurück → 10 % IRR
    const irr = computeIRR([-100, 110]);
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 0.10, 0.0001);
  });
});

// ── Engine-IRR-Periodisierung-Test (Audit-Befund 1, 2026-05-01) ────
describe('computeKKalk: IRR-Periodisierung (Audit-Fix)', () => {
  test('Triviales Szenario: nur EK-Investition + Verkauf nach 1 Jahr', () => {
    // Setup: 100k Kaufpreis, 0% Nebenkosten, 0% Wertzuwachs, 0 Miete, 0 Darlehen
    // → EK = 100k initial, 1 Jahr lang Cashflow ≈ 0, Verkauf zu 100k
    // → IRR muss exakt 0% sein (kein Gewinn, kein Verlust)
    const result = computeKKalk({
      kaufpreis: 100000,
      notarPct: 0, grundbuchPct: 0, grundsteuerPct: 0, maklerPct: 0, sonstigePct: 0,
      sanierungsposten: [],
      nettokaltmieteMonat: 0, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0, nichtUmlagefaehig: 0, kostensteigerungJaehrlich: 0,
      wertsteigerungJaehrlich: 0,
      anteilGebaeudeKaufpreis: 0, afaSatz: 0,
      grenzsteuersatz: 0,
      darlehen: [], // kein Darlehen → EK = GIK
      betrachtungsdauerJahre: 1,
      kaufjahr: 2025,
    });
    const irr = result.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR;
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 0, 0.0001, 'IRR muss 0% sein bei 0% Wertentwicklung + 0 Cashflow');
  });

  test('10% Wertzuwachs nach 1 Jahr → IRR = 10%', () => {
    // 100k investiert (komplett EK), Verkauf nach 1 Jahr für 110k
    // → echte EK-Rendite = 10 %
    const result = computeKKalk({
      kaufpreis: 100000,
      notarPct: 0, grundbuchPct: 0, grundsteuerPct: 0, maklerPct: 0, sonstigePct: 0,
      sanierungsposten: [],
      nettokaltmieteMonat: 0, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0, nichtUmlagefaehig: 0, kostensteigerungJaehrlich: 0,
      wertsteigerungJaehrlich: 0.10,
      anteilGebaeudeKaufpreis: 0, afaSatz: 0,
      grenzsteuersatz: 0,
      darlehen: [],
      betrachtungsdauerJahre: 1,
      kaufjahr: 2025,
    });
    const irr = result.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR;
    expect(irr).not.toBeNull();
    if (irr !== null) expectClose(irr, 0.10, 0.0001, 'IRR muss exakt 10% sein bei 10% Wertzuwachs nach 1 Jahr');
  });

  test('IRR-Fix: cfNs[0] muss auf Periode 1 sein, NICHT auf Periode 0', () => {
    // Regression-Test gegen Audit-Befund 1 vom 2026-05-01:
    // Vorher rechnete die Engine cfNs[0] in Periode 0 zusammen mit -EK.
    // Das überschätzte die IRR um +0,4 bis +0,6 pp bei typischen Investments.
    //
    // Test-Konstruktion: 100k investiert komplett als EK, jährlich +5k Cashflow
    // über 10 Jahre, Verkauf zum Buchwert (100k).
    // → Jährlicher Cash-on-Cash-Return = 5%
    // → Mit korrekter Textbook-IRR: ~5,0%
    // → Mit Off-by-One-Bug (cfNs[0] auf Periode 0): ~5,5%
    const result = computeKKalk({
      kaufpreis: 100000,
      notarPct: 0, grundbuchPct: 0, grundsteuerPct: 0, maklerPct: 0, sonstigePct: 0,
      sanierungsposten: [],
      // 5 % Brutto = 5.000 €/Jahr → ~417 €/Mo
      nettokaltmieteMonat: 5000 / 12,
      stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0, nichtUmlagefaehig: 0, kostensteigerungJaehrlich: 0,
      wertsteigerungJaehrlich: 0, // Verkauf zum Anfangswert
      anteilGebaeudeKaufpreis: 0, afaSatz: 0,
      grenzsteuersatz: 0,
      darlehen: [],
      betrachtungsdauerJahre: 10,
      kaufjahr: 2025,
    });
    const irr = result.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR;
    expect(irr).not.toBeNull();
    if (irr !== null) {
      // Mathematisch korrekt = 5,0% (Cash-on-Cash bei flacher Wertentwicklung)
      // Wenn IRR > 5,2 % → Off-by-One-Bug ist zurück!
      expectClose(irr, 0.05, 0.001, 'IRR muss ≈5,0% sein, NICHT ≈5,5% (Off-by-One)');
    }
  });
});

// ── Förderkredit-Gegenrechnung-Test (Audit-Befund 2, 2026-05-01) ───
describe('computeKKalk: Förderkredit-Gegenrechnung (Audit-Fix)', () => {
  test('Zwei normale Tranchen ohne Sanierung: KEIN Phantom-Cashflow J1', () => {
    // Regression-Test gegen Audit-Befund 2:
    // Vorher modellierte die Engine Tranche 2+ als positive J1-Auszahlung
    // (KfW-Boost-Logik). Das erzeugte bei zwei normalen Bank-Tranchen
    // einen Phantom-Cashflow in Höhe von Tranche 2 im Jahr 1.
    const result = computeKKalk({
      kaufpreis: 400000,
      notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0, sonstigePct: 0,
      sanierungsposten: [], // KEINE Sanierung → keine Gegenrechnung möglich
      nettokaltmieteMonat: 1200, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0.02, nichtUmlagefaehig: 100, kostensteigerungJaehrlich: 0.02,
      wertsteigerungJaehrlich: 0.02,
      anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02,
      grenzsteuersatz: 0.42,
      darlehen: [
        { label: 'Tranche A', summe: 200000, zinssatz: 0.04, tilgung: 0.02 },
        { label: 'Tranche B', summe: 200000, zinssatz: 0.045, tilgung: 0.025 },
      ],
      betrachtungsdauerJahre: 10, kaufjahr: 2025, wohnflaecheGesamt: 80,
    });
    const cfOpJ1 = result.matrix.cashflow_op_jahr[0]!;
    // Ohne Sanierung darf der CF Jahr 1 nicht durch Tranche-2-Boost positiv werden!
    // Erwartet: ~ -12.800 € (negativ, da Zinsen + Tilgung > Mieten)
    expect(cfOpJ1).toBeLessThan(0);
    expect(cfOpJ1).toBeGreaterThan(-30000);
    // Falls der Bug zurück wäre: cfOpJ1 wäre +187.200 € (= Tranche B)
  });

  test('Vermögenszuwachs: SOFORT muss höher sein als AKTIVIERT (Total-Return-Logik)', () => {
    // User-Befund 2026-05-01: Vorher rechnete die Excel-Formel paradox:
    // Aktivierte Sanierung zeigte HÖHEREN Vermögenszuwachs als Sofort,
    // obwohl sofort wirtschaftlich um die zusätzliche Steuersparnis
    // besser ist. Engine wurde auf Total Return umgestellt.
    //
    // Identischer Case, nur modus unterschiedlich: Sofort muss exakt um
    // (Sanierung × Steuersatz × ~80%) besser sein (~80% wegen langsamer AfA-Differenz).
    const baseInputs = {
      kaufpreis: 300000,
      notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0, sonstigePct: 0,
      nettokaltmieteMonat: 900, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0.02, nichtUmlagefaehig: 80, kostensteigerungJaehrlich: 0,
      wertsteigerungJaehrlich: 0.02,
      anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02,
      grenzsteuersatz: 0.42,
      darlehen: [{ label: 'Hauptdarlehen', summe: 240000, zinssatz: 0.04, tilgung: 0.02 }],
      betrachtungsdauerJahre: 10, kaufjahr: 2025, wohnflaecheGesamt: 65,
    };
    const sofortResult = computeKKalk({
      ...baseInputs,
      sanierungsposten: [{ label: 'Sanierung', amount: 10000, modus: 'sofort' }],
    });
    const aktivResult = computeKKalk({
      ...baseInputs,
      sanierungsposten: [{ label: 'Sanierung', amount: 10000, modus: 'aktivieren' }],
    });
    const vSofort = sofortResult.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs;
    const vAktiv = aktivResult.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs;
    // Sofort MUSS höher sein als Aktiv
    expect(vSofort).toBeGreaterThan(vAktiv);
    // Differenz sollte ca. 3.360 € sein (10k × 42% × ~80% durch AfA-Verteilung)
    const diff = vSofort - vAktiv;
    expect(diff).toBeGreaterThan(3000);
    expect(diff).toBeLessThan(4000);
  });

  test('Sanierung als Initial-Investition: NICHT im operativen Cashflow J1 (User-Entscheid 2026-05-01)', () => {
    // Sanierung 887k Sofort-Sanierung wird wie Kaufpreis behandelt — finanziert
    // über EK + FK, NICHT als Cashflow-Auszahlung im Jahr 1.
    // Steuer-Effekt der Sofort-Sanierung bleibt: Werbungskosten Jahr 1.
    const result = computeKKalk({
      kaufpreis: 1550000,
      notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0, sonstigePct: 0,
      sanierungsposten: [
        { label: 'Sanierung', amount: 887000, modus: 'sofort' },
      ],
      nettokaltmieteMonat: 8369, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
      mieterhoehungJaehrlich: 0.02, nichtUmlagefaehig: 1040, kostensteigerungJaehrlich: 0.02,
      wertsteigerungJaehrlich: 0.02,
      anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02,
      grenzsteuersatz: 0.45,
      darlehen: [
        { label: 'Hauptdarlehen', summe: 1695500, zinssatz: 0.0404, tilgung: 0.01 },
        { label: 'Tranche 2', summe: 600000, zinssatz: 0.0205, tilgung: 0.0308 },
      ],
      betrachtungsdauerJahre: 10, kaufjahr: 2025, wohnflaecheGesamt: 554.5,
    });
    const cfOpJ1 = result.matrix.cashflow_op_jahr[0]!;
    const cfOpJ2 = result.matrix.cashflow_op_jahr[1]!;
    // CF J1 ≈ CF J2 (beide nur aus Miete - Bewirt - Zins - Tilgung, kein Sanierungs-Sondereffekt)
    expect(Math.abs(cfOpJ1 - cfOpJ2)).toBeLessThan(5000);
    // Steuer J1: Werbungskosten 887k → massive Erstattung
    const erstattung = -result.matrix.steuern_jahr[0]!;
    expect(erstattung).toBeGreaterThan(390000);
    expect(erstattung).toBeLessThan(420000);
  });
});

describe('Betrachtungsdauer: ganze Jahre im gerechneten Bereich', () => {
  // Die Dauer indiziert die Jahresreihen. Ungerundet oder über 50 hinaus lieferte
  // die Engine NaN bzw. beschriftete Werte aus Jahr 50 mit einer anderen Jahreszahl.
  const basis = {
    kaufpreis: 300000,
    notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0, sonstigePct: 0,
    sanierungsposten: [] as Sanierungsposten[],
    nettokaltmieteMonat: 900, stellplatzMiete: 0, sonstigeMiete: 0, umlagefaehig: 0,
    mieterhoehungJaehrlich: 0.02, nichtUmlagefaehig: 80, kostensteigerungJaehrlich: 0.02,
    wertsteigerungJaehrlich: 0.02,
    anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02,
    grenzsteuersatz: 0.42,
    darlehen: [{ label: 'Hauptdarlehen', summe: 240000, zinssatz: 0.04, tilgung: 0.02 }],
    kaufjahr: 2025, wohnflaecheGesamt: 65,
  };
  const rechne = (jahre: any) => computeKKalk({ ...basis, betrachtungsdauerJahre: jahre } as KKalkInputs);

  const hv = (o: any) => o.bankgespraech.hochrechnungVerkauf;
  const endlich = (o: any) => [
    hv(o).verkaufspreis, hv(o).erloes, hv(o).steuerfreierVermoegenszuwachs, hv(o).zieljahr,
  ].every((v: any) => Number.isFinite(v));

  test('10,5 Jahre ergibt keine NaN-Werte mehr', () => {
    // Vorher: zielIdx 9,5 → wertProJahr[9,5] ist undefined → im PDF „NaN €".
    const out = rechne(10.5);
    expect(endlich(out)).toBe(true);
    expect(hv(out).zieljahr).toBe(2036);           // 2025 + gerundet 11
  });

  test('60 Jahre werden auf 50 geklemmt — auch die Jahreszahl', () => {
    // Vorher beschriftete das Bank-PDF Werte aus Jahr 50 als „in 60 Jahren".
    const out = rechne(60);
    expect(endlich(out)).toBe(true);
    expect(hv(out).zieljahr).toBe(2075);           // 2025 + 50, nicht + 60
  });

  test('0, negativ und Unbrauchbares fallen auf einen gültigen Wert', () => {
    for (const eingabe of [0, -5, NaN, undefined, 'zehn']) {
      const out = rechne(eingabe);
      expect(endlich(out), String(eingabe)).toBe(true);
      expect(hv(out).zieljahr).toBeGreaterThanOrEqual(2026);
      expect(hv(out).zieljahr).toBeLessThanOrEqual(2075);
    }
  });

  test('ganzzahlige Werte im Bereich bleiben unverändert', () => {
    expect(hv(rechne(10)).zieljahr).toBe(2035);
    expect(hv(rechne(1)).zieljahr).toBe(2026);
    expect(hv(rechne(50)).zieljahr).toBe(2075);
  });
});
