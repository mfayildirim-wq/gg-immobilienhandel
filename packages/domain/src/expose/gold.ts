/**
 * Goldstandard der Exposé-Extraktion (Protokoll 30, P0): von Hand geprüfte Soll-Werte je Exposé und Feld sowie die
 * Einheitenliste. `goldVergleich` misst ein Ergebnis im Format der Prüfseite dagegen — Feldgenauigkeit, Auslassungen,
 * erfundene Werte und Einheiten-Treffer je Typ. Nur Kennzahlen, keine Inhalte in der Ausgabe.
 */
import { telefonSchluessel } from '../makler/kontakte.ts';
import { leerraum, zahlAusText } from './normalisieren.ts';
import type { EinheitV0, ExtrahiertV0 } from './zuordnung.ts';

export const GOLD_FELDER = [
  'strasse', 'hausnr', 'plz', 'ort', 'baujahr', 'wohnflaeche', 'grundstueck', 'anzahl_we', 'anzahl_gewerbe', 'anzahl_stellplaetze',
  'kaufpreis', 'istmiete_monat', 'istmiete_jahr', 'provision', 'provision_prozent', 'heizungsart', 'energieklasse',
  'makler_name', 'makler_firma', 'makler_email', 'makler_telefon',
] as const;
export type GoldFeld = (typeof GOLD_FELDER)[number];

const ZAHL_FELDER = new Set<GoldFeld>(['baujahr', 'wohnflaeche', 'grundstueck', 'anzahl_we', 'anzahl_gewerbe', 'anzahl_stellplaetze', 'kaufpreis', 'istmiete_monat', 'istmiete_jahr', 'provision_prozent']);

/** Soll je Feld: Wert, `null` = steht nicht im Exposé. Ungeprüfte Felder fehlen. */
export type GoldSoll = Partial<Record<GoldFeld, string | number | null>>;
export interface GoldEinheit { typ: string; flaeche: number | null; kaltmiete: number | null }
export interface GoldExpose { nr: number; datei: string; soll: GoldSoll; einheiten: GoldEinheit[] | null }

const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
const zelle = (v: unknown) => (leer(v) ? null : typeof v === 'number' ? v : String(v).trim());

/** Zeilen der Blätter „Objekte“ und „Einheiten“ (ohne Kopfzeile, Spalten wie in der Vorlage) → Goldstandard. */
export function goldAusTabellen(objekte: unknown[][], einheiten: unknown[][]): GoldExpose[] {
  const je = new Map<number, GoldExpose>();
  const hol = (nr: number, datei: string) => je.get(nr) ?? (je.set(nr, { nr, datei, soll: {}, einheiten: null }), je.get(nr)!);
  for (const z of objekte) {
    const [nr, datei, feld, , vorschlag, , pruefung, richtig] = z;
    if (typeof nr !== 'number' || !(GOLD_FELDER as readonly string[]).includes(String(feld))) continue;
    const g = hol(nr, String(datei));
    const p = String(pruefung ?? '').trim().toLowerCase();
    const f = feld as GoldFeld;
    if (p === 'ok') g.soll[f] = zelle(vorschlag);
    else if (p === 'korrigiert') g.soll[f] = zelle(richtig);
    else if (p === 'nicht im exposé' || p === 'nicht im expose') g.soll[f] = null;
  }
  // Einheiten zählen nur für Exposés, deren Zeilen alle geprüft sind
  const proExpose = new Map<number, { alleGeprueft: boolean; liste: GoldEinheit[] }>();
  for (const z of einheiten) {
    const [nr, datei, , typ, , , flaeche, kaltmiete, , , pruefung] = z;
    if (typeof nr !== 'number') continue;
    hol(nr, String(datei));
    const e = proExpose.get(nr) ?? { alleGeprueft: true, liste: [] };
    const p = String(pruefung ?? '').trim().toLowerCase();
    if (!p) e.alleGeprueft = false;
    if (p && p !== 'streichen') e.liste.push({ typ: String(typ || 'Wohnung'), flaeche: zahlOderNull(flaeche), kaltmiete: zahlOderNull(kaltmiete) });
    proExpose.set(nr, e);
  }
  for (const [nr, e] of proExpose) if (e.alleGeprueft) je.get(nr)!.einheiten = e.liste;
  return [...je.values()].sort((a, b) => a.nr - b.nr);
}

function zahlOderNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return typeof v === 'string' && v.trim() ? zahlAusText(v) : null;
}

/** Ist-Werte eines Ergebnisses im Format der Prüfseite. */
export function goldIst(p: ExtrahiertV0, details: Record<string, unknown> = {}): Partial<Record<GoldFeld, string | number | null>> {
  // Alt-Ergebnisse (v0) lassen Gruppen manchmal weg
  const o = (p.objekt ?? {}) as Partial<ExtrahiertV0['objekt']>; const m = (p.makler ?? {}) as Partial<ExtrahiertV0['makler']>; const k = (p.kalkulation ?? {}) as Partial<ExtrahiertV0['kalkulation']>;
  const einheiten = Array.isArray(o.einheiten) ? o.einheiten : [];
  const anzahl = (t: string) => { const n = einheiten.filter((e) => e.typ === t).length; return n || null; };
  return {
    strasse: o.strasse ?? null, hausnr: o.hausnr ?? null, plz: o.plz ?? null, ort: o.stadt ?? null, baujahr: o.baujahr ?? null,
    wohnflaeche: o.wohnflaeche ?? null, grundstueck: o.grundstueck ?? null,
    anzahl_we: o.einheitenAnz ?? null, anzahl_gewerbe: anzahl('Gewerbe'), anzahl_stellplaetze: anzahl('Stellplatz'),
    kaufpreis: o.angebotspreis ?? k.kaufpreis ?? null, istmiete_monat: o.istmiete ?? null, istmiete_jahr: null,
    provision: typeof details.provision === 'string' ? details.provision : null, provision_prozent: k.makler ?? null,
    heizungsart: o.heizungsart ?? null, energieklasse: o.energieausweis?.klasse ?? null,
    makler_name: m.name ?? null, makler_firma: m.firma ?? null, makler_email: m.email ?? null,
    makler_telefon: [m.mobiltel, m.festnetztel, m.tel, ...(m.alleTelefonnummern ?? [])].filter(Boolean).join(' | ') || null,
  };
}

export type GoldUrteil = 'richtig' | 'falsch' | 'ausgelassen' | 'erfunden' | 'richtigLeer';

const norm = (s: string) => leerraum(s).toLowerCase().replace(/[.,;:\-–]/g, '').replace(/\s+/g, ' ');

export function feldUrteil(feld: GoldFeld, soll: string | number | null, ist: string | number | null | undefined): GoldUrteil {
  const istLeer = leer(ist);
  if (soll === null) return istLeer ? 'richtigLeer' : 'erfunden';
  if (istLeer) return 'ausgelassen';
  if (ZAHL_FELDER.has(feld)) {
    const a = typeof soll === 'number' ? soll : zahlAusText(String(soll));
    const b = typeof ist === 'number' ? ist : zahlAusText(String(ist));
    if (a === null || b === null) return 'falsch';
    return Math.abs(a - b) <= Math.max(1, 0.005 * Math.abs(a)) ? 'richtig' : 'falsch';
  }
  if (feld === 'makler_telefon') {
    const s = telefonSchluessel(String(soll));
    return String(ist).split('|').some((t) => s !== '' && telefonSchluessel(t) === s) ? 'richtig' : 'falsch';
  }
  const a = norm(String(soll)); const b = norm(String(ist));
  return a === b || a.includes(b) || b.includes(a) ? 'richtig' : 'falsch';
}

/** Einheiten-Treffer: gleicher Typ, Fläche ±1 m², Kaltmiete ±1 € (wenn beide gesetzt); jede Soll-Einheit höchstens einmal. */
export function einheitenTreffer(soll: GoldEinheit[], ist: EinheitV0[]) {
  const frei = [...soll];
  let treffer = 0;
  const typTreffer: Record<string, { soll: number; ist: number; treffer: number }> = {};
  const t = (typ: string) => (typTreffer[typ] ??= { soll: 0, ist: 0, treffer: 0 });
  for (const s of soll) t(s.typ).soll++;
  for (const e of ist) {
    const typ = e.typ ?? 'Wohnung';
    t(typ).ist++;
    const i = frei.findIndex((s) => s.typ === typ
      && (s.flaeche === null || e.flaeche === null || Math.abs(s.flaeche - e.flaeche) <= 1)
      && (s.kaltmiete === null || e.kaltmiete === null || Math.abs(s.kaltmiete - e.kaltmiete) <= 1));
    if (i >= 0) { frei.splice(i, 1); treffer++; t(typ).treffer++; }
  }
  const f1 = (tr: number, s: number, i: number) => (s + i ? +((2 * tr) / (s + i)).toFixed(3) : null);
  return { soll: soll.length, ist: ist.length, treffer, f1: f1(treffer, soll.length, ist.length),
    jeTyp: Object.fromEntries(Object.entries(typTreffer).map(([k, v]) => [k, { ...v, f1: f1(v.treffer, v.soll, v.ist) }])) };
}

export interface GoldErgebnis {
  exposes: number;
  felder: Record<GoldFeld, Record<GoldUrteil, number>>;
  gesamt: Record<GoldUrteil, number> & { genauigkeit: number | null };
  einheiten: { exposes: number; soll: number; ist: number; treffer: number; f1: number | null; jeTyp: Record<string, { soll: number; ist: number; treffer: number; f1: number | null }> };
}

/** Vergleich über alle Exposés; `ergebnisse` je Exposé-Nr. (fehlt eines, zählt alles als ausgelassen). */
export function goldVergleich(gold: GoldExpose[], ergebnisse: Map<number, { pruefdaten: ExtrahiertV0; details?: Record<string, unknown> }>): GoldErgebnis {
  const leerZaehler = (): Record<GoldUrteil, number> => ({ richtig: 0, falsch: 0, ausgelassen: 0, erfunden: 0, richtigLeer: 0 });
  const felder = Object.fromEntries(GOLD_FELDER.map((f) => [f, leerZaehler()])) as GoldErgebnis['felder'];
  const gesamt = leerZaehler();
  const eh = { exposes: 0, soll: 0, ist: 0, treffer: 0, jeTyp: {} as GoldErgebnis['einheiten']['jeTyp'] };
  for (const g of gold) {
    const e = ergebnisse.get(g.nr);
    const ist = e ? goldIst(e.pruefdaten, e.details) : {};
    for (const [f, soll] of Object.entries(g.soll) as [GoldFeld, string | number | null][]) {
      const u = feldUrteil(f, soll, ist[f]);
      felder[f][u]++; gesamt[u]++;
    }
    if (g.einheiten) {
      const t = einheitenTreffer(g.einheiten, e?.pruefdaten.objekt?.einheiten ?? []);
      eh.exposes++; eh.soll += t.soll; eh.ist += t.ist; eh.treffer += t.treffer;
      for (const [typ, v] of Object.entries(t.jeTyp)) {
        const z = (eh.jeTyp[typ] ??= { soll: 0, ist: 0, treffer: 0, f1: null });
        z.soll += v.soll; z.ist += v.ist; z.treffer += v.treffer;
      }
    }
  }
  const f1 = (tr: number, s: number, i: number) => (s + i ? +((2 * tr) / (s + i)).toFixed(3) : null);
  for (const z of Object.values(eh.jeTyp)) z.f1 = f1(z.treffer, z.soll, z.ist);
  const bewertet = gesamt.richtig + gesamt.falsch + gesamt.ausgelassen + gesamt.erfunden + gesamt.richtigLeer;
  return {
    exposes: gold.length, felder,
    gesamt: { ...gesamt, genauigkeit: bewertet ? +((gesamt.richtig + gesamt.richtigLeer) / bewertet).toFixed(3) : null },
    einheiten: { ...eh, f1: f1(eh.treffer, eh.soll, eh.ist) },
  };
}

/** Markdown-Tabelle; mehrere Ergebnisse nebeneinander (z. B. v0 | v2). */
export function goldAlsMarkdown(ergebnisse: Record<string, GoldErgebnis>): string {
  const namen = Object.keys(ergebnisse);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '–');
  const zeilen = [`| Feld | ${namen.join(' | ')} |`, `|---|${namen.map(() => '---:').join('|')}|`];
  for (const f of GOLD_FELDER) {
    const zellen = namen.map((n) => { const z = ergebnisse[n]!.felder[f]; const b = z.richtig + z.falsch + z.ausgelassen + z.erfunden + z.richtigLeer;
      return b ? `${pct(z.richtig + z.richtigLeer, b)} (${z.falsch} f · ${z.ausgelassen} a · ${z.erfunden} e)` : '–'; });
    zeilen.push(`| ${f} | ${zellen.join(' | ')} |`);
  }
  zeilen.push(`| **gesamt** | ${namen.map((n) => { const g = ergebnisse[n]!.gesamt; return g.genauigkeit === null ? '–' : `**${Math.round(g.genauigkeit * 100)} %**`; }).join(' | ')} |`);
  zeilen.push(`| Einheiten F1 | ${namen.map((n) => { const e = ergebnisse[n]!.einheiten; return e.f1 === null ? '–' : `${e.f1} (${e.treffer}/${e.soll} Soll, ${e.ist} Ist)`; }).join(' | ')} |`);
  const typen = [...new Set(namen.flatMap((n) => Object.keys(ergebnisse[n]!.einheiten.jeTyp)))];
  for (const t of typen) zeilen.push(`| Einheiten ${t} F1 | ${namen.map((n) => { const z = ergebnisse[n]!.einheiten.jeTyp[t]; return z?.f1 == null ? '–' : `${z.f1} (${z.treffer}/${z.soll})`; }).join(' | ')} |`);
  return `${zeilen.join('\n')}\n\nf = falsch · a = ausgelassen (steht im Exposé, fehlt im Ergebnis) · e = erfunden (steht nicht im Exposé)\n`;
}
