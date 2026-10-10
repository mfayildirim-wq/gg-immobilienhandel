import { describe, expect, it } from 'vitest';
import {
  type ExposeV1, KERNFELDER, type KennzahlenEingabe, ZUSATZFELDER, exposeV1Leer, kennzahlenAlsMarkdown, kennzahlenJeExpose,
  kennzahlenVergleich, kennzahlenZusammenfassen,
} from '../src/index.ts';

const einheit = (typ: ExposeV1['einheiten'][number]['typ'], flaeche: number | null, kaltmiete: number | null, extra: Partial<ExposeV1['einheiten'][number]> = {}) =>
  ({ typ, lage: null, zimmer: null, flaeche, kaltmiete, nebenkosten: null, sollmiete: null, vermiet: null, mietbeginn: null, _seite: null, ...extra });

function v1Voll(): ExposeV1 {
  const v = exposeV1Leer();
  v.geo = { ...v.geo, strasse: 'Musterweg', hausnummer: '12', plz: '89073', ort: 'Ulm' };
  v.preise = { ...v.preise, kaufpreis: 1_250_000, mieteinnahmen_ist_monat: 2_320, hausgeld_monat: 350, provision_text: '3,57 % inkl. MwSt.' };
  v.flaechen = { ...v.flaechen, wohnflaeche: 240, grundstuecksflaeche: 480 };
  v.zustand = { ...v.zustand, baujahr: 1965, denkmalschutz: true, sanierungen: [{ jahr: 2015, was: 'Dach' }] };
  v.ausstattung = { ...v.ausstattung, heizungsart: 'Gas-Zentral', merkmale: ['Balkon', 'Keller'] };
  v.energiepass = { ...v.energiepass, klasse: 'D' };
  v.verwaltung = { ...v.verwaltung, anzahl_wohneinheiten: 3 };
  v.kontaktperson = { ...v.kontaktperson, vorname: 'Anna', name: 'Beispiel', firma: 'Beispiel GmbH', email: 'a@b.test', tel_zentrale: '0711 1' };
  v.einheiten = [einheit('Wohnung', 80, 800, { mietbeginn: '01.01.2020', nebenkosten: 150 }), einheit('Wohnung', 80, 820), einheit('Wohnung', 80, 700), einheit('Stellplatz', null, null)];
  v.weitere_angaben = [{ gruppe: 'zustand', bezeichnung: 'Dach', wert: '2015 neu', einheit: null, seite: 2 }, { gruppe: 'preise', bezeichnung: 'Kaufpreis', wert: '1,25 Mio', einheit: null, seite: 1 }];
  v.weitere_kontakte = [{ name: 'Max Zweit', rolle: 'GF', tel: null, mobil: null, email: null }];
  return v;
}

const basis = (e: Partial<KennzahlenEingabe>): KennzahlenEingabe => ({
  datei: 'a.pdf', schema: 'v1', modell: 'claude-haiku-4-5-20251001', modus: 'text', stopReason: 'tool_use',
  usage: { inputTokens: 1000, outputTokens: 500 }, dauerMs: 12_345, kostenEur: 0.05, nachfass: false, wiederholung: false, warnungen: [], ...e,
});

const v0Antwort = {
  objekt: {
    strasse: 'Musterweg', hausnr: '12', plz: '8907', stadt: 'Ulm', baujahr: 1965, wohnflaeche: 240, grundstueck: null, einheitenAnz: 3,
    angebotspreis: null, istmiete: 2_320, heizungsart: '', energieausweis: { klasse: null },
    einheiten: [{ typ: 'Wohnung', flaeche: 80, kaltmiete: 800 }, { typ: 'Wohnung', flaeche: 80, kaltmiete: 820 }],
  },
  makler: { name: 'Anna Beispiel', firma: null, email: 'a@b.test', mobiltel: null, festnetztel: '0711 1', tel: null },
  kalkulation: { kaufpreis: 1_250_000 },
};

describe('kennzahlenJeExpose', () => {
  it('v1: Füllgrad je Kernfeld, Zusatzfelder, Einheiten, Belege, Dopplungen, Laufwerte', () => {
    const k = kennzahlenJeExpose(basis({ v1: v1Voll(), belegt: { kaufpreis: true, wohnflaeche: true, istmiete: false, baujahr: true } }), 2026);
    expect(Object.keys(k.kern)).toEqual([...KERNFELDER]);
    expect(Object.values(k.kern).every(Boolean)).toBe(true);
    expect(k.zusatz).toMatchObject({ hausgeld: 1, nebenkosten: 0, provision: 1, denkmalschutz: 1, erbpacht: 0, objektart: 0, sanierungen: 1, merkmale: 2, weitereAngaben: 2, weitereKontakte: 1, einheitenMitMietbeginn: 1, einheitenMitNebenkosten: 1 });
    expect(k.einheitenAnzahl).toBe(4);
    expect(k.belegQuote).toBe(75);
    expect(k.belegtAnzahl).toEqual({ geprueft: 4, belegt: 3 });
    expect(k.dopplungen).toBe(1);
    expect(k.traegt).toBe(true);
    expect(k).toMatchObject({ sonnet: false, abgeschnitten: false, nachfass: false, wiederholung: false, dauerMs: 12_345, kostenEur: 0.05 });
  });

  it('v1: Konsistenz ok bei stimmigen Zahlen', () => {
    const k = kennzahlenJeExpose(basis({ v1: v1Voll() }), 2026);
    expect(k.konsistenz).toEqual({ summeKaltmieteVsIstmiete: 'ok', anzahlWohnungenVsAnzahlWE: 'ok', summeFlaechenVsWohnflaeche: 'ok', mieteJeQm: 'ok', plz5stellig: 'ok', baujahr: 'ok' });
  });

  it('v1: Konsistenz-Abweichungen an den Grenzen', () => {
    const v = v1Voll();
    v.preise.mieteinnahmen_ist_monat = 2_100; // Σ 2320 > 2100 · 1,05
    v.verwaltung.anzahl_wohneinheiten = 4;
    v.flaechen.wohnflaeche = 200; // Σ 240 > 200 · 1,1
    v.geo.plz = '8907';
    v.zustand.baujahr = 2027;
    const k = kennzahlenJeExpose(basis({ v1: v }), 2026);
    expect(k.konsistenz).toEqual({ summeKaltmieteVsIstmiete: 'abweichung', anzahlWohnungenVsAnzahlWE: 'abweichung', summeFlaechenVsWohnflaeche: 'abweichung', mieteJeQm: 'ok', plz5stellig: 'abweichung', baujahr: 'abweichung' });
    v.preise.mieteinnahmen_ist_monat = 50; // 0,25 €/m²
    expect(kennzahlenJeExpose(basis({ v1: v }), 2026).konsistenz.mieteJeQm).toBe('abweichung');
    v.preise.mieteinnahmen_ist_monat = 2_220; // Σ 2320 innerhalb ±5 % von 2220
    expect(kennzahlenJeExpose(basis({ v1: v }), 2026).konsistenz.summeKaltmieteVsIstmiete).toBe('ok');
  });

  it('leeres v1: alles leer, Konsistenz unbekannt, trägt nicht', () => {
    const k = kennzahlenJeExpose(basis({ v1: exposeV1Leer() }));
    expect(Object.values(k.kern).some(Boolean)).toBe(false);
    expect(Object.values(k.konsistenz).every((s) => s === 'unbekannt')).toBe(true);
    expect(k.belegQuote).toBeNull();
    expect(k.dopplungen).toBe(0);
    expect(k.traegt).toBe(false);
  });

  it('v0: dieselben Kernfeld-Namen, Kaufpreis aus der Kalkulation, Zusatzfelder null', () => {
    const k = kennzahlenJeExpose(basis({ schema: 'v0', v0: v0Antwort, modell: 'claude-sonnet-5', stopReason: 'max_tokens' }), 2026);
    expect(Object.keys(k.kern)).toEqual([...KERNFELDER]);
    expect(k.kern).toMatchObject({ strasse: true, kaufpreis: true, grundstueck: false, heizungsart: false, energieklasse: false, maklerFirma: false, maklerTel: true });
    expect(Object.values(k.zusatz).every((x) => x === null)).toBe(true);
    expect(k.dopplungen).toBeNull();
    expect(k.traegt).toBeNull();
    expect(k.einheitenAnzahl).toBe(2);
    expect(k).toMatchObject({ sonnet: true, abgeschnitten: true });
    expect(k.konsistenz).toMatchObject({ plz5stellig: 'abweichung', anzahlWohnungenVsAnzahlWE: 'abweichung', summeKaltmieteVsIstmiete: 'abweichung', mieteJeQm: 'ok' });
  });

  it('Fehler: alle Felder leer, Konsistenz unbekannt', () => {
    const k = kennzahlenJeExpose(basis({ v1: v1Voll(), fehler: 'Zeitlimit' }));
    expect(k.fehler).toBe('Zeitlimit');
    expect(Object.values(k.kern).some(Boolean)).toBe(false);
    expect(k.einheitenAnzahl).toBe(0);
    expect(k.traegt).toBe(false);
  });
});

describe('kennzahlenZusammenfassen', () => {
  it('Füllgrad %, Summen, Mittel, Quoten', () => {
    const voll = kennzahlenJeExpose(basis({ datei: 'a.pdf', v1: v1Voll(), belegt: { kaufpreis: true, istmiete: false } }), 2026);
    const leer = kennzahlenJeExpose(basis({ datei: 'b.pdf', v1: exposeV1Leer(), modell: 'claude-sonnet-5', stopReason: 'max_tokens', wiederholung: true, nachfass: true, kostenEur: 0.15, dauerMs: 20_000 }), 2026);
    const kaputt = kennzahlenJeExpose(basis({ datei: 'c.pdf', fehler: 'kaputt', kostenEur: 0, dauerMs: 0, usage: { inputTokens: 0, outputTokens: 0 } }));
    const z = kennzahlenZusammenfassen([voll, leer, kaputt]);
    expect(z).toMatchObject({ schema: 'v1', anzahl: 3, fehler: 1, einheitenGesamt: 4, einheitenMittel: 2, kostenEurSumme: 0.2, kostenEurMittel: 0.1, dauerMsMittel: 16_173, inputTokensSumme: 2000, outputTokensSumme: 1000, dopplungenGesamt: 1 });
    expect(z.kern.kaufpreis).toBe(33);
    expect(z.zusatz.hausgeld).toBe(33);
    expect(z.zusatzMittel.merkmale).toBe(0.67);
    expect(kaputt.zusatz.hausgeld).toBe(0);
    expect(z.quoten).toEqual({ traegtQuote: 33, belegQuote: 50, abgeschnittenQuote: 50, nachfassQuote: 50, wiederholungQuote: 50, sonnetQuote: 50, fehlerQuote: 33 });
    expect(z.konsistenz.plz5stellig).toEqual({ okQuote: 100, ok: 1, abweichung: 0, unbekannt: 2 });
  });

  it('v0: Zusatzfelder ohne Daten → null; leere Liste ergibt Nullen', () => {
    const z = kennzahlenZusammenfassen([kennzahlenJeExpose(basis({ schema: 'v0', v0: v0Antwort }))]);
    for (const f of ZUSATZFELDER) expect(z.zusatz[f]).toBeNull();
    expect(z.quoten.traegtQuote).toBeNull();
    const l = kennzahlenZusammenfassen([]);
    expect(l.anzahl).toBe(0);
    expect(l.kern.kaufpreis).toBe(0);
    expect(l.quoten.fehlerQuote).toBeNull();
  });
});

describe('kennzahlenVergleich und Markdown', () => {
  const z1 = kennzahlenZusammenfassen([kennzahlenJeExpose(basis({ v1: v1Voll() }), 2026)]);
  const z0 = kennzahlenZusammenfassen([kennzahlenJeExpose(basis({ schema: 'v0', v0: v0Antwort, kostenEur: 0.03 }), 2026)]);

  it('Δ = b − a in Prozentpunkten; null, wenn eine Seite nichts hat', () => {
    const d = kennzahlenVergleich(z0, z1);
    expect(d.kern.grundstueck).toBe(100);
    expect(d.kern.strasse).toBe(0);
    expect(d.zusatz.hausgeld).toBeNull();
    expect(d.konsistenz.plz5stellig).toBe(100);
    expect(d.kostenEurMittel).toBe(0.02);
    expect(d.einheitenMittel).toBe(2);
  });

  it('Markdown: einfache Tabelle und Gegenüberstellung mit Δ', () => {
    const md = kennzahlenAlsMarkdown(z1);
    expect(md).toContain('| Feld | v1 |');
    expect(md).toContain('| Kaufpreis | 100 % |');
    const vgl = kennzahlenAlsMarkdown(z1, z0);
    expect(vgl).toContain('| Feld | v0 | v1 | Δ |');
    expect(vgl).toContain('| Grundstück | 0 % | 100 % | +100 % |');
    expect(vgl).not.toContain('Musterweg');
  });
});
