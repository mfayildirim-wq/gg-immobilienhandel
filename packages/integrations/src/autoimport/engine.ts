// Übernommen aus gg-immohandel server/auto-import-engine.ts (Stand 9d693b8): der Ablauf „E-Mail → Exposé" mit Triage,
// Kandidaten in Rangfolge, Browser-Weg mit AGB-Schleife, Download, Dokumentliste, Freischalten, Drucken und dem besten
// Teilergebnis als Rückfallebene — Reihenfolge, Grenzen und Meldungen wörtlich.
//
// Kein Agenten-Framework, und das ist Absicht: der Ablauf ist fest verdrahtet, die KI beantwortet nur vier enge Fragen
// (Ist dieses PDF ein Exposé? Welche Links zuerst? Welcher Link? Was für eine Seite?). Ein Bot, der auf fremden Seiten
// Formulare absendet, soll vorhersagbar und begrenzt sein.
//
// Was der Neubau anders macht:
//  1. **Ports statt fester Abhängigkeiten.** Browser, KI, Anhänge, AGB-Freigabe und Abbruch kommen von außen — die
//     Engine ist damit gegen echte Testseiten prüfbar, ohne Postfach, ohne KI-Kosten, ohne Datenbank.
//  2. **Zielprüfung.** Die Adressen stammen aus fremden Mails. Vor jedem Seitenaufruf UND nach jeder Weiterleitung
//     wird geprüft, dass das Ziel öffentlich ist — kein localhost, kein internes Netz, kein Metadaten-Dienst der Cloud.
//     Die alte Engine prüfte nur das Protokoll.
//  3. **Eigener Browser-Kontext je Mail** statt einer nackten Seite: Cookies einer Maklerseite erreichen nie den nächsten Lauf.
//  4. **PDF-Prüfung ohne Rasterung** (siehe pdfPruefung.ts), **Downloads als Ereignis** (siehe seite.ts).
//  5. **Der Abbruch hängt am Lauf, nicht am Prozess**: ein Zustandsobjekt je Lauf statt einer prozessweiten Menge.
/* eslint-disable @typescript-eslint/no-explicit-any -- Schritt-Protokoll und KI-Antworten sind ungetypt */
import type { Browser, Page } from 'playwright-core';
import {
  triageMail, MIN_CANDIDATE_SCORE, extractObjektnummern, stripSignature,
  type TriageCandidate, type TriageCode, type TriageResult,
} from '../expose/triage.ts';
import { extractExposeFromText, hasCompleteAddress, missingCoreFields, type ExtractedExpose } from '../expose/mailtext.ts';
import type { KiClient } from '../ki/anthropic.ts';
import { rankLinksForTrial } from './links.ts';
import { pdfEinordnen, type PdfEinordnung } from './pdfPruefung.ts';
import {
  type AgbFreigabe, classifyPageType, clickDocumentItem, detectAgbModal, detectAndDownload, detectErrorPage, fillAgbAndSubmit,
  fillAgbModal, findDocumentListItems, printPageAsPdf, sleep, tryAcceptCookieBanner, tryClickUnlockButton,
} from './seite.ts';

// ── Types ─────────────────────────────────────────────────────


export interface ImportStep {
  step: string;                  // 'classify-attachment'|'pick-link'|'open'|'classify-page'|'fill-agb'|'submit'|'download'|'print'|'screenshot'
  ts: number;
  durationMs: number;
  ok: boolean;
  meta?: Record<string, any>;
  error?: string;
}

/**
 * Ausgang eines Laufs nach R10 — es gibt nie einen stummen Fehler.
 *   sicher         → Objekt kann angelegt werden
 *   unsicher       → Daten da, aber lückenhaft; Wizard öffnet vorbefüllt
 *   wiedervorlage  → echtes Angebot, aber noch keine Daten geliefert (R9)
 *   nichts-gefunden→ Klartext, welche Quellen geprüft wurden und woran es scheiterte
 */
export type ImportOutcome = 'sicher' | 'unsicher' | 'wiedervorlage' | 'nichts-gefunden';

export interface ImportResult {
  ok: boolean;
  pdfBuffer?: Buffer;
  pdfSource?: 'attachment'|'download'|'print'|'screenshot-fallback';
  screenshots?: Buffer[];
  filename?: string;
  steps: ImportStep[];
  finalUrl?: string;
  reason?: string;
  /** Urteil der Triage (Stufe 0) */
  classification?: TriageCode;
  outcome?: ImportOutcome;
  /** Strukturierte Objektdaten, wenn sie ohne PDF gewonnen wurden (R11) */
  structured?: Record<string, any>;
  /** Zusatzunterlagen, die als Beleg mitgeliefert werden können (R1) */
  evidence?: string[];
  /** Nachvollziehbarkeit: was die Triage gesehen und verworfen hat */
  triage?: {
    verdict: TriageCode;
    reasons: string[];
    candidates: Array<{ source: string; ref: string; score: number; why: string[] }>;
    ignoredLinks: string[];
    legalAttachments: string[];
  };
}

export interface ImportOptions {
  mailFrom: string;
  mailSubject: string;
  /** Klartext der Mail — für Triage, Mailtext-Auswertung und die Link-Auswahl */
  mailBody: string;
  attachments: { partId: string; filename: string; sizeMB: number; kind?: string; processable?: boolean }[];
  links: string[];
  /** Hartes Zeitlimit je Mail; wird auf 60–600 s geklemmt, Standard 90 */
  timeoutSec: number;
  ki: KiClient;
  /** Startet das Chromium dieses Laufs (lokal das installierte, online das gepackte). */
  browserStarten: () => Promise<Browser>;
  /** Lädt einen Anhang der Mail. */
  anhangLaden: (partId: string) => Promise<Uint8Array>;
  /** Default-Deny: ohne ausdrückliche Freigabe wird keine AGB-/Provisionsbestätigung abgesendet. */
  agbFreigabe: AgbFreigabe;
  /** Wird alle 5 s gefragt, ob jemand den Lauf abbrechen will (online steckt der Lauf in einer anderen Instanz als die Anfrage). */
  abbruchGewuenscht?: () => Promise<boolean>;
  /** NUR für Tests gegen lokale Testseiten. Im Betrieb nie setzen: die Adressen kommen aus fremden Mails. */
  lokaleZieleErlaubt?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

function nowMs() { return Date.now(); }

function recordStep(steps: ImportStep[], step: string, startMs: number, ok: boolean, meta?: Record<string, any>, error?: string): void {
  steps.push({ step, ts: startMs, durationMs: nowMs() - startMs, ok, meta, error });
}

/** Erzeugt einen eindeutigen, sprechenden Dateinamen aus dem Mail-Betreff.
 *  Beispiel: "Investorenpaket: 4 Denkmal-MFH..." → "expose-investorenpaket-4-denkmal-mfh.pdf"
 *  Maximal 80 Zeichen total, immer mit .pdf-Suffix. */
function filenameFromSubject(subject: string, prefix: string = 'expose'): string {
  const clean = (subject || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
  return `${prefix}-${clean || 'unbekannt'}.pdf`;
}

// ── Hauptfunktion ─────────────────────────────────────────────

// ── Zielprüfung ───────────────────────────────────────────────
// Loopback, private IPv4-Bereiche, Link-Local (dort liegt der Metadaten-Dienst der Cloud-Anbieter: 169.254.169.254),
// CGNAT/Tailscale, IPv6-Entsprechungen und Namen, die nur intern auflösen.
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function zielPruefen(adresse: string, lokaleErlaubt = false): { ok: true; url: URL } | { ok: false; grund: string } {
  let url: URL;
  try { url = new URL(adresse); } catch { return { ok: false, grund: 'ungültige Adresse' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, grund: 'ungültige Adresse' };
  if (url.username || url.password) return { ok: false, grund: 'Adresse mit Zugangsdaten' };
  if (lokaleErlaubt) return { ok: true, url };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const intern = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || PRIVATE_IPV4.test(host) || host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)
    || /^::ffff:/.test(host) || !host.includes('.') && !host.includes(':');
  return intern ? { ok: false, grund: 'interne Adresse — wird nicht geöffnet' } : { ok: true, url };
}


// ── Hauptfunktion ─────────────────────────────────────────────

/** Zustand EINES Laufs. Die alte Engine führte eine prozessweite Menge abgebrochener Lauf-IDs. */
interface LaufZustand { abgebrochen: boolean }

/** Ein Platz für den Browser des laufenden Imports, damit der Hard-Timeout ihn von außen schließen kann. */
interface BrowserRef { value: Browser | null }

/** Browser zumachen und den Platz räumen. Ein Fehler dabei ist bedeutungslos: Ziel ist ein toter Browser. */
async function schliesseBrowser(ref: BrowserRef): Promise<void> {
  const browser = ref.value;
  ref.value = null;
  if (!browser) return;
  try { await browser.close(); } catch { /* ignore */ }
}

export const klemmeZeitlimit = (sek: unknown) => { const n = Number(sek); return Number.isFinite(n) ? Math.min(600, Math.max(60, Math.round(n))) : 90; };

export async function autoImportFromMail(opts: ImportOptions): Promise<ImportResult> {
  const steps: ImportStep[] = [];
  // Der Wert kommt aus den Einstellungen und ist damit alles, was jemand dort hineingeschrieben hat: aus "x" wurde in
  // der alten App NaN, daraus sleep(NaN) — das Zeitlimit feuerte sofort und meldete „Hard-Timeout nach NaNs".
  const timeoutMs = klemmeZeitlimit(opts.timeoutSec) * 1000;
  const zustand: LaufZustand = { abgebrochen: false };
  const browserRef: BrowserRef = { value: null };

  // Hard-Timeout pro Mail. Das Rennen beendet nicht nur die ANTWORT: der Abbruch-Merker lässt die Engine an ihrer
  // nächsten Prüfstelle aussteigen, und das Schließen des Browsers bringt eine hängende Navigation sofort zum Scheitern.
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, ablehnen) => {
    timeoutTimer = setTimeout(() => {
      zustand.abgebrochen = true;
      void schliesseBrowser(browserRef);
      ablehnen(new Error(`Hard-Timeout nach ${timeoutMs / 1000}s`));
    }, timeoutMs);
    timeoutTimer.unref?.();
  });

  // Abbruchwunsch von außen: ein verpasster Blick ist kein Grund, den Lauf zu beenden
  const abbruchTimer = opts.abbruchGewuenscht
    ? setInterval(() => { void opts.abbruchGewuenscht!().then((ja) => { if (ja) { zustand.abgebrochen = true; void schliesseBrowser(browserRef); } }).catch(() => {}); }, 5000)
    : undefined;
  abbruchTimer?.unref?.();

  const lauf = runEngine(zustand, opts, steps, browserRef);
  try {
    const result = await Promise.race([lauf, timeoutPromise]);
    return { ...result, steps };
  } catch (e: any) {
    return { ok: false, steps, outcome: 'nichts-gefunden', reason: zustand.abgebrochen && !/Hard-Timeout/.test(String(e?.message)) ? 'Abgebrochen' : e?.message || String(e) };
  } finally {
    clearTimeout(timeoutTimer);
    if (abbruchTimer) clearInterval(abbruchTimer);
    // Nach einem Hard-Timeout läuft die Engine noch bis zu ihrer nächsten Prüfstelle — der Browser ist dann schon zu
    void lauf.catch(() => { /* der Ausgang zählt hier nicht mehr */ }).finally(() => schliesseBrowser(browserRef));
  }
}

async function runEngine(
  zustand: LaufZustand,
  opts: ImportOptions,
  steps: ImportStep[],
  browserRef: BrowserRef,
): Promise<Omit<ImportResult, 'steps'>> {

  const isAborted = () => zustand.abgebrochen;

  // Tracking: bestes Preview-PDF als Notfall-Fallback wenn nichts Vollständiges gefunden wird.
  // Ref-Box damit auch tryExposeLinkInBrowser (separate Funktion) zugreifen + updaten kann.
  const bestPreviewRef: { value: { buf: Buffer; source: 'attachment'|'download'|'print'; filename: string; cls: PdfEinordnung } | null } = { value: null };
  const updateBestPreview = (cand: { buf: Buffer; source: 'attachment'|'download'|'print'; filename: string; cls: PdfEinordnung }) => {
    if (!bestPreviewRef.value || cand.cls.missingFields.length < bestPreviewRef.value.cls.missingFields.length) {
      bestPreviewRef.value = cand;
    }
  };

  // ── Stufe 0: Triage — wo steckt das Exposé? ─────────────────
  // Kostenlos, ohne Browser, ohne Bilderkennung. Legt die Reihenfolge fest,
  // in der die Quellen verfolgt werden (R8).
  const triageStart = nowMs();
  const triage = triageMail({
    from: opts.mailFrom,
    subject: opts.mailSubject,
    bodyText: opts.mailBody,
    attachments: opts.attachments,
    links: opts.links,
  });
  recordStep(steps, 'triage', triageStart, true, {
    verdict: triage.verdict,
    bodyScore: triage.bodyScore,
    facts: triage.facts.map(f => f.label),
    candidates: triage.candidates.map(c => `${c.source} ${c.score}: ${c.ref.substring(0, 60)}`),
    rechtsdokumente: triage.legalAttachments,
    zusatzunterlagen: triage.supplementAttachments,
  });

  const base: Omit<ImportResult, 'steps'|'ok'> = {
    classification: triage.verdict,
    evidence: triage.supplementAttachments,
    triage: {
      verdict: triage.verdict,
      reasons: triage.reasons,
      candidates: triage.candidates.map(c => ({ source: c.source, ref: c.ref, score: c.score, why: c.why })),
      ignoredLinks: triage.ignoredLinks,
      legalAttachments: triage.legalAttachments,
    },
  };

  // R9/A2: Ankündigung ohne Daten — kein Browser, kein Vision-Call.
  if (triage.verdict === 'ANNOUNCEMENT') {
    return {
      ...base, ok: false, outcome: 'wiedervorlage',
      reason: `Angekündigtes Objekt ohne Daten. ${triage.reasons.join(' ')} Zum Erhalt des Exposés ist eine Rückmeldung an den Absender nötig.`,
    };
  }
  // Kein Objektbezug und keine Links — es gibt schlicht nichts zu holen (A2).
  if (triage.verdict === 'NONE' && opts.links.length === 0) {
    return { ...base, ok: false, outcome: 'nichts-gefunden', reason: explainNothingFound(triage, opts) };
  }

  // ── Stufe 1: Kandidaten in Triage-Reihenfolge abarbeiten ─────
  const pursued = triage.candidates.filter(c => c.score >= MIN_CANDIDATE_SCORE);
  const attachmentByName = new Map(opts.attachments.map(a => [a.filename, a]));
  const triedLinks = new Set<string>();
  const linkResults: Array<{ url: string; outcome: string }> = [];
  let lastReason = '';
  let bodyTried = false;

  let page: Page | null = null;
  const ensurePage = async (): Promise<Page> => {
    if (page) return page;
    // In die Ref und nicht in eine lokale Variable: der Hard-Timeout schließt
    // von außen, und was er nicht sieht, kann er nicht beenden.
    const browser = await opts.browserStarten();
    browserRef.value = browser;
    // Kam der Abbruch, während der Browser startete, sah der Hard-Timeout eine
    // leere Ref und hätte nichts zu schließen gehabt — hier holt er es nach.
    if (isAborted()) { await schliesseBrowser(browserRef); throw new Error('Abgebrochen'); }
    // Eigener Kontext je Mail: Cookies und Anmeldungen einer Maklerseite gelangen nie in den nächsten Lauf
    const kontext = await browser.newContext({
      viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'de-DE',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    // esbuild/tsx-Helper-Stub für page.evaluate — gilt auch für das Vercel-Bündel
    await kontext.addInitScript(
      'Object.defineProperty(window, "__name", { value: function(f){return f;}, writable: true, configurable: true });'
    );
    page = await kontext.newPage();
    return page;
  };

  /** Einen Link verfolgen. `null` = kein Erfolg, `fatal` bricht die Schleife ab. */
  const tryLink = async (url: string): Promise<LinkTrialResult | null> => {
    if (triedLinks.has(url)) return null;
    triedLinks.add(url);
    const ziel = zielPruefen(url, opts.lokaleZieleErlaubt);
    if (!ziel.ok) { linkResults.push({ url: url.substring(0, 100), outcome: ziel.grund }); return null; }
    recordStep(steps, 'try-link', nowMs(), true, { url: url.substring(0, 100) });
    const p = await ensurePage();
    const result = await tryExposeLinkInBrowser(p, url, opts, steps, isAborted, updateBestPreview, bestPreviewRef);
    if (result.ok) return result;
    linkResults.push({ url: url.substring(0, 100), outcome: result.reason || 'unbekannt' });
    lastReason = result.reason || '';
    return result.fatal ? result : null;
  };

  try {
    for (const cand of pursued) {
      if (isAborted()) return { ...base, ok: false, outcome: 'nichts-gefunden', reason: 'Abgebrochen' };

      if (cand.source === 'attachment') {
        const att = attachmentByName.get(cand.ref);
        if (!att) continue;
        const hit = await tryAttachmentCandidate(att, cand, opts, steps, updateBestPreview);
        if (hit) return { ...base, ...hit, outcome: 'sicher' };

      } else if (cand.source === 'link') {
        const result = await tryLink(cand.ref);
        if (result?.ok) return { ...base, ...result, outcome: 'sicher' };
        if (result?.fatal) break;

      } else if (cand.source === 'body' && !bodyTried) {
        bodyTried = true;
        const hit = await tryBodyCandidate(opts, steps);
        if (hit) return { ...base, ...hit };
      }
    }

    // Rückfallebene: Links, die die Triage nicht als Kandidat geführt hat.
    // Ohne sie wäre die Erkennung schlechter als vor der Triage — die
    // KI-Sortierung bleibt daher als zweite Chance erhalten.
    const remaining = opts.links.filter(l => !triedLinks.has(l));
    if (remaining.length > 0) {
      const senderDomain = (opts.mailFrom.split('@')[1] || '').toLowerCase();
      const rankStart = nowMs();
      const ranked = await rankLinksForTrial(opts.mailBody, remaining, opts.ki, {
        mailSubject: opts.mailSubject, senderDomain,
      });
      recordStep(steps, 'rank-links', rankStart, true, {
        grund: 'Rückfallebene — Triage fand keinen eindeutigen Exposé-Link',
        total: remaining.length, trying: ranked.length,
        order: ranked.slice(0, 5).map(l => l.substring(0, 80)),
      });
      for (const url of ranked) {
        if (isAborted()) return { ...base, ok: false, outcome: 'nichts-gefunden', reason: 'Abgebrochen' };
        const result = await tryLink(url);
        if (result?.ok) return { ...base, ...result, outcome: 'sicher' };
        if (result?.fatal) break;
      }
    }

    // Letzte Quelle: der Mail-Text. Auch wenn er allein nicht überzeugt hat,
    // ist er besser als ein leeres Ergebnis (R8 — es zählt die Vollständigkeit,
    // nicht die Herkunft).
    const fromBody = bodyTried ? null : await tryBodyCandidate(opts, steps);
    bodyTried = true;
    if (fromBody?.outcome === 'sicher') return { ...base, ...fromBody };

    // Nichts Vollständiges — bestes Teilergebnis liefern statt aufzugeben (R10).
    if (bestPreviewRef.value) {
      const bp = bestPreviewRef.value;
      return {
        ...base, ...(fromBody ? { structured: fromBody.structured } : {}),
        ok: true, outcome: 'unsicher',
        pdfBuffer: bp.buf, pdfSource: bp.source, filename: bp.filename,
        reason: `Nur ein eingeschränktes Exposé gefunden — bitte im Wizard prüfen. Fehlende Angaben: ${bp.cls.missingFields.join(', ') || 'unbekannt'}.`
          + (linkResults.length ? ` Geprüfte Links: ${linkResults.map(r => r.outcome).slice(0, 3).join(' | ')}` : ''),
      };
    }
    if (fromBody) return { ...base, ...fromBody };

    // Zusatzunterlagen ohne Exposé: das Objekt existiert, die Unterlagen sind
    // brauchbar — nur die Eckdaten fehlen (R10, „unsicher" statt „nichts").
    if (triage.supplementAttachments.length > 0) {
      return {
        ...base, ok: true, outcome: 'unsicher',
        reason: `Kein Exposé, aber verwertbare Unterlagen: ${triage.supplementAttachments.join(', ')}. `
          + 'Die Eckdaten müssen im Wizard von Hand ergänzt werden.',
      };
    }

    return {
      ...base, ok: false, outcome: 'nichts-gefunden',
      reason: explainNothingFound(triage, opts, linkResults, lastReason),
    };
  } finally {
    await schliesseBrowser(browserRef);
  }
}

/**
 * R11 — Der Mail-Text IST das Angebot.
 * Es wird kein PDF erzeugt: Ziel des Imports sind die Objektdaten, nicht ein
 * Dokument. Der Text selbst wird als Beleg mitgegeben, damit im Wizard
 * nachvollziehbar bleibt, woher jede Angabe stammt.
 */
async function tryBodyCandidate(
  opts: ImportOptions,
  steps: ImportStep[],
): Promise<Pick<ImportResult, 'ok'|'outcome'|'structured'|'reason'|'evidence'> | null> {
  const text = stripSignature(opts.mailBody || '');
  if (text.trim().length < 80) return null;

  const start = nowMs();
  let extracted: ExtractedExpose;
  try {
    extracted = await extractExposeFromText(text, (body) => opts.ki.nachricht(body), {
      from: opts.mailFrom, subject: opts.mailSubject,
    });
  } catch (e: any) {
    recordStep(steps, 'extract-body', start, false, {}, e?.message || String(e));
    return null;
  }

  const missing = missingCoreFields(extracted);
  const komplett = hasCompleteAddress(extracted);
  recordStep(steps, 'extract-body', start, true, {
    adresseVollstaendig: komplett,
    fehlt: missing,
    ort: [extracted.objekt?.plz, extracted.objekt?.stadt].filter(Boolean).join(' '),
  });

  // Ohne jede verwertbare Angabe war der Weg umsonst — dann sollen die
  // übrigen Quellen ihre Chance bekommen.
  if (!komplett && missing.length >= 3) return null;

  return {
    ok: true,
    outcome: komplett ? 'sicher' : 'unsicher',
    structured: extracted,
    evidence: [`Mail-Text vom ${opts.mailFrom}: ${opts.mailSubject}`],
    reason: komplett
      ? 'Die Objektdaten standen vollständig in der Mail selbst — kein Exposé-Dokument nötig.'
      : `Die Mail enthält Objektdaten, aber nicht alle Pflichtangaben. Fehlt: ${missing.join(', ')}.`,
  };
}

/** Einen Anhangs-Kandidaten per Bilderkennung prüfen. Rechtsdokumente kommen
 *  hier gar nicht erst an — die Triage hat sie vorher aussortiert (A4). */
async function tryAttachmentCandidate(
  att: ImportOptions['attachments'][number],
  cand: TriageCandidate,
  opts: ImportOptions,
  steps: ImportStep[],
  updateBestPreview: (c: { buf: Buffer; source: 'attachment'; filename: string; cls: PdfEinordnung }) => void,
): Promise<Pick<ImportResult, 'ok'|'pdfBuffer'|'pdfSource'|'filename'> | null> {
  const stepStart = nowMs();
  try {
    const buf = Buffer.from(await opts.anhangLaden(att.partId));
    const cls = await pdfEinordnen(buf, att.filename, opts.ki, { mailSubject: opts.mailSubject });
    recordStep(steps, 'classify-attachment', stepStart, true, {
      filename: att.filename, triageScore: cand.score, triageWhy: cand.why,
      type: cls.type, confidence: cls.confidence,
      completeness: cls.completeness, missing: cls.missingFields, address: cls.extractedAddress,
    });
    if (cls.type !== 'expose' || cls.confidence < 0.6) return null;

    const fn = /\.pdf$/i.test(att.filename)
      ? att.filename
      : filenameFromSubject(opts.mailSubject, 'expose-anhang');
    if (cls.completeness === 'vollstaendig') {
      return { ok: true, pdfBuffer: buf, pdfSource: 'attachment', filename: fn };
    }
    updateBestPreview({ buf, source: 'attachment', filename: fn, cls });
    return null;
  } catch (e: any) {
    recordStep(steps, 'classify-attachment', stepStart, false, { filename: att.filename }, e?.message || String(e));
    return null;
  }
}

/** R10: Klartext, welche Quellen geprüft wurden und woran es scheiterte. */
function explainNothingFound(
  triage: TriageResult,
  opts: ImportOptions,
  linkResults: Array<{ url: string; outcome: string }> = [],
  lastReason = '',
): string {
  const parts: string[] = [];
  if (opts.attachments.length === 0) parts.push('keine Anhänge');
  else {
    const geprueft = opts.attachments.length;
    const recht = triage.legalAttachments.length;
    const zusatz = triage.supplementAttachments.length;
    parts.push(
      `${geprueft} Anhang/Anhänge geprüft` +
      (recht ? `, davon ${recht} Rechtsdokument(e)` : '') +
      (zusatz ? `, ${zusatz} Zusatzunterlage(n) ohne Exposé` : ''),
    );
  }
  if (opts.links.length === 0) parts.push('keine Links in der Mail');
  else if (linkResults.length === 0) parts.push(`${opts.links.length} Link(s), keiner mit Exposé-Merkmalen`);
  else parts.push(`${linkResults.length} Link(s) geöffnet: ${linkResults.map(r => r.outcome).slice(0, 3).join(' | ')}`);

  parts.push(`Mailtext: ${triage.facts.length ? `nur ${triage.facts.map(f => f.label).join(', ')}` : 'keine Objektdaten'}`);
  if (lastReason) parts.push(`zuletzt: ${lastReason}`);
  return `Kein Exposé gefunden. Geprüft: ${parts.join('; ')}.`;
}

interface LinkTrialResult {
  ok: boolean;
  pdfBuffer?: Buffer;
  pdfSource?: 'attachment'|'download'|'print'|'screenshot-fallback';
  filename?: string;
  finalUrl?: string;
  reason?: string;
  fatal?: boolean;  // wenn true: Browser kaputt, weiteren Links nicht mehr probieren
}

/** Versucht EINEN Link → Page öffnen, Modal/AGB/Download/Print + Validation.
 *  Gibt detailliertes Resultat zurück damit Caller den nächsten Link probieren kann. */
async function tryExposeLinkInBrowser(
  page: Page,
  exposeLink: string,
  opts: ImportOptions,
  steps: ImportStep[],
  isAborted: () => boolean,
  updateBestPreview: (cand: { buf: Buffer; source: 'attachment'|'download'|'print'; filename: string; cls: PdfEinordnung }) => void,
  bestPreviewRef: { value: { buf: Buffer; source: 'attachment'|'download'|'print'; filename: string; cls: PdfEinordnung } | null },
): Promise<LinkTrialResult> {
  const visited = new Map<string, number>();
  let currentUrl = exposeLink;
  let agbLoops = 0;
  let lastModalSignature = '';   // erkennt unveränderte Modals (Cookie-Loops)
  const MAX_NAVS = 8;
  const MAX_AGB_LOOPS = 4;
  let navCount = 0;

  // R6: Cookie-Banner erscheinen bei manchen Portalen erst Sekunden nach dem
  // Laden. Ein einmaliges Wegklicken reicht deshalb nicht — vor jedem Schritt,
  // der die Seite auswertet, wird erneut nachgesehen.
  // R7: Taucht eine Objektnummer aus der Mail im Dateinamen wieder auf, gehört
  // die Datei nachweislich zu diesem Objekt. Das ist ein so starker Beleg, dass
  // die Bilderkennung dann weniger sicher sein darf.
  const objektnummern = extractObjektnummern(`${opts.mailSubject}\n${opts.mailBody}`);
  const matchedObjektnummer = (name?: string): string | null => {
    if (!name) return null;
    const hay = name.toLowerCase();
    return objektnummern.find(n => hay.includes(n.toLowerCase())) ?? null;
  };

  const dismissCookieBanner = async (phase: string): Promise<void> => {
    const clickedText = await tryAcceptCookieBanner(page).catch(() => null);
    if (!clickedText) return;
    recordStep(steps, 'close-cookies', nowMs(), true, { phase, clickedText });
    await sleep(800);
  };

  while (true) {
      if (isAborted()) return { ok: false, reason: 'Abgebrochen' };
      if (navCount >= MAX_NAVS) return { ok: false, reason: `Max. ${MAX_NAVS} Navigationen erreicht` };
      navCount++;

      // Visited-Tracking gegen Endlosloop
      // Lockerer Schutz: 5× gleiche URL ist OK (SPAs/Landingpages bleiben oft auf
      // gleicher URL bei Click-Through-Steps); nur Vollblock bei NEUN Wiederholungen.
      const visitCount = (visited.get(currentUrl) || 0) + 1;
      visited.set(currentUrl, visitCount);
      if (visitCount >= 6) {
        return { ok: false, reason: `Loop-Schutz: URL ${currentUrl.substring(0, 80)} 6× besucht` };
      }

      // URL syntaktisch validieren (http(s) only)
      const navZiel = zielPruefen(currentUrl, opts.lokaleZieleErlaubt);
      if (!navZiel.ok) return { ok: false, reason: `${navZiel.grund}: ${currentUrl.substring(0, 100)}` };

      // Page öffnen — HTTPResponse abfangen für Content-Type-Check
      const openStart = nowMs();
      let response: Awaited<ReturnType<Page['goto']>> = null;
      try {
        response = await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
        recordStep(steps, 'open', openStart, true, { url: currentUrl, finalUrl: page.url() });
      } catch (e: any) {
        try {
          response = await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          recordStep(steps, 'open', openStart, true, { url: currentUrl, finalUrl: page.url(), fallback: true });
        } catch (e2: any) {
          recordStep(steps, 'open', openStart, false, { url: currentUrl }, e2?.message || String(e2));
          return { ok: false, reason: `Page konnte nicht geöffnet werden: ${e2?.message || e2}` };
        }
      }

      // ── PRIORITÄT 0: Direct-PDF — Page-URL liefert direkt eine PDF ──
      // Bei Browser-PDF-Viewer (z.B. nach Klick auf "Exposé.pdf"-Link) hat page.pdf()
      // bisher den Viewer mit UI gedruckt → wertlose Screenshots.
      // Statt dessen: PDF-Bytes direkt aus der Response holen und als Download nutzen.
      try {
        const ct = (response?.headers()['content-type'] || '').toLowerCase();
        if (ct.includes('application/pdf') || /\.pdf(\?|$)/i.test(page.url())) {
          const pdfStart = nowMs();
          let pdfBuf: Buffer | null = null;
          try {
            const buf = await response!.body();
            if (buf && buf.length > 1024) pdfBuf = Buffer.from(buf);
          } catch { /* Viewer-Navigation ohne lesbaren Körper */ }
          // Rückfallebene: dieselbe Adresse über die Sitzung des Browser-Kontexts holen — Cookies gehen dabei mit
          if (!pdfBuf) {
            try {
              const res = await page.context().request.get(page.url(), { timeout: 30_000 });
              if (res.ok()) { const b = await res.body(); if (b.length > 1024) pdfBuf = b; }
            } catch { /* Rückfallebene scheitert — normaler Ablauf */ }
          }
          if (pdfBuf) {
            recordStep(steps, 'direct-pdf', pdfStart, true, { size: pdfBuf.length, contentType: ct });
            // Validieren — auch direct-pdf muss vollständiges Exposé sein
            const val = await pdfEinordnen(pdfBuf, 'direct-pdf', opts.ki, { mailSubject: opts.mailSubject }).catch(e => ({
              type: 'sonstiges' as const, confidence: 0, completeness: 'unklar' as const, missingFields: [], extractedAddress: '', reason: String(e),
            }));
            recordStep(steps, 'validate-pdf', nowMs(), true, {
              source: 'direct-pdf', type: val.type, completeness: val.completeness, address: val.extractedAddress,
            });
            if (val.type === 'expose' && val.confidence >= 0.6) {
              if (val.completeness === 'vollstaendig') {
                return {
                  ok: true, pdfBuffer: pdfBuf, pdfSource: 'download',
                  filename: filenameFromSubject(opts.mailSubject, 'expose-direct'),
                  finalUrl: page.url(),
                };
              }
              updateBestPreview({
                buf: pdfBuf, source: 'download',
                filename: filenameFromSubject(opts.mailSubject, 'expose-direct-preview'),
                cls: val,
              });
            }
            // Wenn nicht vollständig: weitermachen (Page könnte trotzdem HTML-Klassifikation erlauben)
            // Aber: ist die Page selbst NUR ein PDF, gibt's keine HTML-Logik mehr — fallback fail
            return {
              ok: false,
              reason: `Direct-PDF heruntergeladen aber Inhalt: ${val.type}/${val.completeness}. ${val.reason.substring(0, 100)}`,
            };
          }
        }
      } catch (e: any) {
        recordStep(steps, 'direct-pdf', nowMs(), false, {}, e?.message || String(e));
      }

      const finalUrl = page.url();
      // Auch das ZIEL einer Weiterleitung wird geprüft — sonst führte ein harmloser Link über einen Redirect ins interne Netz
      const endZiel = zielPruefen(finalUrl, opts.lokaleZieleErlaubt);
      if (!endZiel.ok) return { ok: false, reason: `Weiterleitung abgelehnt — ${endZiel.grund}: ${finalUrl.substring(0, 100)}` };

      // Cookie-Banner wegklicken — sonst überlagert er die Page-Klassifikation
      await dismissCookieBanner('nach-laden');

      // ── Error-Page erkennen (Link expired, 404, "nicht mehr verfügbar") ──
      // Spart 30-60s pro abgelaufener Mail (war: durchläuft kompletten Pfad bis Print-Validate)
      const errorPageStart = nowMs();
      const errorCheck = await detectErrorPage(page);
      if (errorCheck.isError) {
        recordStep(steps, 'detect-error-page', errorPageStart, true, errorCheck);
        return {
          ok: false,
          reason: `Link abgelaufen oder Objekt nicht mehr verfügbar: "${errorCheck.matchedText.substring(0, 80)}"`,
        };
      }

      // ── PRIORITÄT 1: AGB-Modal überlagert die Seite? ──
      const modalStart = nowMs();
      const modal = await detectAgbModal(page);
      // Cookie-Modal-Filter: "Datenschutz-Präferenz" / "Cookies" Texte sind KEINE AGB
      const isCookieModal = modal.found && /datenschutz-pr[äa]ferenz|cookie|consent|gdpr/i.test(modal.modalText);
      if (isCookieModal) {
        recordStep(steps, 'modal-is-cookie', modalStart, true, { textPreview: modal.modalText.substring(0, 120) });
        // Versuche „Alle akzeptieren" — ist eigentlich Cookie-Banner verkleidet als Modal
        await tryAcceptCookieBanner(page);
        await sleep(800);
        currentUrl = page.url();
        continue;
      }
      if (modal.found && (modal.checkboxes > 0 || modal.hasSubmitButton)) {
        // Loop-Schutz: gleicher Modal-Text 2× → kommt nicht weiter
        const modalSig = modal.modalText.substring(0, 200);
        if (modalSig === lastModalSignature && agbLoops > 0) {
          recordStep(steps, 'modal-stuck', modalStart, false, { sig: modalSig.substring(0, 100) });
          return { ok: false, reason: `Modal bleibt nach Submit unverändert — vermutlich Captcha/Login/Cookies` };
        }
        lastModalSignature = modalSig;
        recordStep(steps, 'detect-modal', modalStart, true, {
          checkboxes: modal.checkboxes, hasSubmit: modal.hasSubmitButton,
          textPreview: modal.modalText.substring(0, 120),
        });
        if (agbLoops >= MAX_AGB_LOOPS) {
          return { ok: false, reason: `Max. ${MAX_AGB_LOOPS} AGB-Loops erreicht — Modal bleibt offen` };
        }
        agbLoops++;
        const fillStart = nowMs();
        try {
          const filled = await fillAgbModal(page, opts.agbFreigabe);
          if (filled.blocked) {
            recordStep(steps, 'fill-modal', fillStart, false, {}, filled.blocked);
            return { ok: false, reason: filled.blocked };
          }
          recordStep(steps, 'fill-modal', fillStart, true, filled);
          // Wenn Submit gar nicht gefunden — als Cookie-Modal werten und weiter
          if (filled.submittedVia.startsWith('modal-kein')) {
            recordStep(steps, 'modal-no-submit-skip', nowMs(), true, {});
            // Page neu laden um Modal loszuwerden? Nein — weiter zur Page-Klassifikation
            currentUrl = page.url();
            continue;
          }
          currentUrl = page.url();
          continue;
        } catch (e: any) {
          recordStep(steps, 'fill-modal', fillStart, false, {}, e?.message || String(e));
          return { ok: false, reason: `Modal-Submit fehlgeschlagen: ${e?.message || e}` };
        }
      }
      recordStep(steps, 'detect-modal', modalStart, true, { found: modal.found, hasChk: modal.checkboxes });

      // ── Klassifiziere Seite: AGB-Form oder Exposé-Page? ─────
      const classifyStart = nowMs();
      const pageType = await classifyPageType(page, opts.ki);
      recordStep(steps, 'classify-page', classifyStart, true, { type: pageType.type, url: page.url() });

      if (pageType.type === 'agb-form') {
        if (agbLoops >= MAX_AGB_LOOPS) {
          return { ok: false, reason: `Max. ${MAX_AGB_LOOPS} AGB-Loops erreicht — Seite bleibt AGB-Form` };
        }
        agbLoops++;
        const fillStart = nowMs();
        try {
          const filled = await fillAgbAndSubmit(page, opts.agbFreigabe);
          if (filled.blocked) {
            recordStep(steps, 'fill-agb', fillStart, false, {}, filled.blocked);
            return { ok: false, reason: filled.blocked };
          }
          recordStep(steps, 'fill-agb', fillStart, true, filled);
          currentUrl = page.url();
          continue; // nächste Schleife: klassifiziere neue Seite
        } catch (e: any) {
          recordStep(steps, 'fill-agb', fillStart, false, {}, e?.message || String(e));
          return { ok: false, reason: `AGB-Submit fehlgeschlagen: ${e?.message || e}` };
        }
      }

      if (pageType.type === 'expose-page') {
        // Versuch 1: bis zu 2 Download-Kandidaten (mehr sprengt Timeout bei langsamen Servern)
        const triedDownloads = new Set<string>();
        const MAX_DOWNLOAD_ATTEMPTS = 2;
        const downloadAttempts: Array<{ type: string; conf: number; complete: string; size: number; missing: string[] }> = [];

        for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
          if (isAborted()) return { ok: false, reason: 'Abgebrochen' };
          const downloadStart = nowMs();
          const dl = await detectAndDownload(page, triedDownloads);
          if (!dl) {
            recordStep(steps, 'download', downloadStart, false, {
              reason: attempt === 1 ? 'kein-download-button' : 'keine weiteren Kandidaten',
              attemptsTried: attempt - 1, downloadAttempts,
            });
            break;
          }
          triedDownloads.add(dl.signature);
          const dlObjektnummer = matchedObjektnummer(dl.downloadedName);
          recordStep(steps, 'download', downloadStart, true, {
            attempt, signature: dl.signature, source: dl.source, size: dl.buf.length,
            datei: dl.downloadedName,
            objektnummerBestaetigt: dlObjektnummer ?? undefined,
          });

          // ── Validierung: ist das wirklich das vollständige Exposé? ──
          const valStart = nowMs();
          const val = await pdfEinordnen(dl.buf, dl.signature, opts.ki, { mailSubject: opts.mailSubject }).catch(e => ({
            type: 'sonstiges' as const, confidence: 0, completeness: 'unklar' as const, missingFields: [], extractedAddress: '', reason: 'Validation-Fehler: ' + (e?.message || e),
          }));
          downloadAttempts.push({
            type: val.type, conf: val.confidence, complete: val.completeness, size: dl.buf.length, missing: val.missingFields,
          });
          recordStep(steps, 'validate-pdf', valStart, true, {
            type: val.type, confidence: val.confidence, completeness: val.completeness,
            missing: val.missingFields, address: val.extractedAddress, reason: val.reason,
          });

          if (val.type === 'expose' && val.confidence >= (dlObjektnummer ? 0.45 : 0.6)) {
            if (val.completeness === 'vollstaendig') {
              return {
                ok: true, pdfBuffer: dl.buf, pdfSource: 'download',
                filename: filenameFromSubject(opts.mailSubject, 'expose-download'),
                finalUrl: page.url(),
              };
            }
            // Preview gemerkt — vielleicht müssen wir Freischalten klicken
            updateBestPreview({
              buf: dl.buf, source: 'download',
              filename: filenameFromSubject(opts.mailSubject, 'expose-preview'),
              cls: val,
            });
          }
          await sleep(1500);
        }

        // ── PRIORITÄT 2: Dokumentenliste — alle klickbaren PDF-Items durchprobieren ──
        // (Vor Print, weil Klick-Download liefert echte PDFs statt Viewer-Screenshots)
        const docItems = await findDocumentListItems(page, triedDownloads);
        if (docItems.length > 0) {
          recordStep(steps, 'doclist-found', nowMs(), true, { count: docItems.length, items: docItems.map(d => d.text) });
          for (const item of docItems.slice(0, 4)) {
            if (isAborted()) break;
            const dlStart = nowMs();
            const dl = await clickDocumentItem(page, item.sig);
            if (!dl) {
              recordStep(steps, 'doclist-click', dlStart, false, { item: item.text });
              continue;
            }
            triedDownloads.add(item.sig);
            const itemObjektnummer = matchedObjektnummer(dl.downloadedName);
            const itemValStart = nowMs();
            const itemVal = await pdfEinordnen(dl.buf, item.text, opts.ki, { mailSubject: opts.mailSubject }).catch(e => ({
              type: 'sonstiges' as const, confidence: 0, completeness: 'unklar' as const, missingFields: [], extractedAddress: '', reason: String(e),
            }));
            recordStep(steps, 'doclist-validate', itemValStart, true, {
              item: item.text, type: itemVal.type, completeness: itemVal.completeness, address: itemVal.extractedAddress,
              datei: dl.downloadedName, objektnummerBestaetigt: itemObjektnummer ?? undefined,
            });
            if (itemVal.type === 'expose' && itemVal.confidence >= (itemObjektnummer ? 0.45 : 0.6)) {
              if (itemVal.completeness === 'vollstaendig') {
                return {
                  ok: true, pdfBuffer: dl.buf, pdfSource: 'download',
                  filename: filenameFromSubject(opts.mailSubject, 'expose-doclist'),
                  finalUrl: page.url(),
                };
              }
              updateBestPreview({
                buf: dl.buf, source: 'download',
                filename: filenameFromSubject(opts.mailSubject, 'expose-doclist-preview'),
                cls: itemVal,
              });
            }
          }
        }

        // ── Recovery: Preview gefunden, aber kein vollständiges Exposé?
        //    Suche aktiv nach Freischalten-Buttons + AGB-Loop nochmal anstoßen ──
        if (bestPreviewRef.value && bestPreviewRef.value.cls.completeness === 'eingeschraenkt' && agbLoops < MAX_AGB_LOOPS) {
          const unlockStart = nowMs();
          const unlockClicked = await tryClickUnlockButton(page);
          recordStep(steps, 'unlock-attempt', unlockStart, !!unlockClicked, { clicked: unlockClicked });
          if (unlockClicked) {
            await sleep(2500);
            currentUrl = page.url();
            continue;
          }
        }

        // ── LETZTER AUSWEG: Print-PDF (Screenshot-ähnlich, oft niedrige Qualität) ──
        if (isAborted()) return { ok: false, reason: 'Abgebrochen' };
        // Nachzügler-Banner würden das Druckbild überlagern (R6).
        await dismissCookieBanner('vor-print');
        const printStart = nowMs();
        let printBuf: Buffer;
        try {
          printBuf = await printPageAsPdf(page);
          recordStep(steps, 'print', printStart, true, { size: printBuf.length, url: page.url(), note: 'last-resort' });
        } catch (e: any) {
          recordStep(steps, 'print', printStart, false, {}, e?.message || String(e));
          if (bestPreviewRef.value) {
            const bp = bestPreviewRef.value;
            return {
              ok: true, pdfBuffer: bp.buf, pdfSource: bp.source,
              filename: bp.filename, finalUrl: page.url(),
              reason: `⚠️ Nur EINGESCHRÄNKTES Exposé verfügbar (fehlt: ${bp.cls.missingFields.join(', ') || 'unklar'})`,
            };
          }
          return {
            ok: false,
            reason: `Print fehlgeschlagen: ${e?.message || e}. Downloads: ${downloadAttempts.map(d => `${d.type}/${d.complete}`).join(', ') || 'keine'}`,
          };
        }

        const valPStart = nowMs();
        const valP = await pdfEinordnen(printBuf, 'landing-print', opts.ki, { mailSubject: opts.mailSubject }).catch(e => ({
          type: 'sonstiges' as const, confidence: 0, completeness: 'unklar' as const, missingFields: [], extractedAddress: '', reason: 'Validation-Fehler: ' + (e?.message || e),
        }));
        recordStep(steps, 'validate-pdf', valPStart, true, {
          source: 'print', type: valP.type, confidence: valP.confidence,
          completeness: valP.completeness, missing: valP.missingFields,
          address: valP.extractedAddress, reason: valP.reason,
        });

        if (valP.type === 'expose' && valP.confidence >= 0.6) {
          if (valP.completeness === 'vollstaendig') {
            return {
              ok: true, pdfBuffer: printBuf, pdfSource: 'print',
              filename: filenameFromSubject(opts.mailSubject, 'expose-landingpage'),
              finalUrl: page.url(),
            };
          }
          updateBestPreview({
            buf: printBuf, source: 'print',
            filename: filenameFromSubject(opts.mailSubject, 'expose-landingpage-preview'),
            cls: valP,
          });
        }

        // ── Letzter Ausweg: bestes Preview liefern + warnen ──
        if (bestPreviewRef.value) {
          const bp = bestPreviewRef.value;
          return {
            ok: true, pdfBuffer: bp.buf, pdfSource: bp.source,
            filename: bp.filename, finalUrl: page.url(),
            reason: `⚠️ Nur EINGESCHRÄNKTES Exposé gefunden (fehlt: ${bp.cls.missingFields.join(', ') || 'unklar'}). Vollständiges nicht freischaltbar.`,
          };
        }

        // Wirklich nichts brauchbares
        const summary = [
          ...downloadAttempts.map(d => `DL:${d.type}/${d.complete}(${d.conf.toFixed(2)})`),
          `Print:${valP.type}/${valP.completeness}(${valP.confidence.toFixed(2)})`,
        ].join(', ');
        return { ok: false, reason: `Kein Exposé gefunden. ${summary}` };
      }

    // 'unknown' → Abbruch
    return { ok: false, reason: `Seitentyp unbekannt — User-Review nötig` };
  }
}
