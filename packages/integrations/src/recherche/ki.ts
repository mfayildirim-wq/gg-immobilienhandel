/**
 * Makler-Recherche (21.10.2026), KI-Teil: gelesene Seiten auswerten (kleinstes Modell, Werkzeug mit festem Schema) und —
 * nur wenn im Start-Dialog angehakt — die Websuche von Anthropic, wenn Webseite und ImmoScout nichts ergeben haben.
 */
import { type RechercheFund, RECHERCHE_FELDER } from '@gg/domain';
import type { KiClient } from '../ki/anthropic.ts';
import { genutztesModell } from '../ki/modelle.ts';
import { HAIKU, type KiAntwort } from '../ki/persona.ts';
import type { GeleseneSeite } from './lesen.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- Anfragen und Antworten der Messages-API */

export interface RechercheMakler { name: string | null; firma: string | null; email: string | null; ort: string | null }
export interface RechercheAuswertung { personGenannt: boolean; personSeite: string | null; funde: RechercheFund[] }

const MAKLER_FELDER = Object.keys(RECHERCHE_FELDER.makler);
const FIRMEN_FELDER = Object.keys(RECHERCHE_FELDER.unternehmen);

export const RECHERCHE_WERKZEUG = {
  name: 'recherche_ergebnis',
  description: 'Was die Seiten über den Makler und seine Firma sagen.',
  input_schema: {
    type: 'object',
    properties: {
      personGenannt: { type: 'boolean', description: 'Ist genau diese Person auf einer der Seiten genannt?' },
      personSeite: { type: 'string', description: 'URL der Seite, auf der die Person genannt ist, sonst leer' },
      person: {
        type: 'object',
        description: 'Nur Angaben, die eindeutig zu dieser Person gehören; leer lassen, was nicht dasteht',
        properties: Object.fromEntries(MAKLER_FELDER.filter((f) => f !== 'firma').map((f) => [f, { type: 'object', properties: { wert: { type: 'string' }, quelle: { type: 'string' } } }])),
      },
      firma: {
        type: 'object',
        description: 'Angaben der Firma (Impressum, Kontakt); name = Firmenname laut Impressum',
        properties: Object.fromEntries(['name', ...FIRMEN_FELDER].map((f) => [f, { type: 'object', properties: { wert: { type: 'string' }, quelle: { type: 'string' } } }])),
      },
    },
    required: ['personGenannt'],
  },
};

const SYSTEM = `Du wertest öffentliche Webseiten zu einem Immobilienmakler aus. Übernimm nur, was wörtlich auf den Seiten steht — nichts raten,
nichts ergänzen. Personenangaben (Position, Telefon, Mobil, E-Mail, Anrede) nur, wenn sie eindeutig bei genau dieser Person stehen; eine
allgemeine Büronummer ist telefonZentrale der Firma, keine Personennummer. Anrede nur „Herr“ oder „Frau“. Jede Angabe bekommt als quelle die
URL der Seite, auf der sie steht. Antworte ausschließlich mit dem Werkzeug recherche_ergebnis.`;

const kurz = (s: string | null | undefined) => (s ?? '').trim();

/** Seiten auswerten → Funde (Feld, Wert, Quelle). Ohne Seiten kein Aufruf. */
export async function rechercheAuswerten(ki: KiClient, m: RechercheMakler, seiten: GeleseneSeite[]): Promise<KiAntwort<RechercheAuswertung> | null> {
  if (!seiten.length) return null;
  const quellen = seiten.map((s, i) => `### Seite ${i + 1}: ${s.url}\nTitel: ${s.titel}\n${s.text}`).join('\n\n');
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 1500, system: SYSTEM,
    tools: [RECHERCHE_WERKZEUG], tool_choice: { type: 'tool', name: RECHERCHE_WERKZEUG.name },
    messages: [{ role: 'user', content: `Makler: ${kurz(m.name) || '(unbekannt)'}\nFirma laut unseren Daten: ${kurz(m.firma) || '(unbekannt)'}\nE-Mail laut unseren Daten: ${kurz(m.email) || '(unbekannt)'}\n\n${quellen}` }],
  });
  const block = (data?.content ?? []).find((c: any) => c?.type === 'tool_use' && c.name === RECHERCHE_WERKZEUG.name);
  const e = block?.input ?? {};
  const urls = new Set(seiten.map((s) => s.url));
  const quelleVon = (q: unknown) => (typeof q === 'string' && urls.has(q) ? q : seiten[0]!.url);
  const funde: RechercheFund[] = [];
  const sammeln = (ziel: 'makler' | 'unternehmen', felder: string[], werte: any) => {
    for (const f of felder) {
      const w = werte?.[f];
      const wert = typeof w === 'string' ? w : typeof w?.wert === 'string' ? w.wert : '';
      if (wert.trim()) funde.push({ ziel, feld: f, wert: wert.trim(), quelle: quelleVon(w?.quelle) });
    }
  };
  sammeln('makler', MAKLER_FELDER.filter((f) => f !== 'firma'), e.person);
  sammeln('unternehmen', FIRMEN_FELDER, e.firma);
  const firmenname = typeof e.firma?.name?.wert === 'string' ? e.firma.name.wert.trim() : '';
  if (firmenname) funde.push({ ziel: 'makler', feld: 'firma', wert: firmenname, quelle: quelleVon(e.firma?.name?.quelle) });
  const personSeite = typeof e.personSeite === 'string' && urls.has(e.personSeite) ? e.personSeite : null;
  return { wert: { personGenannt: e.personGenannt === true, personSeite, funde }, model: genutztesModell(data, HAIKU), usage: data?.usage ?? {} };
}

export interface WebsucheErgebnis { webseite: string | null; immoscout: string | null; suchen: number }

/** Anthropic-Websuche: US-$ je Suche (Preisliste 10/2026: 10 $ je 1.000 Suchen). */
export const WEBSUCHE_USD = 0.01;

/** Firmen-Webseite und ImmoScout24-Profil per KI-Websuche (höchstens 3 Suchen). */
export async function rechercheWebsuche(ki: KiClient, m: RechercheMakler): Promise<KiAntwort<WebsucheErgebnis>> {
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'DE' } }],
    messages: [{
      role: 'user',
      content: `Finde für diesen Immobilienmakler in Deutschland die Webseite seiner Firma und, falls vorhanden, das Anbieterprofil auf immobilienscout24.de.
Name: ${kurz(m.name)}\nFirma: ${kurz(m.firma) || '(unbekannt)'}\nE-Mail: ${kurz(m.email) || '(unbekannt)'}\nOrt: ${kurz(m.ort) || '(unbekannt)'}
Nur Treffer, die sicher zu dieser Person oder Firma gehören. Antworte am Ende ausschließlich mit JSON:
{"webseite": "https://…" oder null, "immoscout": "https://www.immobilienscout24.de/anbieter/profil/…" oder null}`,
    }],
  }, 120_000);
  const text = (data?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
  const json = /\{[^{}]*"webseite"[^{}]*\}/.exec(text)?.[0];
  let roh: any = {};
  try { roh = json ? JSON.parse(json) : {}; } catch { roh = {}; }
  const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\/[^\s]+\.[a-z]{2,}/i.test(v) ? v.trim() : null);
  const suchen = Number(data?.usage?.server_tool_use?.web_search_requests ?? 0) || 0;
  return { wert: { webseite: url(roh.webseite), immoscout: url(roh.immoscout), suchen }, model: genutztesModell(data, HAIKU), usage: data?.usage ?? {} };
}
