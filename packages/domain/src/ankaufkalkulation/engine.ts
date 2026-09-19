/**
 * Ankaufskalkulation eines Deals: Anschaffungskosten, Sanierung, Finanzierungskosten und Ergebnis
 * für die zwei Exit-Wege „Aufteiler“ (Einzelverkauf der Einheiten) und „Global“ (Verkauf als Ganzes).
 *
 * Herausgelöst aus gg-immohandel `dealKalkRC` + `dealRenderEinheiten` (deals.ts, Stand 9d693b8), wo die Rechnung
 * mit der DOM-Ausgabe verwoben war. Rechenweg, Reihenfolge der Operationen und Rückfallwerte sind bewusst identisch
 * (auch Eigenheiten wie `rp_pct` ohne Einstellungs-Standard). Gleichheit sichert test/golden/ankaufkalkulation.json.
 */
import { parseNum, plus } from '../zahlen.ts';

/** Einstellungen „Kalkulations-Standardwerte“ (alte App: immo-kalk-defaults). */
export interface KalkStandard {
  notar: number;
  gest: number;
  makler: number;
  fk_p: number;
  ek_p: number;
  euribor: number;
  margeB: number;
  bank_abgeb: number;
  ek_r: number;
  halt: number;
  vprov: number;
  glo_m: number;
  rp_pct: number;
  rend_k: number;
  auf_h: number;
  auf_e: number;
}

export const KALK_STANDARD: KalkStandard = {
  notar: 2, gest: 5, makler: 4.76, fk_p: 80, ek_p: 20, euribor: 2, margeB: 2.5, bank_abgeb: 2,
  ek_r: 15, halt: 12, vprov: 4.76, glo_m: 15, rp_pct: 10, rend_k: 4.5, auf_h: 1, auf_e: 6,
};

/** Eingabewerte je Deal (alte App: deal.kalk). Fehlende Felder → Standardwerte. */
export interface KalkWerte {
  kaufpreis?: number;
  notar?: number | null;
  gest?: number | null;
  makler?: number | null;
  euribor?: number | null;
  margeB?: number | null;
  fk_p?: number | null;
  ek_p?: number | null;
  ek_r?: number | null;
  halt?: number | null;
  vprov?: number | null;
  aufk?: number;
  auf_h?: number;
  auf_e?: number;
  glo_m?: number | null;
  bank_abgeb?: number | null;
  rp_fix?: number;
  rp_pct?: number;
  [weitere: string]: unknown;
}

export type Zahleingabe = number | string | null | undefined;

export interface EinheitEingabe {
  typ?: string | null;
  fl?: Zahleingabe;
  mi_ist?: Zahleingabe;
  mi_neu?: Zahleingabe;
  mi_neu_manual?: boolean | null;
  rend_k?: Zahleingabe;
  vkp?: Zahleingabe;
  stk?: Zahleingabe;
}

export type SanierungsBereich = 'both' | 'auf' | 'glo';

export interface SanierungEingabe {
  amt?: Zahleingabe;
  scope?: SanierungsBereich | string | null;
}

export interface EinheitErgebnis {
  kaltmieteProQmIst: number | null;
  kaltmieteProQmSoll: number | null;
  verkaufspreis: number;
  verkaufspreisProQm: number;
}

export interface Exitweg {
  sanierung: number;
  sanierungPuffer: number;
  herstellkosten: number;
  fkZinsen: number;
  bankAbschluss: number;
  ekKosten: number;
  fremdkapital: number;
  eigenkapital: number;
  gik: number;
  verkaufspreis: number;
  gewinn: number;
  marge: number;
}

export interface AnkaufErgebnis {
  einheiten: {
    zeilen: EinheitErgebnis[];
    anzahlEinheiten: number;
    anzahlStellplaetze: number;
    wohnflaeche: number;
    mieteIst: number;
    mieteSoll: number;
    verkaufspreise: number;
  };
  kaufpreis: number;
  notar: number;
  grunderwerbsteuer: number;
  maklerprovision: number;
  anschaffungskosten: number;
  jahresmieteIst: number;
  mietabzug: number;
  haltedauerMonate: number;
  sanierungNetto: number;
  sanierungPuffer: number;
  bankAbschlussPct: number;
  jahresnettokaltmieteSoll: number;
  vertriebsprovision: number;
  teilungskosten: number;
  aufteiler: Exitweg;
  global: Exitweg & { faktor: number; kaufpreisrendite: number };
  /** Werte, die die alte App in deal.kalk zurückschreibt (Liste, Cockpit, Präsentation). */
  kennzahlen: { gik: number; kaufpreis: number; gewinnAuf: number; margeAuf: number; gewinnGlo: number; margeGlo: number };
}

const imBereich = (s: SanierungEingabe, b: 'auf' | 'glo') => !s.scope || s.scope === 'both' || s.scope === b;

function exitweg(basis: number, mabzug: number, f: number, e: number, a: number) {
  const nenner = 1 - f - e - a;
  // Zirkelbezug: FK-Zinsen, EK-Kosten und Bankgebühr sind selbst Teil der Gesamtkosten.
  //   G = (basis − mietabzug) / (1 − f − e − a); bei kleinem Nenner ohne Auflösung.
  if (nenner > 0.05) {
    const gik = (basis - mabzug) / nenner;
    return { gik, fkZinsen: gik * f, ekKosten: gik * e, bankAbschluss: gik * a };
  }
  const fkZinsen = (basis - mabzug) * f;
  const ekKosten = (basis - mabzug) * e;
  const bankAbschluss = (basis - mabzug) * a;
  return { gik: basis - mabzug + fkZinsen + ekKosten + bankAbschluss, fkZinsen, ekKosten, bankAbschluss };
}

export function berechneAnkauf(
  k: KalkWerte,
  einheiten: readonly EinheitEingabe[],
  sanierungen: readonly SanierungEingabe[],
  D: KalkStandard = KALK_STANDARD,
): AnkaufErgebnis {
  // ── Einheiten (dealRenderEinheiten) ──
  let sf = 0, smIst = 0, smNeu = 0, kpSum = 0, cntEinh = 0, cntStpl = 0;
  const zeilen = einheiten.map((e) => {
    const istStpl = e.typ === 'Stellplatz';
    const fl = istStpl ? 0 : parseNum(e.fl) || 0;
    const mi = parseNum(e.mi_ist) || 0;
    const mn = e.mi_neu_manual ? parseNum(e.mi_neu) || 0 : mi;
    const rk = plus(e.rend_k) || 0;
    const vkp = e.vkp ? plus(e.vkp) : rk && mn ? Math.round((mn * 12) / (rk / 100)) : 0;
    const kpm2 = !istStpl && fl && vkp ? Math.round(vkp / fl) : 0;
    if (!istStpl) { sf += fl; cntEinh++; } else cntStpl += plus(e.stk) || 1;
    smIst += mi;
    smNeu += mn;
    if (vkp) kpSum += vkp;
    return {
      kaltmieteProQmIst: !istStpl && fl && mi ? mi / fl : null,
      kaltmieteProQmSoll: !istStpl && fl && mn ? mn / fl : null,
      verkaufspreis: vkp,
      verkaufspreisProQm: kpm2,
    };
  });

  // ── Anschaffung (dealKalkRC) ──
  const kp = k.kaufpreis || 0;
  const np = k.notar ?? D.notar, gp = k.gest ?? D.gest, mp = k.makler ?? D.makler;
  const eu = k.euribor ?? D.euribor, mb = k.margeB ?? D.margeB, fkp = k.fk_p ?? D.fk_p, ekp = k.ek_p ?? D.ek_p;
  const ekr = k.ek_r !== undefined ? k.ek_r : D.ek_r, halt = k.halt !== undefined ? k.halt : D.halt;
  const vprovp = k.vprov ?? D.vprov, aufkB = k.aufk || 0, glom = k.glo_m ?? D.glo_m;
  const notar = (kp * np!) / 100, gest = (kp * gp!) / 100, makler = (kp * mp!) / 100;
  const zs1 = kp + notar + gest + makler;
  const zsr = eu! + mb!, hj = halt! / 12;
  const abgebPct = k.bank_abgeb !== undefined ? k.bank_abgeb : D.bank_abgeb;

  const miM = einheiten.reduce((s, e) => s + (parseNum(e.mi_ist) || 0), 0);
  const mabzug = miM * halt!;
  const sanNetto = sanierungen.reduce((s, x) => s + (plus(x.amt) || 0), 0);
  let puffer = 0;
  if (k.rp_fix && k.rp_fix > 0) puffer = k.rp_fix;
  else puffer = (sanNetto * (k.rp_pct !== undefined ? k.rp_pct : 10)) / 100;
  const sanAuf = sanierungen.filter((s) => imBereich(s, 'auf')).reduce((s, x) => s + (plus(x.amt) || 0), 0);
  const sanGlo = sanierungen.filter((s) => imBereich(s, 'glo')).reduce((s, x) => s + (plus(x.amt) || 0), 0);
  const pufFak = sanNetto > 0 ? puffer / sanNetto : (k.rp_pct || 10) / 100;
  const sanAufP = sanAuf + sanAuf * pufFak, sanGloP = sanGlo + sanGlo * pufFak;

  const vkpEinheit = (e: EinheitEingabe): number => {
    if (e.vkp) return plus(e.vkp);
    const r = plus(e.rend_k) || 0;
    const mn = e.mi_neu_manual ? parseNum(e.mi_neu) || 0 : parseNum(e.mi_ist) || 0;
    return r && mn ? Math.round((mn * 12) / (r / 100)) : 0;
  };
  const kpk = einheiten.reduce((s, e) => s + vkpEinheit(e), 0);
  const avprov = (kpk * vprovp!) / 100;

  const fBase = (fkp! / 100) * (zsr / 100) * hj;
  const eBase = (ekp! / 100) * (ekr! / 100) * hj;
  const aBase = (fkp! / 100) * (abgebPct! / 100);
  const auf = exitweg(zs1 + sanAufP + aufkB + avprov, mabzug, fBase, eBase, aBase);
  const glo = exitweg(zs1 + sanGloP, mabzug, fBase, eBase, aBase);

  const miN = einheiten.reduce((s, e) => s + (e.mi_neu_manual ? parseNum(e.mi_neu) || 0 : parseNum(e.mi_ist) || 0), 0);
  const jnkm = miN * 12;
  const agew = kpk - auf.gik, amarge = kpk ? (agew / kpk) * 100 : 0;
  const gvkp = Math.round(glo.gik * (1 + glom! / 100)), ggew = gvkp - glo.gik, gmarge = gvkp ? (ggew / gvkp) * 100 : 0;

  return {
    einheiten: { zeilen, anzahlEinheiten: cntEinh, anzahlStellplaetze: cntStpl, wohnflaeche: sf, mieteIst: smIst, mieteSoll: smNeu, verkaufspreise: kpSum },
    kaufpreis: kp, notar, grunderwerbsteuer: gest, maklerprovision: makler, anschaffungskosten: zs1,
    jahresmieteIst: miM * 12, mietabzug: mabzug, haltedauerMonate: halt!,
    sanierungNetto: sanNetto, sanierungPuffer: puffer, bankAbschlussPct: abgebPct!,
    jahresnettokaltmieteSoll: jnkm, vertriebsprovision: avprov, teilungskosten: aufkB,
    aufteiler: {
      sanierung: sanAuf, sanierungPuffer: sanAuf * pufFak, herstellkosten: sanAufP + aufkB + avprov,
      ...auf, fremdkapital: (auf.gik * fkp!) / 100, eigenkapital: (auf.gik * ekp!) / 100,
      verkaufspreis: kpk, gewinn: agew, marge: amarge,
    },
    global: {
      sanierung: sanGlo, sanierungPuffer: sanGlo * pufFak, herstellkosten: sanGloP,
      ...glo, fremdkapital: (glo.gik * fkp!) / 100, eigenkapital: (glo.gik * ekp!) / 100,
      verkaufspreis: gvkp, gewinn: ggew, marge: gmarge,
      faktor: jnkm ? gvkp / jnkm : 0, kaufpreisrendite: gvkp && jnkm ? (jnkm / gvkp) * 100 : 0,
    },
    kennzahlen: {
      gik: Math.round(auf.gik), kaufpreis: kp, gewinnAuf: Math.round(agew), margeAuf: parseFloat(amarge.toFixed(2)),
      gewinnGlo: Math.round(ggew), margeGlo: parseFloat(gmarge.toFixed(2)),
    },
  };
}

/** Ampel wie in der alten App: ≥ 10 % grün, ≥ 6 % gelb, sonst rot; negativ = Verlust. */
export function margenAmpel(marge: number): 'gruen' | 'gelb' | 'rot' | 'verlust' {
  if (marge >= 10) return 'gruen';
  if (marge >= 6) return 'gelb';
  return marge >= 0 ? 'rot' : 'verlust';
}

/** Vorschlag Aufteilungskosten: Häuser × 6.000 € + Einheiten × 600 €. */
export const aufteilungskostenVorschlag = (haeuser: number, einheiten: number) => haeuser * 6000 + einheiten * 600;

/** Einheit in Tabellen-/API-Form (fach.deal_einheiten) → Eingabe mit den Feldnamen der alten App. */
export interface EinheitDaten {
  typ: string | null;
  flaeche: number | null;
  mieteIst: number | null;
  mieteNeu: number | null;
  mieteNeuManuell: boolean;
  renditeK: number | null;
  verkaufspreis: number | null;
  stueck: number | null;
}

export const einheitAlsEingabe = (e: EinheitDaten): EinheitEingabe => ({
  typ: e.typ, fl: e.flaeche, mi_ist: e.mieteIst, mi_neu: e.mieteNeu, mi_neu_manual: e.mieteNeuManuell,
  rend_k: e.renditeK, vkp: e.verkaufspreis, stk: e.stueck,
});

export const sanierungAlsEingabe = (s: { betrag: number | null; bereich: string | null }): SanierungEingabe => ({ amt: s.betrag, scope: s.bereich });
