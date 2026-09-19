// Wörtliche Kopie von gg-immohandel src/lib/begleitscheinAktionenSeed.ts (Abweichung: Importpfad).
// ══════════════════════════════════════════════════════════════
// Begleitscheine — Auslieferungszustand der Aktionskonfiguration
// ══════════════════════════════════════════════════════════════
// Y1: Die Einstufung der Punkte aus §W ist **Konfiguration, kein Code**.
// Diese Datei ist der Auslieferungszustand des Baukastens — alles hier lässt
// sich unter Einstellungen → Begleitscheine → Aktionen ändern oder abschalten.
//
// Punkte, die in §W nur „Unterpunkte-Liste" sind (R15, R16, R25, R31, R33,
// R35, R54, R84, R121), bekommen bewusst **keine** Aktion: die Unterpunkte
// sind eine eingebaute Funktion (B13–B19), keine Aktion.

import type { BsAktion, BsAktionTyp } from './engine.ts';

interface Seed {
  rowId: string;
  subId?: string;
  label: string;
  typ: BsAktionTyp;
  url?: string;
  modul?: string;
  analyseTyp?: string;
  datenQuelle?: string;
}

/** Die 9 Unterpunkte von R105 — je Unterpunkt ein eigener Brief (B20–B22, W11). */
const R105_SUBS = [
  'Müll', 'Wartungsfirmen', 'Hausmeister/Reinigung', 'Niederschlagswasser',
  'Schornsteinfeger', 'Strom', 'Gas', 'Wasser', 'Fernwärme',
].map((name, i): Seed => ({
  rowId: 'r105',
  subId: `r105s${i + 1}`,
  label: `Anschreiben ${name}`,
  typ: 'vordruck-brief',
}));

const SEED: readonly Seed[] = [
  // ── U — Unterstützung ────────────────────────────────────
  { rowId: 'r14',  label: 'Nutzungsdauer.com öffnen',   typ: 'link', url: 'https://www.nutzungsdauer.com' },
  { rowId: 'r17',  label: 'Kundenkalkulation öffnen',   typ: 'modul', modul: 'deal-kundenkalk' },
  { rowId: 'r18',  label: 'Checkliste F000/F005',       typ: 'vordruck-brief' },
  { rowId: 'r53',  label: 'Budget anzeigen',            typ: 'daten', datenQuelle: 'kalkulation' },
  { rowId: 'r55',  label: 'FK-Anteil anzeigen',         typ: 'daten', datenQuelle: 'kalkulation' },
  { rowId: 'r56',  label: 'Bank-Präsentation öffnen',   typ: 'modul', modul: 'deal-finanzpraes' },
  { rowId: 'r58',  label: 'Kalkulation öffnen',         typ: 'modul', modul: 'deal-kalkulation' },
  { rowId: 'r96',  label: 'Mail öffnen',                typ: 'mail' },
  // W: Ziel-Link wird nachgereicht — Aktion bleibt bis dahin ohne Adresse (Y5)
  { rowId: 'r109', label: 'Verkäuferabrechnung öffnen', typ: 'link' },
  { rowId: 'r123', label: 'Vertriebsliste öffnen',      typ: 'modul', modul: 'vertriebslisten' },
  { rowId: 'r124', label: 'Kundenkalkulation öffnen',   typ: 'modul', modul: 'deal-kundenkalk' },
  { rowId: 'r130', label: 'Vertriebsliste öffnen',      typ: 'modul', modul: 'vertriebslisten' },
  { rowId: 'r132', label: 'Budget anzeigen',            typ: 'daten', datenQuelle: 'kalkulation' },

  // ── D — Dokumentenanalyse (§X) ───────────────────────────
  { rowId: 'r24',  label: 'Mietverträge auswerten',     typ: 'analyse', analyseTyp: 'mietvertraege' },
  { rowId: 'r27',  label: 'Teilungserklärung auswerten', typ: 'analyse', analyseTyp: 'teilungserklaerung' },

  // ── A — Automatisierung. Vordrucke stehen noch aus (Y5/Y17) ──
  { rowId: 'r28',  label: 'Anschreiben Grundbuchamt',   typ: 'vordruck-brief' },
  { rowId: 'r46',  label: 'Anfrage Baulasten',          typ: 'vordruck-brief' },
  { rowId: 'r47',  label: 'Anfrage Denkmalschutz',      typ: 'vordruck-brief' },
  { rowId: 'r48',  label: 'Anfrage Altlasten',          typ: 'vordruck-brief' },
  { rowId: 'r79',  label: 'Impower-Datei erzeugen',     typ: 'vordruck-datei' },
  { rowId: 'r82',  label: 'Objektaufnahme F066',        typ: 'vordruck-brief' },
  { rowId: 'r93',  label: 'Mitteilung neues Objekt',    typ: 'vordruck-brief' },
  { rowId: 'r102', label: 'Info Eigentumsübergang',     typ: 'vordruck-brief' },
  ...R105_SUBS,
  { rowId: 'r106', label: 'Info Versicherung ease',     typ: 'vordruck-brief' },
  { rowId: 'r107', label: 'Info Minol',                 typ: 'vordruck-brief' },
  { rowId: 'r118', label: 'Anschreiben Nachbarn',       typ: 'vordruck-brief' },
  { rowId: 'r138', label: 'Mail Restnutzungsdauer F062', typ: 'vordruck-brief' },
  { rowId: 'r139', label: 'Mail Baubeschreibung F061',  typ: 'vordruck-brief' },
  { rowId: 'r141', label: 'Beauftragung Fotograf',      typ: 'vordruck-brief' },
];

/** Auslieferungszustand der Aktionen für die Ankaufsvorlage. */
export function bsSeedAktionen(): BsAktion[] {
  return SEED.map((s, i) => ({
    id: `a${i + 1}`,
    label: s.label,
    typ: s.typ,
    aktiv: true,
    rowId: s.rowId,
    subId: s.subId,
    url: s.url,
    modul: s.modul,
    analyseTyp: s.analyseTyp,
    datenQuelle: s.datenQuelle,
  }));
}
