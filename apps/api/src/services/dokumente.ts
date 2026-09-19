import { type Db, schema } from '@gg/db';
import { auditSchreiben } from './audit.ts';
import { bankgespraechPayload, type BankgespraechPayload, dokumentBilder } from '@gg/documents';
import { computeKKalk } from '@gg/domain';
import { kundenkalkEinstellungenLesen } from './einstellungen.ts';
import { kundenkalkulationDetail } from './kundenkalkulationen.ts';

/** Bankgespräch-Payload aus der gespeicherten Kalkulation — dieselbe Funktion rechnet die Live-Vorschau im Web. */
export async function bankgespraechDaten(db: Db, id: string, heute: Date): Promise<BankgespraechPayload> {
  const k = await kundenkalkulationDetail(db, id);
  const e = await kundenkalkEinstellungenLesen(db);
  return bankgespraechPayload(k, computeKKalk(k.inputs), { heute, ersteller: e.ersteller, disclaimer: e.disclaimer, bilder: dokumentBilder(k.bildRefs) });
}

/** Wie die alte Route: jeder Export steht im Audit-Log (mit Hash-Kette). */
export async function pdfExportProtokollieren(db: Db, id: string, p: BankgespraechPayload) {
  await auditSchreiben(db, {
    type: 'mutation', entity: 'kkalk', entityId: id, action: 'pdf-export', collection: 'kundenkalkulationen',
    source: '/api/kundenkalkulationen/{id}/pdf', metadata: { kalkName: p.kalkName, scope: p.scope, gik: p.gik },
  });
}
