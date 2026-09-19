// Übernommen aus gg-immohandel server/expose-triage.ts (Stand 9d693b8), inhaltlich unverändert.
/**
 * Stufe 0 der Exposé-Erkennung — Triage.
 *
 * Beantwortet vor jedem teuren Schritt die Frage: **Wo steckt das Exposé?**
 * Reine Funktion — kein Netzwerk, kein Browser, kein LLM. Damit vollständig
 * unit-testbar und kostenlos.
 *
 * Umgesetzte Regeln aus docs/EXPOSE-MAIL-IMPORT-ANFORDERUNGEN.md:
 *   R1  Anhangsname als Vorfilter (Rechtsdokument / Zusatzunterlage / Kandidat)
 *   R3  Freischaltweg erkennen
 *   R7  Objektnummer als Verifikationssignal
 *   R8  keine feste Quellen-Rangfolge, sondern Rangliste nach Erwartungswert
 *   R9  Ankündigungen erkennen
 */

// ── Öffentliche Typen ───────────────────────────────────────────

export type TriageCode =
  | 'ATTACHMENT'
  | 'BODY'
  | 'LINK_LANDING_OPEN'
  | 'LINK_LANDING_LOCKED'
  | 'LINK_DIRECT_PDF'
  | 'SUPPLEMENT'
  | 'ANNOUNCEMENT'
  | 'NONE';

export type AttachmentClass = 'legal' | 'supplement' | 'expose' | 'unknown';

export interface TriageAttachmentInput {
  filename: string;
  sizeMB?: number;
  /** aus graph.ts: pdf | spreadsheet | document | image | other */
  kind?: string;
}

export interface TriageInput {
  from?: string;
  subject?: string;
  bodyText?: string;
  attachments?: TriageAttachmentInput[];
  links?: string[];
}

export interface TriageCandidate {
  source: 'attachment' | 'body' | 'link';
  /** Dateiname, URL oder 'body' */
  ref: string;
  code: TriageCode;
  score: number;
  why: string[];
}

export interface TriageFact {
  key: string;
  label: string;
  weight: number;
  evidence: string;
}

export interface TriageResult {
  verdict: TriageCode;
  candidates: TriageCandidate[];
  reasons: string[];
  /** Substanz des Mailtextes, 0–100 */
  bodyScore: number;
  facts: TriageFact[];
  objektnummern: string[];
  unlockSignals: string[];
  announcementSignals: string[];
  /** Rechtsdokumente — nie Exposé, nie herunterladen (R1, R4) */
  legalAttachments: string[];
  /** Zusatzunterlagen — nie das Exposé, aber als Beleg verwertbar (R1) */
  supplementAttachments: string[];
  ignoredLinks: string[];
}

/** Ab diesem Punktwert wird ein Kandidat überhaupt verfolgt. */
export const MIN_CANDIDATE_SCORE = 35;

// ── R1: Anhangsnamen-Muster ─────────────────────────────────────

const LEGAL_PATTERNS: Array<[RegExp, string]> = [
  [/widerruf/i, 'Widerruf'],
  [/maklervertrag|maklerauftrag/i, 'Maklervertrag'],
  [/verbraucherinfo/i, 'Verbraucherinformation'],
  [/datenschutz|dsgvo/i, 'Datenschutz'],
  [/informationspflicht/i, 'Informationspflicht'],
  [/willenserkl[äa]rung/i, 'Willenserklärung'],
  [/\bagb\b|allgemeine[_\s-]?gesch[äa]ftsbedingungen/i, 'AGB'],
  [/provisionsvereinbarung|nachweisvereinbarung/i, 'Provisionsvereinbarung'],
  [/vertraulichkeit|geheimhaltung|\bnda\b/i, 'Vertraulichkeitserklärung'],
];

const SUPPLEMENT_PATTERNS: Array<[RegExp, string]> = [
  [/grundriss/i, 'Grundriss'],
  [/ansicht/i, 'Ansicht'],
  [/schnitt/i, 'Schnitt'],
  [/berechnung/i, 'Berechnung'],
  [/lageplan|katasterplan|flurkarte/i, 'Lageplan'],
  [/[üu]bersichtsplan|[üu]bersichtspl[äa]ne/i, 'Übersichtsplan'],
  [/mieterliste|mietaufstellung/i, 'Mieterliste'],
  [/fl[äa]chenaufstellung|fl[äa]chenberechnung/i, 'Flächenaufstellung'],
  [/energieausweis|energiepass/i, 'Energieausweis'],
  [/baulast/i, 'Baulasten'],
  [/altlast/i, 'Altlasten'],
  [/bebauungsplan|\bb-?plan\b/i, 'Bebauungsplan'],
  [/teilungserkl[äa]rung/i, 'Teilungserklärung'],
  [/protokoll/i, 'Protokoll'],
  [/grundbuch/i, 'Grundbuch'],
  [/baugesuch|bauantrag/i, 'Baugesuch'],
];

/**
 * R4 — Dokumente, die im Browser niemals angeklickt oder heruntergeladen werden.
 * Als String, damit dieselbe Regel auch im Seitenkontext (page.evaluate) gilt
 * und es nur eine Fassung der Liste gibt.
 */
export const NEVER_DOWNLOAD_SOURCE = [
  'widerruf',
  'maklervertrag', 'maklerauftrag',
  'verbraucherinfo',
  'willenserkl',
  'informationspflicht',
  'provisionsvereinbarung', 'nachweisvereinbarung',
  'vertraulichkeit', 'geheimhaltung',
  'datenschutz', 'dsgvo',
  'impressum',
  '\\bagb\\b', 'allgemeine[ _-]?gesch[äa]ftsbedingungen',
  'einverst[äa]ndniserkl', 'einwilligungserkl',
].join('|');

/** Prüft Linktext oder Dateiname gegen die R4-Sperrliste. */
export function isNeverDownload(text: string): boolean {
  return new RegExp(NEVER_DOWNLOAD_SOURCE, 'i').test(text || '');
}

const EXPOSE_PATTERNS: Array<[RegExp, string]> = [
  [/expos[eé]{1,2}/i, 'Exposé'],
  [/objektpr[äa]sentation/i, 'Objektpräsentation'],
  [/objektbeschreibung|objektdaten|objektunterlage/i, 'Objektbeschreibung'],
  [/teaser/i, 'Teaser'],
  [/objektangebot|kaufangebot|verkaufsunterlage/i, 'Angebot'],
  [/pr[äa]sentation/i, 'Präsentation'],
];

/** Klassifiziert einen Anhang allein anhand seines Namens (R1). */
export function classifyAttachmentName(filename: string): {
  cls: AttachmentClass;
  why: string[];
} {
  const name = filename || '';
  for (const [re, label] of LEGAL_PATTERNS) {
    if (re.test(name)) return { cls: 'legal', why: [`Rechtsdokument (${label})`] };
  }
  for (const [re, label] of SUPPLEMENT_PATTERNS) {
    if (re.test(name)) return { cls: 'supplement', why: [`Zusatzunterlage (${label})`] };
  }
  for (const [re, label] of EXPOSE_PATTERNS) {
    if (re.test(name)) return { cls: 'expose', why: [`Exposé-Signal im Dateinamen (${label})`] };
  }
  return { cls: 'unknown', why: ['Dateiname ohne Aussage'] };
}

// ── R3: Freischaltsignale ───────────────────────────────────────

const UNLOCK_PATTERNS: Array<[RegExp, string]> = [
  [/freischalt/i, '„freischalten"'],
  [/details\s+ansehen/i, '„Details ansehen"'],
  [/vollst[äa]ndige[nrs]?\s+expos[eé]/i, '„vollständiges Exposé"'],
  [/vollst[äa]ndige\s+adresse/i, '„vollständige Adresse"'],
  [/vollst[äa]ndige[nr]?\s+objektinformationen/i, '„vollständige Objektinformationen"'],
  [/unterlagen\s+anfordern/i, '„Unterlagen anfordern"'],
];

/** Plattformen, bei denen die Landingpage erfahrungsgemäß eine Freischaltstrecke hat (F7). */
const LOCKED_PLATFORMS: Array<[RegExp, string]> = [
  [/immo\.fio\.de\/webexposee/i, 'fio-Web-Exposé mit Freischaltstrecke'],
  [/\/expose\/vorschau|\/vorschau\?|\/preview\?/i, 'Vorschau-Ansicht, Vollversion dahinter'],
];

// ── R9: Ankündigungssignale ─────────────────────────────────────

const ANNOUNCEMENT_PATTERNS: Array<[RegExp, string]> = [
  [/w[üu]rde ich (?:dir|ihnen)[^.]{0,30}(?:zuschicken|zusenden|schicken|senden)/i, '„würde ich zuschicken"'],
  [/bekommen (?:wir )?bald|kommt demn[äa]chst|in K[üu]rze in die Vermarktung/i, '„bald in die Vermarktung"'],
  [/sobald (?:das|die|der) [^.]{0,40}(?:vorliegt|fertig|bereit)/i, '„sobald es vorliegt"'],
  [/(?:sende|schicke) ich (?:dir|ihnen)[^.]{0,40}(?:nach|zu, sobald|gerne zu)/i, '„sende ich nach"'],
  [/nach (?:R[üu]ckmeldung|Ihrer R[üu]ckmeldung|unterschriebener|Unterzeichnung)/i, '„nach Rückmeldung/Unterschrift"'],
  [/bei Interesse[^.]{0,40}(?:melden|zuschicken|zusenden)/i, '„bei Interesse melden"'],
];

// ── Link-Bewertung ──────────────────────────────────────────────

const LINK_POSITIVE = /(expose|exposee|expos[eé]|landingpage|webexposee|\/objekt|\/einheit|\/immobilie|\/property)/i;

const LINK_NEGATIVE: Array<[RegExp, string]> = [
  [/abmeld|unsubscribe|newsletter[_-]?off|opt[_-]?out/i, 'Abmeldelink'],
  [/datenschutz|dsgvo|privacy|informationspflicht|pflichtangaben|disclosure|impressum|agb|rechtliches/i, 'Rechtstext'],
  [/\/cdn\/|\/media\/|\/tracking|awstrack|utm_content=header_logo/i, 'Asset-/Trackinglink'],
  [/outlook\.office\.com|bookwithme|calendly/i, 'Terminlink'],
  [/maps\.(?:app\.)?goo\.gl|maps\.google/i, 'Kartenlink'],
  [/suchprofil|searchagent|angebot-melden|sicherheit\./i, 'Portalfunktion'],
];

// ── Body-Substanz ───────────────────────────────────────────────

const SIGNATURE_MARKER =
  /(mit freundlichen gr[üu]ßen|freundliche gr[üu]ße|viele gr[üu]ße|beste gr[üu]ße|herzliche gr[üu]ße|mit besten gr[üu]ßen|liebe gr[üu]ße|mit kollegialen gr[üu]ßen)/i;

/**
 * Schneidet die Signatur ab. Ohne das zählen Absenderanschrift und
 * PLZ aus dem Briefkopf als Objektdaten — der häufigste Fehlschluss.
 * Erst ab 150 Zeichen, damit sehr kurze Mails nicht komplett wegfallen.
 */
export function stripSignature(bodyText: string): string {
  const text = bodyText || '';
  const m = SIGNATURE_MARKER.exec(text);
  if (m && m.index >= 150) return text.substring(0, m.index);
  return text;
}

interface FactRule {
  key: string;
  label: string;
  weight: number;
  re: RegExp;
  /** Zusätzliche Prüfung des Treffers; false verwirft ihn. */
  accept?: (m: RegExpExecArray) => boolean;
}

/** Untergrenze, ab der ein Betrag als Kaufpreis gilt — trennt Preis von Provision und Miete. */
const MIN_KAUFPREIS = 100_000;

function germanAmount(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(/,\d{2}$/, ''));
}

const FACT_RULES: FactRule[] = [
  {
    key: 'kaufpreis',
    label: 'Kaufpreis',
    weight: 22,
    // Betrag mit Tausenderpunkten, davor oder dahinter eine Währungsangabe.
    re: /(?:(?:€|EUR|Euro)\s*(\d{1,3}(?:\.\d{3})+(?:\s*,\d{2})?)|(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)\s*(?:€|EUR|Euro))/gi,
    accept: m => germanAmount((m[1] || m[2] || '').replace(/\s/g, '')) >= MIN_KAUFPREIS,
  },
  { key: 'strasse', label: 'Straße + Hausnummer', weight: 15,
    re: /\b[A-ZÄÖÜ][a-zäöüß]+(?:[a-zäöüß-]*)[\s-]?(?:stra[ßs]e|str\.|weg|allee|platz|gasse|ring|damm)\s+\d{1,4}\s*[a-z]?\b/i },
  { key: 'plzOrt', label: 'PLZ + Ort', weight: 12, re: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß-]{2,}/ },
  { key: 'wohnflaeche', label: 'Wohnfläche', weight: 12,
    re: /wohnfl[äa]che[^.\n]{0,30}?[\d.,]+|[\d.,]+\s*(?:m²|m2|qm)\s*wohnfl/i },
  { key: 'miete', label: 'Mieteinnahmen', weight: 12,
    re: /jahres(?:netto|kalt)?(?:miete|einnahmen|mieteinnahmen)|nettokaltmiete|mieteinnahmen|jahresmiete|ist-?miete|miterl[öo]s|miet(?:ertr[äa]ge|einnahme)/i },
  { key: 'einheiten', label: 'Einheiten / Zimmer', weight: 10,
    re: /[\d.,]{1,6}[\s-]*(?:[a-zäöüß]+[\s-]+){0,2}(?:wohnungen|wohneinheiten|einheiten|zimmerwohnung|zimmer|zi\.)|(?:zimmer|wohneinheiten|einheiten)\s*:\s*[\d.,]+/i },
  { key: 'grundstueck', label: 'Grundstücksfläche', weight: 8,
    re: /grundst[üu]ck[a-zäöüß]*[^.\n]{0,30}?[\d.,]+|[\d.,]+\s*(?:m²|m2|qm)\s*(?:gro[ßs]|grundst)/i },
  { key: 'baujahr', label: 'Baujahr', weight: 8, re: /baujahr[^.\n]{0,15}?(?:1[89]\d{2}|20[0-2]\d)/i },
  { key: 'flurstueck', label: 'Flurstück', weight: 6, re: /flurst[üu]ck|flst\./i },
  { key: 'rendite', label: 'Rendite / Faktor', weight: 5, re: /rendite|faktor\s*[\d,]+|vervielf[äa]lt/i },
  { key: 'stellplaetze', label: 'Stellplätze', weight: 4, re: /stellpl[äa]tz|tiefgarage|carport|garagen/i },
  { key: 'objektnummer', label: 'Objektnummer', weight: 4, re: /objekt(?:nummer|nr\.?)/i },
];

/**
 * Erster Treffer, der auch die Zusatzprüfung besteht. Globale Muster werden
 * durchlaufen, bis ein gültiger Treffer gefunden ist (z. B. Provisionsbetrag
 * überspringen und den Kaufpreis dahinter nehmen).
 */
function firstAccepted(rule: FactRule, text: string): string | null {
  if (!rule.re.global) {
    const m = rule.re.exec(text);
    return m && (!rule.accept || rule.accept(m)) ? m[0] : null;
  }
  rule.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rule.re.exec(text)) !== null) {
    if (!rule.accept || rule.accept(m)) {
      rule.re.lastIndex = 0;
      return m[0];
    }
  }
  return null;
}

/** Punktwert der im Mailtext erkennbaren Objektdaten (0–100). */
export function scoreBodySubstance(bodyText: string): { score: number; facts: TriageFact[] } {
  const text = stripSignature(bodyText);
  const facts: TriageFact[] = [];
  let sum = 0;
  for (const rule of FACT_RULES) {
    const hit = firstAccepted(rule, text);
    if (!hit) continue;
    facts.push({
      key: rule.key,
      label: rule.label,
      weight: rule.weight,
      evidence: hit.trim().substring(0, 80),
    });
    sum += rule.weight;
  }
  return { score: Math.min(100, sum), facts };
}

/** Objektnummern aus dem Mailtext (R7). */
export function extractObjektnummern(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /objekt(?:nummer|nr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9._\-/]{2,24})/gi,
    /referenz(?:nummern?|nr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9._\-/]{2,24})/gi,
    /expos[eé]\s*(?:nr\.?|nummer)?\s*([A-Z]{2,4}[0-9][A-Za-z0-9\-/]{2,20})/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text || '')) !== null) {
      const v = m[1]!.replace(/[.,;:]+$/, ''); // Neubau: ! für noUncheckedIndexedAccess
      if (v.length >= 3) out.add(v);
    }
  }
  return [...out];
}

function matchAll(patterns: Array<[RegExp, string]>, text: string): string[] {
  return patterns.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function containsObjektnummer(haystack: string, nummern: string[]): string | null {
  const norm = haystack.toLowerCase().replace(/[\s._-]/g, '');
  for (const n of nummern) {
    const k = n.toLowerCase().replace(/[\s._-]/g, '');
    if (k.length >= 4 && norm.includes(k)) return n;
  }
  return null;
}

// ── Hauptfunktion ───────────────────────────────────────────────

export function triageMail(input: TriageInput): TriageResult {
  const bodyText = input.bodyText || '';
  const subject = input.subject || '';
  const attachments = input.attachments || [];
  const links = input.links || [];

  const reasons: string[] = [];
  const candidates: TriageCandidate[] = [];
  const legalAttachments: string[] = [];
  const supplementAttachments: string[] = [];
  const ignoredLinks: string[] = [];

  const objektnummern = extractObjektnummern(`${subject}\n${bodyText}`);
  const bodyForSignals = stripSignature(bodyText);
  const unlockSignals = matchAll(UNLOCK_PATTERNS, bodyForSignals);
  const announcementSignals = matchAll(ANNOUNCEMENT_PATTERNS, bodyForSignals);

  // ── Anhänge (R1) ──
  const pdfCount = attachments.filter(
    a => (a.kind ? a.kind === 'pdf' : /\.pdf$/i.test(a.filename)),
  ).length;
  // Mail 05: 17 Anhänge und trotzdem kein Exposé. Viele Anhänge sind ein
  // Gegenindiz — nichtssagende Dateinamen werden bei Masse abgewertet.
  const unknownBase = pdfCount <= 3 ? 40 : 12;

  for (const att of attachments) {
    const isPdf = att.kind ? att.kind === 'pdf' : /\.pdf$/i.test(att.filename);
    const isImage = att.kind === 'image' || /\.(jpe?g|png|gif|bmp|webp)$/i.test(att.filename);
    const { cls, why } = classifyAttachmentName(att.filename);

    if (cls === 'legal') {
      legalAttachments.push(att.filename);
      reasons.push(`${att.filename}: ${why[0]} — nie Exposé, keine Bilderkennung (R1/R4)`);
      continue;
    }
    if (cls === 'supplement') {
      supplementAttachments.push(att.filename);
      continue;
    }
    if (isImage) continue;

    const reason = [...why];
    let score = cls === 'expose' ? 70 : unknownBase;
    if (cls === 'unknown' && !isPdf) score = 10;
    if (cls === 'unknown' && unknownBase === 12) {
      reason.push(`${pdfCount} PDF-Anhänge — Masse spricht gegen ein Exposé`);
    }

    const hit = containsObjektnummer(att.filename, objektnummern);
    if (hit) {
      score += 15;
      reason.push(`Objektnummer ${hit} aus dem Mailtext im Dateinamen (R7)`);
    }
    if (typeof att.sizeMB === 'number') {
      if (att.sizeMB >= 0.5) {
        score += 5;
        reason.push(`${att.sizeMB.toFixed(2)} MB — Umfang passt zu einem Exposé`);
      } else if (att.sizeMB < 0.1) {
        score -= 20;
        reason.push(`nur ${att.sizeMB.toFixed(2)} MB — zu dünn für ein Exposé`);
      }
    }

    candidates.push({
      source: 'attachment',
      ref: att.filename,
      code: 'ATTACHMENT',
      score: Math.max(0, Math.min(100, score)),
      why: reason,
    });
  }

  // ── Links ──
  for (const url of links) {
    const negative = LINK_NEGATIVE.find(([re]) => re.test(url));
    if (negative) {
      ignoredLinks.push(`${url} — ${negative[1]}`);
      continue;
    }
    if (!LINK_POSITIVE.test(url)) {
      ignoredLinks.push(`${url} — kein Exposé-Muster`);
      continue;
    }

    const why = ['Exposé-Muster in der Adresse'];
    let score = 65;

    if (/\.pdf(\?|$)/i.test(url)) {
      why.push('Link zeigt direkt auf ein PDF');
      candidates.push({ source: 'link', ref: url, code: 'LINK_DIRECT_PDF', score: 85, why });
      continue;
    }

    const longToken = /[A-Za-z0-9%_=-]{24,}/.test(url.replace(/^https?:\/\/[^/]+/, ''));
    if (longToken) {
      score += 5;
      why.push('objektspezifischer Token in der Adresse');
    }
    const hit = containsObjektnummer(url, objektnummern);
    if (hit) {
      score += 10;
      why.push(`Objektnummer ${hit} aus dem Mailtext in der Adresse (R7)`);
    }

    const platform = LOCKED_PLATFORMS.find(([re]) => re.test(url));
    const locked = Boolean(platform) || unlockSignals.length > 0;
    if (locked) {
      score += 15;
      why.push(
        platform
          ? `Freischaltstrecke erwartbar: ${platform[1]} (R3)`
          : `Freischaltsignal im Mailtext: ${unlockSignals.join(', ')} (R3)`,
      );
    }

    candidates.push({
      source: 'link',
      ref: url,
      code: locked ? 'LINK_LANDING_LOCKED' : 'LINK_LANDING_OPEN',
      score: Math.min(100, score),
      why,
    });
  }

  // ── Body (wird immer bewertet, auch bei starkem Link) ──
  const { score: bodyScore, facts } = scoreBodySubstance(bodyText);
  candidates.push({
    source: 'body',
    ref: 'body',
    code: 'BODY',
    score: bodyScore,
    why: facts.length
      ? [`erkannte Objektdaten: ${facts.map(f => f.label).join(', ')}`]
      : ['keine Objektdaten im Mailtext erkennbar'],
  });

  // ── Rangliste (R8) ──
  const sourceRank: Record<TriageCandidate['source'], number> = { attachment: 0, link: 1, body: 2 };
  candidates.sort((a, b) => b.score - a.score || sourceRank[a.source] - sourceRank[b.source]);

  const best = candidates[0];
  let verdict: TriageCode;

  if (best && best.score >= MIN_CANDIDATE_SCORE) {
    verdict = best.code;
    reasons.unshift(`Beste Quelle: ${best.source} „${best.ref}" (${best.score} Punkte)`);
  } else if (announcementSignals.length > 0) {
    verdict = 'ANNOUNCEMENT';
    reasons.unshift(
      `Ankündigung ohne belastbare Daten (${announcementSignals.join(', ')}) — Wiedervorlage statt Objekt (R9)`,
    );
  } else if (supplementAttachments.length > 0) {
    verdict = 'SUPPLEMENT';
    reasons.unshift(
      `Kein Exposé, aber ${supplementAttachments.length} Zusatzunterlage(n) — Beleg zu einem bekannten Objekt`,
    );
  } else {
    verdict = 'NONE';
    reasons.unshift('Keine verwertbare Quelle: kein Exposé-Anhang, kein Exposé-Link, kein Objektdaten im Mailtext');
  }

  // Mail 04: Anhang ist das Exposé, der Mailtext kündigt zusätzlich ein
  // zweites Objekt an. Beides muss sichtbar bleiben.
  if (verdict !== 'ANNOUNCEMENT' && announcementSignals.length > 0 && bodyScore < MIN_CANDIDATE_SCORE) {
    reasons.push(`Zusätzlich angekündigtes Objekt ohne Daten (${announcementSignals.join(', ')}) — Wiedervorlage (R9)`);
  }
  if (verdict !== 'SUPPLEMENT' && supplementAttachments.length > 0) {
    reasons.push(`${supplementAttachments.length} Zusatzunterlage(n) als Beleg verwertbar: ${supplementAttachments.join(', ')}`);
  }

  return {
    verdict,
    candidates,
    reasons,
    bodyScore,
    facts,
    objektnummern,
    unlockSignals,
    announcementSignals,
    legalAttachments,
    supplementAttachments,
    ignoredLinks,
  };
}
