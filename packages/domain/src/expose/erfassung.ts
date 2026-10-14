/**
 * Exposé-Erfassung v2 (Protokoll 28): Was die KI liefert — Teil A `felder`: die gg-Felder wie früher (bewährter Prompt,
 * Format der Prüfseite: objekt, makler, kalkulation, _konfidenz); Teil B: jede Angabe des Dokuments wörtlich, mit Seite, Standard-Pfad
 * (OpenImmo + gg-Erweiterung, `katalog.ts`) und gg-Mapping-Vorschlag (`ziele.ts`). Mietlisten als Tabellen mit
 * Spaltenüberschriften und wörtlichen Zellen. Kein Wert wird von der KI umgerechnet, gekürzt oder gedeutet;
 * Zahlen macht erst der Code daraus (`normalisieren.ts`), die Zuordnung zu gg die Mapping-Tabelle (`zuordnung.ts`).
 *
 * Dieses Objekt wird unverändert als `expose_importe.rohdaten` gespeichert.
 */
import { z } from 'zod';
import { Dokument } from './dokument.ts';
import { EINHEIT_FELD_NAMEN, KATALOG, KATALOG_PFADE } from './katalog.ts';
import { levenshtein } from './uebernahme.ts';
import { GG_ZIEL_SCHLUESSEL, GG_ZIELE } from './ziele.ts';

export const EXPOSE_V2_SCHEMA = 'gg-expose-v2' as const;
export const EXPOSE_V0_SCHEMA = 'gg-expose-v0' as const;
export const EXPOSE_V2_TOOL_NAME = 'erfasse_expose';

export const ErfassteAngabe = z.object({
  bezeichnung: z.string().describe('Bezeichnung/Beschriftung WÖRTLICH wie im Dokument, z. B. "Kaufpreis", "Baujahr ca.", "Instandhaltungsrücklage". Ohne Beschriftung: kurze Überschrift des Abschnitts.'),
  wert: z.string().describe('Wert WÖRTLICH und VOLLSTÄNDIG wie im Dokument, mit Einheit und Zusätzen ("1.250.000,00 €", "ca. 850 m²", "3,57 % inkl. MwSt."). Freitexte ungekürzt.'),
  seite: z.number().int().nullable().describe('Seite, auf der die Angabe steht'),
  pfad: z.enum(KATALOG_PFADE).nullable().describe('Passender Standard-Pfad aus der Liste; null, wenn keiner passt'),
  kontakt: z.number().int().min(1).nullable().describe('Nur für Kontaktangaben: Nummer der Person/Firma (1 = Hauptansprechpartner des Anbieters, 2, 3 … weitere). Sonst null.'),
  gg: z.enum(GG_ZIEL_SCHLUESSEL).nullable().describe('Vorschlag: in welches gg-Feld gehört dieser Wert? null, wenn keines passt'),
});
export type ErfassteAngabe = z.infer<typeof ErfassteAngabe>;

export const EinheitenTabelle = z.object({
  seite: z.number().int().nullable().describe('Seite, auf der die Tabelle beginnt'),
  titel: z.string().nullable().describe('Überschrift der Tabelle wörtlich, z. B. "Mieterliste"'),
  spalten: z.array(z.object({
    ueberschrift: z.string().describe('Spaltenüberschrift wörtlich'),
    feld: z.enum(EINHEIT_FELD_NAMEN).nullable().describe('Bedeutung der Spalte; null, wenn keine passt'),
  })),
  zeilen: z.array(z.array(z.string())).describe('Eine Zeile je Einheit; Zellen wörtlich in Spaltenreihenfolge, leere Zelle = ""'),
});
export type EinheitenTabelle = z.infer<typeof EinheitenTabelle>;

/** Teil A: Antwort im Format des bisherigen Werkzeugs (`extract_expose_data`) — locker typisiert, `zuordnen` liest sie. */
export const ExposeFelder = z.record(z.string(), z.unknown());

export const ExposeV2 = z.object({
  schema: z.literal(EXPOSE_V2_SCHEMA),
  felder: ExposeFelder.nullable(),
  angaben: z.array(ErfassteAngabe),
  einheiten_tabellen: z.array(EinheitenTabelle),
  einheiten_im_dokument: z.number().int().nullable(),
  einheiten_vollstaendig: z.boolean(),
  /** Seit P1: das ohne KI gelesene Dokument — die unveränderten Rohdaten, aus denen `angaben`/`einheiten_tabellen` stammen */
  dokument: Dokument.nullable().optional(),
});
export type ExposeV2 = z.infer<typeof ExposeV2>;

/** Werkzeug-Eingabe = ExposeV2 ohne das Kennzeichen `schema` (setzt der Code). */
const Werkzeug = ExposeV2.omit({ schema: true, felder: true, dokument: true }).extend({
  einheiten_im_dokument: z.number().int().nullable().describe('Anzahl der Einheiten, die das Dokument insgesamt nennt (Wohnungen + Gewerbe + Stellplätze), null wenn nicht genannt'),
  einheiten_vollstaendig: z.boolean().describe('true, wenn alle Einheiten des Dokuments in einheiten_tabellen stehen'),
});

/** JSON-Schema für Teil B des Werkzeugs (Teil A hängt @gg/integrations aus dem bisherigen Werkzeug davor); `nurEinheiten` für den Nachfass. */
export function exposeV2ToolSchema(nurEinheiten = false): Record<string, unknown> {
  const quelle = nurEinheiten ? Werkzeug.pick({ einheiten_tabellen: true, einheiten_im_dokument: true, einheiten_vollstaendig: true }) : Werkzeug;
  const s = z.toJSONSchema(quelle, { target: 'draft-7' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** Katalog als kompakte Liste für den Prompt: „pfad — Label“. */
export const katalogFuerPrompt = () => Object.entries(KATALOG).map(([p, e]) => `${p} — ${e.label}`).join('\n');
export const zieleFuerPrompt = () => Object.entries(GG_ZIELE).map(([s, z]) => `${s} — ${z.label}`).join('\n');

const istText = (v: unknown): v is string => typeof v === 'string';

/** Tippfehler der KI im Pfad („preises.x_fache“): nächster Katalog-Pfad mit höchstens 2 Zeichen Abstand, sonst null. */
export function pfadBerichtigen(pfad: string): string | null {
  let bester: string | null = null; let abstand = 3;
  for (const k of KATALOG_PFADE) {
    if (Math.abs(k.length - pfad.length) > 2) continue;
    const d = levenshtein(k, pfad);
    if (d < abstand) { abstand = d; bester = k; }
  }
  return bester;
}
const ganz = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/**
 * KI-Antwort tolerant in ExposeV2 bringen: unbekannte Pfade/Ziele → null (mit Warnung), leere Angaben fallen weg,
 * Zeilen auf Spaltenzahl gebracht. Nichts wird gekürzt.
 */
export function exposeV2Bereinigen(roh: unknown): { v2: ExposeV2; warnungen: string[] } {
  const warnungen: string[] = [];
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const angaben: ErfassteAngabe[] = [];
  for (const a of Array.isArray(r.angaben) ? r.angaben : []) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    const wert = istText(x.wert) ? x.wert.trim() : typeof x.wert === 'number' ? String(x.wert) : '';
    if (!wert) continue;
    let pfad = istText(x.pfad) ? x.pfad : null;
    if (pfad && !(pfad in KATALOG)) {
      const ersatz = pfadBerichtigen(pfad);
      if (ersatz) { warnungen.push(`Standard-Pfad „${pfad}“ berichtigt zu „${ersatz}“`); pfad = ersatz; }
      else { warnungen.push(`Unbekannter Standard-Pfad „${pfad}“ → ohne Pfad`); pfad = null; }
    }
    let gg = istText(x.gg) ? x.gg : null;
    if (gg && !(gg in GG_ZIELE)) gg = null;
    const kontakt = ganz(x.kontakt);
    angaben.push({
      bezeichnung: istText(x.bezeichnung) && x.bezeichnung.trim() ? x.bezeichnung.trim() : (pfad ? KATALOG[pfad]!.label : 'Angabe'),
      wert, seite: ganz(x.seite), pfad, kontakt: kontakt !== null && kontakt >= 1 ? kontakt : null, gg,
    });
  }
  const tabellen: EinheitenTabelle[] = [];
  for (const t of Array.isArray(r.einheiten_tabellen) ? r.einheiten_tabellen : []) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    const spalten = (Array.isArray(x.spalten) ? x.spalten : []).map((s) => {
      const y = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const feld = istText(y.feld) && (EINHEIT_FELD_NAMEN as readonly string[]).includes(y.feld) ? (y.feld as EinheitenTabelle['spalten'][number]['feld']) : null;
      return { ueberschrift: istText(y.ueberschrift) ? y.ueberschrift : '', feld };
    });
    if (!spalten.length) continue;
    const zeilen = (Array.isArray(x.zeilen) ? x.zeilen : [])
      .filter(Array.isArray)
      .map((z) => spalten.map((_, i) => { const c = (z as unknown[])[i]; return istText(c) ? c.trim() : typeof c === 'number' ? String(c) : ''; }))
      .filter((z) => z.some(Boolean));
    tabellen.push({ seite: ganz(x.seite), titel: istText(x.titel) ? x.titel : null, spalten, zeilen });
  }
  const felder: Record<string, unknown> | null = ['objekt', 'makler', 'kalkulation'].some((k) => r[k] && typeof r[k] === 'object')
    ? Object.fromEntries(['objekt', 'makler', 'kalkulation', '_konfidenz'].filter((k) => r[k] && typeof r[k] === 'object').map((k) => [k, r[k]]))
    : (r.felder && typeof r.felder === 'object' ? r.felder as Record<string, unknown> : null);
  return {
    v2: {
      schema: EXPOSE_V2_SCHEMA, felder, angaben, einheiten_tabellen: tabellen,
      einheiten_im_dokument: ganz(r.einheiten_im_dokument), einheiten_vollstaendig: r.einheiten_vollstaendig !== false,
      ...(r.dokument && Dokument.safeParse(r.dokument).success ? { dokument: r.dokument as Dokument } : {}),
    },
    warnungen,
  };
}

export const exposeV2Leer = (): ExposeV2 => ({ schema: EXPOSE_V2_SCHEMA, felder: null, angaben: [], einheiten_tabellen: [], einheiten_im_dokument: null, einheiten_vollstaendig: true });
