import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoImportFromMail, type ImportOptions, zielPruefen } from '../../src/index.ts';
import { kiAttrappeAutoImport, testPdf, type Testseiten, testseitenStarten } from './testseiten.ts';

// Dasselbe Chrome wie der PDF-Export; ohne Browser werden die Browser-Tests übersprungen (nicht die Zielprüfung).
const CHROME = [process.env.CHROME_PFAD, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p): p is string => !!p && existsSync(p));

describe('Zielprüfung: die Adressen kommen aus fremden Mails', () => {
  it('öffentliche Adressen gehen, interne nicht — auch nicht der Metadaten-Dienst der Cloud', () => {
    expect(zielPruefen('https://makler.example/expose/abc').ok).toBe(true);
    for (const a of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://10.0.0.5/x', 'http://192.168.178.1/', 'http://172.20.1.1/', 'http://169.254.169.254/latest/meta-data/',
      'http://100.100.1.2/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://intranet/', 'http://db.internal/', 'http://drucker.local/']) {
      expect(zielPruefen(a), a).toMatchObject({ ok: false, grund: 'interne Adresse — wird nicht geöffnet' });
    }
    for (const a of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.example/', 'kein-url']) expect(zielPruefen(a), a).toMatchObject({ ok: false, grund: 'ungültige Adresse' });
    expect(zielPruefen('https://nutzer:pw@makler.example/')).toMatchObject({ ok: false, grund: 'Adresse mit Zugangsdaten' });
  });
});

describe.skipIf(!CHROME)('Auto-Import gegen Testseiten im echten Browser', () => {
  let seiten: Testseiten;
  let gestartet = 0;
  beforeAll(async () => { seiten = await testseitenStarten(); });
  afterAll(async () => { await seiten.stop(); });

  const lauf = (o: Partial<ImportOptions> & { ki?: ReturnType<typeof kiAttrappeAutoImport> }) => {
    const ki = o.ki ?? kiAttrappeAutoImport();
    return autoImportFromMail({
      mailFrom: 'makler@example.test', mailSubject: 'Exposé Musterstraße 12 (OBJ-4711)', mailBody: 'Guten Tag, anbei der Link zu unserem Angebot. Objektnummer OBJ-4711.',
      attachments: [], links: [], timeoutSec: 60, ki,
      browserStarten: async () => { gestartet++; return chromium.launch({ executablePath: CHROME!, headless: true, args: ['--no-sandbox'] }); },
      anhangLaden: async () => { throw new Error('kein Anhang erwartet'); },
      agbFreigabe: async () => ({ erlaubt: true }),
      lokaleZieleErlaubt: true,
      ...o,
    });
  };
  const schritte = (r: { steps: { step: string; ok: boolean }[] }) => r.steps.map((s) => s.step);

  it('Anhang ist das vollständige Exposé: fertig, ohne dass ein Browser startet', async () => {
    const vorher = gestartet;
    const r = await lauf({ attachments: [{ partId: 'a1', filename: 'Expose Musterstrasse.pdf', sizeMB: 1 }], anhangLaden: async () => testPdf('Expose', 5) });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'attachment', filename: 'Expose Musterstrasse.pdf' });
    expect(gestartet).toBe(vorher);
  }, 60_000);

  it('AGB-Formular vor dem Exposé: anhaken, absenden, das Exposé laden — und das Rechtsdokument liegen lassen', async () => {
    const r = await lauf({ links: [`${seiten.basis}/portal/expose`] });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'download' });
    expect(schritte(r)).toEqual(expect.arrayContaining(['fill-agb', 'download', 'validate-pdf']));
    expect(r.pdfBuffer!.subarray(0, 5).toString()).toBe('%PDF-');
    // R7: der Dateiname vom Server trägt die Objektnummer aus der Mail
    expect(r.steps.find((s) => s.step === 'download')?.meta).toMatchObject({ datei: 'Expose-OBJ-4711.pdf', objektnummerBestaetigt: 'OBJ-4711' });
    expect(seiten.aufrufe.filter((a) => a.includes('/dateien/agb.pdf'))).toEqual([]); // R4: gesperrt, nicht abgewertet
  }, 90_000);

  it('ohne Freigabe wird NICHTS abgesendet — der Grund steht im Ergebnis', async () => {
    const vorher = seiten.aufrufe.length;
    const r = await lauf({ links: [`${seiten.basis}/portal/expose`], agbFreigabe: async () => ({ erlaubt: false, grund: 'AGB-Bestätigung ist abgeschaltet (Einstellungen → Freigaben).' }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('AGB-Bestätigung ist abgeschaltet');
    expect(seiten.aufrufe.slice(vorher).some((a) => a.startsWith('POST'))).toBe(false);
  }, 90_000);

  it('Cookie-Banner wegklicken, AGB im Modal bestätigen, dann laden', async () => {
    const r = await lauf({ links: [`${seiten.basis}/modal/expose`] });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'download' });
    expect(schritte(r)).toEqual(expect.arrayContaining(['close-cookies', 'fill-modal', 'download']));
  }, 90_000);

  it('Dokumentliste aus klickbaren Zeilen: das Exposé wird gefunden, die Widerrufsbelehrung nicht angeklickt', async () => {
    const vorher = seiten.aufrufe.length;
    const r = await lauf({ links: [`${seiten.basis}/liste`] });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'download' });
    expect(seiten.aufrufe.slice(vorher).filter((a) => a.includes('agb.pdf'))).toEqual([]);
  }, 120_000);

  it('Exposé öffnet sich im neuen Tab: die Bytes kommen aus dem Tab, nicht aus einem Druck der Landingpage', async () => {
    const r = await lauf({ links: [`${seiten.basis}/neuer-tab`] });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'download' });
    expect(r.steps.find((s) => s.step === 'download')?.meta).toMatchObject({ source: 'new-tab' });
    expect(schritte(r)).not.toContain('print');
  }, 90_000);

  it('Link führt direkt auf ein PDF', async () => {
    const r = await lauf({ links: [`${seiten.basis}/direkt/expose-vollstaendig.pdf`] });
    expect(r).toMatchObject({ ok: true, outcome: 'sicher', pdfSource: 'download' });
    expect(schritte(r)).toContain('direct-pdf');
  }, 90_000);

  it('nur eine Vorschau erreichbar: bestes Teilergebnis statt aufgeben, als „unsicher" mit Klartext', async () => {
    const r = await lauf({ links: [`${seiten.basis}/nur-vorschau`] });
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/EINGESCHRÄNKTES Exposé|eingeschränktes Exposé/i);
    expect(r.reason).toContain('adresse');
  }, 120_000);

  it('abgelaufener Link: früh erkannt, im Klartext gemeldet, keine KI gefragt', async () => {
    const ki = kiAttrappeAutoImport();
    const r = await lauf({ links: [`${seiten.basis}/abgelaufen`], ki, mailBody: 'kurz' });
    expect(r).toMatchObject({ ok: false, outcome: 'nichts-gefunden' });
    expect(r.reason).toContain('Link abgelaufen oder Objekt nicht mehr verfügbar');
    expect(ki.fragen.filter((f) => f === 'classify')).toEqual([]);
  }, 90_000);

  it('im Betrieb (ohne Testschalter) wird eine interne Adresse gar nicht erst geöffnet', async () => {
    const vorher = gestartet;
    const r = await lauf({ links: [`${seiten.basis}/portal/expose`], lokaleZieleErlaubt: false, mailBody: 'kurz' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('interne Adresse');
    expect(gestartet).toBe(vorher);
  }, 60_000);

  it('Abbruch von außen beendet den Lauf und schließt den Browser', async () => {
    let fragen = 0;
    const start = Date.now();
    const r = await lauf({ links: [`${seiten.basis}/haengt`], mailBody: 'kurz', abbruchGewuenscht: async () => ++fragen >= 1 });
    expect(r.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(25_000); // Abfrage alle 5 s — nicht erst nach 30 s Navigations-Timeout × 2
  }, 60_000);
});
