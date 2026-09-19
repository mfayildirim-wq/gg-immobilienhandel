/* eslint-disable @typescript-eslint/no-explicit-any -- Makler im Altformat */
/**
 * KI-Aufrufe rund um Makler und Kommunikationsstil. Prompts und Modelle wörtlich aus gg-immohandel
 * src/modules/makler/makler.ts (mkTriggerAISummary) und src/modules/persona/persona.ts; gelesen und geschrieben wird
 * in der API. Kommunikation im Altformat: `{ ts, kanal, richtung, betreff, text }` mit deutschem Zeitstempel, neueste zuerst.
 */
import { geburtstagsHinweisEntwurf, personaDetectAnrede, type DraftResult, type MaklerErwaehnung, type MaklerPersonal, type PersonaProfile } from '@gg/domain';
import type { KiClient } from './anthropic.ts';

export const HAIKU = 'claude-haiku-4-5-20251001';
export const SONNET = 'claude-sonnet-4-5-20250929';

export interface KiAntwort<T> { wert: T; model: string; usage: { input_tokens?: number; output_tokens?: number } }
type Komm = { ts: string; kanal: string; richtung?: string | null; betreff?: string | null; text: string };

const textAus = (data: any) => (data?.content?.[0]?.text || '') as string;
const jsonAus = (text: string) => { const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('Keine JSON-Antwort erhalten'); return JSON.parse(m[0]); };

/** mkTriggerAISummary: kurze Zusammenfassung aus den letzten 50 Einträgen. */
export async function maklerZusammenfassung(ki: KiClient, mk: { name?: string | null; firma?: string | null }, komm: Komm[]): Promise<KiAntwort<string> | null> {
  if (!komm.length) return null;
  const eintraege = komm.slice(0, 50).map((k) =>
    `[${k.ts}] [${k.kanal}${k.richtung && k.richtung !== '' ? ' · ' + k.richtung : ''}]${k.betreff ? ' Betreff: ' + k.betreff : ''}:\n${k.text}`,
  ).join('\n\n');
  const data = await ki.nachricht({
    model: HAIKU, max_tokens: 400,
    messages: [{ role: 'user', content: `Makler: ${mk.name}${mk.firma ? ', ' + mk.firma : ''}\n\nKommunikationshistorie:\n${eintraege}\n\nErstelle eine kurze, prägnante Zusammenfassung (3-5 Sätze auf Deutsch): Wer ist dieser Makler? Welche Objekttypen/Regionen? Wie ist die Beziehungsqualität? Was sind aktuelle Themen oder nächste Schritte?` }],
  });
  const summary = textAus(data);
  return summary ? { wert: summary, model: HAIKU, usage: data?.usage ?? {} } : null;
}

/** personaExtractRelationshipNote: Beziehungsprofil (2-3 Sätze). Unter zwei Einträgen: Fehler wie alt. */
export async function beziehungsprofil(ki: KiClient, mk: { name?: string | null; firma?: string | null }, komm: Komm[]): Promise<KiAntwort<string>> {
  if (komm.length < 2) throw new Error('Noch zu wenig Kommunikation mit diesem Makler');
  const commText = komm.slice(0, 30).map((k) => {
    const dir = k.richtung ? ` [${k.richtung}]` : '';
    return `[${k.ts}] [${k.kanal}${dir}]${k.betreff ? ' Betreff: ' + k.betreff : ''}: ${k.text.substring(0, 300)}`;
  }).join('\n\n');
  const prompt = `Analysiere die Kommunikation zwischen einem Immobilieninvestor und dem Makler "${mk.name || 'Unbekannt'}"${mk.firma ? ' (' + mk.firma + ')' : ''}.

KOMMUNIKATION:
${commText}

Erstelle ein kurzes Beziehungsprofil (2-3 Sätze) das beschreibt:
1. Du/Sie? Wie ist das Verhältnis — formell, freundschaftlich, kollegial?
2. Besondere Eigenheiten dieser Beziehung (z.B. Insider-Themen, persönliche Details, gemeinsame Interessen)
3. Worauf muss bei der Kommunikation mit dieser Person besonders geachtet werden?

Antworte NUR mit dem Profiltext, kein JSON, keine Formatierung.`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
  return { wert: textAus(data).trim(), model: HAIKU, usage: data?.usage ?? {} };
}

/** personaExtractPersonalDetails: strukturierte persönliche Details (JSON). */
export async function persoenlichesExtrahieren(ki: KiClient, mk: { name?: string | null }, komm: Komm[]): Promise<KiAntwort<Partial<MaklerPersonal> & Record<string, any>> | null> {
  if (!komm.length) return null;
  const commText = komm.slice(0, 50).map((k) => `[${k.ts}][${k.kanal}${k.richtung ? ' ' + k.richtung : ''}]: ${k.text.substring(0, 300)}`).join('\n\n');
  const prompt = `Analysiere dieses Kommunikationsprotokoll mit dem Immobilienmakler "${mk.name || 'Unbekannt'}". Extrahiere alle persönlichen Informationen über den MAKLER.

KOMMUNIKATION:
${commText}

Antworte als JSON. Lass Felder weg die nicht erkennbar sind:
{
  "geburtsdatum": "MM-DD oder YYYY-MM-DD",
  "partner": "Name",
  "kinder": "z.B. '2 Kinder, Max 8J, Lena 5J'",
  "haustiere": "z.B. 'Hund Max, Labrador'",
  "hobbies": ["Hobby1"],
  "lieblingsverein": "z.B. 'BVB'",
  "wohnort": "Stadt",
  "discTyp": "D|I|S|C",
  "discBeschreibung": "2 Sätze zur Persönlichkeit",
  "kommunikationsrhythmus": "z.B. 'Antwortet abends, mag kurze WAs'",
  "spezialisierung": ["Wohnimmobilien"],
  "regionen": ["Berlin-Mitte"],
  "gespraechsthemen": ["Themen die er gerne anspricht"],
  "vermeiden": ["Sensitive Themen"],
  "insiderWissen": "Sonstiges wichtiges Wissen"
}`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
  const m = textAus(data).match(/\{[\s\S]*\}/);
  if (!m) return null;
  return { wert: JSON.parse(m[0]), model: HAIKU, usage: data?.usage ?? {} };
}

/** personaExtractMentions: bis zu zwei persönliche Erwähnungen aus einem neuen Eintrag. */
export async function erwaehnungenExtrahieren(ki: KiClient, entryText: string, kanal: string): Promise<KiAntwort<{ thema: string; detail: string }[]>> {
  const prompt = `Aus diesem ${kanal}-Text mit einem Immobilienmakler: Extrahiere persönliche Informationen oder Erwähnungen über den MAKLER selbst (nicht über den Investor).

TEXT: ${entryText.substring(0, 500)}

Suche nach: Hobbies, Sport, Familie, Urlaub, Haustiere, persönliche Termine, Befindlichkeiten.
Nur wirklich persönliche Details. Max 2 Einträge.

Antworte als JSON: {"mentions":[{"thema":"Fußball","detail":"Erwähnt BVB-Sieg"}]}
Wenn nichts Persönliches: {"mentions":[]}`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 150, messages: [{ role: 'user', content: prompt }] });
  const m = textAus(data).match(/\{[\s\S]*\}/);
  const mentions = m ? ((JSON.parse(m[0]).mentions || []) as any[]).filter((x) => x.thema && x.detail) : [];
  return { wert: mentions, model: HAIKU, usage: data?.usage ?? {} };
}

/** personaAnalyse: Kommunikationsstil aus den neuesten ausgehenden Nachrichten (Sonnet). */
export async function stilAnalysieren(ki: KiClient, entries: any[], total: number, konfidenz: number, jetzt: string): Promise<KiAntwort<PersonaProfile>> {
  if (total < 3) throw new Error('Noch zu wenig Kommunikation (min. 3 ausgehende Nachrichten)');
  const commText = entries.map((e) => {
    const label = `[${e.ts}] [${String(e.kanal).toUpperCase()}${e.betreff ? ' | Betreff: ' + e.betreff : ''}] (Makler: ${e.makler})`;
    return label + '\n' + e.text;
  }).join('\n\n---\n\n');
  const prompt = `Du analysierst den Kommunikationsstil einer Person bei der gewerblichen Immobilienakquise (Ankauf von Mehrfamilienhäusern und Renditeobjekten in Deutschland).

Unten findest du alle ausgehenden Nachrichten dieser Person an Immobilienmakler — per WhatsApp, E-Mail und als Gesprächstranskripte.

AUSGEHENDE KOMMUNIKATION (${total} Einträge, zeige ${entries.length}):

${commText}

---

Analysiere TIEF und präzise. Erkenne echte Muster, keine Vermutungen. Antworte ausschließlich als JSON:

{
  "anrede": "Wie genau wird der Gesprächspartner angesprochen? (z.B. 'Hallo Herr X', 'Guten Tag', 'Hi', etc.)",
  "abschluss": {
    "wa": "Typische WhatsApp-Schlussformel",
    "email": "Typische E-Mail-Schlussformel mit Grußformel und Namensunterschrift"
  },
  "tonWA": "Beschreibe Ton/Stil für WhatsApp: formell/informell, Satzlänge, Emojis ja/nein, Direktheit",
  "tonEmail": "Beschreibe Ton/Stil für E-Mail: Struktur, Länge, Formalität, Absatzaufbau",
  "themenMuster": "Welche Themen werden typischerweise angesprochen und in welcher Reihenfolge? (z.B. Preisverhandlung, Standort, Rendite, nächster Kontakt)",
  "vokabular": "Bevorzugte Fachbegriffe und Wendungen (z.B. 'Liegenschaft' vs 'Objekt', typische Redewendungen)",
  "laenge": {
    "wa": "Typische WA-Länge (z.B. '2-3 kurze Sätze')",
    "email": "Typische E-Mail-Länge (z.B. '4-6 Sätze, 2 Absätze')"
  },
  "rawAnalysis": "3-4 Sätze: Was macht diese Person besonders? Ihr Kerncharakter in der Kommunikation? Erkennungsmerkmale die man in JEDEN Entwurf einbauen muss?"
}`;
  const data = await ki.nachricht({ model: SONNET, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
  const parsed = jsonAus(textAus(data));
  return {
    wert: {
      analysisTs: jetzt, commAnalyzed: total, confidence: konfidenz, anrede: parsed.anrede || '', abschluss: parsed.abschluss || { wa: '', email: '' },
      tonWA: parsed.tonWA || '', tonEmail: parsed.tonEmail || '', themenMuster: parsed.themenMuster || '', vokabular: parsed.vokabular || '',
      laenge: parsed.laenge || { wa: '', email: '' }, rawAnalysis: parsed.rawAnalysis || '',
    },
    model: SONNET, usage: data?.usage ?? {},
  };
}

/** personaDraftMessage: WhatsApp und E-Mail für den Nachfass-Kontakt. */
export async function nachrichtEntwerfen(
  ki: KiClient,
  profile: PersonaProfile,
  mk: { name?: string | null; firma?: string | null; lastContact?: string | null; erstellt?: string | null; relationshipNote?: string | null; personal?: (MaklerPersonal & Record<string, any>) | null },
  komm: Komm[],
  aktiveDeals: { adresse?: string | null; stadt?: string | null; status: string }[],
  jetzt: Date,
): Promise<KiAntwort<DraftResult>> {
  const deals = aktiveDeals.map((d) => `${d.adresse || 'Adresse unbekannt'}${d.stadt ? ', ' + d.stadt : ''} (${d.status})`).join('; ') || 'keine aktiven Deals';
  const recentKomm = komm.slice(0, 5);
  const kommContext = recentKomm.length > 0
    ? recentKomm.map((k) => `[${k.ts}] [${k.kanal}${k.richtung ? ' ' + k.richtung : ''}]${k.betreff ? ' Betreff: ' + k.betreff : ''}: ${k.text.substring(0, 200)}`).join('\n')
    : 'Noch keine Kommunikation gespeichert';
  const lastC = mk.lastContact || mk.erstellt || '';
  const daysSince = lastC ? Math.floor((jetzt.getTime() - new Date(lastC).getTime()) / 86_400_000) : null;
  const kontaktInfo = daysSince !== null ? `${daysSince} Tage seit letztem Kontakt` : 'Noch nie kontaktiert';
  const anredeDetected = personaDetectAnrede(komm);
  const anredeHinweis = anredeDetected !== 'unbekannt'
    ? `⚠️ WICHTIG: Mit diesem Makler wird konsequent "${anredeDetected === 'du' ? 'Du' : 'Sie'}" gesprochen. Niemals davon abweichen!`
    : '';
  const relationshipNote = (mk.relationshipNote || '').trim();
  const personal: any = mk.personal || {};
  const mentions: MaklerErwaehnung[] = (personal.letzteErwaehnung || []).slice(0, 5);
  const mentionsText = mentions.length ? mentions.map((m) => `- ${m.thema}: ${m.detail} (${m.ts})`).join('\n') : '';
  const bdayHinweis = geburtstagsHinweisEntwurf(personal.geburtsdatum, jetzt);
  const personalFacts: string[] = [];
  if (bdayHinweis) personalFacts.unshift(bdayHinweis);
  if (personal.lieblingsverein) personalFacts.push(`Lieblingsverein: ${personal.lieblingsverein}`);
  if (personal.haustiere) personalFacts.push(`Haustier: ${personal.haustiere}`);
  if (personal.hobbies?.length) personalFacts.push(`Hobbies: ${personal.hobbies.join(', ')}`);
  if (personal.partner) personalFacts.push(`Partner: ${personal.partner}`);
  if (personal.kinder) personalFacts.push(`Kinder: ${personal.kinder}`);
  if (personal.kommunikationsrhythmus) personalFacts.push(`Kommunikationsrhythmus: ${personal.kommunikationsrhythmus}`);
  if (personal.discTyp) personalFacts.push(`Persönlichkeit (DISC): ${personal.discTyp}${personal.discBeschreibung ? ' — ' + personal.discBeschreibung : ''}`);
  if (personal.vermeiden?.length) personalFacts.push(`⚠️ Vermeiden: ${personal.vermeiden.join(', ')}`);
  const personalContext = [personalFacts.length ? personalFacts.join('\n') : '', mentionsText ? `\nLetzte persönliche Erwähnungen:\n${mentionsText}` : ''].filter(Boolean).join('\n');

  const prompt = `Du schreibst im Auftrag eines Immobilieninvestors eine WhatsApp-Nachricht UND eine E-Mail an einen Immobilienmakler.

${anredeHinweis ? anredeHinweis + '\n\n' : ''}${relationshipNote ? `⚠️ BEZIEHUNGSPROFIL MIT DIESEM MAKLER (hat absoluten Vorrang vor dem allgemeinen Stil):
${relationshipNote}

` : ''}${personalContext ? `PERSÖNLICHE DETAILS ZU DIESEM MAKLER (nutze relevantes diskret und natürlich — kein aufdringliches Namedropping):
${personalContext}

` : ''}ALLGEMEINER NUTZERSTIL (Basis, wird durch Beziehungsprofil überschrieben):
- Anrede (Standard): ${profile.anrede}
- Ton WA: ${profile.tonWA}
- Ton E-Mail: ${profile.tonEmail}
- Länge WA: ${profile.laenge.wa}
- Länge E-Mail: ${profile.laenge.email}
- Typische Themen: ${profile.themenMuster}
- Vokabular: ${profile.vokabular}
- Abschluss WA: ${profile.abschluss.wa}
- Abschluss E-Mail: ${profile.abschluss.email}
- Kerncharakter: ${profile.rawAnalysis}

MAKLER: ${mk.name || 'Unbekannt'}${mk.firma ? ', ' + mk.firma : ''}
KONTEXT: ${kontaktInfo}
AKTIVE DEALS: ${deals}

LETZTE KOMMUNIKATION MIT DIESEM MAKLER:
${kommContext}

Schreibe jetzt eine WhatsApp-Nachricht und eine E-Mail für einen routinemäßigen Nachfass-Kontakt.
- Passe Du/Sie, Ton und Vertrautheit exakt an diesen spezifischen Makler an
- Nutze konkrete Details aus der Kommunikationshistorie
- Kein generisches "Wie geht es Ihnen" — sprich echte, relevante Themen an
- Falls passend: baue persönliche Details dezent und natürlich ein (Eisbrecher, Gesprächsbrücke)

Antworte NUR als JSON, kein Markdown, kein Kommentar:
{"wa":"...","email":{"subject":"...","body":"..."}}`;
  const data = await ki.nachricht({ model: HAIKU, max_tokens: 800, messages: [{ role: 'user', content: prompt }] });
  return { wert: jsonAus(textAus(data)) as DraftResult, model: HAIKU, usage: data?.usage ?? {} };
}

/** Whisper-Transkription (POST /api/transcribe der alten App): Deutsch, whisper-1. */
export async function transkribieren(openaiKey: string, audio: Uint8Array, typ: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: typ || 'audio/webm' }), 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'de');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form });
  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || data?.error) throw Object.assign(new Error(String(data?.error?.message || data?.error || `OpenAI antwortete mit HTTP ${response.status}`).slice(0, 300)), { status: response.status });
  return data.text || '';
}
