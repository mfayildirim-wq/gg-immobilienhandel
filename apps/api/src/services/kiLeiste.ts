/**
 * KI-Leiste (26.10.2026): gg verdrahtet den KI-Dienst aus @gg/ki-kern. Die Werkzeuge sind die des eigenen MCP-Servers
 * (im selben Prozess, lesend, im Namen des angemeldeten Nutzers; die Schreibwerkzeuge nur als Vorschlag mit Bestätigung); Gedächtnis und Verlauf liegen im zentralen
 * Gedächtnis-Dienst (der Verlauf getrennt vom Wissen). Was gg-spezifisch ist — welcher Dialog wie heißt und welche Daten er hat — steht hier.
 */
import type { Db } from '@gg/db';
import {
  type GedaechtnisArt, istGedaechtnisArt, KI_MODELLE, KI_STANDARD, kiModellFuer, maklerAnzeigename,
} from '@gg/domain';
import { GedaechtnisFehler, type GedaechtnisDienst } from '@gg/integrations';
import {
  type BezugBeschreibung, type KiBezug, kiDienst, type KiGespraech, type KiNachricht, type Modell, quelleAusMcp, type VerlaufSpeicher,
  verlaufImArbeitsspeicher, type WerkzeugQuelle,
} from '@gg/ki-kern';
import { FachFehler } from '../fehler.ts';
import { begleitscheinDetail } from './begleitscheine.ts';
import { dealDetail } from './deals.ts';
import { kiLeisteSchalterLesen, kiLeisteSchalterSpeichern, kiModellwahlLesen, kiModellwahlSpeichern } from './einstellungen.ts';
import { gedaechtnisAblegen, gedaechtnisEintraege } from './gedaechtnis.ts';
import { kundenkalkulationDetail } from './kundenkalkulationen.ts';
import { maklerDetail } from './makler.ts';
import { mcpAufruf, mcpBestandZu, type McpUmfeld } from './mcp.ts';
import { objektDetail, objektTitel } from './objekte.ts';
import { projektDetail } from './projekte.ts';
import { vertriebslisteDetail } from './vertriebslisten.ts';

/** Ohne Wahl in Einstellungen → KI-Modelle antwortet die Leiste mit Sonnet 5.5. */
export const KI_LEISTE_MODELL = 'claude-sonnet-5-5';

const BESCHREIBUNG: Record<GedaechtnisArt, { label: string; lesen: (db: Db, id: string) => Promise<{ titel: string; daten: unknown }> }> = {
  deal: { label: 'Deal', lesen: async (db, id) => { const d = await dealDetail(db, id); return { titel: d.objekt.titel, daten: d }; } },
  makler: { label: 'Makler', lesen: async (db, id) => { const m = await maklerDetail(db, id); return { titel: `${maklerAnzeigename(m)}${m.firma ? ` (${m.firma})` : ''}`, daten: m }; } },
  objekt: { label: 'Objekt', lesen: async (db, id) => { const o = await objektDetail(db, id); return { titel: objektTitel(o), daten: o }; } },
  projekt: { label: 'Projekt', lesen: async (db, id) => { const p = await projektDetail(db, id); return { titel: [p.adresse, p.stadt].filter(Boolean).join(', ') || 'Projekt', daten: p }; } },
  kundenkalkulation: { label: 'Kundenkalkulation', lesen: async (db, id) => { const k = await kundenkalkulationDetail(db, id); return { titel: k.name, daten: k }; } },
  vertriebsliste: { label: 'Vertriebsliste', lesen: async (db, id) => { const v = await vertriebslisteDetail(db, id); return { titel: v.titel, daten: v }; } },
  begleitschein: { label: 'Begleitschein', lesen: async (db, id) => { const b = await begleitscheinDetail(db, id); return { titel: [b.name, b.adresse].filter(Boolean).join(' – '), daten: b }; } },
};

/** Leeres weg, lange Listen und Texte gekürzt — der Kontext soll das Wichtige tragen, nicht den ganzen Datensatz. */
export function kompakt(wert: unknown, tiefe = 0): unknown {
  if (wert === null || wert === undefined || wert === '') return undefined;
  if (typeof wert === 'string') return wert.length > 400 ? `${wert.slice(0, 400)}…` : wert;
  if (Array.isArray(wert)) {
    if (tiefe > 3) return `[${wert.length} Einträge]`;
    const teile = wert.slice(0, 8).map((x) => kompakt(x, tiefe + 1)).filter((x) => x !== undefined);
    if (!teile.length) return undefined;
    return wert.length > 8 ? [...teile, `… ${wert.length - 8} weitere`] : teile;
  }
  if (typeof wert === 'object') {
    if (tiefe > 3) return undefined;
    const aus = Object.entries(wert as Record<string, unknown>)
      .map(([k, v]) => [k, kompakt(v, tiefe + 1)] as const)
      .filter(([, v]) => v !== undefined);
    return aus.length ? Object.fromEntries(aus) : undefined;
  }
  return wert;
}

async function beschreiben(db: Db, bezug: KiBezug): Promise<BezugBeschreibung | null> {
  if (!istGedaechtnisArt(bezug.art)) return null;
  const b = BESCHREIBUNG[bezug.art];
  try {
    const { titel, daten } = await b.lesen(db, bezug.id);
    const bestand = mcpBestandZu(bezug.art);
    return {
      label: b.label, titel, kontext: kompakt(daten),
      hinweis: `Den vollständigen Datensatz liest du mit read_entity (collection "${bestand}", id "${bezug.id}"); die Gedächtnis-Werkzeuge nehmen dieselbe collection und id.`,
    };
  } catch (e) {
    if (e instanceof FachFehler && e.status === 404) return null;
    throw e;
  }
}

// ── Verlauf im Gedächtnis-Dienst ────────────────────────────

/** Gespräche liegen im Gedächtnis-Dienst — getrennt vom Wissen, nur für gg lesbar, nach 90 Tagen ohne Fortsetzung gelöscht. */
export function verlaufImDienst(dienst: GedaechtnisDienst): VerlaufSpeicher {
  return {
    async liste(bezug, anzahl) {
      const { gespraeche } = await dienst.gespraeche(bezug, anzahl);
      return gespraeche.map((g) => ({ ...g, von: g.von ?? '', am: g.am ?? '' }));
    },
    async laden(id) {
      try {
        const g = await dienst.gespraech(id);
        return { ...g, von: g.von ?? '', am: g.am ?? '', nachrichten: g.nachrichten as KiNachricht[] };
      } catch (e) {
        if (e instanceof GedaechtnisFehler && e.status === 404) return null;
        throw e;
      }
    },
    async speichern(g: KiGespraech) {
      await dienst.gespraechSpeichern(g);
    },
    async loeschen(id) {
      return (await dienst.gespraechLoeschen(id)).geloescht;
    },
  };
}

/** Ohne Gedächtnis-Dienst (lokal): Verlauf nur im Arbeitsspeicher, bis zum Neustart. */
const fluechtig = verlaufImArbeitsspeicher();

// ── Zusammenbau ─────────────────────────────────────────────

/** Gedächtnis schreibt die Leiste über ihre eigene Karte (`gedaechtnis_vorschlagen`), nicht über das MCP-Werkzeug. */
const NICHT_IN_DER_LEISTE = new Set(['gedaechtnis_merken']);
function ohne(q: WerkzeugQuelle): WerkzeugQuelle {
  return {
    liste: async () => (await q.liste()).filter((w) => !NICHT_IN_DER_LEISTE.has(w.name)),
    aufrufen: async (name, args) => (NICHT_IN_DER_LEISTE.has(name) ? { text: `"${name}" gibt es in der Leiste nicht.`, fehler: true } : q.aufrufen(name, args)),
  };
}

export interface KiLeisteUmfeld {
  /** Das Modell zur Kennung; `null` = kein Schlüssel */
  modell: (modellId: string) => Promise<Modell | null>;
  gedaechtnis: () => Promise<GedaechtnisDienst | null>;
}

export function kiLeiste(db: Db, u: KiLeisteUmfeld) {
  const mcpUmfeld: McpUmfeld = { gedaechtnis: u.gedaechtnis };
  return kiDienst({
    app: 'GG Immobilienhandel',
    modell: u.modell,
    modelle: KI_MODELLE.map((m) => ({ id: m.id, label: m.label })),
    // Die Leiste sieht dieselben Werkzeuge wie Claude über MCP — nur lesend, im Namen des Nutzers
    werkzeuge: (nutzer) => quelleAusMcp(async (n) => mcpAufruf(db, n, { label: `leiste:${nutzer}`, scopes: ['read'], modus: 'key' }, mcpUmfeld)),
    // Schreiben (29.10.2026): dieselben Werkzeuge wie Cowork mit `write` — die KI schlägt vor, der Nutzer übernimmt
    aendern: (nutzer) => ohne(quelleAusMcp(async (n) => mcpAufruf(db, n, { label: `leiste:${nutzer}`, scopes: ['write'], modus: 'key' }, mcpUmfeld))),
    gedaechtnis: async () => {
      const dienst = await u.gedaechtnis();
      if (!dienst) return null;
      return {
        eintraege: async (b) => (istGedaechtnisArt(b.art) ? (await gedaechtnisEintraege(dienst, b.art, b.id)).eintraege : []),
        ablegen: async (b, titel, text, von) => {
          if (!istGedaechtnisArt(b.art)) throw new FachFehler(400, 'Dieser Dialog hat kein Gedächtnis.');
          return gedaechtnisAblegen(dienst, b.art, b.id, titel, text, von);
        },
      };
    },
    hatGedaechtnis: (b) => istGedaechtnisArt(b.art),
    verlauf: async () => {
      const dienst = await u.gedaechtnis();
      return dienst ? { speicher: verlaufImDienst(dienst), dauerhaft: true } : { speicher: fluechtig, dauerhaft: false };
    },
    beschreiben: (b) => beschreiben(db, b),
    einstellungen: {
      async lesen() {
        const [wahl, schalter] = await Promise.all([kiModellwahlLesen(db), kiLeisteSchalterLesen(db)]);
        return { modell: kiModellFuer(wahl, 'assistent') ?? KI_LEISTE_MODELL, ...schalter };
      },
      async speichern(e) {
        const wahl = await kiModellwahlLesen(db);
        await kiModellwahlSpeichern(db, { ...wahl, assistent: e.modell === KI_LEISTE_MODELL && wahl.assistent === KI_STANDARD ? KI_STANDARD : e.modell });
        const schalter = await kiLeisteSchalterSpeichern(db, { websuche: e.websuche, gedaechtnis: e.gedaechtnis });
        return { modell: e.modell, ...schalter };
      },
    },
  });
}
