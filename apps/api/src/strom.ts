/**
 * Eine Datei als Strom ausliefern statt gepuffert.
 *
 * Eine Vercel-Function darf höchstens 4,5 MB Antwortkörper zurückgeben (`FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE`) —
 * gestreamte Antworten sind ausgenommen. Eine Bank-Präsentation mit Fotos liegt bei ~5 MB, ein gescanntes Exposé
 * bei 13 MB und mehr. Wie `server/strom-antwort.ts` der alten App, mit derselben Bedingung:
 *
 * **Kein `Content-Length`.** Erst ohne diesen Kopf wird die Antwort stückweise übertragen, und nur das wertet die
 * Plattform als Strom. Wer die Länge „hilfreich" mitgibt, hebelt genau die Ausnahme aus, wegen der das hier steht.
 *
 * Die Bytes liegen beim Aufruf bereits vollständig vor (PDF fertig gedruckt, Datei aus dem Speicher geholt) — ein
 * laufendes Chromium hängt hier, anders als in der alten App, nicht mehr am Strom.
 */
const STUECK = 256 * 1024;

export function alsStrom(bytes: Uint8Array | string, kopf: Record<string, string>, status = 200): Response {
  const daten = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let stelle = 0;
  const strom = new ReadableStream<Uint8Array>({
    pull(regler) {
      if (stelle >= daten.byteLength) return regler.close();
      regler.enqueue(daten.subarray(stelle, (stelle += STUECK)));
    },
  });
  const ohneLaenge = Object.fromEntries(Object.entries(kopf).filter(([k]) => k.toLowerCase() !== 'content-length'));
  return new Response(strom, { status, headers: ohneLaenge });
}
