import { beforeEach, describe, expect, it } from 'vitest';
import { gehalteneKarten } from './gehalteneKarten.ts';

type Karte = { id: string; termin: string; version: number; nextContact: string | null };
const karte = (id: string, version = 1): Karte => ({ id, termin: '2026-10-01', version, nextContact: '2026-10-01' });
const gehalten = () => gehalteneKarten.karten<Karte>('deals', []);

describe('gehalteneKarten: Karten bleiben stehen, egal wo der Termin gesetzt wurde (Karte oder Deal-Detail)', () => {
  beforeEach(() => gehalteneKarten.leeren());

  it('halten schon beim Klick: die Karte steht sofort mit neuem Termin da, Platz von vorher; die Antwort zieht die Version nach', () => {
    gehalteneKarten.angezeigt('deals', [karte('a')]);
    gehalteneKarten.vormerken('deals', 'a', '2026-11-01');
    expect(gehalten()).toEqual({ a: { ...karte('a'), nextContact: '2026-11-01' } }); // sofort gehalten
    gehalteneKarten.angezeigt('deals', [{ ...karte('a', 2), termin: '2026-11-01' }]); // Liste lädt neu
    gehalteneKarten.bestaetigen('deals', 'a', { version: 2, nextContact: '2026-11-01' });
    expect(gehalten()).toEqual({ a: { ...karte('a'), version: 2, nextContact: '2026-11-01' } }); // Termin/Platz von vorher
  });

  it('Fehler beim Speichern: zurück auf den Stand vor dem Klick', () => {
    gehalteneKarten.angezeigt('deals', [karte('a')]);
    const vorher = gehalteneKarten.vormerken('deals', 'a', '2026-11-01');
    gehalteneKarten.zurueck('deals', 'a', vorher);
    expect(gehalten()).toEqual({});
    // war sie schon gehalten, bleibt der alte Termin
    gehalteneKarten.vormerken('deals', 'a', '2026-11-01');
    gehalteneKarten.bestaetigen('deals', 'a', { version: 2, nextContact: '2026-11-01' });
    const zweiter = gehalteneKarten.vormerken('deals', 'a', '2027-01-01');
    gehalteneKarten.zurueck('deals', 'a', zweiter);
    expect(gehalten().a?.nextContact).toBe('2026-11-01');
  });

  it('eine Karte, die nie angezeigt wurde (Deal nicht im Cockpit), wird nicht gehalten', () => {
    gehalteneKarten.vormerken('deals', 'x', '2026-11-01');
    gehalteneKarten.bestaetigen('deals', 'x', { version: 2, nextContact: '2026-11-01' });
    expect(gehalten()).toEqual({});
  });

  it('jede spätere Änderung an Deal oder Makler zieht die Version nach (sonst Versionskonflikt bei „Erledigt“)', () => {
    gehalteneKarten.angezeigt('deals', [karte('a')]);
    gehalteneKarten.vormerken('deals', 'a', '2026-11-01');
    gehalteneKarten.bestaetigen('deals', 'a', { version: 2, nextContact: '2026-11-01' });
    gehalteneKarten.version('deals', 'a', 5);
    gehalteneKarten.version('deals', 'b', 9); // nicht gehalten: nichts
    expect(gehalten().a?.version).toBe(5);
    expect(gehalten().b).toBeUndefined();
  });

  it('die Serverliste hat Vorrang bei der Version, falls sie neuer ist', () => {
    gehalteneKarten.angezeigt('deals', [karte('a')]);
    gehalteneKarten.vormerken('deals', 'a', '2026-11-01');
    gehalteneKarten.bestaetigen('deals', 'a', { version: 2, nextContact: '2026-11-01' });
    expect(gehalteneKarten.karten<Karte>('deals', [karte('a', 7)]).a?.version).toBe(7);
  });

  it('loslassen und leeren', () => {
    gehalteneKarten.angezeigt('makler', [karte('m')]);
    gehalteneKarten.vormerken('makler', 'm', '2026-11-01');
    gehalteneKarten.bestaetigen('makler', 'm', { version: 2, nextContact: '2026-11-01' });
    gehalteneKarten.loslassen('makler', 'm');
    expect(gehalteneKarten.karten<Karte>('makler', [])).toEqual({});
  });
});
