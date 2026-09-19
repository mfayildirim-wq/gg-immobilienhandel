/**
 * Audit-Hash-Kette. Wörtlich aus gg-immohandel server/audit-chain.ts (Stand 9d693b8);
 * geändert: die sha256-Funktion wird übergeben, damit die Regel ohne node:crypto auskommt.
 */

/** Startwert der Kette, solange nie aufgeräumt wurde. */
export const AUDIT_GENESIS = 'GENESIS';
/** Kennzeichen des Anker-Eintrags (action einer Zeile vom Typ `delete`). */
export const AUDIT_ANKER_AKTION = 'chain-anchor';
/** Die Oberfläche bietet das Aufräumen ab diesem Alter an. */
export const AUDIT_AUFRAEUM_TAGE = 180;

/** Die Felder, über die gehasht wird — ohne id und ohne hash_chain selbst. */
export interface AuditNutzinhalt {
  ts: number;
  type: string;
  entity: string | null;
  entity_id: string | null;
  action: string | null;
  collection: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  ai_model: string | null;
  ai_function: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_eur: number | null;
  source: string | null;
  metadata: string | null;
}

export interface AuditKettenZeile extends AuditNutzinhalt { id: number; hash_chain: string }

export type Sha256 = (text: string) => string;

/** auditPayload: beide Seiten — Schreiben und Prüfen — müssen exakt dieselbe Zeichenkette erzeugen. */
export function auditNutzinhalt(r: AuditNutzinhalt): string {
  return JSON.stringify({
    ts: r.ts, type: r.type, entity: r.entity, entity_id: r.entity_id, action: r.action, collection: r.collection,
    field_name: r.field_name, old_value: r.old_value, new_value: r.new_value, ai_model: r.ai_model, ai_function: r.ai_function,
    input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_eur: r.cost_eur, source: r.source, metadata: r.metadata,
  });
}

/** chainHash: Vorgänger-Hash plus eigener Nutzinhalt. */
export const kettenHash = (sha256: Sha256, vorher: string, zeile: AuditNutzinhalt) => sha256(vorher + auditNutzinhalt(zeile));

export interface AuditAnker {
  /** Hash des letzten gelöschten Eintrags — der neue Startwert der Prüfung. */
  prevHash: string;
  prevId: number;
  /** id des ältesten verbliebenen Eintrags; null, wenn nichts übrig blieb. */
  firstKeptId: number | null;
  deleted: number;
  cutoffTs: number;
}

/** parseAuditAnchor: fehlerhafte Metadaten gelten als „kein Anker“. */
export function ankerLesen(zeile: Pick<AuditKettenZeile, 'type' | 'action' | 'metadata'>): AuditAnker | null {
  if (zeile.type !== 'delete' || zeile.action !== AUDIT_ANKER_AKTION || !zeile.metadata) return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(zeile.metadata) as Record<string, unknown>; } catch { return null; }
  if (!m || typeof m.prevHash !== 'string' || !m.prevHash) return null;
  return {
    prevHash: m.prevHash,
    prevId: Number(m.prevId),
    firstKeptId: m.firstKeptId === null || m.firstKeptId === undefined ? null : Number(m.firstKeptId),
    deleted: Number(m.deleted) || 0,
    cutoffTs: Number(m.cutoffTs) || 0,
  };
}

/** resolveChainStart: es zählt nur ein Anker, dessen `firstKeptId` auf die älteste vorhandene Zeile zeigt. */
export function kettenStart(zeilen: AuditKettenZeile[]): { prev: string; anker: (AuditAnker & { auditId: number }) | null } {
  if (zeilen.length === 0) return { prev: AUDIT_GENESIS, anker: null };
  const aeltesteId = zeilen[0]!.id;
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const a = ankerLesen(zeilen[i]!);
    if (a && a.firstKeptId !== null && a.firstKeptId === aeltesteId) return { prev: a.prevHash, anker: { ...a, auditId: zeilen[i]!.id } };
  }
  return { prev: AUDIT_GENESIS, anker: null };
}

/** anchorMetadata */
export const ankerMetadaten = (a: AuditAnker): Record<string, unknown> => ({
  prevHash: a.prevHash, prevId: a.prevId, firstKeptId: a.firstKeptId, deleted: a.deleted, cutoffTs: a.cutoffTs,
  note: 'Ab hier beginnt die Kette neu — ältere Einträge wurden entfernt.',
});

export interface AuditKettenBefund {
  ok: boolean;
  totalRows: number;
  checkedRows: number;
  brokenAt?: { id: number; expected: string; actual: string };
  anker?: (AuditAnker & { auditId: number }) | null;
  note?: string;
}

/** verifyChainRows: Zeilen in id-Reihenfolge rein, Befund raus. */
export function ketteRechnen(sha256: Sha256, zeilen: AuditKettenZeile[]): AuditKettenBefund {
  const { prev: start, anker } = kettenStart(zeilen);
  let prev = start;
  for (const r of zeilen) {
    const erwartet = kettenHash(sha256, prev, r);
    if (erwartet !== r.hash_chain) {
      return {
        ok: false, totalRows: zeilen.length, checkedRows: r.id, anker,
        brokenAt: { id: r.id, expected: erwartet, actual: r.hash_chain },
        note: r.id === zeilen[0]!.id && !anker
          ? 'Der Bruch liegt auf der ältesten Zeile und es gibt keinen Anker. Das ist das '
            + 'Muster eines Aufräumlaufs, der ohne Anker lief — z. B. ein Löschen von Hand '
            + 'direkt in der Datenbank.'
          : 'Ab dieser id stimmt keine Verkettung mehr. Die Zeilen davor sind unverändert.',
      };
    }
    prev = r.hash_chain;
  }
  return { ok: true, totalRows: zeilen.length, checkedRows: zeilen.length, anker };
}

// ── Anzeige (Einstellungen → Audit-Log) ─────────────────────

export const AUDIT_TYPEN = [
  { wert: '', label: 'Alle Typen' }, { wert: 'mutation', label: 'Daten-Änderungen' }, { wert: 'kicall', label: 'KI-Aufrufe' },
  { wert: 'backup', label: 'Backups' }, { wert: 'delete', label: 'Löschungen' }, { wert: 'import', label: 'Importe' }, { wert: 'merge', label: 'Merges' },
] as const;
export const AUDIT_ENTITAETEN = [
  { wert: '', label: 'Alle Entitäten' }, { wert: 'deal', label: 'Deals' }, { wert: 'makler', label: 'Maklers' }, { wert: 'objekt', label: 'Objekte' },
  { wert: 'projekt', label: 'Projekte' }, { wert: 'doc', label: 'Dokumente' },
] as const;
export const AUDIT_SYMBOL: Record<string, string> = { mutation: '✏️', kicall: '🤖', backup: '💾', delete: '🗑', import: '📥', merge: '🔀' };

/** fmtAuditValue: JSON kompakt, ab 120 Zeichen gekürzt. */
export function auditWert(roh: string | null | undefined): string {
  if (roh === null || roh === undefined || roh === '') return '–';
  try {
    const geparst: unknown = JSON.parse(roh);
    if (geparst && typeof geparst === 'object') {
      const s = JSON.stringify(geparst);
      return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    }
    return String(geparst);
  } catch {
    return roh.length > 120 ? `${roh.slice(0, 117)}…` : roh;
  }
}

/** fmtAuditTs: Sekunden seit 1970 → deutsches Datum mit Sekunden. */
export const auditZeitpunkt = (ts: number) =>
  new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' });

/** Eintrag in der Form, wie ihn die API liefert. */
export interface AuditAnzeigeZeile {
  ts: number; type: string; entity?: string | null; entityId?: string | null; action?: string | null; collection?: string | null;
  fieldName?: string | null; oldValue?: string | null; newValue?: string | null; aiModel?: string | null; aiFunction?: string | null;
  inputTokens?: number | null; outputTokens?: number | null; costEur?: number | null; source?: string | null; metadata?: string | null;
}

/** Kopfzeile und Wertzeile einer Log-Zeile (renderAuditRow). */
export function auditZeile(r: AuditAnzeigeZeile) {
  const kopf = [
    AUDIT_SYMBOL[r.type] || '•',
    auditZeitpunkt(r.ts),
    '·',
    r.entity ? `${r.entity}${r.entityId ? ` #${r.entityId.slice(-6)}` : ''}` : '',
    r.action ?? '',
    r.fieldName ? `· Feld: ${r.fieldName}` : '',
    r.collection ? `· ${r.collection}` : '',
    r.source ? `(${r.source})` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  let wert = '';
  if (r.type === 'kicall') {
    const kosten = r.costEur != null ? ` · ${r.costEur.toFixed(4)}€` : '';
    wert = `${r.aiModel ?? ''}${r.aiFunction ? ` ${r.aiFunction}` : ''} · ${r.inputTokens ?? 0} in / ${r.outputTokens ?? 0} out${kosten}`.trim();
  } else if (r.oldValue != null || r.newValue != null) {
    wert = `${auditWert(r.oldValue)} → ${auditWert(r.newValue)}`;
  } else if (r.metadata) {
    wert = auditWert(r.metadata);
  }
  return { kopf, wert };
}
