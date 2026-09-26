/**
 * Der Werkzeugkatalog aus einer OpenAPI-Beschreibung: jede Operation ein Werkzeug.
 *
 * GET liest, alles andere schreibt. Der Agent bekommt im Normalfall nur die lesenden Werkzeuge — geschrieben wird
 * über die Oberfläche in der Sitzung des Nutzers (Steuerung `sende`), damit man es sieht und die Rechte des Nutzers gelten.
 * Der Fingerabdruck erkennt, ob sich die Beschreibung geändert hat (dann sind entworfene DNAs „zu prüfen“).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Werkzeug } from './vertrag.ts';

type OpenapiParameter = { name: string; in: 'path' | 'query' | 'header' | 'cookie'; required?: boolean; description?: string; schema?: { type?: string; enum?: string[]; description?: string } };
type OpenapiOperation = { summary?: string; description?: string; operationId?: string; parameters?: OpenapiParameter[]; requestBody?: { content?: Record<string, { schema?: unknown }> }; responses?: Record<string, { description?: string }> };
export type OpenapiDokument = { paths?: Record<string, Record<string, OpenapiOperation>> };

const METHODEN = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface KatalogWerkzeug extends Werkzeug {
  methode: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pfad: string;
  /** Parameter aus Pfad und Abfrage — flach, alle als Text */
  parameter: z.ZodObject<Record<string, z.ZodTypeAny>>;
  pfadParameter: string[];
  abfrageParameter: string[];
  /** Nur schreibende Operationen: der Rumpf als JSON-Schema (für den Fingerabdruck und die Beschreibung) */
  rumpf?: unknown;
}

/** `/api/deals/{id}/kommentare` + GET → `get_api_deals_id_kommentare` */
export function werkzeugName(methode: string, pfad: string): string {
  return `${methode.toLowerCase()}_${pfad.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.toLowerCase();
}

function beschreibung(methode: string, pfad: string, op: OpenapiOperation): string {
  const antwort = op.responses?.['200']?.description ?? op.responses?.['201']?.description;
  const kern = op.summary ?? op.description ?? (antwort ? `Liefert: ${antwort}` : '');
  return `${methode.toUpperCase()} ${pfad}${kern ? ` — ${kern}` : ''}`;
}

export function werkzeugeAusOpenapi(doc: OpenapiDokument, opt: { nurLesend?: boolean } = {}): KatalogWerkzeug[] {
  const werkzeuge: KatalogWerkzeug[] = [];
  for (const [pfad, ops] of Object.entries(doc.paths ?? {})) {
    for (const methode of METHODEN) {
      const op = ops[methode];
      if (!op) continue;
      const lesend = methode === 'get';
      if (opt.nurLesend && !lesend) continue;
      const pfadParameter: string[] = [];
      const abfrageParameter: string[] = [];
      const felder: Record<string, z.ZodTypeAny> = {};
      for (const p of op.parameters ?? []) {
        if (p.in !== 'path' && p.in !== 'query') continue;
        (p.in === 'path' ? pfadParameter : abfrageParameter).push(p.name);
        let feld: z.ZodTypeAny = p.schema?.enum ? z.enum(p.schema.enum as [string, ...string[]]) : z.string();
        const text = p.description ?? p.schema?.description;
        if (text) feld = feld.describe(text);
        felder[p.name] = p.required || p.in === 'path' ? feld : feld.optional();
      }
      const rumpf = op.requestBody?.content?.['application/json']?.schema;
      werkzeuge.push({
        name: werkzeugName(methode, pfad),
        beschreibung: beschreibung(methode, pfad, op),
        methode: methode.toUpperCase() as KatalogWerkzeug['methode'],
        pfad,
        lesend,
        parameter: z.object(felder),
        pfadParameter,
        abfrageParameter,
        ...(rumpf ? { rumpf } : {}),
      });
    }
  }
  return werkzeuge.sort((a, b) => a.name.localeCompare(b.name));
}

/** Setzt Pfad- und Abfrageparameter in die Adresse ein. */
export function adresse(w: KatalogWerkzeug, argumente: Record<string, string | undefined>): string {
  let pfad = w.pfad;
  for (const name of w.pfadParameter) {
    const wert = argumente[name];
    if (wert === undefined) throw new Error(`Parameter ${name} fehlt für ${w.name}`);
    pfad = pfad.replace(`{${name}}`, encodeURIComponent(wert));
  }
  const abfrage = w.abfrageParameter.filter((n) => argumente[n] !== undefined).map((n) => `${encodeURIComponent(n)}=${encodeURIComponent(argumente[n]!)}`);
  return abfrage.length ? `${pfad}?${abfrage.join('&')}` : pfad;
}

/** Fingerabdruck der Beschreibung: Namen, Parameter und Rümpfe — Antworten nicht, sie ändern sich häufiger, ohne die Bedienung zu ändern. */
export function katalogFingerabdruck(werkzeuge: KatalogWerkzeug[], zusatz: unknown[] = []): string {
  const h = createHash('sha256');
  for (const w of werkzeuge) h.update(JSON.stringify([w.name, w.pfadParameter, w.abfrageParameter, w.rumpf ?? null]));
  for (const z of zusatz) h.update(JSON.stringify(z));
  return h.digest('hex').slice(0, 16);
}
