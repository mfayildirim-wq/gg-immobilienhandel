/**
 * Ist die hochgeladene Datei ein Exposé? Eine Investment-Rechnung oder Mieterliste (oft eine Tabelle aus Google Sheets
 * oder Excel, eine Seite, kein Kontaktblock) hat keine Fotos und keinen Makler — der Import legt dann ein Objekt ohne
 * beides an. Die Prüfung sagt das vorher und rät, das Exposé des Maklers dazu hochzuladen (es kann den Deal ergänzen).
 *
 * Bewusst vorsichtig: nur ein Hinweis, nie ein Abbruch — auch eine Tabelle kann gute Zahlen liefern.
 */

export interface DokumentMerkmale {
  dateiname: string;
  seiten: number;
  /** Fotos, die der Import herausgelöst hat (nach dem Größenfilter) */
  bilder: number;
  /** Erzeuger aus den PDF-Metadaten (Creator/Producer), z. B. „Google Sheets“ */
  erzeuger?: string | null;
  /** Hat die Analyse einen Makler oder Ansprechpartner gefunden (Name, Firma, Telefon oder E-Mail)? */
  maklerGefunden: boolean;
}

export interface DokumentArt {
  /** exposé: alles gut · tabelle: Tabellenprogramm · knapp: kurz, ohne Fotos/Makler */
  art: 'expose' | 'tabelle' | 'knapp';
  /** Der Hinweis für die Prüfseite (fehlt bei `expose`) */
  hinweis?: string;
}

const TABELLE = /google sheets|microsoft excel|\bexcel\b|libreoffice calc|openoffice calc|\bnumbers\b|\bcalc\b/i;

export function dokumentArtPruefen(m: DokumentMerkmale): DokumentArt {
  const ausTabelle = !!m.erzeuger && TABELLE.test(m.erzeuger);
  const knapp = m.seiten <= 2 && m.bilder <= 2 && !m.maklerGefunden;
  if (!ausTabelle && !knapp) return { art: 'expose' };
  const merkmale = [
    `${m.seiten} Seite${m.seiten === 1 ? '' : 'n'}`,
    ausTabelle ? `aus ${m.erzeuger!.replace(/\s*\(.*$/, '').trim()}` : null,
    m.maklerGefunden ? null : 'keine Maklerangaben',
    m.bilder ? `${m.bilder} Bild${m.bilder === 1 ? '' : 'er'}` : 'keine Fotos',
  ].filter(Boolean).join(', ');
  return {
    art: ausTabelle ? 'tabelle' : 'knapp',
    hinweis: `„${m.dateiname}“ sieht nicht nach einem Exposé aus (${merkmale}). Fotos und Makler fehlen deshalb meist. Lade das Exposé des Maklers dazu hoch — es kann den Deal zu diesem Objekt ergänzen.`,
  };
}
