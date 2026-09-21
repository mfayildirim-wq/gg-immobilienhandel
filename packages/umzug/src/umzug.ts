import type { Db } from '@gg/db';
import { befundeGruppieren, type Bericht, pruefen } from './bericht.ts';
import { schreiben } from './schreiben.ts';
import { type KvDaten, QUELL_SCHLUESSEL, umformen } from './umformen.ts';

class Zurueckrollen extends Error {
  constructor(readonly bericht: Bericht) {
    super('Umzug zurückgerollt');
  }
}

/**
 * Formt um, schreibt und prüft in **einer** Transaktion.
 * Probelauf oder fehlgeschlagene Prüfung → alles zurückrollen, die Zieldatenbank bleibt unverändert.
 * Wiederholbar: gleicher Bestand ergibt gleiche Zeilen (stabile IDs).
 */
export async function umzugAusfuehren(
  db: Db,
  kv: KvDaten,
  opt: { trocken: boolean; stichtag?: string; /** unbekannte Felder und nicht umgezogene Sammlungen sind Abbruchgründe */ streng?: boolean },
): Promise<Bericht> {
  const stichtag = opt.stichtag ?? new Date().toISOString();
  const u = umformen(kv, stichtag);
  const nochNichtUmgezogen = Object.fromEntries(
    Object.entries(kv)
      .filter(([k]) => !(QUELL_SCHLUESSEL as readonly string[]).includes(k))
      .map(([k, v]) => [k, Array.isArray(v) ? v.length : ('Einzelwert' as const)]),
  );

  try {
    return await db.transaction(async (tx) => {
      await schreiben(tx, u.zeilen);
      const pruefungen = await pruefen(tx, kv, u);
      const fehler = u.befunde.some((b) => b.schwere === 'fehler');
      // Scharf: was der Umzug nicht kennt, nimmt er nicht mit — und das soll niemand erst im Bericht lesen, nachdem
      // geschrieben wurde. Am echten Bestand vom 21.09.2026 waren das die Kontaktfelder von 110 der 141 Makler.
      const abbruchgruende = opt.streng
        ? [
            ...Object.entries(u.unbekannteFelder).flatMap(([entitaet, felder]) => Object.entries(felder).map(([f, n]) => `unbekanntes Feld ${entitaet}.${f} (${n}×)`)),
            ...Object.entries(nochNichtUmgezogen).map(([k, n]) => `Sammlung ${k} wird nicht umgezogen (${n})`),
          ]
        : [];
      const bericht: Bericht = {
        zeitpunkt: stichtag,
        trocken: opt.trocken,
        geschrieben: false,
        ok: pruefungen.every((p) => p.ok) && !fehler && abbruchgruende.length === 0,
        abbruchgruende,
        pruefungen,
        befundeJeArt: befundeGruppieren(u.befunde),
        unbekannteFelder: u.unbekannteFelder,
        nochNichtUmgezogen,
      };
      if (opt.trocken || !bericht.ok) throw new Zurueckrollen(bericht);
      return { ...bericht, geschrieben: true };
    });
  } catch (e) {
    if (e instanceof Zurueckrollen) return e.bericht;
    throw e;
  }
}
