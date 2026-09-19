import type { MaklerImportVorschau } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { xlsxMaklerLesen, xlsxSpaltenErkennen } from '@gg/domain';
import { istTabelle, tabelleLesen } from '@gg/integrations';
import { isNull } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';

function tabelle(datei: { name: string; bytes: Uint8Array } | null) {
  if (!datei) throw new FachFehler(400, 'Keine Datei hochgeladen');
  if (!/\.(xlsx|xls)$/i.test(datei.name) || !istTabelle(datei.bytes)) throw new FachFehler(415, 'Nur .xlsx und .xls Dateien erlaubt');
  const t = tabelleLesen(datei.bytes);
  if (!t.zeilen.length) throw new FachFehler(422, 'Tabelle ist leer oder hat nur eine Zeile');
  return t;
}

/** Vorschau: erkannte Spalten und die ersten fünf Zeilen — es wird nichts geschrieben. */
export function maklerImportVorschau(datei: { name: string; bytes: Uint8Array } | null): MaklerImportVorschau {
  const { ueberschriften, zeilen } = tabelle(datei);
  const zuordnung = xlsxSpaltenErkennen(ueberschriften);
  const vorschau = zeilen.slice(0, 5).map((zeile) =>
    Object.fromEntries(Object.entries(zuordnung).map(([feld, i]) => [feld, String(zeile[i] ?? '')])));
  return { zeilen: zeilen.length, ueberschriften, zuordnung, vorschau };
}

/** Übernehmen: neue Makler anlegen; bekannte E-Mails und Zeilen ohne Namen werden übersprungen. */
export async function maklerImportUebernehmen(db: Db, datei: { name: string; bytes: Uint8Array } | null, zuordnung?: Record<string, number>) {
  const { ueberschriften, zeilen } = tabelle(datei);
  const karte = zuordnung && Object.keys(zuordnung).length ? zuordnung : xlsxSpaltenErkennen(ueberschriften);
  for (const [, idx] of Object.entries(karte)) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 1000) throw new FachFehler(400, 'Ungültige Spalten-Zuordnung');
  }
  const vorhanden = await db.select({ email: schema.makler.email }).from(schema.makler).where(isNull(schema.makler.deletedAt));
  const { makler, uebersprungen } = xlsxMaklerLesen(zeilen, karte, vorhanden.map((m) => m.email ?? ''));
  if (makler.length) {
    await db.insert(schema.makler).values(makler.map((m) => ({
      id: crypto.randomUUID(), name: m.name, firma: m.firma || null, tel: m.tel || null, email: m.email || null,
      prio: m.prio, kontaktFrequenz: m.kontaktFrequenz, adresse: m.adresse || null, stadt: m.stadt || null, notizen: m.notizen || null,
    })));
  }
  await auditSchreiben(db, {
    type: 'import', entity: 'makler', action: 'create-bulk', collection: 'makler', source: '/api/import/makler-tabelle',
    metadata: { uebernommen: makler.length, uebersprungen, datei: datei?.name },
  });
  return { uebernommen: makler.length, uebersprungen };
}
