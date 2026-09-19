/* eslint-disable @typescript-eslint/no-explicit-any -- Einträge im Altformat wie in der alten App */
/**
 * Gespeicherte Filter. Wörtlich aus gg-immohandel src/lib/savedFilters.ts (Typen, Apply-Engine, Vorlagen, Beschreibung);
 * die Speicherfunktionen sind ohne Speicher nachgebaut (liefern den neuen Bestand). Geprüft per Golden Master.
 */

export type Module = 'deals' | 'ankauf' | 'makler' | 'objects';

/**
 * Operator-Vokabular für Filter-Kriterien. Bewusst klein gehalten,
 * damit die Apply-Engine + UI überschaubar bleiben.
 */
export type Operator =
  | 'equals'         // exakter Match (string oder number)
  | 'not_equals'
  | 'contains'       // case-insensitive substring (string)
  | 'in'             // value ist in einer Werteliste (multi-select)
  | 'gte' | 'lte'    // number ≥ / ≤
  | 'is_set'         // Feld existiert + ist nicht leer
  | 'is_empty';      // Feld fehlt oder leer

export interface FilterCriterion {
  /** Pfad ins Item-Objekt, z.B. 'status' oder 'kalk.kaufpreis' */
  field: string;
  op: Operator;
  /** Wert für die Operation (für is_set/is_empty ignoriert) */
  value?: string | number | string[] | number[];
}

export interface SavedFilter {
  id: string;
  module: Module;
  name: string;
  criteria: FilterCriterion[];
  createdAt: number;
  updatedAt: number;
}

// ── Apply-Engine ────────────────────────────────────────────

export function getPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isEmpty(v: any): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return v === 0;
  return false;
}

function matchCriterion(item: any, c: FilterCriterion): boolean {
  const v = getPath(item, c.field);
  switch (c.op) {
    case 'equals':
      return String(v ?? '').toLowerCase() === String(c.value ?? '').toLowerCase();
    case 'not_equals':
      return String(v ?? '').toLowerCase() !== String(c.value ?? '').toLowerCase();
    case 'contains': {
      const haystack = String(v ?? '').toLowerCase();
      const needle = String(c.value ?? '').toLowerCase();
      return needle === '' ? true : haystack.includes(needle);
    }
    case 'in': {
      const list = Array.isArray(c.value) ? c.value.map((x) => String(x).toLowerCase()) : [];
      if (list.length === 0) return true;
      return list.includes(String(v ?? '').toLowerCase());
    }
    case 'gte': {
      const num = Number(v);
      const ref = Number(c.value);
      if (isNaN(num) || isNaN(ref)) return false;
      return num >= ref;
    }
    case 'lte': {
      const num = Number(v);
      const ref = Number(c.value);
      if (isNaN(num) || isNaN(ref)) return false;
      return num <= ref;
    }
    case 'is_set':
      return !isEmpty(v);
    case 'is_empty':
      return isEmpty(v);
    default:
      return true;
  }
}

/**
 * Wendet alle Kriterien per UND-Verknüpfung an.
 * Items, die ALLE Kriterien erfüllen, kommen ins Resultat.
 */
export function applyFilter<T>(items: T[], filter: SavedFilter | null): T[] {
  if (!filter || !filter.criteria.length) return items;
  return items.filter((item) => filter.criteria.every((c) => matchCriterion(item, c)));
}

// ── Default-Vorlagen pro Modul (Inspiration) ────────────────

export const FILTER_TEMPLATES: Record<Module, Array<Omit<SavedFilter, 'id' | 'createdAt' | 'updatedAt'>>> = {
  deals: [
    { module: 'deals', name: '🔥 Heiße Pipeline', criteria: [
      { field: 'status', op: 'in', value: ['Closing Path', 'Angebot abgegeben'] },
    ]},
    { module: 'deals', name: '⚠️ Nachfass-fällig', criteria: [
      { field: 'status', op: 'equals', value: 'Über Zeit nachfassen' },
    ]},
    { module: 'deals', name: '💎 >1 Mio Kaufpreis', criteria: [
      { field: 'status', op: 'not_equals', value: 'Archiv' },
      { field: 'kalk.kaufpreis', op: 'gte', value: 1_000_000 },
    ]},
  ],
  ankauf: [
    { module: 'ankauf', name: '🔴 Nur überfällig', criteria: [
      { field: '_due.cls', op: 'in', value: ['heute', 'ueberfaellig'] },
    ]},
    { module: 'ankauf', name: '⭐ Nur A-Makler', criteria: [
      { field: 'prio', op: 'equals', value: 'A' },
    ]},
  ],
  makler: [
    { module: 'makler', name: '⭐ A-Makler mit Telefon', criteria: [
      { field: 'prio', op: 'equals', value: 'A' },
      { field: 'tel', op: 'is_set' },
    ]},
    { module: 'makler', name: '📭 Ohne E-Mail-Adresse', criteria: [
      { field: 'email', op: 'is_empty' },
    ]},
  ],
  objects: [
    { module: 'objects', name: '🟢 Aktive (nicht Archiv)', criteria: [
      { field: 'status', op: 'not_equals', value: 'Archiv' },
    ]},
    { module: 'objects', name: '💰 Großvolumig (>2 Mio)', criteria: [
      { field: 'angebotspreis', op: 'gte', value: 2_000_000 },
    ]},
  ],
};

/** getFiltersForModule: Filter eines Moduls, nach Namen sortiert (de). */
export function filterFuerModul(alle: SavedFilter[], module: Module): SavedFilter[] {
  return alle
    .filter((f) => f.module === module)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** saveFilter: vorhandene id → aktualisieren (updatedAt), sonst neu anlegen. `jetzt` in Sekunden. */
export function filterSpeichern(
  alle: SavedFilter[],
  input: Omit<SavedFilter, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  jetzt: number,
  neueId: () => string,
): { alle: SavedFilter[]; filter: SavedFilter } {
  const all = [...alle];
  const existingIdx = input.id ? all.findIndex((f) => f.id === input.id) : -1;
  if (existingIdx >= 0) {
    const updated: SavedFilter = { ...all[existingIdx]!, ...input, id: all[existingIdx]!.id, updatedAt: jetzt };
    all[existingIdx] = updated;
    return { alle: all, filter: updated };
  }
  const created: SavedFilter = { id: input.id || neueId(), module: input.module, name: input.name, criteria: input.criteria, createdAt: jetzt, updatedAt: jetzt };
  all.push(created);
  return { alle: all, filter: created };
}

/** ensureTemplatesInstalled: Vorlagen des Moduls, deren Name noch fehlt (nur nach bekanntem Bestand aufrufen). */
export function fehlendeVorlagen(alle: SavedFilter[], module: Module) {
  const existingNames = new Set(filterFuerModul(alle, module).map((f) => f.name));
  return FILTER_TEMPLATES[module].filter((tpl) => !existingNames.has(tpl.name));
}

// ── Helpers für UI ──────────────────────────────────────────

/** Liefert eine kompakte Beschreibung für die Anzeige in der Liste. */
export function describeFilter(f: SavedFilter): string {
  if (f.criteria.length === 0) return '(keine Kriterien)';
  return f.criteria.map(describeCriterion).join(' · ');
}

function describeCriterion(c: FilterCriterion): string | undefined {
  const fieldLabel = c.field.replace(/^_/, '').replace(/\./g, '→');
  switch (c.op) {
    case 'equals':     return `${fieldLabel} = ${c.value}`;
    case 'not_equals': return `${fieldLabel} ≠ ${c.value}`;
    case 'contains':   return `${fieldLabel} enthält "${c.value}"`;
    case 'in':         return `${fieldLabel} ∈ {${(c.value as any[]).join(', ')}}`;
    case 'gte':        return `${fieldLabel} ≥ ${c.value}`;
    case 'lte':        return `${fieldLabel} ≤ ${c.value}`;
    case 'is_set':     return `${fieldLabel} gesetzt`;
    case 'is_empty':   return `${fieldLabel} leer`;
  }
}
