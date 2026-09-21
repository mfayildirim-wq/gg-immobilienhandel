import { serve } from '@hono/node-server';
import { appAusUmgebung } from './kontext.ts';

const { app, speicher } = appAusUmgebung();
if (speicher) await speicher.bucketsSicherstellen().catch((e) => console.error('[speicher] Buckets:', e.message));

const port = Number(process.env.API_PORT ?? 3101);
serve({ fetch: app.fetch, port }, () => console.log(`API läuft auf http://localhost:${port}`));
