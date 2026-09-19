import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  eigenkapitalAnwenden,
  eigenkapitalSchnell,
  type KundenkalkStandard,
  kundenkalkFeldSetzen,
  kundenkalkulationVorbelegen,
  type KundenkalkulationDaten,
  parseNum,
  tranche1Schnell,
} from '../src/index.ts';

/** Golden Master: Vorbelegung aus dem Deal und Bearbeitungsschritte = Originalcode der alten App. */
interface Fall {
  name: string;
  eingabe: { deal: { einheiten: never[]; kalk: { kaufpreis?: unknown } }; obj: Record<string, unknown> | null; kkD: KundenkalkStandard; hinweise: string[]; scope: 'global' | 'aufteiler'; einheitId?: string };
  vorbelegt: Record<string, unknown>;
  schritte: { aktion: string; wert?: string; ergebnis: Record<string, unknown> }[];
}
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/kundenkalkulation-bearbeitung.json'), 'utf8')) as { faelle: Fall[] };

/** Nur fachliche Felder; IDs, Zeitstempel und in der alten App veraltete Felder bleiben außen vor. */
const fachlich = (k: Record<string, unknown>) => {
  const { id, dealId, createdAt, updatedAt, disclaimerOverride, stellplatzKaufpreis, impressionen, anhaengeNamen, einheitId, ...rest } = k;
  void id; void dealId; void createdAt; void updatedAt; void disclaimerOverride; void stellplatzKaufpreis; void impressionen; void anhaengeNamen;
  return JSON.parse(JSON.stringify({ ...rest, einheitId: einheitId ?? null }));
};

describe.each(faelle.map((f) => [f.name, f] as const))('Kundenkalkulation %s = alte App', (_n, f) => {
  const e = f.eingabe;
  const neu = kundenkalkulationVorbelegen({
    scope: e.scope, einheitId: e.einheitId, einheiten: e.deal.einheiten, dealKaufpreis: e.deal.kalk.kaufpreis,
    objekt: e.obj, standard: e.kkD, hinweise: e.hinweise, heute: '2026-09-17',
  });

  it('Vorbelegung aus dem Deal', () => {
    expect(fachlich(neu as unknown as Record<string, unknown>)).toEqual(fachlich(f.vorbelegt));
  });

  it('Bearbeitungsschritte (Felder, EK- und Tranchen-Schnellwahl)', () => {
    let k = structuredClone(f.vorbelegt) as unknown as KundenkalkulationDaten;
    k.inputs.sanierungsposten = (f.schritte[0]!.ergebnis as unknown as KundenkalkulationDaten).inputs.sanierungsposten;
    for (const s of f.schritte) {
      if (s.aktion.startsWith('feld:')) {
        const feld = s.aktion.slice(5);
        k = kundenkalkFeldSetzen(k, feld === 'stellplaetzeAnzahl_input' ? 'stellplaetzeAnzahl' : feld, s.wert!);
      } else if (s.aktion === 'ek:wert') k = { ...k, inputs: eigenkapitalAnwenden(k.inputs, parseNum(s.wert)) };
      else if (s.aktion.startsWith('ek:')) k = { ...k, inputs: eigenkapitalSchnell(k.inputs, s.aktion.slice(3) as 'zero') };
      else k = { ...k, inputs: tranche1Schnell(k.inputs, s.aktion.slice(8) as 'kp') };
      expect(fachlich(k as unknown as Record<string, unknown>), `${s.aktion} ${s.wert ?? ''}`).toEqual(fachlich(s.ergebnis));
    }
  });
});
