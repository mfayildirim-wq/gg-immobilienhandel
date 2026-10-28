/**
 * Makler-Recherche (21.10.2026): Firmen-Webseite und ImmoScout24-Profil lesen, mit der KI auswerten, als Vorschläge
 * speichern. Übernommen wird nur per Klick (über `maklerAendern`, mit Versionsprüfung).
 *
 * Ablauf eines Laufs: Start legt je Makler ein Ergebnis „wartet“ an. Die geöffnete App ruft `rechercheWeiter` immer
 * wieder auf (Etappen zu drei Maklern, Vercel-Grenze je Aufruf); jeder Aufruf holt sich die nächsten Makler mit
 * `for update skip locked` — zwei offene Fenster arbeiten so nebeneinander, nie doppelt. Bleibt ein Makler hängen
 * (Fenster zu), ist er nach fünf Minuten wieder dran. Schließt niemand die App, läuft er weiter, bis alle durch sind.
 */
import type { RechercheEntscheiden, RechercheErgebnis, RechercheLauf, RechercheMakler, RechercheStandSetzen, RechercheStarten, RechercheVorschlag, RechercheZeile } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  immoscoutProfilAusFirma, istImmoscoutProfil, RECHERCHE_QUELLEN, type RechercheFund, type RechercheQuelle, rechercheKostenSchaetzung, rechercheVorschlaege,
  rechercheWebseite, webseiteAlsUrl,
} from '@gg/domain';
import {
  type Abruf, type GeleseneSeite, immoscoutLesen, type KiAntwort, type KiClient, kostenBuchung, nameGenannt, rechercheAuswerten, rechercheWebsuche,
  WEBSUCHE_USD, webseiteLesen,
} from '@gg/integrations';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { maklerAendern } from './makler.ts';
import { MAKLER_AUFGELOEST, MAKLER_FIRMA, MAKLER_NAME, UNTERNEHMEN_JOIN } from './unternehmen.ts';

export interface RechercheDienste {
  ki: KiClient | null;
  abruf: Abruf;
  /** Pause zwischen zwei Seiten derselben Firma (Tests: 0) */
  pauseMs?: number;
}

const ETAPPE = 3;
const VERWAIST_MIN = 5;
const USD_ZU_EUR = 0.92;
const QUELLE = 'makler-recherche';

const r = schema.maklerRecherche;
const e = schema.rechercheErgebnisse;
const l = schema.rechercheLaeufe;
const m = schema.makler;

const adresse = (url: string | null | undefined, quelle: string | null | undefined) => (url ? { url, quelle: (quelle || 'bekannt') as RechercheQuelle } : null);
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

async function kostenBuchen(db: Db, a: KiAntwort<unknown>, funktion: string, maklerId: string, zusatzEur = 0) {
  const b = kostenBuchung(a.model, a.usage, QUELLE, { maklerId });
  await auditSchreiben(db, { type: b.type, aiModel: b.ai_model, aiFunction: funktion, source: QUELLE, inputTokens: b.input_tokens, outputTokens: b.output_tokens, costEur: +(b.cost_eur + zusatzEur).toFixed(4), metadata: b.metadata });
  return b.cost_eur + zusatzEur;
}

// ── Übersicht und Schätzung ─────────────────────────────────

async function maklerZeilen(db: Db, ids?: string[]) {
  return db.select({
    id: m.id, name: MAKLER_NAME, firma: MAKLER_FIRMA, prio: m.prio, email: m.email,
    bekannt: sql<string | null>`coalesce(${schema.unternehmen.webseite}, ${m.webseite})`,
    stand: r,
  })
    .from(m).leftJoin(schema.unternehmen, UNTERNEHMEN_JOIN).leftJoin(r, eq(r.maklerId, m.id))
    .where(ids ? and(isNull(m.deletedAt), inArray(m.id, ids)) : isNull(m.deletedAt))
    .orderBy(asc(MAKLER_NAME));
}

/** Tabelle: alle Makler mit Webseite (gespeichert, bekannt oder aus der E-Mail), ImmoScout, Status, offenen Vorschlägen. */
export async function rechercheUebersicht(db: Db): Promise<RechercheZeile[]> {
  const zeilen = await maklerZeilen(db);
  const letzte = await db.execute(sql`
    select distinct on (${e.maklerId}) ${e.maklerId} as makler_id, ${e.status} as status, ${e.vorschlaege} as vorschlaege
    from ${e} order by ${e.maklerId}, ${e.createdAt} desc`) as unknown as { makler_id: string; status: string; vorschlaege: RechercheVorschlag[] }[];
  const zuletzt = new Map(letzte.map((x) => [x.makler_id, x]));
  return zeilen.map((z) => {
    const w = rechercheWebseite(z.stand, z.bekannt, z.email);
    const ergebnis = zuletzt.get(z.id);
    return {
      id: z.id, name: z.name, firma: z.firma, prio: z.prio,
      webseite: w,
      immoscout: adresse(z.stand?.immoscoutUrl, z.stand?.immoscoutQuelle),
      personUrl: z.stand?.personUrl ?? null,
      status: ergebnis?.status ?? z.stand?.status ?? null,
      letzteRecherche: z.stand?.letzteRechercheAm ?? null,
      offeneVorschlaege: (ergebnis?.vorschlaege ?? []).filter((v) => !v.entscheidung).length,
      kostenEur: Number(z.stand?.kostenEur ?? 0),
    };
  });
}

export async function rechercheSchaetzung(db: Db, ein: RechercheStarten) {
  const zeilen = await maklerZeilen(db, ein.maklerIds);
  const mitWebseite = zeilen.filter((z) => rechercheWebseite(z.stand, z.bekannt, z.email)).length;
  const ohneWebseite = zeilen.length - mitWebseite;
  return { anzahl: zeilen.length, mitWebseite, ohneWebseite, ...rechercheKostenSchaetzung({ mitWebseite, ohneWebseite }, ein.mitKi) };
}

// ── Lauf ────────────────────────────────────────────────────

async function laufSicht(db: Db, id: string): Promise<RechercheLauf | null> {
  const [lauf] = await db.select().from(l).where(eq(l.id, id));
  if (!lauf) return null;
  const [z] = await db.select({
    erledigt: sql<number>`count(*) filter (where ${e.status} not in ('wartet', 'laeuft'))::int`,
    gefunden: sql<number>`count(*) filter (where ${e.status} = 'gefunden')::int`,
    fehler: sql<number>`count(*) filter (where ${e.status} = 'fehler')::int`,
  }).from(e).where(eq(e.laufId, id));
  return {
    id: lauf.id, status: lauf.status as RechercheLauf['status'], mitKi: lauf.mitKi, anzahl: lauf.anzahl,
    erledigt: z?.erledigt ?? 0, gefunden: z?.gefunden ?? 0, fehler: z?.fehler ?? 0, kostenEur: Number(lauf.kostenEur),
    gestartetAm: lauf.createdAt, beendetAm: lauf.beendetAm, ungesehen: lauf.status !== 'laeuft' && !lauf.gesehenAm,
  };
}

/** Der jüngste Lauf (für Fortschritt und Glocke); keiner: null. */
export async function rechercheLaufAktuell(db: Db): Promise<RechercheLauf | null> {
  const [lauf] = await db.select({ id: l.id }).from(l).orderBy(desc(l.createdAt), desc(l.id)).limit(1);
  return lauf ? laufSicht(db, lauf.id) : null;
}

export async function rechercheStarten(db: Db, ein: RechercheStarten, wer: string | null): Promise<RechercheLauf> {
  const ids = [...new Set(ein.maklerIds)];
  const vorhanden = await db.select({ id: m.id }).from(m).where(and(inArray(m.id, ids), isNull(m.deletedAt)));
  if (!vorhanden.length) throw new FachFehler(400, 'Keine der gewählten Makler gefunden.');
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gg-makler-recherche'))`);
    const [laufend] = await tx.select({ id: l.id }).from(l).where(eq(l.status, 'laeuft')).limit(1);
    if (laufend) throw new FachFehler(409, 'Es läuft schon eine Recherche — erst abwarten oder abbrechen.');
    await tx.insert(l).values({ id, mitKi: ein.mitKi, anzahl: vorhanden.length, gestartetVon: wer });
    await tx.insert(e).values(vorhanden.map((x) => ({ id: crypto.randomUUID(), laufId: id, maklerId: x.id })));
  });
  await auditSchreiben(db, { type: 'recherche', entity: 'recherche_lauf', entityId: id, action: 'start', source: QUELLE, metadata: { anzahl: vorhanden.length, mitKi: ein.mitKi } });
  return (await laufSicht(db, id))!;
}

export async function rechercheAbbrechen(db: Db, id: string) {
  await db.transaction(async (tx) => {
    await tx.update(l).set({ status: 'abgebrochen', beendetAm: sql`now()`, updatedAt: sql`now()` }).where(and(eq(l.id, id), eq(l.status, 'laeuft')));
    await tx.update(e).set({ status: 'abgebrochen', updatedAt: sql`now()` }).where(and(eq(e.laufId, id), eq(e.status, 'wartet')));
  });
  const sicht = await laufSicht(db, id);
  if (!sicht) throw new FachFehler(404, 'Lauf nicht gefunden');
  return sicht;
}

export async function rechercheGesehen(db: Db, id: string) {
  await db.update(l).set({ gesehenAm: sql`now()` }).where(and(eq(l.id, id), isNull(l.gesehenAm)));
  return { ok: true as const };
}

/** Eine Etappe: die nächsten drei Makler. Ist nichts mehr offen, ist der Lauf fertig. */
export async function rechercheWeiter(db: Db, id: string, dienste: RechercheDienste): Promise<RechercheLauf> {
  const [lauf] = await db.select().from(l).where(eq(l.id, id));
  if (!lauf) throw new FachFehler(404, 'Lauf nicht gefunden');
  if (lauf.status === 'laeuft') {
    await db.update(e).set({ status: 'wartet' })
      .where(and(eq(e.laufId, id), eq(e.status, 'laeuft'), sql`${e.begonnenAm} < now() - make_interval(mins => ${VERWAIST_MIN})`));
    const dran = await db.execute(sql`
      update ${e} set status = 'laeuft', begonnen_am = now(), updated_at = now()
      where id in (select id from ${e} where lauf_id = ${id} and status = 'wartet' order by created_at, id limit ${ETAPPE} for update skip locked)
      returning id, makler_id`) as unknown as { id: string; makler_id: string }[];
    const kosten = await Promise.all(dran.map((x) => maklerRecherchieren(db, x.id, x.makler_id, lauf.mitKi, dienste)));
    const summe = kosten.reduce((s, k) => s + k, 0);
    if (summe) await db.update(l).set({ kostenEur: sql`${l.kostenEur} + ${summe}`, updatedAt: sql`now()` }).where(eq(l.id, id));
    const [offen] = await db.select({ n: sql<number>`count(*)::int` }).from(e).where(and(eq(e.laufId, id), inArray(e.status, ['wartet', 'laeuft'])));
    if (!offen?.n) await db.update(l).set({ status: 'fertig', beendetAm: sql`now()`, updatedAt: sql`now()` }).where(and(eq(l.id, id), eq(l.status, 'laeuft')));
  }
  return (await laufSicht(db, id))!;
}

// ── Ein Makler ──────────────────────────────────────────────

type Schritt = { zeit: string; text: string; url?: string };

/** Webseite, ImmoScout, ggf. KI-Websuche, Auswertung → Vorschläge. Gibt die Kosten in Euro zurück; Fehler landen im Ergebnis. */
async function maklerRecherchieren(db: Db, ergebnisId: string, maklerId: string, mitKi: boolean, d: RechercheDienste): Promise<number> {
  const schritte: Schritt[] = [];
  const schritt = (text: string, url?: string) => schritte.push({ zeit: new Date().toISOString(), text, ...(url ? { url } : {}) });
  let kosten = 0;
  try {
    const [mk] = await db.select(MAKLER_AUFGELOEST).from(m).leftJoin(schema.unternehmen, UNTERNEHMEN_JOIN).where(eq(m.id, maklerId));
    if (!mk) throw new Error('Makler nicht gefunden');
    const [stand] = await db.select().from(r).where(eq(r.maklerId, maklerId));
    const [unternehmen] = mk.unternehmenId ? await db.select().from(schema.unternehmen).where(eq(schema.unternehmen.id, mk.unternehmenId)) : [];
    const pause = d.pauseMs ?? 700;
    const quellen: GeleseneSeite[] = [];
    const funde: RechercheFund[] = [];
    const neuerStand: Partial<typeof r.$inferInsert> = {};
    const jetzt = new Date().toISOString();
    let kiFehler: string | null = null;

    const webseiteVersuchen = async (url: string, quelle: RechercheQuelle) => {
      const w = await webseiteLesen(url, d.abruf, pause);
      if (!w.erreichbar) { schritt(`Webseite ${host(url)} (${RECHERCHE_QUELLEN[quelle]}) nicht erreichbar`, url); return false; }
      quellen.push(...w.seiten);
      const pfade = w.seiten.map((s) => new URL(s.url).pathname).join(', ');
      schritt(`Webseite ${host(w.startUrl!)} (${RECHERCHE_QUELLEN[quelle]}) gelesen: ${pfade}${w.gesperrtDurchRobots ? ` — ${w.gesperrtDurchRobots} Seite(n) laut robots.txt ausgelassen` : ''}`, w.startUrl!);
      Object.assign(neuerStand, { webseite: w.startUrl, webseiteQuelle: quelle, webseiteAm: jetzt });
      // Webseite, die wir nicht aus den Stammdaten haben, als Vorschlag fürs Unternehmen
      if (quelle !== 'bekannt') funde.push({ ziel: 'unternehmen', feld: 'webseite', wert: w.startUrl!, quelle: w.startUrl! });
      return true;
    };
    const immoscoutVersuchen = async (url: string, quelle: RechercheQuelle) => {
      const p = await immoscoutLesen(url, d.abruf);
      if (!p) { schritt(`Kein ImmoScout-Profil unter …/${url.split('/').filter(Boolean).pop()} (${RECHERCHE_QUELLEN[quelle]})`, url); return false; }
      quellen.push(p);
      schritt(`ImmoScout-Profil gelesen (${RECHERCHE_QUELLEN[quelle]}): ${p.titel.replace(/ - Immobilienmakler bei ImmoScout24$/i, '')}`, p.url);
      Object.assign(neuerStand, { immoscoutUrl: p.url, immoscoutQuelle: quelle, immoscoutAm: jetzt });
      return true;
    };

    // 1. Webseite: gespeichert, bekannt oder aus der E-Mail-Domain
    const webseite = rechercheWebseite(stand ?? null, mk.webseite, mk.email);
    if (webseite) await webseiteVersuchen(webseite.url, webseite.quelle);
    else schritt('Keine Webseite bekannt und keine Firmen-E-Mail');

    // 2. ImmoScout: gespeichert immer, aus dem Firmennamen nur, wenn die Person auf der Webseite nicht steht
    const personAufWebseite = quellen.some((s) => nameGenannt(s.text, mk.name));
    if (stand?.immoscoutUrl) await immoscoutVersuchen(stand.immoscoutUrl, (stand.immoscoutQuelle as RechercheQuelle) || 'bekannt');
    else if (!personAufWebseite) {
      const ausFirma = immoscoutProfilAusFirma(mk.firma);
      if (ausFirma) await immoscoutVersuchen(ausFirma, 'firmenname');
    }

    // 3. KI-Websuche: nur angehakt und nur, wenn bisher nichts zu lesen war
    if (!quellen.length && mitKi) {
      if (!d.ki) schritt('KI-Websuche übersprungen: keine KI eingerichtet');
      else {
        const s = await rechercheWebsuche(d.ki, { name: mk.name, firma: mk.firma, email: mk.email, ort: mk.ort }).catch((f) => { kiFehler = (f as Error).message; return null; });
        if (!s) schritt(`KI-Websuche fehlgeschlagen: ${kiFehler}`);
        else {
        kosten += await kostenBuchen(db, s, 'websuche', maklerId, s.wert.suchen * WEBSUCHE_USD * USD_ZU_EUR);
        schritt(`KI-Websuche (${s.wert.suchen} Suche${s.wert.suchen === 1 ? '' : 'n'}): ${[s.wert.webseite && `Webseite ${host(s.wert.webseite)}`, s.wert.immoscout && 'ImmoScout-Profil'].filter(Boolean).join(', ') || 'nichts gefunden'}`);
        if (s.wert.webseite && webseiteAlsUrl(s.wert.webseite)) await webseiteVersuchen(webseiteAlsUrl(s.wert.webseite)!, 'ki');
        if (s.wert.immoscout && istImmoscoutProfil(s.wert.immoscout)) await immoscoutVersuchen(s.wert.immoscout, 'ki');
        }
      }
    } else if (!quellen.length) schritt('KI-Websuche nicht angehakt');

    // 4. Auswerten
    let personSeite: string | null = quellen.find((s) => nameGenannt(s.text, mk.name))?.url ?? null;
    if (quellen.length && d.ki) {
      const a = await rechercheAuswerten(d.ki, { name: mk.name, firma: mk.firma, email: mk.email, ort: mk.ort }, quellen).catch((f) => { kiFehler = (f as Error).message; return null; });
      if (!a) schritt(`Auswertung fehlgeschlagen: ${kiFehler} — gefundene Adressen sind gespeichert`);
      else {
        kosten += await kostenBuchen(db, a, 'auswerten', maklerId);
        funde.push(...a.wert.funde);
        personSeite = a.wert.personSeite ?? personSeite;
        schritt(`Ausgewertet: ${a.wert.funde.length} Angabe(n)${personSeite ? `, Person auf ${new URL(personSeite).pathname} genannt` : ', Person nicht genannt'}`, personSeite ?? undefined);
      }
    } else if (quellen.length) schritt('Auswertung übersprungen: keine KI eingerichtet — gefundene Adressen sind gespeichert');

    const verworfen = (await db.select({ v: e.vorschlaege }).from(e).where(eq(e.maklerId, maklerId)))
      .flatMap((x) => (x.v as RechercheVorschlag[]).filter((v) => v.entscheidung === 'verworfen'));
    const vorschlaege = rechercheVorschlaege(mk as unknown as Record<string, unknown>, (unternehmen ?? null) as Record<string, unknown> | null, funde, verworfen);
    // KI ausgefallen (Limit, Netz): gelesen ist gelesen — der Stand wird gespeichert, das Ergebnis zeigt den Fehler
    const status = kiFehler ? 'fehler' : !quellen.length ? 'nichts_gefunden' : personSeite ? 'gefunden' : 'nicht_genannt';
    schritt(`${vorschlaege.length} ${vorschlaege.length === 1 ? 'Vorschlag' : 'Vorschläge'}`);

    await db.transaction(async (tx) => {
      const stand2 = { ...neuerStand, personUrl: personSeite, status, letzteRechercheAm: jetzt };
      await tx.insert(r).values({ maklerId, ...stand2, kostenEur: kosten })
        .onConflictDoUpdate({ target: r.maklerId, set: { ...stand2, kostenEur: sql`${r.kostenEur} + ${kosten}`, updatedAt: sql`now()` } });
      await tx.update(e).set({ status, schritte, vorschlaege, kostenEur: kosten, fehler: kiFehler?.slice(0, 500) ?? null, beendetAm: sql`now()`, updatedAt: sql`now()` }).where(eq(e.id, ergebnisId));
    });
  } catch (fehler) {
    const text = (fehler as Error)?.message ?? String(fehler);
    console.error(`[recherche] Makler ${maklerId}:`, text);
    schritt(`Fehler: ${text}`);
    await db.update(e).set({ status: 'fehler', fehler: text.slice(0, 500), schritte, kostenEur: kosten, beendetAm: sql`now()`, updatedAt: sql`now()` }).where(eq(e.id, ergebnisId));
  }
  return kosten;
}

// ── Je Makler: Stand, Ergebnisse, Entscheidungen ────────────

export async function rechercheMakler(db: Db, maklerId: string): Promise<RechercheMakler> {
  const [mk] = await db.select({ id: m.id, email: m.email, bekannt: sql<string | null>`coalesce(${schema.unternehmen.webseite}, ${m.webseite})` })
    .from(m).leftJoin(schema.unternehmen, UNTERNEHMEN_JOIN).where(and(eq(m.id, maklerId), isNull(m.deletedAt)));
  if (!mk) throw new FachFehler(404, 'Makler nicht gefunden');
  const [stand] = await db.select().from(r).where(eq(r.maklerId, maklerId));
  const ergebnisse = await db.select().from(e).where(eq(e.maklerId, maklerId)).orderBy(desc(e.createdAt), desc(e.id)).limit(5);
  return {
    maklerId, webseite: rechercheWebseite(stand ?? null, mk.bekannt, mk.email), immoscout: adresse(stand?.immoscoutUrl, stand?.immoscoutQuelle),
    personUrl: stand?.personUrl ?? null, status: stand?.status ?? null, letzteRecherche: stand?.letzteRechercheAm ?? null, kostenEur: Number(stand?.kostenEur ?? 0),
    ergebnisse: ergebnisse.map((x): RechercheErgebnis => ({
      id: x.id, laufId: x.laufId, status: x.status, schritte: x.schritte as RechercheErgebnis['schritte'], vorschlaege: x.vorschlaege as RechercheVorschlag[],
      kostenEur: Number(x.kostenEur), beendetAm: x.beendetAm, fehler: x.fehler,
    })),
  };
}

/** Webseite oder ImmoScout-Profil von Hand setzen (Quelle „von Hand“) oder löschen (null). */
export async function rechercheStandSetzen(db: Db, maklerId: string, ein: RechercheStandSetzen) {
  const setzen: Partial<typeof r.$inferInsert> = {};
  if (ein.webseite !== undefined) {
    const url = ein.webseite ? webseiteAlsUrl(ein.webseite) : null;
    if (ein.webseite && !url) throw new FachFehler(400, 'Keine gültige Webseite.');
    Object.assign(setzen, { webseite: url, webseiteQuelle: url ? 'hand' : null, webseiteAm: url ? new Date().toISOString() : null });
  }
  if (ein.immoscoutUrl !== undefined) {
    if (ein.immoscoutUrl && !istImmoscoutProfil(ein.immoscoutUrl)) throw new FachFehler(400, 'Keine ImmoScout24-Profiladresse (https://www.immobilienscout24.de/anbieter/profil/…).');
    Object.assign(setzen, { immoscoutUrl: ein.immoscoutUrl || null, immoscoutQuelle: ein.immoscoutUrl ? 'hand' : null, immoscoutAm: ein.immoscoutUrl ? new Date().toISOString() : null });
  }
  await db.insert(r).values({ maklerId, ...setzen }).onConflictDoUpdate({ target: r.maklerId, set: { ...setzen, updatedAt: sql`now()` } });
  return rechercheMakler(db, maklerId);
}

/** Vorschläge in die Stammdaten: Makler- und Firmenfelder über `maklerAendern`, Zentrale direkt am Unternehmen. */
async function vorschlaegeAnwenden(db: Db, maklerId: string, liste: RechercheVorschlag[]) {
  if (!liste.length) return;
  const [mk] = await db.select({ version: m.version, unternehmenId: m.unternehmenId }).from(m).where(and(eq(m.id, maklerId), isNull(m.deletedAt)));
  if (!mk) throw new FachFehler(404, 'Makler nicht gefunden');
  const zentrale = liste.filter((v) => v.ziel === 'unternehmen' && ['telefonZentrale', 'emailZentrale'].includes(v.feld));
  const felder = Object.fromEntries(liste.filter((v) => !zentrale.includes(v)).map((v) => [v.feld, v.neu]));
  if (Object.keys(felder).length) await maklerAendern(db, maklerId, { version: mk.version, ...felder });
  if (zentrale.length && mk.unternehmenId) {
    await db.update(schema.unternehmen).set({ ...Object.fromEntries(zentrale.map((v) => [v.feld, v.neu])), version: sql`${schema.unternehmen.version} + 1`, updatedAt: sql`now()` })
      .where(eq(schema.unternehmen.id, mk.unternehmenId));
  }
  await auditSchreiben(db, { type: 'recherche', entity: 'makler', entityId: maklerId, action: 'uebernehmen', source: QUELLE, metadata: { felder: liste.map((v) => ({ ziel: v.ziel, feld: v.feld, neu: v.neu, quelle: v.quelle })) } });
}

async function entscheidungSpeichern(db: Db, ergebnisId: string, vorschlaege: RechercheVorschlag[]) {
  await db.update(e).set({ vorschlaege, updatedAt: sql`now()` }).where(eq(e.id, ergebnisId));
}

/** Ein Vorschlag: übernehmen oder verwerfen. */
export async function rechercheEntscheiden(db: Db, ein: RechercheEntscheiden) {
  const [x] = await db.select().from(e).where(eq(e.id, ein.ergebnisId));
  const liste = (x?.vorschlaege ?? []) as RechercheVorschlag[];
  const v = liste[ein.index];
  if (!x || !v) throw new FachFehler(404, 'Vorschlag nicht gefunden');
  if (v.entscheidung) throw new FachFehler(409, 'Über diesen Vorschlag ist schon entschieden.');
  if (ein.entscheidung === 'uebernommen' && !ein.ohneAnwenden) await vorschlaegeAnwenden(db, x.maklerId, [v]);
  liste[ein.index] = { ...v, entscheidung: ein.entscheidung, entschiedenAm: new Date().toISOString() };
  await entscheidungSpeichern(db, x.id, liste);
  return rechercheMakler(db, x.maklerId);
}

/** Alle offenen Vorschläge der gewählten Makler übernehmen (je Makler das jüngste Ergebnis). */
export async function rechercheAlleUebernehmen(db: Db, maklerIds: string[]) {
  let uebernommen = 0;
  const fehler: string[] = [];
  for (const maklerId of [...new Set(maklerIds)]) {
    const [x] = await db.select().from(e).where(eq(e.maklerId, maklerId)).orderBy(desc(e.createdAt), desc(e.id)).limit(1);
    const liste = (x?.vorschlaege ?? []) as RechercheVorschlag[];
    const offen = liste.filter((v) => !v.entscheidung);
    if (!x || !offen.length) continue;
    try {
      await vorschlaegeAnwenden(db, maklerId, offen);
      const jetzt = new Date().toISOString();
      await entscheidungSpeichern(db, x.id, liste.map((v) => (v.entscheidung ? v : { ...v, entscheidung: 'uebernommen' as const, entschiedenAm: jetzt })));
      uebernommen += offen.length;
    } catch (f) {
      fehler.push(`${maklerId}: ${(f as Error).message}`);
    }
  }
  return { uebernommen, fehler };
}
