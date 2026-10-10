import { ANGABE_GRUPPEN, EINHEIT_TYP, EXPOSE_V1_TOOL_NAME, type ExposeV1, exposeV1Leer } from '@gg/domain';
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
 * Schema v1 (Werkzeug extract_expose_v1) versteht zusätzlich:
 *   Grundstück: 480 m2        Hausgeld: 350 EUR        Denkmalschutz: ja
 *   Weitere: zustand | Dach | 2015 neu gedeckt
 *   Kontakt: Max Zweit | Geschäftsführer | 0711 123456 | max@beispiel.test
 *   Attrappe: abgeschnitten   → die erste Antwort endet mit stop_reason max_tokens (nur geo und preise gefüllt)
 * Belege tragen die Seite des letzten Seitenmarkers „──────── Seite N“ vor der Zeile und die Zeile als Zitat.
 */
export function kiAttrappe(): KiClient {
  // erste Zahl im Wert („240 m2“ → 240, „1.250.000 EUR“ → 1250000)
  const zahl = (s: string | undefined) => { const m = s?.match(/\d[\d.,]*/)?.[0]; return m ? Number(m.replace(/\./g, '').replace(',', '.')) || null : null; };
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
      if (werkzeug === EXPOSE_V1_TOOL_NAME) return antwortV1(textBloecke(body), body.tools[0]);
      const feld = (name: string) => new RegExp(`${name}:\\s*([^\\n"]+)`).exec(text)?.[1]?.trim();
      const adresse = /^(.+?)\s+(\d+\s*\w?),\s*(\d{5})\s+(.+)$/.exec(feld('Adresse') ?? '');
      const makler = (feld('Makler') ?? '').split('|').map((s) => s.trim());
      const einheiten = [...text.matchAll(/Einheit:\s*([^\n"]+)/g)].map((m) => {
        const [typ, lage, zimmer, flaeche, kaltmiete] = m[1]!.split('|').map((s) => s.trim());
        return { typ: typ || 'Wohnung', lage, zimmer: zahl(zimmer), flaeche: zahl(flaeche), kaltmiete: zahl(kaltmiete), vermiet: 'Vermietet' };
      });
      const input = {
        objekt: {
          strasse: adresse?.[1] ?? '', hausnr: adresse?.[2] ?? '', plz: adresse?.[3] ?? '', stadt: adresse?.[4] ?? '',
          angebotspreis: zahl(feld('Kaufpreis')), wohnflaeche: zahl(feld('Wohnfläche') ?? feld('Wohnflaeche')), baujahr: zahl(feld('Baujahr')),
          einheitenAnz: einheiten.length || null, einheiten,
        },
        makler: { name: makler[0] ?? '', firma: makler[1] ?? '', mobiltel: makler[2] ?? '', email: makler[3] ?? '' },
        kalkulation: { kaufpreis: zahl(feld('Kaufpreis')) },
        _konfidenz: { strasse: adresse ? 'hoch' : 'niedrig', angebotspreis: feld('Kaufpreis') ? 'hoch' : 'niedrig', wohnflaeche: 'mittel' },
      };
      return { content: [{ type: 'tool_use', name: 'extract_expose_data', input }], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    async dateiHochladen() { return 'attrappe'; },
    async dateiLoeschen() {},
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

// erste Zahl im Wert („240 m2“ → 240, „1.250.000 EUR“ → 1250000)
const zahlV1 = (s: string | undefined) => { const m = s?.match(/\d[\d.,]*/)?.[0]; return m ? Number(m.replace(/\./g, '').replace(',', '.')) || null : null; };

/**
 * Antwort der Attrappe für Schema v1. Liest die „Feld: Wert“-Zeilen seitenweise, damit jeder Beleg seine Seite kennt.
 * Steuerzeile „Attrappe: abgeschnitten“: mit dem vollen Werkzeug nur geo + preise und stop_reason max_tokens; mit dem
 * Werkzeug ohne Einheiten (Wiederholversuch) die vollständige Antwort ohne Einheiten — die holt dann extract_einheiten.
 */
function antwortV1(text: string, tool: any) {
  const v1 = exposeV1Leer();
  const beleg = (zeile: string, seite: number) => ({ seite, zitat: zeile.slice(0, 80), konfidenz: 'hoch' as const });
  const zeilen = text.split('\n');
  let seite = 1;
  let einheitenImDokument = 0;
  for (const roh of zeilen) {
    const zeile = roh.trim();
    const marker = /──────── Seite (\d+)/.exec(zeile);
    if (marker) { seite = Number(marker[1]); continue; }
    const m = /^([A-Za-zÄÖÜäöüß\-]+):\s*(.+)$/.exec(zeile);
    if (!m) continue;
    const [, name, wert] = m as unknown as [string, string, string];
    const teile = wert.split('|').map((t) => t.trim());
    switch (name) {
      case 'Adresse': {
        const a = /^(.+?)\s+(\d+\s*\w?),\s*(\d{5})\s+(.+)$/.exec(wert);
        if (a) { v1.geo = { ...v1.geo, strasse: a[1]!, hausnummer: a[2]!, plz: a[3]!, ort: a[4]! }; v1.belege.adresse = beleg(zeile, seite); }
        break;
      }
      case 'Kaufpreis': v1.preise.kaufpreis = zahlV1(wert); v1.belege.kaufpreis = beleg(zeile, seite); break;
      case 'Wohnfläche': case 'Wohnflaeche': v1.flaechen.wohnflaeche = zahlV1(wert); v1.belege.wohnflaeche = beleg(zeile, seite); break;
      case 'Grundstück': case 'Grundstueck': v1.flaechen.grundstuecksflaeche = zahlV1(wert); v1.belege.grundstueck = beleg(zeile, seite); break;
      case 'Baujahr': v1.zustand.baujahr = zahlV1(wert); v1.belege.baujahr = beleg(zeile, seite); break;
      case 'Hausgeld': v1.preise.hausgeld_monat = zahlV1(wert); break;
      case 'Denkmalschutz': v1.zustand.denkmalschutz = /^(ja|yes|true)$/i.test(wert) ? true : /^(nein|no|false)$/i.test(wert) ? false : null; break;
      case 'Makler': {
        const [person, firma, mobil, email] = teile;
        const namen = (person ?? '').split(/\s+/);
        v1.kontaktperson = { ...v1.kontaktperson, vorname: namen.length > 1 ? namen[0]! : null, name: namen.length > 1 ? namen.slice(1).join(' ') : (person || null), firma: firma || null, mobil: mobil || null, email: email || null };
        break;
      }
      case 'Einheit': {
        const [typ, lage, zimmer, flaeche, kaltmiete] = teile;
        einheitenImDokument++;
        v1.einheiten.push({
          typ: (EINHEIT_TYP as readonly string[]).includes(typ ?? '') ? (typ as ExposeV1['einheiten'][number]['typ']) : 'Wohnung',
          lage: lage || null, zimmer: zahlV1(zimmer), flaeche: zahlV1(flaeche), kaltmiete: zahlV1(kaltmiete),
          nebenkosten: null, sollmiete: null, vermiet: 'Vermietet', mietbeginn: null, _seite: seite,
        });
        break;
      }
      case 'Weitere': {
        const [gruppe, bezeichnung, w] = teile;
        if (bezeichnung && w) v1.weitere_angaben.push({ gruppe: (ANGABE_GRUPPEN as readonly string[]).includes(gruppe ?? '') ? (gruppe as ExposeV1['weitere_angaben'][number]['gruppe']) : 'sonstiges', bezeichnung: bezeichnung.slice(0, 80), wert: w.slice(0, 200), einheit: null, seite });
        break;
      }
      case 'Kontakt': {
        const [kname, rolle, tel, email] = teile;
        if (kname) v1.weitere_kontakte.push({ name: kname, rolle: rolle || null, tel: tel || null, mobil: null, email: email || null });
        break;
      }
      default: break;
    }
  }
  const wohnungen = v1.einheiten.filter((e) => e.typ === 'Wohnung').length;
  v1.verwaltung = { ...v1.verwaltung, anzahl_wohneinheiten: wohnungen || null, einheiten_anzahl_dokument: einheitenImDokument || null, einheiten_vollstaendig: einheitenImDokument > 0 ? true : null };

  const abgeschnitten = /Attrappe:\s*abgeschnitten/.test(text);
  const vollesWerkzeug = !!tool?.input_schema?.properties?.einheiten;
  let input: Record<string, unknown> = v1;
  let stop_reason = 'end_turn';
  if (abgeschnitten && vollesWerkzeug) {
    input = { ...exposeV1Leer(), geo: v1.geo, preise: v1.preise };
    stop_reason = 'max_tokens';
  } else if (!vollesWerkzeug) {
    const { einheiten: _e, freitexte: _f, ...rest } = v1;
    input = rest;
  }
  const json = JSON.stringify(input);
  return { content: [{ type: 'tool_use', name: EXPOSE_V1_TOOL_NAME, input }], stop_reason, usage: { input_tokens: Math.floor(text.length / 4), output_tokens: Math.floor(json.length / 3) } };
}
