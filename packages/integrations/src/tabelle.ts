/**
 * Tabellen (.xlsx/.xls) lesen — dasselbe Vorgehen wie in der alten App (XLSX.utils.sheet_to_json mit header: 1):
 * das erste Blatt, erste Zeile sind die Überschriften, leere Zellen werden zu leeren Zeichenketten.
 */
import * as XLSX from 'xlsx';

export interface Tabelle { ueberschriften: string[]; zeilen: unknown[][] }

export function tabelleLesen(bytes: Uint8Array): Tabelle {
  const mappe = XLSX.read(bytes, { type: 'array' });
  const blattName = mappe.SheetNames[0];
  const blatt = blattName ? mappe.Sheets[blattName] : undefined;
  if (!blatt) return { ueberschriften: [], zeilen: [] };
  const alle = XLSX.utils.sheet_to_json<unknown[]>(blatt, { header: 1, defval: '' });
  const [kopf = [], ...rest] = alle;
  return { ueberschriften: (kopf as unknown[]).map((h) => String(h ?? '')), zeilen: rest };
}

/** Signatur: .xlsx ist ein ZIP („PK“), .xls beginnt mit dem OLE2-Kopf. */
export function istTabelle(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);
  return zip || ole2;
}
