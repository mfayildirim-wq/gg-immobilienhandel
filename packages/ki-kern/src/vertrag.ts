/**
 * Vertrag zwischen KI-Leiste (Browser) und KI-Dienst (Server). Reine Typen: die Leiste importiert sie mit `import type`,
 * der Dienst liefert sie. Heute laufen beide in gg (`/api/ki-leiste`); als eigener Dienst ändert sich nur die Adresse.
 */

/** Der Dialog, in dem man gerade ist — die App meldet ihn, nur sie kennt ihn. */
export interface KiBezug { art: string; id: string }

export interface KiSchritt {
  art: 'werkzeug' | 'websuche';
  name: string;
  ok: boolean;
  /** Argumente bzw. Suchbegriff, gekürzt */
  kurz?: string;
}

export interface KiQuelle { url: string; titel: string }

export interface KiNachricht {
  rolle: 'nutzer' | 'ki';
  text: string;
  am: string;
  schritte?: KiSchritt[];
  quellen?: KiQuelle[];
  /** wie viele Gedächtnis-Einträge zum Dialog die KI vor der Antwort bekam */
  gedaechtnis?: number;
  modell?: string;
  /** Die KI schlägt vor, etwas im Gedächtnis abzulegen — gespeichert wird erst, wenn der Nutzer bestätigt */
  vorschlag?: KiVorschlag;
  /** Titel, unter dem diese Antwort (oder ihr Vorschlag) im Gedächtnis abgelegt wurde */
  abgelegt?: string;
}

export interface KiVorschlag { titel: string; text: string; status?: 'abgelegt' | 'verworfen' }

export interface KiGespraechKopf {
  id: string;
  bezug: KiBezug | null;
  titel: string;
  von: string;
  am: string;
  anzahl: number;
}
export interface KiGespraech extends KiGespraechKopf { nachrichten: KiNachricht[] }

export interface KiEinstellungen {
  modell: string;
  websuche: boolean;
  /** Gedächtnis zum Dialog vor jeder Antwort mitgeben */
  gedaechtnis: boolean;
}
export interface KiModellAngebot { id: string; label: string }

export interface KiStand {
  verfuegbar: boolean;
  gedaechtnis: boolean;
  /** Verlauf im Gedächtnis-Dienst; sonst nur bis zum Neustart */
  verlaufDauerhaft: boolean;
  einstellungen: KiEinstellungen;
  modelle: KiModellAngebot[];
}

export interface KiGedaechtnisEintrag {
  id: string;
  text: string;
  titel?: string | null;
  quelle?: string | null;
  von?: string | null;
  am?: string | null;
}

export interface KiBezugSicht {
  bezug: KiBezug;
  /** z. B. „Deal“ */
  label: string;
  titel: string;
  gedaechtnis: { verbunden: boolean; eintraege: KiGedaechtnisEintrag[]; fehler?: string };
  gespraeche: KiGespraechKopf[];
}

export interface KiSenden { gespraechId?: string | null; bezug?: KiBezug | null; text: string }
/** `gespraechId` + `nachricht` (Index): die Antwort, aus der abgelegt wird — dort wird es vermerkt */
export interface KiAblegen { bezug: KiBezug; titel: string; text: string; gespraechId?: string | null; nachricht?: number | null }
export interface KiVorschlagVerwerfen { gespraechId: string; nachricht: number }
