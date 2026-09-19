import { describe, expect, it } from 'vitest';
import { duckduckgoAuswerten, gespraechsoeffner, kiAttrappe, type KiClient, kontaktAnlaesse, newsAuswerten, osintSuche } from '../src/index.ts';

describe('Anreicherung (enrich/osint, enrich/news, fetchAiHooks, vtGenerateCallOpener, mkRunOSINT)', () => {
  it('wertet DuckDuckGo-HTML und Google-News-RSS aus', () => {
    const html = '<a class="result__a" href="//duckduckgo.com/l/?x=1&uddg=https%3A%2F%2Fwww.xing.com%2Fprofile%2FA">Anna <b>Alt</b></a><a class="result__a" href="https://b.test">  </a><a class="result__a" href="https://c.test">C</a>';
    expect(duckduckgoAuswerten(html)).toEqual([{ titel: 'Anna Alt', url: 'https://www.xing.com/profile/A', snippet: '' }, { titel: 'C', url: 'https://c.test', snippet: '' }]);
    const xml = '<item><title><![CDATA[Alt &amp; Neu expandiert]]></title><link>https://n.test</link><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<b>Text</b> hier]]></description></item>';
    expect(newsAuswerten(xml)).toEqual([{ titel: 'Alt & Neu expandiert', quelle: 'https://n.test', datum: '15.9.2026', snippet: 'Text hier' }]);
  });

  it('Anlässe nur mit Suchtreffern; Prompt mit Geburtstag; Gesprächsöffner-Kontext', async () => {
    const gesendet: { messages: { content: string }[] }[] = [];
    const ki: KiClient = { ...kiAttrappe(), async nachricht(b: any) { gesendet.push(b); return { content: [{ type: 'text', text: 'Hier: [{"emoji":"📰","text":"Firma eröffnet Büro","priority":"mittel"},{"text":"ohne emoji"}]' }] }; } };
    expect(await kontaktAnlaesse(ki, 'Anna', 'Alt GmbH', '09-18', new Date(2026, 8, 17), async () => [], async () => [])).toBeNull();
    const a = await kontaktAnlaesse(ki, 'Anna', 'Alt GmbH', '09-18', new Date(2026, 8, 17), async () => [{ titel: 'T', url: 'https://t', snippet: '' }], async () => []);
    expect(a!.wert).toEqual([{ emoji: '📰', text: 'Firma eröffnet Büro', priority: 'mittel' }]);
    expect(gesendet[0]!.messages[0]!.content).toContain('⚠️ GEBURTSTAG: morgen!');
    await gespraechsoeffner(ki, { name: 'Anna', firma: 'Alt GmbH', relationshipNote: 'per Sie' }, { geburtstagLabel: '🎂 Morgen Geburtstag!', anlaesse: a!.wert, erwaehnungen: [{ thema: 'Urlaub', detail: 'Mallorca' }], letzteKommunikation: 'Rückruf' });
    expect(gesendet[1]!.messages[0]!.content).toBe('Schreibe einen natürlichen Gesprächseinstieg (1-2 Sätze) für einen Anruf beim Immobilienmakler Anna von Alt GmbH.\nKontext:\n⚠️ WICHTIG: 🎂 Morgen Geburtstag! — Glückwunsch einbauen!\nAktuelle Kontakt-Anlässe:\n- 📰 Firma eröffnet Büro\nPersönliche Erwähnungen: Urlaub: Mallorca\nBeziehung: per Sie\nLetzte Komm: Rückruf\nKurz, persönlich, keine Floskeln. Nutze Geburtstag oder aktuelle Anlässe wenn vorhanden — dezent und natürlich.');
  });

  it('OSINT: XING/LinkedIn, Handelsregister, Rechtsform', async () => {
    const info = await osintSuche('Anna Alt', 'Alt Immobilien GmbH & Co. KG', '2026-09-17T10:00:00Z', async (q) => q.includes('Handelsregister')
      ? [{ titel: 'Alt Immobilien – Amtsgericht Stuttgart HRA 12345', url: 'https://hr.test', snippet: '' }]
      : [{ titel: 'Profil', url: 'https://www.linkedin.com/in/anna', snippet: '' }]);
    expect(info).toEqual({
      ts: '2026-09-17T10:00:00Z', allgemein: [{ titel: 'Profil', url: 'https://www.linkedin.com/in/anna', snippet: '' }], xingUrl: undefined, linkedinUrl: 'https://www.linkedin.com/in/anna',
      handelsregister: { hrNummer: 'HRA 12345', amtsgericht: 'Stuttgart', rechtsform: 'GmbH & Co. KG', quelleUrl: 'https://hr.test' },
    });
  });
});
