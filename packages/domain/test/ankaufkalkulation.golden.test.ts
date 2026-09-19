import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AnkaufErgebnis, berechneAnkauf, type KalkStandard } from '../src/index.ts';

/**
 * Golden Master gegen den Originalcode der alten App (werkzeuge/golden-master/erzeugen.ts).
 * `anzeigeWieAlt` setzt aus den Engine-Zahlen dieselben Texte zusammen, die `dealKalkRC` ins DOM schrieb.
 * Stimmt jeder Text in jedem Fall, rechnet die Engine wie die alte App (auf die angezeigte Stelle genau);
 * die zurückgeschriebenen Kennzahlen und Ampelwerte werden zusätzlich exakt verglichen.
 */
interface Fall {
  name: string;
  eingabe: { kalk: Record<string, unknown>; einheiten: Record<string, unknown>[]; sanierung: Record<string, unknown>[]; standard: KalkStandard };
  anzeige: Record<string, string>;
  ampel: Record<string, number>;
  ergebnis: Record<string, number>;
}
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/ankaufkalkulation.json'), 'utf8')) as { faelle: Fall[] };

const de = (n: number) => n.toLocaleString('de-DE');
const eur = (v: number) => (v ? `${de(Math.round(v))} €` : '');
const eurStrich = (v: number) => (v ? `${de(Math.round(v))} €` : '–');

function anzeigeWieAlt(r: AnkaufErgebnis, k: Record<string, unknown>, s: KalkStandard): Record<string, string> {
  const e = r.einheiten;
  const a = r.aufteiler, g = r.global;
  const wf = e.wohnflaeche;
  const jnkmIst = r.jahresmieteIst;
  const kp = r.kaufpreis, zs1 = r.anschaffungskosten;
  const sub = (betrag: number, art: string) => (betrag ? `auf ${de(Math.round(betrag))} € ${art}` : `kein ${art === 'Fremdkapital' ? 'FK' : 'EK'} aktiv`);
  const pct = `${(r.bankAbschlussPct || 0).toFixed(2).replace('.', ',')} % auf FK`;
  const mabzug = r.mietabzug ? `– ${de(Math.round(r.mietabzug))} €` : '';
  void k; void s;
  return {
    'dk-sum-einh': e.anzahlEinheiten ? `${e.anzahlEinheiten} Einh.` : '–',
    'dk-sum-stpl': e.anzahlStellplaetze ? `${e.anzahlStellplaetze} Stpl.` : '–',
    'dk-sf': wf ? `${de(wf)} m²` : '–',
    'dk-mi': eurStrich(e.mieteIst),
    'dk-avg-kqm-ist': wf && e.mieteIst ? `${(e.mieteIst / wf).toFixed(2)} €/m²` : '–',
    'dk-mn': eurStrich(e.mieteSoll),
    'dk-avg-kqm-soll': wf && e.mieteSoll ? `${(e.mieteSoll / wf).toFixed(2)} €/m²` : '–',
    'dk-avg-rendite': e.verkaufspreise && e.mieteSoll ? `${(((e.mieteSoll * 12) / e.verkaufspreise) * 100).toFixed(1)}%` : '–',
    'dk-kp2': eurStrich(e.verkaufspreise),
    'dk-avg-kpm2': wf && e.verkaufspreise ? `${de(Math.round(e.verkaufspreise / wf))} €/m²` : '–',
    'r-notar': eur(r.notar),
    'r-gest': eur(r.grunderwerbsteuer),
    'r-makler': eur(r.maklerprovision),
    'r-zs1': eur(zs1),
    'r-kpm2-kp': wf && kp ? `${de(Math.round(kp / wf))} €/m²` : '–',
    'r-rendite-kp': kp && jnkmIst ? `${((jnkmIst / kp) * 100).toFixed(2)}%` : '–',
    'r-kpm2-ak': wf && zs1 ? `${de(Math.round(zs1 / wf))} €/m²` : '–',
    'r-rendite-ak': zs1 && jnkmIst ? `${((jnkmIst / zs1) * 100).toFixed(2)}%` : '–',
    'r-mabzug': mabzug,
    'r-san-netto': eur(r.sanierungNetto),
    'r-san-puffer': eur(r.sanierungPuffer),
    'r-santot': eurStrich(r.sanierungNetto + r.sanierungPuffer),
    'r-gik': eur(a.gik),
    'r-gikm2': wf && a.gik ? `${de(Math.round(a.gik / wf))} €/m²` : '',
    'r-mietrendite-gik': a.gik && r.jahresnettokaltmieteSoll ? `${((r.jahresnettokaltmieteSoll / a.gik) * 100).toFixed(2)}%` : '',
    'r-avkp': eurStrich(a.verkaufspreis),
    'r-avkp-m2': a.verkaufspreis && wf ? `${de(Math.round(a.verkaufspreis / wf))} €/m²` : '–',
    'r-agew': eurStrich(a.gewinn),
    'r-amarge': a.marge ? `${a.marge.toFixed(1)}%` : '–',
    'r-gvkp': eurStrich(g.verkaufspreis),
    'r-gvkp-m2': g.verkaufspreis && wf ? `${de(Math.round(g.verkaufspreis / wf))} €/m²` : '–',
    'r-gjnkm': eurStrich(r.jahresnettokaltmieteSoll),
    'r-gfak': g.faktor ? `${g.faktor.toFixed(1)}x` : '–',
    'r-gkr': g.kaufpreisrendite ? `${g.kaufpreisrendite.toFixed(2)}%` : '–',
    'r-ggew': eurStrich(g.gewinn),
    'r-gmarge': g.marge ? `${g.marge.toFixed(1)}%` : '–',
    'ha-kp': eurStrich(kp), 'ha-notar': eurStrich(r.notar), 'ha-gest': eurStrich(r.grunderwerbsteuer), 'ha-makler': eurStrich(r.maklerprovision), 'ha-zs1': eurStrich(zs1),
    'ha-fkz': eurStrich(a.fkZinsen), 'ha-bankabgeb': eurStrich(a.bankAbschluss), 'ha-ekk': eurStrich(a.ekKosten),
    'ha-fkz-sub': sub(a.fremdkapital, 'Fremdkapital'), 'ha-bankabgeb-sub': pct, 'ha-ekk-sub': sub(a.eigenkapital, 'Eigenkapital'),
    'ha-miet': mabzug || '–',
    'ha-san-netto': eurStrich(a.sanierung), 'ha-san-puffer': a.sanierung && a.sanierungPuffer / a.sanierung ? eurStrich(a.sanierungPuffer) : '–',
    'ha-vprov': eurStrich(r.vertriebsprovision), 'ha-teilung': eurStrich(r.teilungskosten), 'ha-hk-sum': eurStrich(a.herstellkosten),
    'ha-gik': eurStrich(a.gik), 'ha-gik-m2': a.gik && wf ? `${de(Math.round(a.gik / wf))} €/m²` : '–',
    'hg-kp': eurStrich(kp), 'hg-notar': eurStrich(r.notar), 'hg-gest': eurStrich(r.grunderwerbsteuer), 'hg-makler': eurStrich(r.maklerprovision), 'hg-zs1': eurStrich(zs1),
    'hg-fkz': eurStrich(g.fkZinsen), 'hg-bankabgeb': eurStrich(g.bankAbschluss), 'hg-ekk': eurStrich(g.ekKosten),
    'hg-fkz-sub': sub(g.fremdkapital, 'Fremdkapital'), 'hg-bankabgeb-sub': pct, 'hg-ekk-sub': sub(g.eigenkapital, 'Eigenkapital'),
    'hg-miet': mabzug || '–',
    'hg-san-netto': eurStrich(g.sanierung), 'hg-san-puffer': g.sanierung && g.sanierungPuffer / g.sanierung ? eurStrich(g.sanierungPuffer) : '–',
    'hg-hk-sum': eurStrich(g.herstellkosten), 'hg-gik': eurStrich(g.gik), 'hg-gik-m2': g.gik && wf ? `${de(Math.round(g.gik / wf))} €/m²` : '–',
  };
}

/** JSON kennt kein −0: der gespeicherte Golden Master hat dort 0, die Rechnung liefert −0. Fachlich gleich. */
const ohneMinusNull = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 0 ? 0 : v]));

describe(`Ankaufskalkulation = alte App (${faelle.length} Fälle)`, () => {
  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const r = berechneAnkauf(f.eingabe.kalk, f.eingabe.einheiten, f.eingabe.sanierung, f.eingabe.standard);
    expect(anzeigeWieAlt(r, f.eingabe.kalk, f.eingabe.standard)).toEqual(f.anzeige);
    expect(ohneMinusNull(r.kennzahlen)).toEqual(f.ergebnis);
    expect(ohneMinusNull({ 'r-aamp': r.aufteiler.marge, 'r-gamp': r.global.marge })).toEqual(f.ampel);
  });
});
