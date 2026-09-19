/**
 * Mail-Auswertung für den Posteingang (Microsoft 365). Reine Regeln, wörtlich aus
 * gg-immohandel server/graph.ts: Links aus dem Mailtext (gefiltert und nach Exposé-Wahrscheinlichkeit
 * sortiert), Klartext aus dem Body und die Einordnung von Anhängen.
 */

const URL_RE = /https?:\/\/[^\s"'<>)\]]{8,}/g;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

export type AttachmentKind = 'pdf' | 'spreadsheet' | 'document' | 'image' | 'other';

export interface MailBody { contentType: string; content: string }
export interface MailAnhang { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean; '@odata.type'?: string }
export interface OfferAttachment { partId: string; filename: string; sizeMB: number; mime: string; kind: AttachmentKind; processable: boolean }

export function mailLinks(body: MailBody | null | undefined): string[] {
  if (!body) return [];
  const raw = body.content || '';
  const found = new Set<string>();

  // 1. href-Attribute (HTML-Mails)
  for (const m of raw.matchAll(HREF_RE)) {
    const url = (m[1] ?? '').trim();
    if (/^https?:\/\//i.test(url)) found.add(url);
  }
  // 2. Plain-URLs überall im Body (auch bei text/plain Mails)
  for (const m of raw.matchAll(URL_RE)) {
    found.add(m[0]);
  }

  // Filter: Tracking/Analytics/Bilder/Stylesheets/Social-Media raus
  const skip = new RegExp([
    // Tracking/Analytics
    'googleadservices', 'google-analytics', 'doubleclick', 'list-manage', 'sendgrid', 'mailchimp', 'cdn-cgi',
    // Social Media (nie Exposé)
    'linkedin\\.com', 'xing\\.com', 'facebook\\.com', 'instagram\\.com', 'twitter\\.com', 'x\\.com\\/',
    'youtube\\.com', 'youtu\\.be',
    // Newsletter/Abmeldung
    'unsubscribe', '/newsletter', 'mailto:',
    // Datenschutz/Impressum (Makler-Standard-Pages)
    '/datenschutz', '/impressum', '/widerruf', '/agb', '/cookies', '/disclaimer',
    // Tel/Map
    'tel:', 'maps\\.google', 'goo\\.gl/maps',
    // App-Stores
    'apps\\.apple\\.com', 'play\\.google\\.com',
  ].join('|'), 'i');

  // Asset-Extensions (Bilder, CSS, JS, Fonts) — KEINE Exposé-Ziele
  const assetExt = /\.(jpe?g|png|gif|webp|svg|ico|css|js|woff2?|ttf|eot|map)(\?|$)/i;
  // image-Subdomains (z.B. image.onoffice.de — bekanntes False-Positive)
  const assetSub = /^https?:\/\/(image|images|img|cdn|static|assets|fonts|tracking|pixel|analytics)\./i;

  const filtered = [...found].filter(u => {
    if (skip.test(u)) return false;
    if (assetExt.test(u)) return false;
    if (assetSub.test(u)) return false;
    return true;
  });

  // Sortierung: Exposé-Patterns nach oben (bessere KI-Auswahl)
  const positive = /(expose|exposee|landingpage|webexposee|\/objekt|\/einheit|\/immobilie|\/property|onoffice\.de\/.*expose)/i;
  filtered.sort((a, b) => {
    const sa = positive.test(a) ? 0 : 1;
    const sb = positive.test(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    // Bei Gleichstand: längste URL zuerst (Token = Exposé-spezifisch)
    return b.length - a.length;
  });

  return filtered.slice(0, 20);
}


export function mailKlartext(body: MailBody | null | undefined): string {
  if (!body) return '';
  if (body.contentType === 'text' || body.contentType === 'Text') return body.content || '';
  // HTML → grobe Plaintext-Konvertierung (Stripping). Reicht für Vorschau & Link-Extraction.
  return (body.content || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}


export function anhangRelevant(a: MailAnhang): boolean {
  if (a.isInline) return false;
  const odataType = a['@odata.type'] || '';
  if (odataType && !odataType.includes('fileAttachment')) return false;
  return true;
}

const KIND_BY_EXTENSION: ReadonlyArray<[RegExp, AttachmentKind]> = [
  [/\.pdf$/i,                        'pdf'],
  [/\.(xlsx?|xlsm|csv|ods)$/i,       'spreadsheet'],
  [/\.(docx?|odt|rtf|txt)$/i,        'document'],
  [/\.(jpe?g|png|gif|webp|tiff?|bmp|heic)$/i, 'image'],
];

const KIND_BY_MIME: ReadonlyArray<[RegExp, AttachmentKind]> = [
  [/^application\/pdf$/i,                              'pdf'],
  [/spreadsheet|ms-excel|^text\/csv$/i,                'spreadsheet'],
  [/wordprocessing|msword|^text\/plain$/i,             'document'],
  [/^image\//i,                                        'image'],
];

export function anhangArt(filename: string, mime: string): AttachmentKind {
  for (const [re, kind] of KIND_BY_EXTENSION) {
    if (re.test(filename)) return kind;
  }
  for (const [re, kind] of KIND_BY_MIME) {
    if (re.test(mime)) return kind;
  }
  return 'other';
}


export function anhangEinordnen(a: MailAnhang): OfferAttachment {
  const filename = a.name || 'anhang';
  const mime = (a.contentType || '').toLowerCase();
  const kind = anhangArt(filename, mime);
  return {
    partId: a.id,
    filename,
    sizeMB: +(((a.size || 0) / 1_048_576)).toFixed(2),
    mime,
    kind,
    // Heute wertet die Engine nur PDFs aus. Tabellen und Textdokumente
    // werden bereits mitgeliefert und in Phase 4 erschlossen.
    processable: kind === 'pdf',
  };
}
