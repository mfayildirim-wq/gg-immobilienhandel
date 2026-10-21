/**
 * Ersatz-Internet für die Makler-Recherche im Test-Modus (KI_ATTRAPPE=1) und in Tests: beantwortet Abrufe auf
 * `*.example.test` und ein ImmoScout-Profil mit festen Seiten, alles andere mit 404. Die KI-Attrappe liest daraus die
 * „Feld: Wert“-Zeilen. Kein Abruf verlässt den Rechner.
 *
 *   https://beispiel-immobilien.example.test/          Start mit Links auf Impressum und Team
 *   …/impressum                                         Firma, Anschrift, Zentrale, Fax
 *   …/team                                              Anna Beispiel mit Position und Mobil
 *   https://www.immobilienscout24.de/anbieter/profil/musterhaus-immobilien-gmbh   Profil
 *   https://nur-impressum.example.test/impressum        Startseite 404, nur das Impressum
 */
const html = (titel: string, rumpf: string) => `<!doctype html><html><head><title>${titel}</title></head><body>${rumpf}</body></html>`;

const SEITEN: Record<string, string> = {
  'https://beispiel-immobilien.example.test/': html('Musterhaus Immobilien GmbH',
    '<h1>Willkommen</h1><nav><a href="/impressum">Impressum</a> <a href="/team">Unser Team</a> <a href="/kontakt-intern">Kontakt intern</a></nav>'),
  'https://beispiel-immobilien.example.test/impressum': html('Impressum – Musterhaus Immobilien GmbH',
    '<p>Firma: Musterhaus Immobilien GmbH</p><p>Anschrift: Königstraße 1, 70173 Stuttgart</p><p>Telefon Zentrale: 0711 5550000</p><p>Fax: 0711 5550099</p><p>E-Mail Zentrale: info@beispiel-immobilien.example.test</p>'),
  'https://beispiel-immobilien.example.test/team': html('Team – Musterhaus Immobilien GmbH',
    '<h2>Anna Beispiel</h2><p>Position: Geschäftsführerin</p><p>Mobil: 0171 5550001</p>'),
  // Startseite 404 (wie manche Seiten ohne Browser), Impressum erreichbar
  'https://nur-impressum.example.test/impressum': html('Impressum', '<p>Firma: Nur Impressum GmbH</p><p>Fax: 0711 4440099</p>'),
  'https://beispiel-immobilien.example.test/robots.txt': 'User-agent: *\nDisallow: /kontakt-intern\n',
  'https://www.immobilienscout24.de/anbieter/profil/musterhaus-immobilien-gmbh': html('Musterhaus Immobilien GmbH - Immobilienmakler bei ImmoScout24',
    '<h1>Musterhaus Immobilien GmbH</h1><p>Anschrift: Königstraße 1, 70173 Stuttgart</p><p>Ansprechpartner: Anna Beispiel</p>'),
};

export function rechercheTestAbruf(): typeof fetch {
  return (async (eingabe: string | URL | Request) => {
    const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
    const seite = SEITEN[url] ?? SEITEN[url.replace(/\/$/, '')] ?? SEITEN[`${url}/`];
    if (seite === undefined) return new Response('nicht gefunden', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(seite, { status: 200, headers: { 'content-type': url.endsWith('robots.txt') ? 'text/plain' : 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}
