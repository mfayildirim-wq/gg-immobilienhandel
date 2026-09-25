// Zielschema „fach“ (Protokoll 07 · 37 Tabellen). Erstfassung einmalig erzeugt aus protokoll/werkzeuge/er_gen.py
// (scripts/schema-aus-protokoll.py, nicht erneut ausführen). Ab jetzt ist DIESE Datei die Quelle:
// Änderungen hier vornehmen, danach `pnpm db:generate` (neue Migration, alte nie ändern).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn, bigint, boolean, check, date, doublePrecision, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp,
} from 'drizzle-orm/pg-core';
import { DEAL_STATUS, START_STATUS } from '@gg/domain';

export const fach = pgSchema('fach');

/** created_at · updated_at · deleted_at · version (07, Regeln 5 und 6) */
const standardSpalten = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  version: integer('version').notNull().default(1),
};

/** created_at · updated_at für Kind-Tabellen */
const zeitSpalten = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
};

export const makler = fach
  .table(
    'makler',
    {
  id: text('id').primaryKey(),
      name: text('name'),
      firma: text('firma'),
      /** Hauptnummer — die, die Wählmaschine und Briefing anrufen (alt: mobiltel || festnetztel || tel) */
      tel: text('tel'),
      mobil: text('mobil'),
      festnetz: text('festnetz'),
      email: text('email'),
      webseite: text('webseite'),
      strasse: text('strasse'),
      plz: text('plz'),
      ort: text('ort'),
      /** Was ein Exposé außer dem Hauptkontakt nennt: { namen: string[], telefonnummern: string[], emails: string[] } */
      weitereKontakte: jsonb('weitere_kontakte'),
      prio: text('prio'),
      kontaktFrequenz: text('kontakt_frequenz'),
      lastContact: date('last_contact'),
      nextContact: date('next_contact'),
      beziehungsNotiz: text('beziehungs_notiz'),
      tags: text('tags').array(),
      persoenlich: jsonb('persoenlich'),
      kiSummary: text('ki_summary'),
      kiSummaryAt: timestamp('ki_summary_at', { withTimezone: true, mode: 'string' }),
      /** Listenreihenfolge wie die alte App (neu angelegt = vorn): Umzug setzt den Index, neue Zeilen einen negativen Zeitwert */
      reihenfolge: bigint('reihenfolge', { mode: 'number' }).notNull().default(sql`(-(extract(epoch from clock_timestamp()) * 1000000))::bigint`),
          ...standardSpalten,
    },
    (t) => [
      index('makler_next_contact_idx').on(t.nextContact).where(sql`${t.deletedAt} is null`),
    ],
  )
  .enableRLS();

export const maklerKommunikation = fach
  .table('makler_kommunikation', {
  id: text('id').primaryKey(),
  maklerId: text('makler_id').notNull().references((): AnyPgColumn => makler.id, { onDelete: 'cascade' }),
  zeitpunkt: timestamp('zeitpunkt', { withTimezone: true, mode: 'string' }).defaultNow(),
  kanal: text('kanal'),
  richtung: text('richtung'),
  betreff: text('betreff'),
  text: text('text'),
  mailUid: text('mail_uid'),
  ...zeitSpalten,
  })
  .enableRLS();

export const objekte = fach
  .table(
    'objekte',
    {
  id: text('id').primaryKey(),
      strasse: text('strasse'),
      hausnr: text('hausnr'),
      plz: text('plz'),
      stadt: text('stadt'),
      bundesland: text('bundesland'),
      baujahr: integer('baujahr'),
      einheitenAnzahl: integer('einheiten_anzahl'),
      wohnflaeche: numeric('wohnflaeche', { precision: 10, scale: 2, mode: 'number' }),
      grundstueck: numeric('grundstueck', { precision: 10, scale: 2, mode: 'number' }),
      energieklasse: text('energieklasse'),
      heizung: text('heizung'),
      angebotspreis: numeric('angebotspreis', { precision: 14, scale: 2, mode: 'number' }),
      zielpreis: numeric('zielpreis', { precision: 14, scale: 2, mode: 'number' }),
      istMiete: numeric('ist_miete', { precision: 14, scale: 2, mode: 'number' }),
      sollMiete: numeric('soll_miete', { precision: 14, scale: 2, mode: 'number' }),
      status: text('status'),
      notizen: text('notizen'),
      erfasstAm: date('erfasst_am'),
      details: jsonb('details'),
      /** Listenreihenfolge wie die alte App (neu angelegt = vorn): Umzug setzt den Index, neue Zeilen einen negativen Zeitwert */
      reihenfolge: bigint('reihenfolge', { mode: 'number' }).notNull().default(sql`(-(extract(epoch from clock_timestamp()) * 1000000))::bigint`),
          ...standardSpalten,
    },
    (t) => [
      index('objekte_stadt_idx').on(t.stadt).where(sql`${t.deletedAt} is null`),
    ],
  )
  .enableRLS();

export const objektEinheiten = fach
  .table('objekt_einheiten', {
  id: text('id').primaryKey(),
  objektId: text('objekt_id').notNull().references((): AnyPgColumn => objekte.id, { onDelete: 'cascade' }),
  typ: text('typ'),
  lage: text('lage'),
  zimmer: numeric('zimmer', { precision: 4, scale: 1, mode: 'number' }),
  stueck: integer('stueck'),
  flaeche: numeric('flaeche', { precision: 10, scale: 2, mode: 'number' }),
  kaltmiete: numeric('kaltmiete', { precision: 14, scale: 2, mode: 'number' }),
  vermietung: text('vermietung'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const objektFotos = fach
  .table('objekt_fotos', {
  id: text('id').primaryKey(),
  objektId: text('objekt_id').notNull().references((): AnyPgColumn => objekte.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key'),
  dateiname: text('dateiname'),
  mimeType: text('mime_type'),
  groesseBytes: bigint('groesse_bytes', { mode: 'number' }),
  sort: integer('sort'),
  hochgeladenAm: timestamp('hochgeladen_am', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  })
  .enableRLS();

export const deals = fach
  .table(
    'deals',
    {
  id: text('id').primaryKey(),
      objektId: text('objekt_id').notNull().references((): AnyPgColumn => objekte.id),
      maklerId: text('makler_id').references((): AnyPgColumn => makler.id, { onDelete: 'set null' }),
      status: text('status').notNull().default(START_STATUS),
      prio: text('prio'),
      angebotsDatum: date('angebots_datum'),
      nachfassFrequenz: text('nachfass_frequenz'),
      lastContact: date('last_contact'),
      nextContact: date('next_contact'),
      kalkulation: jsonb('kalkulation'),
      propstackUnitId: text('propstack_unit_id'),
      exposeRohdaten: jsonb('expose_rohdaten'),
      notizen: text('notizen'),
      /** Listenreihenfolge wie die alte App (neu angelegt = vorn): Umzug setzt den Index, neue Zeilen einen negativen Zeitwert */
      reihenfolge: bigint('reihenfolge', { mode: 'number' }).notNull().default(sql`(-(extract(epoch from clock_timestamp()) * 1000000))::bigint`),
          ...standardSpalten,
    },
    (t) => [
      check('deals_status_check', sql`${t.status} in (${sql.raw(DEAL_STATUS.map((s) => `'${s}'`).join(', '))})`),
      index('deals_status_idx').on(t.status).where(sql`${t.deletedAt} is null`),
      index('deals_next_contact_idx').on(t.nextContact).where(sql`${t.deletedAt} is null`),
      index('deals_objekt_idx').on(t.objektId),
      index('deals_makler_idx').on(t.maklerId),
    ],
  )
  .enableRLS();

export const dealEinheiten = fach
  .table('deal_einheiten', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
  objektEinheitId: text('objekt_einheit_id').references((): AnyPgColumn => objektEinheiten.id, { onDelete: 'set null' }),
  typ: text('typ'),
  lage: text('lage'),
  zimmer: numeric('zimmer', { precision: 4, scale: 1, mode: 'number' }),
  // Felder der heutigen Ankaufskalkulation (deals.ts: fl, mi_ist, mi_neu, mi_neu_manual, rend_k, vkp, stk)
  flaeche: numeric('flaeche', { precision: 10, scale: 2, mode: 'number' }),
  mieteIst: numeric('miete_ist', { precision: 14, scale: 2, mode: 'number' }),
  mieteNeu: numeric('miete_neu', { precision: 14, scale: 2, mode: 'number' }),
  mieteNeuManuell: boolean('miete_neu_manuell').notNull().default(false),
  renditeK: numeric('rendite_k', { precision: 7, scale: 4, mode: 'number' }),
  verkaufspreis: numeric('verkaufspreis', { precision: 14, scale: 2, mode: 'number' }),
  stueck: integer('stueck'),
  // Altformat (fl_ist/fl_soll/mi_soll): wird von der heutigen Kalkulation nicht gelesen, nur aufbewahrt
  flaecheIst: numeric('flaeche_ist', { precision: 10, scale: 2, mode: 'number' }),
  flaecheSoll: numeric('flaeche_soll', { precision: 10, scale: 2, mode: 'number' }),
  mieteSoll: numeric('miete_soll', { precision: 14, scale: 2, mode: 'number' }),
  /** Propstack-Bewertung: übrige Felder der alten Einheit, u. a. _psUnitId und die zuletzt genutzten Angaben */
  bewertung: jsonb('bewertung'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const dealStatusHistorie = fach
  .table(
    'deal_status_historie',
    {
  id: text('id').primaryKey(),
      dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
      vonStatus: text('von_status'),
      nachStatus: text('nach_status'),
      am: timestamp('am', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
      quelle: text('quelle'),
      grund: text('grund'),
    },
    (t) => [
      check('deal_status_historie_nach_check', sql`${t.nachStatus} in (${sql.raw(DEAL_STATUS.map((s) => `'${s}'`).join(', '))})`),
      index('deal_status_historie_deal_idx').on(t.dealId, t.am),
    ],
  )
  .enableRLS();

export const dealSanierungen = fach
  .table('deal_sanierungen', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
  beschreibung: text('beschreibung'),
  betrag: numeric('betrag', { precision: 14, scale: 2, mode: 'number' }),
  /** Exit-Weg: both = beide, auf = nur Aufteiler, glo = nur Global (alte App: scope, leer = both) */
  bereich: text('bereich'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const dealKommentare = fach
  .table('deal_kommentare', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
  zeitpunkt: timestamp('zeitpunkt', { withTimezone: true, mode: 'string' }).defaultNow(),
  text: text('text'),
  autor: text('autor'),
  })
  .enableRLS();

export const dealKalkVarianten = fach
  .table('deal_kalk_varianten', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
  name: text('name'),
  kalkulation: jsonb('kalkulation'),
  einheiten: jsonb('einheiten'),
  sanierungen: jsonb('sanierungen'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  })
  .enableRLS();

/** Wo eine Datei liegt: im Supabase Storage (wie bisher) oder in SharePoint (Protokoll 19). */
export const DOKUMENT_ABLAGEN = ['supabase', 'sharepoint'] as const;

/**
 * Dokumente an Geschäftsobjekten (Protokoll 19, Phase 2) — vorher `deal_dokumente`, nur am Deal. Genau ein Bezug ist
 * gesetzt: Deal oder Objekt (Makler und Projekt folgen). Der Ablageort steht je Dokument: Bestände bleiben in Supabase,
 * Neues kann nach SharePoint; für SharePoint werden die stabile Item-Kennung, der Pfad und der Link gemerkt.
 */
export const dokumente = fach
  .table(
    'dokumente',
    {
      id: text('id').primaryKey(),
      dealId: text('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
      objektId: text('objekt_id').references((): AnyPgColumn => objekte.id, { onDelete: 'cascade' }),
      dateiname: text('dateiname'),
      mimeType: text('mime_type'),
      groesseBytes: bigint('groesse_bytes', { mode: 'number' }),
      label: text('label'),
      istExpose: boolean('ist_expose'),
      ablage: text('ablage').notNull().default('supabase'),
      /** Supabase: Bucket und Schlüssel */
      bucket: text('bucket').notNull().default('deal-docs'),
      storageKey: text('storage_key'),
      /** SharePoint: stabile Kennung, Pfad in der Bibliothek, Link, Änderungsstand */
      spItemId: text('sp_item_id'),
      spPfad: text('sp_pfad'),
      spWebUrl: text('sp_web_url'),
      spEtag: text('sp_etag'),
      hochgeladenAm: timestamp('hochgeladen_am', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    },
    (t) => [
      check('dokumente_bezug_check', sql`${t.dealId} is not null or ${t.objektId} is not null`),
      check('dokumente_ablage_check', sql`${t.ablage} in ('supabase', 'sharepoint')`),
      index('dokumente_objekt_idx').on(t.objektId),
      index('dokumente_deal_idx').on(t.dealId),
    ],
  )
  .enableRLS();

export const kundenkalkulationen = fach
  .table('kundenkalkulationen', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id),
  dealEinheitId: text('deal_einheit_id').references((): AnyPgColumn => dealEinheiten.id, { onDelete: 'set null' }),
  name: text('name'),
  scope: text('scope'),
  inputs: jsonb('inputs'),
  objSnapshot: jsonb('obj_snapshot'),
  projektTitel: text('projekt_titel'),
  wertsteigBullets: text('wertsteig_bullets').array(),
  wertsteigSichtbar: boolean('wertsteig_sichtbar'),
  kaufpreisWohnung: numeric('kaufpreis_wohnung', { precision: 14, scale: 2, mode: 'number' }),
  kaufpreisStellplatz: numeric('kaufpreis_stellplatz', { precision: 14, scale: 2, mode: 'number' }),
  stellplaetzeAnzahl: integer('stellplaetze_anzahl'),
  stellplatzEinhIds: text('stellplatz_einh_ids').array(),
  bildRefs: text('bild_refs').array(),
  internNotiz: text('intern_notiz'),
  ...standardSpalten,
  })
  .enableRLS();

export const finanzpraesentationen = fach
  .table('finanzpraesentationen', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id),
  bankName: text('bank_name'),
  internNotiz: text('intern_notiz'),
  ...standardSpalten,
  })
  .enableRLS();

export const praesentationFolien = fach
  .table('praesentation_folien', {
  id: text('id').primaryKey(),
  praesentationId: text('praesentation_id').notNull().references((): AnyPgColumn => finanzpraesentationen.id, { onDelete: 'cascade' }),
  typ: text('typ'),
  sichtbar: boolean('sichtbar'),
  sort: integer('sort'),
  daten: jsonb('daten'),
  ...zeitSpalten,
  })
  .enableRLS();

export const vertriebslisten = fach
  .table('vertriebslisten', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references((): AnyPgColumn => deals.id),
  spalten: jsonb('spalten'),
  versteckteSpalten: text('versteckte_spalten').array(),
  ...standardSpalten,
  })
  .enableRLS();

export const vertriebslisteZeilen = fach
  .table('vertriebsliste_zeilen', {
  id: text('id').primaryKey(),
  listeId: text('liste_id').notNull().references((): AnyPgColumn => vertriebslisten.id, { onDelete: 'cascade' }),
  dealEinheitId: text('deal_einheit_id').references((): AnyPgColumn => dealEinheiten.id, { onDelete: 'set null' }),
  istStellplatz: boolean('ist_stellplatz'),
  sort: integer('sort'),
  daten: jsonb('daten'),
  ...zeitSpalten,
  })
  .enableRLS();

export const projekte = fach
  .table('projekte', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'set null' }),
  adresse: text('adresse'),
  stadt: text('stadt'),
  datum: date('datum'),
  zielVkp: numeric('ziel_vkp', { precision: 14, scale: 2, mode: 'number' }),
  finanzParameter: jsonb('finanz_parameter'),
  // Globalverkauf (gesamtes Objekt)
  globalVstatus: text('global_vstatus'),
  globalIstKp: numeric('global_ist_kp', { precision: 14, scale: 2, mode: 'number' }),
  globalKommentar: text('global_kommentar'),
  globalKaeufer: text('global_kaeufer'),
  globalNotarDatum: date('global_notar_datum'),
  globalReservDatum: date('global_reserv_datum'),
  /** Reihenfolge der Übersicht wie alt: neues Projekt vorn (kleinster Wert zuerst) */
  sort: integer('sort'),
  ...standardSpalten,
  })
  .enableRLS();

export const projektEinheiten = fach
  .table('projekt_einheiten', {
  id: text('id').primaryKey(),
  projektId: text('projekt_id').notNull().references((): AnyPgColumn => projekte.id, { onDelete: 'cascade' }),
  dealEinheitId: text('deal_einheit_id').references((): AnyPgColumn => dealEinheiten.id, { onDelete: 'set null' }),
  typ: text('typ'),
  lage: text('lage'),
  zimmer: numeric('zimmer', { precision: 4, scale: 1, mode: 'number' }),
  flaeche: numeric('flaeche', { precision: 10, scale: 2, mode: 'number' }),
  kaltmiete: numeric('kaltmiete', { precision: 14, scale: 2, mode: 'number' }),
  kmMoeglich: numeric('km_moeglich', { precision: 14, scale: 2, mode: 'number' }),
  teNr: text('te_nr'),
  stueck: integer('stueck'),
  vermietet: text('vermietet'),
  mieterName: text('mieter_name'),
  // Kaufpreisbestandteile
  grundpreis: numeric('grundpreis', { precision: 14, scale: 2, mode: 'number' }),
  provision: numeric('provision', { precision: 14, scale: 2, mode: 'number' }),
  sanierungIvt: numeric('sanierung_ivt', { precision: 14, scale: 2, mode: 'number' }),
  ergebnisIvt: numeric('ergebnis_ivt', { precision: 14, scale: 2, mode: 'number' }),
  zielKp: numeric('ziel_kp', { precision: 14, scale: 2, mode: 'number' }),
  istKp: numeric('ist_kp', { precision: 14, scale: 2, mode: 'number' }),
  vstatus: text('vstatus'),
  reservDatum: date('reserv_datum'),
  notarDatum: date('notar_datum'),
  kaeufer: text('kaeufer'),
  pip: text('pip'),
  pipStrategie: text('pip_strategie'),
  pipTodos: text('pip_todos'),
  vertriebsstand: text('vertriebsstand'),
  mieterTodos: text('mieter_todos'),
  vtKommentar: text('vt_kommentar'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const projektMieterhistorie = fach
  .table('projekt_mieterhistorie', {
  id: text('id').primaryKey(),
  projektEinheitId: text('projekt_einheit_id').notNull().references((): AnyPgColumn => projektEinheiten.id, { onDelete: 'cascade' }),
  datum: date('datum'),
  inhalt: text('inhalt'),
  ergebnis: text('ergebnis'),
  /** Reihenfolge wie alt: neuester Eintrag zuerst */
  sort: integer('sort'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  })
  .enableRLS();

export const projektAufgaben = fach
  .table('projekt_aufgaben', {
  id: text('id').primaryKey(),
  projektId: text('projekt_id').notNull().references((): AnyPgColumn => projekte.id, { onDelete: 'cascade' }),
  kategorie: text('kategorie'),
  text: text('text'),
  status: text('status'),
  kommentar: text('kommentar'),
  verantwortlich: text('verantwortlich'),
  faellig: date('faellig'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const projektGebaeudeMassnahmen = fach
  .table('projekt_gebaeude_massnahmen', {
  id: text('id').primaryKey(),
  projektId: text('projekt_id').notNull().references((): AnyPgColumn => projekte.id, { onDelete: 'cascade' }),
  text: text('text'),
  status: text('status'),
  verantwortlich: text('verantwortlich'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const begleitscheine = fach
  .table('begleitscheine', {
  id: text('id').primaryKey(),
  vorlageTyp: text('vorlage_typ').notNull().references((): AnyPgColumn => begleitscheinVorlagen.typ),
  objektId: text('objekt_id').notNull().references((): AnyPgColumn => objekte.id),
  dealId: text('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'set null' }),
  adresse: text('adresse'),
  whgNr: text('whg_nr'),
  name: text('name'),
  kopf: text('kopf'),
  zeilen: jsonb('zeilen'),
  archiviertAm: timestamp('archiviert_am', { withTimezone: true, mode: 'string' }),
  ...standardSpalten,
  })
  .enableRLS();

export const begleitscheinVorlagen = fach
  .table('begleitschein_vorlagen', {
  typ: text('typ').primaryKey(),
  kopf: text('kopf'),
  zeilen: jsonb('zeilen'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  })
  .enableRLS();

export const begleitscheinAktionen = fach
  .table('begleitschein_aktionen', {
  id: text('id').primaryKey(),
  vorlageTyp: text('vorlage_typ').notNull().references((): AnyPgColumn => begleitscheinVorlagen.typ, { onDelete: 'cascade' }),
  rowId: text('row_id'),
  subId: text('sub_id'),
  typ: text('typ'),
  label: text('label'),
  aktiv: boolean('aktiv'),
  vordruckId: text('vordruck_id').references((): AnyPgColumn => vordrucke.id, { onDelete: 'set null' }),
  url: text('url'),
  modul: text('modul'),
  empfaenger: text('empfaenger'),
  betreff: text('betreff'),
  analyseTyp: text('analyse_typ'),
  datenQuelle: text('daten_quelle'),
  /** Reihenfolge der Knöpfe an einem Punkt (alt: Array-Reihenfolge) */
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const vordrucke = fach
  .table('vordrucke', {
  id: text('id').primaryKey(),
  nummer: text('nummer'),
  titel: text('titel'),
  art: text('art'),
  inhalt: text('inhalt'),
  betreff: text('betreff'),
  dateiName: text('datei_name'),
  aktiv: boolean('aktiv'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const textvorlagen = fach
  .table('textvorlagen', {
  id: text('id').primaryKey(),
  name: text('name'),
  kanal: text('kanal'),
  betreff: text('betreff'),
  text: text('text'),
  sort: integer('sort'),
  ...zeitSpalten,
  })
  .enableRLS();

export const ddChecklisteVorlage = fach
  .table('dd_checkliste_vorlage', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  dokument: text('dokument'),
  quelle: text('quelle'),
  sort: integer('sort'),
  })
  .enableRLS();

export const einstellungen = fach
  .table('einstellungen', {
  schluessel: text('schluessel').primaryKey(),
  wert: jsonb('wert'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  })
  .enableRLS();

export const geheimnisse = fach
  .table('geheimnisse', {
  schluessel: text('schluessel').primaryKey(),
  wertVerschluesselt: text('wert_verschluesselt'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  })
  .enableRLS();

export const mailImportGesehen = fach
  .table('mail_import_gesehen', {
  uid: text('uid').primaryKey(),
  gesehenAm: timestamp('gesehen_am', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  })
  .enableRLS();

export const gespeicherteFilter = fach
  .table('gespeicherte_filter', {
  id: text('id').primaryKey(),
  modul: text('modul'),
  name: text('name'),
  kriterien: jsonb('kriterien'),
  ...zeitSpalten,
  })
  .enableRLS();

export const mergeProtokoll = fach
  .table('merge_protokoll', {
  id: text('id').primaryKey(),
  entitaet: text('entitaet'),
  aktion: text('aktion'),
  primaerId: text('primaer_id'),
  sekundaerId: text('sekundaer_id'),
  primaerSnapshot: jsonb('primaer_snapshot'),
  sekundaerSnapshot: jsonb('sekundaer_snapshot'),
  betroffeneDealIds: text('betroffene_deal_ids').array(),
  /** Stand des behaltenen Eintrags direkt nach dem Zusammenführen (Undo warnt, wenn seither gearbeitet wurde) */
  ergebnisSnapshot: jsonb('ergebnis_snapshot'),
  /** Umgehängte Dateien je Tabelle, damit ein Rückgängig genau diese zurückschiebt */
  betroffeneDateien: jsonb('betroffene_dateien'),
  rueckgaengigAm: timestamp('rueckgaengig_am', { withTimezone: true, mode: 'string' }),
  am: timestamp('am', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  })
  .enableRLS();

export const auditLog = fach
  .table('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  ts: bigint('ts', { mode: 'number' }),
  hashChain: text('hash_chain').unique(),
  type: text('type'),
  entity: text('entity'),
  entityId: text('entity_id'),
  action: text('action'),
  collection: text('collection'),
  fieldName: text('field_name'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  aiModel: text('ai_model'),
  aiFunction: text('ai_function'),
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  costEur: doublePrecision('cost_eur'),
  source: text('source'),
  metadata: text('metadata'),
  })
  .enableRLS();

export const oauthTokens = fach
  .table('oauth_tokens', {
  account: text('account').primaryKey(),
  provider: text('provider'),
  userEmail: text('user_email'),
  homeAccountId: text('home_account_id'),
  refreshTokenEnc: text('refresh_token_enc'),
  accessTokenEnc: text('access_token_enc'),
  accessTokenExp: bigint('access_token_exp', { mode: 'number' }),
  scopes: text('scopes'),
  connectedAt: bigint('connected_at', { mode: 'number' }),
  lastRefreshedAt: bigint('last_refreshed_at', { mode: 'number' }),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  })
  .enableRLS();

export const autoImportRuns = fach
  .table('auto_import_runs', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'set null' }),
  startedAt: bigint('started_at', { mode: 'number' }),
  finishedAt: bigint('finished_at', { mode: 'number' }),
  mailUid: text('mail_uid'),
  mailFrom: text('mail_from'),
  mailSubject: text('mail_subject'),
  status: text('status'),
  outcome: text('outcome'),
  classification: text('classification'),
  stepsJson: text('steps_json'),
  structuredJson: text('structured_json'),
  pdfKey: text('pdf_key'),
  pdfFilename: text('pdf_filename'),
  errorMessage: text('error_message'),
  durationMs: bigint('duration_ms', { mode: 'number' }),
  })
  .enableRLS();

/**
 * Zwischenspeicher der KI-Kontaktanlässe je Makler (alt: localStorage `immo-hooks-<id>`, 24 h im Browser).
 * In der Datenbank zählt ein Aufruf je Makler und Tag — egal wie oft, wo und von welcher Function-Instanz die Seite geöffnet wird.
 */
export const maklerAnlaesse = fach
  .table('makler_anlaesse', {
  maklerId: text('makler_id').primaryKey().references((): AnyPgColumn => makler.id, { onDelete: 'cascade' }),
  ermitteltAt: timestamp('ermittelt_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  anlaesse: jsonb('anlaesse').notNull(),
  })
  .enableRLS();

export const archiveLedger = fach
  .table(
    'archive_ledger',
    {
  bucket: text('bucket').notNull(),
      key: text('key').notNull(),
      archiveKey: text('archive_key'),
      sizeBytes: bigint('size_bytes', { mode: 'number' }),
      sourceUpdatedAt: text('source_updated_at'),
      mirroredAt: bigint('mirrored_at', { mode: 'number' }),
      missingSince: bigint('missing_since', { mode: 'number' }),
    },
    (t) => [
      primaryKey({ columns: [t.bucket, t.key] }),
    ],
  )
  .enableRLS();
