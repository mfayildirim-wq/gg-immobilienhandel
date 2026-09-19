/**
 * Propstack-API (CRM/Bewertung). Übernommen aus gg-immohandel server/index.ts (propstackRequest);
 * geändert: der Schlüssel wird übergeben, die Antwort kommt als Ergebnis statt als HTTP-Weiterleitung.
 */
export const PROPSTACK_BASIS = 'https://api.propstack.de/v1';

export interface PropstackAntwort { status: number; ok: boolean; daten: unknown }
export interface PropstackClient {
  einheitAnlegen(nutzlast: unknown): Promise<PropstackAntwort>;
  einheitLesen(id: string | number): Promise<PropstackAntwort>;
  statusListe(): Promise<PropstackAntwort>;
}

export function propstackClient(apiKey: string, basis = PROPSTACK_BASIS): PropstackClient {
  const rufe = async (pfad: string, method: string, body?: unknown): Promise<PropstackAntwort> => {
    try {
      const res = await fetch(basis + pfad, {
        method,
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const daten: unknown = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, daten };
    } catch (e) {
      return { status: 502, ok: false, daten: { error: `Propstack nicht erreichbar: ${(e as Error).message}` } };
    }
  };
  return {
    einheitAnlegen: (nutzlast) => rufe('/units', 'POST', nutzlast),
    einheitLesen: (id) => rufe(`/units/${encodeURIComponent(String(id))}?expand=1`, 'GET'),
    statusListe: () => rufe('/property_statuses', 'GET'),
  };
}

/** Attrappe für Tests und lokale Läufe (PROPSTACK_ATTRAPPE=1): legt nichts an, liefert eine erkennbare Kennung. */
export function propstackAttrappe(): PropstackClient {
  let zaehler = 0;
  return {
    async einheitAnlegen() { zaehler += 1; return { status: 201, ok: true, daten: { id: 90000 + zaehler, name: 'Test-Modus: nicht wirklich angelegt' } }; },
    async einheitLesen(id) { return { status: 200, ok: true, daten: { id, price: 0, valuation: 'Test-Modus: keine echte Bewertung' } }; },
    async statusListe() { return { status: 200, ok: true, daten: [{ id: 1, name: 'Kaufangebote (Test-Modus)' }] }; },
  };
}
