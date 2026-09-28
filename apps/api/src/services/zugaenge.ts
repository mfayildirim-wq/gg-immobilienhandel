import type { ZugangStatus } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { geheimnisAuspacken, geheimnisMaske, geheimnisVerpacken } from '@gg/integrations';
import { eq, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';

/** Zugänge, die in den Einstellungen hinterlegt werden können (alt: Einstellungen → API-Schlüssel). */
export const ZUGAENGE = [
  { schluessel: 'anthropic-api-key', label: 'Anthropic (Claude)', umgebung: 'ANTHROPIC_API_KEY', hinweis: 'Für Exposé-Analyse, Makler-KI und Einheiten-Erkennung.',
    quelleUrl: 'https://console.anthropic.com/settings/keys', quelleText: 'console.anthropic.com' },
  { schluessel: 'openai-api-key', label: 'OpenAI', umgebung: 'OPENAI_API_KEY', hinweis: 'Transkription (Anrufe, Mikrofon in Firefox) und — wenn gewählt — Modell des AgentMode.',
    quelleUrl: 'https://platform.openai.com/api-keys', quelleText: 'platform.openai.com' },
  { schluessel: 'deepseek-api-key', label: 'DeepSeek', umgebung: 'DEEPSEEK_API_KEY', hinweis: 'Nur für den AgentMode, wenn dort DeepSeek gewählt ist.',
    quelleUrl: 'https://platform.deepseek.com/api_keys', quelleText: 'platform.deepseek.com' },
  { schluessel: 'moonshot-api-key', label: 'Kimi (Moonshot)', umgebung: 'MOONSHOT_API_KEY', hinweis: 'Nur für den AgentMode, wenn dort Kimi gewählt ist.',
    quelleUrl: 'https://platform.moonshot.ai/console/api-keys', quelleText: 'platform.moonshot.ai' },
  { schluessel: 'openrouter-api-key', label: 'OpenRouter', umgebung: 'OPENROUTER_API_KEY', hinweis: 'Nur für den AgentMode, wenn dort OpenRouter gewählt ist — auch kostenlose Modelle.',
    quelleUrl: 'https://openrouter.ai/settings/keys', quelleText: 'openrouter.ai' },
  { schluessel: 'propstack-api-key', label: 'Propstack', umgebung: 'PROPSTACK_API_KEY', hinweis: 'Für die Bewertung von Einheiten.',
    quelleUrl: 'https://crm.propstack.de/app/admin/api_keys', quelleText: 'crm.propstack.de/app/admin/api_keys' },
] as const;
export type ZugangSchluessel = (typeof ZUGAENGE)[number]['schluessel'];

const bekannt = (s: string): s is ZugangSchluessel => ZUGAENGE.some((z) => z.schluessel === s);

/** Schlüssel im Klartext — nur für den Server, nie an die Oberfläche. */
export async function zugangLesen(db: Db, schluessel: ZugangSchluessel): Promise<string> {
  const [z] = await db.select({ wert: schema.geheimnisse.wertVerschluesselt }).from(schema.geheimnisse).where(eq(schema.geheimnisse.schluessel, schluessel));
  try {
    return geheimnisAuspacken(z?.wert);
  } catch (e) {
    console.error('[zugaenge] Wert nicht lesbar (falscher GG_ENCRYPTION_KEY?):', schluessel, e);
    return '';
  }
}

/** Status für die Oberfläche: hinterlegt oder aus der Umgebung, maskiert. */
export async function zugangStatus(db: Db): Promise<ZugangStatus[]> {
  return Promise.all(ZUGAENGE.map(async (z) => {
    const gespeichert = await zugangLesen(db, z.schluessel);
    const ausUmgebung = process.env[z.umgebung] ?? '';
    return {
      schluessel: z.schluessel, label: z.label, hinweis: z.hinweis, umgebung: z.umgebung,
      quelleUrl: z.quelleUrl, quelleText: z.quelleText,
      quelle: gespeichert ? ('einstellungen' as const) : ausUmgebung ? ('umgebung' as const) : ('fehlt' as const),
      maske: geheimnisMaske(gespeichert || ausUmgebung),
    };
  }));
}

export async function zugangSpeichern(db: Db, schluessel: string, wert: string) {
  if (!bekannt(schluessel)) throw new FachFehler(400, `Unbekannter Zugang „${schluessel}“`);
  const verpackt = geheimnisVerpacken(wert.trim());
  await db.insert(schema.geheimnisse).values({ schluessel, wertVerschluesselt: verpackt, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.geheimnisse.schluessel, set: { wertVerschluesselt: verpackt, updatedAt: sql`now()` } });
  await auditSchreiben(db, { type: 'mutation', entity: 'zugang', entityId: schluessel, action: wert.trim() ? 'set' : 'clear', source: '/api/zugaenge' });
  return { schluessel, gesetzt: Boolean(wert.trim()) };
}
