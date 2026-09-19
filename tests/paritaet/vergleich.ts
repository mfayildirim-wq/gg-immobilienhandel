import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BERICHTE } from './umgebung.ts';

export interface Abweichung { bereich: string; objekt: string; merkmal: string; alt: string; neu: string }

/** Zahl aus einer Anzeige („1.234 €“, „– 5.000 €“, „12,5%“, „13.5x“). Leer, „–“ → 0. */
export function zahl(text: string | null | undefined): number {
  const t = String(text ?? '').replace(/−/g, '-').trim();
  if (!t || t === '–' || t === '-') return 0;
  const negativ = /^[–-]\s*\d/.test(t) || /^-/.test(t);
  const roh = (t.match(/[\d.,]+/)?.[0] ?? '0');
  // deutsches Format: Punkt = Tausender, Komma = Dezimal; alte Prozentwerte nutzen den Punkt als Dezimaltrenner
  const dezimalPunkt = /^\d+\.\d{1,2}$/.test(roh) && !roh.includes(',');
  const n = dezimalPunkt ? Number(roh) : Number(roh.replace(/\./g, '').replace(',', '.'));
  return negativ ? -n : n;
}

/** Text vergleichbar machen: Leerraum zusammenfassen. */
export const text = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function protokoll(bereich: string) {
  const abweichungen: Abweichung[] = [];
  let geprueft = 0;
  return {
    zahl(objekt: string, merkmal: string, alt: string, neu: string, toleranz = 1) {
      geprueft++;
      if (Math.abs(zahl(alt) - zahl(neu)) > toleranz) abweichungen.push({ bereich, objekt, merkmal, alt, neu });
    },
    text(objekt: string, merkmal: string, alt: string, neu: string) {
      geprueft++;
      if (text(alt) !== text(neu)) abweichungen.push({ bereich, objekt, merkmal, alt: text(alt), neu: text(neu) });
    },
    abschluss() {
      mkdirSync(BERICHTE, { recursive: true });
      appendFileSync(join(BERICHTE, 'ergebnis.jsonl'), `${JSON.stringify({ bereich, geprueft, abweichungen })}\n`);
      return { geprueft, abweichungen };
    },
  };
}
