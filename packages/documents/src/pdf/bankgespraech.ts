import { bankgespraechFullHtml, bankgespraechPdfFooter, bankgespraechPdfHeader, type BankgespraechPayload } from '../bankgespraech/vorlage.ts';
import { type BilderPorts, legeVerweiseAb } from './bilder.ts';
import { BANKGESPRAECH_RAND, htmlZuPdf } from './render.ts';

const OHNE_FOTOS: BilderPorts = { holeFoto: async () => null };

/** Kundenkalkulation als Bankgespräch-PDF — dieselbe Vorlage wie die Live-Vorschau. Fotos werden Dateien neben der Seite. */
export async function bankgespraechPdf(p: BankgespraechPayload, fotos: BilderPorts = OHNE_FOTOS): Promise<Uint8Array> {
  const ablage = await legeVerweiseAb(p, fotos);
  try {
    const q = ablage.wert;
    return await htmlZuPdf({ html: bankgespraechFullHtml(q), kopf: bankgespraechPdfHeader(q), fuss: bankgespraechPdfFooter(q), rand: BANKGESPRAECH_RAND, verzeichnis: ablage.verzeichnis });
  } finally {
    await ablage.aufraeumen();
  }
}
