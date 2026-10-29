/* eslint-disable @typescript-eslint/no-explicit-any -- Datensätze aus Liste und Werkzeug-Argumenten */
/**
 * Schreiben über MCP (29.10.2026): Claude legt Makler und Objekte an und ändert sie wie die App selbst.
 * Hier stehen die reinen Regeln — Dublettenprüfung vor dem Anlegen, Suche nach Maklern und das Änderungsprotokoll
 * fürs Audit-Log. Geschrieben wird nur über die Services der API (Versionsprüfung, Telefon-Normalisierung, Unternehmen).
 */
import { maklerVergleich, objektVergleich } from '../dubletten/index.ts';
import type { DublettenSicherheit } from '../expose/uebernahme.ts';

export interface DublettenKandidat<T> { eintrag: T; sicherheit: DublettenSicherheit; grund: string }

/** Höchstens so viele Kandidaten gehen an Claude zurück. */
export const MCP_KANDIDATEN_MAX = 10;

function kandidaten<T>(neu: any, bestand: readonly T[], vergleich: (a: any, b: any) => { sicherheit: DublettenSicherheit; grund: string } | null) {
  const treffer: DublettenKandidat<T>[] = [];
  for (const eintrag of bestand) {
    const v = vergleich(neu, eintrag);
    if (v) treffer.push({ eintrag, ...v });
  }
  // „exact“ zuerst, sonst Reihenfolge des Bestands
  return treffer.sort((a, b) => (a.sicherheit === b.sicherheit ? 0 : a.sicherheit === 'exact' ? -1 : 1)).slice(0, MCP_KANDIDATEN_MAX);
}

/** Anzeigename wie in der App: „Vorname Name“; ohne Vorname steht der volle Name in `name`. */
export const maklerAnzeigename = (m: { vorname?: string | null; name?: string | null }) =>
  [m.vorname, m.name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');

/** Gleiche E-Mail oder Telefonnummer (sicher), ähnlicher Name (unsicher) — dieselbe Regel wie unter „Dubletten“. */
export const maklerKandidaten = <T>(neu: { vorname?: string | null; name?: string | null; firma?: string | null; tel?: string | null; email?: string | null }, bestand: readonly T[]) =>
  kandidaten({ ...neu, name: maklerAnzeigename(neu) }, bestand, maklerVergleich);

/** Gleiche oder ähnliche Adresse — dieselbe Regel wie unter „Dubletten“. */
export const objektKandidaten = <T>(neu: { strasse?: string | null; hausnr?: string | null; stadt?: string | null; plz?: string | null }, bestand: readonly T[]) =>
  (neu.strasse ?? '').trim() ? kandidaten(neu, bestand, objektVergleich) : [];

/**
 * Anlegen trotz Treffer: Ein sicherer Treffer (gleiche E-Mail, Telefonnummer, Adresse) sperrt immer — dann ist
 * `update_*` gemeint. Ein ähnlicher Name sperrt, bis Claude ausdrücklich `trotzdemAnlegen` setzt.
 */
export function anlegenTrotzTreffern(treffer: readonly DublettenKandidat<unknown>[], trotzdem: boolean): { ok: true } | { ok: false; grund: string } {
  if (!treffer.length) return { ok: true };
  if (treffer.some((t) => t.sicherheit === 'exact')) {
    return { ok: false, grund: 'Es gibt diesen Eintrag schon (gleiche E-Mail, Telefonnummer oder Adresse). Bitte den vorhandenen Datensatz ändern.' };
  }
  if (trotzdem) return { ok: true };
  return { ok: false, grund: 'Es gibt ähnliche Einträge. Prüfen, ob einer davon gemeint ist; sonst mit "trotzdemAnlegen": true erneut aufrufen.' };
}

const ziffern = (s: string) => s.replace(/\D/g, '').replace(/^(00)?49/, '0');

/** Makler finden: jedes Wort muss in Name, Firma, E-Mail oder Telefon vorkommen (Groß-/Kleinschreibung egal). */
export function maklerSuchen<T extends { name?: string | null; firma?: string | null; email?: string | null; tel?: string | null }>(bestand: readonly T[], suche: string, limit = 20): T[] {
  const woerter = suche.toLowerCase().split(/\s+/).filter(Boolean);
  if (!woerter.length) return [];
  return bestand.filter((m) => {
    const text = [m.name, m.firma, m.email, m.tel].map((s) => (s ?? '').toLowerCase()).join(' ');
    const tel = ziffern(m.tel ?? '');
    return woerter.every((w) => text.includes(w) || (ziffern(w).length >= 4 && tel.includes(ziffern(w))));
  }).slice(0, limit);
}

export interface FeldAenderung { feld: string; alt: unknown; neu: unknown }

/** Fürs Audit-Log: nur Felder, die mitgegeben wurden und sich tatsächlich ändern („" und null gelten gleich). */
export function feldAenderungen(vorher: Record<string, any>, eingabe: Record<string, any>): FeldAenderung[] {
  const leer = (v: unknown) => (v === '' || v === undefined ? null : v);
  return Object.entries(eingabe)
    .filter(([feld, neu]) => feld !== 'version' && neu !== undefined && JSON.stringify(leer(vorher[feld])) !== JSON.stringify(leer(neu)))
    .map(([feld, neu]) => ({ feld, alt: leer(vorher[feld]), neu: leer(neu) }));
}
