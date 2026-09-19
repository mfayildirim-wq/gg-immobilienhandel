/* eslint-disable @typescript-eslint/no-explicit-any -- Makler und Kommunikation im Altformat (komm[].ts als deutscher Zeitstempel) */
/**
 * Persona/Beziehungsdaten des Maklers ohne KI und ohne Speicher. Wörtlich aus gg-immohandel src/modules/persona/persona.ts
 * (Typen, Konfidenz, Sammeln der ausgehenden Kommunikation, Sortierschlüssel, Du/Sie-Erkennung; `DB.makler()` als Parameter, `!` für strikte Typen),
 * dazu die Zusammenführungsregeln aus personaExtractPersonalDetails/personaExtractMentions und der Geburtstagshinweis
 * aus personaDraftMessage.
 */

export interface PersonaProfile {
  analysisTs: string;
  commAnalyzed: number;
  confidence: number;
  anrede: string;
  abschluss: { wa: string; email: string };
  tonWA: string;
  tonEmail: string;
  themenMuster: string;
  vokabular: string;
  laenge: { wa: string; email: string };
  rawAnalysis: string;
}

export interface DraftResult {
  wa: string;
  email: { subject: string; body: string };
}

export interface MaklerErwaehnung {
  ts: string;     // "DD.MM.YYYY"
  thema: string;  // "Fußball" | "Urlaub" | "Familie" | "Haustier" etc.
  detail: string; // "BVB-Fan, hat das gestrige Spiel erwähnt"
}

export interface PersonenInfo {
  ts: string;                          // Zeitpunkt der OSINT-Suche
  allgemein?: Array<{                  // Allgemeine Web-Suchergebnisse
    titel: string;
    url: string;
    snippet: string;
  }>;
  handelsregister?: {                  // Handelsregister-Daten (aus HR-Suche extrahiert)
    hrNummer?: string;                 // z.B. "HRB 12345"
    amtsgericht?: string;             // z.B. "Stuttgart"
    rechtsform?: string;              // z.B. "GmbH"
    quelleUrl?: string;
  };
  xingUrl?: string;                   // XING-Profil-URL (wenn gefunden)
  linkedinUrl?: string;               // LinkedIn-Profil-URL (wenn gefunden)
}

export interface MaklerPersonal {
  geburtsdatum?: string;          // YYYY-MM-DD oder MM-DD
  geburtstagQuelle?: string;      // 'manuell' | 'KI-extrahiert'
  letzteErwaehnung?: MaklerErwaehnung[];
  personenInfo?: PersonenInfo;    // OSINT: Web-Suche + Handelsregister
}


// ── Konfidenz-Berechnung (ohne API) ─────────────────────────

export function personaGetConfidence(makler: any[]): number {
  let outgoing = 0;
  let hasWA = false, hasEmail = false, hasAnruf = false;

  for (const mk of makler) {
    const komm: any[] = mk.komm || [];
    for (const k of komm) {
      if (k.richtung !== 'ausgehend') continue;
      outgoing++;
      if (k.kanal === 'whatsapp') hasWA = true;
      if (k.kanal === 'email')    hasEmail = true;
      if (k.kanal === 'anruf')    hasAnruf = true;
    }
  }

  const diversity = (hasWA ? 15 : 0) + (hasEmail ? 15 : 0) + (hasAnruf ? 10 : 0);
  return Math.min(100, outgoing * 4 + diversity);
}

export function collectOutgoingComm(makler: any[]): { entries: any[]; total: number } {
  const entries: any[] = [];

  for (const mk of makler) {
    const komm: any[] = mk.komm || [];
    for (const k of komm) {
      if (k.richtung !== 'ausgehend' || !k.text?.trim()) continue;
      entries.push({
        makler: mk.name || 'Unbekannt',
        kanal: k.kanal,
        ts: k.ts,
        betreff: k.betreff || undefined,
        text: k.text.trim()
      });
    }
  }

  // Höchstens 80 Einträge für den Prompt — und zwar die NEUESTEN.
  //
  // `slice(0, 80)` nahm die ersten 80 der Sammelreihenfolge: Makler für Makler,
  // innerhalb eines Maklers die Kommunikation in Speicherreihenfolge. Bei mehr
  // als 80 ausgehenden Nachrichten analysierte die Stilanalyse damit die
  // ältesten Nachrichten der zuerst angelegten Makler — je länger die App im
  // Einsatz war, desto veralteter das Ergebnis, und die neuesten Nachrichten
  // sah sie nie.
  //
  // Sortiert wird über `sortierschluessel`, weil `ts` uneinheitlich ist
  // (deutsches Datum, ISO, "Altbestand"). Was sich nicht lesen lässt, gilt als
  // alt und rutscht ans Ende — nie an den Anfang.
  const sortiert = [...entries].sort((a, b) => sortierschluessel(b.ts) - sortierschluessel(a.ts));
  return { entries: sortiert.slice(0, 80), total: entries.length };
}

/** Zeitstempel einer Kommunikationszeile als Zahl. 0 = unbekannt (ganz hinten).
 *  Die Sammlung kennt drei Schreibweisen nebeneinander: "D.M.YYYY [HH:MM]" aus
 *  `toLocaleDateString('de-DE')` (ohne führende Nullen!), ISO und den
 *  Platzhalter "Altbestand" aus der Notizen-Migration. */
export function sortierschluessel(ts: any): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts !== 'string') return 0;
  const de = ts.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (de) {
    const [, d, m, y, hh, mm] = de;
    return Date.UTC(+y!, +m! - 1, +d!, hh ? +hh : 0, mm ? +mm : 0);
  }
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

export function personaDetectAnrede(komm: any[]): 'du' | 'sie' | 'unbekannt' {
  const outgoing = komm.filter((k: any) => k.richtung === 'ausgehend');
  let duCount = 0, sieCount = 0;

  for (const k of outgoing) {
    const raw  = k.text || '';
    const lower = raw.toLowerCase();
    // Du-Indikatoren (kleingeschrieben im Text)
    if (/\b(du|dich|dir|dein|deine|deinen|deiner|deinem|hast du|bist du|machst du|kannst du|willst du|wirst du|schreib mir|ruf mich|lass mich)\b/.test(lower)) duCount++;
    // Sie-Indikatoren (großgeschrieben, daher auf original prüfen)
    if (/\b(Ihnen|Ihr\b|Ihre\b|Ihren|Ihrer|Ihrem|haben Sie|sind Sie|können Sie|wollen Sie|werden Sie|schreiben Sie|rufen Sie|lassen Sie)\b/.test(raw)) sieCount++;
  }

  if (duCount > 0 && duCount >= sieCount) return 'du';
  if (sieCount > 0 && sieCount > duCount) return 'sie';
  return 'unbekannt';
}

/**
 * personaExtractPersonalDetails (Zusammenführen): gefüllte vorhandene Werte gewinnen (Leerstring/leere Liste zählen nicht),
 * Erwähnungen aus der Extraktion kommen vor die vorhandenen (max. 20).
 */
export function persoenlichesZusammenfuehren(existing: MaklerPersonal & Record<string, any>, extracted: Partial<MaklerPersonal> & Record<string, any>): MaklerPersonal & Record<string, any> {
  const gesetzt: Record<string, any> = {};
  for (const [k, v] of Object.entries(existing || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    gesetzt[k] = v;
  }
  const neu: any = { ...extracted, ...gesetzt };
  if ((extracted as any).letzteErwaehnung?.length) {
    const prev: MaklerErwaehnung[] = existing?.letzteErwaehnung || [];
    neu.letzteErwaehnung = [...(extracted as any).letzteErwaehnung, ...prev].slice(0, 20);
  }
  return neu;
}

/** personaExtractMentions: neue Erwähnungen (mit Tagesdatum `heuteDe` wie toLocaleDateString('de-DE')) vorn, max. 20. */
export function erwaehnungenAnhaengen(personal: (MaklerPersonal & Record<string, any>) | null | undefined, mentions: { thema: string; detail: string }[], heuteDe: string): MaklerPersonal & Record<string, any> {
  const p: any = { ...(personal || {}) };
  const prev: MaklerErwaehnung[] = p.letzteErwaehnung || [];
  p.letzteErwaehnung = [...mentions.filter((m) => m.thema && m.detail).map((m) => ({ ts: heuteDe, thema: m.thema, detail: m.detail })), ...prev].slice(0, 20);
  return p;
}

/** Erwähnungen nur für Texte ab 25 Zeichen und nicht für das eigene WA-Protokoll (personaExtractMentions). */
export const erwaehnungenPruefen = (text: string) => !!text && text.trim().length >= 25 && text.trim() !== 'WhatsApp-Kontakt initiiert';

/** Geburtstagshinweis im Entwurfs-Prompt (personaDraftMessage); `heute` als lokales Datum. */
export function geburtstagsHinweisEntwurf(geburtsdatum: string | undefined, heute: Date): string {
  const raw = (geburtsdatum || '').trim();
  if (!raw) return '';
  const today = new Date(heute); today.setHours(0, 0, 0, 0);
  let month: number, day: number, birthYear: number | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { const p = raw.split('-').map(Number); birthYear = p[0]; month = p[1]!; day = p[2]!; }
  else if (/^\d{2}-\d{2}$/.test(raw)) { const p = raw.split('-').map(Number); month = p[0]!; day = p[1]!; }
  else return '';
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const thisYear = today.getFullYear();
  let bday = new Date(thisYear, month - 1, day); bday.setHours(0, 0, 0, 0);
  let diff = Math.round((bday.getTime() - today.getTime()) / 86_400_000);
  if (diff < -1) { bday = new Date(thisYear + 1, month - 1, day); diff = Math.round((bday.getTime() - today.getTime()) / 86_400_000); }
  if (diff > 7) return '';
  const alter = birthYear ? thisYear - birthYear + (diff < 0 ? 1 : 0) : undefined;
  const alterStr = alter ? ` (${alter}. Geburtstag)` : '';
  if (diff === 0) return `⚠️ HEUTE IST SEIN/IHR GEBURTSTAG${alterStr}! Herzlichen Glückwunsch einbauen — das ist der perfekte Aufhänger!`;
  if (diff === 1) return `⚠️ Morgen ist sein/ihr Geburtstag${alterStr} — Glückwunsch proaktiv einbauen!`;
  if (diff <= 3) return `⚠️ Geburtstag in ${diff} Tagen${alterStr} — Glückwunsch natürlich einbauen`;
  return `Geburtstag in ${diff} Tagen — wenn passend erwähnen`;
}

/** Konfidenzstufe im Stil-Dialog (personaRenderModal). */
export function personaStufe(konfidenz: number): { label: string; farbe: 'red' | 'orange' | 'yellow' | 'teal'; fehlendFuerLernphase: number } {
  return {
    label: konfidenz < 20 ? '🔴 Zu wenig Daten' : konfidenz < 50 ? '🟡 Lernphase' : konfidenz < 80 ? '🟠 Mittlere Konfidenz' : '🟢 Hohe Konfidenz',
    farbe: konfidenz < 20 ? 'red' : konfidenz < 50 ? 'orange' : konfidenz < 80 ? 'yellow' : 'teal',
    fehlendFuerLernphase: konfidenz < 20 ? Math.ceil((20 - konfidenz) / 4) : 0,
  };
}
