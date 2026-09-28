import { DealStatus, Frequenz } from '@gg/domain';
import { z } from 'zod';

/** Gemeinsamer Vertrag zwischen apps/api und apps/web. */

const IsoDatum = z.iso.date();
const Text = z.string().trim().max(2000);

export const Makler = z.object({
  id: z.string(),
  name: z.string().nullable(),
  firma: z.string().nullable(),
  tel: z.string().nullable(),
  email: z.string().nullable(),
  prio: z.enum(['A', 'B', 'C']).nullable(),
  kontaktFrequenz: z.string().nullable(),
  nextContact: IsoDatum.nullable(),
  version: z.number().int(),
});
export type Makler = z.infer<typeof Makler>;

/** Makler ohne Pflichtfelder (Nutzerwunsch, 09). Anlage-Default: Prio B, Monatlich. */
export const MaklerAnlegen = z.object({
  name: Text.optional(),
  firma: Text.optional(),
  tel: Text.optional(),
  email: Text.optional(),
  prio: z.enum(['A', 'B', 'C']).default('B'),
  kontaktFrequenz: Frequenz.default('Monatlich'),
});
export type MaklerAnlegen = z.input<typeof MaklerAnlegen>;

export const Objekt = z.object({
  id: z.string(),
  strasse: z.string().nullable(),
  hausnr: z.string().nullable(),
  plz: z.string().nullable(),
  stadt: z.string().nullable(),
  einheitenAnzahl: z.number().int().nullable(),
  wohnflaeche: z.number().nullable(),
  angebotspreis: z.number().nullable(),
  status: z.string().nullable(),
  version: z.number().int(),
});
export type Objekt = z.infer<typeof Objekt>;

/** Objekt ohne Pflichtfelder (Nutzerwunsch, 09). Anlage-Default: In Prüfung. */
export const ObjektAnlegen = z.object({
  strasse: Text.optional(),
  hausnr: Text.optional(),
  plz: Text.optional(),
  stadt: Text.optional(),
  einheitenAnzahl: z.number().int().min(0).optional(),
  wohnflaeche: z.number().min(0).optional(),
  angebotspreis: z.number().min(0).optional(),
});
export type ObjektAnlegen = z.input<typeof ObjektAnlegen>;

export const DealListenEintrag = z.object({
  id: z.string(),
  status: DealStatus,
  prio: z.string().nullable(),
  nachfassFrequenz: z.string().nullable(),
  nextContact: IsoDatum.nullable(),
  notizen: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.string(),
  objekt: z.object({ id: z.string(), titel: z.string(), stadt: z.string().nullable() }),
  makler: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type DealListenEintrag = z.infer<typeof DealListenEintrag>;

/** Manuell: Objekt Pflicht; Makler optional (Ist-Verhalten des Imports, Fachfrage 1). */
export const DealAnlegen = z.object({
  objektId: z.string().min(1),
  maklerId: z.string().min(1).optional(),
  nachfassFrequenz: Frequenz.default('Wöchentlich'),
  notizen: Text.optional(),
});
export type DealAnlegen = z.input<typeof DealAnlegen>;

export const StatusWechsel = z.object({
  status: DealStatus,
  version: z.number().int(),
  grund: Text.optional(),
});
export type StatusWechsel = z.infer<typeof StatusWechsel>;

export const StatusHistorieEintrag = z.object({
  id: z.string(),
  vonStatus: z.string().nullable(),
  nachStatus: DealStatus,
  am: z.string(),
  quelle: z.string().nullable(),
  grund: z.string().nullable(),
});
export type StatusHistorieEintrag = z.infer<typeof StatusHistorieEintrag>;

export const Fehler = z.object({ fehler: z.string(), details: z.unknown().optional() });
export type Fehler = z.infer<typeof Fehler>;

// ── Deal-Detail ────────────────────────────────────────────

const Zahl = z.number().finite();
const ZahlOderLeer = Zahl.nullable();

export const DealEinheit = z.object({
  id: z.string(),
  typ: z.string().nullable(),
  lage: z.string().nullable(),
  zimmer: ZahlOderLeer,
  flaeche: ZahlOderLeer,
  mieteIst: ZahlOderLeer,
  mieteNeu: ZahlOderLeer,
  mieteNeuManuell: z.boolean(),
  renditeK: ZahlOderLeer,
  verkaufspreis: ZahlOderLeer,
  stueck: z.number().int().nullable(),
});
export type DealEinheit = z.infer<typeof DealEinheit>;

export const DealSanierung = z.object({
  id: z.string(),
  beschreibung: z.string().nullable(),
  betrag: ZahlOderLeer,
  bereich: z.enum(['both', 'auf', 'glo']).nullable(),
});
export type DealSanierung = z.infer<typeof DealSanierung>;

export const DealKommentar = z.object({ id: z.string(), zeitpunkt: z.string().nullable(), text: z.string().nullable() });
export type DealKommentar = z.infer<typeof DealKommentar>;

/** Kalkulationswerte wie in der alten App (deal.kalk); unbekannte Schlüssel bleiben erhalten. */
export const KalkulationWerte = z.record(z.string(), z.union([Zahl, z.string(), z.boolean(), z.null()]));
export type KalkulationWerte = z.infer<typeof KalkulationWerte>;

export const DealDetail = DealListenEintrag.extend({
  angebotsDatum: IsoDatum.nullable(),
  lastContact: IsoDatum.nullable(),
  kalkulation: KalkulationWerte,
  einheiten: z.array(DealEinheit),
  sanierungen: z.array(DealSanierung),
  kommentare: z.array(DealKommentar),
});
export type DealDetail = z.infer<typeof DealDetail>;

export const DealInfoAendern = z.object({
  version: z.number().int(),
  prio: Text.nullable().optional(),
  maklerId: z.string().min(1).nullable().optional(),
  angebotsDatum: IsoDatum.nullable().optional(),
  nachfassFrequenz: Frequenz.optional(),
  lastContact: IsoDatum.nullable().optional(),
  nextContact: IsoDatum.nullable().optional(),
  notizen: Text.nullable().optional(),
});
export type DealInfoAendern = z.infer<typeof DealInfoAendern>;

const EinheitSpeichern = DealEinheit.omit({ id: true }).extend({ id: z.string().optional() });
const SanierungSpeichern = DealSanierung.omit({ id: true }).extend({ id: z.string().optional() });

export const KalkulationSpeichern = z.object({
  version: z.number().int(),
  kalkulation: KalkulationWerte,
  einheiten: z.array(EinheitSpeichern).max(500),
  sanierungen: z.array(SanierungSpeichern).max(500),
});
export type KalkulationSpeichern = z.infer<typeof KalkulationSpeichern>;

/** Kalkulationsvariante (alt d.kalkVarianten[]): Momentaufnahme von Kalkulation, Einheiten und Sanierung. */
export const KalkVariante = z.object({
  id: z.string(),
  name: z.string(),
  ts: z.string(),
  kalkulation: KalkulationWerte,
  einheiten: z.array(EinheitSpeichern),
  sanierungen: z.array(SanierungSpeichern),
});
export type KalkVariante = z.infer<typeof KalkVariante>;
export const KalkVarianteAnlegen = z.object({
  name: z.string().trim().min(1).max(300),
  kalkulation: KalkulationWerte,
  einheiten: z.array(EinheitSpeichern).max(500),
  sanierungen: z.array(SanierungSpeichern).max(500),
});
export type KalkVarianteAnlegen = z.infer<typeof KalkVarianteAnlegen>;

export const Kennzahlen = z.object({
  gik: z.number(), kaufpreis: z.number(), gewinnAuf: z.number(), margeAuf: z.number(), gewinnGlo: z.number(), margeGlo: z.number(),
});

export const KommentarAnlegen = z.object({ text: z.string().trim().min(1).max(5000) });

export const KalkStandardSchema = z.object({
  notar: Zahl, gest: Zahl, makler: Zahl, fk_p: Zahl, ek_p: Zahl, euribor: Zahl, margeB: Zahl, bank_abgeb: Zahl,
  ek_r: Zahl, halt: Zahl, vprov: Zahl, glo_m: Zahl, rp_pct: Zahl, rend_k: Zahl, auf_h: Zahl, auf_e: Zahl,
});

// ── Makler- und Objekt-Detail ──────────────────────────────

export const MaklerKommunikation = z.object({
  id: z.string(),
  zeitpunkt: z.string().nullable(),
  kanal: z.string().nullable(),
  richtung: z.string().nullable(),
  betreff: z.string().nullable(),
  text: z.string().nullable(),
});
export type MaklerKommunikation = z.infer<typeof MaklerKommunikation>;

/** Was ein Exposé außer dem Hauptkontakt nennt (`weitereKontakte` in @gg/domain); nur Anzeige. */
export const WeitereKontakte = z.object({ namen: z.array(z.string()), telefonnummern: z.array(z.string()), emails: z.array(z.string()) });

export const MaklerDetail = Makler.extend({
  persoenlich: z.record(z.string(), z.unknown()).nullable(),
  webseite: z.string().nullable(),
  mobil: z.string().nullable(),
  festnetz: z.string().nullable(),
  strasse: z.string().nullable(),
  plz: z.string().nullable(),
  ort: z.string().nullable(),
  weitereKontakte: WeitereKontakte.nullable(),
  lastContact: IsoDatum.nullable(),
  beziehungsNotiz: z.string().nullable(),
  kommunikation: z.array(MaklerKommunikation),
  deals: z.array(z.object({ id: z.string(), status: DealStatus, objektTitel: z.string() })),
  kiSummary: z.string().nullable(),
  /** wie alt „d.M.yyyy HH:MM“ */
  kiSummaryAt: z.string().nullable(),
  erstellt: z.string(),
});
export type MaklerDetail = z.infer<typeof MaklerDetail>;

/** Bewusst ohne Standardwerte: `MaklerAnlegen.partial()` würde in zod 4 Prio/Frequenz beim Ändern still zurücksetzen. */
export const MaklerAendern = z.object({
  version: z.number().int(),
  name: Text.optional(),
  firma: Text.optional(),
  tel: Text.optional(),
  email: Text.optional(),
  prio: z.enum(['A', 'B', 'C']).optional(),
  kontaktFrequenz: Frequenz.optional(),
  webseite: Text.optional(),
  /** Leer heißt „keine Angabe" und wird als null gespeichert. `tel` bleibt die Nummer, die gewählt wird. */
  mobil: Text.nullable().optional(),
  festnetz: Text.nullable().optional(),
  strasse: Text.nullable().optional(),
  plz: z.string().trim().max(10).nullable().optional(),
  ort: Text.nullable().optional(),
  beziehungsNotiz: Text.nullable().optional(),
  nextContact: IsoDatum.nullable().optional(),
  lastContact: IsoDatum.nullable().optional(),
});
export type MaklerAendern = z.input<typeof MaklerAendern>;

export const KommunikationAnlegen = z.object({
  // Werte wie in der alten App (makler.komm[].kanal / richtung)
  kanal: z.enum(['anruf', 'email', 'whatsapp', 'notiz']),
  richtung: z.enum(['eingehend', 'ausgehend']).optional(),
  betreff: Text.optional(),
  text: z.string().trim().min(1).max(5000),
  /** Datum eines importierten Vorgangs (Mail); ohne → heute */
  datum: IsoDatum.optional(),
});
export type KommunikationAnlegen = z.infer<typeof KommunikationAnlegen>;

export const ObjektEinheit = z.object({
  id: z.string(), typ: z.string().nullable(), lage: z.string().nullable(), zimmer: ZahlOderLeer, stueck: z.number().int().nullable(),
  flaeche: ZahlOderLeer, kaltmiete: ZahlOderLeer, vermietung: z.string().nullable(),
});
export type ObjektEinheit = z.infer<typeof ObjektEinheit>;

export const ObjektFoto = z.object({
  id: z.string(),
  objektId: z.string(),
  dateiname: z.string().nullable(),
  mimeType: z.string(),
  groesseBytes: z.number(),
  sort: z.number().int(),
  hochgeladenAm: z.string(),
  /** Verweis, wie ihn Präsentationen und Kundenkalkulationen speichern: `photo:<objektId>/<fotoId>` */
  ref: z.string(),
  /** Bildadresse zum Anzeigen (dieselbe Form wie in der alten App: /api/photos/<objektId>/<fotoId>) */
  url: z.string(),
});
export type ObjektFoto = z.infer<typeof ObjektFoto>;
export const FotoReihenfolge = z.object({ ids: z.array(z.string()).max(500) });

export const ObjektDetail = Objekt.extend({
  bundesland: z.string().nullable(),
  baujahr: z.number().int().nullable(),
  grundstueck: ZahlOderLeer,
  energieklasse: z.string().nullable(),
  heizung: z.string().nullable(),
  zielpreis: ZahlOderLeer,
  istMiete: ZahlOderLeer,
  sollMiete: ZahlOderLeer,
  notizen: z.string().nullable(),
  einheiten: z.array(ObjektEinheit),
  deals: z.array(z.object({ id: z.string(), status: DealStatus, maklerName: z.string().nullable() })),
});
export type ObjektDetail = z.infer<typeof ObjektDetail>;

export const ObjektAendern = ObjektAnlegen.extend({
  version: z.number().int(),
  // Beim Ändern darf ein Wert geleert werden (null)
  einheitenAnzahl: z.number().int().min(0).nullable().optional(),
  wohnflaeche: z.number().min(0).nullable().optional(),
  angebotspreis: z.number().min(0).nullable().optional(),
  bundesland: Text.optional(),
  baujahr: z.number().int().min(1000).max(2200).nullable().optional(),
  grundstueck: z.number().min(0).nullable().optional(),
  energieklasse: Text.optional(),
  heizung: Text.optional(),
  zielpreis: z.number().min(0).nullable().optional(),
  istMiete: z.number().min(0).nullable().optional(),
  sollMiete: z.number().min(0).nullable().optional(),
  status: Text.optional(),
  notizen: Text.nullable().optional(),
  /** Einheitenaufstellung; fehlt sie, bleiben die gespeicherten Einheiten unverändert. */
  einheiten: z.array(ObjektEinheit.omit({ id: true }).extend({ id: z.string().optional() })).max(500).optional(),
});
export type ObjektAendern = z.input<typeof ObjektAendern>;

// ── Microsoft 365 (Posteingang, Angebote) ──────────────────

export const M365Stand = z.object({
  eingerichtet: z.boolean(), clientId: z.string(), tenantId: z.string(), verbunden: z.boolean(),
  email: z.string(), verbundenSeit: z.string().nullable(), ordner: z.string(), scopes: z.array(z.string()),
  /** Test-Modus: eine Attrappe liefert den Posteingang (M365_ATTRAPPE=1) */
  testModus: z.boolean(),
  /** Auto-Import-Bot freigeschaltet (`AUTO_IMPORT_AKTIV`; online standardmäßig aus) — sonst zeigt die Oberfläche keine Bot-Knöpfe */
  autoImport: z.boolean(),
});
export type M365Stand = z.infer<typeof M365Stand>;
/** SharePoint als Dokumentablage (Protokoll 19): Site, Wurzelordner, Schalter; die Azure-App kommt aus Microsoft 365. */
export const SharepointStand = z.object({ siteUrl: z.string(), wurzel: z.string(), aktiv: z.boolean(), m365Eingerichtet: z.boolean(), wurzelStandard: z.string() });
export type SharepointStand = z.infer<typeof SharepointStand>;
export const SharepointKonfiguration = z.object({ siteUrl: z.string().max(500), wurzel: z.string().max(200), aktiv: z.boolean() });

export const M365Mail = z.object({
  uid: z.string(), datum: z.string(), von: z.string(), vonName: z.string(), betreff: z.string(), vorschau: z.string(),
  anhaenge: z.array(z.object({ id: z.string(), name: z.string(), groesseMb: z.number(), art: z.string(), auswertbar: z.boolean() })),
  links: z.array(z.string()), anhaengeUnvollstaendig: z.boolean(), gesperrt: z.boolean(),
  /** Schon verarbeitet — von einem erfolgreichen Auto-Import hier oder (umgezogen) in der alten App */
  importiert: z.boolean(),
  /** Triage (Stufe 0): wo steckt das Exposé, und warum */
  triage: z.object({
    verdict: z.string(),
    kandidat: z.object({ quelle: z.string(), ref: z.string(), code: z.string(), score: z.number(), warum: z.array(z.string()) }).nullable(),
    gruende: z.array(z.string()), objektnummern: z.array(z.string()), rechtsdokumente: z.array(z.string()),
  }),
});
/** Ein Lauf des Auto-Imports: was geprüft wurde, wie es ausging und — bei Erfolg — wo das Exposé im Eingang liegt. */
export const AutoImportLauf = z.object({
  runId: z.string(), mailUid: z.string(), von: z.string(), betreff: z.string(),
  status: z.string(), ausgang: z.string().nullable(), einordnung: z.string().nullable(), grund: z.string().nullable(),
  eingangKey: z.string().nullable(), dateiname: z.string().nullable(), dauerMs: z.number().nullable(), gestartet: z.string().nullable(),
  schritte: z.array(z.object({ schritt: z.string(), ok: z.boolean(), dauerMs: z.number(), fehler: z.string().optional(), details: z.record(z.string(), z.unknown()).optional() })),
});
export type AutoImportLauf = z.infer<typeof AutoImportLauf>;

export const M365Posteingang = z.object({ ordner: z.string(), mails: z.array(M365Mail) });
export type M365Posteingang = z.infer<typeof M365Posteingang>;

// ── Propstack (Bewertung je Einheit) ───────────────────────

export const BewertungsDaten = z.object({
  strasse: z.string(), hausnr: z.string(), plz: z.string(), ort: z.string(), baujahr: z.string(),
  wohnflaeche: z.string(), zimmer: z.string(), letzteModernisierung: z.string(), etage: z.string(),
  etagenzahl: z.string(), balkonFlaeche: z.string(), qualitaet: z.enum(['einfach', 'normal', 'gehoben', 'luxuriös']),
});
export const PropstackBewertung = z.object({
  dealId: z.string(), einheitId: z.string(), daten: BewertungsDaten, unitId: z.string().nullable(), url: z.string().nullable(),
});
export type PropstackBewertung = z.infer<typeof PropstackBewertung>;

// ── Aktionen nach außen (Default-Deny-Gate, MCP-Freigaben) ─

export const OutwardFreigabe = z.object({
  id: z.string(), ts: z.string(), action: z.string(), url: z.string(), grund: z.string(),
  bezug: z.string().nullable(), beantragtVon: z.string(),
});
export type OutwardFreigabe = z.infer<typeof OutwardFreigabe>;
export const OutwardStand = z.object({
  schalter: z.object({ allowAgbSubmit: z.boolean(), allowPropstackWrite: z.boolean(), extraAgbHosts: z.array(z.string()) }),
  scharfeUmgebung: z.boolean(),
  notAus: z.boolean(),
  proben: z.array(z.object({ action: z.string(), url: z.string(), erlaubt: z.boolean(), failed: z.array(z.string()), grund: z.string() })),
  freigaben: z.array(OutwardFreigabe),
});
export type OutwardStand = z.infer<typeof OutwardStand>;

// ── Makler-Import aus Tabellen ─────────────────────────────

export const MaklerImportVorschau = z.object({
  zeilen: z.number(), ueberschriften: z.array(z.string()), zuordnung: z.record(z.string(), z.number()),
  vorschau: z.array(z.record(z.string(), z.string())),
});
export type MaklerImportVorschau = z.infer<typeof MaklerImportVorschau>;

// ── Zugänge (API-Schlüssel) ────────────────────────────────

/** Zielstatus für neue Einheiten im Propstack-CRM (alt: „📋 Statuses laden"). */
export const PropstackStatusListe = z.object({
  liste: z.array(z.object({ id: z.number().int(), name: z.string() })),
  /** Status, dessen Name „Kaufangebot" enthält — der übliche Zielstatus. */
  vorschlag: z.number().int().nullable(),
  gewaehlt: z.number().int().nullable(),
});
export type PropstackStatusListe = z.infer<typeof PropstackStatusListe>;
export const PropstackStatusWahl = z.object({ id: z.number().int().nullable() });

export const ZugangStatus = z.object({
  schluessel: z.string(), label: z.string(), hinweis: z.string(), umgebung: z.string(),
  quelle: z.enum(['einstellungen', 'umgebung', 'fehlt']), maske: z.string(),
  /** Wo der Schlüssel beim Anbieter erzeugt wird — ohne diesen Weg sucht man ihn in jeder Oberfläche neu. */
  quelleUrl: z.string(), quelleText: z.string(),
});
export type ZugangStatus = z.infer<typeof ZugangStatus>;

// ── Werkzeuge (Nachfass-Reset, KI-Kosten) ──────────────────

const NachfassEintrag = z.object({ id: z.string(), label: z.string(), zusatz: z.string() });
export const NachfassResetSicht = z.object({ datum: z.string(), deals: z.array(NachfassEintrag), makler: z.array(NachfassEintrag) });
export type NachfassResetSicht = z.infer<typeof NachfassResetSicht>;
export const KiKostenZeile = z.object({ model: z.string(), funktion: z.string(), aufrufe: z.number(), inputTokens: z.number(), outputTokens: z.number(), kostenEur: z.number() });
export type KiKostenZeile = z.infer<typeof KiKostenZeile>;
export const KiKosten = z.object({ zeilen: z.array(KiKostenZeile), summeEur: z.number(), tage: z.number() });
export type KiKosten = z.infer<typeof KiKosten>;

// ── Audit-Log ──────────────────────────────────────────────

export const AuditEintrag = z.object({
  id: z.number(), ts: z.number(), type: z.string(), entity: z.string().nullable(), entityId: z.string().nullable(),
  action: z.string().nullable(), collection: z.string().nullable(), fieldName: z.string().nullable(),
  oldValue: z.string().nullable(), newValue: z.string().nullable(), aiModel: z.string().nullable(), aiFunction: z.string().nullable(),
  inputTokens: z.number().nullable(), outputTokens: z.number().nullable(), costEur: z.number().nullable(),
  source: z.string().nullable(), metadata: z.string().nullable(),
});
export type AuditEintrag = z.infer<typeof AuditEintrag>;
export const AuditFilter = z.object({
  type: z.string().optional(), entity: z.string().optional(), von: z.string().optional(), bis: z.string().optional(),
  suche: z.string().optional(), limit: z.coerce.number().int().min(1).max(100_000).optional(), offset: z.coerce.number().int().min(0).optional(),
});
export type AuditFilter = z.infer<typeof AuditFilter>;
export const AuditSeite = z.object({ gesamt: z.number(), zeilen: z.array(AuditEintrag) });
export type AuditSeite = z.infer<typeof AuditSeite>;
export const AuditBefund = z.object({
  ok: z.boolean(), totalRows: z.number(), checkedRows: z.number(),
  brokenAt: z.object({ id: z.number(), expected: z.string(), actual: z.string() }).optional(),
  anker: z.object({ prevHash: z.string(), prevId: z.number(), firstKeptId: z.number().nullable(), deleted: z.number(), cutoffTs: z.number(), auditId: z.number() }).nullable(),
  note: z.string().optional(),
});
export type AuditBefund = z.infer<typeof AuditBefund>;

// ── Dubletten und Zusammenführen ───────────────────────────

const DublettenTyp = z.enum(['makler', 'objekt', 'deal']);
export const DublettenPaarSicht = z.object({
  typ: DublettenTyp, sicherheit: z.enum(['exact', 'fuzzy']), grund: z.string(),
  a: z.object({ id: z.string(), label: z.string() }),
  b: z.object({ id: z.string(), label: z.string() }),
});
export type DublettenPaarSicht = z.infer<typeof DublettenPaarSicht>;

export const MergeVorschau = z.object({
  typ: DublettenTyp, primaerId: z.string(), sekundaerId: z.string(), primaerLabel: z.string(), sekundaerLabel: z.string(),
  felder: z.array(z.object({ feld: z.string(), wertA: z.string(), wertB: z.string(), konflikt: z.boolean() })),
  wahlListen: z.array(z.object({ name: z.string(), anzahlA: z.number(), anzahlB: z.number() })),
  vereinteListen: z.array(z.object({ name: z.string(), anzahlA: z.number(), anzahlB: z.number() })),
  dateienB: z.number(),
});
export type MergeVorschau = z.infer<typeof MergeVorschau>;

export const MergeAusfuehren = z.object({
  typ: DublettenTyp, primaerId: z.string().min(1), sekundaerId: z.string().min(1),
  felder: z.record(z.string(), z.enum(['A', 'B'])).default({}),
  listen: z.record(z.string(), z.enum(['A', 'B', 'union'])).default({}),
});
export type MergeAusfuehren = z.input<typeof MergeAusfuehren>;

export const MergeProtokollEintrag = z.object({
  id: z.string(), typ: z.string(), primaerId: z.string(), sekundaerId: z.string(), am: z.string(),
  rueckgaengigAm: z.string().nullable(), abgelaufen: z.boolean(), betroffeneDeals: z.number(),
});
export type MergeProtokollEintrag = z.infer<typeof MergeProtokollEintrag>;

// ── Papierkorb ─────────────────────────────────────────────

export const PapierkorbEintrag = z.object({ bereich: z.string(), id: z.string(), bezeichnung: z.string(), geloeschtAm: z.string() });
export type PapierkorbEintrag = z.infer<typeof PapierkorbEintrag>;

// ── Ankauf-Cockpit ─────────────────────────────────────────

export const Faelligkeit = z.object({
  klasse: z.enum(['ueberfaellig', 'heute', 'woche']),
  tage: z.number().int(),
  label: z.string(),
  sort: z.number().int(),
});

const Kontakt = z.object({ id: z.string(), name: z.string().nullable(), firma: z.string().nullable(), tel: z.string().nullable(), email: z.string().nullable() });

export const CockpitDeal = z.object({
  id: z.string(),
  version: z.number().int(),
  status: DealStatus,
  nachfassFrequenz: z.string().nullable(),
  nextContact: IsoDatum.nullable(),
  lastContact: IsoDatum.nullable(),
  termin: IsoDatum,
  faellig: Faelligkeit,
  objekt: z.object({ id: z.string(), titel: z.string(), stadt: z.string().nullable() }),
  kaufpreis: z.number().nullable(),
  wohnflaeche: z.number().nullable(),
  jahresmiete: z.number().nullable(),
  makler: Kontakt.nullable(),
});
export type CockpitDeal = z.infer<typeof CockpitDeal>;

export const MaklerHinweis = z.object({ art: z.enum(['geburtstag', 'stagnation']), text: z.string(), dringend: z.boolean() });

export const CockpitMakler = Kontakt.extend({
  version: z.number().int(),
  prio: z.string().nullable(),
  kontaktFrequenz: z.string().nullable(),
  nextContact: IsoDatum.nullable(),
  lastContact: IsoDatum.nullable(),
  termin: IsoDatum,
  faellig: Faelligkeit,
  aktiveDeals: z.number().int(),
  hinweise: z.array(MaklerHinweis),
  merker: z.array(z.object({ ts: z.string(), thema: z.string(), detail: z.string() })),
});
export type CockpitMakler = z.infer<typeof CockpitMakler>;

export const TageslogEintrag = z.object({
  zeitpunkt: z.string(),
  art: z.enum(['makler', 'deal']),
  titel: z.string(),
  text: z.string(),
  kanal: z.string().nullable(),
});
export type TageslogEintrag = z.infer<typeof TageslogEintrag>;

export const AnkaufCockpit = z.object({
  heute: IsoDatum,
  deals: z.array(CockpitDeal),
  makler: z.array(CockpitMakler),
  tageslog: z.array(TageslogEintrag),
});
export type AnkaufCockpit = z.infer<typeof AnkaufCockpit>;

export const AnrufErgebnisSpeichern = z.object({
  version: z.number().int(),
  ergebnis: z.enum(['erreicht', 'nicht', 'rueckruf']).nullable(),
  notiz: z.string().max(5000),
  frequenz: z.string().min(1).max(40),
  rueckrufDatum: IsoDatum.nullable(),
});
export type AnrufErgebnisSpeichern = z.infer<typeof AnrufErgebnisSpeichern>;

export const TerminSetzen = z.object({ version: z.number().int(), nextContact: IsoDatum.nullable() });
export type TerminSetzen = z.infer<typeof TerminSetzen>;

// ── Kundenkalkulation ──────────────────────────────────────

const Anteil = z.number().finite();
export const KundenkalkInputs = z.object({
  kaufpreis: Zahl, notarPct: Anteil, grundbuchPct: Anteil, grundsteuerPct: Anteil, maklerPct: Anteil, sonstigePct: Anteil,
  sanierungsposten: z.array(z.object({ label: z.string(), amount: Zahl, modus: z.enum(['sofort', 'aktivieren', 'weg_ruecklage']) })).max(200),
  nettokaltmieteMonat: Zahl, stellplatzMiete: Zahl, sonstigeMiete: Zahl, umlagefaehig: Zahl, mieterhoehungJaehrlich: Anteil,
  nichtUmlagefaehig: Zahl, kostensteigerungJaehrlich: Anteil, wertsteigerungJaehrlich: Anteil, anteilGebaeudeKaufpreis: Anteil, afaSatz: Anteil,
  afaTypDenkmal: z.boolean().optional(), denkmalAfaBasis: Zahl.optional(), denkmalAfaSatz: Anteil.optional(),
  grenzsteuersatz: Anteil,
  darlehen: z.array(z.object({ label: z.string(), summe: Zahl, zinssatz: Anteil, tilgung: Anteil })).max(20),
  betrachtungsdauerJahre: z.number().int().min(1).max(50).optional(),
  kaufjahr: z.number().int().optional(),
  wohnflaecheGesamt: Zahl.optional(),
});

export const ObjSnapshot = z.object({
  adresse: z.string(), kaufdatum: z.string(), wohnflaecheGesamt: Zahl, stellplaetzeAnzahl: Zahl, einheitenAnzahl: Zahl,
});

const KundenkalkFelder = z.object({
  name: z.string().trim().min(1).max(200),
  projektTitel: z.string().max(500),
  wertsteigerungBullets: z.array(z.string().max(500)).max(50),
  wertsteigerungSichtbar: z.boolean(),
  internNotiz: z.string().max(10000),
  kaufpreisWohnung: Zahl,
  kaufpreisStellplatz: Zahl,
  stellplaetzeAnzahl: z.number().int().min(0),
  stellplaetzeIds: z.array(z.string()),
  bildRefs: z.array(z.string()),
  objSnapshot: ObjSnapshot,
  inputs: KundenkalkInputs,
});

export const Kundenkalkulation = KundenkalkFelder.extend({
  id: z.string(),
  dealId: z.string(),
  version: z.number().int(),
  scope: z.enum(['global', 'aufteiler']),
  einheitId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Kundenkalkulation = z.infer<typeof Kundenkalkulation>;

export const KundenkalkulationSpeichern = KundenkalkFelder.extend({ version: z.number().int() });
export type KundenkalkulationSpeichern = z.infer<typeof KundenkalkulationSpeichern>;

export const KundenkalkulationAnlegen = z.object({
  scope: z.enum(['global', 'aufteiler']),
  einheitId: z.string().optional(),
  stellplatzIds: z.array(z.string()).max(50).optional(),
  name: z.string().trim().max(200).optional(),
});
export type KundenkalkulationAnlegen = z.infer<typeof KundenkalkulationAnlegen>;

export const KundenkalkulationEintrag = z.object({
  id: z.string(),
  dealId: z.string(),
  name: z.string(),
  scope: z.enum(['global', 'aufteiler']),
  einheitLage: z.string().nullable(),
  updatedAt: z.string(),
  kaufpreis: z.number(),
  cashflowJahr1: z.number(),
  vermoegenszuwachs: z.number(),
  irr: z.number().nullable(),
  deal: z.object({ titel: z.string(), status: DealStatus }),
});
export type KundenkalkulationEintrag = z.infer<typeof KundenkalkulationEintrag>;

export const KundenkalkStandardSchema = z.object({
  notarPct: Zahl, grundbuchPct: Zahl, grundsteuerPct: Zahl, maklerPct: Zahl, sonstigePct: Zahl,
  wertsteigerungJaehrlich: Zahl, mieterhoehungJaehrlich: Zahl, kostensteigerungJaehrlich: Zahl, anteilGebaeudeKaufpreis: Zahl,
  afaSatz: Zahl, grenzsteuersatz: Zahl, betrachtungsdauerJahre: z.number().int().min(1).max(50),
  default_zinssatz: Zahl, default_tilgung: Zahl, default_fk_anteil_kp: Zahl,
});
export const KundenkalkEinstellungen = z.object({
  standard: KundenkalkStandardSchema,
  hinweise: z.array(z.string()),
  disclaimer: z.string(),
  /** Ersteller im Bankgespräch-PDF (alt: „Mein Name“, nur im Browser gespeichert); leer = „GG Immohandel“. */
  ersteller: z.string().max(200).default(''),
});
export type KundenkalkEinstellungen = z.infer<typeof KundenkalkEinstellungen>;

// ── Exposé-Import ──────────────────────────────────────────

/**
 * Felder der Exposé-Auswertung. `null` ist erlaubt und heißt „im Exposé nicht gefunden" —
 * genau das liefert die KI für jedes Feld, das sie nicht belegen kann. Die Dienste rechnen damit
 * (`text()`/`zahl()` in services/expose.ts machen daraus null); ein Vertrag, der hier nur `undefined`
 * zuließe, würde jedes zweite echte Exposé mit „Eingabe ungültig" abweisen.
 */
const Nr = z.number().finite().nullable().optional();
const T = z.string().max(5000).nullable().optional();

export const ExposeEinheitDaten = z.object({
  typ: T, lage: T, zimmer: Nr, flaeche: Nr, kaltmiete: Nr, vermiet: T,
});

export const ExposeObjektDaten = z.object({
  strasse: T, hausnr: T, plz: T, stadt: T, bundesland: T, baujahr: Nr, wohnflaeche: Nr, grundstueck: Nr, einheitenAnz: Nr,
  angebotspreis: Nr, istmiete: Nr, bruttorendite: Nr, heizungsart: T, heizungsbaujahr: Nr,
  energieausweis: z.object({ klasse: T, kennwert: Nr, art: T }).optional(),
  lagebeschreibung: T, ausstattung: T, notizen: T,
  einheiten: z.array(ExposeEinheitDaten).max(500).optional(),
});
export type ExposeObjektDaten = z.infer<typeof ExposeObjektDaten>;

export const ExposeMaklerDaten = z.object({
  name: T, firma: T, tel: T, email: T, webseite: T, prio: z.enum(['A', 'B', 'C']).nullable().optional(),
  kontaktFreq: z.string().max(40).nullable().optional(), notizen: T,
  // Aus der Extraktion durchgereicht; die alte App legte sie ungefragt am Makler ab, der Neubau in eigenen Feldern
  mobiltel: T, festnetztel: T,
  alleNamen: z.array(z.string().max(300)).max(50).optional(),
  alleTelefonnummern: z.array(z.string().max(100)).max(50).optional(),
  alleEmails: z.array(z.string().max(300)).max(50).optional(),
});
export type ExposeMaklerDaten = z.infer<typeof ExposeMaklerDaten>;

export const WizardKalkSchema = z.object({
  kaufpreis: Nr, notar: Nr, gest: Nr, makler: Nr, fk_p: Nr, ek_p: Nr, euribor: Nr, margeB: Nr, ek_r: Nr, halt: Nr, rp_pct: Nr, glo_m: Nr,
});

export const Dublette = z.object({ id: z.string(), titel: z.string(), sicherheit: z.enum(['exact', 'fuzzy']) }).nullable();

export const ExposeAnalyseAntwort = z.object({
  modus: z.enum(['text', 'pdf']), modell: z.string(), seiten: z.number(), zeichenProSeite: z.number(), hinweis: z.string().optional(),
  attrappe: z.boolean(),
  extrahiert: z.record(z.string(), z.unknown()),
  konfidenz: z.record(z.string(), z.string()),
  objekt: ExposeObjektDaten.passthrough(),
  makler: ExposeMaklerDaten.passthrough(),
  deal: z.object({ status: z.string(), nachfassFreq: z.string(), notizen: z.string(), kalk: WizardKalkSchema }),
  dubletten: z.object({ objekt: Dublette, makler: Dublette }),
});
export type ExposeAnalyseAntwort = z.infer<typeof ExposeAnalyseAntwort>;

export const ExposeUebernehmen = z.object({
  key: z.string(),
  dateiname: z.string().max(300),
  extrahiert: z.record(z.string(), z.unknown()),
  objekt: z.object({ bestehendeId: z.string().optional(), daten: ExposeObjektDaten }),
  makler: z.object({ bestehendeId: z.string().optional(), daten: ExposeMaklerDaten }),
  deal: z.object({ status: DealStatus, nachfassFreq: z.string().max(40), notizen: z.string().max(10000), kalk: WizardKalkSchema }),
});
export type ExposeUebernehmen = z.infer<typeof ExposeUebernehmen>;

export const ExposeUebernahmeErgebnis = z.object({
  dealId: z.string(), objektId: z.string(), maklerId: z.string().nullable(), pdfGespeichert: z.boolean(), warnung: z.string().optional(),
});

// ── Bank-Präsentation ──────────────────────────────────────

/** Folie: Typ bleibt Text, damit unbekannte Alt-Typen durchkommen (Vorlage zeigt Platzhalter). Daten frei je Typ. */
export const PraesentationFolie = z.object({
  id: z.string().min(1).max(100),
  typ: z.string().max(50),
  visible: z.boolean(),
  data: z.record(z.string(), z.unknown()),
});
export type PraesentationFolie = z.infer<typeof PraesentationFolie>;

export const Praesentation = z.object({
  id: z.string(),
  dealId: z.string(),
  bankName: z.string(),
  internNotiz: z.string(),
  slides: z.array(PraesentationFolie),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Praesentation = z.infer<typeof Praesentation>;

export const PraesentationSpeichern = z.object({
  bankName: z.string().max(300),
  internNotiz: z.string().max(10000),
  slides: z.array(PraesentationFolie).max(200),
  version: z.number().int(),
});
export type PraesentationSpeichern = z.infer<typeof PraesentationSpeichern>;

export const PraesentationAnlegen = z.object({ vorlage: z.enum(['leer', 'standard']) });

export const VorbelegungArt = z.enum(['deckblatt', 'objektbeschreibung', 'projektkalkulation', 'verkaufspreise', 'mietenaufstellung', 'finanzierung']);
export const PraesentationVorbelegen = z.object({
  art: VorbelegungArt,
  data: z.record(z.string(), z.unknown()),
  scope: z.enum(['aufteiler', 'global']).optional(),
  spalten: z.array(z.string()).max(20).optional(),
});
export type PraesentationVorbelegen = z.infer<typeof PraesentationVorbelegen>;
export const VorbelegungErgebnis = z.object({ data: z.record(z.string(), z.unknown()).nullable(), hinweis: z.string().nullable() });

export const FinanzpraesStandard = z.object({
  geschaeftsmodell: z.object({ zielgruppe: z.string(), angebot: z.string(), kundengewinnung: z.string(), vorteile: z.string(), vorteileIvt: z.string() }),
  organigramm: z.object({ bild: z.string(), beschreibung: z.string() }),
  abschluss: z.object({ untertitel: z.string(), bild: z.string() }),
});
export type FinanzpraesStandard = z.infer<typeof FinanzpraesStandard>;

// ── Begleitscheine ─────────────────────────────────────────

export const BsStatus = z.enum(['offen', 'In Progress', 'erledigt']);
export const BsTyp = z.enum(['ankauf', 'verkauf']);
export const BsZeile = z.object({
  id: z.string().min(1).max(100),
  lvl: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string().max(5000),
  verantwortung: z.string().max(200),
  status: BsStatus,
  sub: z.array(z.object({ id: z.string().min(1).max(100), text: z.string().max(2000), status: BsStatus })).max(100),
  fix: z.boolean().optional(),
});
export type BsZeile = z.infer<typeof BsZeile>;

export const BsAktionTyp = z.enum(['vordruck-brief', 'vordruck-datei', 'mail', 'link', 'modul', 'analyse', 'daten']);
export const BsAktion = z.object({
  id: z.string().min(1).max(100),
  label: z.string().max(200),
  typ: BsAktionTyp,
  aktiv: z.boolean(),
  rowId: z.string().max(100),
  subId: z.string().max(100).optional(),
  vordruckId: z.string().max(100).optional(),
  url: z.string().max(2000).optional(),
  modul: z.string().max(50).optional(),
  empfaenger: z.string().max(500).optional(),
  betreff: z.string().max(500).optional(),
  analyseTyp: z.string().max(50).optional(),
  datenQuelle: z.string().max(50).optional(),
});
export type BsAktion = z.infer<typeof BsAktion>;

export const BsVordruck = z.object({
  id: z.string().min(1).max(100),
  nummer: z.string().max(50),
  titel: z.string().max(300),
  art: z.enum(['brief', 'mail', 'datei']),
  inhalt: z.string().max(50000).optional(),
  betreff: z.string().max(500).optional(),
  dateiName: z.string().max(300).optional(),
  aktiv: z.boolean(),
});
export type BsVordruck = z.infer<typeof BsVordruck>;

export const BsZaehler = z.object({ summe: z.number(), offen: z.number(), inProgress: z.number(), erledigt: z.number() });
export const BegleitscheinEintrag = z.object({
  id: z.string(), typ: BsTyp, objektId: z.string(), objektAdresse: z.string(), name: z.string(), whgNr: z.string().nullable(),
  createdAt: z.string(), archiviertAm: z.string().nullable(), zaehler: BsZaehler,
});
export type BegleitscheinEintrag = z.infer<typeof BegleitscheinEintrag>;

export const Begleitschein = z.object({
  id: z.string(), typ: BsTyp, objektId: z.string(), dealId: z.string().nullable(), adresse: z.string(), whgNr: z.string().nullable(), name: z.string(),
  kopf: z.string(), rows: z.array(BsZeile), archiviertAm: z.string().nullable(), version: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
  /** Aktionen der Vorlage dieses Typs (Y12) */
  aktionen: z.array(BsAktion),
});
export type Begleitschein = z.infer<typeof Begleitschein>;

export const BegleitscheinAnlegen = z.object({ typ: BsTyp, objektId: z.string().min(1), whgNr: z.string().max(50).optional(), name: z.string().trim().min(1, 'Der individuelle Name ist ein Pflichtfeld').max(200) });
export const BegleitscheinSpeichern = z.object({ kopf: z.string().max(5000), rows: z.array(BsZeile).max(1000), version: z.number().int() });
export type BegleitscheinSpeichern = z.infer<typeof BegleitscheinSpeichern>;

export const BsVorlage = z.object({ typ: BsTyp, kopf: z.string().max(5000), rows: z.array(BsZeile).max(1000), updatedAt: z.string().nullable() });
export type BsVorlage = z.infer<typeof BsVorlage>;
export const BsVorlageSpeichern = z.object({ kopf: z.string().max(5000), rows: z.array(BsZeile).max(1000) });

export const BsAktionErgebnis = z.discriminatedUnion('art', [
  z.object({ art: z.literal('link'), url: z.string() }),
  z.object({ art: z.literal('modul'), modul: z.string(), dealId: z.string().optional() }),
  z.object({ art: z.literal('mail'), href: z.string() }),
  z.object({ art: z.literal('anzeige'), titel: z.string(), hinweis: z.string().optional(), tabelle: z.array(z.tuple([z.string(), z.string()])).optional(), text: z.string().optional(), datei: z.string().optional() }),
  z.object({ art: z.literal('fehler'), meldung: z.string() }),
]);
export type BsAktionErgebnis = z.infer<typeof BsAktionErgebnis>;

// ── Vertriebslisten ────────────────────────────────────────

export const VlSpalte = z.object({
  id: z.string().min(1).max(100),
  label: z.string().max(300),
  type: z.enum(['text', 'multitext', 'number', 'euro', 'percent', 'date', 'dropdown', 'ampel', 'checkbox']),
  computed: z.boolean().optional(),
  dropdownOptions: z.array(z.string().max(200)).max(100).optional(),
});
export type VlSpalte = z.infer<typeof VlSpalte>;
export const VlZeile = z.object({ id: z.string().min(1).max(100), einheitId: z.string().nullable(), istStellplatz: z.boolean(), daten: z.record(z.string(), z.unknown()) });
export type VlZeile = z.infer<typeof VlZeile>;

export const VertriebslistenEintrag = z.object({
  dealId: z.string(), adresse: z.string(), stadt: z.string(), einheiten: z.number(),
  liste: z.object({ id: z.string(), zeilen: z.number(), zuletzt: z.string() }).nullable(),
});
export const Vertriebsliste = z.object({
  id: z.string(), dealId: z.string(), titel: z.string(), spalten: z.array(VlSpalte), versteckteSpalten: z.array(z.string()), zeilen: z.array(VlZeile),
  version: z.number().int(), updatedAt: z.string(),
  /** GIK der Aufteiler-Kalkulation des Deals (für den Einkaufspreis), 0 = keine Kalkulation */
  dealGik: z.number(),
  provision: z.number(),
});
export type Vertriebsliste = z.infer<typeof Vertriebsliste>;
export const VertriebslisteSpeichern = z.object({ versteckteSpalten: z.array(z.string()).max(500), zeilen: z.array(VlZeile).max(2000), version: z.number().int() });
export type VertriebslisteSpeichern = z.infer<typeof VertriebslisteSpeichern>;
export const VertriebslistenEinstellungen = z.object({ spalten: z.array(VlSpalte).max(500), provision: z.number().min(0).max(100) });
export type VertriebslistenEinstellungen = z.infer<typeof VertriebslistenEinstellungen>;

// ── Projektmanagement ──────────────────────────────────────
// Feldnamen wie im Altformat (pm.ts), damit die Regeln aus @gg/domain (projekte) unverändert lesen.

const PmText = z.string().max(20000);
const PmKurz = z.string().max(1000);
const PmTag = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const PmBetrag = z.number().finite().gt(-1e12).lt(1e12);
const PmVstatus = z.enum(['none', 'active', 'reserved', 'notar', 'sold', 'noglobal']);

export const PmTodo = z.object({
  id: z.string().min(1).max(100), cat: PmKurz, text: PmText, status: z.enum(['offen', 'in progress', 'erledigt']),
  kommentar: PmText, verantwortlich: PmKurz, faellig: PmTag,
});
export const PmGespraech = z.object({ id: z.string().min(1).max(100), datum: PmTag, inhalt: PmText, ergebnis: PmText });
export const PmGebaeudeMassnahme = z.object({ id: z.string().min(1).max(100), text: PmText, status: PmKurz, verantw: PmKurz });
export const PmEinheit = z.object({
  id: z.string().min(1).max(100), dealEinheitId: z.string().nullable(), typ: PmKurz, lage: PmKurz,
  zimmer: z.number().min(0).max(999).nullable(), fl: PmBetrag.nullable(), stk: z.number().int().min(0).max(100000).nullable(), teNr: PmKurz,
  kaltmiete: PmBetrag.nullable(), kmMoeglich: PmBetrag.nullable(), grundpreis: PmBetrag.nullable(), provision: PmBetrag.nullable(),
  sanIVT: PmBetrag.nullable(), ergebnisIVT: PmBetrag.nullable(), zielKP: PmBetrag.nullable(), istKP: PmBetrag.nullable(),
  vstatus: PmVstatus, vertriebsstand: PmKurz, vermietet: PmKurz, mieterName: PmKurz, pip: z.enum(['', 'grn', 'yel', 'red']),
  pipStrategie: PmText, pipTodosText: PmText, mieterTodosText: PmText, mieterHistorie: z.array(PmGespraech).max(1000),
  reservDatum: PmTag, notarDatum: PmTag, kaeufer: PmKurz, vtKommentar: PmText,
});
const ProjektInhalt = z.object({
  adresse: PmKurz, stadt: PmKurz, datum: PmTag, zielVKP: PmBetrag,
  globalVstatus: PmVstatus.exclude(['noglobal']), globalIstKP: PmBetrag, globalKommentar: PmText, globalKaeufer: PmKurz, globalNotarDatum: PmTag, globalReservDatum: PmTag,
  einheiten: z.array(PmEinheit).max(2000), todos: z.array(PmTodo).max(5000), gebPIP: z.array(PmGebaeudeMassnahme).max(1000),
});
export const Projekt = ProjektInhalt.extend({ id: z.string(), dealId: z.string().nullable(), version: z.number().int(), updatedAt: z.string() });
export type Projekt = z.infer<typeof Projekt>;
export const ProjektSpeichern = ProjektInhalt.extend({ version: z.number().int() });
export type ProjektSpeichern = z.infer<typeof ProjektSpeichern>;
export const ProjektAnlegen = z.object({ dealId: z.string().min(1).nullable(), adresse: PmKurz, stadt: PmKurz, datum: PmTag });
export type ProjektAnlegen = z.infer<typeof ProjektAnlegen>;
/** Auswahl beim Anlegen: angekaufte Deals ohne aktives Projekt; adresse = Straße wie deal.adresse der alten App. */
export const ProjektDealAuswahl = z.object({ id: z.string(), adresse: z.string(), stadt: z.string(), angebotsDatum: z.string() });
export type ProjektDealAuswahl = z.infer<typeof ProjektDealAuswahl>;

// ── Listen und gespeicherte Filter ─────────────────────────
// Filter wie in der alten App (lib/savedFilters.ts): Kriterien auf Feldpfade des Altformats, UND-verknüpft.

export const FilterModul = z.enum(['deals', 'ankauf', 'makler', 'objects']);
export const FilterKriterium = z.object({
  field: z.string().min(1).max(200),
  op: z.string().max(40),
  value: z.union([z.string().max(2000), z.number(), z.array(z.union([z.string().max(500), z.number()])).max(200)]).optional(),
});
export const GespeicherterFilter = z.object({
  id: z.string(), module: FilterModul, name: z.string(), criteria: z.array(FilterKriterium), createdAt: z.number(), updatedAt: z.number(),
});
export type GespeicherterFilter = z.infer<typeof GespeicherterFilter>;
export const GespeicherterFilterAnlegen = z.object({ module: FilterModul, name: z.string().trim().min(1).max(200), criteria: z.array(FilterKriterium).min(1).max(50) });
export type GespeicherterFilterAnlegen = z.infer<typeof GespeicherterFilterAnlegen>;
export const GespeicherterFilterUmbenennen = z.object({ name: z.string().trim().min(1).max(200) });

/** Makler, Objekte, Deals im Format der alten Sammlungen (für Listenregeln und Filter). */
export const ListenAltformat = z.object({
  makler: z.array(z.record(z.string(), z.unknown())),
  objekte: z.array(z.record(z.string(), z.unknown())),
  deals: z.array(z.record(z.string(), z.unknown())),
  /** Deal-Id → Id des Exposé-Dokuments (📄 in der Deal-Liste) */
  exposeIds: z.record(z.string(), z.string()),
});
export type ListenAltformat = z.infer<typeof ListenAltformat>;

// ── Deal-Dokumente ─────────────────────────────────────────
/** Woran ein Dokument hängt (Protokoll 19): Deal oder Objekt — Makler und Projekt folgen. */
export const DokumentBezug = z.object({ art: z.enum(['deal', 'objekt']), id: z.string().min(1) });
export type DokumentBezug = z.infer<typeof DokumentBezug>;
export const Dokument = z.object({
  id: z.string(), dateiname: z.string(), mimeType: z.string(), groesseBytes: z.number(), label: z.string(), hochgeladenAm: z.string(),
  istExpose: z.boolean(),
  /** wo die Datei liegt; `pfad` ist bei SharePoint der Pfad in der Bibliothek, sonst Bucket/Schlüssel */
  ablage: z.enum(['supabase', 'sharepoint']), pfad: z.string(),
  /** „In SharePoint öffnen“ — nur bei SharePoint */
  webUrl: z.string().nullable(),
  /** vom Abgleich gesetzt, wenn die Datei in SharePoint nicht mehr gefunden wird */
  fehltSeit: z.string().nullable(),
  bezug: DokumentBezug,
});
export type Dokument = z.infer<typeof Dokument>;
/** @deprecated Name aus der Zeit, als Dokumente nur am Deal hingen */
export const DealDokument = Dokument;
export type DealDokument = Dokument;

// ── Textvorlagen ───────────────────────────────────────────
export const Textvorlage = z.object({ id: z.string().max(100), name: z.string().max(300), kanal: z.enum(['email', 'whatsapp', 'beide']), betreff: z.string().max(1000).optional(), text: z.string().max(20000) });
export const VorlagenEinstellungen = z.object({ vorlagen: z.array(Textvorlage).max(200), meinName: z.string().max(200) });
export type VorlagenEinstellungen = z.infer<typeof VorlagenEinstellungen>;

// ── Makler: Persönliches, KI, Kommunikationsstil ───────────
export const MaklerPersoenlich = z.object({ geburtsdatum: z.string().max(20), anredeForm: z.enum(['', 'du', 'sie']) });
export const PersonaProfil = z.object({
  analysisTs: z.string(), commAnalyzed: z.number(), confidence: z.number(), anrede: z.string(), abschluss: z.object({ wa: z.string(), email: z.string() }),
  tonWA: z.string(), tonEmail: z.string(), themenMuster: z.string(), vokabular: z.string(), laenge: z.object({ wa: z.string(), email: z.string() }), rawAnalysis: z.string(),
});
export const PersonaStand = z.object({ profil: PersonaProfil.nullable(), konfidenz: z.number(), ausgehend: z.number() });
export type PersonaStand = z.infer<typeof PersonaStand>;
export const NachrichtEntwurf = z.object({ wa: z.string(), email: z.object({ subject: z.string(), body: z.string() }) });
export type NachrichtEntwurf = z.infer<typeof NachrichtEntwurf>;

// AgentMode: Ziele der Oberfläche (Marken data-agent), geteilt zwischen Web und API
export * from './oberflaechenkarte.ts';
