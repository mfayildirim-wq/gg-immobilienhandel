import { describe, expect, it } from 'vitest';
import {
  type Begleitschein, bsAktionenAufraeumen, bsAktionenFuer, bsAktionErgebnis, bsArchivDatum, bsEigenePunkte, bsGruppiert, bsPlatzhalter,
  bsSeedAktionen, bsSeedVorlage, bsVordruckVerwendung, BS_ABSCHLUSS_ID, type BsAktion,
} from '../src/index.ts';

const bs = (over: Partial<Begleitschein> = {}): Begleitschein => ({
  id: 'b1', typ: 'ankauf', objektId: 'o1', adresse: 'Poststraße 57, 71032 Böblingen', name: 'Poststraße_57_Böblingen_Ankauf_IVT', kopf: '',
  rows: bsSeedVorlage('ankauf').rows, createdAt: '2026-01-01', ...over,
});
const aktion = (over: Partial<BsAktion>): BsAktion => ({ id: 'a', label: 'Aktion', typ: 'link', aktiv: true, rowId: 'r14', ...over });
const heute = new Date('2026-09-17T22:30:00Z'); // in Berlin schon der 18.

describe('Auslieferung der Aktionen (§W)', () => {
  it('hängt 38 Aktionen an die Ankaufsvorlage, je Unterpunkt von R105 ein Brief', () => {
    const a = bsSeedAktionen();
    expect(a).toHaveLength(38);
    expect(bsAktionenFuer(a, 'r105')).toEqual([]);
    expect(bsAktionenFuer(a, 'r105', 'r105s5').map(x => x.label)).toEqual(['Anschreiben Schornsteinfeger']);
    const ids = new Set(bsSeedVorlage('ankauf').rows.flatMap(r => [r.id, ...r.sub.map(s => `${r.id} ${s.id}`)]));
    expect(a.every(x => ids.has(x.subId ? `${x.rowId} ${x.subId}` : x.rowId))).toBe(true);
  });
  it('blendet inaktive Aktionen aus (Y3d)', () => {
    expect(bsAktionenFuer([aktion({ aktiv: false })], 'r14')).toEqual([]);
  });
});

describe('Aufräumen (Prüfbefund P17)', () => {
  const seed = bsSeedVorlage('ankauf');
  it('Aktionen an gelöschten oder selbst angelegten Punkten fallen weg', () => {
    const eigen = { ...seed, rows: [...seed.rows, { id: 'p-eigen', lvl: 1 as const, text: 'Mein Punkt', verantwortung: '', status: 'offen' as const, sub: [] }] };
    const liste = [aktion({ id: 'a1', rowId: 'p-eigen' }), aktion({ id: 'a2', rowId: seed.rows[0]!.id })];
    expect(bsEigenePunkte('ankauf', eigen)).toBe(1);
    expect(bsAktionenAufraeumen(eigen, liste).entfernt).toBe(0);
    const r = bsAktionenAufraeumen(seed, liste); // nach Zurücksetzen
    expect(r).toEqual({ aktionen: [liste[1]], entfernt: 1 });
  });
  it('prüft Unterpunkte mit', () => {
    expect(bsAktionenAufraeumen(seed, [aktion({ rowId: 'r105', subId: 'r105s99' })]).entfernt).toBe(1);
  });
  it('zählt Verwendungen eines Vordrucks', () => {
    expect(bsVordruckVerwendung([aktion({ vordruckId: 'v1' }), aktion({ vordruckId: 'v1' }), aktion({})], 'v1')).toBe(2);
  });
});

describe('Archiv (D3/D4)', () => {
  const mitStatus = (status: 'offen' | 'erledigt') => bs({ rows: bs().rows.map(r => (r.id === BS_ABSCHLUSS_ID ? { ...r, status } : r)) });
  it('setzt das Archivdatum einmal und nimmt es beim Zurücknehmen weg', () => {
    expect(bsArchivDatum(mitStatus('erledigt'), null, '2026-09-17')).toBe('2026-09-17');
    expect(bsArchivDatum(mitStatus('erledigt'), '2026-01-01', '2026-09-17')).toBe('2026-01-01');
    expect(bsArchivDatum(mitStatus('offen'), '2026-01-01', '2026-09-17')).toBeNull();
  });
});

describe('Übersicht (B8/B9)', () => {
  it('gruppiert nach Objekt-Adresse, Ankauf vor Verkauf, ohne Objekt zuletzt', () => {
    const g = bsGruppiert([
      { objektId: 'o2', typ: 'verkauf', name: 'B' }, { objektId: 'o2', typ: 'ankauf', name: 'Z' }, { objektId: 'o1', typ: 'verkauf', name: 'A' }, { objektId: '', typ: 'ankauf', name: 'X' },
    ], (id) => ({ o1: 'Zeppelinweg 1', o2: 'Amselweg 2' } as Record<string, string>)[id] ?? '');
    expect(g.map(([k, l]) => [k, l.map(x => x.name)])).toEqual([['o2', ['Z', 'B']], ['o1', ['A']], ['_', ['X']]]);
  });
});

describe('Platzhalter (M)', () => {
  it('ersetzt bekannte Platzhalter unabhängig von Groß-/Kleinschreibung, Unbekanntes bleibt', () => {
    const t = bsPlatzhalter('{Adresse} · {strasse} {hausnr}, {plz} {stadt} · Whg {whgnr} · {datum} · {unbekannt}', bs({ whgNr: '02' }), { strasse: 'Poststraße', hausnr: '57', plz: '71032', stadt: 'Böblingen' }, heute);
    expect(t).toBe('Poststraße 57, 71032 Böblingen · Poststraße 57, 71032 Böblingen · Whg 02 · 18.9.2026 · {unbekannt}');
  });
});

describe('Aktionen ausführen (N1)', () => {
  const k = { objekt: { strasse: 'Poststraße', hausnr: '57', stadt: 'Böblingen', baujahr: 1965, wohnflaeche: 480, einheitenAnz: 6 }, deal: null, vordrucke: [], heute };
  it('Link und Modul brauchen ein Ziel', () => {
    expect(bsAktionErgebnis(bs(), aktion({ url: undefined }), k)).toEqual({ art: 'fehler', meldung: 'Für diese Aktion ist noch keine Adresse hinterlegt' });
    expect(bsAktionErgebnis(bs(), aktion({ url: 'https://x.de' }), k)).toEqual({ art: 'link', url: 'https://x.de' });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'modul', modul: 'deal-kalkulation' }), k)).toEqual({ art: 'fehler', meldung: 'Kein Deal verknüpft' });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'modul', modul: 'deal-kalkulation' }), { ...k, deal: { id: 'd1' } })).toEqual({ art: 'modul', modul: 'deal-kalkulation', dealId: 'd1' });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'modul', modul: 'gibtsnicht' }), k).art).toBe('fehler');
  });
  it('Mail: Betreff mit {adresse}, Leerzeichen als %20', () => {
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'mail', empfaenger: 'a@b.de', betreff: 'Objekt {adresse}' }), k))
      .toEqual({ art: 'mail', href: 'mailto:a%40b.de?subject=Objekt%20Poststra%C3%9Fe%2057%2C%2071032%20B%C3%B6blingen' });
  });
  it('Daten: Objekt, Deal und Kalkulation (nur lesend)', () => {
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'daten', datenQuelle: 'objekt', label: 'Objekt' }), k)).toEqual({ art: 'anzeige', titel: 'Objekt', tabelle: [
      ['Adresse', 'Poststraße 57, Böblingen'], ['Baujahr', '1965'], ['Wohnfläche', '480 m²'], ['Einheiten', '6'],
    ] });
    const deal = { id: 'd1', status: 'Angekauft', kalk: { kaufpreis: 900000, notar: 2 }, einheiten: [{ fl: 80, mi_ist: 800 }], sanierung: [] };
    const kalk = bsAktionErgebnis(bs(), aktion({ typ: 'daten', label: 'Budget' }), { ...k, deal });
    expect(kalk.art === 'anzeige' && kalk.tabelle?.[1]).toEqual(['Kaufpreis', '900.000 €']);
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'daten', datenQuelle: 'deal' }), { ...k, deal })).toMatchObject({ tabelle: [['Status', 'Angekauft'], ['Adresse', 'Poststraße 57 Böblingen'], ['Einheiten', '1']] });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'daten' }), { ...k, deal: { id: 'd', kalk: {} } })).toEqual({ art: 'fehler', meldung: 'Keine Kalkulation im Deal hinterlegt' });
  });
  it('Vordruck: Entwurf mit Platzhaltern, Datei nur mit Namen, fehlender Vordruck mit Hinweis', () => {
    const vordrucke = [
      { id: 'v1', nummer: 'F065', titel: 'Anschreiben', art: 'brief' as const, inhalt: 'Betreff: {adresse}', aktiv: true },
      { id: 'v2', nummer: 'F079', titel: 'Impower', art: 'datei' as const, dateiName: 'impower.xlsx', aktiv: true },
    ];
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'vordruck-brief', vordruckId: 'v1' }), { ...k, vordrucke })).toMatchObject({ titel: 'F065 — Anschreiben', text: 'Betreff: Poststraße 57, 71032 Böblingen' });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'vordruck-datei', vordruckId: 'v2' }), { ...k, vordrucke })).toMatchObject({ datei: 'impower.xlsx' });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'vordruck-brief', vordruckId: 'weg', label: 'Brief' }), k)).toMatchObject({ titel: 'Brief', hinweis: expect.stringContaining('noch kein Vordruck') });
    expect(bsAktionErgebnis(bs(), aktion({ typ: 'analyse', analyseTyp: 'mietvertraege' }), k)).toMatchObject({ hinweis: expect.stringContaining('„Mietverträge und Nachträge“') });
  });
});
