import type { FinanzPraes } from '@gg/domain';
import { finanzpraesFullHtml, standardbilderEinsetzen } from '../finanzpraes/index.ts';
import { type BilderPorts, legeVerweiseAb } from './bilder.ts';
import { renderFinanzPraesPptx } from './pptx.ts';
import { htmlZuPdf } from './render.ts';

/** Bank-Präsentation als PDF: A4 quer, Logo und Fußzeile stecken in jeder Folie (Port von server/finanzpraes-pdf.ts). */
export async function finanzpraesPdf(praes: FinanzPraes, fotos: BilderPorts): Promise<Uint8Array> {
  const ablage = await legeVerweiseAb(standardbilderEinsetzen(praes), fotos);
  try {
    return await htmlZuPdf({ html: finanzpraesFullHtml(ablage.wert), querformat: true, verzeichnis: ablage.verzeichnis });
  } finally {
    await ablage.aufraeumen();
  }
}

/** Bank-Präsentation als PowerPoint (Standardbilder eingesetzt, Fotos eingebettet). */
export async function finanzpraesPptx(praes: FinanzPraes, fotos: BilderPorts): Promise<Uint8Array> {
  return new Uint8Array(await renderFinanzPraesPptx(standardbilderEinsetzen(praes), fotos));
}

/** Dateiname wie in der alten App: Bankname (sonst „Bank-Praesentation“), nur [a-zA-Z0-9-_], höchstens 80 Zeichen. */
export function praesentationDateiname(bankName: string, endung: 'pdf' | 'pptx'): string {
  return `${(bankName || 'Bank-Praesentation').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 80)}.${endung}`;
}
