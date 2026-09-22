/**
 * Microsoft 365: Zugang einrichten, verbinden und den Posteingang lesen (alt: server/oauth.ts + server/graph.ts).
 * Gelesen wird nur — es werden keine Schreib-Scopes angefordert. Tokens liegen verschlüsselt in `fach.oauth_tokens`.
 */
import type { M365Posteingang, M365Stand } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  anmeldeAdresse, codeEintauschen, type GraphClient, graphClient, type M365Konfiguration, M365_SCOPES, MIN_CANDIDATE_SCORE, tokenErneuern, triageMail,
} from '@gg/integrations';
import { geheimnisAuspacken, geheimnisVerpacken } from '@gg/integrations';
import { eq, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { bereitsImportiert } from './autoImport.ts';
import { auditSchreiben } from './audit.ts';

const KONTO = 'ms-mail';
const KONFIG_SCHLUESSEL = 'm365-konfiguration';
const ORDNER_SCHLUESSEL = 'm365-ordner';
/** Offene Anmeldeversuche: online nehmen zwei getrennte Aufrufe den Login entgegen, ein Modulspeicher trüge nicht. */
const STATES_SCHLUESSEL = 'm365-anmeldeversuche';
const STATE_TTL_MS = 600_000;

async function einstellung<T>(db: Db, schluessel: string, standard: T): Promise<T> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, schluessel));
  return (z?.wert as T | null) ?? standard;
}
async function einstellungSpeichern(db: Db, schluessel: string, wert: unknown) {
  await db.insert(schema.einstellungen).values({ schluessel, wert })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert, updatedAt: sql`now()` } });
}

/** Die Zugangsdaten der Azure-App; das Geheimnis wird verschlüsselt abgelegt. */
export async function m365KonfigurationLesen(db: Db): Promise<M365Konfiguration | null> {
  const roh = await einstellung<{ clientId?: string; tenantId?: string; secret?: string } | null>(db, KONFIG_SCHLUESSEL, null);
  if (!roh?.clientId) return null;
  return { clientId: roh.clientId, tenantId: roh.tenantId ?? 'common', clientSecret: geheimnisAuspacken(roh.secret) };
}

export async function m365KonfigurationSpeichern(db: Db, e: { clientId: string; tenantId: string; clientSecret?: string }) {
  const alt = await einstellung<{ secret?: string } | null>(db, KONFIG_SCHLUESSEL, null);
  const secret = e.clientSecret ? geheimnisVerpacken(e.clientSecret) : (alt?.secret ?? '');
  await einstellungSpeichern(db, KONFIG_SCHLUESSEL, { clientId: e.clientId.trim(), tenantId: e.tenantId.trim() || 'common', secret });
  await auditSchreiben(db, { type: 'mutation', entity: 'm365', action: 'config', source: '/api/m365/konfiguration', metadata: { clientId: e.clientId, tenantId: e.tenantId, secretGesetzt: Boolean(secret) } });
  return { ok: true as const };
}

export const m365OrdnerLesen = (db: Db) => einstellung<string>(db, ORDNER_SCHLUESSEL, 'inbox');
export async function m365OrdnerSpeichern(db: Db, ordner: string) {
  await einstellungSpeichern(db, ORDNER_SCHLUESSEL, ordner.trim() || 'inbox');
  return { ordner: ordner.trim() || 'inbox' };
}

async function tokenZeile(db: Db) {
  const [z] = await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.account, KONTO));
  return z ?? null;
}

/** Stand für die Oberfläche: eingerichtet, verbunden, mit wem und seit wann. Im Test-Modus liest die Attrappe. */
export async function m365Stand(db: Db, graph?: GraphClient | null, autoImport = true): Promise<M365Stand> {
  const cfg = await m365KonfigurationLesen(db);
  const z = await tokenZeile(db);
  return {
    autoImport,
    eingerichtet: Boolean(cfg?.clientId && cfg.clientSecret),
    clientId: cfg?.clientId ?? '',
    tenantId: cfg?.tenantId ?? '',
    verbunden: Boolean(z?.refreshTokenEnc),
    email: z?.userEmail ?? '',
    verbundenSeit: z?.connectedAt ? new Date(z.connectedAt).toISOString() : null,
    ordner: await m365OrdnerLesen(db),
    scopes: M365_SCOPES,
    testModus: Boolean(graph),
  };
}

function konfigPruefen(cfg: M365Konfiguration | null): M365Konfiguration {
  if (!cfg?.clientId || !cfg.clientSecret) throw new FachFehler(422, 'Microsoft 365 ist nicht eingerichtet (Einstellungen → Microsoft 365).');
  return cfg;
}

/** getAuthorizationUrl: State und Rückadresse werden gemeinsam abgelegt (CSRF-Schutz, zehn Minuten gültig). */
export async function m365AnmeldungStarten(db: Db, redirectUri: string) {
  const cfg = konfigPruefen(await m365KonfigurationLesen(db));
  const state = crypto.randomUUID();
  const offen = await einstellung<Record<string, { erstellt: number; redirectUri: string }>>(db, STATES_SCHLUESSEL, {});
  for (const [s, e] of Object.entries(offen)) if (Date.now() - e.erstellt > STATE_TTL_MS) delete offen[s];
  offen[state] = { erstellt: Date.now(), redirectUri };
  await einstellungSpeichern(db, STATES_SCHLUESSEL, offen);
  return { url: anmeldeAdresse(cfg, redirectUri, state) };
}

/** handleAuthorizationCallback: State einlösen, Code eintauschen, Token verschlüsselt ablegen. */
export async function m365Rueckweg(db: Db, code: string, state: string) {
  const offen = await einstellung<Record<string, { erstellt: number; redirectUri: string }>>(db, STATES_SCHLUESSEL, {});
  const eintrag = offen[state];
  delete offen[state];
  await einstellungSpeichern(db, STATES_SCHLUESSEL, offen);
  if (!eintrag || Date.now() - eintrag.erstellt > STATE_TTL_MS) throw new FachFehler(400, 'Anmeldeversuch unbekannt oder abgelaufen — bitte neu starten.');

  const cfg = konfigPruefen(await m365KonfigurationLesen(db));
  const t = await codeEintauschen(cfg, code, eintrag.redirectUri);
  const jetzt = Date.now();
  await db.insert(schema.oauthTokens).values({
    account: KONTO, provider: 'microsoft', userEmail: t.email, refreshTokenEnc: geheimnisVerpacken(t.refreshToken),
    accessTokenEnc: geheimnisVerpacken(t.accessToken), accessTokenExp: jetzt + t.ablaufSekunden * 1000,
    scopes: M365_SCOPES.join(' '), connectedAt: jetzt, lastRefreshedAt: jetzt,
  }).onConflictDoUpdate({
    target: schema.oauthTokens.account,
    set: { userEmail: t.email, refreshTokenEnc: geheimnisVerpacken(t.refreshToken), accessTokenEnc: geheimnisVerpacken(t.accessToken), accessTokenExp: jetzt + t.ablaufSekunden * 1000, connectedAt: jetzt, lastRefreshedAt: jetzt },
  });
  await auditSchreiben(db, { type: 'mutation', entity: 'm365', action: 'connect', source: '/api/m365/rueckweg', metadata: { email: t.email } });
  return { email: t.email };
}

export async function m365Trennen(db: Db) {
  await db.delete(schema.oauthTokens).where(eq(schema.oauthTokens.account, KONTO));
  await auditSchreiben(db, { type: 'mutation', entity: 'm365', action: 'disconnect', source: '/api/m365/trennen' });
  return { ok: true as const };
}

/** getAccessToken: gültiges Token aus der Ablage, sonst über den Refresh-Token erneuern. */
async function zugriffsToken(db: Db): Promise<string> {
  const z = await tokenZeile(db);
  if (!z?.refreshTokenEnc) throw new FachFehler(422, 'Microsoft 365 ist nicht verbunden.');
  const gueltigBis = z.accessTokenExp ?? 0;
  if (z.accessTokenEnc && gueltigBis > Date.now() + 60_000) return geheimnisAuspacken(z.accessTokenEnc);
  const cfg = konfigPruefen(await m365KonfigurationLesen(db));
  const t = await tokenErneuern(cfg, geheimnisAuspacken(z.refreshTokenEnc));
  const jetzt = Date.now();
  await db.update(schema.oauthTokens).set({
    accessTokenEnc: geheimnisVerpacken(t.accessToken), refreshTokenEnc: geheimnisVerpacken(t.refreshToken),
    accessTokenExp: jetzt + t.ablaufSekunden * 1000, lastRefreshedAt: jetzt,
  }).where(eq(schema.oauthTokens.account, KONTO));
  return t.accessToken;
}

/** Der Graph-Client dieser Verbindung — vorgegeben (Attrappe) oder mit dem hinterlegten Zugang gebaut. */
export const m365Client = async (db: Db, vorgegeben?: GraphClient | null): Promise<GraphClient> =>
  vorgegeben ?? graphClient(() => zugriffsToken(db));

/** Posteingang: die letzten Mails des eingestellten Ordners, gesperrte ausgeblendet. */
export async function m365Posteingang(db: Db, graph: GraphClient | null | undefined, nurNeue = true): Promise<M365Posteingang> {
  const mails = await (await m365Client(db, graph)).angebote(await m365OrdnerLesen(db));
  const gesehen = new Set((await db.select({ uid: schema.mailImportGesehen.uid }).from(schema.mailImportGesehen)).map((g) => g.uid));
  const importiert = await bereitsImportiert(db);
  await db.update(schema.oauthTokens).set({ lastUsedAt: Date.now() }).where(eq(schema.oauthTokens.account, KONTO));
  return {
    ordner: await m365OrdnerLesen(db),
    mails: mails.filter((m) => !nurNeue || !gesehen.has(m.uid)).map((m) => {
      // Triage (Stufe 0): wo steckt das Exposé? Rein gerechnet, ohne Netz, Browser oder KI.
      const t = triageMail({
        from: m.von, subject: m.betreff, bodyText: m.text,
        attachments: m.anhaenge.map((a) => ({ filename: a.filename, sizeMB: a.sizeMB, kind: a.kind })),
        links: m.links,
      });
      const bester = t.candidates.find((k) => k.score >= MIN_CANDIDATE_SCORE) ?? null;
      return {
        uid: m.uid, datum: m.datum, von: m.von, vonName: m.vonName, betreff: m.betreff, vorschau: m.vorschau,
        anhaenge: m.anhaenge.map((a) => ({ id: a.partId, name: a.filename, groesseMb: a.sizeMB, art: a.kind, auswertbar: a.processable })),
        links: m.links.slice(0, 5), anhaengeUnvollstaendig: m.anhaengeUnvollstaendig, gesperrt: gesehen.has(m.uid),
        importiert: importiert.has(m.uid) || importiert.has(m.messageId),
        triage: {
          verdict: t.verdict,
          kandidat: bester ? { quelle: bester.source, ref: bester.ref, code: bester.code, score: bester.score, warum: bester.why } : null,
          gruende: t.reasons.slice(0, 4),
          objektnummern: t.objektnummern.slice(0, 3),
          rechtsdokumente: t.legalAttachments,
        },
      };
    }),
  };
}

/** „🚫 Sperren“: die Mail taucht nicht wieder auf (alt: mail_import_gesehen). */
export async function m365Sperren(db: Db, uid: string) {
  await db.insert(schema.mailImportGesehen).values({ uid }).onConflictDoNothing();
  await auditSchreiben(db, { type: 'import', entity: 'mail', entityId: uid, action: 'block', source: '/api/m365/mails/{uid}/sperren' });
  return { uid, gesperrt: true as const };
}

/**
 * Sperre aufheben. Bewusste Ergänzung: die alte App kannte nur „nie wieder anzeigen“ — eine versehentlich
 * gesperrte Mail war damit für immer weg.
 */
export async function m365Entsperren(db: Db, uid: string) {
  await db.delete(schema.mailImportGesehen).where(eq(schema.mailImportGesehen.uid, uid));
  await auditSchreiben(db, { type: 'import', entity: 'mail', entityId: uid, action: 'unblock', source: '/api/m365/mails/{uid}/sperren' });
  return { uid, gesperrt: false as const };
}

/** Anhang holen (für den Exposé-Import). */
export async function m365Anhang(db: Db, graph: GraphClient | null | undefined, uid: string, anhangId: string) {
  return (await m365Client(db, graph)).anhang(uid, anhangId);
}
