// Übernommen aus gg-immohandel server/auto-import-engine.ts (Stand 9d693b8): alles, was IN der Seite läuft — Seitentyp,
// AGB-Formular und -Modal, Fehlerseite, Cookie-Banner, Dokumentliste, Freischalten, Drucken — wörtlich, samt aller
// Textmuster. Sie sind an echten Maklerseiten gewachsen; „aufräumen" hieße Fälle verlieren.
//
// Geändert ist der Rahmen:
//  • Playwright statt Puppeteer (ein Browser-Werkzeug im Repo, dasselbe Chromium wie PDF-Export und Klicktests)
//  • Downloads über das Download-Ereignis des Browsers statt über ein überwachtes Temp-Verzeichnis (siehe unten)
//  • Das Absenden einer AGB-/Provisionsbestätigung fragt die Freigabe über einen Port ab — die Engine kennt weder
//    Datenbank noch Schalter.
/* eslint-disable @typescript-eslint/no-explicit-any -- KI-Antworten und DOM-Auswertung sind ungetypt */
// Die Funktionen in page.evaluate() laufen im Browser der Maklerseite, nicht in Node — dafür die DOM-Typen.
/// <reference lib="dom" />
import type { Download, Page } from 'playwright-core';
import type { KiClient } from '../ki/anthropic.ts';
import { NEVER_DOWNLOAD_SOURCE } from '../expose/triage.ts';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Darf auf dieser Adresse eine AGB-/Provisionsbestätigung abgesendet werden? Das Anhaken und Absenden ist eine
 * rechtlich wirksame Erklärung gegenüber einem Dritten (Outward-Aktion). Die Antwort kommt von außen: im Betrieb aus
 * dem Default-Deny-Gate, im Test aus einer Attrappe.
 */
export type AgbFreigabe = (url: string, schritt: string) => Promise<{ erlaubt: boolean; grund?: string }>;

// ── KI-Klassifikation: Seitentyp ──────────────────────────────

export async function classifyPageType(page: Page, ki: KiClient): Promise<{ type: 'agb-form'|'expose-page'|'unknown'; }> {
  // DOM-Snapshot: alle Checkboxen + Buttons mit Text + Title + URL
  const snapshot = await page.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).length;
    const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
      .map(el => (el.textContent || (el as HTMLInputElement).value || '').trim())
      .filter(t => t.length > 0 && t.length < 200)
      .slice(0, 30);
    const h1 = document.querySelector('h1')?.textContent?.trim() || '';
    const title = document.title;
    return { checkboxes, buttons, h1, title, url: location.href };
  });

  // Heuristik: ≥ 2 Checkboxen + Submit-ähnlicher Button → AGB-Form (kein KI nötig)
  const submitHints = /best[äa]tigen|zustimmen|akzeptieren|weiter|zum expos|provision|absenden/i;
  if (snapshot.checkboxes >= 2 && snapshot.buttons.some((b: string) => submitHints.test(b))) {
    return { type: 'agb-form' };
  }

  // Wenn keine Checkboxen → wahrscheinlich Exposé-Page
  if (snapshot.checkboxes === 0) {
    return { type: 'expose-page' };
  }

  // Sonst: KI fragen
  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: 'Du klassifizierst eine Webseite eines deutschen Immobilien-Maklers. Antworte nur über das Tool.',
    messages: [{
      role: 'user',
      content: `URL: ${snapshot.url}\nTitle: ${snapshot.title}\nH1: ${snapshot.h1}\nCheckboxen: ${snapshot.checkboxes}\nButton-/Link-Texte (Auswahl): ${snapshot.buttons.join(' | ')}\n\nWelcher Typ?\n- agb-form: Seite mit Checkboxen + Submit für AGB/Datenschutz/Provisionsvereinbarung\n- expose-page: Eigentliche Exposé-Seite mit Objektdaten\n- unknown: nichts davon`,
    }],
    tools: [{
      name: 'classify_page',
      input_schema: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['agb-form', 'expose-page', 'unknown'] } },
        required: ['type'],
      },
    }],
    tool_choice: { type: 'tool', name: 'classify_page' },
  };

  try {
    const resp = await ki.nachricht(body);
    const toolUse = (resp.content || []).find((c: any) => c.type === 'tool_use');
    if (toolUse?.input?.type) return { type: toolUse.input.type };
  } catch { /* ignore — fall back to heuristic */ }

  // Fallback
  return { type: snapshot.checkboxes > 0 ? 'agb-form' : 'expose-page' };
}

// ── Aktion: AGB-Checkboxen ankreuzen + Submit ─────────────────
// Beide Klickpfade sind Outward-Aktionen im Sinne von Ticket 008: das Anhaken
// und Absenden einer AGB-/Provisionsbestätigung ist eine rechtlich wirksame
// Erklärung gegenüber einem Dritten. Deshalb steht die Prüfung VOR dem ersten
// page.evaluate() — danach ist der Klick bereits passiert.
//
// Geworfen wird nicht: der Aufrufer soll das Exposé sauber überspringen und den
// Grund im Run-Ergebnis ausweisen. Ein Throw landete im generischen
// catch-Zweig und läse sich wie eine kaputte Seite statt wie eine bewusste
// Sperre.

interface AgbResult { checked: number; submittedVia: string; blocked?: string }


/** Gate-Prüfung für einen AGB-Klickpfad. Liefert bei Blockade das fertige Ergebnis mit Begründung, sonst null.
 *  Steht VOR dem ersten page.evaluate() — danach ist der Klick bereits passiert. */
async function agbGateCheck(page: Page, step: string, freigabe: AgbFreigabe): Promise<AgbResult | null> {
  const entscheidung = await freigabe(page.url(), `auto-import/${step}`);
  if (entscheidung.erlaubt) return null;
  return { checked: 0, submittedVia: 'gate-blocked', blocked: entscheidung.grund ?? 'AGB-Bestätigung ist nicht freigegeben.' };
}

export async function fillAgbAndSubmit(page: Page, freigabe: AgbFreigabe): Promise<AgbResult> {
  const gate = await agbGateCheck(page, 'fill-agb', freigabe);
  if (gate) return gate;
  // Alle Checkboxen ankreuzen
  const checked = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    let count = 0;
    for (const b of boxes) {
      const el = b as HTMLInputElement;
      if (!el.disabled && !el.checked) {
        el.click();
        // Manche Frameworks reagieren nur auf change-Event
        el.dispatchEvent(new Event('change', { bubbles: true }));
        count++;
      } else if (el.checked) {
        count++;
      }
    }
    return count;
  });

  // Submit-Button finden — erweiterte Heuristik
  const submittedVia = await page.evaluate(() => {
    const submitRe = /best[äa]tigen|zustimmen|akzeptieren|weiter|zum expos|provision|absenden|fortfahren|anfragen|anzeigen|anfordern|senden|jetzt|freischalten|öffnen|herunterladen|vollst[äa]ndig|details|mehr erfahren/i;
    const negative = /widerruf|abbrechen|cancel|schließen|close|zur[üu]ck|löschen|reset|x$|✕/i;
    const candidates = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], input[type="image"], [role="button"]')) as HTMLElement[];

    // 1. Sichtbar + nicht disabled + Text matcht positive Pattern
    const matches: { el: HTMLElement; text: string; rect: DOMRect }[] = [];
    for (const el of candidates) {
      const txt = (el.textContent || (el as HTMLInputElement).value || (el as HTMLInputElement).alt || (el.getAttribute('aria-label') || '')).trim();
      if ((el as HTMLButtonElement).disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (txt && submitRe.test(txt) && !negative.test(txt)) {
        matches.push({ el, text: txt, rect });
      }
    }
    if (matches.length > 0) {
      // Bevorzuge größere Buttons (Submit ist meist größer als Links)
      matches.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
      matches[0]!.el.click();
      return `text:${matches[0]!.text.substring(0, 50)}`;
    }
    // 2. Generischer Submit
    const sub = document.querySelector('button[type="submit"], input[type="submit"], input[type="image"]') as HTMLElement | null;
    if (sub) { sub.click(); return 'generic-submit'; }
    // 3. Letzter sichtbarer Button im sichtbaren Bereich (Form-Submit ist oft am Ende)
    const visibleBtns = candidates
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 20 && !(el as HTMLButtonElement).disabled
          && !negative.test((el.textContent || '').trim());
      });
    if (visibleBtns.length > 0) {
      const last = visibleBtns[visibleBtns.length - 1]!;
      last.click();
      const txt = (last.textContent || '').trim().substring(0, 50);
      return `fallback-last-visible:${txt}`;
    }
    return 'none';
  });

  if (submittedVia === 'none') {
    throw new Error('Kein Submit-Button gefunden');
  }

  // Auf Navigation warten (max 30s)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
    // Manche SPAs navigieren nicht hart — kurz warten + URL prüfen
  });
  await sleep(800);

  return { checked, submittedVia };
}

// ── Erkennung: Error-Page / abgelaufener Link ──────────────────
// Verkürzt fail-Pfad drastisch bei "Link nicht mehr gültig"-Seiten —
// spart 30-60s + viele Vision-Calls + Audit-Log-Spam.
export async function detectErrorPage(page: Page): Promise<{ isError: boolean; matchedText: string }> {
  return await page.evaluate(() => {
    const errorRe = /(link.*nicht.*mehr.*g(ü|ue)ltig|nicht mehr verf(ü|ue)gbar|seite (existiert )?nicht|404|fehler|abgelaufen|expired|removed|nicht gefunden|page not found|sorry,? we|leider|kein zugriff|access denied|tut uns leid)/i;
    // Suche im sichtbaren Text (max 3000 chars, oben in der Page)
    const bodyText = (document.body?.innerText || '').substring(0, 3000);
    if (!errorRe.test(bodyText)) return { isError: false, matchedText: '' };

    // Plausibilität: NUR als Error werten wenn KEIN Exposé-Inhalt vorhanden
    // (sonst werden Sätze wie "Dieser Link führt zu unserer 404-Seite" fälschlich als Error gewertet)
    const exposeIndicators = /(kaufpreis|exposé|kaltmiete|wohnfl|m²|baujahr|grundst[üu]ck|einheit|wohnung|mfh|mehrfamilien|stellpl)/i;
    const exposeMatches = bodyText.match(new RegExp(exposeIndicators.source, 'gi'))?.length || 0;
    if (exposeMatches >= 3) return { isError: false, matchedText: '' };

    // Page-Title prüfen — Error-Titles sind eindeutig
    const title = (document.title || '').substring(0, 200);
    const titleIsError = errorRe.test(title);

    // Body sollte kurz sein bei Error-Pages
    const bodyShort = bodyText.length < 800;

    if (titleIsError || bodyShort) {
      const match = bodyText.match(errorRe);
      return { isError: true, matchedText: match ? match[0] : title };
    }
    return { isError: false, matchedText: '' };
  });
}

// ── Cookie-Banner akzeptieren (einmalig pro Page) ───────────────
// Cookie-Banner überlagern oft die Page → werden vom Modal-Detector
// fälschlich als AGB-Modal erkannt → endlose Loops. Klick "Alle akzeptieren"
// oder "OK" einmalig vor der Modal-Detection.
export async function tryAcceptCookieBanner(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const cookieRe = /alle akzeptieren|alle erlauben|akzeptieren|verstanden|zustimmen|cookies erlauben|allow all|accept all|ok\b|got it|verstanden/i;
    const containerRe = /cookie|consent|gdpr|privacy/i;
    // Suche Container mit "cookie"-Bezug + Submit-Button darin
    const candidates: { el: HTMLElement; text: string }[] = [];
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
    for (const btn of all) {
      const txt = (btn.textContent || '').trim();
      if (!txt || !cookieRe.test(txt)) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Check if any ancestor contains "cookie"-Bezug (id/class/text)
      let parent: HTMLElement | null = btn;
      let depth = 0;
      let isCookie = false;
      while (parent && depth < 6) {
        const idclass = ((parent.id || '') + ' ' + (parent.className || '')).toString();
        if (containerRe.test(idclass)) { isCookie = true; break; }
        const innerTxt = (parent.innerText || '').substring(0, 200);
        if (/cookie|datenschutz-einstellungen/i.test(innerTxt) && innerTxt.length < 500) { isCookie = true; break; }
        parent = parent.parentElement;
        depth++;
      }
      if (isCookie) candidates.push({ el: btn, text: txt.substring(0, 50) });
    }
    if (candidates.length === 0) return null;
    // "Alle akzeptieren" bevorzugen vor generischem "OK"
    candidates.sort((a, b) => {
      const ap = /alle akzeptieren|alle erlauben|accept all/i.test(a.text) ? 0 : 1;
      const bp = /alle akzeptieren|alle erlauben|accept all/i.test(b.text) ? 0 : 1;
      return ap - bp;
    });
    candidates[0]!.el.click();
    return candidates[0]!.text;
  });
}

// ── Erkennung: offenes Modal/Popup mit AGB-Inhalt? ─────────────
// Modals überlagern Exposé-Inhalt im Hintergrund — Bot würde sonst
// Exposé sichtbar sehen UND runterladen, obwohl es noch eingeschränkt ist.
export async function detectAgbModal(page: Page): Promise<{
  found: boolean;
  checkboxes: number;
  hasSubmitButton: boolean;
  modalText: string;
}> {
  return await page.evaluate(() => {
    const modalSelectors = [
      '[role="dialog"]', '[role="alertdialog"]',
      '.modal[style*="display: block"]', '.modal.show', '.modal.in',
      '.modal--open', '.modal--active',
      '[class*="modal"]:not([class*="footer"]):not([class*="header"])',
      '[class*="overlay"]:not([class*="footer"])',
      '[class*="popup"]:not([class*="trigger"])',
      '[class*="dialog"]:not([class*="trigger"])',
      '[aria-modal="true"]',
    ];
    const candidates: HTMLElement[] = [];
    for (const sel of modalSelectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width < window.innerWidth * 0.25 || rect.height < window.innerHeight * 0.2) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          candidates.push(el);
        }
      } catch { /* skip */ }
    }
    if (candidates.length === 0) {
      const overlays = Array.from(document.querySelectorAll('div')) as HTMLElement[];
      const highZ = overlays
        .map(el => ({ el, z: parseInt(window.getComputedStyle(el).zIndex || '0', 10), rect: el.getBoundingClientRect() }))
        .filter(o => o.z > 100 && o.rect.width > window.innerWidth * 0.4 && o.rect.height > window.innerHeight * 0.3);
      if (highZ.length > 0) candidates.push(highZ[0]!.el);
    }
    if (candidates.length === 0) return { found: false, checkboxes: 0, hasSubmitButton: false, modalText: '' };
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    const modal = candidates[0]!;
    const checkboxes = modal.querySelectorAll('input[type="checkbox"]').length;
    const submitRe = /best[äa]tigen|zustimmen|akzeptieren|weiter|freischalten|expos[ée]|provision|absenden|fortfahren|jetzt anzeigen|öffnen|anfordern/i;
    const buttons = Array.from(modal.querySelectorAll('button, a, input[type="submit"]')) as HTMLElement[];
    const hasSubmitButton = buttons.some(b => {
      const txt = (b.textContent || (b as HTMLInputElement).value || '').trim();
      return submitRe.test(txt);
    });
    const text = (modal.innerText || '').substring(0, 300).replace(/\s+/g, ' ').trim();
    return { found: true, checkboxes, hasSubmitButton, modalText: text };
  });
}

/** Klickt Checkboxen + Submit IM erkannten Modal (nicht global). */
export async function fillAgbModal(page: Page, freigabe: AgbFreigabe): Promise<AgbResult> {
  const gate = await agbGateCheck(page, 'fill-modal', freigabe);
  if (gate) return gate;
  const result = await page.evaluate(() => {
    const modalSelectors = [
      '[role="dialog"]', '[role="alertdialog"]',
      '.modal[style*="display: block"]', '.modal.show', '.modal.in',
      '.modal--open', '.modal--active',
      '[class*="modal"]:not([class*="footer"]):not([class*="header"])',
      '[class*="overlay"]:not([class*="footer"])',
      '[class*="popup"]:not([class*="trigger"])',
      '[class*="dialog"]:not([class*="trigger"])',
      '[aria-modal="true"]',
    ];
    const candidates: HTMLElement[] = [];
    for (const sel of modalSelectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width < window.innerWidth * 0.25 || rect.height < window.innerHeight * 0.2) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          candidates.push(el);
        }
      } catch { /* skip */ }
    }
    if (candidates.length === 0) {
      const overlays = Array.from(document.querySelectorAll('div')) as HTMLElement[];
      const highZ = overlays
        .map(el => ({ el, z: parseInt(window.getComputedStyle(el).zIndex || '0', 10), rect: el.getBoundingClientRect() }))
        .filter(o => o.z > 100 && o.rect.width > window.innerWidth * 0.4 && o.rect.height > window.innerHeight * 0.3);
      if (highZ.length > 0) candidates.push(highZ[0]!.el);
    }
    if (candidates.length === 0) return { checked: 0, submittedVia: 'kein-modal' };

    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    const modal = candidates[0]!;

    // Scroll innerhalb des Modals nach unten — manche aktivieren Submit erst nach
    // Scroll-to-bottom durch AGB-Text
    const scrollable = (modal.querySelector('[style*="overflow"]') as HTMLElement) || modal;
    scrollable.scrollTop = scrollable.scrollHeight;

    // Alle Checkboxen IM Modal ankreuzen
    const boxes = Array.from(modal.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    let checked = 0;
    for (const b of boxes) {
      if (!b.disabled && !b.checked) {
        b.click();
        b.dispatchEvent(new Event('change', { bubbles: true }));
        checked++;
      } else if (b.checked) checked++;
    }

    // Submit IM Modal
    const submitRe = /best[äa]tigen|zustimmen|akzeptieren|weiter|freischalten|expos[ée]|provision|absenden|fortfahren|jetzt anzeigen|öffnen|anfordern/i;
    const buttons = Array.from(modal.querySelectorAll('button, a, input[type="submit"]')) as HTMLElement[];
    for (const el of buttons) {
      const txt = (el.textContent || (el as HTMLInputElement).value || '').trim();
      if (!txt || !submitRe.test(txt)) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      el.click();
      return { checked, submittedVia: `modal-text:${txt.substring(0, 50)}` };
    }
    const sub = modal.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement | null;
    if (sub) { sub.click(); return { checked, submittedVia: 'modal-generic-submit' }; }
    return { checked, submittedVia: 'modal-kein-submit' };
  });
  await sleep(1800);
  return result;
}

// ── Erkennung: Dokumentenliste mit klickbaren Items? ──────────
// Manche Makler (z.B. hangst-immobilien) zeigen NICHT ein einzelnes Exposé
// sondern eine Übersichts-Seite mit allen Files. Wir müssen die einzelnen
// PDF-Items finden und das Exposé per Klick anstoßen.
export async function findDocumentListItems(page: Page, skip: Set<string>): Promise<Array<{ sig: string; text: string }>> {
  return await page.evaluate(([skipArr, blockSource]: [string[], string]) => {
    const skipSet = new Set(skipArr);
    const positive = /expos[ée]|grundriss|wohnfl|mietaufstellung|objektdaten|teilung|grundbuch|energieausweis|baubeschreibung|objektunterlagen|lage|preisliste/i;
    // R4-Sperrliste plus Seitenelemente, die nie ein Dokument sind.
    const negative = new RegExp(blockSource + '|cookies|abmelden|kontaktformular|newsletter', 'i');

    const items: Array<{ sig: string; text: string; rank: number }> = [];

    // Phase 1: Textbasierte Suche (gleiche Logik wie bisher)
    const containers = Array.from(document.querySelectorAll(
      'li, tr, a[href], button, [class*="document"], [class*="file"], [class*="item"], [class*="row"]'
    )) as HTMLElement[];
    for (const el of containers) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 250) continue;
      if (!positive.test(txt)) continue;
      if (negative.test(txt)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const href = (el as HTMLAnchorElement).href || '';
      const sig = href || `${el.tagName}:${txt.substring(0, 80)}:${Math.round(rect.top)}`;
      if (skipSet.has(sig)) continue;
      let rank = 0;
      if (/expos[ée]/i.test(txt)) rank += 20;
      if (/objektunterlagen/i.test(txt)) rank += 15;
      if (/vollst|komplett|gesamt/i.test(txt)) rank += 5;
      if (href && /\.pdf(\?|$)/i.test(href)) rank += 8;
      items.push({ sig, text: txt.substring(0, 100), rank });
    }

    // Phase 2: Fallback — ALLE direkten PDF-Links (auch ohne sprechenden Text)
    // wenn Phase 1 nichts gebracht hat. So fangen wir Sites wo Links nur "Download" o.ä. heißen.
    if (items.length === 0) {
      const pdfLinks = Array.from(document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]')) as HTMLAnchorElement[];
      for (const a of pdfLinks) {
        const rect = a.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const sig = a.href;
        if (skipSet.has(sig)) continue;
        if (negative.test(a.href + ' ' + (a.textContent || ''))) continue;
        const text = (a.textContent || a.href.split('/').pop() || '').trim().substring(0, 100);
        items.push({ sig, text, rank: 5 });
      }
    }

    items.sort((a, b) => b.rank - a.rank);
    return items.slice(0, 6).map(({ sig, text }) => ({ sig, text }));
  }, [[...skip], NEVER_DOWNLOAD_SOURCE] as [string[], string]);
}

// ── Aktion: „Freischalten"/„Vollständiges Exposé"-Button klicken ─
// Wird aufgerufen wenn nur ein eingeschränktes Preview-PDF gefunden wurde.
// Sucht Buttons/Links die zu AGB-Form führen sollten (dann läuft der AGB-Loop erneut).

export async function tryClickUnlockButton(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const unlockRe = /freischalten|vollst[äa]ndiges expos[ée]|expos[ée] anfordern|expos[ée] beantragen|alle infos|mehr erfahren|jetzt anfragen|kontakt aufnehmen|details anzeigen|zugang/i;
    const negative = /widerruf|datenschutz|impressum|cookies|abmelden|unsubscribe/i;

    const all = Array.from(document.querySelectorAll('a, button')) as HTMLElement[];
    const candidates = all
      .map(el => {
        const txt = (el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        return { el, txt, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter(c => c.visible && unlockRe.test(c.txt) && !negative.test(c.txt));

    if (candidates.length === 0) return null;
    // Längster Text gewinnt (meistens spezifischer)
    candidates.sort((a, b) => b.txt.length - a.txt.length);
    const chosen = candidates[0]!;
    chosen.el.click();
    return chosen.txt.substring(0, 100);
  });
}

// ── Downloads ─────────────────────────────────────────────────
// Die alte App stellte per CDP ein Temp-Verzeichnis ein und sah im Sekundentakt nach, ob dort eine Datei ohne
// „.crdownload" liegt. Playwright meldet den Download als Ereignis: kein Verzeichnis, kein Polling, kein Aufräumen —
// und der Dateiname kommt vom Server (`suggestedFilename`), Grundlage der Objektnummer-Probe (R7).
// Die Fristen sind dieselben (R6): ein Klick, der gar keinen Download auslöst, wird nach `quickMs` aufgegeben; hat der
// Download begonnen, bekommt der Server bis `maxMs` — langsame Portale liefern erst nach knapp einer Minute.

export interface DownloadResult {
  buf: Buffer;
  signature: string;
  source: 'pdf-link' | 'button-text' | 'new-tab';
  /** Dateiname wie vom Server geliefert — Grundlage für die Objektnummer-Probe (R7). */
  downloadedName?: string;
}

const QUICK_MS = 12_000;
const MAX_MS = 60_000;
const NEUER_TAB_MS = 6_000;

async function downloadLesen(d: Download): Promise<{ buf: Buffer; name: string } | null> {
  const pfad = await Promise.race([d.path(), sleep(MAX_MS).then(() => null)]).catch(() => null);
  if (!pfad) { await d.cancel().catch(() => {}); return null; }
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(pfad);
  await d.delete().catch(() => {});
  return buf.length > 1024 ? { buf, name: d.suggestedFilename() } : null;
}

/**
 * R5 — PDF, die in einem NEUEN TAB geöffnet wird (target="_blank" auf den Browser-Viewer). Geholt werden die Bytes
 * mit den Cookies der Sitzung: sonst antwortet das Portal mit einem Login.
 */
async function pdfAusNeuemTab(page: Page, tab: Page): Promise<{ buf: Buffer; url: string } | null> {
  try {
    await tab.waitForLoadState('domcontentloaded', { timeout: NEUER_TAB_MS }).catch(() => {});
    const url = tab.url();
    if (!/\.pdf(\?|$)|\/pdf\b/i.test(url)) return null;
    const res = await page.context().request.get(url, { timeout: 30_000 });
    if (!res.ok()) return null;
    const buf = await res.body();
    return buf.length < 1024 ? null : { buf, url };
  } catch {
    return null;
  } finally {
    if (tab !== page) await tab.close().catch(() => {});
  }
}

/** Erst die Lauscher, dann der Klick — ein Ereignis, das vor dem Lauschen feuert, ist verloren. */
async function klickUndFangen<T extends { sig: string }>(page: Page, klick: () => Promise<T | null>, quelle: (t: T) => DownloadResult['source']): Promise<DownloadResult | null> {
  const aufDownload = page.waitForEvent('download', { timeout: QUICK_MS }).catch(() => null);
  const aufTab = page.context().waitForEvent('page', { timeout: NEUER_TAB_MS }).catch(() => null);
  const geklickt = await klick();
  if (!geklickt) return null;

  const tab = await aufTab;
  if (tab) {
    const pdf = await pdfAusNeuemTab(page, tab);
    if (pdf) return { buf: pdf.buf, signature: geklickt.sig, source: 'new-tab', downloadedName: decodeURIComponent(pdf.url.split('/').pop() || '') };
  }
  const download = await aufDownload;
  if (!download) return null;
  const datei = await downloadLesen(download);
  return datei ? { buf: datei.buf, signature: geklickt.sig, source: quelle(geklickt), downloadedName: datei.name } : null;
}

/** Klickt ein Listen-Item per Signatur, wartet auf Download oder neuen Tab. */
export async function clickDocumentItem(page: Page, signature: string): Promise<DownloadResult | null> {
  return klickUndFangen(page, async () => {
      const clicked = await page.evaluate((sig: string) => {
        const all = Array.from(document.querySelectorAll(
          'li, tr, a[href], button, [class*="document"], [class*="file"], [class*="item"], [class*="row"]'
        )) as HTMLElement[];
        for (const el of all) {
          const href = (el as HTMLAnchorElement).href || '';
          const rect = el.getBoundingClientRect();
          const txt = (el.textContent || '').trim();
          const elSig = href || `${el.tagName}:${txt.substring(0, 80)}:${Math.round(rect.top)}`;
          if (elSig === sig) { (el as HTMLElement).click(); return true; }
        }
        return false;
      }, signature);
    return clicked ? { sig: signature } : null;
  }, () => 'button-text');
}

// ── Aktion: Download-Button-Kandidaten finden und EINEN klicken ─
// signature = stabiler String der den geklickten Button identifiziert (URL/Text), damit nicht zweimal der gleiche
// probiert wird. Reihenfolge: .pdf-Links → „Exposé"-Buttons → generische Download-Buttons. Rechtsdokumente werden
// nicht angeklickt — nicht abgewertet, sondern gesperrt (R4).
export async function detectAndDownload(page: Page, skip: Set<string>): Promise<DownloadResult | null> {
  return klickUndFangen(page, async () => {
    const clicked = await page.evaluate(([skipArr, blockSource]: [string[], string]) => {
      const skipSet = new Set(skipArr);
      const downloadRe = /download|herunterladen|expos[ée]|pdf speichern|pdf drucken/i;
      // R4: Rechtsdokumente werden nicht angeklickt — nicht abgewertet, sondern gesperrt.
      const blocked = new RegExp(blockSource, 'i');
      const positive = /expos[ée]/i;

      // Inline-Scoring (KEINE function-Deklaration — tsx injiziert sonst __name-Helper)
      const score = (text: string, href: string): number => {
        let s = 0;
        if (positive.test(text) || positive.test(href)) s += 10;
        if (/vertrag|provision|cookies/i.test(text + ' ' + href)) s -= 5;
        return s;
      };

      // 1. .pdf-Links (höchste Prio)
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const pdfCandidates = anchors
        .filter(a => /\.pdf(\?|$)/i.test(a.href) && !a.hidden)
        .map(a => ({ el: a, sig: a.href, text: (a.textContent || '').trim(), href: a.href }))
        .filter(c => !skipSet.has(c.sig))
        .filter(c => !blocked.test(c.text) && !blocked.test(decodeURIComponent(c.href)))
        .map(c => ({ ...c, score: score(c.text, c.href) }))
        .sort((a, b) => b.score - a.score);

      if (pdfCandidates.length > 0) {
        const c = pdfCandidates[0]!;
        c.el.click();
        return { sig: c.sig, source: 'pdf-link', text: c.text.substring(0, 80) };
      }

      // 2. Button/Link mit Download-Text
      const all = Array.from(document.querySelectorAll('a, button')) as HTMLElement[];
      const buttonCandidates = all
        .map(el => {
          const txt = (el.textContent || '').trim();
          const href = (el as HTMLAnchorElement).href || '';
          const rect = el.getBoundingClientRect();
          return { el, txt, href, visible: rect.width > 0 && rect.height > 0 };
        })
        .filter(c => c.visible && downloadRe.test(c.txt))
        .filter(c => !blocked.test(c.txt) && !blocked.test(c.href))
        .map(c => ({ ...c, sig: c.href || `txt:${c.txt}` }))
        .filter(c => !skipSet.has(c.sig))
        .map(c => ({ ...c, score: score(c.txt, c.href) }))
        .sort((a, b) => b.score - a.score);

      if (buttonCandidates.length > 0) {
        const c = buttonCandidates[0]!;
        c.el.click();
        return { sig: c.sig, source: 'button-text', text: c.txt.substring(0, 80) };
      }

      return null;
    }, [[...skip], NEVER_DOWNLOAD_SOURCE] as [string[], string]);
    return clicked as { sig: string; source: DownloadResult['source']; text: string } | null;
  }, (c) => (c as { source: DownloadResult['source'] }).source);
}

// ── Aktion: Seite als A4-PDF drucken ──────────────────────────

export async function printPageAsPdf(page: Page): Promise<Buffer> {
  // Auto-scroll to bottom für Lazy-Load (Bilder etc.)
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 80);
    });
  });
  await sleep(800); // Lazy-loaded Bilder fertig rendern lassen

  const pdfData = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    preferCSSPageSize: false,
  });
  return Buffer.from(pdfData);
}
