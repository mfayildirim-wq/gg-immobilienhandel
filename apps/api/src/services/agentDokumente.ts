import { pdfText } from '@gg/integrations';

/** Eine Datei der App als Text für den Agenten: PDF über die Textebene, Text direkt, sonst ein Hinweis. */
export async function dokumentAlsText(d: { bytes: Uint8Array; mime: string }): Promise<string> {
  const MAX = 40_000;
  // Am Dateianfang erkennen: SharePoint-Downloads kommen oft als application/octet-stream
  const istPdf = d.mime === 'application/pdf' || new TextDecoder().decode(d.bytes.slice(0, 5)) === '%PDF-';
  if (istPdf) {
    const r = await pdfText(Buffer.from(d.bytes));
    const text = r.text.trim();
    // Seitenmarken („──── Seite 1“) zählen nicht: ein Scan hat Marken, aber keinen Text
    const ohneMarken = text.split('\n').filter((z) => !/^[─-]{3,}\s*Seite\s+\d+/.test(z.trim())).join('').trim();
    if (!ohneMarken) return 'Das PDF hat keine Textebene (Scan) — als Text nicht lesbar.';
    const hinweis = r.pageCount < r.seitenGesamt ? `\n… (${r.pageCount} von ${r.seitenGesamt} Seiten gelesen)` : '';
    return (text.length > MAX ? `${text.slice(0, MAX)}\n… (gekürzt)` : text) + hinweis;
  }
  if (d.mime.startsWith('text/') || d.mime.includes('json') || d.mime.includes('csv')) return new TextDecoder().decode(d.bytes).slice(0, MAX);
  return `Datei vom Typ ${d.mime} — als Text nicht lesbar.`;
}
