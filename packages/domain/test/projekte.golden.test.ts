/** Golden Master: Projekt anlegen, Checkliste und Einheitenliste bearbeiten, Karte/Finanzleiste/Summen wie in der alten App (pm.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KALK_STANDARD, PM_TODO_STATUS, PM_TODO_TEMPLATE, pmCheckliste, pmEinheitAendern, pmEinheitenSummen, pmFinanzleiste, pmGespraechEntfernen, pmGespraechHinzufuegen,
  pmGlobalAendern, pmKarte, pmKategorieEntferntHinweis, pmKategorieNeu, pmKategorieUmbenennen, pmMassnahmeNeu, pmProjektAnlegen, type PmProjekt, pmTodoAendern,
  pmTodoDarunter, pmTodoInKategorie, pmTodoLoeschen, pmTodoPasstZuFilter, pmTodoStatistik, pmZahlEingabe, pmZahlFeld,
} from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/projekte.json'), 'utf8')) as { faelle: any[]; vorlage: unknown; todoStatus: Record<string, { label: string }> };

// Vergleichsform wie im Generator (werkzeuge/golden-master/erzeugen.ts, pmNormal)
const PM_EINHEIT_FELDER = ['id', 'typ', 'lage', 'zimmer', 'fl', 'stk', 'teNr', 'kaltmiete', 'kmMoeglich', 'grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP', 'vstatus',
  'vertriebsstand', 'vermietet', 'mieterName', 'pip', 'pipStrategie', 'pipTodosText', 'mieterTodosText', 'reservDatum', 'notarDatum', 'kaeufer', 'vtKommentar'] as const;
const leer = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
function normal(p: PmProjekt) {
  return {
    ...Object.fromEntries((['id', 'dealId', 'adresse', 'stadt', 'datum', 'zielVKP', 'globalVstatus', 'globalIstKP', 'globalKommentar', 'globalKaeufer', 'globalNotarDatum', 'globalReservDatum'] as const).map((k) => [k, leer(p[k])])),
    todos: p.todos.map((t) => [t.id, t.cat, t.text, t.status, leer(t.kommentar), leer(t.verantwortlich), leer(t.faellig)]),
    einheiten: p.einheiten.map((e) => [...PM_EINHEIT_FELDER.map((k) => leer(e[k])), e.mieterHistorie.map((h) => [h.id, h.datum, h.inhalt, h.ergebnis])]),
    gebPIP: p.gebPIP.map((m) => [leer(m.text), leer(m.status), leer(m.verantw)]),
  };
}
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const pruefwert = (p: PmProjekt) => createHash('sha256').update(JSON.stringify(normal(p))).digest('hex');

describe('Projektmanagement (Golden Master)', () => {
  it('Checklistenvorlage und Statusnamen wörtlich', () => {
    expect(json(PM_TODO_TEMPLATE)).toEqual(g.vorlage);
    expect(PM_TODO_STATUS.map((s) => [s.wert, s.label])).toEqual(Object.entries(g.todoStatus).map(([k, v]) => [k, v.label]));
  });

  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    let zaehler = 0;
    const neu = pmProjektAnlegen(f.eingabe, f.deal, { ...KALK_STANDARD }, () => `neu${++zaehler}`);
    if ('fehler' in neu) throw new Error(neu.fehler);
    // IDs wie in der alten App: Projekt und Checklistenzeilen aus dem Zähler, Einheiten = Deal-Einheit
    let p: PmProjekt = { ...neu, id: f.angelegt.id, dealId: neu.dealId, todos: neu.todos.map((t, i) => ({ ...t, id: f.angelegt.todos[i][0] })), einheiten: neu.einheiten.map((e) => ({ ...e, id: e.dealEinheitId! })) };
    expect(json(normal(p))).toEqual(f.angelegt);

    for (const s of f.schritte) {
      const hinweise: string[] = [];
      const einheit = (id: string) => p.einheiten.find((e) => e.id === id)!;
      switch (s.art) {
        case 'status': p = { ...p, todos: pmTodoAendern(p.todos, s.id, { status: s.wert }) }; break;
        case 'feld': p = { ...p, todos: pmTodoAendern(p.todos, s.id, { [s.feld]: s.wert }) }; break;
        case 'loeschen': {
          const r = pmTodoLoeschen(p.todos, s.id);
          p = { ...p, todos: r.todos };
          if (r.kategorieEntfernt) hinweise.push(pmKategorieEntferntHinweis(r.kategorieEntfernt));
          break;
        }
        case 'darunter': p = { ...p, todos: pmTodoDarunter(p.todos, s.id, s.neueId) }; break;
        case 'inKat': p = { ...p, todos: pmTodoInKategorie(p.todos, s.cat, s.neueId) }; break;
        case 'katNeu': p = { ...p, todos: pmKategorieNeu(p.todos, s.cat ?? '', s.neueId) }; break;
        case 'umbenennen': p = { ...p, todos: pmKategorieUmbenennen(p.todos, s.alt, s.neu) }; break;
        case 'vt': p = { ...p, einheiten: pmEinheitAendern(p.einheiten, s.id, { [s.feld]: s.wert }) }; break;
        case 'vtNum': {
          const zahl = pmZahlEingabe(s.wert);
          p = { ...p, einheiten: pmEinheitAendern(p.einheiten, s.id, { [s.feld]: zahl }) };
          expect(zahl ? zahl.toLocaleString('de-DE') : '').toBe(s.anzeige);
          break;
        }
        case 'pip': p = { ...p, einheiten: pmEinheitAendern(p.einheiten, s.id, { pip: s.wert }) }; break;
        case 'global': p = pmGlobalAendern(p, s.feld, s.wert); break;
        case 'gespraech': {
          const r = pmGespraechHinzufuegen(einheit(s.id), s.eingabe, '2026-09-17', s.neueId);
          if ('fehler' in r) hinweise.push(r.fehler);
          else p = { ...p, einheiten: p.einheiten.map((e) => (e.id === s.id ? r : e)) };
          break;
        }
        case 'gespraechWeg': p = { ...p, einheiten: p.einheiten.map((e) => (e.id === s.id ? pmGespraechEntfernen(e, s.index) : e)) }; break;
        case 'geb': p = { ...p, gebPIP: [...p.gebPIP, pmMassnahmeNeu(s.neueId)] }; break;
        case 'gebAendern': p = { ...p, gebPIP: p.gebPIP.map((m, i) => (i === s.index ? { ...m, [s.feld]: s.wert } : m)) }; break;
        case 'gebWeg': p = { ...p, gebPIP: p.gebPIP.filter((_, i) => i !== s.index) }; break;
        default: throw new Error(s.art);
      }
      expect(hinweise, `${s.art} Hinweise`).toEqual(s.hinweise);
      if (pruefwert(p) !== s.stand) expect(json(normal(p)), `nach ${s.art}`).toBe('abweichend');
    }
    expect(json(normal(p))).toEqual(f.ende);

    // Karte der Übersicht
    const k = pmKarte(p);
    expect([`${k.checklistePct}%`, String(k.verkauft), `${k.erloesePct}%`]).toEqual(f.karte.kpi);
    expect([`${k.erledigt}/${k.gesamt}`, `${k.notar} Notar`, k.erloeseText]).toEqual(f.karte.unter);
    expect(`${p.stadt} · ${k.einheiten} Einheiten`).toBe(f.karte.sub);
    expect([k.pipGrn && `${k.pipGrn} grün`, k.pipYel && `${k.pipYel} gelb`, k.pipRed && `${k.pipRed} rot`].filter(Boolean)).toEqual(f.karte.ampel);

    // Finanzleiste und Summen der Einheitenliste
    const fl = pmFinanzleiste(p);
    const sum = pmEinheitenSummen(p.einheiten);
    expect({
      'pmfin-ziel': fl.ziel, 'pmfin-beurk': fl.beurkundet, 'pmfin-offen': fl.offen, 'pmfin-offen-lbl': fl.offenLabel, 'pmfin-quote': fl.quote,
      ...Object.fromEntries((['grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP'] as const).map((s) => [`pmsum-${s}`, sum[s]])),
    }).toEqual(f.anzeige);
    expect(['∑ Gesamt', sum.flaeche, sum.kaltmiete, sum.grundpreis, sum.provision, sum.sanIVT, sum.ergebnisIVT, sum.zielKP, sum.istKP]).toEqual(f.fuss);
    expect(pmZahlFeld(p.globalIstKP)).toBe(p.globalIstKP ? Math.round(p.globalIstKP).toLocaleString('de-DE') : '');

    // Filter und Zähler der Checkliste
    for (const [filter, ids] of Object.entries(f.filter)) {
      expect(p.todos.filter((t) => pmTodoPasstZuFilter(t, filter, '2026-09-17')).map((t) => t.id)).toEqual(ids);
      expect(pmCheckliste(p.todos, filter as never, '2026-09-17').flatMap((c) => c.todos.map((t) => t.id)).sort()).toEqual([...(ids as string[])].sort());
    }
    expect(pmTodoStatistik(p.todos)).toEqual(f.statistik);
  });
});
