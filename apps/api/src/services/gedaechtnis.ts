/**
 * Gedächtnis (24.10.2026): gg meldet Ereignisse an den zentralen Gedächtnis-Dienst und zeigt die Einträge je Deal und
 * Makler. Ein ausgefallener Dienst darf gg nie aufhalten: Meldungen haben eine kurze Frist, Fehler landen nur im Log.
 * Texte und Bezüge kommen aus @gg/domain (gedaechtnis.ts).
 */
import type { Db } from '@gg/db';
import {
  dealKommentarText, dealStatusText, gedaechtnisBetrifft, gedaechtnisBezug, type GedaechtnisArt,
  MAKLER_BETREUUNG_FELDER, MAKLER_KONTAKT_FELDER, maklerBetreuungText, maklerKontaktText,
} from '@gg/domain';
import { GedaechtnisFehler, type GedaechtnisDienst } from '@gg/integrations';
import { FachFehler } from '../fehler.ts';
import { dealDetail } from './deals.ts';
import { maklerDetail } from './makler.ts';

/** Höchstens so lange wartet eine Änderung in gg auf die Meldung ans Gedächtnis. */
const MELDEFRIST_MS = 3000;

const ohneDienst = () => new FachFehler(503, 'Der Gedächtnis-Dienst ist nicht eingerichtet (Einstellungen → Zugänge: Adresse und Schlüssel).');

async function mitFehlern<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof GedaechtnisFehler) throw new FachFehler(e.status === 404 ? 404 : e.status === 401 || e.status === 403 ? 403 : e.status === 400 || e.status === 422 ? 422 : 503, e.message);
    throw e;
  }
}

/** Meldung ohne Rückwirkung: wartet höchstens MELDEFRIST_MS, Fehler nur ins Log. */
async function melden(dienst: GedaechtnisDienst | null, e: { text: string | null; objekt: string; art: string }) {
  if (!dienst || !e.text) return;
  const frist = new Promise<'frist'>((r) => setTimeout(() => r('frist'), MELDEFRIST_MS).unref?.());
  try {
    const ergebnis = await Promise.race([dienst.ereignis({ text: e.text, objekt: e.objekt, art: e.art, von: 'gg' }), frist]);
    if (ergebnis === 'frist') console.warn('[gedaechtnis] Meldung läuft länger als die Frist:', e.objekt, e.art);
  } catch (err) {
    console.warn('[gedaechtnis] Meldung fehlgeschlagen:', e.objekt, e.art, (err as Error).message);
  }
}

// ── Ereignisse aus gg ───────────────────────────────────────

export async function dealStatusMelden(db: Db, dienst: GedaechtnisDienst | null, dealId: string, grund?: string | null) {
  if (!dienst) return;
  const d = await dealDetail(db, dealId);
  await melden(dienst, { text: dealStatusText({ titel: d.objekt.titel, status: d.status, grund }), objekt: gedaechtnisBezug('deal', dealId), art: 'status' });
}

export async function dealKommentarMelden(db: Db, dienst: GedaechtnisDienst | null, dealId: string, kommentar: { id: string; text: string | null }) {
  if (!dienst || !kommentar.text?.trim()) return;
  const d = await dealDetail(db, dealId);
  // je Kommentar eine eigene Art: Kommentare ersetzen einander nicht
  await melden(dienst, { text: dealKommentarText({ titel: d.objekt.titel, text: kommentar.text }), objekt: gedaechtnisBezug('deal', dealId), art: `kommentar:${kommentar.id}` });
}

/** Nach einer Makler-Änderung: Kontakt- und Betreuungsstand neu, je nachdem, was geändert wurde. */
export async function maklerMelden(db: Db, dienst: GedaechtnisDienst | null, maklerId: string, geaendert: Record<string, unknown>) {
  if (!dienst) return;
  const kontakt = gedaechtnisBetrifft(geaendert, MAKLER_KONTAKT_FELDER);
  const betreuung = gedaechtnisBetrifft(geaendert, MAKLER_BETREUUNG_FELDER);
  if (!kontakt && !betreuung) return;
  const m = await maklerDetail(db, maklerId);
  const objekt = gedaechtnisBezug('makler', maklerId);
  if (kontakt) await melden(dienst, { text: maklerKontaktText(m), objekt, art: 'kontakt' });
  if (betreuung) await melden(dienst, { text: maklerBetreuungText(m), objekt, art: 'betreuung' });
}

// ── Für die Oberfläche ──────────────────────────────────────

export const gedaechtnisStand = (dienst: GedaechtnisDienst | null) => ({ verbunden: Boolean(dienst) });

export async function gedaechtnisEintraege(dienst: GedaechtnisDienst | null, art: GedaechtnisArt, id: string) {
  if (!dienst) throw ohneDienst();
  const { eintraege } = await mitFehlern(() => dienst.eintraege(gedaechtnisBezug(art, id)));
  return { eintraege: [...eintraege].sort((a, b) => (b.am ?? '').localeCompare(a.am ?? '')) };
}

/** `von`: wer gemerkt hat — 'gg' aus der Oberfläche, 'mcp:<label>' über den MCP-Server. */
export async function gedaechtnisMerken(dienst: GedaechtnisDienst | null, art: GedaechtnisArt, id: string, text: string, von = 'gg') {
  if (!dienst) throw ohneDienst();
  return mitFehlern(() => dienst.merken({ text, objekt: gedaechtnisBezug(art, id), von }));
}

/** Ein Ergebnis (z. B. Recherche aus Cowork) wörtlich als einen Eintrag ablegen; derselbe Titel ersetzt den alten. */
export async function gedaechtnisAblegen(dienst: GedaechtnisDienst | null, art: GedaechtnisArt, id: string, titel: string, text: string, von: string) {
  if (!dienst) throw ohneDienst();
  return mitFehlern(() => dienst.ablegen({ titel, text, objekt: gedaechtnisBezug(art, id), von }));
}

export async function gedaechtnisSuchen(dienst: GedaechtnisDienst | null, frage: string, bezug?: { art: GedaechtnisArt; id: string }) {
  if (!dienst) throw ohneDienst();
  return mitFehlern(() => dienst.suchen({ frage, objekt: bezug ? gedaechtnisBezug(bezug.art, bezug.id) : undefined, anzahl: 10 }));
}

export async function gedaechtnisAendern(dienst: GedaechtnisDienst | null, eintragId: string, text: string) {
  if (!dienst) throw ohneDienst();
  return mitFehlern(() => dienst.aendern(eintragId, text));
}

export async function gedaechtnisVergessen(dienst: GedaechtnisDienst | null, eintragId: string) {
  if (!dienst) throw ohneDienst();
  return mitFehlern(() => dienst.vergessen(eintragId));
}
