import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dublettenDeal, dublettenMakler, dublettenObjekt, emailPruefen, exposeVorbereiten, istMobilnummer, telefonNormalisieren, telefonPruefen,
} from '../src/index.ts';

/** Golden Master: Dubletten (dedup.ts), Telefon/E-Mail (utils.ts), Vorbereitung nach der Analyse (ewDoAnalyse). */
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/expose-uebernahme.json'), 'utf8')) as { faelle: any[] };

describe.each(faelle.map((f, i) => [f.name, f, i] as const))('Exposé-Übernahme %s = alte App', (_n, f, i) => {
  const e = f.eingabe;
  it('Dubletten Objekt, Makler, Deal', () => {
    expect(JSON.parse(JSON.stringify(dublettenObjekt(e.objs, e.suche)))).toEqual(f.ergebnis.objekt);
    expect(JSON.parse(JSON.stringify(dublettenMakler(e.makler, e.mkSuche, e.absender)))).toEqual(f.ergebnis.makler);
    const deals: { id: string; objId: string; objektId: string; maklerId: string | null }[] = e.deals.map((d: any) => ({ ...d, objektId: d.objId }));
    const [o, m] = i % 2 ? ['o0', 'm0'] : ['o1', ''];
    const neu = dublettenDeal(deals, o, m);
    expect(neu ? { id: neu.id, objId: neu.objId, maklerId: neu.maklerId } : null).toEqual(f.ergebnis.deal);
  });

  it('Telefon und E-Mail', () => {
    for (const t of f.ergebnis.telefon) {
      expect({ t: t.t, pruef: telefonPruefen(t.t), norm: telefonNormalisieren(t.t), mobil: istMobilnummer(t.t) }).toEqual(t);
    }
    expect(['a@b.de', 'a@b', 'a b@c.de', '', undefined].map((x) => emailPruefen(x))).toEqual(f.ergebnis.email);
  });

  // Fachentscheidung 16.10.2026 (Protokoll 31 §8.4): die alte App verteilte fehlende Flächen gleichmäßig und fehlende Mieten nach
  // Fläche auf die Einheiten; der Neubau verteilt nicht mehr (Gesamtwert in die erste offene Zeile, siehe
  // expose-einheiten-gesamtwert.test.ts). Die Einheiten sind deshalb aus dem Vergleich genommen; der Golden Master selbst bleibt.
  it('Vorbereitung: Objektfelder, Telefonwahl, Deal-Vorwerte (Einheiten: bewusste Abweichung, eigener Test)', () => {
    const v = exposeVorbereiten(structuredClone(e.extrahiert));
    const ohneEinheiten = (o: Record<string, unknown>) => { const { einheiten: _e, ...rest } = o; return rest; };
    const ist = JSON.parse(JSON.stringify({ ewObjData: ohneEinheiten(v.objekt), ewMkData: v.makler, ewDealData: v.deal }));
    const soll = { ...f.ergebnis.vorbereitet, ewObjData: ohneEinheiten(f.ergebnis.vorbereitet.ewObjData) };
    expect(ist).toEqual(soll);
  });
});
