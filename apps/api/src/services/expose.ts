import type { ExposeAnalyseAntwort, ExposeUebernehmen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  berechneAnkauf, dealEinheitenAusExpose, dublettenDeal, dublettenMakler, dublettenObjekt, exposeVorbereiten, einheitAlsEingabe,
  maklerHatDaten, normalisiereFrequenz, telefonErsetzen, telefonNormalisieren, weitereKontakte, wizardKalkSpeichern, wizardKalkVorbelegen,
} from '@gg/domain';
import {
  analysiereExpose, BUCKETS, type Dateispeicher, EINGANG, istEingangsSchluessel, istPdf, type KiClient, kostenBuchung, pdfText, type SharepointAblage,
} from '@gg/integrations';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';
import { kalkStandardLesen } from './einstellungen.ts';
import { objektTitel } from './objekte.ts';
import { dokumenteHochladen } from './dateien.ts';

export interface ExposeKontext {
  speicher: Dateispeicher;
  ki: KiClient | null;
  attrappe: boolean;
  /** SharePoint als Ablage des Exposé-Dokuments, wenn eingerichtet */
  sharepoint?: SharepointAblage | null;
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

  const analyse = await analysiereExpose(pdf, dateiname, {
    ki: k.ki,
    pdfText: (b) => pdfText(Buffer.from(b)),
    buchen: (model, usage, quelle) => kostenBuchen(db, model, usage, quelle),
  });
  const v = exposeVorbereiten(analyse.extrahiert);
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
    extrahiert: analyse.extrahiert,
    konfidenz: analyse.extrahiert?._konfidenz ?? {},
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
 * „✅ Deal anlegen“ (ewFinalize): Objekt (neu oder bestehend), Makler (neu mit Ghost-Guard, bestehend mit Telefonregel),
 * Deal-Dublette Objekt+Makler → 409, Deal mit Einheiten und Status-Verlauf; danach PDF an den Deal.
 */
export async function exposeUebernehmen(db: Db, k: ExposeKontext, e: ExposeUebernehmen, heute: string) {
  if (!istEingangsSchluessel(e.key)) throw new FachFehler(422, 'Ungültiger Upload-Schlüssel.');
  const standard = await kalkStandardLesen(db);

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
        details: {
          bruttorendite: zahl(d.bruttorendite), heizungsbaujahr: zahl(d.heizungsbaujahr), energieausweis: d.energieausweis ?? null,
          lagebeschreibung: text(d.lagebeschreibung), ausstattung: text(d.ausstattung), herkunft: 'Exposé-Import',
        },
      });
      for (const [sort, x] of (d.einheiten ?? []).entries()) {
        await tx.insert(schema.objektEinheiten).values({
          id: `${objektId}:${crypto.randomUUID()}`, objektId, typ: x.typ || 'Wohnung', lage: text(x.lage), zimmer: zahl(x.zimmer),
          flaeche: zahl(x.flaeche), kaltmiete: zahl(x.kaltmiete), vermietung: text(x.vermiet), sort,
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
      notizen: text(e.deal.notizen), kalkulation: { ...kalk, ...kennzahlen }, exposeRohdaten: { ...e.extrahiert, originalFileName: e.dateiname },
    });
    for (const x of einheiten) await tx.insert(schema.dealEinheiten).values(x);
    await tx.insert(schema.dealStatusHistorie).values({ id: crypto.randomUUID(), dealId, vonStatus: null, nachStatus: e.deal.status, quelle: 'wizard' });
    return { dealId, objektId, maklerId };
  });

  // 5. PDF an den Deal: Eintrag im Dokumentenreiter — nach SharePoint, wenn eingerichtet, sonst deal-docs (Protokoll 19);
  //    dazu wie bisher pdfs/<dealId>.pdf. Der Deal besteht auch, wenn das scheitert.
  const adresse = [e.objekt.daten.strasse, e.objekt.daten.hausnr].filter(Boolean).join(' ') || 'Objekt';
  const dateiname = `Exposé_${adresse}.pdf`;
  try {
    const zielKey = `${ids.dealId}.pdf`;
    await k.speicher.verschieben(BUCKETS.pdfs, e.key, zielKey);
    const bytes = await k.speicher.holen(BUCKETS.pdfs, zielKey);
    await dokumenteHochladen({ db, speicher: k.speicher, sharepoint: k.sharepoint }, { art: 'deal', id: ids.dealId }, [{ name: dateiname, typ: 'application/pdf', bytes }], { istExpose: true, label: 'Exposé (Import)' });
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
