import { describe, expect, it } from 'vitest';
import {
  collectOutgoingComm, eingehendUnbekannt, erwaehnungenAnhaengen, maklerZuTelefon, geburtstagsHinweisEntwurf, kommZeitstempel, letzterKontaktNachEintrag, mailEntwurf, maklerDeals, maklerSchnellsuche,
  personaDetectAnrede, personaGetConfidence, persoenlichesZusammenfuehren, sortierschluessel,
} from '../src/index.ts';

describe('Makler-Kommunikation (makler.ts, persona.ts)', () => {
  it('Zeitstempel wie die alte Sammlung', () => {
    expect(kommZeitstempel('2026-09-16T08:15:00.000Z')).toBe('16.9.2026 10:15');
    expect(kommZeitstempel(null)).toBe('Altbestand');
  });

  it('letzter Kontakt rückt nur vor', () => {
    expect(letzterKontaktNachEintrag(null, null, '2026-09-17')).toBe('2026-09-17');
    expect(letzterKontaktNachEintrag('2026-09-10', '2026-03-01', '2026-09-17')).toBeNull(); // alte Mail
    expect(letzterKontaktNachEintrag('2026-09-10', '2026-09-12', '2026-09-17')).toBe('2026-09-12');
    expect(letzterKontaktNachEintrag('2026-09-17', 'kaputt', '2026-09-17')).toBeNull();
  });

  it('Du/Sie aus ausgehenden Nachrichten', () => {
    expect(personaDetectAnrede([{ richtung: 'ausgehend', text: 'Hast du das Exposé?' }, { richtung: 'eingehend', text: 'Haben Sie Zeit?' }])).toBe('du');
    expect(personaDetectAnrede([{ richtung: 'ausgehend', text: 'Können Sie mir Ihre Unterlagen senden?' }])).toBe('sie');
    expect(personaDetectAnrede([{ richtung: 'ausgehend', text: 'Danke' }])).toBe('unbekannt');
  });

  it('Konfidenz und Sammeln der neuesten ausgehenden Nachrichten', () => {
    const makler = [{ name: 'A', komm: [{ richtung: 'ausgehend', kanal: 'whatsapp', ts: '1.2.2026 10:00', text: ' alt ' }, { richtung: 'ausgehend', kanal: 'email', ts: '16.9.2026 09:00', text: 'neu' }, { richtung: 'eingehend', kanal: 'anruf', text: 'x' }] }];
    expect(personaGetConfidence(makler)).toBe(2 * 4 + 15 + 15);
    const { entries, total } = collectOutgoingComm(makler);
    expect(total).toBe(2);
    expect(entries.map((e) => e.text)).toEqual(['neu', 'alt']);
    expect(sortierschluessel('Altbestand')).toBe(0);
  });

  it('Persönliches: gefüllte manuelle Werte gewinnen, Erwähnungen vorn, max. 20', () => {
    expect(persoenlichesZusammenfuehren({ geburtsdatum: '', anredeForm: 'du', letzteErwaehnung: [{ ts: '1.1.2026', thema: 'A', detail: 'a' }] }, { geburtsdatum: '03-15', anredeForm: 'sie', hobbies: ['Golf'], letzteErwaehnung: [{ ts: '2.1.2026', thema: 'B', detail: 'b' }] } as never))
      .toEqual({ geburtsdatum: '03-15', anredeForm: 'du', hobbies: ['Golf'], letzteErwaehnung: [{ ts: '2.1.2026', thema: 'B', detail: 'b' }, { ts: '1.1.2026', thema: 'A', detail: 'a' }] });
    const viele = Array.from({ length: 20 }, (_, i) => ({ ts: 'x', thema: `t${i}`, detail: 'd' }));
    const neu = erwaehnungenAnhaengen({ letzteErwaehnung: viele }, [{ thema: 'Urlaub', detail: 'Mallorca' }, { thema: '', detail: 'leer' }], '17.9.2026');
    expect(neu.letzteErwaehnung).toHaveLength(20);
    expect(neu.letzteErwaehnung![0]).toEqual({ ts: '17.9.2026', thema: 'Urlaub', detail: 'Mallorca' });
  });

  it('Geburtstagshinweis im Entwurf', () => {
    const heute = new Date(2026, 8, 17);
    expect(geburtstagsHinweisEntwurf('09-17', heute)).toContain('HEUTE');
    expect(geburtstagsHinweisEntwurf('1980-09-18', heute)).toBe('⚠️ Morgen ist sein/ihr Geburtstag (46. Geburtstag) — Glückwunsch proaktiv einbauen!');
    expect(geburtstagsHinweisEntwurf('09-30', heute)).toBe('');
    expect(geburtstagsHinweisEntwurf('kaputt', heute)).toBe('');
  });

  it('E-Mail vorbereiten, Deals-Reiter, Schnellsuche', () => {
    expect(mailEntwurf('a@b.de', '', 'x')).toEqual({ fehler: 'Bitte alle Felder ausfüllen' });
    const lang = mailEntwurf('a@b.de', 'Betreff', 'x'.repeat(1900));
    expect('url' in lang && lang.gekuerzt).toBe(true);
    const d = maklerDeals([{ id: 'd1', maklerId: 'm', status: 'Archiv', adresse: 'A', stadt: 'U' }, { id: 'd2', maklerId: 'm', status: 'Angebot abgegeben', kalk: { kaufpreis: 1e6 }, angebotsDatum: '2026-01-02', nachfassFreq: 'Monatlich' }, { id: 'd3', maklerId: 'x', status: 'In Prüfung' }], 'm');
    expect(d.kennzahlen).toEqual({ gesamt: 2, aktiv: 1, angebote: 1 });
    expect(d.aktiv[0]).toEqual({ id: 'd2', status: 'Angebot abgegeben', titel: '–, –', unter: '2026-01-02 · Monatlich', kaufpreis: '1.000.000 €' });
    const mk = [{ name: 'Anna Alt', tel: '+49 711 123456' }, { name: 'Bert', firma: 'Anbau GmbH', email: 'b@x.de' }];
    expect(maklerSchnellsuche(mk, 'a')).toBeNull();
    expect(maklerSchnellsuche(mk, '711 12')?.map((m) => m.name)).toEqual(['Anna Alt']);
    expect(maklerSchnellsuche(mk, 'an')?.map((m) => m.name)).toEqual(['Anna Alt', 'Bert']);
  });
});

describe('Eingehender Anruf: Makler zur Nummer', () => {
  const makler = [
    { id: 'm1', tel: '+49 711 1234567' },
    { id: 'm2', tel: '0170 9988776' },
    { id: 'm3', tel: null },
  ];
  it('findet über direkte Teilübereinstimmung', () => {
    expect(maklerZuTelefon(makler, '7111234567')?.id).toBe('m1');
    expect(maklerZuTelefon(makler, '+49 170 9988776')?.id).toBe('m2');
  });
  it('findet über die letzten neun Ziffern (0049/+49/0)', () => {
    expect(maklerZuTelefon(makler, '0049711 1234567')?.id).toBe('m1');
    expect(maklerZuTelefon(makler, '01709988776')?.id).toBe('m2');
  });
  it('sucht nicht unter vier Ziffern und meldet Unbekannte', () => {
    expect(maklerZuTelefon(makler, '123')).toBeNull();
    expect(maklerZuTelefon(makler, '+49 30 000000')).toBeNull();
    expect(eingehendUnbekannt('+49 30 000000')).toBe('📞 Eingehend: +49 30 000000 (kein Makler hinterlegt)');
  });
});
