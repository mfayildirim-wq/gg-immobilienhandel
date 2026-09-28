/**
 * Die Routen des Kerns als Hono-Unterapp — der Host mountet sie (`app.route('/api/agent', agentRouten(kern, nutzerAus))`).
 * Der Host sagt, wer der Nutzer ist (`nutzerAus(c)`), der Kern prüft nichts weiter: Anmeldung ist Sache des Hosts.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { KernHinweis, type Kern, type Nutzer } from './kern.ts';
import { AgentEinstellungen, Beobachtung, Eingabe, Entscheidung, McpServerNeu } from './vertrag.ts';

const SitzungsParam = z.object({ sitzungId: z.string().optional() });

async function json<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  const roh = await c.req.json().catch(() => null);
  const ergebnis = schema.safeParse(roh);
  if (!ergebnis.success) return c.json({ fehler: 'Eingabe ungültig', felder: ergebnis.error.issues.map((i) => `${i.path.join('.') || '(Rumpf)'}: ${i.message}`) }, 400);
  return ergebnis.data;
}

export function agentRouten(kern: Kern, nutzerAus: (c: Context) => Nutzer | null) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (!nutzerAus(c)) return c.json({ fehler: 'Nicht angemeldet' }, 401);
    await next();
  });

  // Meldungen für den Nutzer (z. B. kein Modell für den gewählten Anbieter) sind keine Störung
  app.onError((e, c) => {
    if (e instanceof KernHinweis) return c.json({ fehler: e.message }, 409);
    throw e;
  });

  app.get('/einstellungen', async (c) => c.json(await kern.einstellungen()));

  // Werkzeuge: alle mit Quelle und Recht; Freigabe ohne Rückfrage nur für MCP-Werkzeuge
  // Ergebnisse (Recherchen, Analysen) zu einem Objekt der App — Typ und ID sind nur Werte, keine Fremdschlüssel
  const Bezug = z.object({ typ: z.string().min(1).max(40), id: z.string().min(1).max(200) });
  app.get('/ergebnisse', async (c) => {
    const b = Bezug.safeParse({ typ: c.req.query('typ'), id: c.req.query('id') });
    return c.json({ ergebnisse: await kern.ergebnisseListe(b.success ? b.data : undefined) });
  });
  app.get('/ergebnisse/zaehlen', async (c) => {
    const b = Bezug.safeParse({ typ: c.req.query('typ'), id: c.req.query('id') });
    if (!b.success) return c.json({ fehler: 'typ und id fehlen' }, 400);
    return c.json({ anzahl: await kern.ergebnisseZaehlen(b.data) });
  });
  app.delete('/ergebnisse/:id', async (c) => c.json({ geloescht: await kern.ergebnisLoeschen(c.req.param('id')) }));

  app.get('/werkzeuge', async (c) => c.json({ werkzeuge: await kern.werkzeugListe() }));
  app.put('/werkzeuge/frei', async (c) => {
    const e = await json(c, z.object({ name: z.string().min(1).max(64), frei: z.boolean() }));
    if (e instanceof Response) return e;
    await kern.werkzeugFrei(e.name, e.frei);
    return c.json({ ok: true });
  });
  app.post('/mcp', async (c) => {
    const e = await json(c, McpServerNeu);
    if (e instanceof Response) return e;
    return c.json(await kern.mcpHinzufuegen(e));
  });
  app.delete('/mcp/:name', async (c) => {
    await kern.mcpEntfernen(c.req.param('name'));
    return c.json({ ok: true });
  });
  app.put('/einstellungen', async (c) => {
    const e = await json(c, AgentEinstellungen);
    if (e instanceof Response) return e;
    return c.json(await kern.einstellungenSpeichern(e));
  });

  app.get('/stand', (c) => c.json(kern.stand()));
  app.get('/ziele', (c) => c.json({ ziele: kern.stand().ziele, werkzeuge: kern.werkzeuge.length, dna: kern.dna }));

  app.post('/nachricht', async (c) => {
    const eingabe = await json(c, Eingabe);
    if (eingabe instanceof Response) return eingabe;
    return c.json(await kern.nachricht(nutzerAus(c)!, eingabe));
  });

  app.post('/entscheidung', async (c) => {
    const e = await json(c, Entscheidung);
    if (e instanceof Response) return e;
    try {
      return c.json(await kern.entscheidung(nutzerAus(c)!, e));
    } catch (err) {
      return c.json({ fehler: (err as Error).message }, 409);
    }
  });

  // Tagesübersicht — nur auf Wunsch („Heute zusammenfassen“), nur lesend
  app.post('/morgen', async (c) => c.json({ antwort: await kern.morgen(nutzerAus(c)!) }));

  // Öffnen und Ortswechsel: Tagesbeginn, Faden des Bereichs oder was es hier gibt — ohne Modellaufruf.
  // `heute` ist das lokale Datum des Browsers.
  app.post('/kontext', async (c) => {
    const e = await json(c, z.object({ ort: z.string().min(1).max(500), heute: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), faehigkeiten: z.boolean().optional() }));
    if (e instanceof Response) return e;
    return c.json(await kern.kontext(nutzerAus(c)!, e));
  });

  app.post('/ereignis', async (c) => {
    const b = await json(c, Beobachtung.extend(SitzungsParam.shape));
    if (b instanceof Response) return b;
    const { sitzungId, ...beobachtung } = b;
    await kern.ereignis(nutzerAus(c)!, beobachtung, sitzungId);
    return c.json({ ok: true });
  });

  app.get('/sitzung', async (c) => {
    const nutzer = nutzerAus(c)!;
    const sitzungId = c.req.query('sitzungId') ?? (await kern.letzteSitzung(nutzer));
    if (!sitzungId) return c.json({ sitzungId: null, verlauf: [], wartetAuf: null });
    const [verlauf, wartetAuf] = await Promise.all([kern.verlauf(nutzer, sitzungId), kern.wartetAuf(nutzer, sitzungId)]);
    return c.json({ sitzungId, verlauf, wartetAuf: wartetAuf ?? null });
  });

  app.get('/vorschlaege', async (c) => {
    const ziel = c.req.query('ziel');
    if (!ziel) return c.json({ fehler: 'ziel fehlt' }, 400);
    return c.json({ vorschlaege: await kern.vorschlaege(nutzerAus(c)!, ziel) });
  });

  app.get('/gedaechtnis', async (c) => c.json({ eintraege: await kern.gedaechtnis(nutzerAus(c)!).alles() }));
  app.get('/gedaechtnis/verlauf', async (c) => c.json({ eintraege: await kern.gedaechtnis(nutzerAus(c)!).verlauf(50) }));
  app.post('/gedaechtnis/:id/bestaetigen', async (c) => {
    await kern.gedaechtnis(nutzerAus(c)!).bestaetige(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/routinen', async (c) => c.json({ routinen: await kern.routinen(nutzerAus(c)!) }));
  app.delete('/gedaechtnis/:id', async (c) => c.json({ geloescht: await kern.loeschen(nutzerAus(c)!, c.req.param('id')) }));
  app.delete('/gedaechtnis', async (c) => c.json({ geloescht: await kern.gedaechtnis(nutzerAus(c)!).leeren() }));

  return app;
}
