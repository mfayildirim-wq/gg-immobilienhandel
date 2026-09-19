/**
 * Golden Master: Vorbelegung, Kalkulationszusammenfassung, Konsistenzprüfung und Standards der Bank-Präsentation
 * rechnen wie die alte App (erzeugt mit `pnpm golden:erzeugen` aus src/modules/finanzpraes/finanzpraes.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeDealKalkSummary, deckblattVorbelegen, type FinanzPraes, type FinanzpraesDefaults, finanzierungScope, finanzierungVorbelegen,
  finanzpraesCheckConsistency, folieVerschieben, leereFolie, mietenaufstellungVorbelegen, mitStandards, objektbeschreibungVorbelegen,
  projektkalkulationVorbelegen, type Slide, type SlideTyp, verkaufspreiseVorbelegen,
} from '../src/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Alt = any;
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/finanzpraesentation.json'), 'utf8')) as { faelle: Alt[] };
/** Wie im JSON: undefined fällt weg, NaN wird null. */
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const TYPEN: SlideTyp[] = ['deckblatt', 'objektbeschreibung', 'projektkalkulation', 'verkaufspreise', 'mietenaufstellung', 'finanzierungsstruktur', 'organigramm', 'abschluss', 'geschaeftsmodell'];

describe('Bank-Präsentation (Golden Master)', () => {
  it('hat Fälle', () => expect(faelle.length).toBe(120));

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const { deal, objekt, scope, confirm, spalten } = f.eingabe;
    const defaults = f.eingabe.defaults as FinanzpraesDefaults;
    const aendere = (p: FinanzPraes, id: string, neu: Record<string, unknown> | null): FinanzPraes =>
      neu ? { ...p, slides: p.slides.map((s) => (s.id === id ? { ...s, data: neu } : s)) } : p;
    const daten = (p: FinanzPraes, id: string) => p.slides.find((s) => s.id === id)!.data;

    // Anlegen
    const folien: Slide[] = TYPEN.map((t, i) => leereFolie(t, defaults, `f${i}`));
    if (f.angelegt.slides[5].data.kreditnehmer) folien[5]!.data.kreditnehmer = f.angelegt.slides[5].data.kreditnehmer;
    let p: FinanzPraes = { id: 'p1', dealId: 'd1', bankName: 'Testbank', slides: folien, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
    expect(json(p)).toEqual(f.angelegt);

    expect(json(computeDealKalkSummary(deal, 'aufteiler'))).toEqual(f.ergebnisse.summaryAufteiler);
    expect(json(computeDealKalkSummary(deal, 'global'))).toEqual(f.ergebnisse.summaryGlobal);

    // Vorbelegung in derselben Reihenfolge wie der Generator
    p = aendere(p, 'f0', deckblattVorbelegen(daten(p, 'f0'), deal, objekt));
    p = aendere(p, 'f1', objektbeschreibungVorbelegen(daten(p, 'f1'), deal, objekt));
    if (f.nachVorbelegung.slides[2].data.tableRows || JSON.stringify(f.nachVorbelegung.slides[2].data) !== JSON.stringify(f.angelegt.slides[2].data)) {
      p = aendere(p, 'f2', projektkalkulationVorbelegen(daten(p, 'f2'), deal, scope));
    } else if (projektkalkulationVorbelegen(daten(p, 'f2'), deal, scope) !== null) {
      // Generator hat den Schritt ausgelassen (Zufall) – nur dann ist „unverändert“ korrekt
      expect(f.nachVorbelegung.slides[2].data).toEqual(f.angelegt.slides[2].data);
    }
    p = aendere(p, 'f3', verkaufspreiseVorbelegen(daten(p, 'f3'), deal));
    p = aendere(p, 'f4', mietenaufstellungVorbelegen(daten(p, 'f4'), deal, spalten));
    expect(json(p)).toEqual(f.nachVorbelegung);

    const s = finanzierungScope(p) ?? (confirm ? 'aufteiler' : 'global');
    p = aendere(p, 'f5', finanzierungVorbelegen(daten(p, 'f5'), deal, s));
    expect(json(p)).toEqual(f.nachFinanzierung);

    const vor = f.vorKonsistenz as FinanzPraes;
    expect(json(finanzpraesCheckConsistency(vor))).toEqual(f.ergebnisse.konsistenz);
    expect(json(mitStandards(vor, defaults))).toEqual(f.ergebnisse.mitStandards);
    const bewegt = f.verschiebung as string[];
    const kandidaten = ['f0', 'f3', 'f8', 'fehlt'].flatMap((id) => [-1, 1, 3].map((d) => folieVerschieben(vor.slides, id, d).map((x) => x.id)));
    expect(kandidaten).toContainEqual(bewegt);
  });
});
