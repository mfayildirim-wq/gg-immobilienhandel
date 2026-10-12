import type { ExposeAnalyseAntwort, ExposeUebernehmen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  type Angabe, angabenAusImport, belegePruefen, berechneAnkauf, dealEinheitenAusExpose, dublettenDeal, dublettenMakler, dublettenObjekt, einheitAlsEingabe,
  EXPOSE_V2_SCHEMA, type ExposeV2, exposeVorbereiten, GG_ZIELE, type ImportFuerAngaben, maklerHatDaten, normalisiereFrequenz, telefonErsetzen,
  telefonNormalisieren, uebernahmeWert, type WeitereKontakte, weitereKontakte, wizardKalkSpeichern, wizardKalkVorbelegen, type ZielArt, zuordnen,
} from '@gg/domain';
import {
  analysiereExpose, BUCKETS, type Dateispeicher, dokumentSchluessel, EINGANG, istEingangsSchluessel, istPdf, type KiClient, kostenBuchung, pdfDokument, pdfText,
  tesseractOcr,
} from '@gg/integrations';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';
import { exposeExtraktionLesen, kalkStandardLesen } from './einstellungen.ts';
import { detailsLesen, detailsSetzen, fuerAngaben, listeAnhaengen } from './exposeAngaben.ts';
import { objektTitel } from './objekte.ts';

export interface ExposeKontext {
  speicher: Dateispeicher;
  ki: KiClient | null;
  attrappe: boolean;
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

  const einstellung = await exposeExtraktionLesen(db);
  // Rohdaten ohne KI: Textlayer + Texterkennung der Bild-Seiten (Protokoll 30, P1); der OCR-Worker lebt nur für diese Analyse
  const texterkennung = tesseractOcr();
  const analyse = await analysiereExpose(pdf, dateiname, {
    ki: k.ki,
    pdfText: (b) => pdfText(Buffer.from(b)),
    dokument: (b) => pdfDokument(b, { ocr: texterkennung.ocr }),
    buchen: (model, usage, quelle) => kostenBuchen(db, model, usage, quelle),
  }, { schema: einstellung.schema, kostenGrenzeEur: einstellung.kostenGrenzeEur }).finally(() => texterkennung.beenden());

  // v2: Werte gegen die Seitentexte prüfen (nur der Textweg hat Seitentexte), falsche Seiten berichtigen,
  // dann per Mapping-Tabelle ins Format der Prüfseite
  let v2: ExposeV2 | null = null;
  let belegt: (boolean | null)[] = [];
  let belegQuote: number | null = null;
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
    const z = zuordnen(v2, belegt);
    warnungen.push(...z.warnungen);
    v0 = z.pruefdaten;
  }

  const importId = crypto.randomUUID();
  const [zeile] = await db.insert(schema.exposeImporte).values({
    id: importId, eingangKey: key, dateiname, schemaVersion: analyse.schemaVersion, promptVersion: analyse.promptVersion, modell: analyse.modell,
    weg: analyse.modus, seitenGelesen: analyse.seitenTexte.length || null, seitenGesamt: analyse.seiten, stopReason: analyse.stopReason,
    inputTokens: analyse.usage.inputTokens, outputTokens: analyse.usage.outputTokens, dauerMs: analyse.dauerMs, kostenEur: analyse.kostenEur,
    status: 'analysiert', rohdaten: v2 ?? v0,
    analyse: { belegt, belegQuote, warnungen, nachfass: analyse.nachfass, wiederholung: analyse.wiederholung },
  }).returning({ createdAt: schema.exposeImporte.createdAt });

  const imp = v2 ? { id: importId, datum: zeile!.createdAt, rohdaten: v2, belegt } : null;
  const v = exposeVorbereiten(v0);
  const standard = await kalkStandardLesen(db);

  // Dubletten gegen den aktiven Bestand, neueste zuerst (Reihenfolge wie die alte Liste)
  const objekte = await db.select().from(schema.objekte).where(isNull(schema.objekte.deletedAt)).orderBy(desc(schema.objekte.createdAt));
  const makler = await db.select().from(schema.makler).where(isNull(schema.makler.deletedAt)).orderBy(desc(schema.makler.createdAt));
  const dObj = dublettenObjekt(objekte, v.objekt);
  const dMk = dublettenMakler(makler, v.makler);

  return {
    modus: analyse.modus, modell: analyse.modell, seiten: analyse.seiten, zeichenProSeite: analyse.zeichenProSeite,
    ...(analyse.hinweis ? { hinweis: analyse.hinweis } : {}),
    attrappe: k.attrappe,
    extrahiert: v0,
    importId, schemaVersion: analyse.schemaVersion,
    // Leerer Datensatz: auf der Prüfseite gibt es noch nichts Gespeichertes → Status „leer“
    angaben: { objekt: imp ? angabenAusImport(imp, 'objekt', {}) : [], makler: imp ? angabenAusImport(imp, 'makler', {}) : [] },
    ziele: { objekt: zieleListe(['objekt', 'kalkulation']), makler: zieleListe(['makler']) },
    belegQuote, warnungen,
    konfidenz: v0?._konfidenz ?? {},
    objekt: v.objekt,
    makler: { ...v.makler, prio: (dMk?.match.prio as 'A' | 'B' | 'C' | null) ?? 'B' },
    deal: { ...v.deal, kalk: wizardKalkVorbelegen(v.deal.kalk, standard) },
    dubletten: {
      objekt: dObj ? { id: dObj.match.id, titel: [objektTitel(dObj.match), dObj.match.stadt].filter(Boolean).join(', '), sicherheit: dObj.confidence } : null,
      makler: dMk ? { id: dMk.match.id, titel: [dMk.match.name, dMk.match.firma].filter(Boolean).join(' · ') || 'Makler', sicherheit: dMk.confidence } : null,
    },
  };
}

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
function zuordnungenAuswerten(imp: ImportFuerAngaben, liste: ExposeUebernehmen['zuordnungen'], details: Record<string, unknown>): Zuordnungen {
  const aus: Zuordnungen = { objekt: { details, notizen: [], spalten: {} }, makler: { spalten: {}, weitere: { namen: [], telefonnummern: [], emails: [] } }, korrekturen: [] };
  if (!liste?.length) return aus;
  const angaben = new Map<string, Angabe>([...angabenAusImport(imp, 'objekt', {}), ...angabenAusImport(imp, 'makler', {})].map((a) => [a.feld, a]));
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
export async function importVerwerfen(db: Db, id: string) {
  const [imp] = await db.select({ status: schema.exposeImporte.status }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, id));
  if (!imp) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
  if (imp.status === 'analysiert') {
    await db.update(schema.exposeImporte).set({ status: 'verworfen', updatedAt: sql`now()` })
      .where(and(eq(schema.exposeImporte.id, id), eq(schema.exposeImporte.status, 'analysiert')));
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
  if (e.importId) {
    const [z] = await db.select().from(schema.exposeImporte).where(eq(schema.exposeImporte.id, e.importId));
    if (!z) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
    if (z.schemaVersion === EXPOSE_V2_SCHEMA) imp = { ...fuerAngaben(z), promptVersion: z.promptVersion };
  }
  const zuordnung = imp ? zuordnen(imp.rohdaten, imp.belegt) : null;
  const v0 = zuordnung ? zuordnung.pruefdaten : e.extrahiert;
  const manuell = imp ? zuordnungenAuswerten(imp, e.zuordnungen, objektDetails(e.objekt.daten, zuordnung!.details, e.importId)) : null;

  const ids = await db.transaction(async (tx) => {
    // 1. Objekt
    let objektId: string;
    let objektNeu = false;
    let maklerNeu = false;
    if (e.objekt.bestehendeId) {
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
    if (e.makler.bestehendeId) {
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
      id: dealId, objektId, maklerId, status: e.deal.status, angebotsDatum: heute, nachfassFrequenz: normalisiereFrequenz(e.deal.nachfassFreq),
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
    return { dealId, objektId, maklerId };
  });

  // 5. PDF an den Deal: pdfs/<dealId>.pdf und Eintrag im Dokumentenreiter. Der Deal besteht auch, wenn das scheitert.
  const adresse = [e.objekt.daten.strasse, e.objekt.daten.hausnr].filter(Boolean).join(' ') || 'Objekt';
  const dateiname = `Exposé_${adresse}.pdf`;
  try {
    const zielKey = `${ids.dealId}.pdf`;
    await k.speicher.verschieben(BUCKETS.pdfs, e.key, zielKey);
    const docId = crypto.randomUUID();
    const docKey = dokumentSchluessel(ids.dealId, docId, dateiname);
    await k.speicher.kopieren(BUCKETS.pdfs, zielKey, BUCKETS.dealDocs, docKey);
    const groesse = (await k.speicher.holen(BUCKETS.dealDocs, docKey)).byteLength;
    await db.insert(schema.dealDokumente).values({ id: docId, dealId: ids.dealId, dateiname, mimeType: 'application/pdf', groesseBytes: groesse, label: 'Exposé (Import)', istExpose: true, storageKey: docKey });
    return { ...ids, pdfGespeichert: true };
  } catch (err) {
    console.error('[expose] PDF-Übernahme fehlgeschlagen:', err);
    return { ...ids, pdfGespeichert: false, warnung: 'Deal angelegt, das Exposé-PDF konnte aber nicht gespeichert werden.' };
  }
}

/** Dateinamen bereits importierter Exposés (Badge „bereits importiert“). */
export async function bekannteExposeDateien(db: Db): Promise<string[]> {
  const z = await db.select({ n: sql<string | null>`${schema.deals.exposeRohdaten}->>'originalFileName'` }).from(schema.deals).where(isNull(schema.deals.deletedAt));
  return [...new Set(z.map((x) => x.n?.toLowerCase().replace(/\s+/g, '')).filter((x): x is string => !!x))];
}
