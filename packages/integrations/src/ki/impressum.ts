/**
 * Firmendaten aus dem Impressum (Baustein B, 17.10.2026, Protokoll 32): das Impressum einer Domain holen und die Felder
 * herauslesen — per Regel (`@gg/domain`) und mit Haiku (Name, Rechtsform, Anschrift, Kontakt aus dem Zusammenhang).
 *
 * Abruf: nur `https://`, nur öffentliche Ziele (`zielPruefen` wie beim Auto-Import — keine internen Adressen), 8 s je Seite,
 * höchstens 1 MB, nur HTML. Erst die üblichen Impressum-Pfade, dann die Startseite nach dem Link „Impressum“ durchsuchen.
 * Eine Seite zählt nur, wenn sie wie ein Impressum spricht (sonst war es ein 200 mit Startseite oder Kontaktformular).
 *
 * KI: ein Werkzeugaufruf (`firmendaten_speichern`) auf höchstens 6.000 Zeichen Text, nur aus dem Text, nichts geraten;
 * ohne KI gilt die Regel allein. Zwischenspeicher je Domain und Kostenbuchung liegen im API-Service.
 */
import { firmenFelderZusammenfuehren, type FirmenFelder, htmlZuText, impressumFelder, impressumKandidaten, impressumLinkFinden, siehtNachImpressumAus } from '@gg/domain';
import { zielPruefen } from '../autoimport/engine.ts';
import type { KiClient } from './anthropic.ts';
import { genutztesModell } from './modelle.ts';
import { HAIKU, type KiAntwort } from './persona.ts';

const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5' };
const MAX_BYTES = 1_000_000;
const MAX_TEXT_FUER_KI = 6000;

export interface ImpressumSeite { url: string; text: string }

export interface ImpressumAbrufOptionen { abruf?: typeof fetch; zeitlimitMs?: number; /** NUR für Tests: lokale Ziele zulassen */ lokaleZieleErlaubt?: boolean }

/** Eine Seite holen: null bei Fehler, falschem Typ, Umleitung ins Interne oder zu viel. */
async function seiteHolen(url: string, o: Required<Omit<ImpressumAbrufOptionen, 'lokaleZieleErlaubt'>> & { lokaleZieleErlaubt: boolean }): Promise<{ url: string; html: string } | null> {
  const ziel = zielPruefen(url, o.lokaleZieleErlaubt);
  if (!ziel.ok) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.zeitlimitMs);
  try {
    const resp = await o.abruf(url, { headers: BROWSER, signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) return null;
    // Eine Umleitung kann woanders hinführen als geprüft — das Ziel noch einmal prüfen
    const endUrl = resp.url || url;
    if (!zielPruefen(endUrl, o.lokaleZieleErlaubt).ok) return null;
    const typ = resp.headers.get('content-type') ?? '';
    if (typ && !/text\/html|application\/xhtml/i.test(typ)) return null;
    const laenge = Number(resp.headers.get('content-length') ?? 0);
    if (laenge > MAX_BYTES) return null;
    const html = await resp.text();
    if (html.length > MAX_BYTES * 2) return null;
    return { url: endUrl, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Das Impressum zu einer Domain finden: übliche Pfade zuerst, dann die Startseite nach dem Link durchsuchen.
 * Gibt Adresse und Text zurück oder null, wenn nichts da ist, das wie ein Impressum spricht.
 */
export async function impressumHolen(domain: string, optionen: ImpressumAbrufOptionen = {}): Promise<ImpressumSeite | null> {
  const o = { abruf: optionen.abruf ?? fetch, zeitlimitMs: optionen.zeitlimitMs ?? 8000, lokaleZieleErlaubt: optionen.lokaleZieleErlaubt ?? false };
  const kandidaten = impressumKandidaten(domain);
  const startseiten = new Set(kandidaten.filter((k) => k.endsWith('/') && new URL(k).pathname === '/'));
  const gesehen = new Set<string>();
  for (const url of kandidaten) {
    const seite = await seiteHolen(url, o);
    if (!seite) continue;
    if (startseiten.has(url)) {
      // Startseite: Link „Impressum“ suchen und der Seite folgen (einmal)
      const link = impressumLinkFinden(seite.html, seite.url);
      if (!link || gesehen.has(link)) continue;
      gesehen.add(link);
      const ziel = await seiteHolen(link, o);
      if (!ziel) continue;
      const text = htmlZuText(ziel.html);
      if (siehtNachImpressumAus(text)) return { url: ziel.url, text };
      continue;
    }
    const text = htmlZuText(seite.html);
    if (siehtNachImpressumAus(text)) return { url: seite.url, text };
  }
  return null;
}

export const FIRMENDATEN_TOOL = {
  name: 'firmendaten_speichern',
  description: 'Speichert die Angaben zum Unternehmen aus einem Impressum.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: ['string', 'null'], description: 'Vollständiger Firmenname des Betreibers der Webseite samt Rechtsform, so wie er im Impressum steht (z. B. „Beispiel Immobilien GmbH & Co. KG“). Kein Webdesigner, keine Behörde, keine Kammer.' },
      rechtsform: { type: ['string', 'null'], description: 'Rechtsform aus dem Namen (GmbH, GmbH & Co. KG, AG, e.K., UG (haftungsbeschränkt), GbR …); null bei Einzelunternehmen ohne Rechtsform.' },
      strasse: { type: ['string', 'null'], description: 'Straße und Hausnummer des Firmensitzes' },
      plz: { type: ['string', 'null'], description: 'Postleitzahl (5 Ziffern)' },
      ort: { type: ['string', 'null'], description: 'Ort ohne Zusätze' },
      tel: { type: ['string', 'null'], description: 'Zentrale Telefonnummer, so geschrieben wie im Impressum (keine Mobilnummer einer Person)' },
      fax: { type: ['string', 'null'], description: 'Faxnummer' },
      email: { type: ['string', 'null'], description: 'Zentrale E-Mail-Adresse (info@…, kontakt@…); Schreibweisen wie „(at)“ in @ umsetzen' },
    },
    required: ['name', 'rechtsform', 'strasse', 'plz', 'ort', 'tel', 'fax', 'email'],
  },
} as const;

const SYSTEM = `Du liest das Impressum einer Webseite eines Immobilienunternehmens und trägst die Angaben zum Betreiber ein.
Regeln:
- Nur, was im Text steht. Nichts ergänzen, nichts raten, nichts aus dem Domainnamen ableiten. Fehlt eine Angabe, trage null ein.
- Der Betreiber ist das Unternehmen, auf das sich „Angaben gemäß § 5 TMG/DDG“, „vertreten durch“, Handelsregister oder Umsatzsteuer-ID beziehen — nicht die Agentur, die die Seite umgesetzt hat, nicht Aufsichtsbehörde oder Kammer.
- Name mit Rechtsform in der Schreibweise des Impressums. Ohne Rechtsform (Einzelunternehmen) der Name, wie er steht, Rechtsform null.
- Telefon und Fax in der Schreibweise des Impressums; eine als „Mobil“ bezeichnete Nummer ist keine zentrale Telefonnummer.
Antworte ausschließlich mit dem Werkzeug.`;

/** Felder mit Haiku aus dem Impressum-Text; `wert` null, wenn das Modell nichts geliefert hat. */
export async function firmendatenDeuten(ki: KiClient, text: string, domain: string): Promise<KiAntwort<Partial<FirmenFelder> | null>> {
  const gekuerzt = text.length > MAX_TEXT_FUER_KI ? `${text.slice(0, MAX_TEXT_FUER_KI)}\n…` : text;
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 500, system: SYSTEM,
    messages: [{ role: 'user', content: `Domain: ${domain}\n\nIMPRESSUM:\n${gekuerzt}` }],
    tools: [FIRMENDATEN_TOOL], tool_choice: { type: 'tool', name: FIRMENDATEN_TOOL.name },
  });
  const block = (data?.content as { type: string; name?: string; input?: unknown }[] | undefined)?.find((c) => c.type === 'tool_use' && c.name === FIRMENDATEN_TOOL.name);
  const wert = block?.input && typeof block.input === 'object' ? (block.input as Partial<FirmenFelder>) : null;
  return { wert, model: genutztesModell(data, HAIKU), usage: data?.usage ?? {} };
}

export type FirmendatenErgebnis =
  | { gefunden: false; grund: string }
  | { gefunden: true; url: string; felder: FirmenFelder; regel: FirmenFelder; ki: KiAntwort<Partial<FirmenFelder> | null> | null };

/**
 * Impressum holen, Felder per Regel und (wenn eine KI da ist) mit Haiku lesen, zusammenführen. Ohne Impressum
 * `gefunden: false` mit Grund. Ein KI-Fehler lässt das Ergebnis nicht scheitern — dann gilt die Regel allein.
 */
export async function firmendatenErmitteln(domain: string, ki: KiClient | null | undefined, optionen: ImpressumAbrufOptionen = {}): Promise<FirmendatenErgebnis> {
  const seite = await impressumHolen(domain, optionen);
  if (!seite) return { gefunden: false, grund: `Kein Impressum unter ${domain} gefunden` };
  const regel = impressumFelder(seite.text);
  let kiAntwort: KiAntwort<Partial<FirmenFelder> | null> | null = null;
  if (ki) {
    try {
      kiAntwort = await firmendatenDeuten(ki, seite.text, domain);
    } catch (e) {
      console.warn('[impressum] KI-Deutung fehlgeschlagen, Regel allein:', e instanceof Error ? e.message : e);
    }
  }
  return { gefunden: true, url: seite.url, felder: firmenFelderZusammenfuehren(regel, kiAntwort?.wert), regel, ki: kiAntwort };
}
