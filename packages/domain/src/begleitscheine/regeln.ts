/* eslint-disable @typescript-eslint/no-explicit-any -- Deal im Altformat wie in der Präsentation */
/**
 * Begleitscheine: Regeln, die in der alten App an Speicher und DOM hingen (begleitscheinStore.ts, bsAktionen.ts,
 * begleitscheine.ts, settings/bsSettings.ts). Hier als reine Funktionen; Verhalten wie alt, Abweichungen markiert.
 */
import { computeDealKalkSummary } from '../finanzpraesentation/vorbelegung.ts';
import {
  type Begleitschein, bsAdresseAusObjekt, bsArchivStatus, bsSeedVorlage, type BsAktion, type BsTyp, type BsVorlage, type BsVordruck,
} from './engine.ts';

/** Y-A5 — erlaubte Sprungziele (Beschriftungen wie alt). */
export const BS_MODULE: Record<string, string> = {
  objekte: '🏢 Objektdatenbank',
  deals: '📋 Deal-Tracking',
  kkalk: '💼 Kundenkalkulation (Übersicht)',
  vertriebslisten: '🏗️ Vertriebslisten',
  ankauf: '🎯 Ankauf',
  makler: '🤝 Maklerdatenbank',
  'deal-kalkulation': '🧮 Deal → Kalkulation',
  'deal-kundenkalk': '💼 Deal → Kundenkalkulation',
  'deal-finanzpraes': '🏦 Deal → Bank-Präsentation',
};

/** Y-A7 — die lesbaren Datenquellen. Ausschliesslich lesend (L1). */
export const BS_DATENQUELLEN: Record<string, string> = {
  kalkulation: 'Projektkalkulation des Deals',
  objekt: 'Objektstammdaten',
  deal: 'Deal-Kopfdaten',
};

/** Y-A6 — Analysetypen. Die Auswertung selbst ist noch nicht zugeliefert (§X8). */
export const BS_ANALYSETYPEN: Record<string, string> = {
  mietvertraege: 'Mietverträge und Nachträge',
  teilungserklaerung: 'Teilungserklärung und Teilungspläne',
};

export const BS_PLATZHALTER = ['adresse', 'objekt', 'strasse', 'hausnr', 'plz', 'stadt', 'whgnr', 'name', 'datum'] as const;

/** Nur die aktiven Aktionen einer Zeile bzw. eines Unterpunkts (Y3d, B20). */
export function bsAktionenFuer(aktionen: readonly BsAktion[], rowId: string, subId?: string): BsAktion[] {
  return aktionen.filter(a => a.aktiv && a.rowId === rowId && (a.subId ?? undefined) === subId);
}

/** Y10 — an wie vielen Stellen (über alle Vorlagentypen) ein Vordruck verwendet wird. */
export function bsVordruckVerwendung(alleAktionen: readonly BsAktion[], vordruckId: string): number {
  return alleAktionen.filter(a => a.vordruckId === vordruckId).length;
}

/** Entfernt Aktionen, deren Punkt/Unterpunkt es in der Vorlage nicht mehr gibt (alt: aktionenAufraeumen). */
export function bsAktionenAufraeumen(vorlage: BsVorlage, aktionen: readonly BsAktion[]): { aktionen: BsAktion[]; entfernt: number } {
  const punkte = new Set<string>();
  for (const r of vorlage.rows) {
    punkte.add(r.id);
    for (const s of r.sub) punkte.add(`${r.id} ${s.id}`);
  }
  const bleiben = aktionen.filter(a => punkte.has(a.subId ? `${a.rowId} ${a.subId}` : a.rowId));
  return { aktionen: bleiben, entfernt: aktionen.length - bleiben.length };
}

/** Wie viele selbst angelegte Punkte beim Zurücksetzen verloren gehen (Rückfrage der alten App). */
export function bsEigenePunkte(typ: BsTyp, vorlage: BsVorlage): number {
  const auslieferung = new Set(bsSeedVorlage(typ).rows.map(r => r.id));
  return vorlage.rows.filter(r => !auslieferung.has(r.id)).length;
}

/** bsSave: Archivstatus folgt dem Abschlusspunkt; das Archivdatum bleibt beim erneuten Speichern erhalten (D3/D4). */
export function bsArchivDatum(bs: Begleitschein, bisher: string | null, heute: string): string | null {
  return bsArchivStatus(bs) ? (bisher ?? heute) : null;
}

/** B8/B9 — nach Objekt gruppiert (nach Adresse sortiert, ohne Objekt zuletzt), innerhalb Ankauf vor Verkauf, dann Name. */
export function bsGruppiert<T extends Pick<Begleitschein, 'objektId' | 'typ' | 'name'>>(scheine: readonly T[], adresse: (objektId: string) => string): [string, T[]][] {
  const g = new Map<string, T[]>();
  for (const b of scheine) {
    const key = b.objektId || '_';
    if (!g.has(key)) g.set(key, []);
    g.get(key)!.push(b);
  }
  for (const list of g.values()) {
    list.sort((a, b) => (a.typ === b.typ ? a.name.localeCompare(b.name, 'de') : a.typ === 'ankauf' ? -1 : 1));
  }
  return [...g.entries()].sort((a, b) => (adresse(a[0]) || 'zzz').localeCompare(adresse(b[0]) || 'zzz', 'de'));
}

export interface BsObjekt { strasse?: string | null; hausnr?: string | null; plz?: string | null; stadt?: string | null; baujahr?: number | string | null; wohnflaeche?: number | string | null; einheitenAnz?: number | string | null }

const ohneNull = (o: BsObjekt | null | undefined) => o ? { strasse: o.strasse ?? undefined, hausnr: o.hausnr ?? undefined, plz: o.plz ?? undefined, stadt: o.stadt ?? undefined } : undefined;

/** M — Platzhalter im Vordrucktext, gleiche Schreibweise wie in den Vorlagen; Unbekanntes bleibt stehen. */
export function bsPlatzhalter(text: string, bs: Pick<Begleitschein, 'adresse' | 'whgNr' | 'name'>, o: BsObjekt | null | undefined, heute: Date): string {
  const map: Record<string, string> = {
    adresse: bs.adresse,
    objekt: bsAdresseAusObjekt(ohneNull(o)),
    strasse: o?.strasse ?? '',
    hausnr: o?.hausnr ?? '',
    plz: o?.plz ?? '',
    stadt: o?.stadt ?? '',
    whgnr: bs.whgNr ?? '',
    name: bs.name,
    datum: heute.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => map[String(k).toLowerCase()] ?? m);
}

/** Was eine Aktion auslöst. Sie schreibt nie in Bestandsdaten (N1/L1). */
export type BsAktionErgebnis =
  | { art: 'link'; url: string }
  | { art: 'modul'; modul: string; dealId?: string }
  | { art: 'mail'; href: string }
  | { art: 'anzeige'; titel: string; hinweis?: string; tabelle?: [string, string][]; text?: string; datei?: string }
  | { art: 'fehler'; meldung: string };

export interface BsAktionKontext {
  objekt: BsObjekt | null;
  /** Deal im Altformat (kalk, einheiten, sanierung) und Status */
  deal: any | null;
  vordrucke: readonly BsVordruck[];
  heute: Date;
}

const DEAL_REITER = new Set(['deal-kalkulation', 'deal-kundenkalk', 'deal-finanzpraes']);

/** N1 — bsAktionAusfuehren ohne DOM: liefert, was die Oberfläche tun soll. */
export function bsAktionErgebnis(bs: Begleitschein, a: BsAktion, k: BsAktionKontext): BsAktionErgebnis {
  switch (a.typ) {
    case 'link':
      return a.url ? { art: 'link', url: a.url } : { art: 'fehler', meldung: 'Für diese Aktion ist noch keine Adresse hinterlegt' };
    case 'modul': {
      if (!a.modul || !BS_MODULE[a.modul]) return { art: 'fehler', meldung: 'Für diese Aktion ist noch kein Ziel hinterlegt' };
      if (DEAL_REITER.has(a.modul)) {
        if (!k.deal) return { art: 'fehler', meldung: 'Kein Deal verknüpft' };
        return { art: 'modul', modul: a.modul, dealId: k.deal.id };
      }
      return { art: 'modul', modul: a.modul };
    }
    case 'mail': {
      // N19 — mailto öffnet das Mailprogramm, es wird nichts versendet.
      const p = new URLSearchParams();
      if (a.betreff) p.set('subject', a.betreff.replace(/\{adresse\}/g, bs.adresse));
      const q = p.toString().replace(/\+/g, '%20');
      return { art: 'mail', href: `mailto:${encodeURIComponent(a.empfaenger || '')}${q ? '?' + q : ''}` };
    }
    case 'daten': {
      const quelle = a.datenQuelle || 'kalkulation';
      if (quelle === 'objekt') {
        const o = k.objekt;
        if (!o) return { art: 'fehler', meldung: 'Kein Objekt verknüpft' };
        return { art: 'anzeige', titel: a.label, tabelle: [
          ['Adresse', bsAdresseAusObjekt(ohneNull(o)) || '–'],
          ['Baujahr', String(o.baujahr ?? '–')],
          ['Wohnfläche', o.wohnflaeche ? `${o.wohnflaeche} m²` : '–'],
          // Korrektur: alt `String(o.einheiten)` war die Einheitenliste und zeigte „[object Object]“
          ['Einheiten', String(o.einheitenAnz ?? '–')],
        ] };
      }
      if (!k.deal) return { art: 'fehler', meldung: 'Kein Deal verknüpft' };
      if (quelle === 'deal') {
        return { art: 'anzeige', titel: a.label, tabelle: [
          ['Status', String(k.deal.status ?? '–')],
          // Adresse aus dem Objekt: die Adress-Kopien im Deal gibt es im Neubau nicht
          ['Adresse', [k.objekt?.strasse, k.objekt?.hausnr, k.objekt?.stadt].filter(Boolean).join(' ') || '–'],
          ['Einheiten', String((k.deal.einheiten || []).length)],
        ] };
      }
      const s = computeDealKalkSummary(k.deal, 'aufteiler');
      if (!s) return { art: 'fehler', meldung: 'Keine Kalkulation im Deal hinterlegt' };
      return { art: 'anzeige', titel: a.label, hinweis: 'Nur-Lese-Ansicht aus der Projektkalkulation — Änderungen bitte im Deal vornehmen.', tabelle: s.rows };
    }
    case 'vordruck-brief':
    case 'vordruck-datei': {
      const v = k.vordrucke.find(x => x.id === a.vordruckId);
      if (!v) {
        return { art: 'anzeige', titel: a.label, hinweis: 'Für diesen Punkt ist noch kein Vordruck hinterlegt. Vordrucke werden unter Einstellungen → Begleitscheine → Vordrucke gepflegt und dort der Aktion zugeordnet.' };
      }
      return v.art === 'datei'
        ? { art: 'anzeige', titel: `${v.nummer} — ${v.titel}`, hinweis: 'Entwurf. Es wird nichts automatisch versendet.', datei: v.dateiName || '–' }
        : { art: 'anzeige', titel: `${v.nummer} — ${v.titel}`, hinweis: 'Entwurf. Es wird nichts automatisch versendet.', text: bsPlatzhalter(v.inhalt || '', bs, k.objekt, k.heute) };
    }
    case 'analyse':
      return { art: 'anzeige', titel: a.label, hinweis: `Die Dokumentenanalyse „${BS_ANALYSETYPEN[a.analyseTyp || ''] || a.analyseTyp || '–'}“ ist konfiguriert, aber noch nicht freigeschaltet. Es fehlen die fachlichen Vorgaben aus §X8 (Prüfkriterien und Ergebnisstruktur).` };
  }
}
