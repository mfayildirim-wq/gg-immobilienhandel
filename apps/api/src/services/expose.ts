import type { ExposeAnalyseAntwort, ExposeUebernehmen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  belegePruefen, berechneAnkauf, dealEinheitenAusExpose, einheitenDetails, EXPOSE_V1_SCHEMA, type ExposeV1, kernfeldDopplung, v1AlsV0, dublettenDeal, dublettenMakler, dublettenObjekt, exposeVorbereiten, einheitAlsEingabe,
  maklerHatDaten, normalisiereFrequenz, telefonErsetzen, telefonNormalisieren, weitereKontakte, wizardKalkSpeichern, wizardKalkVorbelegen,
} from '@gg/domain';
import {
  analysiereExpose, BUCKETS, type Dateispeicher, dokumentSchluessel, EINGANG, istEingangsSchluessel, istPdf, type KiClient, kostenBuchung, pdfText,
} from '@gg/integrations';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';
import { exposeExtraktionLesen, kalkStandardLesen } from './einstellungen.ts';
import { objektDetailsAusV1 } from './exposeAngaben.ts';
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
  const analyse = await analysiereExpose(pdf, dateiname, {
    ki: k.ki,
    pdfText: (b) => pdfText(Buffer.from(b)),
    buchen: (model, usage, quelle) => kostenBuchen(db, model, usage, quelle),
  }, { schema: einstellung.schema, kostenGrenzeEur: einstellung.kostenGrenzeEur });

  // v1: Belege gegen die Seitentexte prüfen (nur auf dem Textweg gibt es Seitentexte), dann ins Format der Prüfseite
  let v1: ExposeV1 | null = null;
  let belegt: Record<string, boolean> = {};
  const warnungen = [...analyse.warnungen];
  let v0: any = analyse.extrahiert;
  if (analyse.v1) {
    if (analyse.seitenTexte.length) ({ belegt, v1 } = belegePruefen(analyse.v1, analyse.seitenTexte));
    else v1 = analyse.v1;
    warnungen.push(...kernfeldDopplung(v1));
    v0 = v1AlsV0(v1);
  }

  const importId = crypto.randomUUID();
  await db.insert(schema.exposeImporte).values({
    id: importId, eingangKey: key, dateiname, schemaVersion: analyse.schemaVersion, promptVersion: analyse.promptVersion, modell: analyse.modell,
    weg: analyse.modus, seitenGelesen: analyse.seitenTexte.length || null, seitenGesamt: analyse.seiten, stopReason: analyse.stopReason,
    inputTokens: analyse.usage.inputTokens, outputTokens: analyse.usage.outputTokens, dauerMs: analyse.dauerMs, kostenEur: analyse.kostenEur,
    status: 'analysiert', rohdaten: v1 ?? v0,
    analyse: { nachfass: analyse.nachfass, wiederholung: analyse.wiederholung, belegt, warnungen },
  });

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
    importId, schemaVersion: analyse.schemaVersion, v1, weitereAngaben: v1?.weitere_angaben ?? [], belegt, warnungen,
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

const text = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);
const zahl = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * `details` eines neuen Objekts: die Zusatzangaben der Prüfseite wie bisher, dazu alle `details`-Ziele aus v1
 * (Hausgeld, Provision, Denkmalschutz …). Was auf der Prüfseite gesetzt ist, gilt vor dem v1-Wert.
 */
function objektDetails(d: ExposeUebernehmen['objekt']['daten'], v1: ExposeV1 | null, importId: string | undefined): Record<string, unknown> {
  const details: Record<string, unknown> = v1 ? objektDetailsAusV1(importId ?? '', v1) : {};
  const pruefseite: Record<string, unknown> = {
    bruttorendite: zahl(d.bruttorendite), heizungsbaujahr: zahl(d.heizungsbaujahr), energieausweis: d.energieausweis ?? null,
    lagebeschreibung: text(d.lagebeschreibung), ausstattung: text(d.ausstattung),
  };
  for (const [k, w] of Object.entries(pruefseite)) {
    const v1Wert = details[k];
    if (k === 'energieausweis' && w && v1Wert && typeof v1Wert === 'object') {
      details[k] = { ...v1Wert, ...Object.fromEntries(Object.entries(w).filter(([, x]) => x !== null && x !== undefined)) };
    } else if (w !== null || v1Wert === undefined) {
      details[k] = w;
    }
  }
  return { ...details, herkunft: 'Exposé-Import', ...(importId ? { importId } : {}) };
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
  let v1: ExposeV1 | null = null;
  if (e.importId) {
    const [imp] = await db.select({ schemaVersion: schema.exposeImporte.schemaVersion, rohdaten: schema.exposeImporte.rohdaten })
      .from(schema.exposeImporte).where(eq(schema.exposeImporte.id, e.importId));
    if (!imp) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
    if (imp.schemaVersion === EXPOSE_V1_SCHEMA) v1 = imp.rohdaten as ExposeV1;
  }
  const v0 = v1 ? v1AlsV0(v1) : e.extrahiert;

  const ids = await db.transaction(async (tx) => {
    // 1. Objekt
    let objektId: string;
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
        angebotspreis: zahl(d.angebotspreis), istMiete: zahl(d.istmiete), status: 'In Prüfung', notizen: text(d.notizen), erfasstAm: heute,
        details: objektDetails(d, v1, e.importId),
      });
      // Zusatz je Einheit aus v1 nur, wenn die Aufstellung auf der Prüfseite gleich lang geblieben ist (Zuordnung nach Index)
      const einheiten = d.einheiten ?? [];
      const v1Einheiten = v1 && v1.einheiten.length === einheiten.length ? v1.einheiten : null;
      for (const [sort, x] of einheiten.entries()) {
        await tx.insert(schema.objektEinheiten).values({
          id: `${objektId}:${crypto.randomUUID()}`, objektId, typ: x.typ || 'Wohnung', lage: text(x.lage), zimmer: zahl(x.zimmer),
          flaeche: zahl(x.flaeche), kaltmiete: zahl(x.kaltmiete), vermietung: text(x.vermiet), sort,
          details: v1Einheiten ? einheitenDetails(v1Einheiten[sort]!) : null,
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
        weitereKontakte: weitereKontakte(
          { name: m.name, tel, mobil: m.mobiltel, festnetz: m.festnetztel, email: m.email },
          { namen: m.alleNamen, telefonnummern: m.alleTelefonnummern, emails: m.alleEmails }),
        prio: m.prio ?? 'B', kontaktFrequenz: normalisiereFrequenz(m.kontaktFreq || 'Monatlich'),
      });
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
