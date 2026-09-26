/**
 * Die Routen des Kerns als Hono-Unterapp — der Host mountet sie (`app.route('/api/agent', agentRouten(kern, nutzerAus))`).
 * Der Host sagt, wer der Nutzer ist (`nutzerAus(c)`), der Kern prüft nichts weiter: Anmeldung ist Sache des Hosts.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Kern, Nutzer } from './kern.ts';
import { Beobachtung, Eingabe, Entscheidung } from './vertrag.ts';

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

  app.get('/stand', (c) => c.json(kern.stand()));
  app.get('/ziele', (c) => c.json({ ziele: kern.werkzeuge.length, dna: kern.dna }));

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
  app.delete('/gedaechtnis/:id', async (c) => c.json({ geloescht: await kern.gedaechtnis(nutzerAus(c)!).loeschen(c.req.param('id')) }));
  app.delete('/gedaechtnis', async (c) => c.json({ geloescht: await kern.gedaechtnis(nutzerAus(c)!).leeren() }));

  return app;
}
