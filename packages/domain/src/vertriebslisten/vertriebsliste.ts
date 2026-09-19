/* eslint-disable @typescript-eslint/no-explicit-any -- Deal im Altformat wie in der alten App */
/**
 * Vertriebslisten — Datenmodell und Rechnung. Wörtlich aus gg-immohandel src/lib/vertriebsliste.ts
 * (ohne Speicher: Spalten, IDs und Datum kommen als Parameter) und formatComputed aus
 * src/modules/vertriebslisten/vertriebslisten.ts. Geprüft per Golden Master.
 */

export type ColumnType =
  | 'text'
  | 'multitext'
  | 'number'
  | 'euro'
  | 'percent'
  | 'date'
  | 'dropdown'
  | 'ampel'
  | 'checkbox';

/** Computed Field-IDs — diese Spalten sind read-only Live-Berechnungen. */
export const COMPUTED_FIELDS = new Set([
  'miete_qm',
  'provision',
  'einkaufspreis',
  'ergebnis_ivt',
  'kp_qm',
  'rendite_ist',
  'rendite_soll',
]);

export interface ColumnDef {
  id: string;             // stabiler Schlüssel (z.B. 'te_nr_whg', 'kaltmiete_ist')
  label: string;          // Anzeigename in der UI
  type: ColumnType;
  computed?: boolean;     // berechnete Spalten haben true (read-only, mit 🔒)
  dropdownOptions?: string[];  // nur für type='dropdown'
}

export interface VertriebslistenZeile {
  id: string;
  einheitId?: string;     // Verknüpfung zur Deal-Einheit (beim Anlegen gesetzt, danach optional)
  isStellplatz?: boolean; // True wenn aus Stellplatz-Einheit erzeugt
  data: Record<string, any>;  // key = ColumnDef.id, value = Zellinhalt
}

export interface Vertriebsliste {
  id: string;
  dealId: string;
  createdAt: string;
  updatedAt: string;
  columns: ColumnDef[];      // Spalten-Definition (Snapshot der Defaults beim Anlegen)
  hiddenColumns?: string[];  // IDs der ausgeblendeten Spalten
  rows: VertriebslistenZeile[];
  // Einheitliches Papierkorb-Schema (siehe src/lib/trash.ts): _deleted ist das
  // Kennzeichen, _deletedAt der Zeitpunkt in Millisekunden. Früher trug _deleted
  // hier selbst den Zeitstempel — der 30-Tage-Cleanup und die Papierkorb-Ansicht
  // konnten diese Sammlung deshalb gar nicht auswerten.
  _deleted?: boolean;
  _deletedAt?: number;
}


/** Provisionssatz, wenn keiner gespeichert ist (alt: getProvisionPct, nur im Browser gespeichert). */
export const PROVISION_STANDARD = 7.14;

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'te_nr_whg',           label: 'TE-Nr. Whg.',                                 type: 'text' },
  { id: 'te_nr_garage',        label: 'TE-Nr. Garage',                               type: 'text' },
  { id: 'vermietet_status',    label: 'Vermietet / Leerstand',                       type: 'dropdown', dropdownOptions: ['Vermietet', 'Leerstand'] },
  { id: 'wohnflaeche',         label: 'Wohnfläche',                                  type: 'number' },
  { id: 'lage',                label: 'Lage',                                        type: 'text' },
  { id: 'garten',              label: 'Garten',                                      type: 'text' },
  { id: 'zi',                  label: 'Zi',                                          type: 'number' },
  { id: 'mea',                 label: 'MEA',                                         type: 'number' },
  { id: 'keller',              label: 'Keller',                                      type: 'text' },
  { id: 'miteigentumsanteil',  label: 'Miteigentumsanteil Whg.',                     type: 'percent' },
  { id: 'kaltmiete_ist',       label: 'Kaltmiete IST Wohnung',                       type: 'euro' },
  { id: 'miete_qm',            label: 'Miete / qm',                                  type: 'euro', computed: true },
  { id: 'kaltmiete_soll',      label: 'Kaltmiete SOLL',                              type: 'euro' },
  { id: 'kaltmiete_stp',       label: 'Kaltmiete Stp.',                              type: 'euro' },
  { id: 'hausgeld_gesamt',     label: 'Hausgeld gerundet inkl. Heizung, IR, WEG',    type: 'euro' },
  { id: 'hausgeld_uml',        label: 'Hausgeld umlagefähig',                        type: 'euro' },
  { id: 'hausgeld_nichtuml',   label: 'Hausgeld nicht umlagefähig',                  type: 'euro' },
  { id: 'weg_verwaltung',      label: 'WEG-Verwaltungskosten',                       type: 'euro' },
  { id: 'instandhaltung',      label: 'Instandhaltungsrücklage',                     type: 'euro' },
  { id: 'grundpreis_whg',      label: 'Grundpreis Whg.',                             type: 'euro' },
  { id: 'grundpreis_stp',      label: 'Grundpreis Stp.',                             type: 'euro' },
  { id: 'provision',           label: 'Provision (% siehe Settings)',                type: 'euro', computed: true },
  { id: 'sanierung',           label: 'Sanierungskosten IVT vor Verkauf',            type: 'euro' },
  { id: 'einkaufspreis',       label: 'Einkaufspreis',                               type: 'euro', computed: true },
  { id: 'ergebnis_ivt',        label: 'Ergebnis IVT (nach Kosten)',                  type: 'euro', computed: true },
  { id: 'verkaufspreis',       label: 'Verkaufspreis Wohnung',                       type: 'euro' },
  { id: 'kp_qm',               label: 'KP/m² Wohnung',                               type: 'euro', computed: true },
  { id: 'vkp_stp',             label: 'zzgl. Verkaufspreis Stellplatz',              type: 'euro' },
  { id: 'rendite_ist',         label: 'Rendite Kunde IST',                           type: 'percent', computed: true },
  { id: 'rendite_soll',        label: 'Rendite nach Mieterhöhung voraussichtlich',   type: 'percent', computed: true },
  { id: 'vertriebsstand',      label: 'Vertriebsstand',                              type: 'multitext' },
  { id: 'mieter',              label: 'Mieter',                                      type: 'text' },
  { id: 'ampel',               label: 'Ampel',                                       type: 'ampel' },
  { id: 'pip',                 label: 'PIP / Wertsteigerungsstrategie',              type: 'multitext' },
  { id: 'todos_pip',           label: 'Todos aus PIP',                               type: 'multitext' },
  { id: 'mietergespraeche',    label: 'Mietergespräche',                             type: 'multitext' },
  { id: 'todos_mieter',        label: 'Todos aus Mietergespräch',                    type: 'multitext' },
  { id: 'kunde',               label: 'Kunde',                                       type: 'text' },
  { id: 'notartermin',         label: 'Notartermin',                                 type: 'date' },
];


/** getDefaultColumns: gespeicherte Standardspalten, wenn es ein nicht leeres Array ist, sonst die Auslieferung. */
export function vlStandardSpalten(gespeichert: unknown): ColumnDef[] {
  if (Array.isArray(gespeichert) && gespeichert.length > 0) return gespeichert as ColumnDef[];
  return DEFAULT_COLUMNS.map(c => ({ ...c }));
}

/** Erzeugt eine neue Vertriebsliste aus den Einheiten des Deals.
 *  Pro Einheit eine Zeile, Stellplätze als eigene Zeilen mit Stellplatz-spezifischen
 *  Spalten bevorzugt befüllt (TE-Nr. Garage, Grundpreis Stp., Kaltmiete Stp.). */
export function createVertriebslisteFromDeal(deal: any, columns: ColumnDef[], neueId: () => string, heute: string): Vertriebsliste {
  const einheiten: any[] = Array.isArray(deal?.einheiten) ? deal.einheiten : [];
  const rows: VertriebslistenZeile[] = einheiten.map((e: any) => {
    const isStp = e.typ === 'Stellplatz';
    const miIst = Number(e.mi_ist) || 0;
    const data: Record<string, any> = {};
    if (isStp) {
      // Stellplatz-Zeile: nur die Stellplatz-spezifischen Spalten füllen
      data.te_nr_garage = e.lage || '';
      data.kaltmiete_stp = miIst || '';
      data.grundpreis_stp = Number(e.vkp) || '';
    } else {
      // Wohnungs-Zeile
      data.lage = e.lage || '';
      data.wohnflaeche = Number(e.fl) || '';
      data.zi = Number(e.zimmer) || '';
      data.kaltmiete_ist = miIst || '';
      data.kaltmiete_soll = Number(e.mi_neu) || miIst || '';
      data.grundpreis_whg = Number(e.vkp) || '';
      data.verkaufspreis = Number(e.vkp) || '';
      // Initial-Vermietungsstatus aus Kaltmiete IST
      data.vermietet_status = miIst > 0 ? 'Vermietet' : 'Leerstand';
    }
    return {
      id: neueId(),
      einheitId: e.id,
      isStellplatz: isStp,
      data,
    };
  });
  const now = heute;
  return {
    id: neueId(),
    dealId: deal.id,
    createdAt: now,
    updatedAt: now,
    columns,
    rows,
  };
}

/** Computed-Werte pro Zeile berechnen.
 *  Brauch zusätzlich:
 *   - dealGik: GIK aus der Aufteiler-Kalkulation des Deals (für Einkaufspreis)
 *   - totalWf: Summe Wohnflächen aller Wohnungs-Zeilen (für Einkaufspreis-Anteil)
 *   - provisionPct: Provision-Satz aus Settings */
export function computeRowValues(
  row: VertriebslistenZeile,
  dealGik: number,
  totalWf: number,
  provisionPct: number,
): Record<string, number> {
  const d = row.data;
  const num = (v: any): number => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string' || !v) return 0;
    return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
  };
  const wf            = num(d.wohnflaeche);
  const kmIst         = num(d.kaltmiete_ist);
  const kmSoll        = num(d.kaltmiete_soll);
  const grundpreisWhg = num(d.grundpreis_whg);
  const grundpreisStp = num(d.grundpreis_stp);
  const verkaufspreis = num(d.verkaufspreis);
  const sanierung     = num(d.sanierung);
  // Berechnungen
  const miete_qm = wf > 0 ? kmIst / wf : 0;
  const provision = (grundpreisWhg + grundpreisStp) * (provisionPct / 100);
  // Einkaufspreis: GIK Aufteiler × (wf / totalWf). Stellplätze immer 0.
  const einkaufspreis = row.isStellplatz
    ? 0
    : (totalWf > 0 && wf > 0 ? dealGik * (wf / totalWf) : 0);
  const ergebnis_ivt = verkaufspreis - einkaufspreis - provision - sanierung;
  const kp_qm = wf > 0 ? verkaufspreis / wf : 0;
  const rendite_ist  = verkaufspreis > 0 ? (kmIst  * 12) / verkaufspreis * 100 : 0;
  const rendite_soll = verkaufspreis > 0 ? (kmSoll * 12) / verkaufspreis * 100 : 0;
  return {
    miete_qm, provision, einkaufspreis, ergebnis_ivt, kp_qm, rendite_ist, rendite_soll,
  };
}

/** Helper: Gesamtwohnfläche aus allen Nicht-Stellplatz-Zeilen */
export function totalWohnflaeche(vl: Vertriebsliste): number {
  return vl.rows
    .filter(r => !r.isStellplatz)
    .reduce((sum, r) => {
      const v = r.data.wohnflaeche;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0;
      return sum + n;
    }, 0);
}

/** Anzeige einer berechneten Zelle (read-only). */
export function formatComputed(type: string, n: any): string {
  const num = typeof n === 'number' ? n : 0;
  if (!num && num !== 0) return '–';
  if (Math.abs(num) < 0.005) return '–';
  switch (type) {
    case 'euro': return Math.round(num).toLocaleString('de-DE') + ' €';
    case 'percent': return num.toFixed(2).replace('.', ',') + '%';
    case 'number': return num.toLocaleString('de-DE');
    default: return String(num);
  }
}

/** vlUpdateCell: Zahlenspalten nach deutscher Lesart (Punkt weg, Komma → Punkt), unlesbar → ''; berechnete Spalten sind nicht beschreibbar (null). */
export function vlZellwert(col: ColumnDef | undefined, colId: string, value: any): any | null {
  if (COMPUTED_FIELDS.has(colId)) return null;
  if (col && (col.type === 'number' || col.type === 'euro' || col.type === 'percent')) {
    if (typeof value === 'string') {
      const cleaned = value.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      return isNaN(n) ? '' : n;
    }
    return value;
  }
  return value;
}

/** settingsVlAddColumn: ID aus dem Namen, eindeutig gemacht. */
export function vlSpalteHinzufuegen(cols: readonly ColumnDef[], name: string, jetztMs: number): ColumnDef[] {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let id = slug || `col_${jetztMs}`;
  let i = 1;
  while (cols.some(c => c.id === id)) {
    id = `${slug}_${i++}`;
  }
  return [...cols, { id, label: name, type: 'text' }];
}

/** Ist die Spalte berechnet (Schloss-Symbol, Typ nicht änderbar)? */
export const vlIstBerechnet = (c: ColumnDef) => !!c.computed || COMPUTED_FIELDS.has(c.id);
