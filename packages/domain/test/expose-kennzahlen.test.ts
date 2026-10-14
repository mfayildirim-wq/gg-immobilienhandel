import { describe, expect, it } from 'vitest';
import {
  KERNFELDER, type KennzahlenEingabe, ZUSATZFELDER, exposeV2Leer, kennzahlenAlsMarkdown, kennzahlenJeExpose,
  kennzahlenVergleich, kennzahlenZusammenfassen,
} from '../src/index.ts';
import { exposeV2Beispiel } from './fixtures/expose-v2-beispiel.ts';

const v2Voll = exposeV2Beispiel;
/** Angabe per Index ändern (Beispiel: 2 Kaufpreis, 4 Jahresmiete, 6 Wohnfläche, 8 WE, 9 Baujahr, 1 Adresse). */
const mit = (aenderung: Record<number, string>) => { const v = v2Voll(); for (const [i, w] of Object.entries(aenderung)) v.angaben[+i]!.wert = w; return v; };

const basis = (e: Partial<KennzahlenEingabe>): KennzahlenEingabe => ({
  datei: 'a.pdf', schema: 'v2', modell: 'claude-haiku-4-5-20251001', modus: 'text', stopReason: 'tool_use',
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
  it('v2: Füllgrad je Kernfeld, Zusatzfelder, Einheiten, Belege, Dopplungen, Laufwerte', () => {
    const k = kennzahlenJeExpose(basis({ v2: v2Voll(), belegt: [true, true, true, false, null] }), 2026);
    expect(Object.keys(k.kern)).toEqual([...KERNFELDER]);
    expect(Object.values(k.kern).every(Boolean)).toBe(true);
    expect(k.zusatz).toMatchObject({
      hausgeld: 0, nebenkosten: 0, provision: 1, denkmalschutz: 0, erbpacht: 0, objektart: 0, sanierungen: 1, angaben: 31, mitStandardPfad: 30,
      weitereKontakte: 1, einheitenMitMietbeginn: 1, einheitenMitNebenkosten: 1, einheitenZusatzspalten: 1, mitVorschlag: 1,
    });
    expect(k.zusatz.zugeordnet! + k.zusatz.weitereAngaben!).toBe(31);
    expect(k.einheitenAnzahl).toBe(4);
    expect(k.belegQuote).toBe(75);
    expect(k.belegtAnzahl).toEqual({ geprueft: 4, belegt: 3 });
    expect(k.dopplungen).toBe(1);
    expect(k.traegt).toBe(true);
    expect(k).toMatchObject({ sonnet: false, abgeschnitten: false, nachfass: false, wiederholung: false, dauerMs: 12_345, kostenEur: 0.05 });
  });

  it('v2: Konsistenz aus den zugeordneten Werten', () => {
    const k = kennzahlenJeExpose(basis({ v2: v2Voll() }), 2026);
    // Σ Kaltmieten 1.680 € (inkl. Leerstand 0 und Stellplatz) gegen Ist-Miete 2.320 € → Abweichung
    expect(k.konsistenz).toEqual({ summeKaltmieteVsIstmiete: 'abweichung', anzahlWohnungenVsAnzahlWE: 'ok', summeFlaechenVsWohnflaeche: 'ok', mieteJeQm: 'ok', plz5stellig: 'ok', baujahr: 'ok' });
  });

  it('v2: Konsistenz-Abweichungen an den Grenzen', () => {
    const v = mit({ 1: 'Musterweg 12, 8907 Ulm', 6: '200 m²', 8: '4', 9: '2027' });
    const k = kennzahlenJeExpose(basis({ v2: v }), 2026);
    expect(k.konsistenz).toMatchObject({ anzahlWohnungenVsAnzahlWE: 'abweichung', summeFlaechenVsWohnflaeche: 'abweichung', baujahr: 'abweichung' });
    expect(kennzahlenJeExpose(basis({ v2: mit({ 4: '600 €' }) }), 2026).konsistenz.mieteJeQm).toBe('abweichung');
    expect(kennzahlenJeExpose(basis({ v2: mit({ 4: '20.160 €' }) }), 2026).konsistenz.summeKaltmieteVsIstmiete).toBe('ok');
  });

  it('leeres v2: alles leer, Konsistenz unbekannt, trägt nicht', () => {
    const k = kennzahlenJeExpose(basis({ v2: exposeV2Leer() }));
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
    const k = kennzahlenJeExpose(basis({ v2: v2Voll(), fehler: 'Zeitlimit' }));
    expect(k.fehler).toBe('Zeitlimit');
    expect(Object.values(k.kern).some(Boolean)).toBe(false);
    expect(k.einheitenAnzahl).toBe(0);
    expect(k.traegt).toBe(false);
  });
});

describe('kennzahlenZusammenfassen', () => {
  it('Füllgrad %, Summen, Mittel, Quoten', () => {
    const voll = kennzahlenJeExpose(basis({ datei: 'a.pdf', v2: v2Voll(), belegt: [true, false] }), 2026);
    const leer = kennzahlenJeExpose(basis({ datei: 'b.pdf', v2: exposeV2Leer(), modell: 'claude-sonnet-5', stopReason: 'max_tokens', wiederholung: true, nachfass: true, kostenEur: 0.15, dauerMs: 20_000 }), 2026);
    const kaputt = kennzahlenJeExpose(basis({ datei: 'c.pdf', fehler: 'kaputt', kostenEur: 0, dauerMs: 0, usage: { inputTokens: 0, outputTokens: 0 } }));
    const z = kennzahlenZusammenfassen([voll, leer, kaputt]);
    expect(z).toMatchObject({ schema: 'v2', anzahl: 3, fehler: 1, einheitenGesamt: 4, einheitenMittel: 2, kostenEurSumme: 0.2, kostenEurMittel: 0.1, dauerMsMittel: 16_173, inputTokensSumme: 2000, outputTokensSumme: 1000, dopplungenGesamt: 1 });
    expect(z.kern.kaufpreis).toBe(33);
    expect(z.zusatz.provision).toBe(33);
    expect(z.zusatzMittel.sanierungen).toBe(0.33);
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
  const z1 = kennzahlenZusammenfassen([kennzahlenJeExpose(basis({ v2: v2Voll() }), 2026)]);
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
    expect(md).toContain('| Feld | v2 |');
    expect(md).toContain('| Kaufpreis | 100 % |');
    const vgl = kennzahlenAlsMarkdown(z1, z0);
    expect(vgl).toContain('| Feld | v0 | v2 | Δ |');
    expect(vgl).toContain('| Grundstück | 0 % | 100 % | +100 % |');
    expect(vgl).not.toContain('Musterweg');
  });
});
