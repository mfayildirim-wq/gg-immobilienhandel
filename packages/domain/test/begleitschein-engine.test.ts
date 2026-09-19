// Port von gg-immohandel src/lib/begleitscheinEngine.test.ts
import { describe, it, expect } from 'vitest';
import {
  bsSeedVorlage, bsZaehler, bsName, bsAdresseAusObjekt, bsAusVorlage,
  bsArchivStatus, bsUnbearbeitet, bsAnker, bsAenderungen, bsAenderungAnwenden,
  bsVerschieben, bsZeileLoeschen, bsZeileEinfuegen,
  BS_ABSCHLUSS_ID, BS_STATUS, BS_EBENE_FARBE, BS_STATUS_FARBE,
  type BsRow, type Begleitschein,
} from '../src/begleitscheine/engine.ts';

const row = (id: string, text = id, over: Partial<BsRow> = {}): BsRow =>
  ({ id, lvl: 2, text, verantwortung: '', status: 'offen', sub: [], ...over });

describe('§G Auslieferungsvorlage', () => {
  const v = bsSeedVorlage('ankauf');

  it('enthält 122 Punkte, 10 Überpunkte und den Abschlusspunkt', () => {
    expect(v.rows.length).toBe(133);
    expect(v.rows.filter(r => r.lvl === 1).length).toBe(11); // 10 Überpunkte + Abschluss
  });

  it('schliesst mit dem festen Abschlusspunkt (D1/D2)', () => {
    const last = v.rows[v.rows.length - 1]!;
    expect(last.id).toBe(BS_ABSCHLUSS_ID);
    expect(last.text).toBe('vollständig abgearbeitet');
    expect(last.fix).toBe(true);
  });

  it('startet komplett auf offen', () => {
    expect(v.rows.every(r => r.status === 'offen')).toBe(true);
  });

  it('übernimmt gefüllte Spiegelstriche als Unterpunkte (B18)', () => {
    const r105 = v.rows.find(r => r.id === 'r105')!;
    expect(r105.sub.map(s => s.text)).toContain('Schornsteinfeger');
    expect(r105.sub.length).toBe(9);
  });

  it('lässt leere Spiegelstriche ersatzlos entfallen (B18)', () => {
    expect(v.rows.find(r => r.id === 'r121')!.sub).toEqual([]);
  });

  it('enthält die gestrichenen Punkte nicht mehr (W10)', () => {
    for (const id of ['r116', 'r126', 'r127', 'r128', 'r142']) {
      expect(v.rows.find(r => r.id === id)).toBeUndefined();
    }
  });

  it('behält Vordruckverweise im Text (G2e)', () => {
    expect(v.rows.find(r => r.id === 'r105')!.text).toContain('F065');
  });
});

describe('§I/§J Farben und Status', () => {
  it('kennt exakt drei Status in der Schreibweise der Excel', () => {
    expect(BS_STATUS).toEqual(['offen', 'In Progress', 'erledigt']);
  });
  it('nutzt die Excel-Farben unverändert', () => {
    expect(BS_STATUS_FARBE).toEqual({ 'offen': '#FF0000', 'In Progress': '#FFFF00', 'erledigt': '#00B050' });
    expect(BS_EBENE_FARBE).toEqual({ 1: '#808080', 2: '#D9D9D9', 3: '#F2F2F2' });
  });
});

describe('§J6 Zählerblock', () => {
  it('zählt nur Punkte, keine Unterpunkte (B17)', () => {
    const rows = [
      row('a', 'a', { status: 'offen', sub: [{ id: 's1', text: 'x', status: 'erledigt' }] }),
      row('b', 'b', { status: 'In Progress' }),
      row('c', 'c', { status: 'erledigt' }),
      row('d', 'd', { status: 'erledigt' }),
    ];
    expect(bsZaehler(rows)).toEqual({ summe: 4, offen: 1, inProgress: 1, erledigt: 2 });
  });
});

describe('§C Benennung', () => {
  it('verbindet Adresse, Typ und Name mit Unterstrichen', () => {
    expect(bsName({ strasse: 'Poststraße', hausnr: '57', stadt: 'Böblingen' }, 'verkauf', 'IVT Wohnen', '02'))
      .toBe('Poststraße_57_Böblingen_Verkauf_02_IVT Wohnen');
  });
  it('lässt die Wohnungsnummer beim Ankauf weg (C4)', () => {
    expect(bsName({ strasse: 'Poststraße', hausnr: '57', stadt: 'Böblingen' }, 'ankauf', 'Projekt A', '02'))
      .toBe('Poststraße_57_Böblingen_Ankauf_Projekt A');
  });
  it('zieht die Adresse aus dem Objekt (C7)', () => {
    expect(bsAdresseAusObjekt({ strasse: 'Poststraße', hausnr: '57', plz: '71032', stadt: 'Böblingen' }))
      .toBe('Poststraße 57, 71032 Böblingen');
    expect(bsAdresseAusObjekt(undefined)).toBe('');
  });
});

describe('§E4 Vorlage → Begleitschein', () => {
  it('kopiert die Vorlage vollständig', () => {
    const v = bsSeedVorlage('ankauf');
    const bs = bsAusVorlage(v, { typ: 'ankauf', objektId: 'o1', adresse: 'A', name: 'N' }, 'b1', '2026-01-01');
    expect(bs.rows.length).toBe(v.rows.length);
    expect(bs.kopf).toBe(v.kopf);
  });
  it('kappt die Verbindung zur Vorlage (eigene Objekte)', () => {
    const v = bsSeedVorlage('ankauf');
    const bs = bsAusVorlage(v, { typ: 'ankauf', objektId: 'o1', adresse: 'A', name: 'N' }, 'b1', '2026-01-01');
    bs.rows[0]!.text = 'geändert';
    expect(v.rows[0]!.text).not.toBe('geändert');
  });
});

describe('§D Archiv', () => {
  const mk = (status: BsRow['status']): Begleitschein => ({
    id: 'b1', typ: 'ankauf', objektId: 'o1', adresse: 'A', name: 'N', kopf: '',
    rows: [row('r1'), row(BS_ABSCHLUSS_ID, 'vollständig abgearbeitet', { status, fix: true })],
    createdAt: '2026-01-01',
  });
  it('archiviert über den Abschlusspunkt (D3) und ist reversibel (D4)', () => {
    expect(bsArchivStatus(mk('erledigt'))).toBe(true);
    expect(bsArchivStatus(mk('offen'))).toBe(false);
  });
});

describe('§F Vorlagenänderung', () => {
  it('F4 — unbearbeitet nur bei offen und unverändertem Text', () => {
    expect(bsUnbearbeitet(row('a', 'alt'), 'alt')).toBe(true);
    expect(bsUnbearbeitet(row('a', 'neu'), 'alt')).toBe(false);
    expect(bsUnbearbeitet(row('a', 'alt', { status: 'erledigt' }), 'alt')).toBe(false);
  });

  it('F14 — neuer Punkt hängt unter seinem Vorgänger aus der Vorlage', () => {
    const neu = [row('a'), row('b'), row('neu'), row('c')];
    expect(bsAnker(neu, 2, new Set(['a', 'b', 'c']))).toBe('b');
  });

  it('F15 — fehlt der Vorgänger, wandert der Anker nach oben', () => {
    const neu = [row('a'), row('b'), row('neu'), row('c')];
    expect(bsAnker(neu, 2, new Set(['a', 'c']))).toBe('a');
    expect(bsAnker(neu, 2, new Set(['c']))).toBeNull();
  });

  it('erkennt neue, geänderte und gelöschte Punkte', () => {
    const alt = [row('a', 'A'), row('b', 'B')];
    const neuV = [row('a', 'A neu'), row('c', 'C')];
    const bs: Begleitschein = {
      id: 'b1', typ: 'ankauf', objektId: 'o', adresse: '', name: 'N', kopf: '',
      rows: [row('a', 'A'), row('b', 'B')], createdAt: '2026-01-01',
    };
    const diff = bsAenderungen(alt, neuV, bs);
    expect(diff.find(d => d.typ === 'text')?.rowId).toBe('a');
    expect(diff.find(d => d.typ === 'neu')?.rowId).toBe('c');
    expect(diff.find(d => d.typ === 'geloescht')?.rowId).toBe('b');
    expect(diff.every(d => d.unbearbeitet)).toBe(true);
  });

  it('meldet bearbeitete Punkte als nicht automatisch änderbar (F5)', () => {
    const alt = [row('a', 'A')];
    const neuV = [row('a', 'A neu')];
    const bs: Begleitschein = {
      id: 'b1', typ: 'ankauf', objektId: 'o', adresse: '', name: 'N', kopf: '',
      rows: [row('a', 'A', { status: 'erledigt' })], createdAt: '2026-01-01',
    };
    expect(bsAenderungen(alt, neuV, bs)[0]!.unbearbeitet).toBe(false);
  });

  it('schützt den Abschlusspunkt vor dem Löschvorschlag (D2)', () => {
    const alt = [row(BS_ABSCHLUSS_ID, 'x', { fix: true })];
    const bs: Begleitschein = {
      id: 'b1', typ: 'ankauf', objektId: 'o', adresse: '', name: 'N', kopf: '',
      rows: [row(BS_ABSCHLUSS_ID, 'x', { fix: true })], createdAt: '2026-01-01',
    };
    expect(bsAenderungen(alt, [], bs)).toEqual([]);
  });

  it('fügt einen neuen Punkt an der Ankerposition ein', () => {
    const rows = [row('a'), row('c')];
    const vorlage = [row('a'), row('b'), row('c')];
    const out = bsAenderungAnwenden(rows, { typ: 'neu', rowId: 'b', neuText: 'b', unbearbeitet: true, ankerId: 'a' }, vorlage);
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('fügt ohne Anker ganz oben ein (F15)', () => {
    const out = bsAenderungAnwenden([row('c')], { typ: 'neu', rowId: 'a', neuText: 'a', unbearbeitet: true, ankerId: null }, [row('a'), row('c')]);
    expect(out.map(r => r.id)).toEqual(['a', 'c']);
  });
});

describe('§H Bearbeitung', () => {
  const rows = [row('a'), row('b'), row(BS_ABSCHLUSS_ID, 'ende', { fix: true })];

  it('H5 — verschiebt Zeilen', () => {
    expect(bsVerschieben(rows, 'a', 1).map(r => r.id)).toEqual(['b', 'a', BS_ABSCHLUSS_ID]);
  });
  it('H5 — der Abschlusspunkt bleibt unten (D2)', () => {
    expect(bsVerschieben(rows, 'b', 1).map(r => r.id)).toEqual(['a', 'b', BS_ABSCHLUSS_ID]);
    expect(bsVerschieben(rows, BS_ABSCHLUSS_ID, -1).map(r => r.id)).toEqual(['a', 'b', BS_ABSCHLUSS_ID]);
  });
  it('H2 — löscht Zeilen, aber nicht den Abschlusspunkt (D2)', () => {
    expect(bsZeileLoeschen(rows, 'a').map(r => r.id)).toEqual(['b', BS_ABSCHLUSS_ID]);
    expect(bsZeileLoeschen(rows, BS_ABSCHLUSS_ID).length).toBe(3);
  });
  it('H2 — fügt Zeilen ein, nie unter dem Abschlusspunkt', () => {
    expect(bsZeileEinfuegen(rows, 'a', 3).map(r => r.id).slice(0, 2)).toEqual(['a', expect.any(String)]);
    const angehaengt = bsZeileEinfuegen(rows, BS_ABSCHLUSS_ID, 2);
    expect(angehaengt[angehaengt.length - 1]!.id).toBe(BS_ABSCHLUSS_ID);
  });
  it('arbeitet unveränderlich', () => {
    const vorher = rows.map(r => r.id);
    bsVerschieben(rows, 'a', 1);
    bsZeileLoeschen(rows, 'a');
    bsZeileEinfuegen(rows, 'a', 2);
    expect(rows.map(r => r.id)).toEqual(vorher);
  });
});
