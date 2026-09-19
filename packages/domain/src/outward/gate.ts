/**
 * Default-Deny-Gate für Aktionen nach außen. Wörtlich aus gg-immohandel server/outward-gate.ts
 * (Beschluss wayfinder/tickets/008-default-deny-gate.md); geändert: nur der reine Teil (evaluateOutward),
 * ohne Datenbank und ohne Audit — beides liegt im Dienst der API.
 *
 * Erlaubt wird nur, wenn JEDE Bedingung ausdrücklich mit true beantwortet ist. Eine Bedingung, die
 * niemand auswertet, fehlt in der Map — und `every` liest sie als „nicht erfüllt“.
 */
export const OUTWARD_ACTIONS = {
  /** Auto-Import-Engine: AGB-/Provisions-Checkbox anhaken und absenden. */
  AGB_SUBMIT: 'agb-submit',
  /** Propstack-CRM: Einheit anlegen (`POST /units`). */
  PROPSTACK_UNIT_CREATE: 'propstack-unit-create',
} as const;

export type OutwardAction = (typeof OUTWARD_ACTIONS)[keyof typeof OUTWARD_ACTIONS];

/** Schlüssel der App-Einstellungen (im Neubau `fach.einstellungen`). Hier liegen nur Schalter und Hostnamen, keine Geheimnisse. */
export const OUTWARD_SETTINGS_KEY = 'outward-gate';

/** Form der App-Einstellungen. Alle Felder optional und alle Defaults „aus":
 *  ein fehlender Schlüssel muss dasselbe bedeuten wie `false`. */
export interface OutwardGateSettings {
  /** Schalter für den AGB-/Provisions-Submit im Auto-Import. */
  allowAgbSubmit?: boolean;
  /** Schalter für `POST /units` an Propstack. */
  allowPropstackWrite?: boolean;
  /** Zusätzliche Makler-/Portal-Hosts für den AGB-Submit, pflegbar in den
   *  App-Einstellungen. Ergänzt die Code-Liste, ersetzt sie nicht. */
  extraAgbHosts?: string[];
}

/** Die Bedingungen der UND-Verknüpfung. Reihenfolge = Reihenfolge im Klartext. */
export const OUTWARD_CONDITIONS = ['action', 'kill-switch', 'environment', 'toggle', 'target'] as const;

/** `audit` gehört nicht zur reinen Auswertung: die Bedingung entsteht erst,
 *  wenn der Audit-Eintrag geschrieben werden soll (siehe checkOutwardAction). */
export type OutwardCondition = (typeof OUTWARD_CONDITIONS)[number] | 'audit';

export interface OutwardDecision {
  allowed: boolean;
  /** Der angefragte Aktionsname — auch dann, wenn er unbekannt ist. */
  action: string;
  /** Ziel-Hostname, `null` wenn die URL nicht lesbar war. Nie die volle URL:
   *  Exposé-Links tragen Zugangs-Token im Pfad und in der Query. */
  host: string | null;
  /** Alle nicht erfüllten Bedingungen, nicht nur die erste — sonst blockiert
   *  der zweite Grund direkt nach dem Beheben des ersten erneut. */
  failed: OutwardCondition[];
  /** Klartext für Log, Run-Ergebnis und HTTP-Antwort. Enthält Aktionsname,
   *  Hostname und die verletzten Bedingungen — keine Secrets, keine volle URL. */
  reason: string;
}

export interface OutwardInput {
  /** Absichtlich `string` statt OutwardAction: unbekannte Namen sollen zur
   *  Laufzeit blockieren, nicht bloß den Compiler ärgern. */
  action: string;
  /** Ziel der Aktion (Formular-Seite bzw. API-Endpunkt). */
  url: string;
  /** Umgebung. Im Neubau immer übergeben — die Regel läuft auch im Browser, wo es kein process.env gibt. */
  env?: Record<string, string | undefined>;
  /** Rohwert aus dem KV-Store — absichtlich ungetypt, er kommt aus der DB. */
  settings?: unknown;
}

// ── Whitelist ─────────────────────────────────────────────────
// Startbestand aus den bisher real importierten Quellen (Mail-Fixtures unter
// server/__fixtures__/mails). Eingetragen wird die registrierbare Domain; der
// Abgleich lässt echte Subdomains zu (immo.fio.de, portal.fio.de, ssl3.…).
//
// `landingpage.immobilien` ist ein Mehrmandanten-Host eines Exposé-Anbieters —
// der Eintrag erlaubt damit auch fremde Mandanten. Enger geht es nicht, ohne
// jeden Makler einzeln zu pflegen; die Alternative wäre, die Domain zu streichen
// und Gerry sie bei Bedarf in den Einstellungen ergänzen zu lassen.
const AGB_SUBMIT_HOSTS = [
  'immobilienscout24.de',
  'fio.de',
  'fioport.de',
  'garant-immo.de',
  'deutsche-bank-immobilien.de',
  'landingpage.immobilien',
] as const;

/** Propstack spricht nur einen Host an, und der steht fest im Code. Diese Liste
 *  ist bewusst nicht über die Einstellungen erweiterbar: ein CRM-Write gehört
 *  ins CRM und nirgendwo sonst hin. */
const PROPSTACK_HOSTS = ['api.propstack.de'] as const;

export const DEFAULT_ALLOWED_HOSTS: Record<OutwardAction, readonly string[]> = {
  [OUTWARD_ACTIONS.AGB_SUBMIT]: AGB_SUBMIT_HOSTS,
  [OUTWARD_ACTIONS.PROPSTACK_UNIT_CREATE]: PROPSTACK_HOSTS,
};

interface ActionSpec {
  /** Der Einstellungs-Schalter dieser Aktion. */
  toggle: keyof OutwardGateSettings;
  hosts: readonly string[];
  /** Feld in den Einstellungen, das die Host-Liste ergänzen darf. */
  extraHostsField?: keyof OutwardGateSettings;
  label: string;
}

const REGISTRY: Record<OutwardAction, ActionSpec> = {
  [OUTWARD_ACTIONS.AGB_SUBMIT]: {
    toggle: 'allowAgbSubmit',
    hosts: AGB_SUBMIT_HOSTS,
    extraHostsField: 'extraAgbHosts',
    label: 'AGB-/Provisionsbestätigung absenden',
  },
  [OUTWARD_ACTIONS.PROPSTACK_UNIT_CREATE]: {
    toggle: 'allowPropstackWrite',
    hosts: PROPSTACK_HOSTS,
    label: 'Einheit in Propstack anlegen',
  },
};

// ── Bausteine ─────────────────────────────────────────────────

/** Hostname einer Ziel-URL, oder `null` wenn daraus nichts Belastbares wird.
 *
 *  Nur https: eine Provisionsbestätigung oder ein CRM-Write über Klartext-HTTP
 *  ist auf dem Weg veränderbar. Alle bekannten Portale sprechen https. */
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;                        // relativ, ohne Schema, Müll → kein Ziel
  }
  if (parsed.protocol !== 'https:') return null;
  // Der Punkt am Ende ist gültige DNS-Schreibweise ("propstack.de.") und würde
  // sonst an jedem Listenvergleich vorbeilaufen.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return host || null;
}

/** Gehört `host` zu einem Whitelist-Eintrag?
 *
 *  Verglichen wird gegen den geparsten Hostnamen, nicht gegen die URL —
 *  `https://boese.example/?x=propstack.de` enthält den Eintrag als Zeichenkette,
 *  ist aber ein anderes Ziel. Und der Subdomain-Fall braucht den Punkt:
 *  `endsWith('propstack.de')` würde `evilpropstack.de` durchlassen. */
function hostMatches(host: string, entries: readonly string[]): boolean {
  return entries.some((entry) => host === entry || host.endsWith('.' + entry));
}

/** Mindestens zwei Labels, letztes rein alphabetisch — damit ein verrutschter
 *  Eintrag wie „de" oder „*" nicht das halbe Netz freischaltet. */
const HOST_ENTRY = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

function normalizeHostEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const entry = raw.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
    if (HOST_ENTRY.test(entry)) out.push(entry);
  }
  return out;
}

/** Nur ein echtes `true` schaltet frei. `"true"`, `1` oder `"on"` aus einem
 *  handgeschriebenen KV-Eintrag sind kein Ja. */
function toggleOn(settings: unknown, field: string): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>)[field] === true;
}

function settingsField(settings: unknown, field: string): unknown {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  return (settings as Record<string, unknown>)[field];
}

/** Für Meldungen: der Aktionsname kommt vom Aufrufer und landet im Log. */
function safeLabel(value: string): string {
  return value.replace(/[^\w.:@-]/g, '').slice(0, 40) || '(leer)';
}

// ── Auswertung ────────────────────────────────────────────────

interface ConditionResult {
  ok: boolean;
  /** Nur gesetzt, wenn `ok === false`. */
  why?: string;
}

/** Die reine Entscheidung. Kein IO, kein Zufall — zweimal derselbe Input ergibt
 *  zweimal dasselbe Urteil, und genau das prüfen die Tests. */
export function evaluateOutward(input: OutwardInput): OutwardDecision {
  const env = input.env ?? {};
  const settings = input.settings;
  const action = typeof input.action === 'string' ? input.action : '';
  const spec = (REGISTRY as Record<string, ActionSpec | undefined>)[action];
  const host = hostOf(input.url);

  const results = new Map<string, ConditionResult>();

  results.set('action', spec
    ? { ok: true }
    : { ok: false, why: `unbekannte Aktion "${safeLabel(action)}" — nicht im Gate registriert` });

  // Not-Aus: jeder nichtleere Wert sperrt. Wer die Sperre versehentlich mit
  // OUTWARD_GATE_KILL=false setzt, hat gesperrt — nicht freigeschaltet.
  const kill = env.OUTWARD_GATE_KILL;
  results.set('kill-switch', kill
    ? { ok: false, why: 'Not-Aus OUTWARD_GATE_KILL ist gesetzt' }
    : { ok: true });

  // Scharf ausschließlich in der echten Umgebung: Vercel-Production. Lokal
  // (kein VERCEL) und auf Preview-Deployments ist alles gesperrt — dort laufen
  // E2E- und Browser-Checks, die sonst bei echten Maklern absenden würden.
  const onVercelProd = env.VERCEL === '1' && env.VERCEL_ENV === 'production';
  results.set('environment', onVercelProd
    ? { ok: true }
    : { ok: false, why: 'nicht die scharfe Umgebung (frei nur auf Vercel-Production)' });

  results.set('toggle', spec && toggleOn(settings, spec.toggle)
    ? { ok: true }
    : { ok: false, why: spec
        ? `Schalter "${spec.toggle}" in den App-Einstellungen ist aus`
        : 'kein Schalter vorhanden (Aktion unbekannt)' });

  if (!spec) {
    results.set('target', { ok: false, why: 'keine Whitelist vorhanden (Aktion unbekannt)' });
  } else if (!host) {
    results.set('target', { ok: false, why: 'Ziel-URL ist nicht lesbar oder nicht https' });
  } else {
    const allowedHosts = spec.extraHostsField
      ? [...spec.hosts, ...normalizeHostEntries(settingsField(settings, spec.extraHostsField))]
      : spec.hosts;
    results.set('target', hostMatches(host, allowedHosts)
      ? { ok: true }
      : { ok: false, why: `Ziel-Host "${host}" steht nicht auf der Whitelist der Aktion` });
  }

  // Der eine Ort, an dem „erlaubt" entstehen kann: jede Bedingung muss
  // ausdrücklich mit true beantwortet sein. Eine nicht gesetzte Bedingung ist
  // `undefined` und damit ein Nein.
  const failed = OUTWARD_CONDITIONS.filter((id) => results.get(id)?.ok !== true);
  const allowed = failed.length === 0;

  const reason = allowed
    ? `Outward-Aktion "${safeLabel(action)}" freigegeben (Ziel ${host}, alle ${OUTWARD_CONDITIONS.length} Bedingungen erfüllt)`
    : `Outward-Aktion "${safeLabel(action)}" blockiert: ` +
      failed.map((id) => `[${id}] ${results.get(id)?.why ?? 'nicht ausgewertet'}`).join(' | ');

  return { allowed, action, host, failed: [...failed], reason };
}

