// Übernommen aus gg-immohandel server/auto-import-engine.ts (classifyPdfFirstPage, Stand 9d693b8). Prompt und
// Werkzeug wörtlich; geändert ist nur, WIE das PDF zur KI kommt.
/* eslint-disable @typescript-eslint/no-explicit-any -- KI-Antworten sind ungetypt, geprüft wird das Werkzeug-Ergebnis */
import { PDFDocument } from 'pdf-lib';
import type { KiClient } from '../ki/anthropic.ts';

export interface PdfEinordnung {
  type: 'expose' | 'agb' | 'datenschutz' | 'sonstiges';
  confidence: number;
  completeness: 'vollstaendig' | 'eingeschraenkt' | 'unklar';
  missingFields: string[];
  /** konkrete Objektadresse aus dem PDF (Straße + Hausnr + PLZ + Stadt) oder '' */
  extractedAddress: string;
  reason: string;
}

export const NICHT_EINGEORDNET = (grund: string): PdfEinordnung => ({ type: 'sonstiges', confidence: 0, completeness: 'unklar', missingFields: [], extractedAddress: '', reason: grund });

/** Wie viele Seiten die KI sieht. Die alte App rasterte die ersten Seiten zu Bildern; das Urteil fällt auf Deckblatt und Eckdaten. */
export const PRUEF_SEITEN = 3;

/**
 * Die ersten Seiten als eigenes kleines PDF.
 *
 * Verbesserung gegenüber der alten App: dort wurden die Seiten mit pdfjs + @napi-rs/canvas zu JPEGs gerastert — ein
 * natives Paket, das in der Function fehlen kann (genau daran ist das erste Deployment des Neubaus abgestürzt).
 * Die KI liest PDFs inzwischen selbst, mit Text UND Seitenbild; abgeschnitten wird nur, damit ein 60-seitiges Exposé
 * nicht 60 Seiten kostet.
 */
export async function ersteSeiten(pdf: Uint8Array, anzahl = PRUEF_SEITEN): Promise<Uint8Array> {
  const quelle = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  if (quelle.getPageCount() <= anzahl) return pdf;
  const auszug = await PDFDocument.create();
  for (const seite of await auszug.copyPages(quelle, Array.from({ length: anzahl }, (_, i) => i))) auszug.addPage(seite);
  return auszug.save();
}

export async function pdfEinordnen(pdf: Uint8Array, filename: string, ki: KiClient, contextHint?: { mailSubject?: string }): Promise<PdfEinordnung> {
  let auszug: Uint8Array;
  try {
    auszug = await ersteSeiten(pdf);
  } catch {
    return NICHT_EINGEORDNET('PDF konnte nicht gelesen werden');
  }
  const seiten = [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: Buffer.from(auszug).toString('base64') } }];
  const hintLine = contextHint?.mailSubject
    ? `\n\nKONTEXT — Mail-Betreff: "${contextHint.mailSubject}"\nAuch wenn dort eine Adresse stehen mag (z.B. "Mehrfamilienhaus in 73730 Esslingen"), zählt für 'vollstaendig' NUR was IM PDF tatsächlich zu sehen ist.`
    : '';

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: 'Du klassifizierst deutsche Immobilien-Dokumente (Exposé, AGB, etc.) und prüfst beim Exposé die VOLLSTÄNDIGKEIT mit Fokus auf die OBJEKTADRESSE. Antworte nur über das Tool.',
    messages: [{
      role: 'user',
      content: [
        ...seiten,
        { type: 'text' as const, text: `Dateiname: ${filename}${hintLine}

SCHRITT 1: Welcher Dokumenttyp?
- expose: Immobilien-Exposé (Vorschau ODER vollständig)
- agb: AGB, Widerrufsbelehrung, Provisionsvereinbarung, Maklervertrag
- datenschutz: nur Datenschutz-Hinweise
- sonstiges: Verbraucherinformationen, leere Seiten, Werbung

SCHRITT 2 (NUR wenn type='expose'): KONKRETE OBJEKT-ADRESSE im PDF sichtbar?

Extrahiere die OBJEKTADRESSE (Straße + Hausnummer + PLZ + Stadt) in extractedAddress.
WICHTIG — Unterscheidung der Adressen im PDF:
- ✓ OBJEKTADRESSE = Adresse der ANGEBOTENEN Immobilie (steht meist auf Deckblatt, in Lagebeschreibung, in Tabelle "Objektdaten")
- ✗ NICHT Maklerbüro-Adresse, NICHT Ansprechpartner-Adresse, NICHT Notar-Adresse, NICHT Hausverwaltungs-Adresse
- ✗ Lage-Beschreibungen wie "in Esslingen-Mettingen" oder "Stadtteil X" sind KEINE Adressen
- ✓ Nur akzeptieren wenn Straße + Hausnummer + PLZ + Stadt klar dem ANGEBOTENEN OBJEKT zugeordnet sind

Wenn keine eindeutige Objektadresse: extractedAddress=''.

SCHRITT 3: VOLLSTÄNDIG vs EINGESCHRÄNKT?

VOLLSTÄNDIG (= 'vollstaendig') ZWINGEND:
- extractedAddress ist NICHT leer (Objektadresse mit Hausnummer eindeutig sichtbar)
- Mehrere echte Fotos der Immobilie (innen UND/ODER außen — NICHT Stockfotos)
- Detaillierte Beschreibung (Baujahr, Fläche, Zimmer, Einheiten)
- Kaufpreis ODER Mietangaben

EINGESCHRÄNKT (= 'eingeschraenkt') = Teaser/Preview-Modus:
- KEINE konkrete Adresse mit Hausnummer (nur "in Stuttgart-Süd" oder Stadtteil)
- Wenige/keine echten Fotos, oder Stockfotos
- "Vollständiges Exposé nach Akzeptanz" / "Adresse nach Provisionsvereinbarung"
- Sehr kurz (1-2 Seiten ohne Substanz)
- Generische Skizze/Karte statt echtem Foto

REGEL: Wenn extractedAddress='' → IMMER 'eingeschraenkt'. Hausnummer ist Pflicht für 'vollstaendig'.

Liste in missingFields die fehlenden Punkte (z.B. ['adresse', 'fotos', 'mieterliste']).
Bei type≠expose: completeness='unklar', missingFields=[], extractedAddress=''.` },
      ],
    }],
    tools: [{
      name: 'classify',
      description: 'Klassifiziere Dokument, extrahiere Adresse, prüfe Vollständigkeit',
      input_schema: {
        type: 'object',
        properties: {
          type:             { type: 'string', enum: ['expose', 'agb', 'datenschutz', 'sonstiges'] },
          confidence:       { type: 'number', description: '0.0 bis 1.0' },
          completeness:     { type: 'string', enum: ['vollstaendig', 'eingeschraenkt', 'unklar'] },
          missingFields:    { type: 'array', items: { type: 'string' }, description: 'Fehlende Felder, z.B. ["adresse","fotos"]' },
          extractedAddress: { type: 'string', description: 'Objektadresse im Format "Straße Hausnr, PLZ Stadt" oder leerer String wenn nicht gefunden' },
          reason:           { type: 'string' },
        },
        required: ['type', 'confidence', 'completeness', 'missingFields', 'extractedAddress', 'reason'],
      },
    }],
    tool_choice: { type: 'tool', name: 'classify' },
  };

  const resp = await ki.nachricht(body);
  const toolUse = (resp.content || []).find((c: any) => c.type === 'tool_use');
  if (!toolUse?.input) {
    return { type: 'sonstiges', confidence: 0, completeness: 'unklar', missingFields: [], extractedAddress: '', reason: 'KI-Antwort fehlte' };
  }
  return toolUse.input;
}
