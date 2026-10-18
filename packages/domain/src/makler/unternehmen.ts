/**
 * Unternehmen eines Maklers (Fachentscheidung 18.10.2026): Firma, Webseite und Büroanschrift stehen nicht mehr am
 * Makler, sondern einmal je Unternehmen — mehrere Makler können auf dasselbe Unternehmen zeigen. Jeder Standort ist
 * ein eigenes Unternehmen („LINK Immobilien GmbH Stuttgart“ ≠ „… Ostfildern-Nellingen“), eine Konzernebene gibt es nicht.
 *
 * Der Schlüssel fasst nur Schreibweisen zusammen (Groß/Klein, Satzzeichen, „E & G“/„E&G“). Rechtsform und Standort
 * bleiben drin: „Volksbank Leonberg-Strohgäu eG“ und „Volksbank Leonberg Strohgäu“ entscheidet ein Mensch (Bericht).
 */
import { type WeitereKontakte, weitereKontakte } from './kontakte.ts';

export function unternehmenSchluessel(name: string | null | undefined): string | null {
  const s = (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,;:()"'„“”‚‘’`´]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s*([&+/])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 't-online.de', 'yahoo.com', 'yahoo.de', 'outlook.com',
  'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'icloud.com', 'me.com', 'freenet.de', 'aol.com', 'posteo.de',
  'mail.de', 'online.de', 'arcor.de', 'email.de', 'vodafone.de', '1und1.de',
]);

/** Domain des Unternehmens: aus der Webseite, sonst aus der E-Mail (außer Freemailern) — Zuordnungshilfe, kein Schlüssel. */
export function unternehmenDomain(webseite: string | null | undefined, email?: string | null): string | null {
  const host = (webseite ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:\s]/)[0];
  if (host && host.includes('.')) return host;
  const d = (email ?? '').trim().toLowerCase().split('@')[1];
  return d && d.includes('.') && !FREEMAIL.has(d) ? d : null;
}

export interface MaklerFuerUnternehmen {
  id: string;
  name?: string | null;
  firma?: string | null;
  webseite?: string | null;
  email?: string | null;
  tel?: string | null;
  mobil?: string | null;
  festnetz?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  weitereKontakte?: Partial<WeitereKontakte> | null;
}

export interface UnternehmenPlan {
  schluessel: string;
  name: string;
  webseite: string | null;
  domain: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  /** Kollegen aus den Exposés aller Makler des Unternehmens — ohne die, die selbst als Makler angelegt sind. */
  weitereKontakte: WeitereKontakte | null;
  maklerIds: string[];
}

export interface UnternehmenUebernahme {
  unternehmen: UnternehmenPlan[];
  ohneFirma: string[];
  pruefen: {
    /** Gleiche Domain, verschiedene Schlüssel: dieselbe Firma in anderer Schreibweise oder zwei Standorte. */
    gleicheDomain: { domain: string; namen: string[] }[];
    /** Zwei Namen oder Zusätze in einem Feld („BW Bank / Immobilienvermittlung BW GmbH“). */
    mehrteilig: string[];
    webseitenKonflikt: { name: string; webseiten: string[] }[];
  };
}

const leer = (v: string | null | undefined) => !v?.trim();

function haeufigster(werte: string[]): string | null {
  const n = new Map<string, number>();
  for (const w of werte) n.set(w, (n.get(w) ?? 0) + 1);
  let best: string | null = null;
  for (const [w, k] of n) if (best === null || k > n.get(best)!) best = w; // bei Gleichstand der zuerst gesehene
  return best;
}

/** Kontaktlisten mehrerer Makler zusammenführen; was ein Makler der Gruppe selbst ist (Name, Nummer, Mail), fällt weg. */
export function unternehmenKontakte(makler: MaklerFuerUnternehmen[], zusaetzlich: (Partial<WeitereKontakte> | null | undefined)[] = []): WeitereKontakte | null {
  const alle = [...makler.map((m) => m.weitereKontakte), ...zusaetzlich];
  const liste = (k: keyof WeitereKontakte) => alle.flatMap((w) => (Array.isArray(w?.[k]) ? w[k] : []));
  return weitereKontakte(makler, { namen: liste('namen'), telefonnummern: liste('telefonnummern'), emails: liste('emails') });
}

/** Plan der Übernahme `makler.firma` → `unternehmen`: Gruppen nach Schlüssel, je Gruppe die häufigste Schreibweise. */
export function unternehmenUebernahmePlan(makler: MaklerFuerUnternehmen[]): UnternehmenUebernahme {
  const gruppen = new Map<string, MaklerFuerUnternehmen[]>();
  const ohneFirma: string[] = [];
  for (const m of makler) {
    const k = unternehmenSchluessel(m.firma);
    if (!k) { ohneFirma.push(m.id); continue; }
    gruppen.set(k, [...(gruppen.get(k) ?? []), m]);
  }
  const webseitenKonflikt: UnternehmenUebernahme['pruefen']['webseitenKonflikt'] = [];
  const unternehmen = [...gruppen].map(([schluessel, ms]): UnternehmenPlan => {
    // Bei Gleichstand nicht die Schreibweise in Großbuchstaben („ELEPHAS IMMOBILIEN GMBH“)
    const schreibweisen = ms.map((m) => m.firma!.trim().replace(/\s+/g, ' '));
    const name = haeufigster([...schreibweisen.filter((n) => n !== n.toUpperCase()), ...schreibweisen.filter((n) => n === n.toUpperCase())])!;
    const mitWeb = ms.filter((m) => !leer(m.webseite));
    const host = haeufigster(mitWeb.map((m) => unternehmenDomain(m.webseite) ?? m.webseite!.trim()));
    const hosts = new Set(mitWeb.map((m) => unternehmenDomain(m.webseite) ?? m.webseite!.trim()));
    if (hosts.size > 1) webseitenKonflikt.push({ name, webseiten: [...new Set(mitWeb.map((m) => m.webseite!.trim()))] });
    const webseite = mitWeb.find((m) => (unternehmenDomain(m.webseite) ?? m.webseite!.trim()) === host)?.webseite?.trim() ?? null;
    const adresse = ms.find((m) => !leer(m.strasse) || !leer(m.ort));
    return {
      schluessel, name, webseite,
      domain: unternehmenDomain(webseite) ?? haeufigster(ms.map((m) => unternehmenDomain(null, m.email)).filter((d): d is string => !!d)),
      strasse: adresse?.strasse?.trim() || null, plz: adresse?.plz?.trim() || null, ort: adresse?.ort?.trim() || null,
      weitereKontakte: unternehmenKontakte(ms),
      maklerIds: ms.map((m) => m.id),
    };
  });
  const jeDomain = new Map<string, string[]>();
  for (const u of unternehmen) if (u.domain && !FREEMAIL.has(u.domain)) jeDomain.set(u.domain, [...(jeDomain.get(u.domain) ?? []), u.name]);
  return {
    unternehmen,
    ohneFirma,
    pruefen: {
      gleicheDomain: [...jeDomain].filter(([, n]) => n.length > 1).map(([domain, namen]) => ({ domain, namen })),
      mehrteilig: unternehmen.map((u) => u.name).filter((n) => /[/(,]|\s-\s/.test(n)),
      webseitenKonflikt,
    },
  };
}

export interface UnternehmenFelder {
  webseite?: string | null;
  domain?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  weitereKontakte?: WeitereKontakte | null;
}

/**
 * Was ein neuer Makler (Exposé, Liste) zu einem bestehenden Unternehmen beiträgt: nur leere Felder werden gefüllt,
 * die Anschrift nur als Ganzes, Kontakte kommen hinzu. Leeres Ergebnis = nichts zu schreiben.
 */
export function unternehmenErgaenzen(alt: UnternehmenFelder, neu: UnternehmenFelder, maklerDerFirma: MaklerFuerUnternehmen[] = []): UnternehmenFelder {
  const aus: UnternehmenFelder = {};
  if (leer(alt.webseite) && !leer(neu.webseite)) aus.webseite = neu.webseite!.trim();
  if (leer(alt.domain)) { const d = neu.domain ?? unternehmenDomain(aus.webseite ?? neu.webseite); if (d) aus.domain = d; }
  if (leer(alt.strasse) && leer(alt.plz) && leer(alt.ort) && (!leer(neu.strasse) || !leer(neu.ort))) {
    aus.strasse = neu.strasse?.trim() || null; aus.plz = neu.plz?.trim() || null; aus.ort = neu.ort?.trim() || null;
  }
  if (neu.weitereKontakte) {
    const k = unternehmenKontakte(maklerDerFirma, [alt.weitereKontakte, neu.weitereKontakte]);
    const vorher = JSON.stringify(alt.weitereKontakte ?? null);
    if (JSON.stringify(k) !== vorher) aus.weitereKontakte = k;
  }
  return aus;
}
