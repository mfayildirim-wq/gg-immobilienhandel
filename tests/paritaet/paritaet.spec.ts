/**
 * Parallelprüfung: dieselben Daten in der alten App und (per Umzug) im Neubau — zeigen beide fachlich dasselbe?
 * Voraussetzung: alte App läuft (../gg-immohandel: npm run dev → 5173/3001), Neubau läuft (pnpm dev → 5273/3101).
 * Start: pnpm paritaet. Ergebnis: berichte/paritaet/bericht.md
 */
import { expect, test } from '@playwright/test';
import { DEAL_STATUS } from '@gg/domain';
import type { ListenModul } from './alt.ts';
import { altBankgespraech, altBegleitschein, altCockpit, altVertriebsliste, altKalkulation, altOeffnen, altPraesentation, altProjekt, altProjektAnlegen, altProjektKarten, altListe, altCockpitGefiltert, altDealInfo, altMaklerDetail, altMailAuswahl, altKalkWerkzeug, type KalkAktion, altVarianten, altSuche, altObjektDetail, altPapierkorb, altDubletten } from './alt.ts';
import { PARITAET_IDS } from './datenbestand.ts';
import { neuBankgespraech, neuBegleitschein, neuCockpit, neuVertriebsliste, neuKalkulation, neuPraesentation, neuProjekt, neuProjektAnlegen, neuProjektKarten, neuListe, neuCockpitGefiltert, neuDealInfo, neuMaklerDetail, neuMailAuswahl, neuKalkWerkzeug, neuVarianten, neuSuche, neuObjektDetail, neuPapierkorb, neuDubletten } from './neu.ts';
import { protokoll, zahl } from './vergleich.ts';

/** Alte Element-ID(s) → Kennzahl im Neubau. Mehrere IDs werden addiert (neu zeigt Sanierung + Puffer als eine Zeile). */
const KALKULATION: [string[], string][] = [
  [['ha-kp'], 'kaufpreis'], [['ha-notar'], 'notar'], [['ha-gest'], 'grunderwerbsteuer'], [['ha-makler'], 'makler'], [['ha-zs1'], 'anschaffungskosten'],
  [['r-kpm2-kp'], 'kaufpreis-m2'], [['r-rendite-kp'], 'rendite-kp'], [['ha-miet'], 'mietabzug'],
  [['ha-san-netto', 'ha-san-puffer'], 'aufteiler.sanierung'], [['ha-vprov'], 'aufteiler.vertriebsprovision'], [['dk-aufk'], 'aufteiler.teilungskosten'],
  [['ha-fkz'], 'aufteiler.fkz'], [['ha-bankabgeb'], 'aufteiler.bankabgeb'], [['ha-ekk'], 'aufteiler.ekk'], [['ha-gik'], 'aufteiler.gik'],
  [['r-avkp'], 'aufteiler.verkaufspreis'], [['r-agew'], 'aufteiler.gewinn'], [['r-amarge'], 'aufteiler.marge'],
  [['hg-san-netto', 'hg-san-puffer'], 'global.sanierung'], [['hg-fkz'], 'global.fkz'], [['hg-bankabgeb'], 'global.bankabgeb'], [['hg-ekk'], 'global.ekk'],
  [['hg-gik'], 'global.gik'], [['r-gvkp'], 'global.verkaufspreis'], [['r-ggew'], 'global.gewinn'], [['r-gmarge'], 'global.marge'],
];

test('Ankaufskalkulation: jede Kennzahl je Deal gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Ankaufskalkulation');
  for (const dealId of PARITAET_IDS.deals) {
    const a = await altKalkulation(alt, dealId);
    if (dealId === 'par-d1') expect(zahl(a['ha-gik']), 'alte GIK leer').toBeGreaterThan(1_000_000);
    const n = await neuKalkulation(neu, dealId);
    for (const [ids, key] of KALKULATION) {
      const altWert = ids.length === 1 ? a[ids[0]!]! : String(ids.reduce((s, id) => s + Number(String(a[id] ?? '').replace(/[^\d-]/g, '') || 0), 0));
      expect(n[key], `${dealId}: Kennzahl ${key} fehlt im Neubau`).toBeDefined();
      for (const id of ids) expect(a[id], `${dealId}: Anzeige ${id} fehlt in der alten App`).toBeDefined();
      p.zahl(dealId, `${ids.join('+')} ↔ ${key}`, altWert ?? '', n[key]!, key.endsWith('marge') || key === 'rendite-kp' ? 0.051 : 1);
    }
    // Faktor und Kaufpreisrendite Global stehen neu in einer Zeile
    const [faktor, rendite] = (n['global.faktor'] ?? '').split('·');
    p.zahl(dealId, 'r-gfak ↔ global.faktor', a['r-gfak'] ?? '', faktor ?? '', 0.051);
    p.zahl(dealId, 'r-gkr ↔ global.faktor (Rendite)', a['r-gkr'] ?? '', rendite ?? '', 0.0051);
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen, null, 1)).toEqual([]);
});

test('Kundenkalkulation: Bankgespräch-Vorschau textgleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Bankgespräch');
  for (const id of PARITAET_IDS.kundenkalkulationen) {
    const a = await altBankgespraech(alt, id);
    expect(a.length, `${id}: alte Vorschau leer`).toBeGreaterThan(500);
    p.text(id, 'Vorschau (gesamter Text)', a, await neuBankgespraech(neu, id));
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen, null, 1)).toEqual([]);
});

test('Bank-Präsentation: Live-Vorschau je Folie textgleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const { id, dealId, folien } = PARITAET_IDS.praesentation;
  const a = await altPraesentation(alt, dealId, folien);
  const n = await neuPraesentation(neu, id, folien);
  const p = protokoll('Bank-Präsentation');
  for (const f of folien) {
    expect((a[f] ?? '').length, `${f}: alte Folienvorschau leer`).toBeGreaterThan(5);
    p.text(f, 'Folienvorschau', a[f] ?? '', n[f] ?? '');
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen, null, 1)).toEqual([]);
});

test('Begleitschein: Name, Kopf, Zähler und jede Zeile gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const a = await altBegleitschein(alt, PARITAET_IDS.begleitschein);
  const n = await neuBegleitschein(neu, PARITAET_IDS.begleitschein);
  const p = protokoll('Begleitschein');
  p.text('Kopf', 'Name', a.name, n.name);
  p.text('Kopf', 'Kopfbereich', a.kopf, n.kopf);
  for (const k of ['Summe', 'Offen', 'In Progress', 'Erledigt']) p.zahl('Zähler', k, a.zaehler[k] ?? '', n.zaehler[k] ?? '', 0);
  p.zahl('Zeilen', 'Anzahl', String(a.zeilen.length), String(n.zeilen.length), 0);
  a.zeilen.forEach((z, i) => {
    const m = n.zeilen[i];
    const was = `Zeile ${i + 1}`;
    p.text(was, 'Text', z.text, m?.text ?? '');
    p.text(was, 'Verantwortung', z.verantwortung, m?.verantwortung ?? '');
    p.text(was, 'Status', z.status, m?.status ?? '');
    p.text(was, 'Aktionen', z.aktionen.join(' | '), (m?.aktionen ?? []).join(' | '));
    p.text(was, 'Unterpunkte', z.sub.map((s) => `${s.text}=${s.status}`).join(' | '), (m?.sub ?? []).map((s) => `${s.text}=${s.status}`).join(' | '));
  });
  expect(a.zeilen.length, 'alte Arbeitsfläche ohne Zeilen').toBeGreaterThan(50);
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 20), null, 1)).toEqual([]);
});

test('Ankauf-Cockpit: gleiche Karten mit gleicher Fälligkeit und letztem Kontakt', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const a = await altCockpit(alt);
  const n = await neuCockpit(neu);
  const p = protokoll('Ankauf-Cockpit');
  const nurPruefbestand = (k: string) => k.includes(':par-');
  p.text('Karten', 'sichtbare Karten (Prüfbestand)', Object.keys(a).filter(nurPruefbestand).sort().join(', '), Object.keys(n).filter(nurPruefbestand).sort().join(', '));
  for (const k of Object.keys(a).filter(nurPruefbestand)) {
    if (!n[k]) continue;
    p.text(k, 'Fälligkeitsklasse', a[k]!.klasse, n[k]!.klasse);
    p.text(k, 'Fälligkeitstext', a[k]!.label, n[k]!.label);
    p.text(k, 'Zuletzt', a[k]!.zuletzt, n[k]!.zuletzt);
  }
  expect(Object.keys(a).filter(nurPruefbestand).length, 'alte App zeigt keine Karten aus dem Prüfbestand').toBeGreaterThan(3);
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen, null, 1)).toEqual([]);
});

test('Vertriebslisten: Übersicht, Spalten und jede Zelle einschließlich berechneter Werte gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const a = await altVertriebsliste(alt, PARITAET_IDS.vertriebsliste);
  const n = await neuVertriebsliste(neu, PARITAET_IDS.vertriebsliste);
  const p = protokoll('Vertriebslisten');
  const nurPruefbestand = (zeilen: string[][]) => zeilen.filter((z) => /Vergleichsstraße|Globalallee|Paritätsweg/.test(z[0] ?? '')).map((z) => z.join(' | ')).sort();
  expect(nurPruefbestand(a.uebersicht), 'alte Übersicht ohne Prüfbestand').toHaveLength(2);
  p.text('Übersicht', 'Zeilen (Prüfbestand)', nurPruefbestand(a.uebersicht).join(' ‖ '), nurPruefbestand(n.uebersicht).join(' ‖ '));
  p.text('Liste', 'Kopfleiste', a.leiste, n.leiste);
  p.text('Liste', 'sichtbare Spalten', a.titel.join(' | '), n.titel.join(' | '));
  expect(a.zeilen.length, 'alte Tabelle ohne Zeilen').toBe(5);
  a.zeilen.forEach((z, i) => z.forEach((wert, j) => p.text(`Zeile ${i + 1}`, a.titel[j] ?? `Spalte ${j + 1}`, wert, n.zeilen[i]?.[j] ?? '(fehlt)')));
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 30), null, 1)).toEqual([]);
});

test('Projektmanagement: Karten, Checkliste je Filter, Einheitenliste, Finanzleiste, Globalverkauf, Mietergespräche und Anlegen aus Deal gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const { id, anlegenAusDeal } = PARITAET_IDS.projekt;
  const a = await altProjekt(alt, id, 'pe1');
  const n = await neuProjekt(neu, id, 'EG links');
  const p = protokoll('Projektmanagement');
  expect(a.karten.length, 'alte Übersicht ohne Projekt (Papierkorb darf fehlen)').toBe(1);
  p.text('Übersicht', 'Karten', a.karten.map((k) => k.join(' | ')).join(' ‖ '), n.karten.map((k) => k.join(' | ')).join(' ‖ '));
  for (const [filter, sicht] of Object.entries(a.checkliste)) {
    p.text(`Checkliste ${filter}`, 'Zähler', sicht.zaehler.join(' | '), n.checkliste[filter]?.zaehler.join(' | ') ?? '(fehlt)');
    expect(sicht.zeilen.length, `alte Checkliste ${filter} leer`).toBeGreaterThan(0);
    const neuZeilen = n.checkliste[filter]?.zeilen ?? [];
    p.text(`Checkliste ${filter}`, 'Zeilenzahl', String(sicht.zeilen.length), String(neuZeilen.length));
    sicht.zeilen.forEach((z, i) => p.text(`Checkliste ${filter}`, `Zeile ${i + 1}`, z.join(' | '), neuZeilen[i]?.join(' | ') ?? '(fehlt)'));
  }
  expect(a.einheiten.length, 'alte Einheitenliste leer').toBe(4);
  a.einheiten.forEach((z, i) => z.forEach((wert, j) => p.text(`Einheit ${i + 1}`, `Spalte ${j + 1}`, wert, n.einheiten[i]?.[j] ?? '(fehlt)')));
  p.text('Einheitenliste', 'Summenzeile', a.summen.join(' | '), n.summen.join(' | '));
  p.text('Einheitenliste', 'Finanzleiste', a.finanzleiste.join(' | '), n.finanzleiste.join(' | '));
  p.text('Einheitenliste', 'Globalverkauf', a.global.join(' | '), n.global.join(' | '));
  p.text('Einheitenliste', 'Gebäude-PIP', a.gebaeude.join(' | '), n.gebaeude.join(' | '));
  p.text('Einheit 1', 'Mietergespräche', a.gespraeche.join(' ‖ '), n.gespraeche.join(' ‖ '));

  // Anlegen aus dem angekauften Deal: Auswahl, Vorbelegung, Einheiten, Ziel-VKP, Checkliste
  const aa = await altProjektAnlegen(alt, anlegenAusDeal) as { auswahl: string[]; vorbelegung: string[]; projekt: Record<string, unknown> & { einheiten: Record<string, unknown>[]; todos: Record<string, unknown>[] } };
  const na = await neuProjektAnlegen(neu, anlegenAusDeal);
  p.text('Anlegen', 'Deal-Auswahl', aa.auswahl.join(' | '), na.auswahl.join(' | '));
  p.text('Anlegen', 'Vorbelegung Adresse/Stadt', aa.vorbelegung.join(' | '), na.vorbelegung.join(' | '));
  expect(aa.projekt, 'altes Projekt nicht angelegt').toBeTruthy();
  p.zahl('Anlegen', 'Ziel-VKP', String(aa.projekt.zielVKP), String(na.projekt.zielVKP), 0);
  const einheit = (e: Record<string, unknown>) => ['typ', 'lage', 'zimmer', 'fl', 'kaltmiete', 'kmMoeglich', 'zielKP', 'istKP', 'vstatus'].map((k) => String(e[k] ?? '')).join(' | ');
  p.text('Anlegen', 'Einheiten', aa.projekt.einheiten.map(einheit).join(' ‖ '), na.projekt.einheiten.map(einheit).join(' ‖ '));
  const todo = (t: Record<string, unknown>) => [t.cat, t.text, t.status, t.verantwortlich].join(' | ');
  p.text('Anlegen', 'Checkliste', aa.projekt.todos.map(todo).join(' ‖ '), na.projekt.todos.map(todo).join(' ‖ '));
  p.text('Übersicht nach Anlegen', 'Karten', (await altProjektKarten(alt)).map((k) => k.join(' | ')).join(' ‖ '), (await neuProjektKarten(neu)).map((k) => k.join(' | ')).join(' ‖ '));

  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 30), null, 1)).toEqual([]);
});

test('Listen Deals/Objekte/Makler und gespeicherte Filter: Zähler, Auswahl, jede Zeile je Filter/Chip/Suche gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Listen und Filter');
  const faelle: [ListenModul, { chip: string; suche: string; filterId: string }][] = [];
  for (const modul of ['deals', 'objects', 'makler'] as const) {
    const chips = modul === 'makler' ? ['alle', 'A', 'B'] : ['alle', 'In Prüfung', 'Archiv'];
    faelle.push([modul, { chip: 'alle', suche: '', filterId: '' }], [modul, { chip: chips[1]!, suche: '', filterId: '' }], [modul, { chip: 'alle', suche: modul === 'makler' ? 'o' : 'str', filterId: '' }]);
    for (const f of PARITAET_IDS.filter.filter((x) => x.module === modul)) faelle.push([modul, { chip: 'alle', suche: '', filterId: f.id }]);
  }
  // Zeilen: [id, Zellen…]
  // Bewusste Korrektur der Anzeige: Objekt ohne Status zeigte alt „undefined“ (neu leer)
  const korrigiereAlt = (modul: ListenModul, z: string[]) =>
    modul === 'objects' ? z.map((c, i) => (i === z.length - 1 && c === 'undefined' ? '' : c)) : z;
  const zeile = (modul: ListenModul, z: string[], seite: 'alt' | 'neu') => (seite === 'alt' ? korrigiereAlt(modul, z) : z).join(' | ');
  // Bewusste Korrektur des Umzugs: unbekannter Deal-Status („Verhandlung“, „Absage“) → „In Prüfung“ (Befund im Umzugsbericht).
  // Diese Deals fehlen alt in den Zählern und stehen hinten; im Vergleich bleiben sie außen vor.
  const korrigiert = new Set(PARITAET_IDS.deals.filter((id) => !DEAL_STATUS.includes(PARITAET_IDS.dealStatus[id] as never)));
  let zeilenGeprueft = 0;
  for (const [modul, zustand] of faelle) {
    const a = await altListe(alt, modul, zustand);
    const n = await neuListe(neu, modul, zustand);
    const name = `${modul} ${JSON.stringify(zustand)}`;
    const ohne = (zeilen: string[][]) => (modul === 'deals' ? zeilen.filter((z) => !korrigiert.has(z[0]!)) : zeilen);
    const neuZaehler = modul === 'deals'
      ? n.zaehler.map((x) => (x.startsWith('In Prüfung=') ? `In Prüfung=${Number(x.split('=')[1]) - korrigiert.size}` : x))
      : n.zaehler;
    p.text(name, 'Zähler', a.zaehler.join(' | '), neuZaehler.join(' | '));
    p.text(name, 'Filterauswahl', a.filter.join(' | '), n.filter.join(' | '));
    p.text(name, 'aktiver Filter', a.aktiv, n.aktiv);
    const az = ohne(a.zeilen);
    const nz = ohne(n.zeilen);
    p.text(name, 'Zeilenzahl', String(az.length), String(nz.length));
    az.forEach((z, i) => p.text(name, `Zeile ${i + 1}`, zeile(modul, z, 'alt'), nz[i] ? zeile(modul, nz[i]!, 'neu') : '(fehlt)'));
    zeilenGeprueft += az.length;
  }
  expect(zeilenGeprueft, 'alte Listen ohne Zeilen').toBeGreaterThan(40);
  for (const f of PARITAET_IDS.filter.filter((x) => x.module === 'ankauf')) {
    p.text('Ankauf-Cockpit', `Karten mit „${f.name}“`, (await altCockpitGefiltert(alt, f.id)).join(', '), (await neuCockpitGefiltert(neu, f.id)).join(', '));
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 30), null, 1)).toEqual([]);
});

test('Deal-Info: Verknüpfung, Status, Angebotsdatum, Frequenz, Termin, Makler-Mail und Gesprächslog je Deal gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Deal-Info');
  for (const id of PARITAET_IDS.deals.filter((x) => DEAL_STATUS.includes(PARITAET_IDS.dealStatus[x] as never))) {
    const a = await altDealInfo(alt, id);
    const n = await neuDealInfo(neu, id);
    // Bewusste Korrektur: ohne gespeichertes Angebotsdatum zeigte alt das heutige Datum, ohne Frequenz „Täglich“ (erste Option),
    // obwohl das Cockpit mit „Wöchentlich“ rechnet — der Neubau zeigt, was gilt
    const roh = PARITAET_IDS.dealRoh[id]!;
    if (!roh.angebotsDatum) a.angebotsDatum = '';
    if (!roh.nachfassFreq) a.frequenz = 'Wöchentlich';
    for (const k of ['objekt', 'makler', 'status', 'angebotsDatum', 'frequenz', 'naechsterKontakt', 'mail'] as const) p.text(id, k, a[k], n[k]);
    p.text(id, 'Gesprächslog (Anzahl)', String(a.log.length), String(n.log.length));
    a.log.forEach((e, i) => { p.text(id, `Eintrag ${i + 1} Text`, e.text, n.log[i]?.text ?? '(fehlt)'); p.text(id, `Eintrag ${i + 1} Zeit`, e.ts, n.log[i]?.ts ?? '(fehlt)'); });
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Makler-Detail: Profil, Kommunikationsverlauf, KI-Zusammenfassung, Beziehungsprofil, Anrede, Erwähnungen, Geburtstag, Deals je Makler gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Makler-Detail');
  for (const id of ['par-m1', 'par-m2', 'par-m3', 'par-m4']) {
    const a = await altMaklerDetail(alt, id);
    const n = await neuMaklerDetail(neu, id);
    if (id === 'par-m1') {
      expect(a.komm.verlauf.length, 'alter Verlauf leer').toBe(3);
      expect(a.komm.zusammenfassung, 'alte Zusammenfassung leer').toContain('Paula');
      expect(a.persoenlich.erwaehnungen.length, 'alte Erwähnungen leer').toBe(2);
      expect(a.profil.name).toBe('Paula Prüf');
    }
    for (const k of ['name', 'firma', 'tel', 'email', 'frequenz', 'zuletzt'] as const) p.text(id, `Profil ${k}`, a.profil[k], n.profil[k]);
    for (const k of ['zusammenfassung', 'zusammenfassungZeit', 'beziehung', 'anrede'] as const) p.text(id, k, a.komm[k], n.komm[k]);
    p.text(id, 'Verlauf (Anzahl)', String(a.komm.verlauf.length), String(n.komm.verlauf.length));
    a.komm.verlauf.forEach((e, i) => p.text(id, `Verlauf ${i + 1}`, JSON.stringify(e), JSON.stringify(n.komm.verlauf[i] ?? {})));
    p.text(id, 'Erwähnungen', a.persoenlich.erwaehnungen.join(' ‖ '), n.persoenlich.erwaehnungen.join(' ‖ '));
    p.text(id, 'Geburtstag', a.persoenlich.geburtstag, n.persoenlich.geburtstag);
    p.text(id, 'Deals', a.deals.karten.join(' ‖ '), n.deals.karten.join(' ‖ '));
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Mail-Vorlagen im Cockpit: gleiche Vorlagen mit gleichem Betreff und Text (mailto) je Deal- und Makler-Karte', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Mail-Vorlagen');
  const alte = { deal: await altMailAuswahl(alt, 'deal', 'par-d1'), makler: await altMailAuswahl(alt, 'makler', 'par-m1') };
  for (const [art, id] of [['deal', 'par-d1'], ['makler', 'par-m1']] as const) {
    const a = alte[art];
    expect(a.length, `alte Auswahl ${art} leer`).toBeGreaterThan(3);
    const n = await neuMailAuswahl(neu, art, id);
    p.text(`${art} ${id}`, 'Anzahl', String(a.length), String(n.length));
    a.forEach((e, i) => p.text(`${art} ${id}`, `Eintrag ${i + 1}`, e, n[i] ?? '(fehlt)'));
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 20), null, 1)).toEqual([]);
});

test('Kalkulation „Alle setzen“: Hinweis, KM SOLL, Rendite, VKP, KP/m² je Einheit und alle Kennzahlen gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Kalkulation Alle setzen');
  const aktionen: KalkAktion[] = [{ art: 'rendite', wert: '5.2' }, { art: 'rendite', wert: '' }, { art: 'kpm2', wert: '3.450' }, { art: 'miete', pct: 0 }, { art: 'miete', pct: 10 }, { art: 'miete', pct: 15 }];
  for (const dealId of ['par-d1', 'par-d2', 'par-d3']) {
    for (const aktion of aktionen) {
      const name = `${dealId} ${aktion.art}${'wert' in aktion ? ` „${aktion.wert}“` : ` ${aktion.pct}%`}`;
      const a = await altKalkWerkzeug(alt, dealId, aktion);
      const n = await neuKalkWerkzeug(neu, dealId, aktion);
      p.text(name, 'Hinweis', a.hinweis, n.hinweis);
      p.text(name, 'Einheiten (Anzahl)', String(a.zeilen.length), String(n.zeilen.length));
      a.zeilen.forEach((z, i) => {
        const m = n.zeilen[i];
        p.zahl(name, `Einheit ${i + 1} KM SOLL`, z.mieteSoll, m?.mieteSoll ?? '(fehlt)', 0.01);
        p.zahl(name, `Einheit ${i + 1} Rendite`, z.rendite, m?.rendite ?? '(fehlt)', 0.001);
        p.zahl(name, `Einheit ${i + 1} VKP`, z.vkp, m?.vkp ?? '(fehlt)', 0.5);
        p.zahl(name, `Einheit ${i + 1} KP/m²`, z.kpm2, m?.kpm2 ?? '(fehlt)', 0.5);
      });
      for (const [ids, key] of KALKULATION) {
        const altWert = ids.length === 1 ? a.kennzahlen[ids[0]!]! : String(ids.reduce((s, id) => s + Number(String(a.kennzahlen[id] ?? '').replace(/[^\d-]/g, '') || 0), 0));
        p.zahl(name, `${ids.join('+')} ↔ ${key}`, altWert ?? '', n.kennzahlen[key] ?? '(fehlt)', key.endsWith('marge') || key === 'rendite-kp' ? 0.051 : 1);
      }
    }
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Kalkulationsvarianten: Auswahlliste, Rückfrage, Hinweis und Kennzahlen nach dem Laden gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Kalkulationsvarianten');
  for (const [id, name] of [['v2', 'Nachverhandlung'], ['v1', 'Erstangebot']] as const) {
    const a = await altVarianten(alt, 'par-d1', id);
    const n = await neuVarianten(neu, 'par-d1', name);
    p.text(name, 'Auswahl', a.optionen.join(' | '), n.optionen.join(' | '));
    p.text(name, 'Anzahl', a.anzahl, n.anzahl);
    p.text(name, 'Rückfrage', a.rueckfrage, n.rueckfrage);
    p.text(name, 'Hinweis', a.hinweis, n.hinweis);
    p.text(name, 'Einheiten', String(a.einheiten), String(n.einheiten));
    for (const [ids, key] of KALKULATION) {
      const altWert = ids.length === 1 ? a.kennzahlen[ids[0]!]! : String(ids.reduce((s, x) => s + Number(String(a.kennzahlen[x] ?? '').replace(/[^\d-]/g, '') || 0), 0));
      p.zahl(name, `${ids.join('+')} ↔ ${key}`, altWert ?? '', n.kennzahlen[key] ?? '(fehlt)', key.endsWith('marge') || key === 'rendite-kp' ? 0.051 : 1);
    }
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Globale Suche: gleiche Bereiche und Trefferzeilen je Suchbegriff', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Globale Suche');
  for (const eingabe of ['p', 'parität', 'Vergleichs', 'stuttgart', 'ulm', '70173', '0711', 'makler', 'zzz']) {
    const a = await altSuche(alt, eingabe);
    const n = await neuSuche(neu, eingabe);
    p.text(`„${eingabe}"`, 'Zeilen (Anzahl)', String(a.length), String(n.length));
    a.forEach((z, i) => p.text(`„${eingabe}"`, `Zeile ${i + 1}`, z, n[i] ?? '(fehlt)'));
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Objekt-Detail: Status, Lage, Recherche-Links, Gebäude, Kennzahlen, Einheiten und Notizen je Objekt gleich', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Objekt-Detail');
  for (const id of ['par-o1', 'par-o2', 'par-o3']) {
    const a = await altObjektDetail(alt, id);
    const n = await neuObjektDetail(neu, id);
    // Ohne gespeicherten Status zeigte alt die erste Auswahl („In Prüfung“) — der Umzug setzt sie ebenso
    p.text(id, 'Status', a.status, n.status);
    p.text(id, 'Notizen', a.notizen, n.notizen);
    for (const k of ['lage', 'gebaeude', 'kennzahlen', 'einheiten', 'recherche'] as const) {
      p.text(id, `${k} (Zeilen)`, String(a[k].length), String(n[k].length));
      a[k].forEach((z, i) => p.text(id, `${k} ${i + 1}`, z, n[k][i] ?? '(fehlt)'));
    }
  }
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Papierkorb: gleiche Gruppen, Einträge und Restlaufzeiten', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Papierkorb');
  const a = await altPapierkorb(alt);
  const n = await neuPapierkorb(neu);
  // Der Neubau zeigt Überschrift und Hinweis oben; verglichen werden die Zeilen ab der ersten Gruppe
  const ab = (zeilen: string[]) => zeilen.slice(zeilen.findIndex((z) => /^(Objekte|Makler|Deals|Projekte|Vertriebslisten|Bank-Präsentationen|Kundenkalkulationen|Begleitscheine) \(\d+\)$/.test(z)));
  const ohneKnoepfe = (zeilen: string[]) => zeilen.filter((z) => !/^Papierkorb leeren|^Frist:/.test(z) && z !== '↩ Wiederherstellen' && z !== '✖ Endgültig');
  const altZeilen = ohneKnoepfe(ab(a));
  const neuZeilen = ohneKnoepfe(ab(n));
  p.text('Papierkorb', 'Zeilen (Anzahl)', String(altZeilen.length), String(neuZeilen.length));
  altZeilen.forEach((z, i) => p.text('Papierkorb', `Zeile ${i + 1}`, z, neuZeilen[i] ?? '(fehlt)'));
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 40), null, 1)).toEqual([]);
});

test('Dublettenprüfung: gleiche Paare mit gleicher Sicherheit und gleichem Grund', async ({ browser }) => {
  const alt = await browser.newPage();
  const neu = await browser.newPage();
  await altOeffnen(alt);
  const p = protokoll('Dublettenprüfung');
  const a = await altDubletten(alt);
  const n = await neuDubletten(neu);
  // Alte Zeile: „🤝 Makler | Exakt | Grund | A ↔ B | Vergleichen & Mergen | Ignorieren“ — verglichen werden Art, Sicherheit, Grund und Paar
  const kern = (z: string) => z.split(' | ').slice(0, 4).join(' | ')
    .replace('Vergleichen & Mergen', '').replace('Ignorieren', '').trim();
  p.text('Dubletten', 'Paare (Anzahl)', String(a.length), String(n.length));
  a.forEach((z, i) => p.text('Dubletten', `Paar ${i + 1}`, kern(z), kern(n[i] ?? '(fehlt)')));
  const e = p.abschluss();
  expect(e.abweichungen, JSON.stringify(e.abweichungen.slice(0, 20), null, 1)).toEqual([]);
});
