/**
 * Papierkorb: gelöschte Datensätze bleiben 30 Tage liegen.
 * Nach gg-immohandel src/lib/trash.ts (TRASH_COLLECTIONS, TRASH_LABELS, trashAutoCleanup)
 * und src/modules/settings/trash-ui.ts (Bezeichnung, Restlaufzeit, Dialoge).
 */

export const PAPIERKORB_TAGE = 30;

/** Bereiche mit Soft-Delete; Schlüssel wie die Tabellen des Neubaus, Anzeigename wie TRASH_LABELS. */
export const PAPIERKORB_BEREICHE = [
  { bereich: 'objekte', label: 'Objekte' },
  { bereich: 'makler', label: 'Makler' },
  { bereich: 'deals', label: 'Deals' },
  { bereich: 'projekte', label: 'Projekte' },
  { bereich: 'vertriebslisten', label: 'Vertriebslisten' },
  { bereich: 'praesentationen', label: 'Bank-Präsentationen' },
  { bereich: 'kundenkalkulationen', label: 'Kundenkalkulationen' },
  { bereich: 'begleitscheine', label: 'Begleitscheine' },
] as const;
export type PapierkorbBereich = (typeof PAPIERKORB_BEREICHE)[number]['bereich'];
export const PAPIERKORB_LABEL: Record<string, string> = Object.fromEntries(PAPIERKORB_BEREICHE.map((b) => [b.bereich, b.label]));

export const PAPIERKORB_HINWEIS = `Gelöschtes bleibt ${PAPIERKORB_TAGE} Tage liegen und wird danach automatisch entfernt.`;
export const PAPIERKORB_LEER = 'Der Papierkorb ist leer.';
export const ENDGUELTIG_FRAGE = 'Diesen Eintrag endgültig entfernen?\n\nDas lässt sich nicht rückgängig machen.';
export const leerenFrage = (anzahl: number) => `${anzahl} Eintrag/Einträge endgültig entfernen?\n\nDas lässt sich nicht rückgängig machen.`;

/**
 * Reihenfolge fürs endgültige Entfernen: Kinder vor Eltern. Ein Verweis heißt, Zeilen in `kind` zeigen mit einem
 * Fremdschlüssel auf `eltern`, der nicht mitlöscht — Postgres lehnt das Löschen der Eltern-Zeile sonst ab (23503).
 * Bereiche ohne Verweis behalten ihren Platz.
 */
export function papierkorbLoeschfolge<B extends string>(bereiche: readonly B[], verweise: readonly { kind: string; eltern: string }[]): B[] {
  const offen = [...bereiche];
  const folge: B[] = [];
  while (offen.length) {
    const i = offen.findIndex((b) => !verweise.some((v) => v.eltern === b && v.kind !== b && offen.includes(v.kind as B)));
    if (i < 0) throw new Error(`Papierkorb: Verweise bilden einen Kreis (${offen.join(', ')})`);
    folge.push(...offen.splice(i, 1));
  }
  return folge;
}

/**
 * Abhängiges geht beim endgültigen Entfernen mit seinen Eltern (Fachentscheidung 02.10.2026) — ob es selbst im
 * Papierkorb liegt oder nicht. Bis dahin bleibt es stehen, damit ein wiederhergestellter Deal vollständig zurückkommt.
 * Bewusst nicht dabei: Deals → Objekte. Ein Deal verschwindet nie stillschweigend mit seinem Objekt.
 */
export const PAPIERKORB_ABHAENGIG = [
  { kind: 'kundenkalkulationen', eltern: 'deals' },
  { kind: 'praesentationen', eltern: 'deals' },
  { kind: 'vertriebslisten', eltern: 'deals' },
  { kind: 'begleitscheine', eltern: 'objekte' },
] as const satisfies readonly { kind: PapierkorbBereich; eltern: PapierkorbBereich }[];

/** Endgültig entfernen abgelehnt: aus `kindBereich` verweist noch etwas auf den Eintrag. */
export const papierkorbVerwiesenHinweis = (kindBereich: string) =>
  `Endgültig entfernen geht noch nicht: Unter „${PAPIERKORB_LABEL[kindBereich] ?? kindBereich}“ gibt es Einträge, die hierauf verweisen. Entferne zuerst diese.`;
/** Nach „Papierkorb leeren“: so viele Einträge ließen sich nicht entfernen. */
export const papierkorbUebrigHinweis = (anzahl: number) =>
  `${anzahl} ${anzahl === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} im Papierkorb, weil noch andere Einträge darauf verweisen.`;
/** Fachentscheidung 02.10.2026 (anders als dealDelete der alten App): das Objekt geht mit seinem letzten Deal in den Papierkorb. */
export const DEAL_LOESCHEN_FRAGE = 'Deal in den Papierkorb verschieben?\n\nSein Objekt geht mit, wenn kein anderer Deal daran hängt.';

export interface PapierkorbEintrag { bereich: string; id: string; bezeichnung: string; geloeschtAm: string }

/** bezeichnung() der alten Ansicht: erstes gefülltes Feld, sonst „ohne Namen (id)“. */
export function papierkorbBezeichnung(felder: (string | null | undefined)[], id: string): string {
  const treffer = felder.find((x) => typeof x === 'string' && x.trim());
  return treffer ?? (id ? `ohne Namen (${id})` : 'ohne Namen');
}

/** Verbleibende Tage (restTage): angebrochene Tage zählen, nie negativ. */
export function papierkorbRestTage(geloeschtAm: string | number | Date, jetzt: number = Date.now()): number {
  const ms = geloeschtAm instanceof Date ? geloeschtAm.getTime() : typeof geloeschtAm === 'number' ? geloeschtAm : Date.parse(geloeschtAm);
  const alter = jetzt - (Number.isFinite(ms) ? ms : jetzt);
  return Math.max(0, PAPIERKORB_TAGE - Math.floor(alter / 86_400_000));
}

/** Zeile der Ansicht: „gelöscht am 17.9.2026 · noch 30 Tage“, ab 3 Tagen in Rot. */
export function papierkorbZeile(e: PapierkorbEintrag, jetzt: number = Date.now()) {
  const tage = papierkorbRestTage(e.geloeschtAm, jetzt);
  return {
    ...e,
    tage,
    dringend: tage <= 3,
    text: `gelöscht am ${new Date(e.geloeschtAm).toLocaleDateString('de-DE')} · noch ${tage} Tag${tage === 1 ? '' : 'e'}`,
  };
}

/**
 * Gruppen wie trashRender: alles nach Löschzeit (neueste zuerst), dann nach Bereich gruppiert —
 * die Reihenfolge der Gruppen folgt also dem jeweils neuesten Eintrag.
 */
export function papierkorbGruppen(eintraege: PapierkorbEintrag[], jetzt: number = Date.now()) {
  const sortiert = [...eintraege].sort((a, b) => Date.parse(b.geloeschtAm) - Date.parse(a.geloeschtAm));
  const gruppen = new Map<string, ReturnType<typeof papierkorbZeile>[]>();
  for (const e of sortiert) {
    if (!gruppen.has(e.bereich)) gruppen.set(e.bereich, []);
    gruppen.get(e.bereich)!.push(papierkorbZeile(e, jetzt));
  }
  return [...gruppen].map(([bereich, zeilen]) => ({ bereich, label: PAPIERKORB_LABEL[bereich] ?? bereich, eintraege: zeilen }));
}

/** trashAutoCleanup: älter als 30 Tage wird endgültig entfernt. */
export const papierkorbAbgelaufen = (geloeschtAm: string, jetzt: number = Date.now()) =>
  Date.parse(geloeschtAm) <= jetzt - PAPIERKORB_TAGE * 86_400_000;
