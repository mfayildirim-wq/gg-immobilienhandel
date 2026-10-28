import { describe, expect, it } from 'vitest';
import {
  htmlZuText, immoscoutLesen, kiAttrappe, nameGenannt, rechercheAuswerten, rechercheTestAbruf, rechercheWebsuche, robotsErlaubt, seiteHolen,
  unterseitenAus, webseiteLesen,
} from '../src/index.ts';

const abruf = rechercheTestAbruf();
const START = 'https://beispiel-immobilien.example.test/';

describe('Makler-Recherche: Seiten lesen (21.10.2026)', () => {
  it('Startseite, Impressum zuerst, Team; robots.txt sperrt /kontakt-intern', async () => {
    const w = await webseiteLesen(START, abruf, 0);
    expect(w.erreichbar).toBe(true);
    expect(w.seiten.map((s) => new URL(s.url).pathname)).toEqual(['/', '/impressum', '/team']);
    expect(w.gesperrtDurchRobots).toBe(1);
    expect(w.seiten[2]!.text).toContain('Anna Beispiel');
  });

  it('Startseite 404: andere Einstiege (www, /impressum, /kontakt)', async () => {
    const w = await webseiteLesen('https://nur-impressum.example.test/', abruf, 0);
    expect(w).toMatchObject({ erreichbar: true, startUrl: 'https://nur-impressum.example.test/impressum' });
    expect(w.seiten[0]!.text).toContain('Nur Impressum GmbH');
  });

  it('nicht erreichbar: keine Seiten', async () => {
    expect(await webseiteLesen('https://gibt-es-nicht.example.test/', abruf, 0)).toMatchObject({ erreichbar: false, seiten: [] });
  });

  it('interne Adressen werden nie geöffnet, auch nicht über eine Weiterleitung', async () => {
    const umleitung = (async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })) as typeof fetch;
    expect(await seiteHolen('http://localhost/x', abruf)).toBeNull();
    expect(await seiteHolen('https://umleitung.example.test/', umleitung)).toBeNull();
  });

  it('ImmoScout: nur ein echtes Profil zählt', async () => {
    expect((await immoscoutLesen('https://www.immobilienscout24.de/anbieter/profil/musterhaus-immobilien-gmbh', abruf))?.titel).toContain('ImmoScout24');
    expect(await immoscoutLesen('https://www.immobilienscout24.de/anbieter/profil/gibt-es-nicht', abruf)).toBeNull();
  });

  it('robots.txt, Unterseiten, Text und Name', () => {
    expect(robotsErlaubt('User-agent: *\nDisallow: /intern\nAllow: /intern/team', '/intern/team')).toBe(true);
    expect(robotsErlaubt('User-agent: *\nDisallow: /intern', '/intern/x')).toBe(false);
    expect(robotsErlaubt('User-agent: Googlebot\nDisallow: /', '/team')).toBe(true);
    expect(robotsErlaubt('', '/team')).toBe(true);
    expect(unterseitenAus('<a href="/team">Team</a><a href="https://fremd.de/impressum">Impressum</a><a href="/impressum#x">Impressum</a><a href="/agb.pdf">Impressum</a>', 'https://x.de/'))
      .toEqual(['https://x.de/impressum', 'https://x.de/team']);
    expect(htmlZuText('<p>Anna&nbsp;Beispiel</p><script>x()</script><p>Mobil: 0171</p>')).toBe('Anna Beispiel\nMobil: 0171');
    expect(nameGenannt('Ansprechpartner: anna beispiel', 'Anna Beispiel')).toBe(true);
    expect(nameGenannt('Anna Muster', 'Anna Beispiel')).toBe(false);
  });
});

describe('Makler-Recherche: KI (Attrappe)', () => {
  it('Auswertung: Person auf der Team-Seite, Firma aus dem Impressum, jede Angabe mit Quelle', async () => {
    const { seiten } = await webseiteLesen(START, abruf, 0);
    const a = (await rechercheAuswerten(kiAttrappe(), { name: 'Anna Beispiel', firma: null, email: null, ort: null }, seiten))!;
    expect(a.wert.personGenannt).toBe(true);
    expect(a.wert.personSeite).toBe(`${START}team`);
    expect(a.wert.funde).toEqual(expect.arrayContaining([
      { ziel: 'makler', feld: 'position', wert: 'Geschäftsführerin', quelle: `${START}team` },
      { ziel: 'makler', feld: 'mobil', wert: '0171 5550001', quelle: `${START}team` },
      { ziel: 'unternehmen', feld: 'fax', wert: '0711 5550099', quelle: `${START}impressum` },
      { ziel: 'unternehmen', feld: 'ort', wert: 'Stuttgart', quelle: `${START}impressum` },
      { ziel: 'makler', feld: 'firma', wert: 'Musterhaus Immobilien GmbH', quelle: `${START}impressum` },
    ]));
    expect(await rechercheAuswerten(kiAttrappe(), { name: 'X', firma: null, email: null, ort: null }, [])).toBeNull();
  });

  it('Websuche: Adressen aus der JSON-Antwort, gezählte Suchen', async () => {
    expect((await rechercheWebsuche(kiAttrappe(), { name: 'Anna Beispiel', firma: null, email: null, ort: null })).wert).toEqual({ webseite: START, immoscout: null, suchen: 1 });
    expect((await rechercheWebsuche(kiAttrappe(), { name: 'Max Muster', firma: null, email: null, ort: null })).wert).toEqual({ webseite: null, immoscout: null, suchen: 1 });
  });
});
