/**
 * Auto-Import: aus einer Angebots-Mail selbstständig das Exposé holen (alt: server/routes-auto-import.ts,
 * server/auto-import-laeufe.ts). Die Engine selbst steht in `@gg/integrations` und kennt weder Datenbank noch Postfach.
 *
 * Was der Neubau anders macht als die alte App:
 *  • **Der Lauf gehört zur Anfrage.** Die alte App antwortete sofort und arbeitete „nach der Antwort" weiter; das
 *    Ergebnis lag im Arbeitsspeicher der Instanz, weshalb Statusabfragen dieselbe Instanz treffen mussten. Hier läuft
 *    die Engine in der Anfrage der lang laufenden Function, das Ergebnis steht in der Tabelle — jede Instanz kann es lesen.
 *  • **Das Ergebnis-PDF landet im Exposé-Eingang** (`pdfs/_eingang/<uuid>`), genau dort, wo auch ein Upload von Hand
 *    landet. Der Import-Assistent macht ohne Sonderweg weiter. Stand das Angebot nur im Mailtext, wird die Mail selbst
 *    zum Beleg-PDF.
 *  • **Duplikatschutz auf dem Server**: erfolgreich verarbeitete Mails stehen in der Lauf-Tabelle, dazu die umgezogene
 *    Liste der alten App (`angebote-importierte-uids`). Die alte App führte sie im Browser.
 */
import { type Db, schema } from '@gg/db';
import { OUTWARD_ACTIONS } from '@gg/domain';
import { autoImportFromMail, BUCKETS, type Dateispeicher, EINGANG, type GraphClient, type ImportResult, type KiClient, klemmeZeitlimit } from '@gg/integrations';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Browser } from 'playwright-core';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { outwardPruefen } from './outward.ts';

async function einstellung<T>(db: Db, schluessel: string, standard: T): Promise<T> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, schluessel));
  return (z?.wert as T | undefined) ?? standard;
}

export const MAX_PARALLELE_LAEUFE = 3;
/** Ab wann ein Lauf als abgestürzt gilt — großzügig über dem Zeitlimit, damit ein langsamer, lebender Lauf nie eingesammelt
 *  wird. Ohne diese Grenze bliebe nach jedem Function-Abbruch eine Zeile auf `running`, und der dritte Absturz sperrte den Auto-Import. */
const LAUF_VERWAIST_SEK = 900;
/** Projektfeste Lock-ID (die des Audit-Logs ist 776_155_001). */
const LAUF_SPERRE = 776_155_002;
export const ZEITLIMIT_SCHLUESSEL = 'auto-import-zeitlimit-sek';
export const ALT_IMPORTIERT_SCHLUESSEL = 'angebote-importierte-uids';

export interface AutoImportKontext {
  speicher: Dateispeicher;
  ki: KiClient | null;
  graph: GraphClient;
  /** Ordner des Posteingangs (Einstellungen → Microsoft 365) */
  ordner?: string;
  browserStarten: () => Promise<Browser>;
  /** Online begrenzt die Function die Laufzeit; das Zeitlimit der Engine muss darunter liegen. */
  maxZeitlimitSek?: number;
  /** nur Tests: Testseiten auf localhost */
  lokaleZieleErlaubt?: boolean;
}

/** Belegt einen der drei Plätze und legt die Zeile an. Prüfen und Eintragen in EINER Transaktion mit Advisory Lock:
 *  sonst sähen zwei gleichzeitige Anfragen beide „zwei aktiv", und es liefen vier. */
async function platzBelegen(db: Db, o: { runId: string; mailUid: string; von: string; betreff: string }): Promise<boolean> {
  const jetzt = Math.floor(Date.now() / 1000);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LAUF_SPERRE})`);
    await tx.update(schema.autoImportRuns)
      .set({ status: 'failed', finishedAt: jetzt, errorMessage: 'Lauf ohne Ergebnis beendet — Zeitlimit oder Absturz der Function.' })
      .where(and(inArray(schema.autoImportRuns.status, ['running', 'aborting']), sql`${schema.autoImportRuns.startedAt} < ${jetzt - LAUF_VERWAIST_SEK}`));
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.autoImportRuns).where(inArray(schema.autoImportRuns.status, ['running', 'aborting'])) as [{ n: number }];
    if (n >= MAX_PARALLELE_LAEUFE) return false;
    await tx.insert(schema.autoImportRuns).values({ id: o.runId, startedAt: jetzt, mailUid: o.mailUid, mailFrom: o.von, mailSubject: o.betreff, status: 'running' });
    return true;
  });
}

// Helvetica kennt nur WinAnsi — alles andere (Emojis, Sonderzeichen) würde das Anlegen des PDFs werfen
const winAnsi = (s: string) => s.replace(/[^\x20-\x7E -ÿ€„“”‚‘’–—…\n]/g, ' ');

/** R11 — der Mailtext IST das Angebot: dann wird die Mail selbst zum Beleg, der im Eingang liegt wie jedes Exposé. */
export async function mailAlsPdf(mail: { von: string; betreff: string; datum: string; text: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const schrift = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const [breite, hoehe, rand, groesse, abstand] = [595, 842, 50, 10, 14];
  const zeilen: { text: string; fett?: boolean }[] = [
    { text: winAnsi(mail.betreff).slice(0, 90), fett: true }, { text: `Von: ${winAnsi(mail.von)} · ${mail.datum.slice(0, 10)}` },
    { text: 'Angebot aus dem Text dieser E-Mail (kein Exposé-Dokument).' }, { text: '' },
  ];
  for (const absatz of winAnsi(mail.text).split('\n')) {
    let rest = absatz.trimEnd();
    if (!rest) { zeilen.push({ text: '' }); continue; }
    while (rest) {
      let schnitt = rest.length;
      while (schnitt > 1 && schrift.widthOfTextAtSize(rest.slice(0, schnitt), groesse) > breite - 2 * rand) schnitt = rest.lastIndexOf(' ', schnitt - 1) > 0 ? rest.lastIndexOf(' ', schnitt - 1) : schnitt - 1;
      zeilen.push({ text: rest.slice(0, schnitt) });
      rest = rest.slice(schnitt).trimStart();
    }
  }
  let seite = doc.addPage([breite, hoehe]);
  let y = hoehe - rand;
  for (const z of zeilen.slice(0, 2000)) {
    if (y < rand) { seite = doc.addPage([breite, hoehe]); y = hoehe - rand; }
    if (z.text) seite.drawText(z.text, { x: rand, y, size: z.fett ? 13 : groesse, font: z.fett ? fett : schrift });
    y -= z.fett ? 20 : abstand;
  }
  return doc.save();
}

const alsAntwort = (z: typeof schema.autoImportRuns.$inferSelect) => ({
  runId: z.id, mailUid: z.mailUid ?? '', von: z.mailFrom ?? '', betreff: z.mailSubject ?? '', status: z.status ?? '',
  ausgang: z.outcome, einordnung: z.classification, grund: z.errorMessage,
  eingangKey: z.pdfKey, dateiname: z.pdfFilename, dauerMs: z.durationMs,
  gestartet: z.startedAt ? new Date(z.startedAt * 1000).toISOString() : null,
  schritte: z.stepsJson ? (JSON.parse(z.stepsJson) as ImportResult['steps']).map((s) => ({ schritt: s.step, ok: s.ok, dauerMs: s.durationMs, ...(s.error ? { fehler: s.error } : {}), ...(s.meta ? { details: s.meta } : {}) })) : [],
});
export type AutoImportLauf = ReturnType<typeof alsAntwort>;

export async function autoImportAusfuehren(db: Db, k: AutoImportKontext, mailUid: string): Promise<AutoImportLauf> {
  if (!k.ki) throw new FachFehler(422, 'Keine KI eingerichtet: ANTHROPIC_API_KEY setzen (oder KI_ATTRAPPE=1 für Tests).');
  const mail = (await k.graph.angebote(k.ordner)).find((m) => m.uid === mailUid);
  if (!mail) throw new FachFehler(404, 'Die Mail wurde im Posteingang nicht gefunden.');
  if (mail.anhaengeUnvollstaendig) throw new FachFehler(503, 'Anhänge konnten nicht vollständig geladen werden (Microsoft Graph gedrosselt). Bitte in einem Moment erneut versuchen.');

  const runId = crypto.randomUUID();
  if (!(await platzBelegen(db, { runId, mailUid, von: mail.von, betreff: mail.betreff }))) {
    throw new FachFehler(429, `Max. ${MAX_PARALLELE_LAEUFE} parallele Imports aktiv — bitte warten`);
  }

  let ergebnis: ImportResult;
  try {
    const gewuenscht = await einstellung<number>(db, ZEITLIMIT_SCHLUESSEL, 180);
    ergebnis = await autoImportFromMail({
      mailFrom: mail.von, mailSubject: mail.betreff, mailBody: mail.text || mail.vorschau,
      attachments: mail.anhaenge.map((a) => ({ partId: a.partId, filename: a.filename, sizeMB: a.sizeMB, kind: a.kind, processable: a.processable })),
      links: mail.links,
      timeoutSec: Math.min(klemmeZeitlimit(gewuenscht), k.maxZeitlimitSek ?? 600),
      ki: k.ki,
      browserStarten: k.browserStarten,
      anhangLaden: (partId) => k.graph.anhang(mail.messageId, partId),
      // Default-Deny: Schalter, Kill-Switch, Umgebung und Zielliste entscheiden — und jede Entscheidung steht im Audit
      agbFreigabe: async (url, schritt) => { const e = await outwardPruefen(db, OUTWARD_ACTIONS.AGB_SUBMIT, url, schritt, runId); return { erlaubt: e.allowed, grund: e.reason }; },
      abbruchGewuenscht: async () => (await db.select({ s: schema.autoImportRuns.status }).from(schema.autoImportRuns).where(eq(schema.autoImportRuns.id, runId)))[0]?.s === 'aborting',
      lokaleZieleErlaubt: k.lokaleZieleErlaubt,
    });
  } catch (e) {
    ergebnis = { ok: false, steps: [], outcome: 'nichts-gefunden', reason: e instanceof Error ? e.message : String(e) };
  }

  // Ergebnis in den Exposé-Eingang: ein PDF, oder — wenn das Angebot nur im Mailtext stand — die Mail als Beleg
  let eingang: { key: string; dateiname: string } | undefined;
  try {
    const pdf = ergebnis.pdfBuffer ?? (ergebnis.ok && ergebnis.structured ? await mailAlsPdf(mail) : null);
    if (pdf) {
      eingang = { key: `${EINGANG}/${crypto.randomUUID()}`, dateiname: ergebnis.filename ?? 'angebot-aus-mailtext.pdf' };
      await k.speicher.ablegen(BUCKETS.pdfs, eingang.key, pdf, 'application/pdf');
    }
  } catch (e) {
    ergebnis = { ...ergebnis, ok: false, reason: `Das Exposé wurde gefunden, ließ sich aber nicht ablegen: ${e instanceof Error ? e.message : String(e)}` };
    eingang = undefined;
  }

  const [vorher] = await db.select({ s: schema.autoImportRuns.status }).from(schema.autoImportRuns).where(eq(schema.autoImportRuns.id, runId));
  const status = vorher?.s === 'aborting' ? 'aborted' : ergebnis.ok && eingang ? 'success' : 'failed';
  const [zeile] = await db.update(schema.autoImportRuns).set({
    status, finishedAt: Math.floor(Date.now() / 1000), durationMs: ergebnis.steps.reduce((s, x) => s + x.durationMs, 0),
    stepsJson: JSON.stringify(ergebnis.steps), errorMessage: ergebnis.reason ?? null, outcome: ergebnis.outcome ?? null,
    classification: ergebnis.classification ?? null, structuredJson: ergebnis.structured ? JSON.stringify(ergebnis.structured) : null,
    pdfKey: eingang?.key ?? null, pdfFilename: eingang?.dateiname ?? null,
  }).where(eq(schema.autoImportRuns.id, runId)).returning();
  await auditSchreiben(db, {
    type: 'import', entity: 'mail', entityId: mailUid, action: 'auto-import', source: '/api/auto-import/lauf',
    metadata: { runId, von: mail.von, ok: ergebnis.ok, ausgang: ergebnis.outcome, quelle: ergebnis.pdfSource, grund: ergebnis.reason, schritte: ergebnis.steps.length },
  });
  return alsAntwort(zeile!);
}

/** Abbruch anfordern. Der Wunsch geht in die Zeile, weil der Lauf online in einer anderen Instanz steckt als diese Anfrage. */
export async function autoImportAbbrechen(db: Db, mailUid: string) {
  const zeilen = await db.update(schema.autoImportRuns).set({ status: 'aborting' })
    .where(and(eq(schema.autoImportRuns.mailUid, mailUid), eq(schema.autoImportRuns.status, 'running'))).returning({ id: schema.autoImportRuns.id });
  return { abgebrochen: zeilen.length };
}

export async function autoImportVerlauf(db: Db, limit = 50): Promise<AutoImportLauf[]> {
  return (await db.select().from(schema.autoImportRuns).orderBy(desc(schema.autoImportRuns.startedAt)).limit(Math.min(200, Math.max(1, limit)))).map(alsAntwort);
}

/** Welche Mails schon verarbeitet sind: erfolgreiche Läufe im Neubau und die umgezogene Liste der alten App. */
export async function bereitsImportiert(db: Db): Promise<Set<string>> {
  const laeufe = await db.select({ uid: schema.autoImportRuns.mailUid }).from(schema.autoImportRuns).where(eq(schema.autoImportRuns.status, 'success'));
  const alt = await einstellung<unknown[]>(db, ALT_IMPORTIERT_SCHLUESSEL, []);
  return new Set([...laeufe.map((l) => l.uid ?? ''), ...(Array.isArray(alt) ? alt.map(String) : [])].filter(Boolean));
}
