/* eslint-disable @typescript-eslint/no-explicit-any -- Projekt im Altformat wie in der alten App */
/* Wörtlich aus gg-immohandel src/modules/projektmanagement/pm-berechnung.ts; parseNum aus ../zahlen.ts. */
// ──────────────────────────────────────────────────────────────
// Projektmanagement — Rechenregeln ohne Oberfläche
// ──────────────────────────────────────────────────────────────
// Vier Zahlen des Projektmanagements standen in pm.ts an je zwei Stellen und
// lauteten dort verschieden. Das fiel niemandem auf, weil beide Stellen für
// sich plausibel aussahen:
//
//   Ziel-VKP je Einheit  las `mi_soll` — ein Feld, das der Deal-Editor nie
//                        schreibt (er schreibt `mi_neu`). Ergebnis: dauerhaft 0.
//   Erlössumme           zählte auf der Projektkarte JEDEN Ist-Kaufpreis, in der
//                        Finanzleiste nur die beurkundeten. Zwei Prozentwerte
//                        für dieselbe Frage.
//   Ziel-VKP des Projekts rechnete auf den Kaufpreis statt auf die
//                        Gesamtinvestitionskosten und wich damit systematisch
//                        vom Ergebnis desselben Deals ab.
//   „Heute fällig"       filterte auf `deadline`, gespeichert wird `faellig`.
//
// Ohne DOM und ohne Speicher gibt es jede Regel genau einmal, und der Test
// daneben hält sie fest. Wer eine ändert, ändert sie für alle Anzeigen.
// ──────────────────────────────────────────────────────────────

import { parseNum } from '../zahlen.ts';

/** Vertriebsstände, ab denen ein Erlös als beurkundet zählt. */
const BEURKUNDET = ['notar', 'sold']

/**
 * Ziel-Verkaufspreis einer Einheit aus den Deal-Feldern.
 *
 * Gleiche Regel wie `calcEinheitVkp` in deals.ts: ein von Hand gesetzter VKP
 * schlägt die Rendite-Rechnung, sonst SOLL-Miete × 12 / Zielrendite. Die
 * SOLL-Miete ist `mi_neu` nur dann, wenn der Nutzer sie im Deal auch angefasst
 * hat (`mi_neu_manual`) — sonst folgt sie der IST-Miete, genau wie im Deal.
 */
export function pmZielKPEinheit(e: any): number {
  if (!e) return 0
  const vkp = parseNum(e.vkp)
  if (vkp) return Math.round(vkp)
  const rend = parseNum(e.rend_k)
  const miete = e.mi_neu_manual ? parseNum(e.mi_neu) : parseNum(e.mi_ist)
  if (!rend || !miete) return 0
  return Math.round((miete * 12) / (rend / 100))
}

/** SOLL-Kaltmiete einer Deal-Einheit — dieselbe Fallunterscheidung wie oben. */
export function pmSollMieteEinheit(e: any): number {
  if (!e) return 0
  return e.mi_neu_manual ? parseNum(e.mi_neu) : parseNum(e.mi_ist)
}

/**
 * Beurkundete Erlöse eines Projekts.
 *
 * Ein Ist-Kaufpreis zählt erst, wenn die Einheit auch auf „Notarvertrag" oder
 * „Verkauft" steht. Vorher ist er eine Absicht, kein Erlös — und ein Betrag,
 * der schon beim Eintippen in die Quote wandert, macht die Quote wertlos.
 */
export function pmBeurkundeteErloese(proj: any): number {
  const einh = proj?.einheiten || []
  const ausEinheiten = einh.reduce(
    (s: number, e: any) => s + (BEURKUNDET.includes(e?.vstatus) ? (parseNum(e?.istKP) || 0) : 0),
    0,
  )
  const global = BEURKUNDET.includes(proj?.globalVstatus) ? (parseNum(proj?.globalIstKP) || 0) : 0
  return ausEinheiten + global
}

/** Trifft der Filter der Checklisten-Kopfzeile auf diesen Punkt zu? */
export function pmTodoPasstZuFilter(t: any, filter: string, heute: string): boolean {
  const status = t?.status || 'offen'
  if (filter === 'offen') return status === 'offen'
  if (filter === 'progress') return status === 'in progress'
  if (filter === 'erledigt') return status === 'erledigt'
  // Das Fälligkeitsdatum liegt in `faellig` — `deadline` hat nie jemand geschrieben.
  if (filter === 'heute') return !!t?.faellig && t.faellig === heute
  return true
}

export interface PmTodoStatistik {
  offen: number
  inProgress: number
  erledigt: number
  gesamt: number
  pct: number
}

/** Zähler der Checklisten-Kopfzeile. */
export function pmTodoStatistik(todos: any[]): PmTodoStatistik {
  const alle = todos || []
  const erledigt = alle.filter(t => t?.status === 'erledigt').length
  const inProgress = alle.filter(t => t?.status === 'in progress').length
  const gesamt = alle.length
  return {
    offen: gesamt - erledigt - inProgress,
    inProgress,
    erledigt,
    gesamt,
    pct: gesamt ? Math.round((erledigt / gesamt) * 100) : 0,
  }
}

/**
 * Ziel-Verkaufspreis des Projekts aus der Deal-Kalkulation — Globalverkauf.
 *
 * Basis sind die Gesamtinvestitionskosten, nicht der Kaufpreis: GIK × (1 + Marge)
 * ist die Zahl, die der Deal in der Box „Globalverkauf" ausweist (deals.ts,
 * `dealKalkRC`). Der Kaufpreis allein lässt Nebenkosten, Sanierung, Zinsen und
 * die Mieteinnahmen der Haltedauer weg — das Projekt startete damit mit einem
 * Ziel, das der Deal nie genannt hat.
 *
 * Die Gesamtinvestitionskosten hängen von sich selbst ab (Zinsen und Gebühr
 * rechnen auf die Finanzierungssumme, die Finanzierungssumme auf die Kosten).
 * Deshalb dieselbe algebraische Auflösung wie im Deal:
 *   G = (Basis − Mieteinnahmen) / (1 − f − e − a)
 *
 * Die Standardwerte kommen als Argument herein statt aus dem Speicher — sonst
 * hinge diese Datei am Browser und wäre nicht mehr für sich prüfbar.
 */
export function pmZielVKPAusDeal(deal: any, defaults: any): number {
  const k = deal?.kalk
  if (!k) return 0
  const D = defaults || {}
  const zahl = (v: any, fb: any) => (v !== undefined && v !== null ? parseNum(v) : parseNum(fb))

  const kp = parseNum(k.kaufpreis)
  if (!kp) return 0

  const notarP = zahl(k.notar, D.notar)
  const gestP = zahl(k.gest, D.gest)
  const maklP = zahl(k.makler, D.makler)
  const fkP = zahl(k.fk_p, D.fk_p)
  const ekP = zahl(k.ek_p, D.ek_p)
  const eu = zahl(k.euribor, D.euribor)
  const mb = zahl(k.margeB, D.margeB)
  const ekR = zahl(k.ek_r, D.ek_r)
  const halt = zahl(k.halt, D.halt)
  const abgebP = zahl(k.bank_abgeb, D.bank_abgeb)
  const gloM = zahl(k.glo_m, D.glo_m)
  const rpPct = zahl(k.rp_pct, D.rp_pct)
  const rpFix = parseNum(k.rp_fix)

  const zs1 = kp + (kp * notarP) / 100 + (kp * gestP) / 100 + (kp * maklP) / 100

  // Mieteinnahmen der Haltedauer mindern die Kosten — IST-Miete, nicht SOLL:
  // was in diesen Monaten wirklich eingeht.
  const einheiten = deal?.einheiten || []
  const mabzug = einheiten.reduce((s: number, e: any) => s + parseNum(e?.mi_ist), 0) * halt

  // Sanierung: für den Globalverkauf zählen nur die Posten ohne Bereich, mit
  // „both" oder mit „glo". Der Risikopuffer verteilt sich anteilig — er ist auf
  // die GESAMTE Sanierung bemessen, auch wenn nur ein Teil global anfällt.
  const san = deal?.sanierung || []
  const sanGesamt = san.reduce((s: number, x: any) => s + parseNum(x?.amt), 0)
  const sanGlo = san
    .filter((x: any) => !x?.scope || x.scope === 'both' || x.scope === 'glo')
    .reduce((s: number, x: any) => s + parseNum(x?.amt), 0)
  const puffer = rpFix > 0 ? rpFix : (sanGesamt * rpPct) / 100
  const pufFak = sanGesamt > 0 ? puffer / sanGesamt : rpPct / 100
  const sanGloP = sanGlo + sanGlo * pufFak

  const hj = halt / 12
  const f = (fkP / 100) * ((eu + mb) / 100) * hj // FK-Zinsen
  const e = (ekP / 100) * (ekR / 100) * hj // EK-Opportunitätskosten
  const a = (fkP / 100) * (abgebP / 100) // Abschlussgebühr Bank

  const basis = zs1 + sanGloP
  const nenner = 1 - f - e - a
  let gik: number
  if (nenner > 0.05) {
    gik = (basis - mabzug) / nenner
  } else {
    // Nenner zu klein: die Auflösung kippt ins Absurde. Dann additiv rechnen —
    // dieselbe Notbremse wie im Deal.
    const rest = basis - mabzug
    gik = rest + rest * f + rest * e + rest * a
  }

  return Math.round(gik * (1 + gloM / 100))
}
