import { schema } from '@gg/db';
import { STANDARD_ABSCHLUSS_BILD, STANDARD_ORGANIGRAMM_BILD } from '@gg/documents';
import { dokumentSchluessel, fotoSchluessel } from '@gg/integrations';
import { bsSeedAktionen, bsSeedVorlage, DealStatus, normalisiereFrequenz, weitereKontakte, SLIDE_TYP_WERTE, STANDARDBILD_ABSCHLUSS, STANDARDBILD_ORGANIGRAMM, START_STATUS } from '@gg/domain';
import {
  datum,
  ganzzahl,
  geloeschtAm,
  istObjekt,
  kanonisch,
  liste,
  type Notiz,
  parseNumAlt,
  text,
  zahl,
  zahlWiePlus,
  zeitpunkt,
} from './werte.ts';

type Zeile<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface Zeilen {
  makler: Zeile<typeof schema.makler>[];
  maklerKommunikation: Zeile<typeof schema.maklerKommunikation>[];
  objekte: Zeile<typeof schema.objekte>[];
  objektEinheiten: Zeile<typeof schema.objektEinheiten>[];
  deals: Zeile<typeof schema.deals>[];
  dealEinheiten: Zeile<typeof schema.dealEinheiten>[];
  dealSanierungen: Zeile<typeof schema.dealSanierungen>[];
  dealKommentare: Zeile<typeof schema.dealKommentare>[];
  dealKalkVarianten: Zeile<typeof schema.dealKalkVarianten>[];
  dealStatusHistorie: Zeile<typeof schema.dealStatusHistorie>[];
  kundenkalkulationen: Zeile<typeof schema.kundenkalkulationen>[];
  objektFotos: Zeile<typeof schema.objektFotos>[];
  dokumente: Zeile<typeof schema.dokumente>[];
  finanzpraesentationen: Zeile<typeof schema.finanzpraesentationen>[];
  praesentationFolien: Zeile<typeof schema.praesentationFolien>[];
  begleitscheinVorlagen: Zeile<typeof schema.begleitscheinVorlagen>[];
  vordrucke: Zeile<typeof schema.vordrucke>[];
  begleitscheinAktionen: Zeile<typeof schema.begleitscheinAktionen>[];
  begleitscheine: Zeile<typeof schema.begleitscheine>[];
  vertriebslisten: Zeile<typeof schema.vertriebslisten>[];
  vertriebslisteZeilen: Zeile<typeof schema.vertriebslisteZeilen>[];
  projekte: Zeile<typeof schema.projekte>[];
  projektEinheiten: Zeile<typeof schema.projektEinheiten>[];
  projektMieterhistorie: Zeile<typeof schema.projektMieterhistorie>[];
  projektAufgaben: Zeile<typeof schema.projektAufgaben>[];
  projektGebaeudeMassnahmen: Zeile<typeof schema.projektGebaeudeMassnahmen>[];
  gespeicherteFilter: Zeile<typeof schema.gespeicherteFilter>[];
  textvorlagen: Zeile<typeof schema.textvorlagen>[];
  ddChecklisteVorlage: Zeile<typeof schema.ddChecklisteVorlage>[];
  einstellungen: Zeile<typeof schema.einstellungen>[];
}

export type Schwere = 'info' | 'warnung' | 'fehler';

export interface Befund {
  schwere: Schwere;
  art: string;
  entitaet: string;
  id: string;
  feld?: string;
  wert?: unknown;
  hinweis: string;
}

export interface Umformung {
  zeilen: Zeilen;
  befunde: Befund[];
  /** Felder, die weder übernommen noch bewusst verworfen wurden: Name → Anzahl je Entität. */
  unbekannteFelder: Record<string, Record<string, number>>;
  waisen: { objekte: number; makler: number };
}

/** Zeilen der Tabelle app.obj_photos (kein KV-Schlüssel; quelle.ts legt sie unter diesem Namen ab). */
export const FOTO_TABELLE = 'tabelle:obj_photos';
/** Zeilen der Tabelle app.deal_documents (Dateien im Bucket deal-docs). */
export const DOKUMENT_TABELLE = 'tabelle:deal_documents';
/** Exposé-Erkennung wie listExposeDocIds (server/database.ts): Bezeichnung „Expos…“ oder Dateiname mit „expos“. */
export const istExposeDokument = (label: string | null | undefined, dateiname: string | null | undefined) =>
  /^expos/i.test(label ?? '') || /expos/i.test(dateiname ?? '');

/** KV-Schlüssel der alten App, die dieser Umzug liest. */
export const QUELL_SCHLUESSEL = [
  FOTO_TABELLE, DOKUMENT_TABELLE, 'immo-makler', 'immo-objects', 'immo-deals', 'immo-kundenkalkulationen',
  'immo-kalk-defaults', 'immo-kkalk-defaults', 'immo-kkalk-hinweise', 'immo-kkalk-disclaimer',
  'immo-finanzpraes', 'immo-finanzpraes-defaults',
  'immo-begleitscheine', 'immo-bs-vorlage-ankauf', 'immo-bs-vorlage-verkauf', 'immo-bs-aktionen', 'immo-bs-vordrucke',
  'immo-vertriebslisten', 'immo-vertriebslisten-defaults',
  'immo-projekte', 'immo-saved-filters', 'immo-vorlagen', 'immo-dd-template', 'immo-offer-uids',
] as const;

export const BS_TYPEN = ['ankauf', 'verkauf'] as const;

/** Wie bsGetVorlage: gespeicherte Vorlage mit Zeilen, sonst der Auslieferungszustand (den die alte App beim ersten Öffnen anlegte). */
export function bsVorlageAlt(kv: KvDaten, typ: (typeof BS_TYPEN)[number]): { kopf: string; rows: unknown[]; updatedAt?: unknown; aus: 'gespeichert' | 'auslieferung' } {
  const raw = kv[`immo-bs-vorlage-${typ}`];
  if (istObjekt(raw) && Array.isArray(raw.rows) && raw.rows.length) return { kopf: String(raw.kopf ?? ''), rows: raw.rows, updatedAt: raw.updatedAt, aus: 'gespeichert' };
  const seed = bsSeedVorlage(typ);
  return { kopf: seed.kopf, rows: seed.rows, aus: 'auslieferung' };
}

/** Wie bsGetAktionen: gespeicherte Konfiguration je Typ, sonst Auslieferung (Ankauf) bzw. leer (Verkauf). */
export function bsAktionenAlt(kv: KvDaten, typ: (typeof BS_TYPEN)[number]): Record<string, unknown>[] {
  const cfg = liste(kv['immo-bs-aktionen']).find((c) => c.typ === typ);
  if (cfg) return liste(cfg.aktionen);
  return typ === 'ankauf' ? (bsSeedAktionen() as unknown as Record<string, unknown>[]) : [];
}

/** Präsentations-Standards: eigener Schlüssel, weil die mitgelieferten Bilder durch Platzhalter ersetzt werden. */
export const FINANZPRAES_STANDARD_SCHLUESSEL = 'finanzpraes-standard';

/** Gespeicherte Standards der alten App: Bild gleich dem mitgelieferten → Platzhalter (spart ~230 KB, gleiches Ergebnis). */
export function finanzpraesStandardUmformen(wert: unknown): unknown {
  if (!istObjekt(wert)) return wert;
  const tausche = (teil: unknown, bild: string, platzhalter: string) =>
    istObjekt(teil) && teil.bild === bild ? { ...teil, bild: platzhalter } : teil;
  return {
    ...wert,
    ...(wert.organigramm !== undefined ? { organigramm: tausche(wert.organigramm, STANDARD_ORGANIGRAMM_BILD, STANDARDBILD_ORGANIGRAMM) } : {}),
    ...(wert.abschluss !== undefined ? { abschluss: tausche(wert.abschluss, STANDARD_ABSCHLUSS_BILD, STANDARDBILD_ABSCHLUSS) } : {}),
  };
}

/** Einstellungen: KV-Schlüssel der alten App → einstellungen.schluessel */
export const EINSTELLUNGEN: Record<string, string> = {
  'immo-kalk-defaults': 'kalk-standard',
  'immo-kkalk-defaults': 'kundenkalk-standard',
  'immo-kkalk-hinweise': 'kundenkalk-hinweise',
  'immo-kkalk-disclaimer': 'kundenkalk-disclaimer',
  'immo-vertriebslisten-defaults': 'vertriebslisten-spalten',
  // Kennungen bereits übernommener Angebots-Mails (je Mail Graph-uid und internetMessageId). Der Neubau hat dafür
  // noch keinen Abnehmer — der Duplikatschutz kommt mit dem Auto-Import. Verloren gehen darf die Liste trotzdem nicht:
  // ohne sie liefe nach dem Umschalten jede alte Mail ein zweites Mal durch die KI.
  'immo-offer-uids': 'angebote-importierte-uids',
};
export type KvDaten = Partial<Record<string, unknown>>;

// Bekannte Felder je Entität. Übernommen, als Kopie verworfen, im Speicher berechnet oder bewusst ausgelassen.
const MAKLER_FELDER = new Set([
  'id', 'name', 'firma', 'tel', 'email', 'webseite', 'website', 'prio', 'kontaktFreq', 'lastContact', 'nextContact',
  'relationshipNote', 'tags', 'personal', 'aiSummary', 'aiSummaryTs', 'erstellt', 'komm', 'notizen',
  // Reste des Exposé-Imports, die die alte App am Makler ablegte, ohne sie je anzuzeigen (echter Bestand 21.09.2026)
  'mobiltel', 'festnetztel', 'telefon', 'alleNamen', 'alleTelefonnummern', 'alleEmails', 'strasse', 'plz', 'stadt',
  '_deleted', '_deletedAt',
]);
const MAKLER_AUSGELASSEN: Record<string, string> = {
  importedEmailUids: 'Duplikatschutz des Mail-Imports; wird mit dem Auto-Import (N5) neu gelöst',
  _rekonstruiert: 'Marker „aus Deal-Daten wiederhergestellt" (vertrieb.ts); ohne fachliche Wirkung',
};
const DEAL_FELDER = new Set([
  'id', 'objId', 'maklerId', 'status', 'prio', 'angebotsDatum', 'nachfassFreq', 'lastContact', 'nextContact',
  'kalk', '_exposeRaw', 'notizen', 'kommentare', 'einheiten', 'sanierung', 'kalkVarianten', 'updatedAt', '_deleted', '_deletedAt',
]);
const DEAL_AUSGELASSEN: Record<string, string> = {
  _reconstructed: 'Marker einer früheren Wiederherstellung aus der Sicherung; ohne fachliche Wirkung',
  _reconstructedAt: 'Zeitpunkt dieser Wiederherstellung; ohne fachliche Wirkung',
};
/** Kopierte Stammdaten im Deal (07, Befund 3): werden verworfen, Abweichungen stehen im Bericht. */
const DEAL_KOPIEN = {
  adresse: 'strasse', hausnr: 'hausnr', plz: 'plz', stadt: 'stadt', wohnflaeche: 'wohnflaeche', einheitenAnz: 'einheitenAnz',
} as const;
const DEAL_MAKLER_KOPIEN = { maklerName: 'name', maklerFirma: 'firma', maklerTel: 'tel', maklerEmail: 'email' } as const;
const OBJEKT_SPALTEN = new Set([
  'id', 'strasse', 'hausnr', 'plz', 'stadt', 'bundesland', 'baujahr', 'einheitenAnz', 'wohnflaeche', 'grundstueck',
  'energie', 'heizung', 'angebotspreis', 'zielpreis', 'istmiete', 'sollmiete', 'status', 'notizen', 'datum', 'einheiten',
  '_deleted', '_deletedAt',
]);
const EINHEIT_OBJEKT = new Set(['id', 'typ', 'lage', 'zimmer', 'stueck', 'flaeche', 'kaltmiete', 'vermiet']);
const EINHEIT_DEAL = new Set(['id', 'typ', 'lage', 'zimmer', 'fl', 'mi_ist', 'mi_neu', 'mi_neu_manual', 'rend_k', 'vkp', 'stk', 'fl_ist', 'fl_soll', 'mi_soll']);
const SANIERUNG = new Set(['id', 'desc', 'amt', 'scope']);
const KOMMENTAR = new Set(['ts', 'text']);
const VARIANTE = new Set(['id', 'name', 'ts', 'kalk', 'einheiten', 'sanierung']);
const BEREICHE = ['both', 'auf', 'glo'];
const PRAESENTATION = new Set(['id', 'dealId', 'bankName', 'slides', 'internNotiz', 'createdAt', 'updatedAt', '_deleted', '_deletedAt']);
const FOLIE = new Set(['id', 'typ', 'visible', 'data']);
const VERTRIEBSLISTE = new Set(['id', 'dealId', 'createdAt', 'updatedAt', 'columns', 'hiddenColumns', 'rows', '_deleted', '_deletedAt', 'name']);
const VL_ZEILE = new Set(['id', 'einheitId', 'isStellplatz', 'data']);
const PROJEKT = new Set(['id', 'dealId', 'adresse', 'stadt', 'datum', 'einheiten', 'todos', 'gebPIP', 'zielVKP', 'globalVstatus', 'globalIstKP', 'globalKommentar',
  'globalKaeufer', 'globalNotarDatum', 'globalReservDatum', '_deleted', '_deletedAt']);
const PM_EINHEIT = new Set(['id', 'typ', 'lage', 'zimmer', 'fl', 'stk', 'teNr', 'kaltmiete', 'kmMoeglich', 'grundpreis', 'provision', 'sanIVT', 'ergebnisIVT', 'zielKP', 'istKP',
  'vstatus', 'vertriebsstand', 'vermietet', 'mieterName', 'pip', 'pipStrategie', 'pipTodos', 'pipTodosText', 'mieterTodosText', 'mieterHistorie', 'reservDatum', 'notarDatum',
  'kaeufer', 'vtKommentar']);
const PM_TODO = new Set(['id', 'cat', 'text', 'status', 'kommentar', 'verantwortlich', 'faellig', 'done']);
const PM_GESPRAECH = new Set(['id', 'datum', 'inhalt', 'ergebnis']);
const PM_MASSNAHME = new Set(['text', 'status', 'verantw']);
const PM_TODO_STATUS = ['offen', 'in progress', 'erledigt'];
const DD_ZEILE = new Set(['id', 'dokument', 'quelle']);
const FILTER = new Set(['id', 'name', 'module', 'criteria', 'createdAt', 'updatedAt']);
export const FILTER_MODULE = ['deals', 'ankauf', 'makler', 'objects'];
const VORLAGE = new Set(['id', 'name', 'kanal', 'betreff', 'text']);
/** Merker: Vorlagen wurden gespeichert (auch leer) — sonst gelten die Standardvorlagen wie alt (getVorlagen). */
export const VORLAGEN_GESPEICHERT = 'textvorlagen-gespeichert';
const BEGLEITSCHEIN = new Set(['id', 'typ', 'objektId', 'dealId', 'adresse', 'whgNr', 'name', 'kopf', 'rows', 'archiviert', 'archiviertAm', 'createdAt', 'updatedAt', '_deleted', '_deletedAt']);
const BS_AKTION = new Set(['id', 'label', 'typ', 'aktiv', 'rowId', 'subId', 'vordruckId', 'url', 'modul', 'empfaenger', 'betreff', 'analyseTyp', 'datenQuelle']);
const VORDRUCK = new Set(['id', 'nummer', 'titel', 'art', 'inhalt', 'betreff', 'dateiName', 'aktiv']);
const KUNDENKALK = new Set([
  'id', 'dealId', 'name', 'scope', 'einheitId', 'createdAt', 'updatedAt', 'objSnapshot', 'inputs', 'projektTitel',
  'wertsteigerungBullets', 'wertsteigerungSichtbar', 'internNotiz', 'kaufpreisWohnung', 'kaufpreisStellplatz',
  'stellplaetzeAnzahl', 'stellplaetzeIds', 'impressionen', '_deleted', '_deletedAt',
  // veraltet in der alten App (Disclaimer zentral, stellplatzKaufpreis durch kaufpreisStellplatz ersetzt, Anhänge nie gebaut)
  'disclaimerOverride', 'stellplatzKaufpreis', 'anhaengeNamen',
]);

/**
 * Im Browser berechnete Hilfsfelder (vertrieb.ts) sind keine Daten. Bewusst eine feste Liste:
 * andere `_`-Felder wie `_psUnitId` (Propstack) sind echte Daten und dürfen nicht verloren gehen.
 */
const BERECHNET = new Set(['_prio', '_freq', '_nextDue', '_due', '_lastC']);
const istBerechnet = (feld: string) => BERECHNET.has(feld);

function rest(item: Record<string, unknown>, bekannt: Set<string>): Record<string, unknown> | null {
  const r = Object.fromEntries(Object.entries(item).filter(([k]) => !bekannt.has(k) && !istBerechnet(k)));
  return Object.keys(r).length ? r : null;
}

const ISO_TAG = (tag: string) => `${tag}T00:00:00.000Z`;

export function umformen(kv: KvDaten, stichtag = new Date().toISOString()): Umformung {
  const befunde: Befund[] = [];
  const unbekannteFelder: Record<string, Record<string, number>> = {};
  const z: Zeilen = {
    makler: [], maklerKommunikation: [], objekte: [], objektEinheiten: [], deals: [],
    dealEinheiten: [], dealSanierungen: [], dealKommentare: [], dealKalkVarianten: [], dealStatusHistorie: [],
    kundenkalkulationen: [], objektFotos: [], dokumente: [], finanzpraesentationen: [], praesentationFolien: [],
    begleitscheinVorlagen: [], vordrucke: [], begleitscheinAktionen: [], begleitscheine: [], vertriebslisten: [], vertriebslisteZeilen: [],
    projekte: [], projektEinheiten: [], projektMieterhistorie: [], projektAufgaben: [], projektGebaeudeMassnahmen: [], gespeicherteFilter: [], textvorlagen: [], ddChecklisteVorlage: [], einstellungen: [],
  };
  const waisen = { objekte: 0, makler: 0 };

  const befund = (b: Befund) => befunde.push(b);
  const notizFuer = (entitaet: string, id: string): Notiz => (feld, wert, hinweis) =>
    befund({ schwere: 'warnung', art: 'wert-unlesbar', entitaet, id, feld, wert, hinweis });
  const unbekannt = (entitaet: string, item: Record<string, unknown>, bekannt: Set<string>, ausgelassen = {}) => {
    for (const k of Object.keys(item)) {
      if (bekannt.has(k) || istBerechnet(k) || k in ausgelassen) continue;
      (unbekannteFelder[entitaet] ??= {})[k] = (unbekannteFelder[entitaet]![k] ?? 0) + 1;
    }
  };
  const eindeutig = (() => {
    const gesehen = new Set<string>();
    return (entitaet: string, id: string) => {
      let neu = id;
      for (let n = 2; gesehen.has(`${entitaet}|${neu}`); n++) neu = `${id}~${n}`;
      if (neu !== id) befund({ schwere: 'warnung', art: 'id-doppelt', entitaet, id, hinweis: `umbenannt in ${neu}` });
      gesehen.add(`${entitaet}|${neu}`);
      return neu;
    };
  })();
  const frequenz = (wert: unknown, entitaet: string, id: string, feld: string) => {
    const t = text(wert);
    if (!t) return null;
    const neu = normalisiereFrequenz(t);
    if (neu !== t && t !== 'Nicht kontaktieren') {
      befund({ schwere: 'warnung', art: 'frequenz-unbekannt', entitaet, id, feld, wert, hinweis: `→ ${neu} (Ist-Verhalten: 7 Tage)` });
    }
    return neu;
  };

  // ── Makler ───────────────────────────────────────────────
  const maklerIds = new Set<string>();
  for (const m of liste(kv['immo-makler'])) {
    const alteId = text(m.id);
    if (!alteId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'makler', id: '?', wert: m.name, hinweis: 'nicht übernommen' });
      continue;
    }
    const id = eindeutig('makler', alteId);
    const notiz = notizFuer('makler', id);
    unbekannt('makler', m, MAKLER_FELDER, MAKLER_AUSGELASSEN);
    const prio = text(m.prio);
    if (prio && !['A', 'B', 'C'].includes(prio)) notiz('prio', prio, 'keine gültige Prio (A/B/C)');
    const erstellt = datum(m.erstellt, 'erstellt', notiz);
    // `tel` war alt die Hauptnummer (mobiltel || festnetztel || tel); ein einzelner Satz führt sie nur als `telefon`.
    const haupt = { name: text(m.name), tel: text(m.tel) ?? text(m.telefon), mobil: text(m.mobiltel), festnetz: text(m.festnetztel), email: text(m.email) };
    z.makler.push({
      id,
      name: haupt.name,
      firma: text(m.firma),
      tel: haupt.tel,
      mobil: haupt.mobil,
      festnetz: haupt.festnetz,
      email: haupt.email,
      webseite: text(m.webseite ?? m.website),
      strasse: text(m.strasse),
      plz: text(m.plz),
      ort: text(m.stadt),
      weitereKontakte: weitereKontakte(haupt, { namen: m.alleNamen, telefonnummern: m.alleTelefonnummern, emails: m.alleEmails }),
      prio: prio && ['A', 'B', 'C'].includes(prio) ? prio : null,
      kontaktFrequenz: frequenz(m.kontaktFreq, 'makler', id, 'kontaktFreq'),
      lastContact: datum(m.lastContact, 'lastContact', notiz),
      nextContact: datum(m.nextContact, 'nextContact', notiz),
      beziehungsNotiz: text(m.relationshipNote),
      tags: Array.isArray(m.tags) ? m.tags.map(String) : null,
      persoenlich: istObjekt(m.personal) && Object.keys(m.personal).length ? m.personal : null,
      kiSummary: text(m.aiSummary),
      kiSummaryAt: zeitpunkt(m.aiSummaryTs, 'aiSummaryTs', notiz),
      ...(erstellt ? { createdAt: ISO_TAG(erstellt) } : {}),
      deletedAt: geloeschtAm(m, stichtag),
    });
    maklerIds.add(id);

    const komm = liste(m.komm);
    komm.forEach((k, i) => {
      z.maklerKommunikation.push({
        id: eindeutig('makler_kommunikation', text(k.id) ?? `${id}:k${komm.length - 1 - i}`),
        maklerId: id,
        zeitpunkt: zeitpunkt(k.ts, 'komm.ts', notiz),
        kanal: text(k.kanal),
        richtung: text(k.richtung),
        betreff: text(k.betreff),
        text: text(k.text),
        mailUid: text(k.uid ?? k.mailUid),
      });
    });
    // Alte `notizen` (auch von der Wählmaschine angehängt) nicht verlieren
    const notizen = text(m.notizen);
    if (notizen && !komm.some((k) => text(k.text) === notizen)) {
      z.maklerKommunikation.push({ id: eindeutig('makler_kommunikation', `${id}:notiz`), maklerId: id, zeitpunkt: null, kanal: 'notiz', text: notizen });
    }
  }

  // ── Objekte ──────────────────────────────────────────────
  const objekte = new Map<string, Zeile<typeof schema.objekte>>();
  const objektEinheiten = new Map<string, Zeile<typeof schema.objektEinheiten>[]>();
  for (const o of liste(kv['immo-objects'])) {
    const alteId = text(o.id);
    if (!alteId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'objekte', id: '?', wert: o.strasse, hinweis: 'nicht übernommen' });
      continue;
    }
    const id = eindeutig('objekte', alteId);
    const notiz = notizFuer('objekte', id);
    const zeile: Zeile<typeof schema.objekte> = {
      id,
      strasse: text(o.strasse),
      hausnr: text(o.hausnr),
      plz: text(o.plz),
      stadt: text(o.stadt),
      bundesland: text(o.bundesland),
      baujahr: ganzzahl(o.baujahr, 'baujahr', notiz),
      einheitenAnzahl: ganzzahl(o.einheitenAnz, 'einheitenAnz', notiz),
      wohnflaeche: zahl(o.wohnflaeche, 'wohnflaeche', notiz, 1e8),
      grundstueck: zahl(o.grundstueck, 'grundstueck', notiz, 1e8),
      energieklasse: text(o.energie),
      heizung: text(o.heizung),
      angebotspreis: zahl(o.angebotspreis, 'angebotspreis', notiz),
      zielpreis: zahl(o.zielpreis, 'zielpreis', notiz),
      istMiete: zahl(o.istmiete, 'istmiete', notiz),
      sollMiete: zahl(o.sollmiete, 'sollmiete', notiz),
      status: text(o.status),
      notizen: text(o.notizen),
      erfasstAm: datum(o.datum, 'datum', notiz),
      details: rest(o, OBJEKT_SPALTEN), // 07: Rest → details
      deletedAt: geloeschtAm(o, stichtag),
    };
    z.objekte.push(zeile);
    objekte.set(id, zeile);

    const einheiten = liste(o.einheiten).map((e, i) => {
      unbekannt('objekt_einheiten', e, EINHEIT_OBJEKT);
      return {
        id: eindeutig('objekt_einheiten', `${id}:${text(e.id) ?? i}`),
        objektId: id,
        typ: text(e.typ),
        lage: text(e.lage),
        zimmer: zahl(e.zimmer, 'einheit.zimmer', notiz, 1000),
        stueck: ganzzahl(e.stueck, 'einheit.stueck', notiz),
        flaeche: zahl(e.flaeche, 'einheit.flaeche', notiz, 1e8),
        kaltmiete: zahl(e.kaltmiete, 'einheit.kaltmiete', notiz),
        vermietung: text(e.vermiet),
        sort: i,
      };
    });
    z.objektEinheiten.push(...einheiten);
    objektEinheiten.set(id, einheiten);
  }

  // ── Deals ────────────────────────────────────────────────
  const maklerNachId = new Map(z.makler.map((m) => [m.id, m]));
  for (const d of liste(kv['immo-deals'])) {
    const alteId = text(d.id);
    if (!alteId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'deals', id: '?', wert: d.adresse, hinweis: 'nicht übernommen' });
      continue;
    }
    const id = eindeutig('deals', alteId);
    const notiz = notizFuer('deals', id);
    unbekannt('deals', d, new Set([...DEAL_FELDER, ...Object.keys(DEAL_KOPIEN), ...Object.keys(DEAL_MAKLER_KOPIEN)]), DEAL_AUSGELASSEN);

    // Objekt: Pflicht. Fehlt es, entsteht es aus den kopierten Adressdaten des Deals (07, Befund 7).
    let objektId = text(d.objId);
    if (!objektId || !objekte.has(objektId)) {
      const neueId = objektId ?? `waise-objekt-${id}`;
      const waise: Zeile<typeof schema.objekte> = {
        id: eindeutig('objekte', neueId),
        strasse: text(d.adresse), hausnr: text(d.hausnr), plz: text(d.plz), stadt: text(d.stadt),
        wohnflaeche: zahl(d.wohnflaeche, 'wohnflaeche', notiz, 1e8),
        einheitenAnzahl: ganzzahl(d.einheitenAnz, 'einheitenAnz', notiz),
        status: text(d.status),
        details: { herkunft: 'Umzug: aus den Adress-Kopien des Deals erzeugt', dealId: id },
      };
      z.objekte.push(waise);
      objekte.set(waise.id, waise);
      waisen.objekte++;
      objektId = waise.id;
      befund({ schwere: 'warnung', art: 'waise-objekt', entitaet: 'deals', id, wert: d.objId, hinweis: `Objekt fehlte, aus Deal-Kopie angelegt (${waise.id})` });
    } else {
      const o = objekte.get(objektId)!;
      for (const [kopie, feld] of Object.entries(DEAL_KOPIEN)) {
        const alt = d[kopie];
        const soll = feld === 'strasse' ? o.strasse : feld === 'einheitenAnz' ? o.einheitenAnzahl : (o as Record<string, unknown>)[feld];
        const gleich = ['wohnflaeche', 'einheitenAnz'].includes(kopie)
          ? parseNumAlt(alt) === Number(soll ?? 0)
          : kopie === 'adresse' // mal nur Straße, mal „Straße Hausnr.“
            ? [text(o.strasse) ?? '', [o.strasse, o.hausnr].filter(Boolean).join(' ')].includes(text(alt) ?? '')
            : (text(alt) ?? '') === (text(soll) ?? '');
        if (alt !== undefined && !gleich) {
          befund({ schwere: 'info', art: 'kopie-abweichend', entitaet: 'deals', id, feld: kopie, wert: alt, hinweis: `Objekt hat „${soll ?? ''}“ (Objekt gilt)` });
        }
      }
    }

    // Makler: optional (Fachfrage 1). Verweis ohne Makler → aus Kopie anlegen.
    let maklerId = text(d.maklerId);
    if (maklerId && !maklerNachId.has(maklerId)) {
      const waise = {
        id: eindeutig('makler', maklerId),
        name: text(d.maklerName), firma: text(d.maklerFirma), tel: text(d.maklerTel), email: text(d.maklerEmail),
      };
      z.makler.push(waise);
      maklerNachId.set(waise.id, waise);
      waisen.makler++;
      befund({ schwere: 'warnung', art: 'waise-makler', entitaet: 'deals', id, wert: maklerId, hinweis: 'Makler fehlte, aus Deal-Kopie angelegt' });
      maklerId = waise.id;
    } else if (maklerId) {
      const m = maklerNachId.get(maklerId)!;
      for (const [kopie, feld] of Object.entries(DEAL_MAKLER_KOPIEN)) {
        const alt = text(d[kopie]);
        const soll = text((m as Record<string, unknown>)[feld]);
        if (d[kopie] !== undefined && (alt ?? '') !== (soll ?? '')) {
          befund({ schwere: 'info', art: 'kopie-abweichend', entitaet: 'deals', id, feld: kopie, wert: alt, hinweis: `Makler hat „${soll ?? ''}“ (Makler gilt)` });
        }
      }
    } else if (text(d.maklerName)) {
      befund({ schwere: 'info', art: 'makler-nur-kopie', entitaet: 'deals', id, wert: d.maklerName, hinweis: 'Deal ohne makler_id; Name nur als Kopie vorhanden' });
    }

    const status = DealStatus.safeParse(text(d.status) ?? START_STATUS);
    if (!status.success) notiz('status', d.status, `unbekannter Status → ${START_STATUS}`);
    const dealStatus = status.success ? status.data : START_STATUS;
    const kommentare = liste(d.kommentare);
    const notizen = text(d.notizen);
    const angebotsDatum = datum(d.angebotsDatum, 'angebotsDatum', notiz);
    const geaendert = zeitpunkt(d.updatedAt, 'updatedAt', notiz);

    z.deals.push({
      id,
      objektId,
      maklerId: maklerId ?? null,
      status: dealStatus,
      prio: text(d.prio),
      angebotsDatum,
      nachfassFrequenz: frequenz(d.nachfassFreq, 'deals', id, 'nachfassFreq'),
      lastContact: datum(d.lastContact, 'lastContact', notiz),
      nextContact: datum(d.nextContact, 'nextContact', notiz),
      kalkulation: istObjekt(d.kalk) ? d.kalk : null,
      exposeRohdaten: istObjekt(d._exposeRaw) ? d._exposeRaw : null,
      // Kommentare vorhanden → notizen bleiben Spalte; sonst werden sie der erste Kommentar (wie die alte App)
      notizen: kommentare.length ? notizen : null,
      ...(geaendert ? { updatedAt: geaendert } : {}),
      deletedAt: geloeschtAm(d, stichtag),
    });

    const objEinheiten = objektEinheiten.get(objektId) ?? [];
    let altformatGemeldet = false;
    liste(d.einheiten).forEach((e, i) => {
      unbekannt('deal_einheiten', e, EINHEIT_DEAL);
      if (e.fl === undefined && e.fl_ist !== undefined && !altformatGemeldet) {
        altformatGemeldet = true;
        befund({ schwere: 'info', art: 'einheit-altformat', entitaet: 'deals', id, feld: 'einheiten.fl_ist', hinweis: 'Fläche nur im Altformat fl_ist; die Kalkulation rechnet (wie bisher) ohne Fläche' });
      }
      const passend = objEinheiten.filter((oe) => oe.lage && oe.lage === text(e.lage) && (oe.typ ?? '') === (text(e.typ) ?? ''));
      z.dealEinheiten.push({
        id: eindeutig('deal_einheiten', `${id}:${text(e.id) ?? i}`),
        dealId: id,
        objektEinheitId: passend.length === 1 ? passend[0]!.id : null,
        typ: text(e.typ),
        lage: text(e.lage),
        zimmer: zahl(e.zimmer, 'einheit.zimmer', notiz, 1000),
        // Kalkulation liest fl/mi_ist/mi_neu mit parseNum, rend_k/vkp/stk mit Unärplus
        flaeche: zahl(e.fl, 'einheit.fl', notiz, 1e8),
        mieteIst: zahl(e.mi_ist, 'einheit.mi_ist', notiz),
        mieteNeu: zahl(e.mi_neu, 'einheit.mi_neu', notiz),
        mieteNeuManuell: !!e.mi_neu_manual,
        renditeK: zahlWiePlus(e.rend_k, 'einheit.rend_k', notiz, 1000),
        verkaufspreis: zahlWiePlus(e.vkp, 'einheit.vkp', notiz),
        stueck: zahlWiePlus(e.stk, 'einheit.stk', notiz, 2_147_483_647),
        flaecheIst: zahl(e.fl_ist, 'einheit.fl_ist', notiz, 1e8),
        flaecheSoll: zahl(e.fl_soll, 'einheit.fl_soll', notiz, 1e8),
        mieteSoll: zahl(e.mi_soll, 'einheit.mi_soll', notiz),
        bewertung: rest(e, EINHEIT_DEAL), // u. a. _psUnitId (Propstack)
        sort: i,
      });
    });

    liste(d.sanierung).forEach((s, i) => {
      unbekannt('deal_sanierungen', s, SANIERUNG);
      const bereich = text(s.scope);
      if (bereich && !BEREICHE.includes(bereich)) notiz('sanierung.scope', bereich, 'unbekannter Bereich → beide');
      z.dealSanierungen.push({
        id: eindeutig('deal_sanierungen', `${id}:${text(s.id) ?? i}`),
        dealId: id,
        beschreibung: text(s.desc),
        betrag: zahlWiePlus(s.amt, 'sanierung.amt', notiz),
        bereich: bereich && BEREICHE.includes(bereich) ? bereich : null,
        sort: i,
      });
    });

    // Neueste zuerst gespeichert (unshift) → Nummer vom Ende, damit IDs bei neuen Kommentaren stabil bleiben
    kommentare.forEach((k, i) => {
      unbekannt('deal_kommentare', k, KOMMENTAR);
      z.dealKommentare.push({
        id: eindeutig('deal_kommentare', `${id}:k${kommentare.length - 1 - i}`),
        dealId: id,
        zeitpunkt: zeitpunkt(k.ts, 'kommentar.ts', notiz),
        text: text(k.text),
      });
    });
    if (!kommentare.length && notizen) {
      z.dealKommentare.push({ id: eindeutig('deal_kommentare', `${id}:notiz`), dealId: id, zeitpunkt: null, text: notizen });
    }

    liste(d.kalkVarianten).forEach((v, i) => {
      unbekannt('deal_kalk_varianten', v, VARIANTE);
      const ts = zeitpunkt(v.ts, 'kalkVariante.ts', notiz);
      z.dealKalkVarianten.push({
        id: eindeutig('deal_kalk_varianten', `${id}:${text(v.id) ?? i}`),
        dealId: id,
        name: text(v.name),
        kalkulation: istObjekt(v.kalk) ? v.kalk : null,
        einheiten: Array.isArray(v.einheiten) ? v.einheiten : null,
        sanierungen: Array.isArray(v.sanierung) ? v.sanierung : null,
        ...(ts ? { createdAt: ts } : {}),
      });
    });

    z.dealStatusHistorie.push({
      id: `umzug:${id}`,
      dealId: id,
      vonStatus: null,
      nachStatus: dealStatus,
      am: angebotsDatum ? ISO_TAG(angebotsDatum) : stichtag,
      quelle: 'umzug',
      grund: 'Status beim Umzug; der frühere Verlauf ist in der alten App nicht gespeichert',
    });
  }

  // ── Kundenkalkulationen ──────────────────────────────────
  const dealIds = new Set(z.deals.map((d) => d.id));
  const einheitIds = new Set(z.dealEinheiten.map((e) => e.id));
  for (const k of liste(kv['immo-kundenkalkulationen'])) {
    const alteId = text(k.id);
    if (!alteId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'kundenkalkulationen', id: '?', wert: k.name, hinweis: 'nicht übernommen' });
      continue;
    }
    const id = eindeutig('kundenkalkulationen', alteId);
    const notiz = notizFuer('kundenkalkulationen', id);
    unbekannt('kundenkalkulationen', k, KUNDENKALK);
    const dealId = text(k.dealId);
    if (!dealId || !dealIds.has(dealId)) {
      befund({ schwere: 'warnung', art: 'waise-kundenkalkulation', entitaet: 'kundenkalkulationen', id, wert: k.dealId, hinweis: 'Deal fehlt, Kalkulation nicht übernommen' });
      continue;
    }
    if (!istObjekt(k.inputs)) {
      befund({ schwere: 'fehler', art: 'kundenkalkulation-ohne-eingaben', entitaet: 'kundenkalkulationen', id, hinweis: 'inputs fehlen, nicht übernommen' });
      continue;
    }
    const einheitAlt = text(k.einheitId);
    const einheitNeu = einheitAlt ? `${dealId}:${einheitAlt}` : null;
    if (einheitNeu && !einheitIds.has(einheitNeu)) {
      befund({ schwere: 'info', art: 'kundenkalkulation-einheit-fehlt', entitaet: 'kundenkalkulationen', id, wert: einheitAlt, hinweis: 'Einheit nicht mehr im Deal; Zuordnung über den Namen bleibt' });
    }
    const stellplaetze = Array.isArray(k.stellplaetzeIds) ? k.stellplaetzeIds.map(String) : [];
    if (text(k.disclaimerOverride)) notiz('disclaimerOverride', k.disclaimerOverride, 'veralteter eigener Disclaimer wird nicht übernommen (zentral in Einstellungen)');
    const bilder = Array.isArray(k.impressionen) ? k.impressionen.map(String) : [];
    const eingebettet = bilder.filter((b) => b.startsWith('data:')).length;
    if (eingebettet) befund({ schwere: 'info', art: 'kundenkalkulation-bild-eingebettet', entitaet: 'kundenkalkulationen', id, wert: eingebettet, hinweis: 'Bilder als data:-URL (Altformat) übernommen; Umwandlung in Dateien folgt mit Fotos' });
    const inputs = k.inputs as Record<string, unknown>;
    const erstellt = zeitpunkt(k.createdAt, 'createdAt', notiz);
    const geaendert = zeitpunkt(k.updatedAt, 'updatedAt', notiz);
    z.kundenkalkulationen.push({
      id,
      dealId,
      dealEinheitId: einheitNeu && einheitIds.has(einheitNeu) ? einheitNeu : null,
      name: text(k.name),
      scope: text(k.scope) === 'aufteiler' ? 'aufteiler' : 'global',
      inputs,
      objSnapshot: istObjekt(k.objSnapshot) ? k.objSnapshot : null,
      projektTitel: text(k.projektTitel),
      wertsteigBullets: Array.isArray(k.wertsteigerungBullets) ? k.wertsteigerungBullets.map(String) : null,
      wertsteigSichtbar: typeof k.wertsteigerungSichtbar === 'boolean' ? k.wertsteigerungSichtbar : null,
      // migrateKKalk: fehlende Aufteilung → Wohnung = Gesamtkaufpreis, Stellplatz = 0
      kaufpreisWohnung: typeof k.kaufpreisWohnung === 'number' ? k.kaufpreisWohnung : typeof inputs.kaufpreis === 'number' ? inputs.kaufpreis : 0,
      kaufpreisStellplatz: typeof k.kaufpreisStellplatz === 'number' ? k.kaufpreisStellplatz : 0,
      stellplaetzeAnzahl: typeof k.stellplaetzeAnzahl === 'number' ? k.stellplaetzeAnzahl : null,
      stellplatzEinhIds: stellplaetze.map((s) => (einheitIds.has(`${dealId}:${s}`) ? `${dealId}:${s}` : s)),
      bildRefs: bilder,
      internNotiz: text(k.internNotiz),
      ...(erstellt ? { createdAt: erstellt } : {}),
      ...(geaendert ? { updatedAt: geaendert } : {}),
      deletedAt: geloeschtAm(k, stichtag),
    });
  }

  // ── Objektfotos (Metadaten; Dateien bleiben im Bucket) ───
  const objektIds = new Set(z.objekte.map((o) => o.id));
  for (const f of liste(kv[FOTO_TABELLE])) {
    const id = text(f.id);
    const objektId = text(f.obj_id);
    if (!id || !objektId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'objekt_fotos', id: id ?? '?', wert: f.original_name, hinweis: 'nicht übernommen' });
      continue;
    }
    if (!objektIds.has(objektId)) {
      befund({ schwere: 'warnung', art: 'waise-foto', entitaet: 'objekt_fotos', id, wert: objektId, hinweis: 'Objekt fehlt, Foto nicht übernommen (Datei bleibt im Bucket)' });
      continue;
    }
    const sekunden = Number(f.uploaded_at);
    z.objektFotos.push({
      id,
      objektId,
      storageKey: fotoSchluessel(objektId, id),
      dateiname: text(f.original_name),
      mimeType: text(f.mime_type) ?? 'image/jpeg',
      groesseBytes: Number(f.size_bytes) || 0,
      sort: Number.isInteger(Number(f.sort_order)) ? Number(f.sort_order) : 0,
      ...(Number.isFinite(sekunden) && sekunden > 0 ? { hochgeladenAm: new Date(sekunden * 1000).toISOString() } : {}),
    });
  }

  // ── Deal-Dokumente (Metadaten; Dateien bleiben im Bucket) ──
  const dealIdsDok = new Set(z.deals.map((d) => d.id));
  const objektJeDeal = new Map(z.deals.map((d) => [d.id, d.objektId]));
  for (const f of liste(kv[DOKUMENT_TABELLE])) {
    const id = text(f.id);
    const dealId = text(f.deal_id);
    const name = typeof f.original_name === 'string' ? f.original_name : null;
    if (!id || !dealId || !name) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'deal_dokumente', id: id ?? '?', wert: f.original_name, hinweis: 'nicht übernommen' });
      continue;
    }
    if (!dealIdsDok.has(dealId)) {
      befund({ schwere: 'warnung', art: 'waise-dokument', entitaet: 'deal_dokumente', id, wert: dealId, hinweis: 'Deal fehlt, Dokument nicht übernommen (Datei bleibt im Bucket)' });
      continue;
    }
    const sekunden = Number(f.uploaded_at);
    const label = typeof f.label === 'string' ? f.label : '';
    z.dokumente.push({
      id, dealId, objektId: objektJeDeal.get(dealId) ?? null, dateiname: name, mimeType: text(f.mime_type) ?? 'application/octet-stream', groesseBytes: Number(f.size_bytes) || 0,
      label, istExpose: istExposeDokument(label, name), storageKey: dokumentSchluessel(dealId, id, name),
      ...(Number.isFinite(sekunden) && sekunden > 0 ? { hochgeladenAm: new Date(sekunden * 1000).toISOString() } : {}),
    });
  }

  // ── Bank-Präsentationen ──────────────────────────────────
  const aktiveJeDeal = new Map<string, number>();
  for (const pr of liste(kv['immo-finanzpraes'])) {
    const alteId = text(pr.id);
    if (!alteId) {
      befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'finanzpraesentationen', id: '?', wert: pr.bankName, hinweis: 'nicht übernommen' });
      continue;
    }
    const id = eindeutig('finanzpraesentationen', alteId);
    const notiz = notizFuer('finanzpraesentationen', id);
    unbekannt('finanzpraesentationen', pr, PRAESENTATION);
    const dealId = text(pr.dealId);
    if (!dealId || !dealIds.has(dealId)) {
      befund({ schwere: 'warnung', art: 'waise-praesentation', entitaet: 'finanzpraesentationen', id, wert: pr.dealId, hinweis: 'Deal fehlt, Präsentation nicht übernommen' });
      continue;
    }
    const geloescht = geloeschtAm(pr, stichtag);
    if (!geloescht) {
      const n = (aktiveJeDeal.get(dealId) ?? 0) + 1;
      aktiveJeDeal.set(dealId, n);
      if (n > 1) befund({ schwere: 'warnung', art: 'praesentation-mehrfach', entitaet: 'finanzpraesentationen', id, wert: dealId, hinweis: 'mehr als eine aktive Präsentation je Deal; die alte App zeigte nur die erste' });
    }
    const erstellt = zeitpunkt(pr.createdAt, 'createdAt', notiz);
    const geaendert = zeitpunkt(pr.updatedAt, 'updatedAt', notiz);
    z.finanzpraesentationen.push({
      id, dealId, bankName: text(pr.bankName), internNotiz: text(pr.internNotiz),
      ...(erstellt ? { createdAt: erstellt } : {}),
      ...(geaendert ? { updatedAt: geaendert } : {}),
      deletedAt: geloescht,
    });
    liste(pr.slides).forEach((f, sort) => {
      const folienId = eindeutig('praesentation_folien', text(f.id) ?? `${id}:folie-${sort}`);
      unbekannt('praesentation_folien', f, FOLIE);
      const typ = text(f.typ) ?? '';
      if (!(SLIDE_TYP_WERTE as string[]).includes(typ)) {
        befund({ schwere: 'info', art: 'folie-typ-unbekannt', entitaet: 'praesentation_folien', id: folienId, wert: typ, hinweis: 'übernommen; die Vorlage zeigt einen Platzhalter wie in der alten App' });
      }
      z.praesentationFolien.push({ id: folienId, praesentationId: id, typ, sichtbar: f.visible !== false, sort, daten: istObjekt(f.data) ? f.data : {} });
    });
  }
  // ── Begleitscheine ───────────────────────────────────────
  for (const typ of BS_TYPEN) {
    const v = bsVorlageAlt(kv, typ);
    if (v.aus === 'auslieferung') befund({ schwere: 'info', art: 'bs-vorlage-auslieferung', entitaet: 'begleitschein_vorlagen', id: typ, hinweis: 'keine gespeicherte Vorlage; Auslieferungszustand übernommen (wie beim ersten Öffnen in der alten App)' });
    const geaendert = zeitpunkt(v.updatedAt, 'updatedAt', notizFuer('begleitschein_vorlagen', typ));
    z.begleitscheinVorlagen.push({ typ, kopf: v.kopf, zeilen: v.rows, updatedAt: geaendert });
  }
  const vordruckIds = new Set<string>();
  liste(kv['immo-bs-vordrucke']).forEach((vd, sort) => {
    const alteId = text(vd.id);
    if (!alteId) { befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'vordrucke', id: '?', wert: vd.titel, hinweis: 'nicht übernommen' }); return; }
    const id = eindeutig('vordrucke', alteId);
    unbekannt('vordrucke', vd, VORDRUCK);
    vordruckIds.add(id);
    z.vordrucke.push({ id, nummer: text(vd.nummer), titel: text(vd.titel), art: text(vd.art) ?? 'brief', inhalt: typeof vd.inhalt === 'string' ? vd.inhalt : null,
      betreff: typeof vd.betreff === 'string' ? vd.betreff : null, dateiName: text(vd.dateiName), aktiv: vd.aktiv !== false, sort });
  });
  for (const typ of BS_TYPEN) {
    if (!liste(kv['immo-bs-aktionen']).some((c) => c.typ === typ) && typ === 'ankauf') {
      befund({ schwere: 'info', art: 'bs-aktionen-auslieferung', entitaet: 'begleitschein_aktionen', id: typ, hinweis: 'keine gespeicherte Aktionskonfiguration; Auslieferungszustand übernommen' });
    }
    bsAktionenAlt(kv, typ).forEach((a, sort) => {
      const id = eindeutig('begleitschein_aktionen', text(a.id) ?? `${typ}-aktion-${sort}`);
      unbekannt('begleitschein_aktionen', a, BS_AKTION);
      let vordruckId = text(a.vordruckId);
      if (vordruckId && !vordruckIds.has(vordruckId)) {
        befund({ schwere: 'info', art: 'bs-aktion-vordruck-fehlt', entitaet: 'begleitschein_aktionen', id, wert: vordruckId, hinweis: 'Vordruck gelöscht; die Aktion zeigte schon alt „noch kein Vordruck hinterlegt“' });
        vordruckId = null;
      }
      z.begleitscheinAktionen.push({
        id, vorlageTyp: typ, rowId: text(a.rowId), subId: text(a.subId), typ: text(a.typ), label: typeof a.label === 'string' ? a.label : '', aktiv: a.aktiv !== false,
        vordruckId, url: text(a.url), modul: text(a.modul), empfaenger: text(a.empfaenger), betreff: typeof a.betreff === 'string' ? a.betreff : null,
        analyseTyp: text(a.analyseTyp), datenQuelle: text(a.datenQuelle), sort,
      });
    });
  }
  const objektIdsBs = new Set(z.objekte.map((o) => o.id));
  for (const b of liste(kv['immo-begleitscheine'])) {
    const alteId = text(b.id);
    if (!alteId) { befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'begleitscheine', id: '?', wert: b.name, hinweis: 'nicht übernommen' }); continue; }
    const id = eindeutig('begleitscheine', alteId);
    const notiz = notizFuer('begleitscheine', id);
    unbekannt('begleitscheine', b, BEGLEITSCHEIN);
    const objektId = text(b.objektId);
    if (!objektId || !objektIdsBs.has(objektId)) {
      befund({ schwere: 'warnung', art: 'waise-begleitschein', entitaet: 'begleitscheine', id, wert: b.objektId, hinweis: 'Objekt fehlt, Begleitschein nicht übernommen' });
      continue;
    }
    const typ = text(b.typ) === 'verkauf' ? 'verkauf' : 'ankauf';
    const dealId = text(b.dealId);
    if (dealId && !dealIds.has(dealId)) befund({ schwere: 'info', art: 'begleitschein-deal-fehlt', entitaet: 'begleitscheine', id, wert: dealId, hinweis: 'Deal-Verknüpfung entfernt' });
    const erstellt = zeitpunkt(b.createdAt, 'createdAt', notiz);
    const geaendert = zeitpunkt(b.updatedAt, 'updatedAt', notiz);
    z.begleitscheine.push({
      id, vorlageTyp: typ, objektId, dealId: dealId && dealIds.has(dealId) ? dealId : null, adresse: text(b.adresse) ?? '', whgNr: text(b.whgNr), name: text(b.name) ?? '',
      kopf: typeof b.kopf === 'string' ? b.kopf : '', zeilen: Array.isArray(b.rows) ? b.rows : [],
      archiviertAm: b.archiviert ? (zeitpunkt(b.archiviertAm, 'archiviertAm', notiz) ?? stichtag) : null,
      ...(erstellt ? { createdAt: erstellt } : {}),
      ...(geaendert ? { updatedAt: geaendert } : {}),
      deletedAt: geloeschtAm(b, stichtag),
    });
  }

  // ── Vertriebslisten ──────────────────────────────────────
  for (const vl of liste(kv['immo-vertriebslisten'])) {
    const alteId = text(vl.id);
    if (!alteId) { befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'vertriebslisten', id: '?', hinweis: 'nicht übernommen' }); continue; }
    const id = eindeutig('vertriebslisten', alteId);
    const notiz = notizFuer('vertriebslisten', id);
    unbekannt('vertriebslisten', vl, VERTRIEBSLISTE);
    const dealId = text(vl.dealId);
    if (!dealId || !dealIds.has(dealId)) {
      befund({ schwere: 'warnung', art: 'waise-vertriebsliste', entitaet: 'vertriebslisten', id, wert: vl.dealId, hinweis: 'Deal fehlt, Vertriebsliste nicht übernommen' });
      continue;
    }
    const erstellt = zeitpunkt(vl.createdAt, 'createdAt', notiz);
    const geaendert = zeitpunkt(vl.updatedAt, 'updatedAt', notiz);
    z.vertriebslisten.push({
      id, dealId, spalten: Array.isArray(vl.columns) ? vl.columns : [], versteckteSpalten: Array.isArray(vl.hiddenColumns) ? vl.hiddenColumns.map(String) : [],
      ...(erstellt ? { createdAt: erstellt } : {}),
      ...(geaendert ? { updatedAt: geaendert } : {}),
      deletedAt: geloeschtAm(vl, stichtag),
    });
    liste(vl.rows).forEach((r, sort) => {
      const zeilenId = eindeutig('vertriebsliste_zeilen', text(r.id) ?? `${id}:zeile-${sort}`);
      unbekannt('vertriebsliste_zeilen', r, VL_ZEILE);
      const einheitAlt = text(r.einheitId);
      const einheitNeu = einheitAlt ? `${dealId}:${einheitAlt}` : null;
      z.vertriebslisteZeilen.push({
        id: zeilenId, listeId: id, dealEinheitId: einheitNeu && einheitIds.has(einheitNeu) ? einheitNeu : null, istStellplatz: r.isStellplatz === true,
        sort, daten: { ...(istObjekt(r.data) ? r.data : {}), ...(einheitAlt && !(einheitNeu && einheitIds.has(einheitNeu)) ? { _einheitIdAlt: einheitAlt } : {}) },
      });
    });
  }

  // ── Projektmanagement ────────────────────────────────────
  // Freitexte (Checkliste, Kommentare) wörtlich, ohne Trimmen: Zeilenumbrüche und Leerzeichen sind dort Inhalt.
  const roh = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
  for (const [projektSort, p] of liste(kv['immo-projekte']).entries()) {
    const alteId = text(p.id);
    if (!alteId) { befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'projekte', id: '?', wert: p.adresse, hinweis: 'nicht übernommen' }); continue; }
    const id = eindeutig('projekte', alteId);
    const notiz = notizFuer('projekte', id);
    unbekannt('projekte', p, PROJEKT);
    const dealId = text(p.dealId);
    if (dealId && !dealIds.has(dealId)) befund({ schwere: 'info', art: 'projekt-deal-fehlt', entitaet: 'projekte', id, wert: dealId, hinweis: 'Deal-Verknüpfung entfernt, Projekt übernommen' });
    z.projekte.push({
      id, sort: projektSort, dealId: dealId && dealIds.has(dealId) ? dealId : null, adresse: roh(p.adresse), stadt: roh(p.stadt), datum: datum(p.datum, 'datum', notiz),
      zielVkp: zahl(p.zielVKP, 'zielVKP', notiz), globalVstatus: text(p.globalVstatus), globalIstKp: zahl(p.globalIstKP, 'globalIstKP', notiz),
      globalKommentar: roh(p.globalKommentar), globalKaeufer: roh(p.globalKaeufer),
      globalNotarDatum: datum(p.globalNotarDatum, 'globalNotarDatum', notiz), globalReservDatum: datum(p.globalReservDatum, 'globalReservDatum', notiz),
      deletedAt: geloeschtAm(p, stichtag),
    });
    liste(p.einheiten).forEach((e, sort) => {
      const alteEinheit = text(e.id);
      const eid = eindeutig('projekt_einheiten', `${id}:${alteEinheit ?? `einheit-${sort}`}`);
      const en = notizFuer('projekt_einheiten', eid);
      unbekannt('projekt_einheiten', e, PM_EINHEIT);
      const dealEinheit = dealId && alteEinheit ? `${dealId}:${alteEinheit}` : null;
      if (Array.isArray(e.pipTodos) && e.pipTodos.length) {
        befund({ schwere: 'warnung', art: 'projekt-piptodos-liste', entitaet: 'projekt_einheiten', id: eid, wert: e.pipTodos, hinweis: 'Liste pipTodos wurde in der alten Oberfläche nie angezeigt; nicht übernommen' });
      }
      z.projektEinheiten.push({
        id: eid, projektId: id, dealEinheitId: dealEinheit && einheitIds.has(dealEinheit) ? dealEinheit : null, sort,
        typ: roh(e.typ), lage: roh(e.lage), zimmer: zahl(e.zimmer, 'zimmer', en, 1000), flaeche: zahl(e.fl, 'fl', en, 1e8), stueck: ganzzahl(e.stk, 'stk', en), teNr: roh(e.teNr),
        kaltmiete: zahl(e.kaltmiete, 'kaltmiete', en), kmMoeglich: zahl(e.kmMoeglich, 'kmMoeglich', en),
        grundpreis: zahl(e.grundpreis, 'grundpreis', en), provision: zahl(e.provision, 'provision', en), sanierungIvt: zahl(e.sanIVT, 'sanIVT', en),
        ergebnisIvt: zahl(e.ergebnisIVT, 'ergebnisIVT', en), zielKp: zahl(e.zielKP, 'zielKP', en), istKp: zahl(e.istKP, 'istKP', en),
        vstatus: text(e.vstatus), vertriebsstand: roh(e.vertriebsstand), vermietet: text(e.vermietet), mieterName: roh(e.mieterName),
        pip: text(e.pip), pipStrategie: roh(e.pipStrategie), pipTodos: roh(e.pipTodosText), mieterTodos: roh(e.mieterTodosText),
        reservDatum: datum(e.reservDatum, 'reservDatum', en), notarDatum: datum(e.notarDatum, 'notarDatum', en), kaeufer: roh(e.kaeufer), vtKommentar: roh(e.vtKommentar),
      });
      liste(e.mieterHistorie).forEach((h, i) => {
        unbekannt('projekt_mieterhistorie', h, PM_GESPRAECH);
        const hid = eindeutig('projekt_mieterhistorie', text(h.id) ?? `${eid}:gespraech-${i}`);
        z.projektMieterhistorie.push({ id: hid, projektEinheitId: eid, sort: i, datum: datum(h.datum, 'datum', notizFuer('projekt_mieterhistorie', hid)), inhalt: roh(h.inhalt), ergebnis: roh(h.ergebnis) });
      });
    });
    liste(p.todos).forEach((t, sort) => {
      unbekannt('projekt_aufgaben', t, PM_TODO);
      const tid = eindeutig('projekt_aufgaben', text(t.id) ?? `${id}:aufgabe-${sort}`);
      let status = text(t.status);
      if (!status) {
        status = t.done ? 'erledigt' : 'offen';
        if (t.done) befund({ schwere: 'info', art: 'projekt-aufgabe-done', entitaet: 'projekt_aufgaben', id: tid, hinweis: 'Altformat done ohne status → erledigt (Karte zählte sie schon so)' });
      } else if (!PM_TODO_STATUS.includes(status)) {
        befund({ schwere: 'warnung', art: 'projekt-aufgabe-status', entitaet: 'projekt_aufgaben', id: tid, wert: status, hinweis: 'unbekannter Status, unverändert übernommen' });
      }
      z.projektAufgaben.push({
        id: tid, projektId: id, sort, kategorie: roh(t.cat), text: roh(t.text), status, kommentar: roh(t.kommentar), verantwortlich: roh(t.verantwortlich),
        faellig: datum(t.faellig, 'faellig', notizFuer('projekt_aufgaben', tid)),
      });
    });
    liste(p.gebPIP).forEach((m, sort) => {
      unbekannt('projekt_gebaeude_massnahmen', m, PM_MASSNAHME);
      z.projektGebaeudeMassnahmen.push({ id: `${id}:massnahme-${sort}`, projektId: id, sort, text: roh(m.text), status: roh(m.status), verantwortlich: roh(m.verantw) });
    });
  }

  // ── Gespeicherte Filter ──────────────────────────────────
  // Exakte Doppel (gleiches Modul, gleicher Name, gleiche Kriterien) entstanden alt durch zu frühes Anlegen der Vorlagen
  // (27 statt 7 Filter am 05.08.2026); sie tragen keine Information und werden einmal übernommen.
  const filterGesehen = new Set<string>();
  for (const f of liste(kv['immo-saved-filters'])) {
    const alteId = text(f.id);
    if (!alteId) { befund({ schwere: 'fehler', art: 'ohne-id', entitaet: 'gespeicherte_filter', id: '?', wert: f.name, hinweis: 'nicht übernommen' }); continue; }
    unbekannt('gespeicherte_filter', f, FILTER);
    const modul = text(f.module);
    if (!modul || !FILTER_MODULE.includes(modul)) {
      befund({ schwere: 'warnung', art: 'filter-modul-unbekannt', entitaet: 'gespeicherte_filter', id: alteId, wert: f.module, hinweis: 'nicht übernommen' });
      continue;
    }
    const kriterien = Array.isArray(f.criteria) ? f.criteria : [];
    const schluessel = kanonisch([modul, f.name ?? '', kriterien]);
    if (filterGesehen.has(schluessel)) {
      befund({ schwere: 'info', art: 'filter-doppelt', entitaet: 'gespeicherte_filter', id: alteId, wert: f.name, hinweis: 'exaktes Doppel, einmal übernommen' });
      continue;
    }
    filterGesehen.add(schluessel);
    const id = eindeutig('gespeicherte_filter', alteId);
    const notiz = notizFuer('gespeicherte_filter', id);
    const erstellt = zeitpunkt(f.createdAt, 'createdAt', notiz);
    const geaendert = zeitpunkt(f.updatedAt, 'updatedAt', notiz);
    z.gespeicherteFilter.push({
      id, modul, name: typeof f.name === 'string' ? f.name : '', kriterien,
      ...(erstellt ? { createdAt: erstellt } : {}), ...(geaendert ? { updatedAt: geaendert } : {}),
    });
  }

  // ── Textvorlagen ─────────────────────────────────────────
  if (Array.isArray(kv['immo-vorlagen'])) {
    liste(kv['immo-vorlagen']).forEach((v, sort) => {
      unbekannt('textvorlagen', v, VORLAGE);
      const id = eindeutig('textvorlagen', text(v.id) ?? `vorlage-${sort}`);
      const kanal = text(v.kanal);
      if (kanal && !['email', 'whatsapp', 'beide'].includes(kanal)) befund({ schwere: 'warnung', art: 'vorlage-kanal', entitaet: 'textvorlagen', id, wert: kanal, hinweis: 'unbekannter Kanal, unverändert übernommen' });
      z.textvorlagen.push({ id, sort, name: typeof v.name === 'string' ? v.name : '', kanal: kanal ?? 'email', betreff: typeof v.betreff === 'string' ? v.betreff : null, text: typeof v.text === 'string' ? v.text : '' });
    });
    z.einstellungen.push({ schluessel: VORLAGEN_GESPEICHERT, wert: true as unknown as object });
  }

  // Listenreihenfolge wie die alte Sammlung (Waisen aus Deal-Kopien hinten)
  z.makler.forEach((m, i) => { m.reihenfolge = i; });
  z.objekte.forEach((o, i) => { o.reihenfolge = i; });
  z.deals.forEach((d, i) => { d.reihenfolge = i; });

  const praesStandard = kv['immo-finanzpraes-defaults'];
  if (praesStandard !== undefined && praesStandard !== null && praesStandard !== '') {
    z.einstellungen.push({ schluessel: FINANZPRAES_STANDARD_SCHLUESSEL, wert: finanzpraesStandardUmformen(praesStandard) as object });
  }

  // ── DD-Dokumentenliste (Einstellungen → DD) ──────────────
  // Die alte ID ist nur die Laufnummer beim Anlegen; die Reihenfolge der Liste ist die Information.
  liste(kv['immo-dd-template']).forEach((d, i) => {
    unbekannt('dd_checkliste_vorlage', d, DD_ZEILE);
    z.ddChecklisteVorlage.push({ dokument: text(d.dokument), quelle: text(d.quelle), sort: i });
  });

  // ── Einstellungen ────────────────────────────────────────
  for (const [alt, neu] of Object.entries(EINSTELLUNGEN)) {
    const wert = kv[alt];
    if (wert === undefined || wert === null || wert === '') continue;
    z.einstellungen.push({ schluessel: neu, wert: wert as object });
  }

  return { zeilen: z, befunde, unbekannteFelder, waisen };
}

