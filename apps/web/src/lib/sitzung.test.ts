/** Cookie-Spiegel und „keine Anmeldung eingerichtet“ (nach session.ts der alten App). */
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_COOKIE, anmelden, anmeldungEingerichtet, cookieSchreiben, sitzungStarten, zugriffsToken } from './sitzung.ts';

describe('Sitzung ohne eingerichtete Anmeldung', () => {
  beforeEach(() => { document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0`; });

  it('ist still: kein Klient, kein Token, klare Meldung', async () => {
    expect(anmeldungEingerichtet()).toBe(false);
    await expect(sitzungStarten()).resolves.toBeNull();
    await expect(zugriffsToken()).resolves.toBeNull();
    await expect(anmelden('a@b.test', 'geheim')).resolves.toEqual({ ok: false, fehler: 'Für diese Umgebung ist keine Anmeldung eingerichtet.' });
  });

  it('schreibt und löscht den Cookie-Spiegel', () => {
    cookieSchreiben({ access_token: 'token-123', expires_at: Math.floor(Date.now() / 1000) + 3600 } as never);
    expect(document.cookie).toContain(`${AUTH_COOKIE}=token-123`);
    cookieSchreiben(null);
    expect(document.cookie).not.toContain('token-123');
  });
});
