/* Wörtlich aus gg-immohandel src/modules/projektmanagement/pm-berechnung.test.ts (einzige Änderung: `null as never` für TS strict) */
// Regressionstest für die Rechenregeln des Projektmanagements.
//
// Jeder Fall hier hält einen Befund fest, der in der Oberfläche monatelang
// unsichtbar war: eine 0, wo eine Zahl stehen musste, oder zwei Prozentwerte
// für dieselbe Frage. Wer eine Regel ändert, sieht hier zuerst, welche Anzeige
// er mit ändert.

import { describe, test, expect } from 'vitest'
import {
  pmZielKPEinheit,
  pmSollMieteEinheit,
  pmBeurkundeteErloese,
  pmTodoPasstZuFilter,
  pmTodoStatistik,
  pmZielVKPAusDeal,
} from '../src/index.ts'

describe('pmZielKPEinheit — Ziel-VKP je Einheit', () => {
  test('rechnet aus der angefassten SOLL-Miete, so wie der Deal-Editor sie ablegt', () => {
    // Genau die Felder, die deals.ts schreibt: mi_neu + mi_neu_manual.
    // Vorher las pm.ts `mi_soll` — ein Feld, das dort nie entsteht.
    const e = { mi_ist: 1000, mi_neu: 1200, mi_neu_manual: true, rend_k: 4.5 }
    expect(pmZielKPEinheit(e)).toBe(320000)
  })

  test('ohne angefasste SOLL-Miete folgt die Rechnung der IST-Miete', () => {
    const e = { mi_ist: 1000, mi_neu: 1200, mi_neu_manual: false, rend_k: 4.5 }
    expect(pmZielKPEinheit(e)).toBe(Math.round((1000 * 12) / 0.045))
  })

  test('ein von Hand gesetzter VKP schlägt die Rendite-Rechnung', () => {
    const e = { mi_ist: 1000, rend_k: 4.5, vkp: 275000 }
    expect(pmZielKPEinheit(e)).toBe(275000)
  })

  test('ein Feld namens mi_soll bleibt wirkungslos — es existiert im Deal nicht', () => {
    const e = { mi_soll: 1200, rend_k: 4.5 }
    expect(pmZielKPEinheit(e)).toBe(0)
  })

  test('ohne Zielrendite oder ohne Miete bleibt es bei 0', () => {
    expect(pmZielKPEinheit({ mi_ist: 1000 })).toBe(0)
    expect(pmZielKPEinheit({ rend_k: 4.5 })).toBe(0)
    expect(pmZielKPEinheit(null)).toBe(0)
  })

  test('deutsche Tausenderschreibweise aus Import-Daten wird gelesen', () => {
    expect(pmZielKPEinheit({ vkp: '275.000' })).toBe(275000)
  })
})

describe('pmSollMieteEinheit', () => {
  test('folgt derselben Fallunterscheidung wie der Ziel-VKP', () => {
    expect(pmSollMieteEinheit({ mi_ist: 900, mi_neu: 1100, mi_neu_manual: true })).toBe(1100)
    expect(pmSollMieteEinheit({ mi_ist: 900, mi_neu: 1100, mi_neu_manual: false })).toBe(900)
    expect(pmSollMieteEinheit(null)).toBe(0)
  })
})

describe('pmBeurkundeteErloese', () => {
  test('zählt nur, was auf Notarvertrag oder Verkauft steht', () => {
    const proj = {
      einheiten: [
        { vstatus: 'sold', istKP: 300000 },
        { vstatus: 'notar', istKP: 200000 },
        { vstatus: 'reserved', istKP: 999999 },
        { vstatus: 'active', istKP: 888888 },
        { vstatus: 'none', istKP: 777777 },
      ],
    }
    expect(pmBeurkundeteErloese(proj)).toBe(500000)
  })

  test('der Globalverkauf zählt nur mit passendem Status', () => {
    expect(pmBeurkundeteErloese({ globalVstatus: 'sold', globalIstKP: 1000000 })).toBe(1000000)
    expect(pmBeurkundeteErloese({ globalVstatus: 'reserved', globalIstKP: 1000000 })).toBe(0)
  })

  test('leeres Projekt ergibt 0', () => {
    expect(pmBeurkundeteErloese({})).toBe(0)
    expect(pmBeurkundeteErloese(null)).toBe(0)
  })
})

describe('pmTodoPasstZuFilter', () => {
  const heute = '2026-08-04'

  test('„Heute fällig" liest das Feld, das auch gespeichert wird', () => {
    expect(pmTodoPasstZuFilter({ faellig: heute }, 'heute', heute)).toBe(true)
    expect(pmTodoPasstZuFilter({ faellig: '2026-08-05' }, 'heute', heute)).toBe(false)
  })

  test('ein Punkt ohne Datum ist nie heute fällig', () => {
    expect(pmTodoPasstZuFilter({ faellig: '' }, 'heute', heute)).toBe(false)
    expect(pmTodoPasstZuFilter({}, 'heute', heute)).toBe(false)
  })

  test('das alte Feld `deadline` wird nicht mehr gelesen', () => {
    // Es hat nie jemand geschrieben; wer es künstlich setzt, soll den Filter
    // nicht bedienen können, sonst gäbe es wieder zwei Wahrheiten.
    expect(pmTodoPasstZuFilter({ deadline: heute }, 'heute', heute)).toBe(false)
  })

  test('Statusfilter', () => {
    expect(pmTodoPasstZuFilter({}, 'offen', heute)).toBe(true) // ohne Status = offen
    expect(pmTodoPasstZuFilter({ status: 'in progress' }, 'progress', heute)).toBe(true)
    expect(pmTodoPasstZuFilter({ status: 'erledigt' }, 'erledigt', heute)).toBe(true)
    expect(pmTodoPasstZuFilter({ status: 'erledigt' }, 'offen', heute)).toBe(false)
    expect(pmTodoPasstZuFilter({ status: 'erledigt' }, 'alle', heute)).toBe(true)
  })
})

describe('pmTodoStatistik', () => {
  test('zählt die drei Stände und den Fortschritt', () => {
    const s = pmTodoStatistik([
      { status: 'erledigt' },
      { status: 'erledigt' },
      { status: 'in progress' },
      { status: 'offen' },
      {},
    ])
    expect(s).toEqual({ offen: 2, inProgress: 1, erledigt: 2, gesamt: 5, pct: 40 })
  })

  test('leere Liste ergibt 0 %, nicht NaN', () => {
    expect(pmTodoStatistik([]).pct).toBe(0)
    expect(pmTodoStatistik(null as never).gesamt).toBe(0)
  })
})

describe('pmZielVKPAusDeal', () => {
  const defaults = {
    notar: 2, gest: 5, makler: 4.76, fk_p: 80, ek_p: 20, euribor: 2, margeB: 2.5,
    bank_abgeb: 2, ek_r: 15, halt: 12, vprov: 4.76, glo_m: 15, rp_pct: 10, rend_k: 4.5,
  }

  const deal = {
    kalk: { kaufpreis: 1000000, notar: 2, gest: 5, makler: 4.76, fk_p: 80, ek_p: 20,
            euribor: 2, margeB: 2.5, bank_abgeb: 2, ek_r: 15, halt: 12, glo_m: 15, rp_pct: 10 },
    einheiten: [{ mi_ist: 2000 }],
    sanierung: [{ amt: 100000, scope: 'both' }],
  }

  test('rechnet auf die Gesamtinvestitionskosten, nicht auf den Kaufpreis', () => {
    // Von Hand: AK 1.117.600 + Sanierung inkl. Puffer 110.000 = 1.227.600
    //   − Mieteinnahmen 24.000 = 1.203.600, Nenner 1 − 0,036 − 0,03 − 0,016 = 0,918
    //   → GIK 1.311.111 × 1,15 = 1.507.778
    expect(pmZielVKPAusDeal(deal, defaults)).toBe(1507778)
  })

  test('unterscheidet sich messbar von der alten Kaufpreis-Formel', () => {
    // Die alte Formel ergab Kaufpreis × (1 + Marge) = 1.150.000 — rund
    // 358.000 € unter dem, was der Deal selbst im Globalverkauf ausweist.
    expect(pmZielVKPAusDeal(deal, defaults)).not.toBe(1150000)
  })

  test('fehlende Kalkulationsfelder fallen auf die Standardwerte zurück', () => {
    const nurKP = { kalk: { kaufpreis: 1000000 }, einheiten: [{ mi_ist: 2000 }], sanierung: [{ amt: 100000 }] }
    expect(pmZielVKPAusDeal(nurKP, defaults)).toBe(1507778)
  })

  test('ein Sanierungsposten nur für den Aufteiler zählt beim Globalverkauf nicht mit', () => {
    const nurAuf = { ...deal, sanierung: [{ amt: 100000, scope: 'auf' }] }
    expect(pmZielVKPAusDeal(nurAuf, defaults)).toBeLessThan(pmZielVKPAusDeal(deal, defaults))
  })

  test('ein fester Risikopuffer ersetzt den prozentualen', () => {
    const fix = { ...deal, kalk: { ...deal.kalk, rp_fix: 50000, rp_pct: 0 } }
    // 50.000 statt 10.000 Puffer → höhere Kosten → höherer Ziel-VKP
    expect(pmZielVKPAusDeal(fix, defaults)).toBeGreaterThan(pmZielVKPAusDeal(deal, defaults))
  })

  test('ohne Kalkulation oder ohne Kaufpreis bleibt es bei 0', () => {
    expect(pmZielVKPAusDeal({}, defaults)).toBe(0)
    expect(pmZielVKPAusDeal({ kalk: { kaufpreis: 0 } }, defaults)).toBe(0)
    expect(pmZielVKPAusDeal(null, defaults)).toBe(0)
  })
})
