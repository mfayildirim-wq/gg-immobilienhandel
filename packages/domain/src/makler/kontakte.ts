/**
 * Kontaktdaten eines Maklers über die Hauptnummer hinaus.
 *
 * Die alte App legte beim Exposé-Import alles, was die KI fand, ungefiltert am Makler ab (`mobiltel`,
 * `festnetztel`, `alleNamen`, `alleTelefonnummern`, `alleEmails`) und zeigte es nirgends wieder an. Im Neubau
 * sind Mobil und Festnetz eigene Felder; der Rest steht als „weitere Kontakte" am Makler — aber nur, was dort
 * nicht ohnehin schon steht.
 */
export interface WeitereKontakte { namen: string[]; telefonnummern: string[]; emails: string[] }

interface Hauptkontakt { name?: string | null; tel?: string | null; mobil?: string | null; festnetz?: string | null; email?: string | null }

/** Vergleichsform einer Telefonnummer: nur Ziffern, Ländervorwahl 49/0049 wie führende 0 — auch in der Schreibweise „+49 (0)711". */
export const telefonSchluessel = (v: string) => v.replace(/\D/g, '').replace(/^(0049|49)0?/, '0');

function ohneDoppel(werte: unknown, schluessel: (v: string) => string, bekannt: (string | null | undefined)[]): string[] {
  const gesehen = new Set(bekannt.filter((b): b is string => !!b).map(schluessel));
  const aus: string[] = [];
  for (const w of Array.isArray(werte) ? werte : []) {
    const t = typeof w === 'string' ? w.trim() : '';
    const s = t && schluessel(t);
    if (!s || gesehen.has(s)) continue;
    gesehen.add(s);
    aus.push(t);
  }
  return aus;
}

/** `null`, wenn außer dem Hauptkontakt nichts bekannt ist — ein leeres Objekt wäre eine Angabe, die keine ist. */
export function weitereKontakte(haupt: Hauptkontakt, alle: { namen?: unknown; telefonnummern?: unknown; emails?: unknown }): WeitereKontakte | null {
  const k: WeitereKontakte = {
    namen: ohneDoppel(alle.namen, (v) => v.toLowerCase(), [haupt.name]),
    telefonnummern: ohneDoppel(alle.telefonnummern, telefonSchluessel, [haupt.tel, haupt.mobil, haupt.festnetz]),
    emails: ohneDoppel(alle.emails, (v) => v.toLowerCase(), [haupt.email]),
  };
  return k.namen.length || k.telefonnummern.length || k.emails.length ? k : null;
}
