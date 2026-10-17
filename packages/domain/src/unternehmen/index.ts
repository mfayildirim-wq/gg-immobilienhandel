/**
 * Unternehmen der Makler (Normalform seit 17.10.2026, Protokoll 32): die frühere Textspalte `makler.firma` ist eine eigene
 * Tabelle `fach.unternehmen`. Hier stehen die Regeln, die Datenbank, Umzug, HubSpot-Übernahme und Oberfläche gemeinsam
 * brauchen: Namen normieren (Zusammenführung gleicher Firmen), Rechtsform aus dem Namen, Domain aus E-Mail oder Webseite.
 *
 * `unternehmenNameNormieren` ist in der Daten-Migration `unternehmen_daten` als SQL-Ausdruck nachgebaut
 * (lower · Leerraum zusammenziehen · trim · Satzzeichen am Ende weg) — beide müssen gleich bleiben, sonst entstehen
 * beim Anlegen über die API Dubletten zu den migrierten Firmen. Test: `packages/db/test/unternehmen-sql.test.ts`.
 */

/** Schreibweisen gleicher Firmen zusammenführen: „ Beispiel  Immobilien GmbH.“ = „beispiel immobilien gmbh“. */
export function unternehmenNameNormieren(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .trim();
}

/** Erkannte Rechtsformen, längste zuerst, damit „GmbH & Co. KG“ vor „GmbH“ und „KG“ gewinnt. */
const RECHTSFORM_MUSTER: readonly [RegExp, string][] = [
  [/\bgmbh\s*&\s*co\.?\s*kgaa\b/i, 'GmbH & Co. KGaA'],
  [/\bgmbh\s*&\s*co\.?\s*kg\b/i, 'GmbH & Co. KG'],
  [/\bgmbh\s*&\s*co\.?\s*ohg\b/i, 'GmbH & Co. OHG'],
  [/\bag\s*&\s*co\.?\s*kg\b/i, 'AG & Co. KG'],
  [/\bse\s*&\s*co\.?\s*kg\b/i, 'SE & Co. KG'],
  [/\bug\s*\(haftungsbeschr[äa]nkt\)/i, 'UG (haftungsbeschränkt)'],
  [/\bggmbh\b/i, 'gGmbH'],
  [/\bgmbh\b/i, 'GmbH'],
  [/\bmbh\b/i, 'mbH'],
  [/\bkgaa\b/i, 'KGaA'],
  [/\bpartg\s*mbb\b/i, 'PartG mbB'],
  [/\bpartg\b/i, 'PartG'],
  [/\be\.\s?k\.?(?=\s|$)/i, 'e.K.'],
  [/\be\.\s?kfm\.?(?=\s|$)/i, 'e.Kfm.'],
  [/\be\.\s?kfr\.?(?=\s|$)/i, 'e.Kfr.'],
  [/\be\.\s?v\.?(?=\s|$)/i, 'e.V.'],
  [/\beG\b/, 'eG'],
  [/\bohg\b/i, 'OHG'],
  [/\bgbr\b/i, 'GbR'],
  [/\bkg\b/i, 'KG'],
  [/\bAG\b/, 'AG'],
  [/\bSE\b/, 'SE'],
  [/\bUG\b/, 'UG'],
  [/\bltd\.?(?=\s|$)/i, 'Ltd.'],
  [/\binc\.?(?=\s|$)/i, 'Inc.'],
  [/\bllc\b/i, 'LLC'],
  [/\bs\.\s?a\.(?=\s|$)/i, 'S.A.'],
  [/\bb\.\s?v\.(?=\s|$)/i, 'B.V.'],
];

/** Rechtsform aus dem Firmennamen („Immobilien Rienhardt GmbH“ → „GmbH“); null, wenn keine erkennbar ist. */
export function rechtsformAusName(name: string | null | undefined): string | null {
  return rechtsformTreffer(name)?.form ?? null;
}

/** Rechtsform mit Fundstelle im Text (für das Herauslösen des Firmennamens aus einer Impressum-Zeile). */
export function rechtsformTreffer(name: string | null | undefined): { form: string; index: number; laenge: number } | null {
  const n = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  for (const [muster, form] of RECHTSFORM_MUSTER) {
    const m = muster.exec(n);
    if (m) return { form, index: m.index, laenge: m[0].length };
  }
  return null;
}

/** Freemail-Anbieter: die Domain sagt nichts über die Firma. */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 't-online.de', 'yahoo.de', 'yahoo.com',
  'hotmail.de', 'hotmail.com', 'outlook.de', 'outlook.com', 'live.de', 'live.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.de',
  'freenet.de', 'arcor.de', 'online.de', 'posteo.de', 'mail.de', 'email.de', 'protonmail.com', 'proton.me', 'kabelmail.de', 'vodafone.de',
  'unitybox.de', 'bluewin.ch', 'mailbox.org', 'yandex.com', 'msn.com', 'magenta.de', 'telekom.de', 'o2online.de',
]);

/**
 * Domain aus einer E-Mail-Adresse oder Webseite: „Max.Muster@Beispiel-Immo.de“ und „https://www.beispiel-immo.de/team“
 * ergeben beide „beispiel-immo.de“. Freemail-Adressen und Unlesbares ergeben null.
 */
export function domainAusAdresse(wert: string | null | undefined): string | null {
  const roh = (wert ?? '').trim().toLowerCase();
  if (!roh) return null;
  let host: string;
  const at = roh.lastIndexOf('@');
  if (at >= 0) host = roh.slice(at + 1);
  else {
    const ohneSchema = roh.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    host = ohneSchema.split(/[/?#]/)[0] ?? '';
  }
  host = host.replace(/^www\d*\./, '').replace(/:\d+$/, '').replace(/[>\s)]+$/, '');
  if (!/^[a-z0-9äöüß-]+(\.[a-z0-9äöüß-]+)+$/.test(host)) return null;
  if (FREEMAIL_DOMAINS.has(host)) return null;
  return host;
}

/** Webseite für die Anzeige vereinheitlichen: Schema und „www.“ weg, Pfad bleibt; leer → null. */
export function webseiteNormieren(wert: string | null | undefined): string | null {
  const roh = (wert ?? '').trim();
  if (!roh) return null;
  const ohneSchema = roh.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/^www\d*\./i, '').replace(/\/+$/, '');
  return ohneSchema || null;
}

/** Kurzname für Listen: Name ohne Rechtsform („Immobilien Rienhardt GmbH“ → „Immobilien Rienhardt“). */
export function unternehmenKurzname(name: string | null | undefined): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim();
  for (const [muster] of RECHTSFORM_MUSTER) {
    const m = muster.exec(n);
    if (m && m.index + m[0].length === n.length) return n.slice(0, m.index).replace(/[\s,&-]+$/, '').trim() || n;
  }
  return n;
}
