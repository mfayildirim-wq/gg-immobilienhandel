/* eslint-disable @typescript-eslint/no-explicit-any -- Deals im Altformat */
/**
 * Makler-Detail ohne DOM (gg-immohandel src/modules/makler/makler.ts): Verlauf (mkRenderKomm), letzter Kontakt nach einem
 * Eintrag (mkAddKomm), E-Mail vorbereiten (mkPrepareEmail), Deals-Reiter (mkDealsHTML), Schnellsuche (mkSearchExec).
 */
import { fe } from '../listen/listen.ts';

export const KANAL_ICON: Record<string, string> = { email: '✉️', whatsapp: '📱', anruf: '📞', notiz: '📝' };
export const KANAL_LABEL: Record<string, string> = { email: 'E-Mail', whatsapp: 'WhatsApp', anruf: 'Anruf', notiz: 'Notiz' };

/** Kopfzeile eines Verlaufseintrags: Symbol, „Kanal · Richtung“. */
export function kommunikationKopf(k: { kanal?: string | null; richtung?: string | null }) {
  const kanal = k.kanal ?? '';
  return { icon: KANAL_ICON[kanal] || '📝', text: `${KANAL_LABEL[kanal] || kanal}${k.richtung && k.richtung !== '' ? ' · ' + k.richtung : ''}` };
}

/**
 * Zeitstempel wie in der alten Sammlung (`toLocaleDateString('de-DE') + ' ' + HH:MM`, ohne führende Nullen im Datum),
 * in deutscher Zeit; ohne Zeitpunkt „Altbestand“.
 */
export function kommZeitstempel(iso: string | null | undefined): string {
  if (!iso) return 'Altbestand';
  const d = new Date(iso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  const tag = d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const zeit = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  return `${tag} ${zeit}`;
}

/**
 * mkAddKomm: der letzte Kontakt rückt auf den Tag des Eintrags (Import: Datum der Mail, sonst heute) — nie zurück.
 * Liefert den neuen Wert oder null, wenn er bleibt.
 */
export function letzterKontaktNachEintrag(bestehend: string | null | undefined, datum: string | null | undefined, heute: string): string | null {
  const istDatum = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const kontaktTag = istDatum(datum) ? datum : heute;
  return !bestehend || kontaktTag > bestehend ? kontaktTag : null;
}

/** mkPrepareEmail: alle Felder Pflicht; Text über 1800 Zeichen wird für mailto: gekürzt. */
export function mailEntwurf(an: string, betreff: string, text: string): { fehler: string } | { url: string; gekuerzt: boolean } {
  const to = an.trim(); const subject = betreff.trim(); const body = text.trim();
  if (!to || !subject || !body) return { fehler: 'Bitte alle Felder ausfüllen' };
  const MAX_BODY = 1800;
  const gekuerzt = body.length > MAX_BODY;
  const mailBody = gekuerzt ? body.substring(0, MAX_BODY) + '\n\n[Text gekürzt]' : body;
  return { url: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`, gekuerzt };
}

/** mkDealsHTML: aktive und archivierte Deals des Maklers mit Kennzahlen. */
export function maklerDeals(deals: any[], maklerId: string) {
  const all = deals.filter((d: any) => d.maklerId === maklerId);
  const aktiv = all.filter((d: any) => d.status !== 'Archiv');
  const archiv = all.filter((d: any) => d.status === 'Archiv');
  const karte = (d: any) => ({
    id: d.id as string, status: d.status as string, titel: `${d.adresse || '–'}, ${d.stadt || '–'}`,
    unter: `${d.angebotsDatum || '–'} · ${d.nachfassFreq || '–'}`, kaufpreis: d.kalk?.kaufpreis ? fe(d.kalk.kaufpreis) : null,
  });
  return {
    aktiv: aktiv.map(karte), archiv: archiv.map(karte),
    kennzahlen: { gesamt: all.length, aktiv: aktiv.length, angebote: all.filter((d: any) => d.status === 'Angebot abgegeben').length },
  };
}

/** mkSearchExec: Name, Firma, E-Mail oder Telefonziffern (ab 3), mindestens 2 Zeichen, höchstens 10 Treffer. */
export function maklerSchnellsuche<T extends { name?: string | null; firma?: string | null; tel?: string | null; email?: string | null }>(makler: T[], eingabe: string): T[] | null {
  const query = eingabe.trim().toLowerCase();
  if (query.length < 2) return null;
  const queryDigits = query.replace(/[^\d]/g, '');
  return makler.filter((m) => {
    if (m.name?.toLowerCase().includes(query)) return true;
    if (m.firma?.toLowerCase().includes(query)) return true;
    if (queryDigits.length >= 3 && m.tel && m.tel.replace(/[^\d]/g, '').includes(queryDigits)) return true;
    if (m.email?.toLowerCase().includes(query)) return true;
    return false;
  }).slice(0, 10);
}

/** Profil: Frequenzen des Makler-Formulars; „Nicht kontaktieren“ heißt im Neubau „Nie“ (Dokument 10, Regel 1). */
export const MAKLER_FREQUENZ_OPTIONEN = [
  { wert: 'Täglich', label: 'Täglich' }, { wert: 'Wöchentlich', label: 'Wöchentlich' }, { wert: 'Monatlich', label: 'Monatlich' },
  { wert: 'Alle 3 Monate', label: 'Alle 3 Monate' }, { wert: 'Alle 6 Monate', label: 'Alle 6 Monate' }, { wert: 'Alle 12 Monate', label: 'Alle 12 Monate' },
  { wert: 'Nie', label: 'Nicht kontaktieren' },
] as const;
export const NICHT_KONTAKTIEREN_FRAGE = '⚠️ Dieser Makler wird aus dem Vertrieb-Dashboard ausgeblendet. Fortfahren?';

/**
 * Eingehender Anruf (iOS-Kurzbefehl `?incoming=`): Makler zur Telefonnummer finden.
 * Wörtlich aus gg-immohandel src/main.ts findMaklerByPhone: erst direkte Teilübereinstimmung,
 * dann über die letzten neun Ziffern (0049 / +49 / 0 gleichbehandelt). Unter vier Ziffern: keine Suche.
 */
export function maklerZuTelefon<T extends { tel?: string | null }>(makler: readonly T[], telefon: string): T | null {
  const ziffern = (telefon || '').replace(/[^\d]/g, '');
  if (ziffern.length < 4) return null;
  const direkt = makler.find((m) => m.tel && m.tel.replace(/[^\d]/g, '').includes(ziffern));
  if (direkt) return direkt;
  const letzte9 = ziffern.slice(-9);
  if (letzte9.length >= 7) {
    const rueckwaerts = makler.find((m) => {
      if (!m.tel) return false;
      const gespeichert = m.tel.replace(/[^\d]/g, '');
      return gespeichert.endsWith(letzte9) || letzte9.endsWith(gespeichert.slice(-9));
    });
    if (rueckwaerts) return rueckwaerts;
  }
  return null;
}

export const eingehendUnbekannt = (telefon: string) => `📞 Eingehend: ${telefon} (kein Makler hinterlegt)`;
