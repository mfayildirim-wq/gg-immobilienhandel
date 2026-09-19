// Wörtliche Kopie von gg-immohandel src/lib/begleitscheinEngine.ts (Abweichungen: Importpfad, `!` wegen noUncheckedIndexedAccess).
// ══════════════════════════════════════════════════════════════
// Begleitscheine — reine Logik (keine DOM-Zugriffe, testbar)
// Umsetzung nach docs/BEGLEITSCHEINE-ANFORDERUNGEN.md
// ══════════════════════════════════════════════════════════════

import { ANKAUF_KOPF, ANKAUF_SEED, type VorlageSeedRow } from './vorlage.ts';

// ── §J Status ────────────────────────────────────────────────
/** Exakt drei Status, Schreibweise 1:1 aus der Excel (J1). */
export type BsStatus = 'offen' | 'In Progress' | 'erledigt';

export const BS_STATUS: readonly BsStatus[] = ['offen', 'In Progress', 'erledigt'];

/** J1 — Farben exakt aus der Ist-Excel. */
export const BS_STATUS_FARBE: Record<BsStatus, string> = {
  'offen': '#FF0000',
  'In Progress': '#FFFF00',
  'erledigt': '#00B050',
};

/** J2 — Schriftfarbe passend zum Statushintergrund. */
export const BS_STATUS_TEXTFARBE: Record<BsStatus, string> = {
  'offen': '#FFFFFF',
  'In Progress': '#000000',
  'erledigt': '#FFFFFF',
};

// ── §I Ebenenfarben ──────────────────────────────────────────
/** I3 — die drei Grautöne exakt aus der Excel, kein Zebra (I5). */
export const BS_EBENE_FARBE: Record<1 | 2 | 3, string> = {
  1: '#808080',
  2: '#D9D9D9',
  3: '#F2F2F2',
};

/** Lesbare Schriftfarbe auf dem jeweiligen Grauton. */
export const BS_EBENE_TEXTFARBE: Record<1 | 2 | 3, string> = {
  1: '#FFFFFF',
  2: '#1A1A1A',
  3: '#1A1A1A',
};

// ── Datenmodell ──────────────────────────────────────────────

/** B13 — Unterpunkt einer Zeile. Keine vierte Hierarchieebene (B16). */
export interface BsSubItem {
  /** F13 — dauerhafte ID, überlebt Umbenennen und Verschieben. */
  id: string;
  text: string;
  status: BsStatus;
}

/** Eine Zeile des Begleitscheins (Über- oder Unterpunkt der Ebenen 1–3). */
export interface BsRow {
  /** F13 — dauerhafte, unsichtbare ID. Überlebt Kopie, Bearbeitung, Verschieben, Ebenenwechsel. */
  id: string;
  lvl: 1 | 2 | 3;
  text: string;
  verantwortung: string;
  status: BsStatus;
  sub: BsSubItem[];
  /** D1/D2 — der feste Abschlusspunkt lässt sich nicht löschen. */
  fix?: boolean;
}

export type BsTyp = 'ankauf' | 'verkauf';

/** §E — die bearbeitbare Vorlage je Typ. */
export interface BsVorlage {
  typ: BsTyp;
  /** G2a — Kopfbereich als Freitext, manuell gepflegt. */
  kopf: string;
  rows: BsRow[];
  /** Zeitpunkt der letzten Vorlagenänderung, für §F. */
  updatedAt?: string;
}

/** Ein konkreter Begleitschein zu einem Projekt. */
export interface Begleitschein {
  id: string;
  typ: BsTyp;
  /** C7 — Adresse wird aus dem Objekt gezogen. */
  objektId: string;
  dealId?: string;
  adresse: string;
  /** C4 — nur beim Verkaufsbegleitschein. */
  whgNr?: string;
  /** C6 — Pflichtfeld. */
  name: string;
  kopf: string;
  rows: BsRow[];
  /** D3 — gesetzt, sobald der Abschlusspunkt auf „erledigt" steht. */
  archiviert?: boolean;
  archiviertAm?: string;
  createdAt: string;
  updatedAt?: string;
  _deleted?: boolean;
  _deletedAt?: number;   // einheitliches Papierkorb-Schema, siehe src/lib/trash.ts
}

// ── §Y Konfigurationsbaukasten ───────────────────────────────

/** Y2 — die verfügbaren Aktionstypen. Kein Typ „Web-Formular" (Y6). */
export type BsAktionTyp =
  | 'vordruck-brief'   // Y-A1
  | 'vordruck-datei'   // Y-A2
  | 'mail'             // Y-A3
  | 'link'             // Y-A4
  | 'modul'            // Y-A5
  | 'analyse'          // Y-A6
  | 'daten';           // Y-A7

export const BS_AKTION_LABEL: Record<BsAktionTyp, string> = {
  'vordruck-brief': 'Vordruck Brief/Mail',
  'vordruck-datei': 'Vordruck Datei',
  'mail': 'Mail öffnen',
  'link': 'Link öffnen',
  'modul': 'Modul-Sprung',
  'analyse': 'Dokumentenanalyse',
  'daten': 'Daten anzeigen',
};

/** Y3 — eine konfigurierte Aktion an einem Punkt oder Unterpunkt. */
export interface BsAktion {
  id: string;
  /** Y3a — Beschriftung des Buttons. */
  label: string;
  typ: BsAktionTyp;
  /** Y3d — Sichtbarkeit. Inaktiv = Button wird nicht gezeigt. */
  aktiv: boolean;
  /** Y11 — die dauerhafte ID der Zeile, an der die Aktion hängt. */
  rowId: string;
  /** B20 — optional die ID des Unterpunkts, wenn die Aktion dort hängt. */
  subId?: string;
  // Y3c — Konfiguration je nach Typ
  vordruckId?: string;
  url?: string;
  modul?: string;
  empfaenger?: string;
  betreff?: string;
  analyseTyp?: string;
  datenQuelle?: string;
}

/** Y12 — die Aktionskonfiguration hängt an der Vorlage, nicht am Begleitschein. */
export interface BsAktionenConfig {
  typ: BsTyp;
  aktionen: BsAktion[];
}

// ── §M Vordruckbibliothek ────────────────────────────────────

export type BsVordruckArt = 'brief' | 'mail' | 'datei';

export interface BsVordruck {
  id: string;
  /** z. B. „F065" */
  nummer: string;
  titel: string;
  art: BsVordruckArt;
  /** Brief/Mail: Textkörper mit {platzhaltern}. */
  inhalt?: string;
  /** Mail: Standardbetreff. */
  betreff?: string;
  /** Datei: Name der hinterlegten Datei. */
  dateiName?: string;
  aktiv: boolean;
}

// ── Hilfsfunktionen ──────────────────────────────────────────

const rnd = () => Math.random().toString(36).slice(2, 8);

/** Neue dauerhafte ID für von Hand angelegte Zeilen (F13). */
export function bsNewId(prefix = 'x'): string {
  return `${prefix}${Date.now().toString(36)}${rnd()}`;
}

// ── §E Vorlage aus dem Saatgut ───────────────────────────────

function seedToRow(s: VorlageSeedRow): BsRow {
  return {
    id: s.id,
    lvl: s.lvl,
    text: s.text,
    verantwortung: s.verantwortung ?? '',
    status: 'offen',
    sub: (s.sub ?? []).map((t, i) => ({ id: `${s.id}s${i + 1}`, text: t, status: 'offen' as BsStatus })),
    fix: s.id === 'bs-final',
  };
}

/** Auslieferungszustand der Ankaufsvorlage (§G, 1:1 aus der Ist-Excel). */
export function bsSeedVorlage(typ: BsTyp): BsVorlage {
  if (typ === 'verkauf') {
    // §U5 — der Verkaufsbegleitschein kommt zuletzt. Bis dahin nur der Abschlusspunkt (D1).
    return {
      typ,
      kopf: 'Verkaufsprozess: (Objekt, VE und wichtige Infos hier)',
      rows: [seedToRow({ id: 'bs-final', lvl: 1, text: 'vollständig abgearbeitet' })],
    };
  }
  return { typ, kopf: ANKAUF_KOPF, rows: ANKAUF_SEED.map(seedToRow) };
}

// ── §J6 Zählerblock ──────────────────────────────────────────

export interface BsZaehler {
  summe: number;
  offen: number;
  inProgress: number;
  erledigt: number;
}

/**
 * J6 — Zählerblock über der Tabelle.
 * B17: Unterpunkte zählen **nicht** mit, nur die Punkte selbst.
 */
export function bsZaehler(rows: readonly BsRow[]): BsZaehler {
  const z: BsZaehler = { summe: rows.length, offen: 0, inProgress: 0, erledigt: 0 };
  for (const r of rows) {
    if (r.status === 'offen') z.offen++;
    else if (r.status === 'In Progress') z.inProgress++;
    else z.erledigt++;
  }
  return z;
}

// ── §C Benennung ─────────────────────────────────────────────

export interface BsAdresse {
  strasse?: string;
  hausnr?: string;
  stadt?: string;
}

/**
 * C3 — Name = Adresse + Typ + (Wohnungsnummer bei Verkauf) + individueller Name,
 * verbunden mit Unterstrichen. Beispiel:
 * `Poststraße_57_Böblingen_Verkauf_02_IVT Wohnen`
 */
export function bsName(adr: BsAdresse, typ: BsTyp, name: string, whgNr?: string): string {
  const teile = [
    adr.strasse,
    adr.hausnr,
    adr.stadt,
    typ === 'ankauf' ? 'Ankauf' : 'Verkauf',
    typ === 'verkauf' ? whgNr : '',
    name,
  ];
  return teile.map(t => (t ?? '').trim()).filter(Boolean).join('_');
}

/** C7 — Adresse aus dem Objekt zusammensetzen. */
export function bsAdresseAusObjekt(o: { strasse?: string; hausnr?: string; plz?: string; stadt?: string } | undefined): string {
  if (!o) return '';
  const strasse = [o.strasse, o.hausnr].filter(Boolean).join(' ');
  const ort = [o.plz, o.stadt].filter(Boolean).join(' ');
  return [strasse, ort].filter(Boolean).join(', ');
}

// ── §E4 Vorlage → Begleitschein ──────────────────────────────

/** Tiefe Kopie einer Zeile. Alle Status werden auf „offen" zurückgesetzt. */
function cloneRow(r: BsRow): BsRow {
  return {
    id: r.id,
    lvl: r.lvl,
    text: r.text,
    verantwortung: r.verantwortung,
    status: 'offen',
    sub: r.sub.map(s => ({ id: s.id, text: s.text, status: 'offen' as BsStatus })),
    ...(r.fix ? { fix: true } : {}),
  };
}

export interface BsAnlageDaten {
  typ: BsTyp;
  objektId: string;
  dealId?: string;
  adresse: string;
  whgNr?: string;
  name: string;
}

/** E4 — ein neuer Begleitschein ist eine vollständige Kopie der Vorlage. */
export function bsAusVorlage(v: BsVorlage, d: BsAnlageDaten, id: string, jetzt: string): Begleitschein {
  return {
    id,
    typ: d.typ,
    objektId: d.objektId,
    dealId: d.dealId,
    adresse: d.adresse,
    whgNr: d.whgNr,
    name: d.name,
    kopf: v.kopf,
    rows: v.rows.map(cloneRow),
    createdAt: jetzt,
  };
}

// ── §D Abschluss & Archiv ────────────────────────────────────

export const BS_ABSCHLUSS_ID = 'bs-final';

/** D3 — Archivstatus ergibt sich aus dem Abschlusspunkt, D4 macht ihn reversibel. */
export function bsArchivStatus(bs: Begleitschein): boolean {
  return bs.rows.find(r => r.id === BS_ABSCHLUSS_ID)?.status === 'erledigt';
}

// ── §F Vorlagenänderung ──────────────────────────────────────

export type BsAenderungTyp = 'neu' | 'text' | 'geloescht';

/** Ein Vorschlag, der dem Nutzer je Begleitschein und je Punkt einzeln vorgelegt wird (F8). */
export interface BsAenderung {
  typ: BsAenderungTyp;
  rowId: string;
  /** Text in der Vorlage (bei „geloescht" der alte Text). */
  neuText: string;
  altText?: string;
  /** F4 — nur unbearbeitete Punkte dürfen automatisch angefasst werden. */
  unbearbeitet: boolean;
  /** F14/F15 — ID der Zeile, unter der der neue Punkt eingefügt wird. `null` = ganz oben. */
  ankerId?: string | null;
}

/**
 * F4 — ein Punkt gilt als „nicht bearbeitet", wenn sein Status `offen` ist **und**
 * sein Text 1:1 dem vorherigen Vorlagenstand entspricht.
 */
export function bsUnbearbeitet(row: BsRow, altVorlagenText: string): boolean {
  return row.status === 'offen' && row.text === altVorlagenText;
}

/**
 * F14/F15 — Ankerlogik für einen neuen Vorlagenpunkt.
 * Der Punkt wird direkt unter derjenigen Zeile eingefügt, die in der Vorlage
 * unmittelbar über ihm steht und im Begleitschein noch existiert. Existiert keine
 * solche Zeile, wandert die Suche in der Vorlage nach oben weiter (F15).
 * Ergebnis `null` heißt: ganz an den Anfang.
 */
export function bsAnker(neuVorlage: readonly BsRow[], neuIdx: number, vorhandeneIds: ReadonlySet<string>): string | null {
  for (let i = neuIdx - 1; i >= 0; i--) {
    const id = neuVorlage[i]!.id;
    if (vorhandeneIds.has(id)) return id;
  }
  return null;
}

/**
 * §F — Vergleich zwischen dem alten Vorlagenstand und dem neuen, angewendet auf
 * einen konkreten Begleitschein. Liefert Vorschläge, keine Änderungen (F8).
 */
export function bsAenderungen(
  altVorlage: readonly BsRow[],
  neuVorlage: readonly BsRow[],
  bs: Begleitschein,
): BsAenderung[] {
  const altById = new Map(altVorlage.map(r => [r.id, r]));
  const neuById = new Map(neuVorlage.map(r => [r.id, r]));
  const bsById = new Map(bs.rows.map(r => [r.id, r]));
  const vorhanden = new Set(bs.rows.map(r => r.id));
  const out: BsAenderung[] = [];

  neuVorlage.forEach((nr, idx) => {
    const bsRow = bsById.get(nr.id);
    if (!bsRow) {
      // F11 — neuer Punkt, an derselben Stelle wie in der Vorlage
      if (!altById.has(nr.id)) {
        out.push({ typ: 'neu', rowId: nr.id, neuText: nr.text, unbearbeitet: true, ankerId: bsAnker(neuVorlage, idx, vorhanden) });
      }
      return;
    }
    // F9 — Textänderung überschreibt, aber nur bei unbearbeiteten Punkten
    const alt = altById.get(nr.id);
    if (alt && alt.text !== nr.text) {
      out.push({ typ: 'text', rowId: nr.id, neuText: nr.text, altText: bsRow.text, unbearbeitet: bsUnbearbeitet(bsRow, alt.text) });
    }
  });

  // F10 — in der Vorlage gelöschte Punkte
  for (const ar of altVorlage) {
    if (neuById.has(ar.id)) continue;
    const bsRow = bsById.get(ar.id);
    if (!bsRow || bsRow.fix) continue;
    out.push({ typ: 'geloescht', rowId: ar.id, neuText: '', altText: bsRow.text, unbearbeitet: bsUnbearbeitet(bsRow, ar.text) });
  }

  return out;
}

/** Wendet eine einzelne, vom Nutzer bestätigte Änderung auf die Zeilenliste an (F8). */
export function bsAenderungAnwenden(rows: readonly BsRow[], a: BsAenderung, vorlage: readonly BsRow[]): BsRow[] {
  if (a.typ === 'text') {
    return rows.map(r => (r.id === a.rowId ? { ...r, text: a.neuText } : r));
  }
  if (a.typ === 'geloescht') {
    return rows.filter(r => r.id !== a.rowId);
  }
  const quelle = vorlage.find(r => r.id === a.rowId);
  if (!quelle) return [...rows];
  const neu = cloneRow(quelle);
  if (a.ankerId == null) return [neu, ...rows];
  const idx = rows.findIndex(r => r.id === a.ankerId);
  if (idx < 0) return [...rows, neu];
  return [...rows.slice(0, idx + 1), neu, ...rows.slice(idx + 1)];
}

// ── §H Bearbeitung ───────────────────────────────────────────

/** H5 — Zeile um eine Position verschieben. Der Abschlusspunkt bleibt unten (D2). */
export function bsVerschieben(rows: readonly BsRow[], id: string, richtung: -1 | 1): BsRow[] {
  const i = rows.findIndex(r => r.id === id);
  if (i < 0 || rows[i]!.fix) return [...rows];
  const j = i + richtung;
  if (j < 0 || j >= rows.length || rows[j]!.fix) return [...rows];
  const out = [...rows];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** H2 — Zeile löschen. Der feste Abschlusspunkt ist geschützt (D2). */
export function bsZeileLoeschen(rows: readonly BsRow[], id: string): BsRow[] {
  return rows.filter(r => r.id !== id || r.fix);
}

/** H2 — neue Zeile direkt unter `nachId` einfügen, nie unter dem Abschlusspunkt. */
export function bsZeileEinfuegen(rows: readonly BsRow[], nachId: string | null, lvl: 1 | 2 | 3): BsRow[] {
  const neu: BsRow = { id: bsNewId('p'), lvl, text: '', verantwortung: '', status: 'offen', sub: [] };
  const letzterFrei = rows.reduce((acc, r, i) => (r.fix ? acc : i), -1);
  const idx = nachId == null ? letzterFrei : rows.findIndex(r => r.id === nachId);
  const pos = Math.min(idx < 0 ? letzterFrei : idx, letzterFrei) + 1;
  return [...rows.slice(0, pos), neu, ...rows.slice(pos)];
}
