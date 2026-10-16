import type { ExposeAnalyseAntwort, ExposeUebernehmen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  type Angabe, angabenAusImport, belegePruefen, dokumentArtPruefen, steuerzeichenEntfernen, berechneAnkauf, dealEinheitenAusExpose, dublettenDeal, dublettenMakler, dublettenObjekt, einheitAlsEingabe,
  EXPOSE_V2_SCHEMA, type ExposeV2, exposeVorbereiten, type Gelernt, GG_ZIELE, type ImportFuerAngaben, maklerHatDaten, normalisiereFrequenz, telefonErsetzen,
  telefonNormalisieren, uebernahmeWert, type WeitereKontakte, weitereKontakte, wizardKalkSpeichern, wizardKalkVorbelegen, type ZielArt, zuordnen,
} from '@gg/domain';
import {
  analysiereExpose, BUCKETS, bilderAusPdf, type ExposeBild, type Dateispeicher, dokumentSchluessel, EINGANG, istEingangsSchluessel, istPdf, type KiClient, kostenBuchung, pdfDokument, pdfText,
  tesseractOcr, type Texterkennung,
} from '@gg/integrations';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';
import { exposeExtraktionLesen, kalkStandardLesen } from './einstellungen.ts';
import { detailsLesen, detailsSetzen, fuerAngaben, listeAnhaengen } from './exposeAngaben.ts';
import { gelerntLesen, lernen } from './exposeBezeichnungen.ts';
import { fotoHochladen } from './fotos.ts';
import { objektTitel } from './objekte.ts';

export interface ExposeKontext {
  speicher: Dateispeicher;
  ki: KiClient | null;
  attrappe: boolean;
  /** Fotos aus dem PDF herauslösen; Standard `bilderAusPdf`, im Test austauschbar */
  bilder?: (pdf: Uint8Array) => Promise<ExposeBild[]>;
  /**
   * Texterkennung für Bild-Seiten je Analyse; Standard `tesseractOcr()` (lokal aus node_modules).
   * `null` = aus (`OCR=aus`, Tests): Bild-Seiten bleiben ohne Text, Scans gehen wie bisher komplett an das gründliche Modell.
   */
  texterkennung?: (() => Texterkennung) | null;
}

export const MAX_EXPOSE_BYTES = 200 * 1024 * 1024;

/** PDF in den Eingang legen (pdfs/_eingang/<uuid>). Die Signatur wird geprüft, nicht der Dateiname. */
export async function exposeEingang(k: ExposeKontext, bytes: Uint8Array) {
  if (!istPdf(bytes)) throw new FachFehler(422, 'Die Datei ist kein PDF.');
  if (bytes.byteLength > MAX_EXPOSE_BYTES) throw new FachFehler(422, 'Das PDF ist größer als 200 MB.');
  const key = `${EINGANG}/${crypto.randomUUID()}`;
  await k.speicher.ablegen(BUCKETS.pdfs, key, bytes, 'application/pdf');
  return { key, groesse: bytes.byteLength };
}

/**
 * Direkt-Upload, Schritt 3: das PDF liegt schon unter `_eingang/<uuid>` — geprüft wird am liegenden Objekt.
 * Was durchfällt, wird gelöscht: es war nie ein Exposé, es lag nur kurz im Eingang.
 */
export async function exposeEingangUebernehmen(k: ExposeKontext, key: string) {
  if (!istEingangsSchluessel(key)) throw new FachFehler(400, 'Ungültiger Upload-Schlüssel.');
  const { bytes, groesse } = await k.speicher.anfang(BUCKETS.pdfs, key, 1024).catch(() => { throw new FachFehler(404, 'Die hochgeladene Datei wurde nicht gefunden — bitte erneut hochladen.'); });
  const ablehnen = async (status: 422, grund: string): Promise<never> => { await k.speicher.loeschen(BUCKETS.pdfs, [key]).catch(() => {}); throw new FachFehler(status, grund); };
  if (!istPdf(bytes)) await ablehnen(422, 'Die Datei ist kein PDF.');
  if (groesse > MAX_EXPOSE_BYTES) await ablehnen(422, 'Das PDF ist größer als 200 MB.');
  return { key, groesse };
}

/** Kostenzeile ins Audit (mit Hash-Kette). */
async function kostenBuchen(db: Db, model: string, usage: Parameters<typeof kostenBuchung>[1] | undefined, quelle: string) {
  if (!usage) return;
  try {
    const b = kostenBuchung(model, usage, quelle, { schritt: quelle });
    await auditSchreiben(db, {
      type: b.type, aiModel: b.ai_model, source: b.source, inputTokens: b.input_tokens, outputTokens: b.output_tokens,
      costEur: b.cost_eur, metadata: b.metadata,
    });
  } catch (e) {
    console.error('[ki-kosten] Buchung fehlgeschlagen:', e);
  }
}

/** Erzeuger aus den PDF-Metadaten (Creator, sonst Producer) — für den Hinweis „sieht nicht nach einem Exposé aus“ */
export async function pdfErzeuger(pdf: Uint8Array): Promise<string | null> {
  try {
    const d = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    return d.getCreator()?.trim() || d.getProducer()?.trim() || null;
  } catch { return null; }
}

export async function exposeAnalysieren(db: Db, k: ExposeKontext, key: unknown, dateiname: string): Promise<ExposeAnalyseAntwort> {
  if (!istEingangsSchluessel(key)) throw new FachFehler(422, 'Ungültiger Upload-Schlüssel.');
  if (!k.ki) throw new FachFehler(422, 'Keine KI eingerichtet: Anthropic-Schlüssel unter Einstellungen → Zugänge hinterlegen.');
  let pdf: Uint8Array;
  try {
    pdf = await k.speicher.holen(BUCKETS.pdfs, key);
  } catch {
    throw new FachFehler(404, 'Die hochgeladene Datei wurde nicht gefunden — bitte erneut versuchen.');
  }
  if (!istPdf(pdf)) throw new FachFehler(422, `„${dateiname}“ ist kein PDF.`);

  // Fotos parallel zur Analyse herauslösen (Zeit sparen); ein Fehler dort stoppt die Analyse nicht
  const bilderLauf = (k.bilder ?? bilderAusPdf)(pdf).then((b) => ({ b, fehler: null as unknown }), (fehler: unknown) => ({ b: [] as ExposeBild[], fehler }));
  const einstellung = await exposeExtraktionLesen(db);
  // Rohdaten ohne KI: Textlayer + Texterkennung der Bild-Seiten (Protokoll 30, P1); der OCR-Worker lebt nur für diese Analyse
  const texterkennung = k.texterkennung === null ? null : (k.texterkennung ?? tesseractOcr)();
  if (texterkennung?.grund) console.warn('[expose-analyse] ohne Texterkennung:', texterkennung.grund);
  // Steuerzeichen aus dem PDF (U+0000 als Aufzählungspunkt) bereinigen — Postgres nimmt sie nicht an (22P05)
  const analyse = steuerzeichenEntfernen(await analysiereExpose(pdf, dateiname, {
    ki: k.ki,
    pdfText: (b) => pdfText(Buffer.from(b)),
    dokument: (b) => pdfDokument(b, { ocr: texterkennung?.ocr }),
    buchen: (model, usage, quelle) => kostenBuchen(db, model, usage, quelle),
  }, { schema: einstellung.schema, kostenGrenzeEur: einstellung.kostenGrenzeEur }).finally(() => texterkennung?.beenden()));

  // v2: Werte gegen die Seitentexte prüfen (nur der Textweg hat Seitentexte), falsche Seiten berichtigen,
  // dann per Mapping-Tabelle ins Format der Prüfseite
  let v2: ExposeV2 | null = null;
  let belegt: (boolean | null)[] = [];
  let belegQuote: number | null = null;
  let gelerntAnalyse: Gelernt = {};
  const warnungen = [...analyse.warnungen];
  let v0: any = analyse.extrahiert;
  if (analyse.v2) {
    v2 = analyse.v2;
    belegt = v2.angaben.map(() => null);
    if (analyse.seitenTexte.length) {
      const b = belegePruefen(v2, analyse.seitenTexte);
      belegt = b.belegt;
      belegQuote = b.quote;
      v2 = { ...v2, angaben: v2.angaben.map((x, i) => (b.seiteBerichtigt[i] !== undefined ? { ...x, seite: b.seiteBerichtigt[i]! } : x)) };
    }
    gelerntAnalyse = await gelerntLesen(db);
    const z = zuordnen(v2, belegt, gelerntAnalyse);
    warnungen.push(...z.warnungen);
    v0 = z.pruefdaten;
  }

  // Einheitenzeilen und Gesamtwerte (ohne Verteilung) — die Warnungen gehören zur gespeicherten Analyse
  const v = exposeVorbereiten(v0);
  warnungen.push(...v.warnungen);

  const importId = crypto.randomUUID();
  // >>> Fotos aus dem Exposé: in den Eingang, nur die Liste (ohne Bilddaten) in die Analyse
  const fotos = await bilderAblegen(k.speicher, importId, await bilderLauf);
  warnungen.push(...fotos.warnungen);
  // <<< Fotos aus dem Exposé
  const [zeile] = await db.insert(schema.exposeImporte).values({
    id: importId, eingangKey: key, dateiname, schemaVersion: analyse.schemaVersion, promptVersion: analyse.promptVersion, modell: analyse.modell,
    weg: analyse.modus, seitenGelesen: analyse.seitenTexte.length || null, seitenGesamt: analyse.seiten, stopReason: analyse.stopReason,
    inputTokens: analyse.usage.inputTokens, outputTokens: analyse.usage.outputTokens, dauerMs: analyse.dauerMs, kostenEur: analyse.kostenEur,
    status: 'analysiert', rohdaten: v2 ?? v0,
    analyse: { belegt, belegQuote, warnungen, nachfass: analyse.nachfass, wiederholung: analyse.wiederholung, bilder: fotos.liste },
  }).returning({ createdAt: schema.exposeImporte.createdAt });

  const imp = v2 ? { id: importId, datum: zeile!.createdAt, rohdaten: v2, belegt } : null;
  const standard = await kalkStandardLesen(db);

  // Dubletten gegen den aktiven Bestand, neueste zuerst (Reihenfolge wie die alte Liste)
  const objekte = await db.select().from(schema.objekte).where(isNull(schema.objekte.deletedAt)).orderBy(desc(schema.objekte.createdAt));
  const makler = await db.select().from(schema.makler).where(isNull(schema.makler.deletedAt)).orderBy(desc(schema.makler.createdAt));
  const dObj = dublettenObjekt(objekte, v.objekt);
  const dMk = dublettenMakler(makler, v.makler);

  // Keine Exposé-Datei (Investment-Rechnung, Tabelle)? Dann fehlen Fotos und Makler — vorne als Hinweis
  const art = dokumentArtPruefen({ dateiname, seiten: analyse.seiten, bilder: fotos.liste.length, erzeuger: await pdfErzeuger(pdf), maklerGefunden: maklerHatDaten(v.makler) });
  if (art.hinweis) warnungen.unshift(art.hinweis);

  // Hat das erkannte Objekt schon Deals? Dann kann dieses PDF einen davon ergänzen (Fotos, Makler, Exposé) statt einen zweiten anzulegen
  const bestehendeDeals = dObj
    ? (await db.select({ id: schema.deals.id, status: schema.deals.status, makler: schema.makler.name, firma: schema.makler.firma })
      .from(schema.deals).leftJoin(schema.makler, eq(schema.makler.id, schema.deals.maklerId))
      .where(and(eq(schema.deals.objektId, dObj.match.id), isNull(schema.deals.deletedAt))).orderBy(desc(schema.deals.createdAt)))
      .map((d) => ({ id: d.id, status: d.status, makler: [d.makler, d.firma].filter(Boolean).join(' · ') || null }))
    : [];

  return {
    modus: analyse.modus, modell: analyse.modell, seiten: analyse.seiten, zeichenProSeite: analyse.zeichenProSeite,
    ...(analyse.hinweis ? { hinweis: analyse.hinweis } : {}),
    attrappe: k.attrappe,
    extrahiert: v0,
    importId, schemaVersion: analyse.schemaVersion,
    // Leerer Datensatz: auf der Prüfseite gibt es noch nichts Gespeichertes → Status „leer“
    angaben: { objekt: imp ? angabenAusImport(imp, 'objekt', {}, gelerntAnalyse) : [], makler: imp ? angabenAusImport(imp, 'makler', {}, gelerntAnalyse) : [] },
    ziele: { objekt: zieleListe(['objekt', 'kalkulation']), makler: zieleListe(['makler']) },
    belegQuote, warnungen,
    konfidenz: v0?._konfidenz ?? {},
    objekt: v.objekt,
    makler: { ...v.makler, prio: (dMk?.match.prio as 'A' | 'B' | 'C' | null) ?? 'B' },
    deal: { ...v.deal, kalk: wizardKalkVorbelegen(v.deal.kalk, standard) },
    bilder: fotos.liste.map((x, i) => ({ nr: i, seite: x.seite, breite: x.breite, hoehe: x.hoehe, url: `/api/expose/importe/${importId}/bilder/${i}` })),
    bestehendeDeals,
    dubletten: {
      objekt: dObj ? { id: dObj.match.id, titel: [objektTitel(dObj.match), dObj.match.stadt].filter(Boolean).join(', '), sicherheit: dObj.confidence } : null,
      makler: dMk ? { id: dMk.match.id, titel: [dMk.match.name, dMk.match.firma].filter(Boolean).join(' · ') || 'Makler', sicherheit: dMk.confidence } : null,
    },
  };
}

// >>> Fotos aus dem Exposé (Protokoll 30 §4.4, §10): alle gefilterten Bilder automatisch ans Objekt, keine Auswahl
export interface EingangsBild { key: string; seite: number; breite: number; hoehe: number; bytes: number; hash: string }

const bildSchluessel = (importId: string, nr: number) => `${EINGANG}/${importId}/bild-${nr}.jpg`;

async function bilderAblegen(speicher: Dateispeicher, importId: string, lauf: { b: ExposeBild[]; fehler: unknown }) {
  const warnungen: string[] = [];
  const liste: EingangsBild[] = [];
  if (lauf.fehler) {
    console.error('[expose] Fotos nicht herausgelöst:', lauf.fehler);
    warnungen.push('Die Fotos konnten nicht aus dem Exposé herausgelöst werden.');
  }
  const sortiert = [...lauf.b].sort((a, b) => a.seite - b.seite);
  let fehlgeschlagen = 0;
  for (const x of sortiert) {
    const key = bildSchluessel(importId, liste.length);
    try {
      await speicher.ablegen(BUCKETS.pdfs, key, x.bytes, x.mime);
      liste.push({ key, seite: x.seite, breite: x.breite, hoehe: x.hoehe, bytes: x.bytes.byteLength, hash: x.hash });
    } catch (e) {
      console.error('[expose] Foto nicht abgelegt:', e);
      fehlgeschlagen++;
    }
  }
  if (fehlgeschlagen) warnungen.push(`${fehlgeschlagen} Foto(s) konnten nicht zwischengespeichert werden.`);
  return { liste, warnungen };
}

const eingangsBilder = (analyse: unknown): EingangsBild[] => {
  const l = (analyse as { bilder?: unknown } | null)?.bilder;
  return Array.isArray(l) ? l.filter((x): x is EingangsBild => !!x && typeof x.key === 'string' && typeof x.seite === 'number') : [];
};

/** Eingangsbilder eines Imports löschen (nach der Übernahme oder beim Verwerfen). */
async function bilderLoeschen(speicher: Dateispeicher, bilder: EingangsBild[]) {
  if (bilder.length) await speicher.loeschen(BUCKETS.pdfs, bilder.map((x) => x.key)).catch((e) => console.error('[expose] Eingangsbilder nicht gelöscht:', e));
}

/** Ein Eingangsbild eines Imports für die Vorschau auf der Prüfseite. */
export async function exposeBild(db: Db, speicher: Dateispeicher, importId: string, nr: number) {
  const [z] = await db.select({ analyse: schema.exposeImporte.analyse }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, importId));
  const b = z ? eingangsBilder(z.analyse)[nr] : undefined;
  if (!b) throw new FachFehler(404, 'Bild nicht gefunden');
  try {
    return await speicher.holen(BUCKETS.pdfs, b.key);
  } catch {
    throw new FachFehler(404, 'Bild nicht mehr vorhanden');
  }
}

/** Bilder eines Imports ans Objekt hängen. Bei bestehendem Objekt keine Doppelten (gleicher Dateiname und gleiche Größe). Wirft nicht. */
async function bilderUebernehmen(db: Db, speicher: Dateispeicher, objektId: string, bilder: EingangsBild[], warnungen: string[], ausgeschlossen: Set<number> = new Set()): Promise<number> {
  const vorhanden = new Set((await db.select({ n: schema.objektFotos.dateiname, g: schema.objektFotos.groesseBytes }).from(schema.objektFotos).where(eq(schema.objektFotos.objektId, objektId))).map((f) => `${f.n}|${f.g}`));
  let n = 0;
  let fehler = 0;
  for (const [nr, b] of bilder.entries()) {
    if (ausgeschlossen.has(nr)) continue; // im Wizard entfernt
    const dateiname = `Exposé S.${b.seite}-${nr + 1}.jpg`;
    if (vorhanden.has(`${dateiname}|${b.bytes}`)) continue;
    try {
      await fotoHochladen(db, speicher, objektId, await speicher.holen(BUCKETS.pdfs, b.key), dateiname);
      n++;
    } catch (e) {
      console.error('[expose] Foto nicht übernommen:', e);
      fehler++;
    }
  }
  if (fehler) warnungen.push(`${fehler} Foto(s) konnten nicht ans Objekt übernommen werden.`);
  return n;
}
// <<< Fotos aus dem Exposé

/** gg-Ziele für das Dropdown der Prüfseite; Objekt und Kalkulation stehen dort gemeinsam. */
const zieleListe = (arten: ZielArt[]) =>
  Object.entries(GG_ZIELE).filter(([, z]) => arten.includes(z.art)).map(([schluessel, z]) => ({ schluessel, label: z.label, einheit: z.einheit ?? null, pruef: z.pruef ?? null }));

const text = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);
const zahl = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const wertText = (w: unknown) => (typeof w === 'string' ? text(w) : typeof w === 'number' ? String(w) : null);

/**
 * `details` eines neuen Objekts: alle `details`-Ziele aus der Zuordnung (Hausgeld, Provision, Sanierungen …), dazu die
 * Zusatzangaben der Prüfseite wie bisher. Was auf der Prüfseite gesetzt ist, gilt vor dem Wert aus der Zuordnung.
 */
function objektDetails(d: ExposeUebernehmen['objekt']['daten'], ausZuordnung: Record<string, unknown>, importId: string | undefined): Record<string, unknown> {
  const details: Record<string, unknown> = { ...ausZuordnung };
  const pruefseite: Record<string, unknown> = {
    bruttorendite: zahl(d.bruttorendite), heizungsbaujahr: zahl(d.heizungsbaujahr), energieausweis: d.energieausweis ?? null,
    lagebeschreibung: text(d.lagebeschreibung), ausstattung: text(d.ausstattung),
  };
  for (const [k, w] of Object.entries(pruefseite)) {
    const alt = details[k];
    if (k === 'energieausweis' && w && alt && typeof alt === 'object') {
      details[k] = { ...alt, ...Object.fromEntries(Object.entries(w).filter(([, x]) => x !== null && x !== undefined)) };
    } else if (w !== null || alt === undefined) {
      details[k] = w;
    }
  }
  return { ...details, herkunft: 'Exposé-Import', ...(importId ? { importId } : {}) };
}

/** Spalten, die eine manuelle Zuordnung der Prüfseite direkt schreiben darf (alle übrigen Ziele stehen im Formular). */
const ZUORDNUNG_SPALTEN = { objekt: new Set(['sollMiete']), makler: new Set(['strasse', 'plz', 'ort', 'weitereKontakte']) };

interface Zuordnungen {
  objekt: { details: Record<string, unknown>; notizen: string[]; spalten: Record<string, unknown> };
  makler: { spalten: Record<string, unknown>; weitere: WeitereKontakte };
  korrekturen: { art: 'objekt' | 'makler'; feld: string; ziel: string; kiWert: string }[];
}

/**
 * Manuelle Zuordnungen der Prüfseite (`angaben.N` → gg-Ziel oder 'notizen') in Schreibaufträge übersetzen. Ziele mit
 * Prüfseitenfeld (`pruef`) setzt die Oberfläche selbst ins Formular; Kalkulation ebenso. Ungültiges wird übergangen.
 */
function zuordnungenAuswerten(imp: ImportFuerAngaben, liste: ExposeUebernehmen['zuordnungen'], gelernt: Gelernt, details: Record<string, unknown>): Zuordnungen {
  const aus: Zuordnungen = { objekt: { details, notizen: [], spalten: {} }, makler: { spalten: {}, weitere: { namen: [], telefonnummern: [], emails: [] } }, korrekturen: [] };
  if (!liste?.length) return aus;
  const angaben = new Map<string, Angabe>([...angabenAusImport(imp, 'objekt', {}, gelernt), ...angabenAusImport(imp, 'makler', {}, gelernt)].map((a) => [a.feld, a]));
  for (const { feld, ziel } of liste) {
    const a = angaben.get(feld);
    if (!a || !feld.startsWith('angaben.')) continue;
    const z = ziel === 'notizen' ? null : GG_ZIELE[ziel];
    if (ziel !== 'notizen' && (!z || z.pruef || z.art === 'kalkulation')) continue;
    const art = z?.art === 'makler' ? 'makler' : 'objekt';
    const u = uebernahmeWert(a, ziel, art);
    if (!u) continue;
    if (u.notizText !== undefined) aus.objekt.notizen.push(u.notizText);
    else if (u.detailsSchluessel && art === 'objekt') {
      const vorher = detailsLesen(aus.objekt.details, u.detailsSchluessel);
      aus.objekt.details = detailsSetzen(aus.objekt.details, u.detailsSchluessel, u.liste ? listeAnhaengen(vorher, u.wert) : u.wert);
    } else if (u.spalte && ZUORDNUNG_SPALTEN[art].has(u.spalte)) {
      if (u.spalte === 'weitereKontakte') {
        const k = u.wert as WeitereKontakte;
        aus.makler.weitere.namen.push(...k.namen); aus.makler.weitere.telefonnummern.push(...k.telefonnummern); aus.makler.weitere.emails.push(...k.emails);
      } else aus[art].spalten[u.spalte] = u.wert;
    } else continue;
    aus.korrekturen.push({ art, feld, ziel, kiWert: a.wert });
  }
  return aus;
}

/** „Exposé überspringen“: die gespeicherte Analyse gilt als verworfen (nur solange sie nicht übernommen ist). */
export async function importVerwerfen(db: Db, id: string, speicher?: Dateispeicher) {
  const [imp] = await db.select({ status: schema.exposeImporte.status, analyse: schema.exposeImporte.analyse }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, id));
  if (!imp) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
  if (imp.status === 'analysiert') {
    await db.update(schema.exposeImporte).set({ status: 'verworfen', updatedAt: sql`now()` })
      .where(and(eq(schema.exposeImporte.id, id), eq(schema.exposeImporte.status, 'analysiert')));
    // Eingangsbilder werden nicht mehr gebraucht
    if (speicher) await bilderLoeschen(speicher, eingangsBilder(imp.analyse));
  }
  return { id };
}

/**
 * „✅ Deal anlegen“ (ewFinalize): Objekt (neu oder bestehend), Makler (neu mit Ghost-Guard, bestehend mit Telefonregel),
 * Deal-Dublette Objekt+Makler → 409, Deal mit Einheiten und Status-Verlauf; danach PDF an den Deal.
 */
export async function exposeUebernehmen(db: Db, k: ExposeKontext, e: ExposeUebernehmen, heute: string) {
  if (!istEingangsSchluessel(e.key)) throw new FachFehler(422, 'Ungültiger Upload-Schlüssel.');
  const standard = await kalkStandardLesen(db);

  // Gespeicherte Analyse (expose_importe); ohne importId wie bisher das mitgeschickte `extrahiert`
  let imp: (ImportFuerAngaben & { promptVersion: string | null }) | null = null;
  let importBilder: EingangsBild[] = [];
  if (e.importId) {
    const [z] = await db.select().from(schema.exposeImporte).where(eq(schema.exposeImporte.id, e.importId));
    if (!z) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
    importBilder = eingangsBilder(z.analyse);
    if (z.schemaVersion === EXPOSE_V2_SCHEMA) imp = { ...fuerAngaben(z), promptVersion: z.promptVersion };
  }
  const gelernt = await gelerntLesen(db);
  const zuordnung = imp ? zuordnen(imp.rohdaten, imp.belegt, gelernt) : null;
  const v0 = zuordnung ? zuordnung.pruefdaten : e.extrahiert;
  const manuell = imp ? zuordnungenAuswerten(imp, e.zuordnungen, gelernt, objektDetails(e.objekt.daten, zuordnung!.details, e.importId)) : null;

  const ids = await db.transaction(async (tx) => {
    // Doppel-Submit (Protokoll 31, W27): die Import-Zeile wird gesperrt; ist sie nicht mehr „analysiert“, lief die Übernahme schon —
    // sonst entstehen zwei Objekte und zwei Deals (die Deal-Dublettenprüfung greift nur bei gleichem Objekt)
    if (e.importId) {
      const [z] = await tx.select({ status: schema.exposeImporte.status }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, e.importId)).for('update');
      if (!z) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
      if (z.status !== 'analysiert') {
        throw new FachFehler(409, z.status === 'uebernommen' ? 'Dieses Exposé wurde schon übernommen.' : 'Dieses Exposé wurde verworfen — bitte erneut analysieren.', { status: z.status });
      }
    }
    // 1. Objekt
    let objektId: string;
    let objektNeu = false;
    let maklerNeu = false;
    // Ergänzen: das PDF gehört zu einem bestehenden Deal — dessen Objekt, kein neues Objekt, kein neuer Deal
    let ergaenzen: { id: string; maklerId: string | null } | null = null;
    if (e.ergaenzeDealId) {
      const [d] = await tx.select({ id: schema.deals.id, objektId: schema.deals.objektId, maklerId: schema.deals.maklerId }).from(schema.deals)
        .where(and(eq(schema.deals.id, e.ergaenzeDealId), isNull(schema.deals.deletedAt)));
      if (!d) throw new FachFehler(404, 'Der zu ergänzende Deal wurde nicht gefunden');
      ergaenzen = { id: d.id, maklerId: d.maklerId };
      objektId = d.objektId;
    } else if (e.objekt.bestehendeId) {
      const [o] = await tx.select({ id: schema.objekte.id }).from(schema.objekte).where(and(eq(schema.objekte.id, e.objekt.bestehendeId), isNull(schema.objekte.deletedAt)));
      if (!o) throw new FachFehler(404, 'Gewähltes Objekt nicht gefunden');
      objektId = o.id;
    } else {
      const d = e.objekt.daten;
      objektId = crypto.randomUUID();
      await tx.insert(schema.objekte).values({
        id: objektId, strasse: text(d.strasse), hausnr: text(d.hausnr), plz: text(d.plz), stadt: text(d.stadt), bundesland: text(d.bundesland),
        baujahr: zahl(d.baujahr) === null ? null : Math.round(d.baujahr!), einheitenAnzahl: zahl(d.einheitenAnz) === null ? null : Math.round(d.einheitenAnz!),
        wohnflaeche: zahl(d.wohnflaeche), grundstueck: zahl(d.grundstueck), energieklasse: text(d.energieausweis?.klasse), heizung: text(d.heizungsart),
        angebotspreis: zahl(d.angebotspreis), istMiete: zahl(d.istmiete), status: 'In Prüfung', erfasstAm: heute,
        sollMiete: zahl((manuell?.objekt.spalten.sollMiete ?? zuordnung?.werte['objekt.sollmiete']) as number | null),
        notizen: [text(d.notizen), ...(manuell?.objekt.notizen ?? [])].filter(Boolean).join('\n') || null,
        details: manuell ? manuell.objekt.details : objektDetails(d, {}, e.importId),
      });
      objektNeu = true;
      // Zusatz je Einheit nur, wenn die Aufstellung auf der Prüfseite gleich lang geblieben ist (Zuordnung nach Index)
      const einheiten = d.einheiten ?? [];
      const zusatz = zuordnung && zuordnung.einheitenDetails.length === einheiten.length ? zuordnung.einheitenDetails : null;
      for (const [sort, x] of einheiten.entries()) {
        await tx.insert(schema.objektEinheiten).values({
          id: `${objektId}:${crypto.randomUUID()}`, objektId, typ: x.typ || 'Wohnung', lage: text(x.lage), zimmer: zahl(x.zimmer),
          flaeche: zahl(x.flaeche), kaltmiete: zahl(x.kaltmiete), vermietung: text(x.vermiet), sort,
          details: zusatz?.[sort] ?? null,
        });
      }
    }

    // 2. Makler
    let maklerId: string | null = null;
    const m = e.makler.daten;
    const tel = m.tel ? telefonNormalisieren(m.tel) : '';
    if (ergaenzen?.maklerId) {
      maklerId = ergaenzen.maklerId;
    } else if (e.makler.bestehendeId) {
      const [alt] = await tx.select({ id: schema.makler.id, tel: schema.makler.tel }).from(schema.makler).where(and(eq(schema.makler.id, e.makler.bestehendeId), isNull(schema.makler.deletedAt)));
      if (!alt) throw new FachFehler(404, 'Gewählter Makler nicht gefunden');
      maklerId = alt.id;
      if (telefonErsetzen(alt.tel, tel)) {
        await tx.update(schema.makler).set({ tel, updatedAt: sql`now()`, version: sql`${schema.makler.version} + 1` }).where(eq(schema.makler.id, alt.id));
      }
    } else if (maklerHatDaten({ ...m, tel })) {
      maklerId = crypto.randomUUID();
      await tx.insert(schema.makler).values({
        id: maklerId, name: text(m.name), firma: text(m.firma), tel: text(tel), email: text(m.email), webseite: text(m.webseite),
        mobil: text(m.mobiltel ? telefonNormalisieren(m.mobiltel) : ''), festnetz: text(m.festnetztel ? telefonNormalisieren(m.festnetztel) : ''),
        // Anschrift aus der Zuordnung; manuelle Zuordnung nur, wo die Zuordnung nichts gefunden hat
        ...Object.fromEntries((['strasse', 'plz', 'ort'] as const).map((s) => [s, wertText(zuordnung?.werte[`makler.${s}`]) ?? wertText(manuell?.makler.spalten[s])])),
        weitereKontakte: weitereKontakte(
          { name: m.name, tel, mobil: m.mobiltel, festnetz: m.festnetztel, email: m.email },
          {
            namen: [...(m.alleNamen ?? []), ...(manuell?.makler.weitere.namen ?? [])],
            telefonnummern: [...(m.alleTelefonnummern ?? []), ...(manuell?.makler.weitere.telefonnummern ?? [])],
            emails: [...(m.alleEmails ?? []), ...(manuell?.makler.weitere.emails ?? [])],
          }),
        prio: m.prio ?? 'B', kontaktFrequenz: normalisiereFrequenz(m.kontaktFreq || 'Monatlich'),
      });
      maklerNeu = true;
      if (text(m.notizen)) {
        await tx.insert(schema.maklerKommunikation).values({ id: `${maklerId}:${crypto.randomUUID()}`, maklerId, zeitpunkt: sql`now()`, kanal: 'notiz', text: text(m.notizen) });
      }
    }

    if (ergaenzen) {
      // Der Deal hatte keinen Makler: jetzt den aus dem Exposé eintragen (Version zählt hoch wie bei jeder Änderung)
      if (!ergaenzen.maklerId && maklerId) {
        await tx.update(schema.deals).set({ maklerId, updatedAt: sql`now()`, version: sql`${schema.deals.version} + 1` }).where(eq(schema.deals.id, ergaenzen.id));
      }
      if (e.importId) {
        await tx.update(schema.exposeImporte).set({ dealId: ergaenzen.id, objektId, maklerId, status: 'uebernommen', updatedAt: sql`now()` }).where(eq(schema.exposeImporte.id, e.importId));
      }
      if (imp) {
        const alle = new Map([...angabenAusImport(imp, 'objekt', {}, gelernt), ...angabenAusImport(imp, 'makler', {}, gelernt)].map((a) => [a.feld, a]));
        for (const z of e.zuordnungen ?? []) {
          const a = alle.get(z.feld);
          if (a && z.merken !== false && z.feld.startsWith('angaben.') && a.zuordnung !== 'zugeordnet') await lernen(tx, a.bezeichnung, z.ziel);
        }
      }
      return { dealId: ergaenzen.id, objektId, maklerId, ergaenzt: true };
    }

    // 3. Deal-Dublette (gleiches Objekt + gleicher Makler)
    const bestehende = await tx.select({ id: schema.deals.id, objektId: schema.deals.objektId, maklerId: schema.deals.maklerId }).from(schema.deals).where(isNull(schema.deals.deletedAt));
    const dublette = dublettenDeal(bestehende, objektId, maklerId);
    if (dublette) throw new FachFehler(409, 'Deal für dieses Objekt mit diesem Makler ist bereits vorhanden', { dealId: dublette.id });

    // 4. Deal
    const dealId = crypto.randomUUID();
    const einheiten = dealEinheitenAusExpose(e.objekt.daten.einheiten ?? [], standard.rend_k).map((x) => ({ ...x, id: `${dealId}:${crypto.randomUUID()}`, dealId }));
    const kalk = wizardKalkSpeichern(e.deal.kalk, standard);
    const { kennzahlen } = berechneAnkauf(kalk, einheiten.map((x) => einheitAlsEingabe({ ...x, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null })), [], standard);
    await tx.insert(schema.deals).values({
      id: dealId, objektId, maklerId, status: e.deal.status, angebotsDatum: heute, nextContact: heute, nachfassFrequenz: normalisiereFrequenz(e.deal.nachfassFreq),
      notizen: text(e.deal.notizen), kalkulation: { ...kalk, ...kennzahlen }, exposeRohdaten: { ...v0, originalFileName: e.dateiname, ...(e.importId ? { importId: e.importId } : {}) },
    });
    for (const x of einheiten) await tx.insert(schema.dealEinheiten).values(x);
    await tx.insert(schema.dealStatusHistorie).values({ id: crypto.randomUUID(), dealId, vonStatus: null, nachStatus: e.deal.status, quelle: 'wizard' });
    if (e.importId) {
      await tx.update(schema.exposeImporte).set({ dealId, objektId, maklerId, status: 'uebernommen', updatedAt: sql`now()` }).where(eq(schema.exposeImporte.id, e.importId));
    }
    // Manuelle Zuordnungen der Prüfseite: Lerndaten für die Mapping-Tabelle (nur, was tatsächlich geschrieben wurde)
    for (const x of manuell?.korrekturen ?? []) {
      const bezugId = x.art === 'objekt' ? (objektNeu ? objektId : null) : (maklerNeu ? maklerId : null);
      if (!bezugId) continue;
      await tx.insert(schema.importKorrekturen).values({
        id: crypto.randomUUID(), importId: e.importId!, art: x.art, bezugId, feld: x.feld, ziel: x.ziel, kiWert: x.kiWert, handWert: null,
        aktion: 'zugeordnet', konfidenz: null, promptVersion: imp!.promptVersion,
      });
    }
    // Wörterbuch lernt mit: Angaben ohne Mapping, die der Nutzer einem gg-Ziel zugeordnet hat (auch ins Formular; „merken“ = Standard ja)
    if (imp) {
      const alle = new Map([...angabenAusImport(imp, 'objekt', {}, gelernt), ...angabenAusImport(imp, 'makler', {}, gelernt)].map((a) => [a.feld, a]));
      for (const z of e.zuordnungen ?? []) {
        const a = alle.get(z.feld);
        if (a && z.merken !== false && z.feld.startsWith('angaben.') && a.zuordnung !== 'zugeordnet') await lernen(tx, a.bezeichnung, z.ziel);
      }
    }
    return { dealId, objektId, maklerId, ergaenzt: false };
  });

  // 5. Erst das PDF an den Deal, dann die Fotos: online läuft das in der 60-s-Function, und viele Fotos dürfen das Exposé
  // nicht verdrängen — ein Deal ohne Exposé wäre der schlimmere Fehler (Protokoll 31, W26). Der Deal besteht auch, wenn beides scheitert.
  const adresse = [e.objekt.daten.strasse, e.objekt.daten.hausnr].filter(Boolean).join(' ') || 'Objekt';
  const pdf = await pdfAnDenDeal(db, k, e.key, ids, `Exposé_${adresse}.pdf`);
  // Fotos aus dem Exposé ans Objekt (Reihenfolge = Seite), danach Eingangsbilder löschen. Fehler → Warnung.
  const fotoWarnungen: string[] = [];
  const fotos = importBilder.length ? await bilderUebernehmen(db, k.speicher, ids.objektId, importBilder, fotoWarnungen, new Set(e.bilderAusschliessen ?? [])) : 0;
  await bilderLoeschen(k.speicher, importBilder);
  const warnung = [pdf.warnung, ...fotoWarnungen].filter(Boolean).join(' ');
  return { ...ids, pdfGespeichert: pdf.pdfGespeichert, fotos, ...(warnung ? { warnung } : {}) };
}

/** PDF an den Deal: pdfs/<dealId>.pdf und Eintrag im Dokumentenreiter; beim Ergänzen als weiteres Exposé. */
async function pdfAnDenDeal(db: Db, k: ExposeKontext, key: string, ids: { dealId: string; ergaenzt: boolean }, dateiname: string): Promise<{ pdfGespeichert: boolean; warnung?: string }> {
  if (ids.ergaenzt) {
    try {
      const docId = crypto.randomUUID();
      const docKey = dokumentSchluessel(ids.dealId, docId, dateiname);
      await k.speicher.kopieren(BUCKETS.pdfs, key, BUCKETS.dealDocs, docKey);
      const groesse = (await k.speicher.holen(BUCKETS.dealDocs, docKey)).byteLength;
      await db.insert(schema.dealDokumente).values({ id: docId, dealId: ids.dealId, dateiname, mimeType: 'application/pdf', groesseBytes: groesse, label: 'Exposé (Import, ergänzt)', istExpose: true, storageKey: docKey });
      await k.speicher.loeschen(BUCKETS.pdfs, [key]).catch(() => undefined);
      return { pdfGespeichert: true };
    } catch (err) {
      console.error('[expose] PDF-Ergänzung fehlgeschlagen:', err);
      return { pdfGespeichert: false, warnung: 'Deal ergänzt, das Exposé-PDF konnte aber nicht gespeichert werden.' };
    }
  }
  try {
    const zielKey = `${ids.dealId}.pdf`;
    await k.speicher.verschieben(BUCKETS.pdfs, key, zielKey);
    const docId = crypto.randomUUID();
    const docKey = dokumentSchluessel(ids.dealId, docId, dateiname);
    await k.speicher.kopieren(BUCKETS.pdfs, zielKey, BUCKETS.dealDocs, docKey);
    const groesse = (await k.speicher.holen(BUCKETS.dealDocs, docKey)).byteLength;
    await db.insert(schema.dealDokumente).values({ id: docId, dealId: ids.dealId, dateiname, mimeType: 'application/pdf', groesseBytes: groesse, label: 'Exposé (Import)', istExpose: true, storageKey: docKey });
    return { pdfGespeichert: true };
  } catch (err) {
    console.error('[expose] PDF-Übernahme fehlgeschlagen:', err);
    return { pdfGespeichert: false, warnung: 'Deal angelegt, das Exposé-PDF konnte aber nicht gespeichert werden.' };
  }
}

/** Dateinamen bereits importierter Exposés (Badge „bereits importiert“). */
export async function bekannteExposeDateien(db: Db): Promise<string[]> {
  const z = await db.select({ n: sql<string | null>`${schema.deals.exposeRohdaten}->>'originalFileName'` }).from(schema.deals).where(isNull(schema.deals.deletedAt));
  return [...new Set(z.map((x) => x.n?.toLowerCase().replace(/\s+/g, '')).filter((x): x is string => !!x))];
}
