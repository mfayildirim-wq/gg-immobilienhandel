import { EXPOSE_V2_TOOL_NAME, type ExposeV2, exposeV2Leer } from '@gg/domain';
import { HINWEIS_NACHFASS_V2, HINWEIS_WIEDERHOLUNG_V2 } from '../expose/prompt-v2.ts';
import type { KiClient } from './anthropic.ts';

/**
 * KI-Attrappe für Tests und lokale Entwicklung ohne API-Schlüssel (KI_ATTRAPPE=1).
 * Liest einfache „Feld: Wert“-Zeilen aus dem Text, den die Analyse schickt, und antwortet im Format des Tools.
 * Kein Ersatz für die echte Auswertung – die Oberfläche kennzeichnet den Test-Modus.
 *
 *   Adresse: Lindenstraße 12, 70178 Stuttgart
 *   Kaufpreis: 1.250.000 €        Wohnfläche: 480 m²        Baujahr: 1978
 *   Makler: Anna Beispiel | Beispiel Immobilien GmbH | 0171 1234567 | anna@beispiel.test
 *   Einheit: Wohnung | EG links | 3 | 78 | 780
 *
 * Erfassung v2 (Werkzeug erfasse_expose) liest dieselben Zeilen seitenweise als wörtliche Angaben mit Seite, Standard-Pfad
 * und gg-Vorschlag; die Einheit-Zeilen werden eine Mietliste (`attrappeErfassung`). Zusätzlich:
 *   Grundstück: 480 m2        Hausgeld: 350 EUR        Denkmalschutz: ja
 *   Instandhaltungsrücklage: 12.000 EUR   → ohne Pfad, gg-Vorschlag details.instandhaltungsruecklage
 *   Besichtigung: nach Vereinbarung       → ohne Pfad und ohne Vorschlag (ebenso jede andere unbekannte „Feld: Wert“-Zeile)
 *   Kontakt: Max Zweit | Geschäftsführer | 0711 123456 | max@beispiel.test   → Kontakt 2, 3 …
 *   Attrappe: abgeschnitten   → die erste Antwort endet mit stop_reason max_tokens (nur die ersten Angaben)
 */
const zahl = (s: string | undefined) => { const m = s?.match(/\d[\d.,]*/)?.[0]; return m ? Number(m.replace(/\./g, '').replace(',', '.')) || null : null; };

export function kiAttrappe(): KiClient {
  // erste Zahl im Wert („240 m2“ → 240, „1.250.000 EUR“ → 1250000)
  return {
    async nachricht(body: any) {
      // Aufrufe ohne Werkzeug (Makler-KI, Persona): feste, erkennbare Textantworten
      if (!body?.tools) return { content: [{ type: 'text', text: textAntwort(String(body?.messages?.[0]?.content ?? '')) }], usage: { input_tokens: 0, output_tokens: 0 } };
      if (body.tools[0]?.name === 'extract_einheiten') {
        // Einheiten-Zeilen „Einheit: Typ | Lage | Zimmer | Fläche | Kaltmiete“ direkt aus dem (unkomprimierten) Test-PDF
        const dok = body.messages?.[0]?.content?.find?.((c: any) => c.type === 'document')?.source?.data ?? '';
        const roh = Buffer.from(dok, 'base64').toString('latin1');
        const einheiten = [...roh.matchAll(/\(Einheit:\s*([^)]*)\)/g)].map((m) => {
          const [typ, lage, zimmer, flaeche, kaltmiete] = m[1]!.split('|').map((s) => s.trim());
          return { typ: typ || 'Wohnung', lage: lage ?? '', zimmer: zahl(zimmer), flaeche: zahl(flaeche), kaltmiete: zahl(kaltmiete) };
        });
        return { content: [{ type: 'tool_use', name: 'extract_einheiten', input: { einheiten } }], usage: { input_tokens: 0, output_tokens: 0 } };
      }
      // Auto-Import: die vier engen Fragen des Bots, nach festen Regeln am Dateinamen beantwortet (Test-Modus)
      const werkzeug = body.tools[0]?.name as string | undefined;
      const ohneKosten = { input_tokens: 0, output_tokens: 0 };
      if (werkzeug === 'classify') {
        const dateiname = /Dateiname: ([^\\\n"]*)/.exec(JSON.stringify(body.messages))?.[1] ?? '';
        const input = /agb|widerruf|datenschutz/i.test(dateiname)
          ? { type: 'agb', confidence: 0.95, completeness: 'unklar', missingFields: [], extractedAddress: '', reason: 'Rechtsdokument (Test-Modus)' }
          : /vorschau|teaser/i.test(dateiname)
            ? { type: 'expose', confidence: 0.8, completeness: 'eingeschraenkt', missingFields: ['adresse', 'fotos'], extractedAddress: '', reason: 'Vorschau (Test-Modus)' }
            : { type: 'expose', confidence: 0.9, completeness: 'vollstaendig', missingFields: [], extractedAddress: 'Musterweg 1, 89073 Ulm', reason: 'vollständig (Test-Modus)' };
        return { content: [{ type: 'tool_use', name: werkzeug, input }], usage: ohneKosten };
      }
      if (werkzeug === 'classify_page') return { content: [{ type: 'tool_use', name: werkzeug, input: { type: 'agb-form' } }], usage: ohneKosten };
      if (werkzeug === 'rank') return { content: [{ type: 'tool_use', name: werkzeug, input: { orderedIndices: [] } }], usage: ohneKosten };
      if (werkzeug === 'pick_link') return { content: [{ type: 'tool_use', name: werkzeug, input: { selectedIndex: 0, reason: 'Test-Modus' } }], usage: ohneKosten };
      // Bank-Präsentation: der bereits erfasste Bestand zuerst, dann je ein erkennbarer Punkt; der Text nennt die Zahl der Fakten
      const frage = String(body.messages?.[0]?.content ?? '');
      if (werkzeug === 'lagebeschreibung_speichern') {
        const bestand = /Standort:\n([\s\S]*?)\nAnbindung:\n([\s\S]*?)\n\nLiefere/.exec(frage);
        const punkte = (block: string | undefined) => (block ?? '').split('\n').map((z) => z.replace(/^- /, '').trim()).filter((z) => z && z !== '(noch nichts)');
        const stadt = /STADT: (.*)/.exec(frage)?.[1] ?? '';
        const input = { standortBullets: [...punkte(bestand?.[1]), `Wohnlage in ${stadt} (Test-Modus)`], anbindungBullets: [...punkte(bestand?.[2]), 'ÖPNV in der Nähe (Test-Modus)'] };
        return { content: [{ type: 'tool_use', name: werkzeug, input }], usage: ohneKosten };
      }
      if (werkzeug === 'objektbeschreibung_speichern') {
        const fakten = (/VORHANDENE FAKTEN:\n([\s\S]*?)\n\n/.exec(frage)?.[1] ?? '').split('\n').filter(Boolean).length;
        return { content: [{ type: 'tool_use', name: werkzeug, input: { beschreibung: `Bei dem Objekt handelt es sich um ein Mehrfamilienhaus in solider Bausubstanz (Test-Modus, ${fakten} Fakten).` } }], usage: ohneKosten };
      }

      const text = JSON.stringify(body?.messages ?? []).replace(/\\n/g, '\n');
      if (werkzeug === EXPOSE_V2_TOOL_NAME) return antwortV2(textBloecke(body), body.tools[0]);
      const input = teilA(text);
      return { content: [{ type: 'tool_use', name: 'extract_expose_data', input }], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    async dateiHochladen() { return 'attrappe'; },
    async dateiLoeschen() {},
  };
}

/** Teil A wie das bisherige Werkzeug (`extract_expose_data`): objekt, makler, kalkulation, _konfidenz aus den Testzeilen. */
function teilA(text: string) {
  const feld = (name: string) => new RegExp(`${name}:\\s*([^\\n"]+)`).exec(text)?.[1]?.trim();
  const adresse = /^(.+?)\s+(\d+\s*\w?),\s*(\d{5})\s+(.+)$/.exec(feld('Adresse') ?? '');
  const makler = (feld('Makler') ?? '').split('|').map((s) => s.trim());
  const einheiten = [...text.matchAll(/Einheit:\s*([^\n"]+)/g)].map((m) => {
    const [typ, lage, zimmer, flaeche, kaltmiete] = m[1]!.split('|').map((s) => s.trim());
    return { typ: typ || 'Wohnung', lage, zimmer: zahl(zimmer), flaeche: zahl(flaeche), kaltmiete: zahl(kaltmiete), vermiet: 'Vermietet' };
  });
  return {
    objekt: {
      strasse: adresse?.[1] ?? '', hausnr: adresse?.[2] ?? '', plz: adresse?.[3] ?? '', stadt: adresse?.[4] ?? '',
      angebotspreis: zahl(feld('Kaufpreis')), wohnflaeche: zahl(feld('Wohnfläche') ?? feld('Wohnflaeche')), baujahr: zahl(feld('Baujahr')),
      einheitenAnz: einheiten.length || null, einheiten,
    },
    makler: { name: makler[0] ?? '', firma: makler[1] ?? '', mobiltel: makler[2] ?? '', email: makler[3] ?? '' },
    kalkulation: { kaufpreis: zahl(feld('Kaufpreis')) },
    _konfidenz: { strasse: adresse ? 'hoch' : 'niedrig', angebotspreis: feld('Kaufpreis') ? 'hoch' : 'niedrig', wohnflaeche: 'mittel' },
  };
}

/** Textantworten der Attrappe je Prompt-Art (Test-Modus, keine echte Auswertung). */
function textAntwort(prompt: string): string {
  if (prompt.includes('{"mentions":')) {
    const m = /TEXT: ([\s\S]*?)\n\nSuche nach/.exec(prompt)?.[1] ?? '';
    return JSON.stringify({ mentions: /urlaub/i.test(m) ? [{ thema: 'Urlaub', detail: 'Erwähnt Urlaub (Test-Modus)' }] : [] });
  }
  if (prompt.includes('"geburtsdatum": "MM-DD oder YYYY-MM-DD"')) {
    const geb = /Geburtstag(?: am)?:?\s*(\d{2}-\d{2})/i.exec(prompt)?.[1];
    return JSON.stringify({ ...(geb ? { geburtsdatum: geb } : {}), hobbies: ['Test-Modus'] });
  }
  if (prompt.includes('{"wa":"...","email"')) return JSON.stringify({ wa: 'Hallo, kurze Nachfrage zum Objekt (Test-Modus).', email: { subject: 'Nachfrage (Test-Modus)', body: 'Guten Tag,\n\nkurze Nachfrage (Test-Modus).' } });
  if (prompt.includes('"rawAnalysis"')) {
    return JSON.stringify({ anrede: 'Hallo', abschluss: { wa: 'VG', email: 'Viele Grüße' }, tonWA: 'kurz', tonEmail: 'sachlich', themenMuster: 'Objekt, Preis', vokabular: 'Objekt', laenge: { wa: '2 Sätze', email: '4 Sätze' }, rawAnalysis: 'Test-Modus: direkt und freundlich.' });
  }
  if (prompt.startsWith('Analysiere die Kommunikation zwischen')) return 'Test-Modus: sachlich-freundliche Beziehung per Sie.';
  return 'Test-Modus: Zusammenfassung der Kommunikation.';
}

/** Die Textblöcke der user-Nachricht (ohne JSON-Hülle), damit Zeilen und Seitenmarker sauber lesbar sind. */
function textBloecke(body: any): string {
  const inhalt = body?.messages?.[0]?.content;
  if (typeof inhalt === 'string') return inhalt;
  return (Array.isArray(inhalt) ? inhalt : []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text ?? '')).join('\n');
}

type Angabe = ExposeV2['angaben'][number];

/** Bekannte „Feld: Wert“-Zeilen → Standard-Pfad und gg-Vorschlag (wie die echte KI sie zuordnen würde). */
const FELDER_V2: Record<string, { pfad: Angabe['pfad']; gg: Angabe['gg'] }> = {
  Adresse: { pfad: 'geo.strasse', gg: 'objekt.strasse' },
  Kaufpreis: { pfad: 'preise.kaufpreis', gg: 'objekt.angebotspreis' },
  Wohnfläche: { pfad: 'flaechen.wohnflaeche', gg: 'objekt.wohnflaeche' },
  Wohnflaeche: { pfad: 'flaechen.wohnflaeche', gg: 'objekt.wohnflaeche' },
  Grundstück: { pfad: 'flaechen.grundstuecksflaeche', gg: 'objekt.grundstueck' },
  Grundstueck: { pfad: 'flaechen.grundstuecksflaeche', gg: 'objekt.grundstueck' },
  Baujahr: { pfad: 'zustand_angaben.baujahr', gg: 'objekt.baujahr' },
  Hausgeld: { pfad: 'preise.hausgeld', gg: 'details.hausgeld_monat' },
  Denkmalschutz: { pfad: 'verwaltung_objekt.denkmalgeschuetzt', gg: 'details.denkmalschutz' },
  // bewusst ohne Pfad: Angabe ohne Mapping, nur mit Vorschlag
  Instandhaltungsrücklage: { pfad: null, gg: 'details.instandhaltungsruecklage' },
  Instandhaltungsruecklage: { pfad: null, gg: 'details.instandhaltungsruecklage' },
};

const mobil = (tel: string | undefined) => /^(\+49\s?|0)1/.test(tel ?? '');

/** Spalten der Mietliste aus den „Einheit:“-Zeilen. */
const SPALTEN_V2: ExposeV2['einheiten_tabellen'][number]['spalten'] = [
  { ueberschrift: 'Art', feld: 'typ' }, { ueberschrift: 'Lage', feld: 'lage' }, { ueberschrift: 'Zimmer', feld: 'zimmer' },
  { ueberschrift: 'Fläche', feld: 'flaeche' }, { ueberschrift: 'Kaltmiete', feld: 'kaltmiete' },
];

/** Die Zeilen der Attrappe als Erfassung v2: Angaben wörtlich mit Seite, Einheit-Zeilen als eine Mietliste. */
export function attrappeErfassung(text: string): ExposeV2 {
  const v2 = exposeV2Leer();
  const neu = (bezeichnung: string, wert: string, seite: number, pfad: Angabe['pfad'], gg: Angabe['gg'] = null, kontakt: number | null = null) => {
    if (wert) v2.angaben.push({ bezeichnung, wert, seite, pfad, kontakt, gg });
  };
  const zeilen: string[][] = [];
  let tabellenSeite: number | null = null;
  let seite = 0; // vor dem ersten Seitenmarker steht nur die Anweisung
  let kontakte = 1;
  for (const roh of text.split('\n')) {
    const zeile = roh.trim();
    const marker = /^──────── Seite (\d+)/.exec(zeile);
    if (marker) { seite = Number(marker[1]); continue; }
    if (!seite || !zeile || /^Attrappe:/.test(zeile)) continue;
    const m = /^([A-Za-zÄÖÜäöüß\-]+):\s*(.+)$/.exec(zeile);
    if (!m) {
      if (/^Expose\b/i.test(zeile)) neu('Titel', zeile, seite, 'freitexte.objekttitel', 'details.titel');
      else if (zeile.length >= 60) neu('Lage', zeile, seite, 'freitexte.lage', 'objekt.lagebeschreibung');
      continue;
    }
    const [, name, wert] = m as unknown as [string, string, string];
    const teile = wert.split('|').map((t) => t.trim());
    if (name === 'Einheit') { zeilen.push(teile.slice(0, 5)); tabellenSeite ??= seite; continue; }
    if (name === 'Makler' || name === 'Kontakt') {
      const nr = name === 'Makler' ? 1 : ++kontakte;
      const [person, zweites, tel, email] = teile;
      if (name === 'Makler') {
        const namen = (person ?? '').split(/\s+/);
        if (namen.length > 1) { neu('Vorname', namen[0]!, seite, 'kontaktperson.vorname', 'makler.name', nr); neu('Name', namen.slice(1).join(' '), seite, 'kontaktperson.name', 'makler.name', nr); }
        else neu('Name', person ?? '', seite, 'kontaktperson.name', 'makler.name', nr);
        neu('Firma', zweites ?? '', seite, 'kontaktperson.firma', 'makler.firma', nr);
        neu('Telefon', tel ?? '', seite, mobil(tel) ? 'kontaktperson.tel_handy' : 'kontaktperson.tel_durchw', mobil(tel) ? 'makler.mobiltel' : 'makler.festnetztel', nr);
        neu('E-Mail', email ?? '', seite, 'kontaktperson.email_direkt', 'makler.email', nr);
      } else {
        neu('Ansprechpartner', person ?? '', seite, 'kontaktperson.name', null, nr);
        neu('Position', zweites ?? '', seite, 'kontaktperson.position', null, nr);
        neu('Telefon', tel ?? '', seite, mobil(tel) ? 'kontaktperson.tel_handy' : 'kontaktperson.tel_durchw', null, nr);
        neu('E-Mail', email ?? '', seite, 'kontaktperson.email_direkt', null, nr);
      }
      continue;
    }
    const f = FELDER_V2[name];
    neu(name, wert, seite, f?.pfad ?? null, f?.gg ?? null);
  }
  if (zeilen.length) v2.einheiten_tabellen.push({ seite: tabellenSeite, titel: 'Mietaufstellung', spalten: SPALTEN_V2, zeilen: zeilen.map((z) => SPALTEN_V2.map((_, i) => z[i] ?? '')) });
  v2.einheiten_im_dokument = zeilen.length || null;
  v2.einheiten_vollstaendig = true;
  return v2;
}

/**
 * Antwort der Attrappe für die Erfassung v2. Das Nachfass-Werkzeug (ohne `angaben`) bekommt nur die Tabellen.
 * Steuerzeile „Attrappe: abgeschnitten“: die erste Antwort enthält nur die ersten Angaben und endet mit max_tokens; die
 * Wiederholung (Hinweis in der user-Nachricht) liefert alle Angaben ohne Mietliste — die holt dann der Nachfass.
 */
function antwortV2(text: string, tool: any) {
  const wiederholt = text.includes(HINWEIS_WIEDERHOLUNG_V2);
  const sauber = text.replace(HINWEIS_WIEDERHOLUNG_V2, '').replace(HINWEIS_NACHFASS_V2, '');
  const v2 = attrappeErfassung(sauber);
  const { schema: _s, felder: _f, ...teilB } = v2;
  // nur Teil B — Teil A beantwortet die Attrappe über das bisherige Werkzeug (eigener Aufruf)
  const voll: Record<string, unknown> = { ...teilB };
  const nurEinheiten = !tool?.input_schema?.properties?.angaben;
  let input: Record<string, unknown> = voll;
  let stop_reason = 'end_turn';
  if (nurEinheiten) {
    input = { einheiten_tabellen: v2.einheiten_tabellen, einheiten_im_dokument: v2.einheiten_im_dokument, einheiten_vollstaendig: true };
  } else if (wiederholt) {
    input = { ...voll, einheiten_tabellen: [], einheiten_vollstaendig: false };
  } else if (/Attrappe:\s*abgeschnitten/.test(text)) {
    input = { ...voll, angaben: v2.angaben.slice(0, 2), einheiten_tabellen: [] };
    stop_reason = 'max_tokens';
  }
  const json = JSON.stringify(input);
  return { content: [{ type: 'tool_use', name: EXPOSE_V2_TOOL_NAME, input }], stop_reason, usage: { input_tokens: Math.floor(text.length / 4), output_tokens: Math.floor(json.length / 3) } };
}
