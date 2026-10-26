/**
 * Der KI-Dienst hinter der Leiste: Stand, Einstellungen, Sicht auf den Dialog (Gedächtnis und Verlauf), Senden und Ablegen.
 * Alles, was eine App ausmacht, kommt als Option hinein — Modell, Werkzeuge (MCP), Gedächtnis, Verlauf, Beschreibung des
 * Dialogs. So läuft derselbe Dienst heute in gg und später als eigener Dienst für mehrere Apps.
 */
import type {
  KiAblegen, KiBezug, KiBezugSicht, KiEinstellungen, KiGedaechtnisEintrag, KiGespraech, KiModellAngebot, KiNachricht, KiSenden, KiStand,
} from './vertrag.ts';
import type { Modell } from './modell.ts';
import { kiAntworten } from './schleife.ts';
import type { VerlaufSpeicher } from './verlauf.ts';
import type { WerkzeugQuelle } from './werkzeuge.ts';

/** Fehler mit HTTP-Status; die App übersetzt ihn in ihre Fehlerantwort. */
export class KiLeisteFehler extends Error {
  constructor(readonly status: 400 | 403 | 404 | 422 | 503, message: string) { super(message); }
}

export interface KiGedaechtnis {
  eintraege(bezug: KiBezug): Promise<KiGedaechtnisEintrag[]>;
  ablegen(bezug: KiBezug, titel: string, text: string, von: string): Promise<unknown>;
}

export interface BezugBeschreibung {
  /** Art für Menschen, z. B. „Deal“ */
  label: string;
  titel: string;
  /** Die wichtigsten Daten des Dialogs; gehen gekürzt als JSON an das Modell */
  kontext?: unknown;
  /** Wie das Modell den Datensatz mit den Werkzeugen erreicht, z. B. `read_entity` mit collection "deals" */
  hinweis?: string;
}

export interface KiDienstOptionen {
  /** Name der App im Systemtext */
  app: string;
  /** Modell zur gewählten Kennung; `null` = nicht eingerichtet (kein Schlüssel) */
  modell: (modellId: string) => Promise<Modell | null>;
  modelle: KiModellAngebot[];
  /** Werkzeuge im Namen des Nutzers */
  werkzeuge: (nutzer: string) => WerkzeugQuelle;
  gedaechtnis: () => Promise<KiGedaechtnis | null>;
  /** Hat dieser Dialog ein Gedächtnis? (gg: alles mit eigenem Dialog) */
  hatGedaechtnis: (bezug: KiBezug) => boolean;
  verlauf: VerlaufSpeicher;
  /** `null` = den Datensatz gibt es nicht */
  beschreiben: (bezug: KiBezug) => Promise<BezugBeschreibung | null>;
  einstellungen: { lesen(): Promise<KiEinstellungen>; speichern(e: KiEinstellungen): Promise<KiEinstellungen> };
  jetzt?: () => Date;
  neueId?: () => string;
  fristMs?: number;
}

/** So viele Zeichen Kontext und Gedächtnis bekommt das Modell vorab; mehr holt es sich mit den Werkzeugen. */
const MAX_KONTEXT = 8000;
const MAX_EINTRAG = 1500;
const MAX_EINTRAEGE = 20;
const MAX_VERLAUF = 20;

const gekuerzt = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function kiDienst(o: KiDienstOptionen) {
  const jetzt = o.jetzt ?? (() => new Date());
  const neueId = o.neueId ?? (() => crypto.randomUUID());

  async function beschreibung(bezug: KiBezug): Promise<BezugBeschreibung> {
    const b = await o.beschreiben(bezug);
    if (!b) throw new KiLeisteFehler(404, 'Diesen Datensatz gibt es nicht (mehr).');
    return b;
  }

  /** Gedächtnis zum Dialog; ein ausgefallener Dienst hält die Leiste nicht auf. */
  async function gedaechtnisZu(bezug: KiBezug): Promise<KiBezugSicht['gedaechtnis']> {
    if (!o.hatGedaechtnis(bezug)) return { verbunden: false, eintraege: [] };
    const g = await o.gedaechtnis();
    if (!g) return { verbunden: false, eintraege: [] };
    try {
      return { verbunden: true, eintraege: await g.eintraege(bezug) };
    } catch (e) {
      return { verbunden: true, eintraege: [], fehler: (e as Error).message };
    }
  }

  function systemText(b: { bezug: KiBezug; beschreibung: BezugBeschreibung } | null, eintraege: KiGedaechtnisEintrag[] | null, e: KiEinstellungen): string {
    const teile = [
      `Du bist der KI-Assistent in der App „${o.app}“. Heute ist ${jetzt().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
      'Antworte auf Deutsch, knapp und sachlich, in Markdown; Vergleiche als Tabelle. Erfinde keine Daten — was du nicht weißt, liest du mit den Werkzeugen nach oder sagst, dass es fehlt.',
      b ? `Dialog: ${b.beschreibung.label} „${b.beschreibung.titel}“` : 'Dialog: keiner (der Nutzer ist auf einer Übersicht)',
    ];
    if (b?.beschreibung.hinweis) teile.push(b.beschreibung.hinweis);
    if (b?.beschreibung.kontext !== undefined) teile.push(`Daten des Dialogs (gekürzt):\n${gekuerzt(JSON.stringify(b.beschreibung.kontext), MAX_KONTEXT)}`);
    if (eintraege) {
      teile.push(`Gedächtnis-Einträge: ${eintraege.length}`);
      if (eintraege.length) {
        teile.push('Gedächtnis zu diesem Dialog (neueste zuerst; aus der App, von Nutzern gemerkt oder abgelegt):\n'
          + eintraege.slice(0, MAX_EINTRAEGE).map((x) => `- ${x.titel ? `[${x.titel}] ` : ''}${gekuerzt(x.text, MAX_EINTRAG)}${x.am ? ` (${x.am.slice(0, 10)})` : ''}`).join('\n'));
      }
    }
    teile.push('Mit den Werkzeugen liest du weitere Daten der App. Ändern kannst du nichts; '
      + 'soll ein Ergebnis aufbewahrt werden, legt der Nutzer es mit „Im Gedächtnis ablegen“ unter deiner Antwort ab.');
    if (e.websuche) teile.push('Für Fragen nach außen (Marktpreise, Vergleichsangebote, Firmen, Personen) nutze die Websuche und nenne die Quellen.');
    return teile.join('\n\n');
  }

  return {
    async stand(): Promise<KiStand> {
      const einstellungen = await o.einstellungen.lesen();
      return { verfuegbar: Boolean(await o.modell(einstellungen.modell)), gedaechtnis: Boolean(await o.gedaechtnis()), einstellungen, modelle: o.modelle };
    },

    async einstellungenSpeichern(e: KiEinstellungen): Promise<KiEinstellungen> {
      if (!o.modelle.some((m) => m.id === e.modell)) throw new KiLeisteFehler(400, `Unbekanntes Modell „${e.modell}“.`);
      return o.einstellungen.speichern(e);
    },

    async bezug(bezug: KiBezug): Promise<KiBezugSicht> {
      const b = await beschreibung(bezug);
      const [gedaechtnis, gespraeche] = await Promise.all([gedaechtnisZu(bezug), o.verlauf.liste(bezug, MAX_VERLAUF)]);
      return { bezug, label: b.label, titel: b.titel, gedaechtnis, gespraeche };
    },

    /** Gespräche ohne Dialog (Übersichten) */
    async allgemein() {
      return { gespraeche: await o.verlauf.liste(null, MAX_VERLAUF) };
    },

    async gespraech(id: string): Promise<KiGespraech> {
      const g = await o.verlauf.laden(id);
      if (!g) throw new KiLeisteFehler(404, 'Gespräch nicht gefunden.');
      return g;
    },

    async senden(s: KiSenden, nutzer: string): Promise<KiGespraech> {
      const frage = s.text.trim();
      if (!frage) throw new KiLeisteFehler(400, 'Die Frage ist leer.');
      const einstellungen = await o.einstellungen.lesen();
      const modell = await o.modell(einstellungen.modell);
      if (!modell) throw new KiLeisteFehler(503, 'Die KI ist nicht eingerichtet (Einstellungen → Zugänge: Anthropic).');

      const alt = s.gespraechId ? await o.verlauf.laden(s.gespraechId) : null;
      if (s.gespraechId && !alt) throw new KiLeisteFehler(404, 'Gespräch nicht gefunden.');
      // Ein Gespräch bleibt bei seinem Dialog, auch wenn die Leiste inzwischen woanders steht
      const bezug = alt ? alt.bezug : (s.bezug ?? null);
      const beschrieben = bezug ? { bezug, beschreibung: await beschreibung(bezug) } : null;
      const gedaechtnis = bezug && einstellungen.gedaechtnis ? await gedaechtnisZu(bezug) : null;
      const eintraege = gedaechtnis?.verbunden && !gedaechtnis.fehler ? gedaechtnis.eintraege : null;

      const quelle = o.werkzeuge(nutzer);
      const werkzeuge = await quelle.liste();
      const ergebnis = await kiAntworten({
        modell, system: systemText(beschrieben, eintraege, einstellungen), verlauf: alt?.nachrichten ?? [], frage,
        werkzeuge, quelle, websuche: einstellungen.websuche, fristMs: o.fristMs,
      });

      const am = jetzt().toISOString();
      const nachrichten: KiNachricht[] = [
        ...(alt?.nachrichten ?? []),
        { rolle: 'nutzer', text: frage, am },
        {
          rolle: 'ki', text: ergebnis.text, am: jetzt().toISOString(),
          ...(ergebnis.schritte.length ? { schritte: ergebnis.schritte } : {}),
          ...(ergebnis.quellen.length ? { quellen: ergebnis.quellen } : {}),
          ...(eintraege ? { gedaechtnis: eintraege.length } : {}),
          ...(ergebnis.modell ? { modell: ergebnis.modell } : {}),
        },
      ];
      const g: KiGespraech = alt
        ? { ...alt, am, anzahl: nachrichten.length, nachrichten }
        : { id: neueId(), bezug, titel: gekuerzt(frage.replace(/\s+/g, ' '), 80), von: nutzer, am, anzahl: nachrichten.length, nachrichten };
      await o.verlauf.speichern(g);
      return g;
    },

    async ablegen(a: KiAblegen, nutzer: string) {
      if (!o.hatGedaechtnis(a.bezug)) throw new KiLeisteFehler(400, 'Dieser Dialog hat kein Gedächtnis.');
      const titel = a.titel.trim().slice(0, 200);
      const text = a.text.trim();
      if (!titel || !text) throw new KiLeisteFehler(400, 'Titel und Text dürfen nicht leer sein.');
      const g = await o.gedaechtnis();
      if (!g) throw new KiLeisteFehler(503, 'Der Gedächtnis-Dienst ist nicht eingerichtet.');
      return g.ablegen(a.bezug, titel, text, `leiste:${nutzer}`);
    },
  };
}

export type KiDienst = ReturnType<typeof kiDienst>;
