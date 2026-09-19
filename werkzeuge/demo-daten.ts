/**
 * Demo-Daten für die lokale Entwicklung — über die echten Wege der App.
 *
 * `supabase/seed.sql` legt beim `db:reset` Makler, Objekte und Deals an, aber keine Dateien:
 * SQL kann nichts in den Speicher (Bucket) legen. Genau das fehlte beim Ausprobieren — ein Deal
 * ohne Exposé zeigt kein 📄 und man kann nichts öffnen.
 *
 * Dieses Skript geht deshalb den Weg, den auch die Oberfläche geht: Exposé hochladen → analysieren
 * → übernehmen. Dabei entstehen Objekt, Makler, Deal, Einheiten, Kalkulation, Statushistorie und
 * das PDF im Speicher — alles konsistent, weil es dieselben Dienste durchläuft.
 *
 *   pnpm demo:daten            (API muss laufen, KI_ATTRAPPE=1)
 *
 * Mehrfaches Ausführen ist gutmütig: bereits vorhandene Demo-Deals werden übersprungen.
 */
import { testExpose } from '@gg/integrations';

const API = process.env.API_URL ?? 'http://localhost:3101';

const BEISPIELE = [
  { kennung: 'Demoweg', ort: 'Ulm' },
  { kennung: 'Musterallee', ort: 'Augsburg' },
] as const;

async function json<T>(pfad: string, daten: unknown): Promise<T> {
  const r = await fetch(`${API}${pfad}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten),
  });
  const rumpf = await r.json().catch(() => null) as T & { fehler?: string; felder?: string[] };
  if (!r.ok) throw new Error(`${pfad} [${r.status}] ${rumpf?.fehler ?? ''} ${(rumpf?.felder ?? []).join(' · ')}`);
  return rumpf;
}

async function bereit(): Promise<void> {
  const r = await fetch(`${API}/api/ki/status`).catch(() => null);
  if (!r?.ok) throw new Error(`Die API antwortet nicht auf ${API} — läuft "pnpm dev"?`);
  const stand = await r.json() as { verfuegbar: boolean; attrappe: boolean; ablage: boolean };
  if (!stand.ablage) throw new Error('Keine Dateiablage eingerichtet (SUPABASE_SERVICE_ROLE_KEY fehlt).');
  if (!stand.verfuegbar) throw new Error('Keine KI eingerichtet — für Demo-Daten reicht KI_ATTRAPPE=1.');
  if (!stand.attrappe) console.warn('⚠  Echte KI aktiv: die Demo-Exposés kosten Aufrufe. KI_ATTRAPPE=1 vermeidet das.');
}

async function schonDa(kennung: string): Promise<boolean> {
  const r = await fetch(`${API}/api/listen`);
  const listen = await r.json() as { objekte: { strasse?: string | null }[] };
  return listen.objekte.some((o) => (o.strasse ?? '').startsWith(kennung));
}

await bereit();
for (const { kennung, ort } of BEISPIELE) {
  if (await schonDa(kennung)) { console.log(`· ${kennung}: schon vorhanden, übersprungen`); continue; }

  const dateiname = `Exposé ${kennung} (Demo).pdf`;
  const hoch = await fetch(`${API}/api/expose/eingang`, {
    method: 'POST', headers: { 'content-type': 'application/pdf' }, body: testExpose(kennung),
  });
  const { key } = await hoch.json() as { key: string };

  const a = await json<{ extrahiert: unknown; objekt: Record<string, unknown>; makler: Record<string, unknown>; deal: unknown }>(
    '/api/expose/analyse', { key, dateiname },
  );
  const r = await json<{ dealId: string; pdfGespeichert: boolean }>('/api/expose/uebernehmen', {
    key, dateiname, extrahiert: a.extrahiert,
    objekt: { daten: { ...a.objekt, stadt: ort } }, makler: { daten: a.makler }, deal: a.deal,
  });
  console.log(`✓ ${kennung}, ${ort} → Deal ${r.dealId.slice(0, 8)} · Exposé gespeichert: ${r.pdfGespeichert}`);
}
console.log('\nFertig. Die Deals stehen unter /deals — das 📄 in der Liste öffnet das Exposé.');
