import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import { BERICHTE } from './umgebung.ts';
import type { Abweichung } from './vergleich.ts';

/** Schreibt berichte/paritaet/bericht.md aus den Einzelergebnissen der Prüfbereiche. */
export default class ParitaetsBericht implements Reporter {
  onBegin() { rmSync(join(BERICHTE, 'ergebnis.jsonl'), { force: true }); }
  onEnd() {
    const datei = join(BERICHTE, 'ergebnis.jsonl');
    const bereiche = existsSync(datei)
      ? readFileSync(datei, 'utf8').trim().split('\n').filter(Boolean).map((z) => JSON.parse(z) as { bereich: string; geprueft: number; abweichungen: Abweichung[] })
      : [];
    const zeilen = [
      `# Parallelprüfung alt ↔ neu · ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`, '',
      '| Bereich | geprüfte Merkmale | Abweichungen |', '|---|---|---|',
      ...bereiche.map((b) => `| ${b.bereich} | ${b.geprueft} | ${b.abweichungen.length ? `**${b.abweichungen.length}**` : '0 ✓'} |`), '',
      ...bereiche.flatMap((b) => (b.abweichungen.length ? [`## ${b.bereich}`, '', '| Objekt | Merkmal | alt | neu |', '|---|---|---|---|',
        ...b.abweichungen.slice(0, 200).map((x) => `| ${x.objekt} | ${x.merkmal} | ${x.alt.slice(0, 300).replace(/\|/g, '\\|')} | ${x.neu.slice(0, 300).replace(/\|/g, '\\|')} |`), ''] : [])),
    ];
    writeFileSync(join(BERICHTE, 'bericht.md'), zeilen.join('\n'));
    console.log(`\nParitätsbericht: berichte/paritaet/bericht.md`);
  }
}
