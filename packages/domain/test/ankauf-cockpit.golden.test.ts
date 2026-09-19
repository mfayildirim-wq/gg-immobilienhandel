import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { faelligkeit, geburtstagHinweis, terminAusFrequenz } from '../src/index.ts';

/** Golden Master: Datumslogik des Ankauf-Cockpits, Originalcode in Zeitzone Europe/Berlin an 10 Stichtagen. */
interface Tag {
  heute: string;
  faelligkeit: { termin: string; ergebnis: { cls: string; label: string; sort: number } | null }[];
  termin: { lastContact: string | null; frequenz: string; ergebnis: string | null }[];
  geburtstag: { geburtsdatum: string; ergebnis: { inXTagen: number; alter?: number; label: string; urgent: boolean } | null }[];
}
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/ankauf-cockpit.json'), 'utf8')) as { faelle: Tag[] };

/** Die alte App rechnete Tage über Ortszeit + toISOString: Ein Termin, der in die Sommerzeit hineinfällt, lag einen Tag zu früh. */
const kreuztSommerzeit = (von: string, bis: string) => {
  for (const j of [2025, 2026, 2027, 2028]) {
    const umstellung = new Date(Date.UTC(j, 2, 31 - ((new Date(Date.UTC(j, 2, 31)).getUTCDay() + 7) % 7))).toISOString().slice(0, 10);
    if (von <= umstellung && bis > umstellung) return true;
  }
  return false;
};

describe.each(faelle.map((t) => [t.heute, t] as const))('Cockpit-Datumslogik am %s = alte App', (heute, t) => {
  it('Fälligkeit (Heute/Überfällig/Diese Woche)', () => {
    for (const f of t.faelligkeit) {
      const neu = faelligkeit(f.termin, heute);
      expect(neu && { cls: neu.klasse, label: neu.label, sort: neu.sort }, f.termin).toEqual(f.ergebnis);
    }
  });

  it('Termin aus letztem Kontakt + Frequenz (bewusste Abweichung: kein Tag Versatz an der Sommerzeit-Umstellung)', () => {
    for (const f of t.termin) {
      const neu = terminAusFrequenz(f.lastContact, f.frequenz);
      if (f.ergebnis && neu && f.lastContact && kreuztSommerzeit(f.lastContact, neu) && neu !== f.ergebnis) {
        const [j, m, d] = neu.split('-').map(Number);
        expect(f.ergebnis, 'alt einen Tag früher').toBe(new Date(Date.UTC(j!, m! - 1, d! - 1)).toISOString().slice(0, 10));
        continue;
      }
      expect(neu, `${f.lastContact} ${f.frequenz}`).toBe(f.ergebnis);
    }
  });

  it('Geburtstags-Hinweis', () => {
    for (const g of t.geburtstag) {
      const neu = geburtstagHinweis(g.geburtsdatum, heute);
      const alt = g.ergebnis && { inTagen: g.ergebnis.inXTagen, label: g.ergebnis.label, dringend: g.ergebnis.urgent, ...(g.ergebnis.alter ? { alter: g.ergebnis.alter } : {}) };
      expect(neu && JSON.parse(JSON.stringify(neu)), g.geburtsdatum).toEqual(alt);
    }
  });
});
