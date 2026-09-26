import { OBERFLAECHENKARTE } from '@gg/api-contract';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Oberflächenkarte ist das Wissen des Agenten über die Bedienung. Weicht sie von den Marken im Quelltext ab,
 * greift der Agent ins Leere (Ziel fehlt) oder kennt eine Möglichkeit nicht. Dieser Test hält beides zusammen.
 */
function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx') ? [pfad] : [];
  });
}

const quelltext = dateien(join(dirname(fileURLToPath(import.meta.url)), '..')).map((p) => readFileSync(p, 'utf8')).join('\n');

/** Marken im Quelltext: `data-agent="ziel"` und `data-agent-auch={... 'ziel' ...}`, dazu Props wie agentZiel="ziel" */
const markiert = new Set([
  ...[...quelltext.matchAll(/data-agent="([a-z0-9.\-_]+)"/g)].map((m) => m[1]!),
  ...[...quelltext.matchAll(/agentZiel="([a-z0-9.\-_]+)"/g)].map((m) => m[1]!),
  ...[...quelltext.matchAll(/'((?:nav|ankauf|deal|deals|makler|objekt)\.[a-z0-9.\-_]+)'/g)].map((m) => m[1]!),
]);

describe('Oberflächenkarte des AgentMode', () => {
  it('kennt nur Ziele, die im Quelltext markiert sind', () => {
    const fehlend = OBERFLAECHENKARTE.filter((z) => !markiert.has(z.ziel)).map((z) => z.ziel);
    expect(fehlend, 'Ziele ohne data-agent-Marke in der Oberfläche').toEqual([]);
  });

  it('beschreibt jedes markierte Ziel', () => {
    const bekannt = new Set(OBERFLAECHENKARTE.map((z) => z.ziel));
    const marken = [...quelltext.matchAll(/data-agent="([a-z0-9.\-_]+)"/g)].map((m) => m[1]!);
    const unbekannt = [...new Set(marken)].filter((z) => !bekannt.has(z));
    expect(unbekannt, 'Marken ohne Eintrag in der Oberflächenkarte').toEqual([]);
  });

  it('hat eindeutige Ziele und für jedes nav.* eine Seite', () => {
    const ziele = OBERFLAECHENKARTE.map((z) => z.ziel);
    expect(new Set(ziele).size).toBe(ziele.length);
    for (const z of OBERFLAECHENKARTE.filter((z) => z.ziel.startsWith('nav.'))) expect(z.seite, z.ziel).toBeTruthy();
  });

  it('kennzeichnet schreibende Ziele im Quelltext mit data-agent-schreibt — und nur diese', () => {
    const imQuelltext = new Set([...quelltext.matchAll(/data-agent="([a-z0-9.\-_]+)" data-agent-schreibt/g)].map((m) => m[1]!));
    const inDerKarte = new Set(OBERFLAECHENKARTE.filter((z) => z.schreibt).map((z) => z.ziel));
    expect([...imQuelltext].sort()).toEqual([...inDerKarte].sort());
    expect(inDerKarte.has('deal.erledigt')).toBe(true);
  });
});
