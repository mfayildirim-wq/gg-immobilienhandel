/* Steuerung des Neubaus für den Vergleich. */
import type { Page } from '@playwright/test';
import { NEU_WEB } from './umgebung.ts';

export async function neuKalkulation(page: Page, dealId: string): Promise<Record<string, string>> {
  await page.goto(`${NEU_WEB}/deals?deal=${dealId}`);
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await page.locator('[data-kennzahl="aufteiler.gik"]').waitFor();
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-kennzahl]')].map((e) => [e.getAttribute('data-kennzahl'), e.getAttribute('data-wert') ?? ''])));
}

export async function neuBankgespraech(page: Page, kkId: string): Promise<string> {
  await page.goto(`${NEU_WEB}/kundenkalkulationen/${kkId}`);
  const pv = page.frameLocator('iframe[title="Bankgespräch-Vorschau"]').locator('.bg-pv');
  await pv.waitFor();
  return pv.innerText();
}

export async function neuPraesentation(page: Page, id: string, folien: string[]): Promise<Record<string, string>> {
  await page.goto(`${NEU_WEB}/praesentationen/${id}`);
  const aus: Record<string, string> = {};
  const knoepfe = page.getByRole('navigation', { name: 'Folien' }).getByRole('button', { name: /^Folie \d+:/ });
  await knoepfe.first().waitFor();
  for (const [i, fid] of folien.entries()) {
    await knoepfe.nth(i).click();
    const wrap = page.frameLocator('iframe[title="Folienvorschau"]').locator('.fp-live-wrap');
    await wrap.waitFor({ state: 'attached' });
    await page.waitForTimeout(150); // zurückgestellte Vorschau
    aus[fid] = await wrap.evaluate((e) => (e as HTMLElement).innerText);
  }
  return aus;
}

export async function neuBegleitschein(page: Page, id: string) {
  await page.goto(`${NEU_WEB}/begleitscheine/${id}`);
  await page.locator('tr[data-zeile]').first().waitFor();
  return page.evaluate(() => {
    const zaehler = Object.fromEntries([...document.querySelectorAll('[aria-label^="Summe:"], [aria-label^="Offen:"], [aria-label^="In Progress:"], [aria-label^="Erledigt:"]')]
      .map((e) => { const [k, v] = (e.getAttribute('aria-label') ?? '').split(': '); return [k, v]; }));
    const zeilen = [...document.querySelectorAll('tr[data-zeile]')].map((tr) => {
      const td = tr.querySelectorAll(':scope > td');
      return {
        text: (td[0]!.querySelector('textarea[aria-label="Punkt"]') as HTMLTextAreaElement).value,
        verantwortung: (td[1]!.querySelector('textarea') as HTMLTextAreaElement).value,
        status: (td[3]!.querySelector('select') as HTMLSelectElement).value,
        aktionen: [...td[2]!.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        sub: [...td[0]!.querySelectorAll('textarea[aria-label="Unterpunkt"]')].map((t) => ({
          text: (t as HTMLTextAreaElement).value,
          status: (t.closest('.mantine-Group-root')!.querySelector('select') as HTMLSelectElement).value,
        })),
      };
    });
    return { name: document.querySelector('h3')?.textContent?.trim() ?? '', kopf: (document.querySelector('textarea[aria-label="Kopfbereich"]') as HTMLTextAreaElement)?.value ?? '', zaehler, zeilen };
  });
}

/** Makler-Karten liegen im Reiter „Makler kontaktieren"; zum Lesen muss er aktiv sein. */
async function maklerSchubfach(page: Page) {
  const reiter = page.getByRole('tab', { name: /Makler kontaktieren/ });
  await reiter.waitFor();
  await reiter.click();
  await page.getByRole('region', { name: '🤝 Makler kontaktieren' }).waitFor();
}

export async function neuCockpit(page: Page) {
  // Wie beim Öffnen der Seite: terminlose Makler zuerst einplanen (Selbstheilung), dann die Karten lesen
  await page.request.post(`${NEU_WEB}/api/ankauf/einplanen`, { data: {} });
  await page.goto(`${NEU_WEB}/`);
  await page.locator('[data-karte]').first().waitFor();
  await maklerSchubfach(page);
  await page.waitForTimeout(500);
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-karte]')].map((k) => [k.getAttribute('data-karte'), {
    klasse: k.getAttribute('data-faellig-klasse') ?? '',
    label: (k.querySelector('[data-faellig-label]')?.textContent ?? '').trim(),
    zuletzt: (k.querySelector('[data-zuletzt]')?.textContent ?? '').replace('Zuletzt: ', '').trim(),
  }])));
}

export async function neuVertriebsliste(page: Page, id: string) {
  await page.goto(`${NEU_WEB}/vertriebslisten`);
  await page.getByRole('table', { name: 'Vertriebslisten' }).waitFor();
  const uebersicht = await page.evaluate(() => [...document.querySelectorAll('table[aria-label="Vertriebslisten"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
  const kopf = await page.evaluate(() => document.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  await page.goto(`${NEU_WEB}/vertriebslisten/${id}`);
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
  const leiste = (await page.getByLabel('Kopfzeile').textContent())?.replace(/\s+/g, ' ').trim() ?? '';
  return { kopf, uebersicht, leiste, ...inhalt };
}

const NEU_PM_ZELLE = `(td) => {
  const ampel = [...td.querySelectorAll('button[aria-pressed]')];
  if (ampel.length) return ampel.filter((a) => a.getAttribute('aria-pressed') === 'true').map((a) => a.textContent.trim()).join('');
  const felder = [...td.querySelectorAll('input, textarea, select')];
  if (felder.length) return felder.map((f) => f.value).join(' / ');
  return td.innerText.replace(/\\s+/g, ' ').trim();
}`;

export async function neuProjektKarten(page: Page): Promise<string[][]> {
  await page.goto(`${NEU_WEB}/projekte`);
  await page.locator('[data-projekt]').first().waitFor();
  return page.evaluate(() => [...document.querySelectorAll('[data-projekt]')].map((k) => [
    k.querySelector('[data-feld="adresse"]')?.textContent ?? '', (k.querySelector('[data-feld="unterzeile"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ...[...k.querySelectorAll('[data-kpi]')].map((kpi) => [...kpi.children].map((c) => c.textContent).join(' ')),
    (k.querySelector('[data-feld="ampel"]') as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
  ]));
}

export async function neuProjekt(page: Page, id: string, einheitMitGespraechen: string) {
  const karten = await neuProjektKarten(page);
  await page.goto(`${NEU_WEB}/projekte/${id}`);
  await page.getByRole('table', { name: 'Checkliste' }).waitFor();
  const checkliste: Record<string, { zaehler: string[]; zeilen: string[][] }> = {};
  const FILTER: Record<string, string> = { offen: 'Offen', alle: 'Alle', progress: 'In Progress', erledigt: 'Erledigt', heute: 'Heute fällig' };
  for (const [f, label] of Object.entries(FILTER)) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(100);
    checkliste[f] = await page.evaluate((zelle) => {
      const z = eval(zelle) as (td: Element) => string;
      return {
        zaehler: ['offen', 'progress', 'erledigt', 'pct'].map((k) => (document.querySelector(`[data-zaehler="${k}"]`)?.textContent ?? '').replace(/^● /, '').replace(/ (Offen|In Progress|Erledigt)$/, '').replace(/%$/, '')),
        zeilen: [...document.querySelectorAll('table[aria-label="Checkliste"] tbody tr')].map((tr) => tr.hasAttribute('data-kategorie')
          ? ['KATEGORIE', (tr.querySelector('input') as HTMLInputElement).value, tr.querySelector('[data-kategorie-zaehler]')?.textContent ?? '']
          : [...tr.querySelectorAll('td')].slice(0, 5).map(z)),
      };
    }, NEU_PM_ZELLE);
  }
  await page.getByRole('tab', { name: '📊 Einheitenliste' }).click();
  await page.getByRole('table', { name: 'Einheitenliste' }).waitFor();
  const rest = await page.evaluate((zelle) => {
    const z = eval(zelle) as (td: Element) => string;
    const txt = (e: Element | null) => (e as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '';
    return {
      einheiten: [...document.querySelectorAll('table[aria-label="Einheitenliste"] tbody tr')].map((tr) => [...tr.querySelectorAll(':scope > td')].map(z)),
      summen: [...document.querySelectorAll('table[aria-label="Einheitenliste"] tfoot td')].map(txt).filter(Boolean),
      finanzleiste: [(document.querySelector('[aria-label="Ziel-VKP gesamt €"]') as HTMLInputElement).value, ...['beurkundet', 'offen', 'offen-label', 'quote'].map((k) => txt(document.querySelector(`[data-fin="${k}"]`)))],
      global: [...document.querySelectorAll('[aria-label="Globalverkauf"] input, [aria-label="Globalverkauf"] select')].map((e) => (e as HTMLInputElement).value),
      gebaeude: [...document.querySelectorAll('[data-massnahme]')].map((d) => [...d.querySelectorAll('select, input')].map((f) => (f as HTMLInputElement).value).join(' / ')),
    };
  }, NEU_PM_ZELLE);
  await page.getByRole('button', { name: `Mietergespräche ${einheitMitGespraechen}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-gespraech]').first().waitFor();
  const gespraeche = await dialog.locator('[data-gespraech]').evaluateAll((es) => es.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  await page.keyboard.press('Escape');
  return { karten, checkliste, ...rest, gespraeche };
}

/** Neues Projekt über den Dialog anlegen; liefert Auswahl, Vorbelegung und das gespeicherte Projekt (API). */
export async function neuProjektAnlegen(page: Page, dealId: string) {
  await page.goto(`${NEU_WEB}/projekte`);
  await page.getByRole('button', { name: /^(Projekt|Neues Projekt anlegen)$/ }).click();
  const dialog = page.getByRole('dialog', { name: '🏗️ Neues Projekt anlegen' });
  await dialog.getByRole('combobox', { name: 'Aus Deal übernehmen (optional)' }).click();
  const optionen = page.getByRole('option');
  await optionen.first().waitFor();
  const auswahl = await optionen.allTextContents();
  const deals = await (await page.request.get(`${NEU_WEB}/api/projekte/deal-auswahl`)).json() as { id: string; adresse: string; stadt: string; angebotsDatum: string }[];
  const d = deals.find((x) => x.id === dealId)!;
  await page.getByRole('option', { name: `${d.adresse} ${d.stadt} (${d.angebotsDatum})` }).click();
  const vorbelegung = [await dialog.getByRole('textbox', { name: 'Adresse' }).inputValue(), await dialog.getByRole('textbox', { name: 'Stadt' }).inputValue()];
  await dialog.getByRole('button', { name: 'Projekt anlegen' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const projekte = await (await page.request.get(`${NEU_WEB}/api/projekte`)).json() as (Record<string, unknown> & { dealId: string; einheiten: Record<string, unknown>[]; todos: Record<string, unknown>[] })[];
  return { auswahl, vorbelegung, projekt: projekte.find((p) => p.dealId === dealId)! };
}

const NEU_BLATT_TEXT = `(e) => { const t = []; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const s = w.currentNode.textContent.trim(); if (s) t.push(s); } return t.join(' ').replace(/\\s+/g, ' '); }`;

export async function neuListe(page: Page, modul: 'deals' | 'objects' | 'makler', z: { chip: string; suche: string; filterId: string }) {
  const pfad = { deals: 'deals', objects: 'objekte', makler: 'makler' }[modul];
  await page.goto(`${NEU_WEB}/${pfad}`);
  await page.evaluate(() => { try { localStorage.setItem('gg.deals.layout', 'untereinander'); localStorage.setItem('gg.objekte.layout', 'untereinander'); localStorage.setItem('gg.makler.layout', 'untereinander'); } catch { /* */ } });
  await page.reload();
  // Die gespeicherten Filter liegen in einem Menü (früher ein <select>); die Namen werden gelesen, solange es offen ist.
  const filterNamen = await filterAusMenue(page, z.filterId);
  const chipLabel = modul === 'makler' ? (z.chip === 'alle' ? 'Alle' : `${z.chip}-Makler`) : (z.chip === 'alle' ? 'Alle' : z.chip);
  await page.getByRole('button', { name: chipLabel, exact: true }).click();
  await page.getByLabel('Suchen').fill(z.suche);
  await page.waitForTimeout(150);
  const tabelle = { deals: 'Dealliste', objects: 'Objektliste', makler: 'Maklerliste' }[modul];
  const sicht = await page.evaluate(({ tabelle, blatt }) => {
    const text = eval(blatt) as (e: Element) => string;
    return {
      zaehler: [...document.querySelectorAll('[data-zaehler]')].map((s) => `${s.getAttribute('data-zaehler')}=${s.querySelector('[data-anzahl]')?.textContent}`),
      zeilen: [...document.querySelectorAll(`table[aria-label="${tabelle}"] tbody tr`)].map((tr) => [tr.getAttribute('data-deal') ?? tr.getAttribute('data-objekt') ?? tr.getAttribute('data-makler') ?? '', ...[...tr.querySelectorAll(':scope > td')].map(text)]),
      // „Filter: X" → „X": verglichen wird, welcher Filter aktiv ist, nicht wie das Label formuliert ist.
      aktiv: (document.querySelector('[data-aktiver-filter]')?.textContent ?? '').replace(/^Filter:\s*/, ''),
    };
  }, { tabelle, blatt: NEU_BLATT_TEXT });
  return { ...sicht, filter: filterNamen };
}

/** Öffnet das Filter-Menü, liest die Einträge und wählt einen davon. */
async function filterAusMenue(page: Page, filterId: string): Promise<string[]> {
  await page.getByRole('button', { name: 'Gespeicherte Filter' }).click();
  await page.locator('[data-filter-option]').first().waitFor();
  const namen = await page.locator('[data-filter-option]').evaluateAll((es) => es.map((e) => e.textContent ?? ''));
  // Leere Kennung = „— Kein Filter —"; dieser Eintrag trägt keine Id (wie die leere Option im früheren <select>).
  await (filterId
    ? page.locator(`[data-filter-id="${filterId}"]`)
    : page.locator('[data-filter-option="— Kein Filter —"]')).click();
  return namen;
}

export async function neuCockpitGefiltert(page: Page, filterId: string) {
  await page.goto(`${NEU_WEB}/`);
  await page.locator('[data-karte]').first().waitFor();
  await filterAusMenue(page, filterId);
  await maklerSchubfach(page);
  await page.waitForTimeout(200);
  return page.evaluate(() => [...document.querySelectorAll('[data-karte]')].map((k) => k.getAttribute('data-karte') ?? '').sort());
}

export async function neuDealInfo(page: Page, dealId: string) {
  await page.goto(`${NEU_WEB}/deals?deal=${dealId}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Übersicht' }).click();
  await detail.getByRole('combobox', { name: 'Status' }).waitFor();
  await page.waitForTimeout(300);
  const wert = async (name: string) => detail.getByRole('combobox', { name, exact: true }).or(detail.getByLabel(name, { exact: true })).first().inputValue();
  return {
    objekt: await wert('🏢 Objekt'), makler: await wert('🤝 Makler'), status: await wert('Status'), angebotsDatum: await wert('Angebotsdatum'),
    frequenz: await wert('Frequenz'), naechsterKontakt: await wert('Nächster Kontakt'),
    mail: (await detail.getByRole('link', { name: 'E-Mail an Makler' }).count()) ? await detail.getByRole('link', { name: 'E-Mail an Makler' }).getAttribute('href') ?? '' : '',
    log: await detail.getByRole('region', { name: 'Kommentare' }).locator('.mantine-Paper-root').evaluateAll((es) => es.map((e) => ({ ts: e.children[0]?.textContent ?? '', text: e.children[1]?.textContent ?? '' }))),
  };
}

export async function neuMaklerDetail(page: Page, maklerId: string) {
  await page.goto(`${NEU_WEB}/makler?makler=${maklerId}`);
  // Das Detail steht rechts neben der Liste (früher ein Schubfach); die Werte sind dieselben.
  const s = page.getByRole('region', { name: 'Makler-Detail' });
  await s.getByRole('tab', { name: '👤 Profil' }).waitFor();
  await page.waitForTimeout(300);
  const wert = async (label: string) => s.getByLabel(label, { exact: true }).first().inputValue();
  const profil = {
    name: await wert('Name'), firma: await wert('Firma'), tel: await wert('Telefon'), email: await wert('E-Mail'), frequenz: await s.getByRole('combobox', { name: 'Frequenz' }).inputValue(),
    zuletzt: await wert('Zuletzt kontaktiert'), prio: (await s.locator('[aria-label="Priorität"] [data-active] label, [aria-label="Priorität"] label[data-active]').first().textContent().catch(() => '')) ?? '',
  };
  await s.getByRole('tab', { name: '💬 Kommunikation' }).click();
  await s.getByRole('region', { name: 'Kommunikation' }).waitFor();
  const komm = await page.evaluate(() => {
    const dlg = document.querySelector('[aria-label="Makler-Detail"]')!;
    const zs = dlg.querySelector('[aria-label="KI-Zusammenfassung"]');
    return {
      zusammenfassung: (zs?.querySelector('[data-ki-zusammenfassung]')?.textContent ?? zs?.querySelectorAll('p')[0]?.textContent ?? '').trim(),
      zusammenfassungZeit: ([...(zs?.querySelectorAll('p') ?? [])].find((p) => p.textContent?.startsWith('Zuletzt:'))?.textContent ?? '').trim(),
      beziehung: (dlg.querySelector('textarea[aria-label="Beziehungsprofil"]') as HTMLTextAreaElement | null)?.value ?? '',
      anrede: (dlg.querySelector('[title="Automatisch erkannt aus ausgehenden Nachrichten"]')?.textContent ?? '').trim(),
      verlauf: [...dlg.querySelectorAll('[data-komm]')].map((e) => {
        const betreffEl = [...e.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Betreff: '));
        return { icon: e.querySelector('p')?.textContent ?? '', kanal: e.querySelector('[data-kanal]')?.textContent ?? '', ts: e.querySelector('[data-ts]')?.textContent ?? '', betreff: betreffEl?.textContent ?? '', text: e.querySelector('[data-text]')?.textContent ?? '' };
      }),
    };
  });
  await s.getByRole('tab', { name: '🎯 Persönlich' }).click();
  await s.getByLabel('🎂 Geburtstag').waitFor();
  const persoenlich = {
    erwaehnungen: await s.locator('[data-erwaehnung]').evaluateAll((es) => es.map((e) => [...e.children].map((x) => x.textContent?.trim() ?? '').join(' | '))),
    geburtstag: await s.getByLabel('🎂 Geburtstag').inputValue(),
    anrede: await s.getByRole('combobox', { name: '🤝 Ansprache' }).inputValue(),
  };
  await s.getByRole('tab', { name: '🤝 Deals' }).click();
  await page.waitForTimeout(300);
  const deals = await page.evaluate(() => {
    const dlg = document.querySelector('[aria-label="Makler-Detail"]')!;
    return {
      karten: [...dlg.querySelectorAll('[data-makler-deal]')].map((e) => {
        const p = [...e.querySelectorAll('p')].map((x) => x.textContent ?? '');
        return [p[0] ?? '', p[1] ?? '', e.querySelector('.mantine-Badge-label')?.textContent ?? '', p[2] ?? ''].join(' | ');
      }),
      titel: [...dlg.querySelectorAll('h6')].map((e) => e.textContent?.trim() ?? ''),
    };
  });
  return { profil, komm, persoenlich, deals };
}

export async function neuMailAuswahl(page: Page, art: 'deal' | 'makler', id: string) {
  await page.goto(`${NEU_WEB}/`);
  if (art === 'makler') await maklerSchubfach(page);
  const karte = page.locator(`[data-karte="${art}:${id}"]`);
  await karte.waitFor();
  await page.waitForTimeout(400);
  await (art === 'deal' ? karte.getByRole('button', { name: 'E-Mail' }) : karte.getByTitle('E-Mail mit Vorlage')).click();
  const dlg = page.getByRole('dialog', { name: '✉️ E-Mail-Vorlage wählen' });
  await dlg.waitFor();
  return dlg.locator('a').evaluateAll((es) => es.map((x) => [(x.querySelector('[data-mailvorlage] p, p') as HTMLElement | null)?.textContent === 'Leere E-Mail (ohne Vorlage)' ? 'Leere E-Mail (ohne Vorlage)' : x.querySelector('p')?.textContent ?? '', x.getAttribute('href') ?? ''].join(' | ')));
}

/** „Alle setzen“ im Neubau: gleiche Sicht wie altKalkWerkzeug (Eingabe leer → Platzhalter = berechneter Wert). */
export async function neuKalkWerkzeug(page: Page, dealId: string, aktion: { art: 'rendite' | 'kpm2'; wert: string } | { art: 'miete'; pct: 0 | 10 | 15 }) {
  await page.goto(`${NEU_WEB}/deals?deal=${dealId}`);
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await page.locator('[data-kennzahl="aufteiler.gik"]').waitFor();
  const liste = page.getByLabel('Einheiten', { exact: true });
  if (aktion.art === 'miete') await liste.getByRole('button', { name: `${aktion.pct ? '+' : ''}${aktion.pct}%`, exact: true }).click();
  else {
    await liste.getByLabel(aktion.art === 'rendite' ? 'Rendite für alle' : 'KP/m² für alle').fill(aktion.wert);
    await liste.getByRole('button', { name: aktion.art === 'rendite' ? '→ Rendite' : '→ KP/m²' }).click();
  }
  const hinweis = page.getByLabel('Einheiten', { exact: true }).getByRole('alert');
  await hinweis.waitFor();
  return {
    hinweis: (await hinweis.textContent()) ?? '',
    zeilen: await liste.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => {
      const feld = (l: string) => { const e = tr.querySelector(`input[aria-label="${l}"]`) as HTMLInputElement | null; return e ? e.value || e.placeholder : '(fehlt)'; };
      const zellen = [...tr.querySelectorAll('td')];
      return { mieteSoll: feld('Miete neu'), rendite: feld('Rendite'), vkp: feld('Verkaufspreis'), kpm2: zellen[10]?.textContent ?? '' };
    })),
    kennzahlen: await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-kennzahl]')].map((e) => [e.getAttribute('data-kennzahl'), e.getAttribute('data-wert') ?? '']))),
  };
}

export async function neuVarianten(page: Page, dealId: string, ladenName: string) {
  await page.goto(`${NEU_WEB}/deals?deal=${dealId}`);
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await page.locator('[data-kennzahl="aufteiler.gik"]').waitFor();
  const leiste = page.getByLabel('Varianten', { exact: true });
  const auswahl = leiste.getByLabel('Variante laden');
  await auswahl.locator('option').nth(1).waitFor({ state: 'attached' });
  const optionen = await auswahl.locator('option').allTextContents();
  const anzahl = (await leiste.getByText(/gespeichert$/).textContent()) ?? '';
  const frage = new Promise<string>((ok) => page.once('dialog', (d) => { ok(d.message()); void d.accept(); }));
  await auswahl.selectOption({ label: optionen.find((o) => o.startsWith(`${ladenName} (`))! });
  const rueckfrage = await frage;
  const hinweis = (await leiste.getByRole('alert').textContent()) ?? '';
  return {
    optionen, anzahl, rueckfrage, hinweis,
    einheiten: await page.getByLabel('Einheiten', { exact: true }).locator('tbody tr').count(),
    kennzahlen: await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-kennzahl]')].map((e) => [e.getAttribute('data-kennzahl'), e.getAttribute('data-wert') ?? '']))),
  };
}

export async function neuSuche(page: Page, eingabe: string) {
  await page.goto(`${NEU_WEB}/`);
  await page.getByRole('button', { name: 'Suche öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: '🔍 Suche' });
  await dialog.getByLabel('Suche').fill(eingabe);
  await page.waitForTimeout(150);
  const text = (await dialog.locator('.mantine-Modal-body').innerText()).split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  await page.keyboard.press('Escape');
  // Erste Zeile ist das Eingabefeld selbst nicht enthalten; Hinweise und Treffer bleiben
  return text;
}

export async function neuObjektDetail(page: Page, objektId: string) {
  await page.goto(`${NEU_WEB}/objekte?objekt=${objektId}`);
  // Das Detail steht rechts neben der Liste (früher ein Schubfach); die Werte sind dieselben.
  const schublade = page.getByRole('region', { name: 'Objekt-Detail' });
  await schublade.getByRole('tab', { name: '📋 Details' }).click();
  await schublade.getByLabel('Kennzahlen', { exact: true }).waitFor();
  // Beschriftungen stehen in data-feld (die Anzeige schreibt sie per CSS groß)
  const paare = (label: string) => schublade.getByLabel(label, { exact: true }).locator('[data-feld]')
    .evaluateAll((es) => es.map((e) => `${e.getAttribute('data-feld')} = ${(e.lastElementChild?.textContent ?? '').replace(/\s+/g, ' ').trim()}`));
  const einheiten = schublade.getByLabel('Einheiten des Objekts', { exact: true });
  return {
    status: await schublade.getByLabel('Objekt-Status').inputValue(),
    lage: await paare('Lage'), gebaeude: await paare('Gebäude'), kennzahlen: await paare('Kennzahlen'),
    einheiten: (await einheiten.count())
      ? await einheiten.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' | ')))
      : [],
    notizen: (await schublade.getByLabel('Notizen', { exact: true }).count())
      ? (await schublade.getByLabel('Notizen', { exact: true }).locator('p').innerText()).replace(/\s+/g, ' ').trim()
      : '',
    recherche: await schublade.getByLabel('Recherche').getByRole('link').evaluateAll((as) => as.map((a) => `${(a.textContent ?? '').trim()} → ${a.getAttribute('href')}`)),
  };
}

export async function neuPapierkorb(page: Page) {
  await page.goto(`${NEU_WEB}/einstellungen/papierkorb`);
  await page.getByRole('heading', { name: '🗑 Papierkorb' }).waitFor();
  const text = await page.locator('main').innerText();
  return text.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export async function neuDubletten(page: Page) {
  await page.goto(`${NEU_WEB}/einstellungen/dubletten`);
  await page.getByRole('heading', { name: '🔍 Dublettenprüfung' }).waitFor();
  await page.locator('[data-dublette]').first().waitFor({ timeout: 10_000 }).catch(() => {});
  return page.locator('[data-dublette]').evaluateAll((es) => es.map((e) =>
    (e as HTMLElement).innerText.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')));
}
