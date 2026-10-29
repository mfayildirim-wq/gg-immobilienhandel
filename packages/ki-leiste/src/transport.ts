/**
 * Wie die Leiste mit dem KI-Dienst spricht. Heute: `/api/ki-leiste` der eigenen App; als eigener Dienst nur eine andere
 * Basisadresse. `holen` bringt die Anmeldung mit (gg: Bearer-Token der Sitzung).
 */
import type { KiAblegen, KiAenderungEntscheiden, KiBezug, KiBezugSicht, KiEinstellungen, KiGespraech, KiGespraechKopf, KiSenden, KiStand, KiVorschlagVerwerfen } from '@gg/ki-kern/vertrag';

export interface KiTransport {
  stand(): Promise<KiStand>;
  einstellungenSpeichern(e: KiEinstellungen): Promise<KiEinstellungen>;
  bezug(b: KiBezug): Promise<KiBezugSicht>;
  allgemein(): Promise<{ gespraeche: KiGespraechKopf[] }>;
  gespraech(id: string): Promise<KiGespraech>;
  senden(s: KiSenden): Promise<KiGespraech>;
  ablegen(a: KiAblegen): Promise<unknown>;
  vorschlagVerwerfen(v: KiVorschlagVerwerfen): Promise<KiGespraech>;
  aenderungEntscheiden(a: KiAenderungEntscheiden): Promise<KiGespraech>;
  gespraechLoeschen(id: string): Promise<unknown>;
}

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

export function httpTransport(basis: string, holen: Holen = (u, i) => fetch(u, i)): KiTransport {
  const b = basis.replace(/\/+$/, '');
  const rufe = async <T>(pfad: string, methode = 'GET', rumpf?: unknown): Promise<T> => {
    const res = await holen(`${b}${pfad}`, {
      method: methode,
      ...(rumpf === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) }),
    });
    const daten = (await res.json().catch(() => ({}))) as { fehler?: string };
    if (!res.ok) throw new Error(daten.fehler ?? `Der KI-Dienst antwortet mit ${res.status}.`);
    return daten as T;
  };
  const e = encodeURIComponent;
  return {
    stand: () => rufe('/stand'),
    einstellungenSpeichern: (x) => rufe('/einstellungen', 'PUT', x),
    bezug: (x) => rufe(`/bezug/${e(x.art)}/${e(x.id)}`),
    allgemein: () => rufe('/allgemein'),
    gespraech: (id) => rufe(`/gespraeche/${e(id)}`),
    senden: (x) => rufe('/senden', 'POST', x),
    ablegen: (x) => rufe('/ablegen', 'POST', x),
    vorschlagVerwerfen: (x) => rufe('/vorschlag-verwerfen', 'POST', x),
    aenderungEntscheiden: (x) => rufe('/aenderung', 'POST', x),
    gespraechLoeschen: (id) => rufe(`/gespraeche/${e(id)}`, 'DELETE'),
  };
}
