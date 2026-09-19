/**
 * Microsoft 365: OAuth (Authorization Code) und die lesenden Graph-Aufrufe.
 * Nach gg-immohandel server/oauth.ts und server/graph.ts; geändert: ohne MSAL — die drei Aufrufe
 * (Anmeldeadresse, Code eintauschen, Token erneuern) sind einfache HTTPS-Anfragen, und der Zugriff
 * bleibt lesend (keine Schreib-Scopes).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Graph liefert lose typisierte Antworten */
import { anhangEinordnen, anhangRelevant, type MailAnhang, mailKlartext, mailLinks, type OfferAttachment } from '@gg/domain';
import { testExpose } from '../test/pdf-basteln.ts';

export const GRAPH_BASIS = 'https://graph.microsoft.com/v1.0';
export const M365_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.ReadBasic',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];

export interface M365Konfiguration { clientId: string; clientSecret: string; tenantId: string }
export interface M365Token { accessToken: string; refreshToken: string; ablaufSekunden: number; email: string }

const anmeldeBasis = (tenantId: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenantId || 'common')}/oauth2/v2.0`;

/** getAuthorizationUrl: `prompt=select_account` wie alt. */
export function anmeldeAdresse(cfg: M365Konfiguration, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
    scope: M365_SCOPES.join(' '), state, prompt: 'select_account',
  });
  return `${anmeldeBasis(cfg.tenantId)}/authorize?${p.toString()}`;
}

async function token(cfg: M365Konfiguration, daten: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }> {
  const res = await fetch(`${anmeldeBasis(cfg.tenantId)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: M365_SCOPES.join(' '), ...daten }).toString(),
  });
  const body = await res.json().catch(() => ({})) as { error_description?: string; access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`Microsoft antwortete mit ${res.status}: ${body.error_description ?? 'kein Token'}`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in ?? 3600, id_token: body.id_token };
}

/** E-Mail aus dem id_token (nur zur Anzeige; geprüft wird sie nicht — das Token kommt direkt von Microsoft). */
function emailAusIdToken(idToken?: string): string {
  const teil = idToken?.split('.')[1];
  if (!teil) return '';
  try {
    const roh = JSON.parse(Buffer.from(teil.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { preferred_username?: string; email?: string };
    return roh.preferred_username ?? roh.email ?? '';
  } catch {
    return '';
  }
}

export async function codeEintauschen(cfg: M365Konfiguration, code: string, redirectUri: string): Promise<M365Token> {
  const t = await token(cfg, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? '', ablaufSekunden: t.expires_in, email: emailAusIdToken(t.id_token) };
}

export async function tokenErneuern(cfg: M365Konfiguration, refreshToken: string): Promise<M365Token> {
  const t = await token(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, ablaufSekunden: t.expires_in, email: emailAusIdToken(t.id_token) };
}

// ── Lesende Aufrufe ─────────────────────────────────────────

export interface OfferMail {
  uid: string; messageId: string; datum: string; von: string; vonName: string; betreff: string;
  vorschau: string; text: string; anhaenge: OfferAttachment[]; links: string[]; anhaengeUnvollstaendig: boolean;
}

export interface GraphClient {
  wer(): Promise<{ name: string; email: string }>;
  angebote(ordner?: string): Promise<OfferMail[]>;
  anhang(messageId: string, anhangId: string): Promise<Uint8Array>;
}

/** Graph drosselt (429) und meldet Überlast (5xx) — beides ist vorübergehend und wird wiederholt. */
const WIEDERHOLBAR = new Set([429, 500, 502, 503, 504]);
const VERSUCHE = 4;

export function graphClient(accessToken: () => Promise<string>, basis = GRAPH_BASIS): GraphClient {
  const rufe = async <T>(pfad: string): Promise<T> => {
    let letzter = '';
    for (let versuch = 1; versuch <= VERSUCHE; versuch++) {
      const res = await fetch(pfad.startsWith('http') ? pfad : basis + pfad, {
        headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
      });
      if (res.ok) return res.json() as Promise<T>;
      letzter = `Graph ${res.status} bei ${pfad}: ${(await res.text()).substring(0, 300)}`;
      if (!WIEDERHOLBAR.has(res.status) || versuch === VERSUCHE) throw new Error(letzter);
      const kopf = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(kopf) ? kopf * 1000 : 1000 * 2 ** (versuch - 1), 20_000)));
    }
    throw new Error(letzter);
  };

  return {
    async wer() {
      const d = await rufe<{ displayName?: string; mail?: string; userPrincipalName?: string }>('/me');
      return { name: d.displayName ?? '', email: d.mail ?? d.userPrincipalName ?? '' };
    },
    async angebote(ordner) {
      const pfad = ordner && ordner.toLowerCase() !== 'inbox' ? `/me/mailFolders/${encodeURIComponent(ordner)}` : '/me/mailFolders/inbox';
      const select = 'id,internetMessageId,subject,from,receivedDateTime,bodyPreview,body,hasAttachments';
      const d = await rufe<{ value: Record<string, any>[] }>(`${pfad}/messages?$select=${select}&$top=50&$orderby=receivedDateTime desc`);
      const mails: OfferMail[] = [];
      for (const m of d.value ?? []) {
        let anhaenge: OfferAttachment[] = [];
        let unvollstaendig = false;
        if (m.hasAttachments) {
          try {
            const a = await rufe<{ value: MailAnhang[] }>(`/me/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline`);
            anhaenge = (a.value ?? []).filter(anhangRelevant).map(anhangEinordnen);
          } catch {
            // Die leere Liste wäre hier eine Lüge — sie wird als unvollständig gekennzeichnet
            unvollstaendig = true;
          }
        }
        mails.push({
          uid: m.id, messageId: m.internetMessageId ?? m.id, datum: m.receivedDateTime ?? '',
          von: m.from?.emailAddress?.address ?? '', vonName: m.from?.emailAddress?.name ?? '',
          betreff: m.subject ?? '(kein Betreff)', vorschau: (m.bodyPreview ?? '').substring(0, 300),
          text: mailKlartext(m.body).substring(0, 5000), anhaenge, links: mailLinks(m.body), anhaengeUnvollstaendig: unvollstaendig,
        });
      }
      return mails;
    },
    async anhang(messageId, anhangId) {
      const res = await fetch(`${basis}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(anhangId)}/$value`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
      });
      if (!res.ok) throw new Error(`Graph ${res.status} beim Anhang: ${(await res.text()).substring(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Attrappe für Tests und lokale Läufe (M365_ATTRAPPE=1): zwei Mails, eine mit einem echten Test-Exposé. */
export function graphAttrappe(): GraphClient {
  const pdf = testExpose('Musterweg');
  return {
    async wer() { return { name: 'Test-Modus', email: 'test@example.test' }; },
    async angebote() {
      return [
        {
          uid: 'mail-1', messageId: '<1@example.test>', datum: '2026-09-16T08:30:00Z', von: 'makler@example.test', vonName: 'Anna Beispiel',
          betreff: 'Angebot: Musterweg 1', vorschau: 'Anbei das Exposé (Test-Modus)', text: 'Anbei das Exposé (Test-Modus)',
          anhaenge: [{ partId: 'att-1', filename: 'Expose.pdf', sizeMB: 0.01, mime: 'application/pdf', kind: 'pdf', processable: true }],
          links: ['https://immo.example.test/expose/1'], anhaengeUnvollstaendig: false,
        },
        {
          uid: 'mail-2', messageId: '<2@example.test>', datum: '2026-09-15T12:00:00Z', von: 'newsletter@example.test', vonName: 'Portal',
          betreff: 'Neue Objekte in Ihrer Region', vorschau: 'Newsletter (Test-Modus)', text: 'Newsletter (Test-Modus)',
          anhaenge: [], links: ['https://portal.example.test/objekt/9'], anhaengeUnvollstaendig: false,
        },
      ];
    },
    async anhang() { return pdf; },
  };
}
