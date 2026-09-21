import { handle } from 'hono/vercel';
import { appAusUmgebung } from './kontext.ts';

/**
 * Einstieg auf Vercel (Node-Laufzeit): eine Function für die ganze API, `vercel.json` leitet `/api/*` hierher.
 *
 * Die App entsteht einmal je Instanz, nicht je Anfrage — sonst öffnete jede Anfrage eine neue Datenbankverbindung.
 * Die Buckets legt hier niemand an: das ist ein Schritt der Einrichtung, kein Teil eines Kaltstarts.
 */
const { app } = appAusUmgebung();
const bedienen = handle(app);

export const GET = bedienen;
export const POST = bedienen;
export const PUT = bedienen;
export const PATCH = bedienen;
export const DELETE = bedienen;
export const OPTIONS = bedienen;
export const HEAD = bedienen;
