import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Spielt einen Browser-Export der alten App („⬇ Backup exportieren", Format 3, flach) in die **lokale**
 * Datenbank der alten App ein — damit der Umzug gegen den echten Bestand geprüft werden kann.
 *
 *   pnpm umzug:quelle <datei.json>                → Vorschau, schreibt nichts
 *   pnpm umzug:quelle <datei.json> --ausfuehren   → schreibt in EINER Transaktion
 *
 * Das Ziel ist QUELLE_DATABASE_URL (Standard: lokale gg-immohandel-Supabase, Port 54322) und muss lokal sein.
 * Dafür gibt es bewusst keinen Freigabe-Schalter: dieses Werkzeug überschreibt Bestände, und die einzige
 * nicht-lokale Datenbank der alten App ist die Produktion.
 *
 * Geschrieben werden nur Geschäftsschlüssel (`immo-…`, ohne `immo-pin`) — dieselbe Menge, die der Umzug liest.
 * Schlüssel, die in der Datei fehlen, bleiben unangetastet und stehen im Bericht.
 */
const [datei] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ausfuehren = process.argv.includes('--ausfuehren');
const zielUrl = process.env.QUELLE_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!datei) throw new Error('Aufruf: pnpm umzug:quelle <datei.json> [--ausfuehren]');
if (!['127.0.0.1', 'localhost'].includes(new URL(zielUrl).hostname)) {
  throw new Error(`Ziel ${new URL(zielUrl).host} ist nicht lokal — dieses Werkzeug schreibt nur in eine lokale Datenbank.`);
}

const roh: unknown = JSON.parse(readFileSync(datei, 'utf8'));
if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Error('Die Datei enthält kein Objekt.');
const kopf = roh as Record<string, unknown>;
if ('kv' in kopf || 'tables' in kopf) throw new Error('Das ist eine Server-Sicherung (kv/tables), kein Browser-Export — dafür die Wiederherstellung der alten App benutzen.');
if (String(kopf._version) !== '3') throw new Error(`Unbekanntes Format: _version=${String(kopf._version)} (erwartet 3).`);

const eintraege = Object.entries(kopf).filter(([k]) => !k.startsWith('_'));
const schluessel = eintraege.filter(([k]) => k.startsWith('immo-') && k !== 'immo-pin');
const uebergangen = eintraege.filter(([k]) => !schluessel.some(([s]) => s === k)).map(([k]) => k);
if (schluessel.length === 0) throw new Error('Die Datei enthält keinen Geschäftsschlüssel (immo-…).');

// Die Kernbestände brauchen durchgehend IDs — daran hängt jede Zuordnung. Bewusst NICHT für alle Listen wie
// beim Import der alten App: der weist ihren eigenen Export ab, weil `immo-dd-template` Zahlen als ID führt
// und `immo-bs-aktionen` gar keine.
const KERN = ['immo-deals', 'immo-objects', 'immo-makler', 'immo-kundenkalkulationen'];
for (const [k, v] of schluessel) {
  if (!KERN.includes(k) || !Array.isArray(v)) continue;
  const ohneId = v.filter((e) => e && typeof e === 'object' && !(typeof (e as { id?: unknown }).id === 'string' && (e as { id: string }).id.length > 0));
  if (ohneId.length > 0) throw new Error(`„${k}" enthält ${ohneId.length} Einträge ohne ID.`);
}

const groesse = (v: unknown) => (Array.isArray(v) ? String(v.length) : v === undefined ? '–' : typeof v === 'object' && v !== null ? 'Objekt' : typeof v);

const sql = postgres(zielUrl, { prepare: false, max: 1 });
try {
  const vorher = await sql<{ key: string; value: unknown }[]>`select key, value from app.kv_store where key like 'immo-%' and key <> 'immo-pin' order by key`;
  const jetzt = new Map(vorher.map((z) => [z.key, z.value]));

  console.log(`Datei:  ${datei}\nStand:  ${String(kopf._exportDate ?? 'unbekannt')}\nZiel:   ${new URL(zielUrl).host}${ausfuehren ? '' : ' · Vorschau, es wird nichts geschrieben'}\n`);
  console.log('Schlüssel                        jetzt → danach');
  for (const [k, v] of schluessel) console.log(`  ${k.padEnd(30)} ${groesse(jetzt.get(k)).padStart(6)} → ${groesse(v)}`);
  const bleiben = [...jetzt.keys()].filter((k) => !schluessel.some(([s]) => s === k));
  if (bleiben.length) console.log(`\nNicht in der Datei, bleiben unverändert: ${bleiben.join(', ')}`);
  if (uebergangen.length) console.log(`Übergangen (kein Geschäftsschlüssel): ${uebergangen.join(', ')}`);

  if (ausfuehren) {
    await sql.begin(async (tx) => {
      for (const [k, v] of schluessel) {
        await tx`
          insert into app.kv_store (key, value) values (${k}, ${tx.json(v as never)})
          on conflict (key) do update
            set value = excluded.value, version = app.kv_store.version + 1, updated_at = extract(epoch from now())::bigint`;
      }
    });
    console.log(`\n✅ ${schluessel.length} Schlüssel geschrieben.`);
  }

  // Fotos und Dokumente stecken NICHT im Browser-Export. Was in den Tabellen liegt, gehört zum vorherigen
  // Bestand — zeigt es auf Objekte/Deals, die es nach dem Einspielen nicht gibt, sind es Waisen.
  const ids = (k: string) => {
    const v = schluessel.find(([s]) => s === k)?.[1] ?? jetzt.get(k);
    return new Set((Array.isArray(v) ? v : []).map((e) => String((e as { id: unknown }).id)));
  };
  const objekte = ids('immo-objects');
  const deals = ids('immo-deals');
  const fotos = await sql<{ obj_id: string }[]>`select obj_id from app.obj_photos`;
  const dokumente = await sql<{ deal_id: string }[]>`select deal_id from app.deal_documents`;
  const fotoWaisen = fotos.filter((f) => !objekte.has(String(f.obj_id))).length;
  const dokWaisen = dokumente.filter((d) => !deals.has(String(d.deal_id))).length;
  console.log(`\nTabellen (nicht Teil des Exports): ${fotos.length} Fotos, davon ${fotoWaisen} ohne Objekt im neuen Bestand · ${dokumente.length} Dokumente, davon ${dokWaisen} ohne Deal`);
  if (!ausfuehren) console.log('\nZum Schreiben: denselben Aufruf mit --ausfuehren');
} finally {
  await sql.end();
}
