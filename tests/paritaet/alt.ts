/* Steuerung der ALTEN App (../gg-immohandel) — nur lesend über die Oberfläche, wie die alten E2E-Helfer (e2e/helpers/page.ts). */
import type { Page } from '@playwright/test';
import { ALT_WEB } from './umgebung.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

export async function altOeffnen(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('gg-pin-hash'); } catch { /* */ }
    try { sessionStorage.setItem('gg-update-suppress', '1'); } catch { /* */ }
  });
  await page.goto(ALT_WEB, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof (window as W).showPage === 'function', undefined, { timeout: 15_000 });
  // Wie gotoApp der alten App: KV vom Server in den lokalen Speicher, dann neu laden, damit die App mit dem Stand startet
  await page.evaluate(async () => {
    const data = await (await fetch('/api/kv')).json();
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof (window as W).dealOpenDetail === 'function');
}

async function dealReiter(page: Page, dealId: string, reiter: RegExp) {
  await page.evaluate((id) => (window as W).showPage('deals'), dealId);
  await page.evaluate((id) => (window as W).dealOpenDetail(id), dealId);
  await page.waitForSelector('#panel-tabs .ptab', { state: 'attached' });
  const index = await page.evaluate((quelle) => {
    const re = new RegExp(quelle);
    const tabs = [...document.querySelectorAll('#panel-tabs .ptab')];
    const i = tabs.findIndex((t) => re.test(t.textContent ?? ''));
    if (i >= 0) (window as W).switchPanelTab(i, tabs[i]);
    return i;
  }, reiter.source);
  if (index < 0) throw new Error(`Reiter ${reiter} im alten Deal-Panel nicht gefunden`);
}

/** Alle Anzeigewerte der Ankaufskalkulation (Element-ID → Text), wie dealKalkRC sie schreibt. */
export async function altKalkulation(page: Page, dealId: string): Promise<Record<string, string>> {
  await dealReiter(page, dealId, /^\s*\S*\s*Kalkulation\s*$/);
  await page.waitForSelector('#ha-gik', { state: 'attached' });
  await page.waitForTimeout(200);
  // Werte stehen teils in schreibgeschützten Feldern (V() schreibt dann `value`), Eingaben wie dk-aufk ebenso
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^="ha-"], [id^="hg-"], [id^="r-"], [id^="dk-"]')]
    .map((e) => [e.id, (e instanceof HTMLInputElement || e instanceof HTMLSelectElement ? e.value : e.textContent ?? '').trim()])));
}

/** Text der Bankgespräch-Vorschau im Kundenkalkulations-Editor. */
export async function altBankgespraech(page: Page, kkId: string): Promise<string> {
  await page.evaluate(() => (window as W).showPage('kkalk'));
  await page.evaluate((id) => (window as W).kkalkOpen(id), kkId);
  const pv = page.locator('#kkalk-overlay .bg-pv').first();
  await pv.waitFor();
  const t = await pv.innerText();
  await page.evaluate(() => document.getElementById('kkalk-overlay')?.remove());
  return t;
}

/** Text der Live-Vorschau je Folie der Bank-Präsentation. */
export async function altPraesentation(page: Page, dealId: string, folien: string[]): Promise<Record<string, string>> {
  await dealReiter(page, dealId, /Bank/);
  await page.waitForSelector('#fp-slide-list', { state: 'attached' });
  const aus: Record<string, string> = {};
  for (const id of folien) {
    await page.evaluate((f) => (window as W).finanzpraesSelectSlide(f), id);
    const wrap = page.locator('#fp-live-preview .fp-live-wrap');
    await wrap.waitFor({ state: 'attached' });
    aus[id] = await wrap.evaluate((e) => (e as HTMLElement).innerText);
  }
  return aus;
}

export interface BsZeileSicht { text: string; verantwortung: string; status: string; aktionen: string[]; sub: { text: string; status: string }[] }

/** Begleitschein: Zähler und alle Zeilen der Arbeitsfläche. */
export async function altBegleitschein(page: Page, id: string) {
  await page.evaluate(() => (window as W).showPage('begleitscheine'));
  await page.evaluate((b) => (window as W).bsOpen(b), id);
  await page.waitForSelector('#bs-root table tbody tr');
  return page.evaluate(() => {
    const zaehler = Object.fromEntries([...document.querySelectorAll('#bs-root div')]
      .filter((d) => d.children.length === 2 && ['Summe', 'Offen', 'In Progress', 'Erledigt'].includes(d.children[1]!.textContent ?? ''))
      .map((d) => [d.children[1]!.textContent, d.children[0]!.textContent]));
    const zeilen = [...document.querySelectorAll('#bs-root table tbody tr')].map((tr) => {
      const td = tr.querySelectorAll(':scope > td');
      return {
        text: (td[0]!.querySelector(':scope > div > div[contenteditable]') as HTMLElement).innerText.trim(),
        verantwortung: (td[1]!.textContent ?? '').trim(),
        status: (td[3]!.querySelector('select') as HTMLSelectElement).value,
        aktionen: [...td[2]!.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        sub: [...td[0]!.querySelectorAll('span[contenteditable]')].map((s) => ({
          text: (s.textContent ?? '').trim(),
          status: (s.parentElement!.querySelector('select') as HTMLSelectElement).value,
        })),
      };
    });
    return { name: document.querySelector('#bs-root h3')?.textContent?.trim() ?? '', kopf: (document.querySelector('#bs-root div[contenteditable]') as HTMLElement)?.innerText.trim() ?? '', zaehler, zeilen };
  });
}

export interface KartenSicht { klasse: string; label: string; zuletzt: string }

/** Ankauf-Cockpit (Seite „Ankauf“, vtRender): sichtbare Deal- und Makler-Karten mit Fälligkeit. */
export async function altCockpit(page: Page): Promise<Record<string, KartenSicht>> {
  await page.evaluate(() => (window as W).showPage('ankauf'));
  await page.waitForSelector('.vt-card', { state: 'attached' });
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.vt-card[id^="vtd-"], .vt-card[id^="vtm-"]')].map((k) => {
    const [label, zuletzt] = (k.querySelector('.vt-due')?.textContent ?? '').trim().split(' · Zuletzt: ');
    const art = k.id.startsWith('vtd-') ? 'deal' : 'makler';
    const klasse = [...k.classList].find((c) => c.endsWith('-card') && c !== 'vt-card')?.replace(/-card$/, '') ?? '';
    return [`${art}:${k.id.slice(4)}`, { klasse, label: (label ?? '').trim(), zuletzt: (zuletzt ?? '').trim() }];
  })));
}

/** Vertriebslisten: Übersicht (vlRenderList) und Tabelle einer Liste (vlOpen) mit allen sichtbaren Zellen. */
export async function altVertriebsliste(page: Page, id: string) {
  await page.evaluate(() => (window as W).showPage('vertriebslisten'));
  await page.waitForSelector('#vl-root table');
  const uebersicht = await page.evaluate(() => [...document.querySelectorAll('#vl-root tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
  const kopf = await page.evaluate(() => document.querySelector('#vl-root h3')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  await page.evaluate((v) => (window as W).vlOpen(v), id);
  const tabelle = page.locator('table.vl-table');
  await tabelle.waitFor();
  const inhalt = await tabelle.evaluate((tabelle) => {
    const titel = [...tabelle.querySelectorAll('thead th')].slice(1).map((th) => th.getAttribute('title') ?? '');
    const zeilen = [...tabelle.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll(':scope > td')].slice(1).map((td) => {
      const feld = td.querySelector('input, textarea, select');
      const punkte = [...td.querySelectorAll('.vl-ampel-dot, button[aria-pressed]')];
      if (punkte.length) {
        const an = punkte.find((p) => p.classList.contains('active') || p.getAttribute('aria-pressed') === 'true');
        return an ? (an.getAttribute('title') ?? an.getAttribute('aria-label')?.split(': ').pop() ?? '') : '';
      }
      if (feld instanceof HTMLInputElement && feld.type === 'checkbox') return feld.checked ? 'ja' : 'nein';
      if (feld) return (feld as HTMLInputElement).value;
      return (td.textContent ?? '').trim();
    }));
    return { titel, zeilen };
  });
  const leiste = await page.evaluate(() => [...document.querySelectorAll('#panel-body span')].map((s) => s.textContent?.replace(/\s+/g, ' ').trim() ?? '').find((t) => t.includes('Zeilen ·')) ?? '');
  return { kopf, uebersicht, leiste, ...inhalt };
}

/** Werte einer Tabellenzelle der Projektansicht: Felder (mit „ / “ verbunden), aktive Ampel oder Text. */
const PM_ZELLE = `(td) => {
  const ampel = [...td.querySelectorAll('[onclick*="pmSetPIP"], button[aria-pressed]')];
  if (ampel.length) return ampel.filter((a) => a.style.opacity === '1' || a.getAttribute('aria-pressed') === 'true').map((a) => a.textContent.trim()).join('');
  const felder = [...td.querySelectorAll('input, textarea, select')];
  if (felder.length) return felder.map((f) => f.value).join(' / ');
  return td.innerText.replace(/\\s+/g, ' ').trim();
}`;

export interface ProjektSicht {
  karten: string[][];
  checkliste: Record<string, { zaehler: string[]; zeilen: string[][] }>;
  einheiten: string[][];
  summen: string[];
  finanzleiste: string[];
  global: string[];
  gebaeude: string[];
  gespraeche: string[];
}

/** Projektmanagement (Seite pm): Karten, Checkliste je Filter, Einheitenliste, Finanzleiste, Globalverkauf, Mietergespräche. */
export async function altProjekt(page: Page, id: string, einheitMitGespraechen: string): Promise<ProjektSicht> {
  await page.evaluate(() => (window as W).showPage('pm'));
  await page.waitForSelector('#pm-content .pm-card');
  const karten = await altProjektKarten(page);
  await page.evaluate((p) => (window as W).pmOpenProject(p), id);
  await page.waitForSelector('#pm-todo-table');
  const checkliste: ProjektSicht['checkliste'] = {};
  for (const f of ['offen', 'alle', 'progress', 'erledigt', 'heute']) {
    await page.evaluate(([p, filter]) => (window as W).pmSetTodoFilter(p, filter), [id, f]);
    checkliste[f] = await page.evaluate((zelle) => {
      const z = eval(zelle) as (td: Element) => string;
      return {
        zaehler: ['pmstat-offen', 'pmstat-prog', 'pmstat-erl', 'pmstat-pct'].map((i) => document.getElementById(i)?.textContent ?? ''),
        zeilen: [...document.querySelectorAll('#pm-todo-body tr')].map((tr) => tr.classList.contains('pm-cat-row')
          ? ['KATEGORIE', (tr.querySelector('input') as HTMLInputElement).value, tr.querySelector('[data-pmcat]')?.textContent ?? '']
          : [...tr.querySelectorAll('td')].slice(0, 5).map(z)),
      };
    }, PM_ZELLE);
  }
  await page.locator('#pm-proj-fs .pm-tab', { hasText: 'Einheitenliste' }).click();
  await page.waitForSelector('#pm-proj-body .pm-vt-table');
  const rest = await page.evaluate((zelle) => {
    const z = eval(zelle) as (td: Element) => string;
    const txt = (e: Element | null) => (e as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '';
    return {
      einheiten: [...document.querySelectorAll('#pm-proj-body .pm-vt-table tbody tr')].map((tr) => [...tr.querySelectorAll(':scope > td')].map(z)),
      summen: [...document.querySelectorAll('#pm-proj-body .pm-vt-table tfoot td')].map(txt).filter(Boolean),
      finanzleiste: [(document.getElementById('pmfin-ziel') as HTMLInputElement).value, ...['pmfin-beurk', 'pmfin-offen', 'pmfin-offen-lbl', 'pmfin-quote'].map((i) => txt(document.getElementById(i)))],
      global: [...document.querySelectorAll('#pm-proj-body [onchange*="pmSaveGlobal"]')].filter((e) => e.id !== 'pmfin-ziel').map((e) => (e as HTMLInputElement).value),
      gebaeude: [...document.querySelectorAll('#pm-geb-pip-list > div')].map((d) => [...d.querySelectorAll('select, input')].map((f) => (f as HTMLInputElement).value).join(' / ')),
    };
  }, PM_ZELLE);
  await page.evaluate(([p, e]) => (window as W).pmOpenMieterHist(p, e), [id, einheitMitGespraechen]);
  const gespraeche = await page.evaluate(() => [...document.querySelectorAll('#pm-hist-list .pm-hist-entry')].map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  await page.evaluate(() => { document.getElementById('pm-hist-modal')?.remove(); (window as W).pmCloseProject(); });
  return { karten, checkliste, ...rest, gespraeche };
}

export async function altProjektKarten(page: Page): Promise<string[][]> {
  await page.evaluate(() => (window as W).pmRender());
  return page.evaluate(() => [...document.querySelectorAll('#pm-content .pm-card')].map((k) => [
    k.querySelector('.pm-card-addr')?.textContent ?? '', (k.querySelector('.pm-card-sub')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ...[...k.querySelectorAll('.pm-kpi')].map((kpi) => `${kpi.querySelector('.pm-kpi-val')?.textContent} ${kpi.querySelector('.pm-kpi-lbl')?.textContent} ${kpi.querySelector('div:last-child')?.textContent}`),
    (k.querySelector('.pm-card-foot') as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
  ]));
}

/** pmNewProject → pmCreateProject aus einem Deal; liefert Auswahlliste, Vorbelegung und das gespeicherte Projekt. */
export async function altProjektAnlegen(page: Page, dealId: string) {
  await page.evaluate(() => { (window as W).showPage('pm'); (window as W).pmNewProject(); });
  await page.waitForSelector('#pm-new-deal');
  const auswahl = await page.evaluate(() => [...document.querySelectorAll('#pm-new-deal option')].slice(1).map((o) => o.textContent?.trim() ?? ''));
  await page.selectOption('#pm-new-deal', dealId);
  const vorbelegung = await page.evaluate(() => [(document.getElementById('pm-new-addr') as HTMLInputElement).value, (document.getElementById('pm-new-stadt') as HTMLInputElement).value]);
  await page.evaluate(() => (window as W).pmCreateProject());
  const projekt = await page.evaluate((d) => (window as W).pmProjects().find((p: { dealId: string; _deleted?: boolean }) => p.dealId === d && !p._deleted), dealId);
  return { auswahl, vorbelegung, projekt };
}

export type ListenModul = 'deals' | 'objects' | 'makler';
export interface ListenZustand { chip: string; suche: string; filterId: string }
export interface ListenSicht { zaehler: string[]; zeilen: string[][]; filter: string[]; aktiv: string }

/** Blatt-Texte einer Zelle, mit Leerzeichen verbunden (unabhängig von CSS-Großschreibung und Zeilenumbrüchen). */
const BLATT_TEXT = `(e) => { const t = []; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const s = w.currentNode.textContent.trim(); if (s) t.push(s); } return t.join(' ').replace(/\\s+/g, ' '); }`;

/** Listen Deals/Objekte/Makler (dealRenderList/objRenderList/mkRenderList) mit gespeichertem Filter, Chip und Suche. */
export async function altListe(page: Page, modul: ListenModul, z: ListenZustand): Promise<ListenSicht> {
  const seite = { deals: 'deals', objects: 'objekte', makler: 'makler' }[modul];
  const praefix = { deals: 'deal', objects: 'obj', makler: 'mk' }[modul];
  await page.evaluate((s) => (window as W).showPage(s), seite);
  await page.waitForSelector(`#${praefix}-saved-filters select`, { state: 'attached' });
  return page.evaluate(({ modul, seite, praefix, z, blatt }) => {
    const text = eval(blatt) as (e: Element) => string;
    (window as W).sfApply(modul, z.filterId);
    (document.querySelector(`#page-${seite} .srch`) as HTMLInputElement).value = z.suche;
    const chip = [...document.querySelectorAll(`#page-${seite} .chip`)].find((c) => (c.getAttribute('onclick') ?? '').includes(`('${z.chip}'`));
    (window as W)[`${praefix}SetFilter`](z.chip, chip ?? document.createElement('button'));
    return {
      zaehler: [...document.querySelectorAll(`#${praefix}-stats .stat`)].map((s) => `${text(s.querySelector('.stat-lbl')!)}=${s.querySelector('.stat-num')?.textContent}`),
      zeilen: [...document.querySelectorAll(`#${praefix}-grid tbody tr`)].map((tr) => [(tr.getAttribute('onclick') ?? '').match(/'([^']+)'/)?.[1] ?? '', ...[...tr.querySelectorAll(':scope > td')].map(text)]),
      filter: [...document.querySelectorAll(`#sf-dd-${modul} option`)].map((o) => o.textContent ?? ''),
      // „X aktiv" → „X": der Neubau beschriftet den Hinweis anders („Filter: X"); verglichen wird der Filtername.
      aktiv: text(document.querySelector(`#${praefix}-saved-filters span[title]`) ?? document.createElement('i')).replace(/\s*aktiv$/, ''),
    };
  }, { modul, seite, praefix, z, blatt: BLATT_TEXT });
}

/** Cockpit-Karten mit aktivem Ankauf-Filter. */
export async function altCockpitGefiltert(page: Page, filterId: string) {
  await page.evaluate(() => (window as W).showPage('ankauf'));
  await page.waitForSelector('#ankauf-saved-filters select', { state: 'attached' });
  await page.evaluate((id) => (window as W).sfApply('ankauf', id), filterId);
  await page.waitForTimeout(100);
  return page.evaluate(() => [...document.querySelectorAll('.vt-card[id^="vtd-"], .vt-card[id^="vtm-"]')].map((k) => `${k.id.startsWith('vtd-') ? 'deal' : 'makler'}:${k.id.slice(4)}`).sort());
}

/** Deal-Reiter „Info & Objekt“: Formularwerte und Gesprächslog. */
export async function altDealInfo(page: Page, dealId: string) {
  await dealReiter(page, dealId, /Info/);
  await page.waitForSelector('#d-status', { state: 'attached' });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(fehlt)';
    const obj = document.getElementById('d-obj') as HTMLSelectElement | null;
    return {
      objekt: obj?.selectedOptions[0]?.textContent?.trim() ?? '', makler: v('d-makler-search'), status: v('d-status'), angebotsDatum: v('d-datum'), frequenz: v('d-freq'), naechsterKontakt: v('d-next-contact'),
      mail: (document.querySelector('#panel-body a[href^="mailto:"]') as HTMLAnchorElement | null)?.href ?? '',
      log: [...document.querySelectorAll('#d-kommentar-log > div')].map((e) => ({ ts: e.querySelector('span')?.textContent ?? '', text: e.querySelector('div')?.textContent ?? '' })),
    };
  });
}

async function maklerReiter(page: Page, maklerId: string, reiter: RegExp) {
  await page.evaluate(() => (window as W).showPage('makler'));
  await page.evaluate((id) => (window as W).mkOpenDetail(id), maklerId);
  await page.waitForSelector('#panel-tabs .ptab', { state: 'attached' });
  const index = await page.evaluate((quelle) => {
    const re = new RegExp(quelle);
    const tabs = [...document.querySelectorAll('#panel-tabs .ptab')];
    const i = tabs.findIndex((t) => re.test(t.textContent ?? ''));
    if (i >= 0) (window as W).switchPanelTab(i, tabs[i]);
    return i;
  }, reiter.source);
  if (index < 0) throw new Error(`Reiter ${reiter} im alten Makler-Panel nicht gefunden`);
  await page.waitForTimeout(150);
}

/** Makler-Detail: Profil, Kommunikation, Persönlich, Deals. */
export async function altMaklerDetail(page: Page, maklerId: string) {
  await maklerReiter(page, maklerId, /Profil/);
  const profil = await page.evaluate(() => {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(fehlt)';
    return { name: v('mk-name'), firma: v('mk-firma'), tel: v('mk-tel'), email: v('mk-email'), frequenz: v('mk-freq'), zuletzt: v('mk-lastcontact'), prio: document.querySelector('.prio-opt.sel')?.textContent?.trim() ?? '' };
  });
  await maklerReiter(page, maklerId, /Kommunikation/);
  const komm = await page.evaluate(() => ({
    zusammenfassung: (document.getElementById('mk-ai-summary')?.textContent ?? '').trim(),
    zusammenfassungZeit: (document.querySelector('#mk-ai-summary + div')?.textContent ?? '').trim(),
    beziehung: (document.getElementById('mk-relationship-note') as HTMLTextAreaElement | null)?.value ?? '',
    anrede: (document.querySelector('[title="Automatisch erkannt aus ausgehenden Nachrichten"]')?.textContent ?? '').trim(),
    verlauf: [...document.querySelectorAll('#mk-komm-log > div')].map((e) => {
      const spans = e.querySelectorAll(':scope > div:first-child > span');
      const betreff = [...e.querySelectorAll(':scope > div')].find((d) => d.textContent?.startsWith('Betreff: '))?.textContent ?? '';
      return { icon: spans[0]?.textContent ?? '', kanal: spans[1]?.textContent ?? '', ts: spans[2]?.textContent ?? '', betreff, text: (e.querySelector(':scope > div:last-child') as HTMLElement).textContent ?? '' };
    }),
  }));
  await maklerReiter(page, maklerId, /Persönlich/);
  const persoenlich = await page.evaluate(() => ({
    erwaehnungen: [...document.querySelectorAll('#mk-mentions-list > div')].map((e) => [...e.querySelectorAll('span')].map((x) => x.textContent?.trim() ?? '').join(' | ')),
    geburtstag: (document.getElementById('mk-p-geb') as HTMLInputElement | null)?.value ?? '',
    anrede: (document.getElementById('mk-p-anrede') as HTMLSelectElement | null)?.value ?? '',
  }));
  await maklerReiter(page, maklerId, /Deals/);
  const deals = await page.evaluate(() => ({
    karten: [...document.querySelectorAll('#panel-body .dmini')].map((e) => [e.querySelector('.dm-addr')?.textContent ?? '', e.querySelector('.dm-sub')?.textContent ?? '', e.querySelector('.badge')?.textContent ?? '', e.querySelector('.dm-kv')?.textContent ?? ''].join(' | ')),
    titel: [...document.querySelectorAll('#panel-body .fsec-title')].map((e) => e.textContent?.trim() ?? ''),
  }));
  await page.evaluate(() => (window as W).closePanel?.('ausdruecklich'));
  return { profil, komm, persoenlich, deals };
}

/** Mail-Auswahl im Cockpit: Name, Betreff und mailto-Link je Vorlage (vtDealMailPicker / vtMaklerMailPicker). */
export async function altMailAuswahl(page: Page, art: 'deal' | 'makler', id: string) {
  await page.evaluate(() => (window as W).showPage('ankauf'));
  await page.waitForSelector('.vt-card', { state: 'attached' });
  return page.evaluate(([a, i]) => {
    document.getElementById('vt-mailpick-overlay')?.remove();
    (window as W)[a === 'deal' ? 'vtDealMailPicker' : 'vtMaklerMailPicker'](i);
    const eintraege = [...document.querySelectorAll('#vt-mailpick-overlay a')].map((x) => [x.querySelector('div')?.textContent ?? (x.textContent ?? '').trim(), x.getAttribute('href') ?? ''].join(' | '));
    document.getElementById('vt-mailpick-overlay')?.remove();
    return eintraege;
  }, [art, id]);
}

export type KalkAktion = { art: 'rendite' | 'kpm2'; wert: string } | { art: 'miete'; pct: 0 | 10 | 15 };
export interface KalkWerkzeugSicht { hinweis: string; zeilen: { mieteSoll: string; rendite: string; vkp: string; kpm2: string }[]; kennzahlen: Record<string, string> }

/** „Alle setzen“ im Reiter Kalkulation (ungespeichert): Hinweis, je Einheit KM SOLL/Rendite/VKP/KP je m², Kennzahlen. */
export async function altKalkWerkzeug(page: Page, dealId: string, aktion: KalkAktion): Promise<KalkWerkzeugSicht> {
  await dealReiter(page, dealId, /^\s*\S*\s*Kalkulation\s*$/);
  await page.waitForSelector('#ha-gik', { state: 'attached' });
  await page.evaluate(() => document.getElementById('bktoast')?.remove());
  await page.evaluate((a) => {
    const w = window as W;
    if (a.art === 'miete') return w.dealBulkMietsteigerung(a.pct);
    (document.getElementById(a.art === 'rendite' ? 'dk-bulk-rendite' : 'dk-bulk-kpm2') as HTMLInputElement).value = a.wert;
    return a.art === 'rendite' ? w.dealBulkRendite() : w.dealBulkKpm2();
  }, aktion);
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const wert = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(fehlt)';
    const zeilen = [...document.querySelectorAll('#dk-einh-body tr')].map((_, i) => ({ mieteSoll: wert(`de-mn-${i}`), rendite: wert(`de-rend-${i}`), vkp: wert(`de-vkp-${i}`), kpm2: wert(`de-kpm2-${i}`) }));
    const kennzahlen = Object.fromEntries([...document.querySelectorAll('[id^="ha-"], [id^="hg-"], [id^="r-"], [id^="dk-"]')]
      .map((e) => [e.id, (e instanceof HTMLInputElement || e instanceof HTMLSelectElement ? e.value : e.textContent ?? '').trim()]));
    return { hinweis: document.getElementById('bktoast')?.textContent ?? '', zeilen, kennzahlen };
  });
}

/** Kalkulationsvarianten: Auswahlliste, Namen mit Löschknopf, nach dem Laden (Rückfrage bestätigt) die Kennzahlen. */
export async function altVarianten(page: Page, dealId: string, laden: string) {
  await dealReiter(page, dealId, /^\s*\S*\s*Kalkulation\s*$/);
  await page.waitForSelector('#ha-gik', { state: 'attached' });
  const liste = await page.evaluate(() => ({
    optionen: [...document.querySelectorAll('#dk-variant-select option')].map((o) => o.textContent ?? ''),
    anzahl: [...document.querySelectorAll('.fsec span')].find((s) => /gespeichert$/.test(s.textContent ?? ''))?.textContent ?? '',
  }));
  const frage = new Promise<string>((ok) => page.once('dialog', (d) => { ok(d.message()); void d.accept(); }));
  await page.evaluate((v) => (window as W).dealVariantLoad(v), laden);
  const rueckfrage = await frage;
  await page.waitForTimeout(200);
  const kennzahlen = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^="ha-"], [id^="hg-"], [id^="r-"], [id^="dk-"]')]
    .map((e) => [e.id, (e instanceof HTMLInputElement || e instanceof HTMLSelectElement ? e.value : e.textContent ?? '').trim()])));
  return { ...liste, rueckfrage, hinweis: await page.evaluate(() => document.getElementById('bktoast')?.textContent ?? ''), einheiten: await page.locator('#dk-einh-body tr').count(), kennzahlen };
}

/** Globale Suche (🔍 im Kopf, ⌘F): Überschriften je Bereich und Trefferzeilen als Text. */
export async function altSuche(page: Page, eingabe: string) {
  await page.evaluate(() => (window as W).globalSearch());
  await page.waitForSelector('#gs-input');
  await page.fill('#gs-input', eingabe);
  await page.evaluate(() => (window as W).globalSearchExec());
  const ergebnis = page.locator('#gs-results');
  const text = (await ergebnis.innerText()).split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  await page.evaluate(() => (window as W).globalSearchClose());
  return text;
}

/** Objekt-Detail (📋 Details): Statuswahl, Feldpaare je Abschnitt, Recherche-Links, Einheitenzeilen, Notizen. */
export async function altObjektDetail(page: Page, objektId: string) {
  await page.evaluate(() => (window as W).showPage('objekte'));
  await page.evaluate((id) => (window as W).objOpenDetail(id), objektId);
  await page.waitForSelector('#panel-body .fsec');
  return page.evaluate(() => {
    const roh = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const abschnitt = (titel: string) => {
      const kopf = [...document.querySelectorAll('#panel-body .fsec-title')].find((t) => (t.textContent ?? '').includes(titel));
      return kopf?.parentElement ?? null;
    };
    const paare = (titel: string) => {
      const box = abschnitt(titel);
      if (!box) return [];
      return [...box.querySelectorAll('.ckl, label')].map((l) => `${roh(l)} = ${roh(l.nextElementSibling)}`);
    };
    const einheiten = [...(abschnitt('🏠 Einheiten')?.querySelectorAll('tbody tr') ?? [])]
      .map((tr) => [...tr.querySelectorAll('td')].map(roh).join(' | '));
    return {
      status: (document.querySelector('#panel-body select') as HTMLSelectElement | null)?.value ?? '',
      lage: paare('📍 Lage'), gebaeude: paare('🏢 Gebäude'), kennzahlen: paare('💶 Kennzahlen'),
      einheiten, notizen: roh(abschnitt('📝 Notizen')?.querySelector('.notiz-box')),
      recherche: [...document.querySelectorAll('#panel-body a.btn-ghost')].map((a) => `${roh(a)} → ${(a as HTMLAnchorElement).getAttribute('href')}`),
    };
  });
}

/** Papierkorb (Einstellungen): Gruppen mit Anzahl und je Eintrag Name und Restlaufzeit. */
export async function altPapierkorb(page: Page) {
  await page.evaluate(() => (window as W).showPage('settings'));
  await page.waitForSelector('#st-trash');
  await page.waitForFunction(() => !(document.getElementById('st-trash')?.textContent ?? '').includes('Lädt'));
  return page.evaluate(() => (document.getElementById('st-trash')?.innerText ?? '')
    .split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean));
}

/** Dublettenprüfung (Einstellungen): gefundene Paare mit Art, Sicherheit, Grund und Beschriftungen. */
export async function altDubletten(page: Page) {
  await page.evaluate(() => (window as W).showPage('settings'));
  await page.waitForSelector('#st-dedup-list', { state: 'attached' });
  await page.evaluate(() => (window as W).settingsDedupScan());
  await page.waitForTimeout(300);
  return page.evaluate(() => [...document.querySelectorAll('#st-dedup-list > div')]
    .slice(1)
    .map((k) => (k as HTMLElement).innerText.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')));
}
