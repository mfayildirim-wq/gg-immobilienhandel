/**
 * Rücksprung-Adresse der Microsoft-Anmeldung: nur auf freigegebene Hosts.
 *
 * Die Oberfläche schickt die Adresse mit, an die Microsoft nach der Anmeldung zurückleitet
 * (`<eigene Adresse>/m365/rueckweg`). Ungeprüft wäre das ein Feld, das ein Fremder frei wählen kann — mit einer
 * eigenen Adresse darin landete der Anmeldecode bei ihm. Azure AD weist zwar jede nicht registrierte Adresse ab,
 * aber das ist die Hürde eines anderen; diese hier sorgt dafür, dass eine fremde Adresse gar nicht erst in einen
 * Anmeldeversuch gerät. Regeln wie `server/oauth-redirect.ts` der alten App:
 *
 * - online zählt ausschließlich die Liste (eigene Vercel-Domains + `OAUTH_HOSTS`), immer https
 * - lokal sind Loopback- und Heimnetz-Adressen zusätzlich ohne Eintrag erlaubt
 * - ein Eintrag mit Port muss exakt passen, einer ohne Port gilt für jeden Port
 */
export const RUECKWEG_PFAD = '/m365/rueckweg';
export const OAUTH_HOSTS_VARIABLE = 'OAUTH_HOSTS';

/** Variablen, in denen Vercel dem Deployment die eigenen Domains mitgibt — nackte Hostnamen ohne Schema. */
const VERCEL_HOST_VARIABLEN = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL'];

// Loopback, die drei privaten IPv4-Bereiche und Tailscale (100.64.0.0/10)
const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const istPrivat = (hostname: string) =>
  hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '[::1]' || PRIVATE_IPV4.test(hostname);

/** Nimmt auch eine ganze URL — wer die Variable füllt, kopiert die Adresse meist aus der Adressleiste. */
const hostAusEintrag = (roh: string) => roh.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '');

export interface RueckwegRegeln { online: boolean; erlaubteHosts: string[] }

export function rueckwegRegelnAusUmgebung(env: Record<string, string | undefined>): RueckwegRegeln {
  const online = !!env.VERCEL;
  const roh = [...(online ? VERCEL_HOST_VARIABLEN.map((v) => env[v] ?? '') : []), ...(env[OAUTH_HOSTS_VARIABLE] ?? '').split(',')];
  return { online, erlaubteHosts: [...new Set(roh.map(hostAusEintrag).filter(Boolean))] };
}

export type RueckwegErgebnis = { ok: true; uri: string } | { ok: false; grund: string };

export function rueckwegPruefen(adresse: string, regeln: RueckwegRegeln): RueckwegErgebnis {
  let url: URL;
  try { url = new URL(adresse); } catch { return { ok: false, grund: 'Die Rücksprung-Adresse ist keine gültige Adresse.' }; }
  if (url.pathname !== RUECKWEG_PFAD || url.search || url.hash || url.username || url.password) {
    return { ok: false, grund: `Die Rücksprung-Adresse muss genau auf ${RUECKWEG_PFAD} zeigen.` };
  }
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const gelistet = regeln.erlaubteHosts.some((e) => (e.includes(':') ? e === host : e === hostname));
  if (!gelistet && !(!regeln.online && istPrivat(hostname))) {
    const bekannt = regeln.erlaubteHosts.length ? `Freigegeben sind: ${regeln.erlaubteHosts.join(', ')}.` : 'Zurzeit ist keine Adresse freigegeben.';
    return {
      ok: false,
      grund: `Der Host „${host}" ist für die Microsoft-Anmeldung nicht freigegeben. ${bekannt} Weitere Adressen kommagetrennt in ` +
        `${OAUTH_HOSTS_VARIABLE} eintragen — und dieselbe Adresse in Azure AD als Redirect-URI registrieren, sonst weist Microsoft die Anmeldung ab.`,
    };
  }
  const https = url.protocol === 'https:';
  if (regeln.online && !https) return { ok: false, grund: 'Online muss die Rücksprung-Adresse mit https beginnen.' };
  if (!https && url.protocol !== 'http:') return { ok: false, grund: 'Die Rücksprung-Adresse muss mit http oder https beginnen.' };
  return { ok: true, uri: url.toString() };
}
