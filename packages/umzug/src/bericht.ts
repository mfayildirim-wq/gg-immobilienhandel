import { einheitAlsEingabe, sanierungAlsEingabe, schema } from '@gg/db';
import { berechneAnkauf, computeKKalk, type KKalkInputs, DEAL_STATUS, DealStatus, KALK_STANDARD, type KalkStandard, START_STATUS, weitereKontakte, type WeitereKontakte } from '@gg/domain';
import { asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from './schreiben.ts';
import { type Befund, BS_TYPEN, FILTER_MODULE, bsAktionenAlt, bsVorlageAlt, EINSTELLUNGEN, FINANZPRAES_STANDARD_SCHLUESSEL, finanzpraesStandardUmformen, DOKUMENT_TABELLE, FOTO_TABELLE, type KvDaten, type Umformung } from './umformen.ts';
import { istObjekt, kanonisch, liste, parseNumAlt, text } from './werte.ts';

export interface Pruefung {
  name: string;
  quelle: number;
  ziel: number;
  ok: boolean;
}

export interface Bericht {
  zeitpunkt: string;
  trocken: boolean;
  geschrieben: boolean;
  ok: boolean;
  pruefungen: Pruefung[];
  befundeJeArt: Record<string, { schwere: Befund['schwere']; anzahl: number; beispiele: Befund[] }>;
  unbekannteFelder: Umformung['unbekannteFelder'];
  nochNichtUmgezogen: Record<string, number | 'Einzelwert'>;
}

const cent = (n: number) => Math.round(n * 100) / 100;

/**
 * Vergleicht den Rohbestand der alten App mit dem, was tatsächlich in der Zieldatenbank steht.
 * Die Quellseite wird direkt aus den KV-Daten gezählt, nicht aus der Umformung.
 */
export async function pruefen(tx: Tx, kv: KvDaten, u: Umformung): Promise<Pruefung[]> {
  const makler = liste(kv['immo-makler']).filter((m) => text(m.id));
  const objekte = liste(kv['immo-objects']).filter((o) => text(o.id));
  const deals = liste(kv['immo-deals']).filter((d) => text(d.id));
  const p: Pruefung[] = [];
  const vergleiche = (name: string, quelle: number, ziel: number) =>
    p.push({ name, quelle: cent(quelle), ziel: cent(ziel), ok: cent(quelle) === cent(ziel) });
  const anzahl = async (tabelle: PgTable) => (await tx.select({ n: count() }).from(tabelle))[0]!.n;

  vergleiche(`Makler (+${u.waisen.makler} aus Deal-Kopie)`, makler.length + u.waisen.makler, await anzahl(schema.makler));
  vergleiche(`Objekte (+${u.waisen.objekte} aus Deal-Kopie)`, objekte.length + u.waisen.objekte, await anzahl(schema.objekte));
  vergleiche('Deals', deals.length, await anzahl(schema.deals));
  vergleiche('Deals im Papierkorb', deals.filter((d) => d._deleted).length,
    (await tx.select({ n: count() }).from(schema.deals).where(isNotNull(schema.deals.deletedAt)))[0]!.n);

  const jeStatus = await tx.select({ status: schema.deals.status, n: count() }).from(schema.deals).groupBy(schema.deals.status);
  for (const s of DEAL_STATUS) {
    const quelle = deals.filter((d) => {
      const r = DealStatus.safeParse(text(d.status) ?? START_STATUS);
      return (r.success ? r.data : START_STATUS) === s;
    }).length;
    vergleiche(`Deals „${s}“`, quelle, jeStatus.find((z) => z.status === s)?.n ?? 0);
  }

  const summeSql = async (ausdruck: ReturnType<typeof sql>) =>
    Number((await tx.execute<{ s: string }>(sql`select coalesce(sum(${ausdruck}), 0)::text as s`))[0]!.s);

  vergleiche('Summe Angebotspreise Objekte (€)',
    objekte.reduce((a, o) => a + parseNumAlt(o.angebotspreis), 0),
    await summeSql(sql`(select sum(${schema.objekte.angebotspreis}) from ${schema.objekte})`));

  const kaufpreiseZiel = await tx.select({ k: schema.deals.kalkulation }).from(schema.deals);
  vergleiche('Summe Kaufpreise Deals (€)',
    deals.reduce((a, d) => a + (istObjekt(d.kalk) ? parseNumAlt(d.kalk.kaufpreis) : 0), 0),
    kaufpreiseZiel.reduce((a, z) => a + (istObjekt(z.k) ? parseNumAlt(z.k.kaufpreis) : 0), 0));

  vergleiche('Summe Sanierungen (€, wie die alte Kalkulation)',
    deals.reduce((a, d) => a + liste(d.sanierung).reduce((b, s) => b + (+(s.amt as number) || 0), 0), 0),
    await summeSql(sql`(select sum(${schema.dealSanierungen.betrag}) from ${schema.dealSanierungen})`));

  vergleiche('Objekt-Einheiten', objekte.reduce((a, o) => a + liste(o.einheiten).length, 0), await anzahl(schema.objektEinheiten));
  vergleiche('Deal-Einheiten', deals.reduce((a, d) => a + liste(d.einheiten).length, 0), await anzahl(schema.dealEinheiten));
  vergleiche('Sanierungspositionen', deals.reduce((a, d) => a + liste(d.sanierung).length, 0), await anzahl(schema.dealSanierungen));
  vergleiche('Kalkulationsvarianten', deals.reduce((a, d) => a + liste(d.kalkVarianten).length, 0), await anzahl(schema.dealKalkVarianten));
  vergleiche('Deal-Kommentare (inkl. Notizen ohne Kommentare)',
    deals.reduce((a, d) => a + (liste(d.kommentare).length || (text(d.notizen) ? 1 : 0)), 0),
    await anzahl(schema.dealKommentare));
  vergleiche('Makler-Kommunikation (inkl. Notizen)',
    makler.reduce((a, m) => {
      const komm = liste(m.komm);
      const notiz = text(m.notizen);
      return a + komm.length + (notiz && !komm.some((k) => text(k.text) === notiz) ? 1 : 0);
    }, 0),
    await anzahl(schema.maklerKommunikation));
  // Kontaktfelder, die die alte App am Makler ablegte, ohne sie anzuzeigen (echter Bestand 21.09.2026: 110 von 141 Maklern)
  const zielMakler = await tx.select({ mobil: schema.makler.mobil, festnetz: schema.makler.festnetz, strasse: schema.makler.strasse, plz: schema.makler.plz, ort: schema.makler.ort, weitere: schema.makler.weitereKontakte }).from(schema.makler);
  vergleiche('Makler mit Mobilnummer', makler.filter((m) => text(m.mobiltel)).length, zielMakler.filter((m) => m.mobil).length);
  vergleiche('Makler mit Festnetznummer', makler.filter((m) => text(m.festnetztel)).length, zielMakler.filter((m) => m.festnetz).length);
  vergleiche('Makler mit Anschrift', makler.filter((m) => text(m.strasse) || text(m.plz) || text(m.stadt)).length, zielMakler.filter((m) => m.strasse || m.plz || m.ort).length);
  const weitereAnzahl = (k: WeitereKontakte | null) => (k ? k.namen.length + k.telefonnummern.length + k.emails.length : 0);
  vergleiche('Weitere Kontaktangaben der Makler (Namen, Nummern, E-Mails)',
    makler.reduce((a, m) => a + weitereAnzahl(weitereKontakte(
      { name: text(m.name), tel: text(m.tel) ?? text(m.telefon), mobil: text(m.mobiltel), festnetz: text(m.festnetztel), email: text(m.email) },
      { namen: m.alleNamen, telefonnummern: m.alleTelefonnummern, emails: m.alleEmails })), 0),
    zielMakler.reduce((a, m) => a + weitereAnzahl(m.weitere as WeitereKontakte | null), 0));
  vergleiche('Status-Verlauf (ein Eintrag je Deal)', deals.length, await anzahl(schema.dealStatusHistorie));

  // Rechengrundlage erhalten? Kalkulation je Deal aus Altdaten und aus den neuen Tabellen rechnen und vergleichen.
  const standard: KalkStandard = { ...KALK_STANDARD, ...(istObjekt(kv['immo-kalk-defaults']) ? (kv['immo-kalk-defaults'] as Partial<KalkStandard>) : {}) };
  const zielDeals = new Map((await tx.select({ id: schema.deals.id, kalk: schema.deals.kalkulation }).from(schema.deals)).map((d) => [d.id, d.kalk]));
  const zielEinheiten = await tx.select().from(schema.dealEinheiten).orderBy(asc(schema.dealEinheiten.sort));
  const zielSanierungen = await tx.select().from(schema.dealSanierungen).orderBy(asc(schema.dealSanierungen.sort));
  let gleich = 0;
  const abweichend: string[] = [];
  for (const d of deals) {
    const id = text(d.id)!;
    const alt = berechneAnkauf(istObjekt(d.kalk) ? d.kalk : {}, liste(d.einheiten), liste(d.sanierung), standard).kennzahlen;
    const zk = zielDeals.get(id);
    const neu = berechneAnkauf(
      istObjekt(zk) ? zk : {},
      zielEinheiten.filter((e) => e.dealId === id).map(einheitAlsEingabe),
      zielSanierungen.filter((s) => s.dealId === id).map(sanierungAlsEingabe),
      standard,
    ).kennzahlen;
    const ok = (['gik', 'gewinnAuf', 'gewinnGlo'] as const).every((k) => (Number.isNaN(alt[k]) && Number.isNaN(neu[k])) || alt[k] === neu[k]);
    if (ok) gleich++;
    else abweichend.push(`${id}: GIK ${alt.gik} → ${neu.gik}`);
  }
  vergleiche('Deals mit gleicher Kalkulation (GIK, Gewinn Auf./Glob.)', deals.length, gleich);
  if (abweichend.length) p[p.length - 1]!.name += ` · z. B. ${abweichend.slice(0, 2).join('; ')}`;

  // Kundenkalkulationen: Anzahl und Ergebnis (GIK, Vermögenszuwachs, IRR) alt vs. neu
  const dealIdsAlt = new Set(deals.map((d) => text(d.id)));
  const kkAlt = liste(kv['immo-kundenkalkulationen']).filter((k) => text(k.id) && dealIdsAlt.has(text(k.dealId)) && istObjekt(k.inputs));
  const kkNeu = new Map((await tx.select({ id: schema.kundenkalkulationen.id, inputs: schema.kundenkalkulationen.inputs }).from(schema.kundenkalkulationen)).map((k) => [k.id, k.inputs]));
  vergleiche('Kundenkalkulationen', kkAlt.length, kkNeu.size);
  const kennzahl = (i: unknown) => {
    const o = computeKKalk(i as KKalkInputs);
    return JSON.stringify([o.investition.gik, o.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs, o.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR]);
  };
  vergleiche('Kundenkalkulationen mit gleichem Ergebnis (GIK, Vermögenszuwachs, IRR)', kkAlt.length,
    kkAlt.filter((k) => kkNeu.has(text(k.id)!) && kennzahl(k.inputs) === kennzahl(kkNeu.get(text(k.id)!))).length);

  // Bank-Präsentationen und Folien (nur zu vorhandenen Deals), Folieninhalt unverändert
  const praesAlt = liste(kv['immo-finanzpraes']).filter((pr) => text(pr.id) && dealIdsAlt.has(text(pr.dealId)));
  vergleiche('Bank-Präsentationen', praesAlt.length, await anzahl(schema.finanzpraesentationen));
  vergleiche('Präsentationsfolien', praesAlt.reduce((a, pr) => a + liste(pr.slides).length, 0), await anzahl(schema.praesentationFolien));
  const folienNeu = await tx.select({ daten: schema.praesentationFolien.daten }).from(schema.praesentationFolien);
  const altInhalte = praesAlt.flatMap((pr) => liste(pr.slides).map((f) => kanonisch(istObjekt(f.data) ? f.data : {}))).sort();
  const neuInhalte = folienNeu.map((f) => kanonisch(f.daten ?? {})).sort();
  vergleiche('Präsentationsfolien mit gleichem Inhalt', altInhalte.length, altInhalte.filter((x, i) => x === neuInhalte[i]).length);
  if (kv['immo-finanzpraes-defaults'] !== undefined && kv['immo-finanzpraes-defaults'] !== null) {
    const [z] = await tx.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, FINANZPRAES_STANDARD_SCHLUESSEL));
    vergleiche('Präsentations-Standards (Bilder als Platzhalter)', 1, z && kanonisch(z.wert) === kanonisch(finanzpraesStandardUmformen(kv['immo-finanzpraes-defaults'])) ? 1 : 0);
  }

  // Begleitscheine: Anzahl (mit Objekt), Zeileninhalt unverändert, Vorlagen, Aktionen, Vordrucke
  const objektIdsBs = new Set((await tx.select({ id: schema.objekte.id }).from(schema.objekte)).map((o) => o.id));
  const bsAlt = liste(kv['immo-begleitscheine']).filter((b) => text(b.id) && objektIdsBs.has(text(b.objektId)!));
  vergleiche('Begleitscheine', bsAlt.length, await anzahl(schema.begleitscheine));
  const bsNeu = await tx.select({ zeilen: schema.begleitscheine.zeilen }).from(schema.begleitscheine);
  const bsAltInhalt = bsAlt.map((b) => kanonisch(Array.isArray(b.rows) ? b.rows : [])).sort();
  const bsNeuInhalt = bsNeu.map((b) => kanonisch(b.zeilen ?? [])).sort();
  vergleiche('Begleitscheine mit gleichen Punkten (Text, Status, Unterpunkte)', bsAltInhalt.length, bsAltInhalt.filter((x, i) => x === bsNeuInhalt[i]).length);
  let vorlagenGleich = 0;
  for (const typ of BS_TYPEN) {
    const [v] = await tx.select().from(schema.begleitscheinVorlagen).where(eq(schema.begleitscheinVorlagen.typ, typ));
    const alt = bsVorlageAlt(kv, typ);
    if (v && v.kopf === alt.kopf && kanonisch(v.zeilen) === kanonisch(alt.rows)) vorlagenGleich++;
  }
  vergleiche('Begleitschein-Vorlagen (Ankauf, Verkauf)', BS_TYPEN.length, vorlagenGleich);
  vergleiche('Begleitschein-Aktionen', BS_TYPEN.reduce((a, t) => a + bsAktionenAlt(kv, t).length, 0), await anzahl(schema.begleitscheinAktionen));
  vergleiche('Vordrucke', liste(kv['immo-bs-vordrucke']).filter((v) => text(v.id)).length, await anzahl(schema.vordrucke));

  // Vertriebslisten: Anzahl, Zeilen, Zelleninhalt
  const vlAlt = liste(kv['immo-vertriebslisten']).filter((v) => text(v.id) && dealIdsAlt.has(text(v.dealId)));
  vergleiche('Vertriebslisten', vlAlt.length, await anzahl(schema.vertriebslisten));
  vergleiche('Vertriebslisten-Zeilen', vlAlt.reduce((a, v) => a + liste(v.rows).length, 0), await anzahl(schema.vertriebslisteZeilen));
  const vlZeilenNeu = (await tx.select({ daten: schema.vertriebslisteZeilen.daten }).from(schema.vertriebslisteZeilen))
    .map((r) => { const { _einheitIdAlt: _x, ...rest } = (r.daten ?? {}) as Record<string, unknown>; return kanonisch(rest); }).sort();
  const vlZeilenAlt = vlAlt.flatMap((v) => liste(v.rows).map((r) => kanonisch(istObjekt(r.data) ? r.data : {}))).sort();
  vergleiche('Vertriebslisten-Zeilen mit gleichen Zellen', vlZeilenAlt.length, vlZeilenAlt.filter((x, i) => x === vlZeilenNeu[i]).length);

  // Projektmanagement: Anzahl je Ebene, Checklisteninhalt, Zahlen der Finanzleiste
  const projAlt = liste(kv['immo-projekte']).filter((p) => text(p.id));
  vergleiche('Projekte', projAlt.length, await anzahl(schema.projekte));
  vergleiche('Projekte im Papierkorb', projAlt.filter((p) => p._deleted).length,
    (await tx.select({ n: count() }).from(schema.projekte).where(isNotNull(schema.projekte.deletedAt)))[0]!.n);
  const pmEinhAlt = projAlt.flatMap((p) => liste(p.einheiten));
  vergleiche('Projekt-Einheiten', pmEinhAlt.length, await anzahl(schema.projektEinheiten));
  vergleiche('Mietergespräche', pmEinhAlt.reduce((a, e) => a + liste(e.mieterHistorie).length, 0), await anzahl(schema.projektMieterhistorie));
  vergleiche('Gebäude-Maßnahmen (PIP)', projAlt.reduce((a, p) => a + liste(p.gebPIP).length, 0), await anzahl(schema.projektGebaeudeMassnahmen));
  const pmAufgabenAlt = projAlt.flatMap((p) => liste(p.todos).map((t) => kanonisch([t.cat ?? null, t.text ?? null, text(t.status) ?? (t.done ? 'erledigt' : 'offen'), t.kommentar || null, t.verantwortlich || null, text(t.faellig)]))).sort();
  const pmAufgabenNeu = (await tx.select().from(schema.projektAufgaben)).map((t) => kanonisch([t.kategorie, t.text, t.status, t.kommentar || null, t.verantwortlich || null, t.faellig])).sort();
  vergleiche('Checklisten-Punkte', pmAufgabenAlt.length, await anzahl(schema.projektAufgaben));
  vergleiche('Checklisten-Punkte mit gleichem Inhalt', pmAufgabenAlt.length, pmAufgabenAlt.filter((x, i) => x === pmAufgabenNeu[i]).length);
  vergleiche('Summe Ziel-VKP Projekte (€)', projAlt.reduce((a, p) => a + parseNumAlt(p.zielVKP), 0), await summeSql(sql`(select sum(${schema.projekte.zielVkp}) from ${schema.projekte})`));
  vergleiche('Summe Ist-KP Projekt-Einheiten (€)', pmEinhAlt.reduce((a, e) => a + parseNumAlt(e.istKP), 0), await summeSql(sql`(select sum(${schema.projektEinheiten.istKp}) from ${schema.projektEinheiten})`));

  // Gespeicherte Filter: ohne exakte Doppel, Kriterien gleich
  const filterAlt = new Map<string, string>();
  for (const f of liste(kv['immo-saved-filters'])) {
    if (!text(f.id) || !FILTER_MODULE.includes(text(f.module) ?? '')) continue;
    const k = kanonisch([f.module, f.name ?? '', Array.isArray(f.criteria) ? f.criteria : []]);
    if (!filterAlt.has(k)) filterAlt.set(k, k);
  }
  const filterNeu = new Set((await tx.select().from(schema.gespeicherteFilter)).map((f) => kanonisch([f.modul, f.name ?? '', f.kriterien ?? []])));
  vergleiche('Gespeicherte Filter (ohne exakte Doppel)', filterAlt.size, await anzahl(schema.gespeicherteFilter));
  vergleiche('Gespeicherte Filter mit gleichen Kriterien', filterAlt.size, [...filterAlt.keys()].filter((k) => filterNeu.has(k)).length);

  const vorlagenAlt = liste(kv['immo-vorlagen']);
  const vorlagenNeu = (await tx.select().from(schema.textvorlagen).orderBy(asc(schema.textvorlagen.sort))).map((v) => kanonisch([v.name, v.kanal, v.betreff ?? '', v.text]));
  vergleiche('Textvorlagen mit gleichem Inhalt', vorlagenAlt.length,
    vorlagenAlt.filter((v, i) => kanonisch([v.name ?? '', text(v.kanal) ?? 'email', typeof v.betreff === 'string' ? v.betreff : '', v.text ?? '']) === vorlagenNeu[i]).length);

  // Objektfotos: gültige Quellzeilen (mit ID und vorhandenem Objekt) gegen Ziel
  const objektIdsZiel = new Set((await tx.select({ id: schema.objekte.id }).from(schema.objekte)).map((o) => o.id));
  vergleiche('Objektfotos (Metadaten)',
    liste(kv[FOTO_TABELLE]).filter((f) => text(f.id) && objektIdsZiel.has(text(f.obj_id)!)).length,
    await anzahl(schema.objektFotos));

  const dealIdsZiel = new Set((await tx.select({ id: schema.deals.id }).from(schema.deals)).map((d) => d.id));
  vergleiche('Deal-Dokumente (Metadaten)',
    liste(kv[DOKUMENT_TABELLE]).filter((f) => text(f.id) && typeof f.original_name === 'string' && dealIdsZiel.has(text(f.deal_id)!)).length,
    await anzahl(schema.dealDokumente));

  // DD-Dokumentenliste: gleiche Zeilen in gleicher Reihenfolge
  const ddAlt = liste(kv['immo-dd-template']).map((d) => [text(d.dokument), text(d.quelle)]);
  const ddNeu = (await tx.select().from(schema.ddChecklisteVorlage).orderBy(asc(schema.ddChecklisteVorlage.sort))).map((d) => [d.dokument, d.quelle]);
  vergleiche('DD-Dokumentenliste (Zeilen)', ddAlt.length, ddNeu.length);
  vergleiche('DD-Dokumentenliste mit gleichem Inhalt und gleicher Reihenfolge', ddAlt.length, ddAlt.filter((d, i) => kanonisch(d) === kanonisch(ddNeu[i])).length);

  // Einstellungen
  const einstellungenAlt = Object.keys(EINSTELLUNGEN).filter((s) => kv[s] !== undefined && kv[s] !== null && kv[s] !== '');
  let einstellungenGleich = 0;
  for (const s of einstellungenAlt) {
    const [z] = await tx.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, EINSTELLUNGEN[s]!));
    if (z && kanonisch(z.wert) === kanonisch(kv[s])) einstellungenGleich++;
  }
  vergleiche('Einstellungen (Kalkulation, Kundenkalkulation, Hinweise, Disclaimer, Angebots-Kennungen)', einstellungenAlt.length, einstellungenGleich);

  return p;
}

export function befundeGruppieren(befunde: Befund[]): Bericht['befundeJeArt'] {
  const g: Bericht['befundeJeArt'] = {};
  for (const b of befunde) {
    const e = (g[b.art] ??= { schwere: b.schwere, anzahl: 0, beispiele: [] });
    e.anzahl++;
    if (e.beispiele.length < 5) e.beispiele.push(b);
  }
  return g;
}

export function berichtText(b: Bericht): string {
  const zeilen = [
    `Umzug ${b.trocken ? '(Probelauf, nichts gespeichert)' : b.geschrieben ? '(gespeichert)' : '(zurückgerollt)'} · ${b.zeitpunkt}`,
    '',
    'Prüfung'.padEnd(52) + 'alt'.padStart(14) + 'neu'.padStart(14) + '  ',
    ...b.pruefungen.map((p) => `${p.name.padEnd(52)}${String(p.quelle).padStart(14)}${String(p.ziel).padStart(14)}  ${p.ok ? '✓' : '✗'}`),
    '',
  ];
  const arten = Object.entries(b.befundeJeArt);
  zeilen.push(arten.length ? 'Befunde:' : 'Befunde: keine');
  for (const [art, e] of arten) {
    zeilen.push(`  [${e.schwere}] ${art}: ${e.anzahl}`);
    for (const x of e.beispiele.slice(0, 3)) {
      zeilen.push(`      ${x.entitaet}/${x.id}${x.feld ? `.${x.feld}` : ''}: ${x.hinweis}${x.wert !== undefined ? ` (${JSON.stringify(x.wert)})` : ''}`);
    }
  }
  const unbekannt = Object.entries(b.unbekannteFelder);
  if (unbekannt.length) {
    zeilen.push('', 'Unbekannte Felder (nicht übernommen, bitte prüfen):');
    for (const [ent, felder] of unbekannt) zeilen.push(`  ${ent}: ${Object.entries(felder).map(([f, n]) => `${f} (${n})`).join(', ')}`);
  }
  const offen = Object.entries(b.nochNichtUmgezogen);
  if (offen.length) {
    zeilen.push('', 'Noch nicht umgezogen (spätere Etappen):');
    zeilen.push(`  ${offen.map(([k, n]) => `${k}: ${n}`).join(' · ')}`);
  }
  zeilen.push('', b.ok ? 'ERGEBNIS: alle Prüfungen bestanden ✓' : 'ERGEBNIS: Abweichungen oder Fehler ✗');
  return zeilen.join('\n');
}
