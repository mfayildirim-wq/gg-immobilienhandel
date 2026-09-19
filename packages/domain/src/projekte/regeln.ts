/* eslint-disable @typescript-eslint/no-explicit-any -- Deal im Altformat wie in der alten App */
/**
 * Projektmanagement („📊 Vertrieb“, Seite pm): Anlegen, Checkliste, Einheitenliste, Globalverkauf.
 * Nach gg-immohandel src/modules/projektmanagement/pm.ts, ohne DOM und ohne Speicher: jede Änderung
 * liefert einen neuen Stand. Feldnamen wie im Altformat, damit die Rechenregeln (berechnung.ts) unverändert lesen.
 * Geprüft per Golden Master (test/projekte.golden.test.ts) und Parallelprüfung gegen die laufende alte App.
 */
import { parseNum } from '../zahlen.ts';
import { pmBeurkundeteErloese, pmSollMieteEinheit, pmTodoPasstZuFilter, pmZielKPEinheit, pmZielVKPAusDeal } from './berechnung.ts';
import { PM_TODO_TEMPLATE } from './vorlage.ts';

export type PmTodoStatus = 'offen' | 'in progress' | 'erledigt';
export type PmTodoFilter = 'alle' | 'offen' | 'progress' | 'erledigt' | 'heute';
export type PmVstatus = 'none' | 'active' | 'reserved' | 'notar' | 'sold' | 'noglobal';
export type PmPip = '' | 'grn' | 'yel' | 'red';

export interface PmTodo {
  id: string;
  cat: string;
  text: string;
  status: PmTodoStatus;
  kommentar: string;
  verantwortlich: string;
  /** YYYY-MM-DD oder '' */
  faellig: string;
}

export interface PmGespraech { id: string; datum: string; inhalt: string; ergebnis: string }

export interface PmGebaeudeMassnahme { id: string; text: string; status: string; verantw: string }

export interface PmEinheit {
  id: string;
  /** Herkunft aus dem Deal (alt: gleiche id wie die Deal-Einheit). */
  dealEinheitId: string | null;
  typ: string;
  lage: string;
  zimmer: number | null;
  fl: number | null;
  stk: number | null;
  teNr: string;
  kaltmiete: number | null;
  kmMoeglich: number | null;
  grundpreis: number | null;
  provision: number | null;
  sanIVT: number | null;
  ergebnisIVT: number | null;
  zielKP: number | null;
  istKP: number | null;
  vstatus: PmVstatus;
  vertriebsstand: string;
  vermietet: string;
  mieterName: string;
  pip: PmPip;
  pipStrategie: string;
  pipTodosText: string;
  mieterTodosText: string;
  mieterHistorie: PmGespraech[];
  reservDatum: string;
  notarDatum: string;
  kaeufer: string;
  vtKommentar: string;
}

export interface PmProjekt {
  id: string;
  dealId: string | null;
  adresse: string;
  stadt: string;
  datum: string;
  zielVKP: number;
  globalVstatus: Exclude<PmVstatus, 'noglobal'>;
  globalIstKP: number;
  globalKommentar: string;
  globalKaeufer: string;
  globalNotarDatum: string;
  globalReservDatum: string;
  einheiten: PmEinheit[];
  todos: PmTodo[];
  gebPIP: PmGebaeudeMassnahme[];
}

// ── Auswahllisten (wörtlich aus pm.ts) ──────────────────────
export const PM_TODO_STATUS: { wert: PmTodoStatus; label: string }[] = [
  { wert: 'offen', label: 'Offen' }, { wert: 'in progress', label: 'In Progress' }, { wert: 'erledigt', label: 'Erledigt' },
];
export const PM_TODO_FILTER: { wert: PmTodoFilter; label: string }[] = [
  { wert: 'alle', label: 'Alle' }, { wert: 'offen', label: 'Offen' }, { wert: 'progress', label: 'In Progress' }, { wert: 'erledigt', label: 'Erledigt' }, { wert: 'heute', label: 'Heute fällig' },
];
/** Beim Öffnen eines Projekts (pmOpenProject) steht der Filter auf „Offen“. */
export const PM_TODO_FILTER_START: PmTodoFilter = 'offen';
export const PM_VSTATUS_EINHEIT: { wert: PmVstatus; label: string }[] = [
  { wert: 'none', label: '–' }, { wert: 'active', label: 'Im Verkauf' }, { wert: 'reserved', label: 'Reserviert' }, { wert: 'notar', label: 'Notarvertrag' }, { wert: 'sold', label: 'Verkauft' }, { wert: 'noglobal', label: 'Nicht einzeln' },
];
export const PM_VSTATUS_GLOBAL = PM_VSTATUS_EINHEIT.filter((s) => s.wert !== 'noglobal') as { wert: Exclude<PmVstatus, 'noglobal'>; label: string }[];
export const PM_VERMIETET = ['vermietet', 'leer', 'leer / gekündigt'] as const;
export const PM_GEB_PIP_STATUS = ['offen', 'in Arbeit', 'erledigt'] as const;
/** Spalten der Einheitenliste mit Summe in der Fußzeile. */
export const PM_SUMMEN_SPALTEN = ['grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP'] as const;
export type PmSummenSpalte = (typeof PM_SUMMEN_SPALTEN)[number];
/** Zahlenfelder des Projekts: als Zahl ablegen, nicht als Text. */
export const PM_GLOBAL_ZAHLFELDER = ['globalIstKP', 'zielVKP'] as const;
export const PM_LOESCHEN_FRAGE = 'Projekt wirklich löschen?\n\nEs wandert in den Papierkorb und ist 30 Tage lang unter Einstellungen → Papierkorb wiederherstellbar.';

const de = (n: number) => n.toLocaleString('de-DE');

// ── Anlegen ──────────────────────────────────────────────────
/** pmNewProject: angekaufte Deals ohne aktives Projekt (ein Projekt im Papierkorb blockiert nicht). */
export function pmVerfuegbareDeals<D extends { id: string; status: string | null }>(deals: D[], aktiveProjekte: { dealId: string | null }[]): D[] {
  const existIds = aktiveProjekte.map((p) => p.dealId);
  return deals.filter((d) => d.status === 'Angekauft').filter((d) => !existIds.includes(d.id));
}

/**
 * pmCreateProject. Einheiten, Checkliste aus der Vorlage und Ziel-VKP (Globalverkauf des Deals).
 * Abweichung nur technisch: die Projekteinheit bekommt eine eigene id, die Deal-Einheit steht in dealEinheitId
 * (alt: dieselbe id) — sonst kollidierte ein zweites Projekt zum selben Deal nach dem Papierkorb.
 */
export function pmProjektAnlegen(
  eingabe: { adresse: string; stadt: string; datum: string },
  deal: any | null,
  kalkStandard: object,
  neueId: () => string,
): PmProjekt | { fehler: string } {
  const adresse = eingabe.adresse.trim();
  const stadt = eingabe.stadt.trim();
  if (!adresse) return { fehler: 'Bitte Adresse eingeben' };
  const einheiten: PmEinheit[] = (deal?.einheiten || []).map((e: any) => ({
    ...leereEinheit(neueId()),
    dealEinheitId: e.id ?? null,
    typ: e.typ || 'Wohnung', lage: e.lage || '', zimmer: e.zimmer || 0,
    fl: e.fl_ist || e.fl || 0, kaltmiete: e.mi_ist || 0,
    kmMoeglich: pmSollMieteEinheit(e),
    zielKP: pmZielKPEinheit(e),
    istKP: 0,
  }));
  const todos: PmTodo[] = PM_TODO_TEMPLATE.flatMap((cat) => cat.items.map((item) => ({
    id: neueId(), cat: cat.cat, text: item.text || (item as unknown as string), status: 'offen' as const, kommentar: '', verantwortlich: item.verantw || '', faellig: '',
  })));
  return {
    id: neueId(), dealId: deal?.id ?? null, adresse, stadt, datum: eingabe.datum,
    einheiten, todos, gebPIP: [],
    zielVKP: pmZielVKPAusDeal(deal, kalkStandard),
    globalVstatus: 'none', globalIstKP: 0, globalKommentar: '', globalKaeufer: '', globalNotarDatum: '', globalReservDatum: '',
  };
}

export function leereEinheit(id: string): PmEinheit {
  return {
    id, dealEinheitId: null, typ: 'Wohnung', lage: '', zimmer: null, fl: null, stk: null, teNr: '', kaltmiete: null, kmMoeglich: null,
    grundpreis: null, provision: null, sanIVT: null, ergebnisIVT: null, zielKP: null, istKP: null,
    vstatus: 'none', vertriebsstand: '', vermietet: '', mieterName: '', pip: '', pipStrategie: '', pipTodosText: '', mieterTodosText: '',
    mieterHistorie: [], reservDatum: '', notarDatum: '', kaeufer: '', vtKommentar: '',
  };
}

// ── Übersicht (pmCardHTML) ───────────────────────────────────
export function pmKarte(p: PmProjekt) {
  const todos: (PmTodo & { done?: boolean })[] = p.todos || [];
  const done = todos.filter((t) => t.status === 'erledigt' || (t.done && !t.status)).length;
  const total = todos.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const einh = p.einheiten || [];
  const zielVKP = p.zielVKP || 0;
  const beurkundet = pmBeurkundeteErloese(p);
  return {
    checklistePct: pct, erledigt: done, gesamt: total,
    einheiten: einh.filter((e) => e.typ !== 'Stellplatz').length,
    verkauft: einh.filter((e) => e.vstatus === 'sold').length,
    notar: einh.filter((e) => e.vstatus === 'notar').length,
    erloesePct: zielVKP ? Math.round(beurkundet / zielVKP * 100) : 0,
    erloeseText: zielVKP ? `${Math.round(beurkundet / 1000)}k / ${Math.round(zielVKP / 1000)}k` : '–',
    pipGrn: einh.filter((e) => e.pip === 'grn').length,
    pipYel: einh.filter((e) => e.pip === 'yel').length,
    pipRed: einh.filter((e) => e.pip === 'red').length,
  };
}

// ── Checkliste (pmRenderTodo, pmCatHTML) ─────────────────────
export interface PmKategorie { cat: string; erledigt: number; gesamt: number; todos: PmTodo[]; eingeklappt: boolean }

export function pmCheckliste(todos: PmTodo[], filter: PmTodoFilter, heute: string, eingeklappt: ReadonlySet<string> = new Set()): PmKategorie[] {
  const cats = [...new Set(todos.map((t) => t.cat))];
  const aus: PmKategorie[] = [];
  for (const cat of cats) {
    const alle = todos.filter((t) => t.cat === cat);
    const passend = alle.filter((t) => pmTodoPasstZuFilter(t, filter, heute));
    if (passend.length === 0 && filter !== 'alle') continue;
    const zu = eingeklappt.has(cat);
    aus.push({ cat, erledigt: alle.filter((t) => t.status === 'erledigt').length, gesamt: alle.length, todos: zu ? [] : passend, eingeklappt: zu });
  }
  return aus;
}

const neuesTodo = (id: string, cat: string): PmTodo => ({ id, cat, text: '', status: 'offen', kommentar: '', verantwortlich: '', faellig: '' });

export function pmTodoAendern(todos: PmTodo[], id: string, aenderung: Partial<Omit<PmTodo, 'id'>>): PmTodo[] {
  return todos.map((t) => (t.id === id ? { ...t, ...aenderung } : t));
}

/** pmDeleteTodo: ein Klick; mit der letzten Zeile geht die Kategorie — das meldet `kategorieEntfernt`. */
export function pmTodoLoeschen(todos: PmTodo[], id: string): { todos: PmTodo[]; kategorieEntfernt: string | null } {
  const t = todos.find((x) => x.id === id);
  if (!t) return { todos, kategorieEntfernt: null };
  const letzteInKat = todos.filter((x) => x.cat === t.cat).length === 1;
  return { todos: todos.filter((x) => x.id !== id), kategorieEntfernt: letzteInKat ? t.cat : null };
}

export const pmKategorieEntferntHinweis = (cat: string) => `Kategorie „${cat}" mit entfernt — sie hatte keine weitere Zeile`;

/** pmAddTodoBelowRow */
export function pmTodoDarunter(todos: PmTodo[], nachId: string, neueId: string): PmTodo[] {
  const idx = todos.findIndex((t) => t.id === nachId);
  const cat = todos[idx]?.cat || '📋 Sonstiges';
  const neu = [...todos];
  neu.splice(idx + 1, 0, neuesTodo(neueId, cat));
  return neu;
}

/** pmAddTodoInCat: hinter die letzte Zeile der Kategorie. */
export function pmTodoInKategorie(todos: PmTodo[], cat: string, neueId: string): PmTodo[] {
  const lastIdx = [...todos].reverse().findIndex((t) => t.cat === cat);
  const insertAt = lastIdx >= 0 ? todos.length - lastIdx : todos.length;
  const neu = [...todos];
  neu.splice(insertAt, 0, neuesTodo(neueId, cat));
  return neu;
}

/** pmAddTodoCat: neue Kategorie mit einer leeren Zeile am Ende. */
export function pmKategorieNeu(todos: PmTodo[], cat: string, neueId: string): PmTodo[] {
  if (!cat) return todos;
  return [...todos, neuesTodo(neueId, cat)];
}
export const PM_KATEGORIE_VORSCHLAG = '📋 Neue Kategorie';

/** pmRenameCat: leer oder unverändert → nichts. */
export function pmKategorieUmbenennen(todos: PmTodo[], alt: string, neu: string): PmTodo[] {
  if (!neu || neu === alt) return todos;
  return todos.map((t) => (t.cat === alt ? { ...t, cat: neu } : t));
}

// ── Einheitenliste (pmRenderEinh, pmEinhRowHTML) ─────────────
export function pmEinheitAendern(einheiten: PmEinheit[], id: string, aenderung: Partial<Omit<PmEinheit, 'id'>>): PmEinheit[] {
  return einheiten.map((e) => (e.id === id ? { ...e, ...aenderung } : e));
}

/** pmSaveVTNum: Eingabe nach deutscher Lesart, abgelegt als Zahl (leer → 0). */
export const pmZahlEingabe = (eingabe: string): number => parseNum(eingabe);
/** Anzeige eines Kaufpreis-/Ist-KP-Feldes: gerundet mit Tausenderpunkten, 0/leer → ''. */
export function pmZahlFeld(wert: unknown): string {
  const n = parseNum(wert);
  return n ? de(Math.round(n)) : '';
}

export function pmEinheitAnzeige(e: PmEinheit, idx: number) {
  const isStpl = e.typ === 'Stellplatz';
  const hist = e.mieterHistorie || [];
  const erster = hist[0];
  return {
    teNr: String(e.teNr || idx + 1),
    lage: e.lage || '–',
    zimmer: isStpl ? `${e.stk || 1}×` : String(e.zimmer || '–'),
    flaeche: isStpl ? '–' : de(+(e.fl ?? 0) || 0),
    kaltmiete: e.kaltmiete ? `${de(Math.round(+e.kaltmiete))} €` : '–',
    kmMoeglich: e.kmMoeglich ? `${de(Math.round(+e.kmMoeglich))} €` : '–',
    vermietet: e.vermietet || 'vermietet',
    gespraeche: hist.length ? `${hist.length} Eintrag${hist.length !== 1 ? 'e' : ''}` : '',
    letztesGespraech: erster ? `${erster.datum || ''}: ${erster.inhalt || ''}` : '',
  };
}

export function pmEinheitenSummen(einh: PmEinheit[]): { flaeche: string; kaltmiete: string } & Record<PmSummenSpalte, string> {
  const summe = (feld: PmSummenSpalte) => `${de(Math.round(einh.reduce((s, e) => s + (parseNum(e?.[feld]) || 0), 0)))} €`;
  return {
    flaeche: `${de(einh.filter((e) => e.typ !== 'Stellplatz').reduce((s, e) => s + (+(e.fl ?? 0) || 0), 0))} m²`,
    kaltmiete: `${de(einh.reduce((s, e) => s + (parseNum(e.kaltmiete) || 0), 0))} €`,
    ...(Object.fromEntries(PM_SUMMEN_SPALTEN.map((f) => [f, summe(f)])) as Record<PmSummenSpalte, string>),
  };
}

/** Finanzleiste (pmRefreshFinbar). */
export function pmFinanzleiste(p: PmProjekt) {
  const ziel = p.zielVKP || 0;
  const beurkundet = pmBeurkundeteErloese(p);
  const offen = ziel - beurkundet;
  return {
    ziel: ziel ? de(Math.round(ziel)) : '',
    beurkundet: `${de(Math.round(beurkundet))} €`,
    offen: `${de(Math.round(Math.abs(offen)))} €`,
    offenPositiv: offen > 0,
    offenLabel: offen > 0 ? 'Offen' : 'Überschuss',
    quote: ziel ? `${Math.round(beurkundet / ziel * 100)}% erreicht` : '',
  };
}

/** pmSaveGlobal: Zahlenfelder als Zahl (unlesbar → 0), sonst Text. */
export function pmGlobalAendern<F extends 'zielVKP' | 'globalIstKP' | 'globalVstatus' | 'globalKommentar' | 'globalKaeufer' | 'globalNotarDatum' | 'globalReservDatum'>(p: PmProjekt, feld: F, wert: string): PmProjekt {
  return { ...p, [feld]: (PM_GLOBAL_ZAHLFELDER as readonly string[]).includes(feld) ? (parseNum(wert) || 0) : wert };
}

// ── Mietergespräche (pmSaveHistModal, pmRmHistModal) ─────────
export function pmGespraechHinzufuegen(e: PmEinheit, eingabe: { datum: string; inhalt: string; ergebnis: string }, heute: string, neueId: string): PmEinheit | { fehler: string } {
  const inhalt = eingabe.inhalt.trim();
  if (!inhalt) return { fehler: 'Bitte Gesprächsinhalt eingeben' };
  return { ...e, mieterHistorie: [{ datum: eingabe.datum || heute, inhalt, ergebnis: eingabe.ergebnis.trim(), id: neueId }, ...(e.mieterHistorie || [])] };
}

export function pmGespraechEntfernen(e: PmEinheit, index: number): PmEinheit {
  const h = [...(e.mieterHistorie || [])];
  h.splice(index, 1);
  return { ...e, mieterHistorie: h };
}

// ── Gebäude-PIP ──────────────────────────────────────────────
export const pmMassnahmeNeu = (id: string): PmGebaeudeMassnahme => ({ id, text: '', status: 'offen', verantw: '' });
