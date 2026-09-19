/**
 * MCP: Bereiche, Schlüsselverzeichnis und die Frage, wer was darf.
 * Wörtlich aus gg-immohandel server/mcp.ts (parseKeyRegistry, isProvenLocal, requiredScope, isToolAllowed)
 * und server/auth.ts (DEPLOY_MARKERS, LOCAL_OPEN_FLAG); geändert: der Hash-Vergleich liegt im Dienst der API,
 * hier bleibt die reine Entscheidung — und `env` wird immer übergeben (die Regel läuft auch im Browser).
 *
 * Voreinstellung ist gesperrt: ein Werkzeug ohne gültigen Bereich ist weder auflistbar noch aufrufbar,
 * ein Verzeichniseintrag, der nicht vollständig passt, wird verworfen statt großzügig ausgelegt.
 */

export const MCP_SCOPES = ['read', 'write', 'outward'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const istMcpScope = (v: unknown): v is McpScope => typeof v === 'string' && (MCP_SCOPES as readonly string[]).includes(v);

export const MCP_SERVER_NAME = 'gg-immobilienhandel';
export const MCP_SERVER_VERSION = '1.0.0';
/** Name der Umgebungsvariable mit den Schlüsseln. */
export const MCP_KEYS_ENV = 'MCP_API_KEYS';
/** Der ausdrückliche Beleg für „das hier ist ein Entwicklungsrechner“. */
export const LOCAL_OPEN_FLAG = 'AUTH_LOCAL_OPEN';
/** Umgebungsvariablen, die es nur auf einer Hosting-Plattform gibt — eine davon widerlegt „lokal“. */
export const DEPLOY_MARKERS = [
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL',
  'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV', 'LAMBDA_TASK_ROOT', 'NOW_REGION',
  'K_SERVICE', 'FUNCTION_TARGET', 'RENDER', 'FLY_APP_NAME', 'RAILWAY_ENVIRONMENT',
  'DYNO', 'WEBSITE_INSTANCE_ID', 'KUBERNETES_SERVICE_HOST',
] as const;

export type Umgebung = Record<string, string | undefined>;

/** isProvenLocal: nur `true`, wenn kein Plattform-Marker gesetzt ist UND der Schalter genau `1` ist. */
export function nachweislichLokal(env: Umgebung): boolean {
  for (const marker of DEPLOY_MARKERS) if ((env[marker] ?? '').trim() !== '') return false;
  return env[LOCAL_OPEN_FLAG] === '1';
}

export interface McpSchluessel { label: string; scopes: McpScope[]; hash: string }
export interface McpVerzeichnis { keys: McpSchluessel[]; rejected: string[] }

const LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Für Meldungen: der Wert kommt aus der Konfiguration und soll dort nichts kaputtmachen, wo er landet. */
const sicheresLabel = (wert: string) => wert.replace(/[^\w.:@+-]/g, '').slice(0, 40) || '(leer)';

/** parseKeyRegistry: `label:scope[+scope…]:sha256hex`, getrennt durch `;`, `,` oder Zeilenumbruch. */
export function schluesselVerzeichnis(roh: string | undefined): McpVerzeichnis {
  const keys: McpSchluessel[] = [];
  const rejected: string[] = [];
  const gesehen = new Set<string>();

  for (const teil of String(roh ?? '').split(/[;,\n]/)) {
    const eintrag = teil.trim();
    if (!eintrag) continue;
    const stuecke = eintrag.split(':');
    if (stuecke.length !== 3) { rejected.push(`"${sicheresLabel(eintrag)}": erwartet wird label:scopes:sha256`); continue; }

    const label = (stuecke[0] ?? '').trim().toLowerCase();
    const scopeText = (stuecke[1] ?? '').trim().toLowerCase();
    const hash = (stuecke[2] ?? '').trim().toLowerCase();

    if (!LABEL_RE.test(label)) { rejected.push(`"${sicheresLabel(label)}": unbrauchbares Label`); continue; }
    if (gesehen.has(label)) { rejected.push(`"${label}": Label doppelt vergeben`); continue; }
    if (!SHA256_HEX_RE.test(hash)) { rejected.push(`"${label}": der Hash ist kein SHA-256 in Hex`); continue; }

    const scopes = scopeText.split('+').map((s) => s.trim()).filter(Boolean);
    if (!scopes.length || !scopes.every(istMcpScope)) {
      rejected.push(`"${label}": unbekannter Bereich (erlaubt: ${MCP_SCOPES.join(', ')})`);
      continue;
    }

    gesehen.add(label);
    keys.push({ label, scopes: [...new Set(scopes as McpScope[])], hash });
  }
  return { keys, rejected };
}

export interface McpWerkzeugSpec { name: string; scope?: string; title?: string; description?: string; inputSchema?: unknown }

/** requiredScope: fehlt der Bereich oder ist er erfunden, gibt es keinen — und damit kein Ja. */
export const verlangterBereich = (spec: McpWerkzeugSpec | null | undefined): McpScope | null =>
  (spec && istMcpScope(spec.scope) ? spec.scope : null);

/** isToolAllowed: `null` als verlangter Bereich ist ein Nein — nicht „egal“ und erst recht kein „dann halt alles“. */
export function werkzeugErlaubt(spec: McpWerkzeugSpec | null | undefined, gewaehrt: readonly McpScope[]): boolean {
  const noetig = verlangterBereich(spec);
  if (noetig === null) return false;
  return Array.isArray(gewaehrt) && gewaehrt.includes(noetig);
}

const WERKZEUG_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** buildToolRegistry: nur vollständige Werkzeuge kommen hinein — der Rest steht mit Grund im Bericht. */
export function werkzeugVerzeichnis(specs: readonly McpWerkzeugSpec[]): { werkzeuge: McpWerkzeugSpec[]; rejected: string[] } {
  const werkzeuge: McpWerkzeugSpec[] = [];
  const rejected: string[] = [];
  const gesehen = new Set<string>();
  for (const spec of specs) {
    if (!spec || !WERKZEUG_NAME_RE.test(spec.name ?? '')) { rejected.push(`"${sicheresLabel(String(spec?.name ?? ''))}": unbrauchbarer Name`); continue; }
    if (gesehen.has(spec.name)) { rejected.push(`"${spec.name}": Name doppelt vergeben`); continue; }
    if (verlangterBereich(spec) === null) { rejected.push(`"${spec.name}": kein gültiger Bereich (${MCP_SCOPES.join(', ')})`); continue; }
    gesehen.add(spec.name);
    werkzeuge.push(spec);
  }
  return { werkzeuge, rejected };
}

/** Lokal gilt der volle Bereichssatz; `outward` legt nur einen Antrag an, ausgeführt wird nichts. */
export const LOKALE_SCOPES: readonly McpScope[] = [...MCP_SCOPES];

export const MCP_FEHLERTEXTE = {
  'no-key': { status: 401, message: 'Kein MCP-API-Schlüssel übermittelt. Header "Authorization: Bearer <key>" setzen.' },
  'invalid-key': { status: 401, message: 'Der MCP-API-Schlüssel ist ungültig oder wurde widerrufen.' },
  'not-configured': { status: 500, message: 'Auf diesem Server ist kein MCP-Schlüssel eingerichtet. Bitte den Betreiber informieren.' },
} as const;
export type McpFehlerCode = keyof typeof MCP_FEHLERTEXTE;

/** Schlüssel aus den Kopfzeilen — nur Kopfzeilen: ein Cookie wäre bei jedem fremden POST dabei. */
export function mcpSchluesselAusKopf(kopf: Record<string, string | string[] | undefined>): string | null {
  const erster = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(erster(kopf.authorization ?? kopf.Authorization).trim());
  if (bearer) return (bearer[1] ?? '').trim() || null;
  const direkt = erster(kopf['x-mcp-key'] ?? kopf['X-MCP-Key']).trim();
  return direkt || null;
}
