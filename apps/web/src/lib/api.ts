import { gehalteneKarten, type Vorher } from './gehalteneKarten.ts';
import type { KalkStandard } from '@gg/domain';
import type {
  ExposeAnalyseAntwort,
  ExposeUebernehmen,
  Kundenkalkulation,
  KundenkalkulationAnlegen,
  KundenkalkulationEintrag,
  KundenkalkulationSpeichern,
  KundenkalkEinstellungen,
  ObjektFoto,
  Dokument,
  SharepointStand,
  PapierkorbEintrag,
  DublettenPaarSicht,
  AuditBefund,
  KiKosten,
  ZugangPruefung, ZugangStatus,
  OutwardStand,
  PropstackBewertung,
  M365Posteingang,
  M365Stand,
  NachfassResetSicht,
  AuditSeite,
  MergeAusfuehren,
  MergeProtokollEintrag,
  MergeVorschau,
  KalkVariante,
  KalkVarianteAnlegen,
  NachrichtEntwurf,
  PersonaStand,
  VorlagenEinstellungen,
  GespeicherterFilter,
  GespeicherterFilterAnlegen,
  ListenAltformat,
  Projekt,
  ProjektAnlegen,
  ProjektDealAuswahl,
  ProjektSpeichern,
  Vertriebsliste,
  VertriebslistenEinstellungen,
  VertriebslisteSpeichern,
  Begleitschein,
  BegleitscheinEintrag,
  BegleitscheinSpeichern,
  BsAktion,
  BsAktionErgebnis,
  BsVordruck,
  BsVorlage,
  Praesentation,
  PraesentationSpeichern,
  PraesentationKi, PraesentationVorbelegen,
  PropstackStatusListe,
  FinanzpraesStandard,
  AnkaufCockpit,
  AnrufErgebnisSpeichern,
  CockpitMakler,
  DealAnlegen,
  DealDetail,
  DealInfoAendern,
  DealListenEintrag,
  KalkulationSpeichern,
  KommunikationAnlegen,
  MaklerAendern,
  MaklerDetail,
  ObjektAendern,
  ObjektDetail,
  Makler,
  MaklerAnlegen,
  Objekt,
  ObjektAnlegen,
  StatusHistorieEintrag,
  StatusWechsel, AutoImportLauf,
} from '@gg/api-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sitzungErneuern, zugriffsToken } from './sitzung.ts';

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Zusatzangaben der API (z. B. Hinweis des Default-Deny-Gates). */
    readonly details?: { hint?: string; failed?: string[] },
    /** Bei 400: je beanstandetem Feld eine Zeile „pfad: Grund" (aus der Vertragsprüfung). */
    readonly felder?: string[],
  ) {
    super(message);
  }

  /**
   * Der Fehler in einem Satz, mit den beanstandeten Feldern.
   * „Eingabe ungültig" allein hilft niemandem weiter — erst die Felder sagen, was zu tun ist.
   */
  get klartext(): string {
    if (!this.felder?.length) return this.message;
    return `${this.message}: ${this.felder.join(' · ')}`;
  }
}

/** Jeder Aufruf trägt das Token der Sitzung, sofern eine Anmeldung eingerichtet ist. */
export async function mitToken(headers?: HeadersInit): Promise<HeadersInit> {
  const token = await zugriffsToken();
  return token ? { ...headers, authorization: `Bearer ${token}` } : (headers ?? {});
}

/** Bei 401 einmal die Sitzung erneuern und den Aufruf wiederholen (wie apiFetch der alten App). */
async function holen(pfad: string, init?: RequestInit): Promise<Response> {
  const bauen = async () => fetch(pfad, { ...init, headers: await mitToken(init?.headers) });
  const res = await bauen();
  if (res.status !== 401) return res;
  return (await sitzungErneuern()) ? bauen() : res;
}

async function anfrage<T>(pfad: string, init?: RequestInit): Promise<T> {
  const res = await holen(pfad, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFehler(res.status, body?.fehler ?? `Fehler ${res.status}`, body?.details, body?.felder);
  return body as T;
}

const senden = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const useDeals = () => useQuery({ queryKey: ['deals'], queryFn: () => anfrage<DealListenEintrag[]>('/api/deals') });
export const useObjekte = () => useQuery({ queryKey: ['objekte'], queryFn: () => anfrage<Objekt[]>('/api/objekte') });
export const useMakler = () => useQuery({ queryKey: ['makler'], queryFn: () => anfrage<Makler[]>('/api/makler') });
export const useStatusHistorie = (dealId: string | null) =>
  useQuery({
    queryKey: ['deals', dealId, 'historie'],
    queryFn: () => anfrage<StatusHistorieEintrag[]>(`/api/deals/${dealId}/status-historie`),
    enabled: !!dealId,
  });

export function useDealAnlegen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: DealAnlegen) => anfrage<{ id: string }>('/api/deals', senden('POST', d)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useStatusAendern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...w }: StatusWechsel & { id: string }) => anfrage(`/api/deals/${id}/status`, senden('PATCH', w)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useObjektAnlegen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (o: ObjektAnlegen) => anfrage<Objekt>('/api/objekte', senden('POST', o)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objekte'] }),
  });
}

export function useMaklerAnlegen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: MaklerAnlegen) => anfrage<Makler>('/api/makler', senden('POST', m)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['makler'] }),
  });
}

// ── Details ───────────────────────────────────────────────

export const useDealDetail = (id: string | null) =>
  useQuery({ queryKey: ['deals', id, 'detail'], queryFn: () => anfrage<DealDetail>(`/api/deals/${id}`), enabled: !!id });
export const useMaklerDetail = (id: string | null) =>
  useQuery({ queryKey: ['makler', id, 'detail'], queryFn: () => anfrage<MaklerDetail>(`/api/makler/${id}`), enabled: !!id });
export const useObjektDetail = (id: string | null) =>
  useQuery({ queryKey: ['objekte', id, 'detail'], queryFn: () => anfrage<ObjektDetail>(`/api/objekte/${id}`), enabled: !!id });
export const useObjektFotos = (id: string | null) =>
  useQuery({ queryKey: ['objekte', id, 'fotos'], queryFn: () => anfrage<ObjektFoto[]>(`/api/objekte/${id}/fotos`), enabled: !!id });
export async function fotoHochladen(objektId: string, bild: Blob, dateiname: string): Promise<ObjektFoto> {
  const res = await fetch(`/api/objekte/${objektId}/fotos`, { method: 'POST', body: bild, headers: await mitToken({ 'content-type': 'application/octet-stream', 'x-dateiname': encodeURIComponent(dateiname) }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFehler(res.status, body?.fehler ?? `Upload fehlgeschlagen (${res.status})`);
  return body as ObjektFoto;
}
export const useFotoLoeschen = (objektId: string) =>
  useAendern('objekte', (fotoId: string) => anfrage<{ id: string }>(`/api/objekte/${objektId}/fotos/${fotoId}`, { method: 'DELETE' }));
export const useFotosSortieren = (objektId: string) =>
  useAendern('objekte', (ids: string[]) => anfrage<ObjektFoto[]>(`/api/objekte/${objektId}/fotos/reihenfolge`, senden('PUT', { ids })));
export const useKalkStandard = () =>
  useQuery({ queryKey: ['einstellungen', 'kalk-standard'], queryFn: () => anfrage<KalkStandard>('/api/einstellungen/kalk-standard'), staleTime: 60_000 });

type Geaendert = { id: string; version: number };

/** Mutation, die danach die betroffenen Listen und Details neu lädt. */
/** Zusätzliche Schritte eines Datenaufrufs; sie laufen auch zu Ende, wenn die auslösende Karte inzwischen verschwunden ist. */
type Zusatz<E, R> = { vorher?: (e: E) => Vorher; danach?: (r: R, e: E) => void; fehler?: (e: E, vorher: Vorher) => void };

function useAendern<E, R = unknown>(bereich: 'deals' | 'makler' | 'objekte' | 'einstellungen', aufruf: (e: E) => Promise<R>, zusatz: Zusatz<E, R> = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: aufruf,
    onMutate: (e: E) => ({ vorher: zusatz.vorher?.(e) }),
    // Eine im Ankauf-Cockpit stehen gebliebene Karte kennt danach die neue Version (sonst Versionskonflikt bei „Erledigt“)
    onSuccess: (r: R, e: E) => {
      const g = r as { id?: unknown; version?: unknown } | null;
      if ((bereich === 'deals' || bereich === 'makler') && typeof g?.id === 'string' && typeof g.version === 'number') gehalteneKarten.version(bereich, g.id, g.version);
      zusatz.danach?.(r, e);
    },
    onError: (_f: Error, e: E, kontext: { vorher: Vorher } | undefined) => zusatz.fehler?.(e, kontext?.vorher),
    // Das Ankauf-Cockpit zeigt Deals und Makler: bei jeder Änderung mit neu laden
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: [bereich] }), qc.invalidateQueries({ queryKey: ['ankauf'] })]),
  });
}

/** Deal-Detail: ein neuer Termin hält die Karte im Ankauf-Cockpit fest wie die Knöpfe auf der Karte selbst. */
export const useDealInfoAendern = (id: string) =>
  useAendern('deals', (e: DealInfoAendern) => anfrage<Geaendert>(`/api/deals/${id}`, senden('PATCH', e)), {
    vorher: (e) => ('nextContact' in e ? gehalteneKarten.vormerken('deals', id, e.nextContact ?? null) : undefined),
    fehler: (_e, vorher) => gehalteneKarten.zurueck('deals', id, vorher),
  });
export const useKalkulationSpeichern = (id: string) =>
  useAendern('deals', (e: KalkulationSpeichern) => anfrage<Geaendert & { kennzahlen: Record<string, number> }>(`/api/deals/${id}/kalkulation`, senden('PUT', e)));
export const useKommentarAnlegen = (id: string) =>
  useAendern('deals', (text: string) => anfrage(`/api/deals/${id}/kommentare`, senden('POST', { text })));
/** „Erledigt“ (Karte oder Detail) schließt eine stehen gebliebene Karte ab. */
export const useDealErledigt = (id: string) =>
  useAendern('deals', (version: number) => anfrage<Geaendert>(`/api/deals/${id}/erledigt`, senden('POST', { version })), { danach: () => gehalteneKarten.loslassen('deals', id) });
export const useMaklerAendern = (id: string) =>
  useAendern('makler', (e: MaklerAendern) => anfrage<Geaendert>(`/api/makler/${id}`, senden('PATCH', e)));
export const useKommunikationAnlegen = (id: string) =>
  useAendern('makler', (e: KommunikationAnlegen) => anfrage(`/api/makler/${id}/kommunikation`, senden('POST', e)));
export const useMaklerErledigt = (id: string) =>
  useAendern('makler', (version: number) => anfrage<Geaendert>(`/api/makler/${id}/erledigt`, senden('POST', { version })), { danach: () => gehalteneKarten.loslassen('makler', id) });
export const useObjektAendern = (id: string) =>
  useAendern('objekte', (e: ObjektAendern) => anfrage<Geaendert>(`/api/objekte/${id}`, senden('PATCH', e)));
export const useObjektLoeschen = () => useAendern('objekte', (id: string) => anfrage<{ id: string }>(`/api/objekte/${id}`, { method: 'DELETE' }));
// ── Sicherung ─────────────────────────────────────────────
export interface SicherungUmfang { zeilen: { tabelle: string; anzahl: number }[]; gesamt: number; ausgenommen: Record<string, string> }
export interface SicherungPlan { erzeugtAm: string; unbekannt: string[]; gesamtNeu: number; gesamtAktualisiert: number; zeilen: { tabelle: string; neu: number; aktualisiert: number; inDatei: number; imBestand: number }[] }
export const useSicherungUmfang = () => useQuery({ queryKey: ['sicherung'], queryFn: () => anfrage<SicherungUmfang>('/api/sicherung') });
// DD-Dokumentenliste
interface DdVorlage { zeilen: { dokument: string; quelle: string }[]; gespeichert: boolean }
export const useDdVorlage = () => useQuery({ queryKey: ['einstellungen', 'dd-vorlage'], queryFn: () => anfrage<DdVorlage>('/api/einstellungen/dd-vorlage') });
export function useDdVorlageSpeichern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (zeilen: { dokument: string; quelle: string }[]) => anfrage<DdVorlage>('/api/einstellungen/dd-vorlage', senden('PUT', { zeilen })),
    onSuccess: (neu) => qc.setQueryData(['einstellungen', 'dd-vorlage'], neu),
  });
}

// Automatische Sicherungen (Bucket `backups`)
export interface AutoSicherung { key: string; stufe: 'daily' | 'weekly' | 'monthly' | 'safety'; ts: string; groesseBytes: number; zahlen: { deals: number; objekte: number; makler: number; zeilen: number } }
// `retry: false`: ohne Dateiablage antwortet die Route mit 422 — drei Wiederholungen mit Wartezeit hielten jede Aktion
// der Seite gut sieben Sekunden im Ladezustand, weil deren `invalidateQueries()` auf diese Abfrage mitwartet.
export const useAutoSicherungen = () => useQuery({ retry: false, queryKey: ['sicherung', 'auto'], queryFn: () => anfrage<{ eintraege: AutoSicherung[]; aufbewahrung: Record<string, number> }>('/api/sicherung/auto') });
export function useAutoSicherungAnlegen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => anfrage<{ eintrag: AutoSicherung; aufbewahrung: { entfernt: string[]; behalten: number; hinweis: string | null } }>('/api/sicherung/auto', { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sicherung', 'auto'] }),
  });
}
export const useAutoSicherungPlan = () => useMutation({ mutationFn: (key: string) => anfrage<SicherungPlan & { kopf: AutoSicherung }>('/api/sicherung/auto/plan', senden('POST', { key })) });
export function useAutoSicherungEinspielen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => anfrage<{ geschrieben: number; sicherheitskopie: string }>('/api/sicherung/auto/einspielen', senden('POST', { key, bestaetigt: true })),
    // Eingespielt heißt: jede Liste kann sich geändert haben
    onSuccess: () => qc.invalidateQueries(),
  });
}
export const useSicherungPlan = () => useMutation({ mutationFn: (datei: unknown) => anfrage<SicherungPlan>('/api/sicherung/plan', senden('POST', datei)) });
export function useSicherungEinspielen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (datei: unknown) => anfrage<{ geschrieben: number }>('/api/sicherung/einspielen', senden('POST', datei)), onSettled: () => qc.invalidateQueries() });
}

// ── Microsoft 365 ─────────────────────────────────────────
export const useM365 = () => useQuery({ queryKey: ['m365'], queryFn: () => anfrage<M365Stand>('/api/m365') });
// Auto-Import: der Lauf gehört zur Anfrage — die Antwort kommt, wenn der Bot fertig ist (bis zu einigen Minuten)
export const autoImportLauf = (mailUid: string) => anfrage<AutoImportLauf>('/api/auto-import/lauf', senden('POST', { mailUid }));
export const autoImportAbbrechen = (mailUid: string) => anfrage<{ abgebrochen: number }>('/api/auto-import/abbrechen', senden('POST', { mailUid }));
export const useAutoImportVerlauf = (aktiv: boolean) => useQuery({ queryKey: ['auto-import', 'verlauf'], enabled: aktiv, queryFn: () => anfrage<AutoImportLauf[]>('/api/auto-import/verlauf') });

export const useM365Posteingang = (alle: boolean, aktiv: boolean) =>
  useQuery({ queryKey: ['m365', 'posteingang', alle], queryFn: () => anfrage<M365Posteingang>(`/api/m365/posteingang${alle ? '?alle=true' : ''}`), enabled: aktiv });
function useM365Aendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['m365'] }) });
}
export const useM365Konfiguration = () => useM365Aendern((e: { clientId: string; tenantId: string; clientSecret?: string }) => anfrage('/api/m365/konfiguration', senden('PUT', e)));
export const useM365Ordner = () => useM365Aendern((ordner: string) => anfrage<{ ordner: string }>('/api/m365/ordner', senden('PUT', { ordner })));
// ── SharePoint als Dokumentablage (Protokoll 19) ──────────
export const useSharepoint = () => useQuery({ queryKey: ['sharepoint'], queryFn: () => anfrage<SharepointStand>('/api/sharepoint') });
export const useSharepointKonfiguration = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (e: { siteUrl: string; wurzel: string; aktiv: boolean }) => anfrage('/api/sharepoint/konfiguration', senden('PUT', e)), onSettled: () => qc.invalidateQueries({ queryKey: ['sharepoint'] }) });
};
export const useSharepointMigration = () => useQuery({ queryKey: ['sharepoint', 'migration'], queryFn: () => anfrage<{ inSupabase: number; inSharepoint: number; fehlend: number }>('/api/sharepoint/migration') });
export const useSharepointMigrieren = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (limit: number) => anfrage<{ migriert: number; offen: number; fehler: string[] }>('/api/sharepoint/migration', senden('POST', { limit })), onSettled: () => { void qc.invalidateQueries({ queryKey: ['sharepoint'] }); void qc.invalidateQueries({ queryKey: ['dokumente'] }); } });
};
export const useSharepointAbgleich = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => anfrage<{ geprueft: number; verschoben: number; verschwunden: number; zurueck: number; fehler: string[] }>('/api/sharepoint/abgleich', senden('POST', {})), onSettled: () => { void qc.invalidateQueries({ queryKey: ['sharepoint'] }); void qc.invalidateQueries({ queryKey: ['dokumente'] }); } });
};
export const useSharepointTest = () => useMutation({ mutationFn: () => anfrage<{ ok: true; schritte: string[]; webUrl: string; dauerMs: number }>('/api/sharepoint/test', senden('POST', {})) });
export const useM365Anmeldung = () => useMutation({ mutationFn: (redirectUri: string) => anfrage<{ url: string }>('/api/m365/anmeldung', senden('POST', { redirectUri })) });
export const useM365Rueckweg = () => useM365Aendern((e: { code: string; state: string }) => anfrage<{ email: string }>('/api/m365/rueckweg', senden('POST', e)));
export const useM365Trennen = () => useM365Aendern(() => anfrage<{ ok: true }>('/api/m365/trennen', senden('POST', {})));
export const useMailSperren = () => useM365Aendern((uid: string) => anfrage<{ uid: string }>(`/api/m365/mails/${uid}/sperren`, senden('POST', {})));
export const useMailEntsperren = () => useM365Aendern((uid: string) => anfrage<{ uid: string }>(`/api/m365/mails/${uid}/sperren`, { method: 'DELETE' }));
export const useMailUebernehmen = () => useM365Aendern((e: { uid: string; anhangId: string }) => anfrage<{ key: string }>(`/api/m365/mails/${e.uid}/anhaenge/${e.anhangId}/uebernehmen`, senden('POST', {})));

// ── Propstack (Bewertung je Einheit) ──────────────────────
export const usePropstackVorbelegung = (dealId: string, einheitId: string | null) =>
  useQuery({ queryKey: ['propstack', dealId, einheitId], queryFn: () => anfrage<PropstackBewertung>(`/api/deals/${dealId}/einheiten/${einheitId}/propstack`), enabled: !!einheitId });
export function usePropstackAnlegen(dealId: string, einheitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (daten: PropstackBewertung['daten']) => anfrage<{ unitId: string | null; url: string | null }>(`/api/deals/${dealId}/einheiten/${einheitId}/propstack`, senden('POST', daten)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['propstack'] }),
  });
}

// ── MCP ───────────────────────────────────────────────────
export interface McpStand { lokal: boolean; schluessel: { label: string; scopes: string[] }[]; verworfen: string[]; werkzeuge: { name: string; scope: string; title: string; description: string }[] }
export const useMcp = () => useQuery({ queryKey: ['mcp'], queryFn: () => anfrage<McpStand>('/api/mcp') });

// ── Aktionen nach außen ───────────────────────────────────
export const useOutwardGate = () => useQuery({ queryKey: ['outward-gate'], queryFn: () => anfrage<OutwardStand>('/api/outward-gate') });
function useGateAendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['outward-gate'] }) });
}
export const useGateSpeichern = () => useGateAendern((e: { allowAgbSubmit?: boolean; allowPropstackWrite?: boolean; extraAgbHosts?: string[] }) => anfrage('/api/outward-gate', senden('PUT', e)));
export const useFreigabeEntscheiden = () => useGateAendern((e: { id: string; entscheidung: 'erlaubt' | 'abgelehnt' }) => anfrage(`/api/outward-gate/freigaben/${e.id}`, senden('POST', { entscheidung: e.entscheidung })));

// ── Makler aus Tabelle ────────────────────────────────────
export interface MaklerImportVorschau { zeilen: number; ueberschriften: string[]; zuordnung: Record<string, number>; vorschau: Record<string, string>[] }
async function tabelleSenden<T>(pfad: string, datei: File, zuordnung?: Record<string, number>): Promise<T> {
  const form = new FormData();
  form.append('file', datei, datei.name);
  if (zuordnung) form.append('zuordnung', JSON.stringify(zuordnung));
  const res = await fetch(pfad, { method: 'POST', body: form, headers: await mitToken() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFehler(res.status, body?.fehler ?? `Fehler ${res.status}`);
  return body as T;
}
export const useMaklerImportVorschau = () => useMutation({ mutationFn: (datei: File) => tabelleSenden<MaklerImportVorschau>('/api/import/makler-tabelle/vorschau', datei) });
export function useMaklerImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: { datei: File; zuordnung: Record<string, number> }) => tabelleSenden<{ uebernommen: number; uebersprungen: number }>('/api/import/makler-tabelle', e.datei, e.zuordnung),
    onSettled: () => qc.invalidateQueries(),
  });
}

// ── Zugänge (API-Schlüssel) ───────────────────────────────
export const useZugaenge = () => useQuery({ queryKey: ['zugaenge'], queryFn: () => anfrage<ZugangStatus[]>('/api/zugaenge') });
/** „Schlüssel testen“ (nur Anthropic): prüft den Schlüssel, den die KI tatsächlich benutzt. */
export const useAnthropicPruefen = () => useMutation({ mutationFn: () => anfrage<ZugangPruefung>('/api/zugaenge/anthropic-api-key/pruefen', senden('POST', {})) });

export function useZugangSpeichern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: { schluessel: string; wert: string }) => anfrage<{ schluessel: string; gesetzt: boolean }>(`/api/zugaenge/${e.schluessel}`, senden('PUT', { wert: e.wert })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['zugaenge'] }),
  });
}

// ── Werkzeuge ─────────────────────────────────────────────
export const useNachfassResetVorschau = (datum: string) =>
  useQuery({ queryKey: ['werkzeuge', 'nachfass', datum], queryFn: () => anfrage<NachfassResetSicht>(`/api/werkzeuge/nachfass-reset?datum=${datum}`), enabled: /^\d{4}-\d{2}-\d{2}$/.test(datum) });
export function useNachfassReset() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (datum: string) => anfrage<{ deals: number; makler: number }>('/api/werkzeuge/nachfass-reset', senden('POST', { datum })), onSettled: () => qc.invalidateQueries() });
}
export const useKiKosten = (tage: number) => useQuery({ queryKey: ['werkzeuge', 'ki-kosten', tage], queryFn: () => anfrage<KiKosten>(`/api/werkzeuge/ki-kosten?tage=${tage}`) });

// ── Audit-Log ─────────────────────────────────────────────
export const useAudit = (f: { type?: string; entity?: string; von?: string; bis?: string; suche?: string; limit?: number }) => {
  const frage = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: ['audit', frage.toString()], queryFn: () => anfrage<AuditSeite>(`/api/audit?${frage.toString()}`) });
};
export function useAuditPruefen() {
  return useMutation({ mutationFn: () => anfrage<AuditBefund>('/api/audit/pruefen') });
}
export function useAuditAufraeumen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (tage: number) => anfrage<{ entfernt: number }>(`/api/audit/aelter-als/${tage}`, { method: 'DELETE' }), onSettled: () => qc.invalidateQueries({ queryKey: ['audit'] }) });
}

// ── Dubletten und Zusammenführen ──────────────────────────
export const useDubletten = () => useQuery({ queryKey: ['dubletten'], queryFn: () => anfrage<DublettenPaarSicht[]>('/api/dubletten') });
export const useMergeProtokoll = () => useQuery({ queryKey: ['dubletten', 'protokoll'], queryFn: () => anfrage<MergeProtokollEintrag[]>('/api/dubletten/protokoll') });
export const useMergeVorschau = (typ: string, primaerId: string, sekundaerId: string) =>
  useQuery({ queryKey: ['dubletten', 'vorschau', typ, primaerId, sekundaerId], queryFn: () => anfrage<MergeVorschau>(`/api/dubletten/vorschau?typ=${typ}&primaerId=${primaerId}&sekundaerId=${sekundaerId}`) });
function useDublettenAendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  // Zusammenführen betrifft Listen, Details und Papierkorb
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries() });
}
export const useDublettenIgnorieren = () => useDublettenAendern((e: { id1: string; id2: string }) => anfrage<{ ignoriert: number }>('/api/dubletten/ignorieren', senden('POST', e)));
export const useDublettenIgnoriertLeeren = () => useDublettenAendern(() => anfrage<{ ignoriert: number }>('/api/dubletten/ignorieren', { method: 'DELETE' }));
export const useZusammenfuehren = () => useDublettenAendern((e: MergeAusfuehren) => anfrage<{ protokollId: string; betroffeneDealIds: string[]; betroffeneDateien: number }>('/api/dubletten/zusammenfuehren', senden('POST', e)));
export const useMergeRueckgaengig = () => useDublettenAendern((e: { id: string; erzwingen: boolean }) => anfrage<{ ok: true }>(`/api/dubletten/protokoll/${e.id}/rueckgaengig`, senden('POST', { erzwingen: e.erzwingen })));

// ── Papierkorb ────────────────────────────────────────────
export const usePapierkorb = () => useQuery({ queryKey: ['papierkorb'], queryFn: () => anfrage<PapierkorbEintrag[]>('/api/papierkorb') });
function usePapierkorbAendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  // Wiederhergestelltes taucht sofort in Listen, Cockpit und Details auf
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries() });
}
export const usePapierkorbWiederherstellen = () => usePapierkorbAendern((e: { bereich: string; id: string }) => anfrage(`/api/papierkorb/${e.bereich}/${e.id}/wiederherstellen`, senden('POST', {})));
export const usePapierkorbEndgueltig = () => usePapierkorbAendern((e: { bereich: string; id: string }) => anfrage(`/api/papierkorb/${e.bereich}/${e.id}`, { method: 'DELETE' }));
export const usePapierkorbLeeren = () => usePapierkorbAendern(() => anfrage<{ entfernt: number; uebrig: number }>('/api/papierkorb', { method: 'DELETE' }));

export const useKalkStandardSpeichern = () =>
  useAendern('einstellungen', (e: KalkStandard) => anfrage<KalkStandard>('/api/einstellungen/kalk-standard', senden('PUT', e)));

// ── Ankauf-Cockpit ────────────────────────────────────────

export const useAnkauf = () => useQuery({ queryKey: ['ankauf'], queryFn: () => anfrage<AnkaufCockpit>('/api/ankauf'), refetchOnWindowFocus: true });
export const useEinplanen = () => useAendern('makler', () => anfrage<{ eingeplant: number }>('/api/ankauf/einplanen', senden('POST', {})));
export const useAnrufErgebnis = (id: string) =>
  useAendern('makler', (e: AnrufErgebnisSpeichern) => anfrage<{ nextContact: string | null }>(`/api/makler/${id}/anruf-ergebnis`, senden('POST', e)));
export const useDealAnrufErgebnis = (id: string) =>
  useAendern('deals', (e: AnrufErgebnisSpeichern) => anfrage<{ nextContact: string | null }>(`/api/deals/${id}/anruf-ergebnis`, senden('POST', e)));
export const useBriefingAbschluss = (id: string) =>
  useAendern('makler', (e: { version: number; nextContact: string | null }) => anfrage(`/api/makler/${id}/briefing-abschluss`, senden('POST', e)));
export const useWhatsappProtokoll = (id: string) => useAendern('makler', () => anfrage(`/api/makler/${id}/whatsapp`, senden('POST', {})));
/** Termin auf der Karte (1W/1M/3M/6M, Datum): die Karte wird schon beim Klick festgehalten, siehe gehalteneKarten. */
export const useTerminSetzen = (art: 'deals' | 'makler', id: string) =>
  useAendern(art, (e: { version: number; nextContact: string | null }) => anfrage<Geaendert>(`/api/${art}/${id}/termin`, senden('PUT', e)), {
    vorher: (e) => gehalteneKarten.vormerken(art, id, e.nextContact),
    fehler: (_e, vorher) => gehalteneKarten.zurueck(art, id, vorher),
  });
export const holeWaehlmaschine = () => anfrage<CockpitMakler[]>('/api/ankauf/waehlmaschine');

// ── Kundenkalkulation ─────────────────────────────────────

export const useKundenkalkulationen = (dealId?: string) =>
  useQuery({
    queryKey: ['kundenkalkulationen', dealId ?? 'alle'],
    queryFn: () => anfrage<KundenkalkulationEintrag[]>(dealId ? `/api/deals/${dealId}/kundenkalkulationen` : '/api/kundenkalkulationen'),
  });
export const useKundenkalkulation = (id: string) =>
  useQuery({ queryKey: ['kundenkalkulation', id], queryFn: () => anfrage<Kundenkalkulation>(`/api/kundenkalkulationen/${id}`), staleTime: Infinity });
export const kundenkalkulationSpeichern = (id: string, e: KundenkalkulationSpeichern) =>
  anfrage<Kundenkalkulation>(`/api/kundenkalkulationen/${id}`, senden('PUT', e));

function useKkAendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['kundenkalkulationen'] }) });
}
export const useKundenkalkAnlegen = (dealId: string) =>
  useKkAendern((e: KundenkalkulationAnlegen) => anfrage<Kundenkalkulation>(`/api/deals/${dealId}/kundenkalkulationen`, senden('POST', e)));
export const useKundenkalkDuplizieren = () =>
  useKkAendern((id: string) => anfrage<Kundenkalkulation>(`/api/kundenkalkulationen/${id}/duplizieren`, senden('POST', {})));
export const useKundenkalkLoeschen = () =>
  useKkAendern((id: string) => anfrage<{ id: string }>(`/api/kundenkalkulationen/${id}`, { method: 'DELETE' }));
/** Bankgespräch-PDF der gespeicherten Kalkulation als Datei. */
export async function bankgespraechPdfLaden(id: string): Promise<{ datei: Blob; name: string }> {
  const res = await fetch(`/api/kundenkalkulationen/${id}/pdf`, { headers: await mitToken() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiFehler(res.status, body?.fehler ?? `PDF-Export fehlgeschlagen (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Kundenkalkulation.pdf';
  return { datei: await res.blob(), name };
}
export const useKundenkalkEinstellungen = () =>
  useQuery({ queryKey: ['einstellungen', 'kundenkalkulation'], queryFn: () => anfrage<KundenkalkEinstellungen>('/api/einstellungen/kundenkalkulation') });
export const useKundenkalkEinstellungenSpeichern = () =>
  useAendern('einstellungen', (e: KundenkalkEinstellungen) => anfrage<KundenkalkEinstellungen>('/api/einstellungen/kundenkalkulation', senden('PUT', e)));

// ── Exposé-Import ─────────────────────────────────────────

export const useKiStatus = () => useQuery({ queryKey: ['ki-status'], queryFn: () => anfrage<{ verfuegbar: boolean; attrappe: boolean; ablage: boolean }>('/api/ki/status') });
export const useBekannteExposeDateien = () => useQuery({ queryKey: ['expose', 'bekannt'], queryFn: () => anfrage<string[]>('/api/expose/bekannte-dateien') });

/**
 * Direkt-Upload: Ticket holen, Datei **direkt in den Speicher** laden, Schlüssel zurückgeben. Die Datei geht damit nie
 * durch die API — online nimmt eine Function höchstens 4,5 MB an, echte Exposés haben bis zu 13 MB und mehr.
 * Geprüft wird danach vom Server, bei der Übernahme (`…/uebernehmen`).
 */
/** Stückgröße für Upload-Sessions (SharePoint): Vielfaches von 320 KiB, wie Graph es verlangt. */
const UPLOAD_STUECK = 10 * 320 * 1024 * 4;

async function direktHochladen(zweck: 'expose' | 'dokument', datei: File): Promise<string> {
  const { url, key, art } = await anfrage<{ url: string; key: string; art: 'put' | 'upload-session' }>('/api/upload/ticket', senden('POST', { zweck, groesse: datei.size }));
  const fehler = (status: number) => new ApiFehler(status, `„${datei.name}" ließ sich nicht hochladen (${status}). Bitte erneut versuchen.`);
  // Ohne Anmelde-Token: die Adresse selbst ist die Berechtigung, für genau diese eine Datei
  if (art === 'upload-session') {
    // SharePoint: in Stücken mit Content-Range; die letzte Antwort (200/201) trägt das fertige Item
    for (let von = 0; von < datei.size; von += UPLOAD_STUECK) {
      const bis = Math.min(von + UPLOAD_STUECK, datei.size);
      const res = await fetch(url, { method: 'PUT', body: datei.slice(von, bis), headers: { 'content-range': `bytes ${von}-${bis - 1}/${datei.size}` } });
      if (!res.ok) throw fehler(res.status);
    }
    return key;
  }
  const res = await fetch(url, { method: 'PUT', body: datei, headers: { 'content-type': datei.type || 'application/octet-stream' } });
  if (!res.ok) throw fehler(res.status);
  return key;
}

export async function exposeHochladen(datei: File): Promise<{ key: string }> {
  const key = await direktHochladen('expose', datei);
  return anfrage<{ key: string }>('/api/expose/eingang/uebernehmen', senden('POST', { key }));
}
export const exposeAnalysieren = (key: string, dateiname: string) => anfrage<ExposeAnalyseAntwort>('/api/expose/analyse', senden('POST', { key, dateiname }));

export class DublettenFehler extends ApiFehler {
  constructor(readonly dealId: string, message: string) { super(409, message); }
}
export async function exposeUebernehmen(e: ExposeUebernehmen) {
  const res = await fetch('/api/expose/uebernehmen', { method: 'POST', headers: await mitToken({ 'content-type': 'application/json' }), body: JSON.stringify(e) });
  const body = await res.json().catch(() => null);
  if (res.status === 409) throw new DublettenFehler(body?.details?.dealId, body?.fehler);
  if (!res.ok) throw new ApiFehler(res.status, body?.fehler ?? `Fehler ${res.status}`, body?.details, body?.felder);
  return body as { dealId: string; objektId: string; maklerId: string | null; pdfGespeichert: boolean; warnung?: string };
}

// ── Bank-Präsentation ─────────────────────────────────────
export const useDealPraesentation = (dealId: string) =>
  useQuery({ queryKey: ['praesentation', 'deal', dealId], queryFn: () => anfrage<{ praesentation: Praesentation | null }>(`/api/deals/${dealId}/praesentation`) });
export const usePraesentation = (id: string) =>
  useQuery({ queryKey: ['praesentation', id], queryFn: () => anfrage<Praesentation>(`/api/praesentationen/${id}`), staleTime: Infinity });
export function usePraesentationAnlegen(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vorlage: 'leer' | 'standard') => anfrage<Praesentation>(`/api/deals/${dealId}/praesentation`, senden('POST', { vorlage })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['praesentation'] }),
  });
}
export const praesentationSpeichern = (id: string, e: PraesentationSpeichern) => anfrage<Praesentation>(`/api/praesentationen/${id}`, senden('PUT', e));
export const praesentationVorbelegen = (id: string, v: PraesentationVorbelegen) =>
  anfrage<{ data: Record<string, unknown> | null; hinweis: string | null }>(`/api/praesentationen/${id}/vorbelegen`, senden('POST', v));
/** KI-Text für eine Folie (Lage oder Objekt); gespeichert wird erst, wenn der Editor das Ergebnis übernimmt. */
export const praesentationKi = (id: string, v: PraesentationKi) =>
  anfrage<{ data: Record<string, unknown> | null; hinweis: string | null }>(`/api/praesentationen/${id}/ki`, senden('POST', v));
export function usePraesentationLoeschen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => anfrage<{ id: string }>(`/api/praesentationen/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['praesentation'] }),
  });
}
export const usePraesentationStandard = () =>
  useQuery({ queryKey: ['einstellungen', 'praesentation'], queryFn: () => anfrage<FinanzpraesStandard>('/api/einstellungen/praesentation') });
/** Zielstatus für neue Propstack-Einheiten (alt: „📋 Statuses laden"). */
export const usePropstackStatus = (aktiv: boolean) =>
  useQuery({ queryKey: ['propstack', 'status'], enabled: aktiv, retry: false,
    queryFn: () => anfrage<PropstackStatusListe>('/api/propstack/status') });
export function usePropstackStatusSpeichern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number | null) => anfrage<{ gewaehlt: number | null }>('/api/propstack/status', senden('PUT', { id })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['propstack'] }),
  });
}

export const usePraesentationStandardSpeichern = () =>
  useAendern('einstellungen', (e: FinanzpraesStandard) => anfrage<FinanzpraesStandard>('/api/einstellungen/praesentation', senden('PUT', e)));

/** Datei-Export (PDF/PowerPoint) der gespeicherten Präsentation. */
export async function dateiLaden(pfad: string): Promise<{ datei: Blob; name: string }> {
  const res = await fetch(pfad, { headers: await mitToken() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiFehler(res.status, body?.fehler ?? `Export fehlgeschlagen (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Export';
  return { datei: await res.blob(), name };
}

/** Datei im Browser speichern (Download über einen temporären Link). */
export function herunterladen(datei: Blob, name: string) {
  const url = URL.createObjectURL(datei);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Begleitscheine ────────────────────────────────────────
export const useBegleitscheine = () => useQuery({ queryKey: ['begleitscheine'], queryFn: () => anfrage<BegleitscheinEintrag[]>('/api/begleitscheine') });
export const useBegleitschein = (id: string) =>
  useQuery({ queryKey: ['begleitschein', id], queryFn: () => anfrage<Begleitschein>(`/api/begleitscheine/${id}`), staleTime: Infinity });
export function useBegleitscheinAnlegen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: { typ: 'ankauf' | 'verkauf'; objektId: string; whgNr?: string; name: string }) => anfrage<Begleitschein>('/api/begleitscheine', senden('POST', e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['begleitscheine'] }),
  });
}
export function useBegleitscheinLoeschen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => anfrage<{ id: string }>(`/api/begleitscheine/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['begleitscheine'] }),
  });
}
export const begleitscheinSpeichern = (id: string, e: BegleitscheinSpeichern) => anfrage<Begleitschein>(`/api/begleitscheine/${id}`, senden('PUT', e));
export const begleitscheinAktion = (id: string, aktionId: string) => anfrage<BsAktionErgebnis>(`/api/begleitscheine/${id}/aktionen/${aktionId}`, senden('POST', {}));

type Typ = 'ankauf' | 'verkauf';
export const useBsVorlage = (typ: Typ) => useQuery({ queryKey: ['einstellungen', 'bs', typ, 'vorlage'], queryFn: () => anfrage<BsVorlage>(`/api/einstellungen/begleitscheine/${typ}/vorlage`) });
export const useBsAktionen = (typ: Typ) => useQuery({ queryKey: ['einstellungen', 'bs', typ, 'aktionen'], queryFn: () => anfrage<BsAktion[]>(`/api/einstellungen/begleitscheine/${typ}/aktionen`) });
export const useVordrucke = () => useQuery({ queryKey: ['einstellungen', 'vordrucke'], queryFn: () => anfrage<(BsVordruck & { verwendung: number })[]>('/api/einstellungen/vordrucke') });
export const useBsVorlageSpeichern = (typ: Typ) =>
  useAendern('einstellungen', (e: { kopf: string; rows: BsVorlage['rows'] }) => anfrage<{ vorlage: BsVorlage; entfernteAktionen: number }>(`/api/einstellungen/begleitscheine/${typ}/vorlage`, senden('PUT', e)));
export const useBsVorlageZuruecksetzen = (typ: Typ) =>
  useAendern('einstellungen', () => anfrage<{ vorlage: BsVorlage; entfernteAktionen: number }>(`/api/einstellungen/begleitscheine/${typ}/vorlage/zuruecksetzen`, senden('POST', {})));
export const useBsAktionenSpeichern = (typ: Typ) =>
  useAendern('einstellungen', (liste: BsAktion[]) => anfrage<BsAktion[]>(`/api/einstellungen/begleitscheine/${typ}/aktionen`, senden('PUT', liste)));
export const useVordruckeSpeichern = () =>
  useAendern('einstellungen', (liste: BsVordruck[]) => anfrage<(BsVordruck & { verwendung: number })[]>('/api/einstellungen/vordrucke', senden('PUT', liste)));

// ── Vertriebslisten ───────────────────────────────────────
export const useVertriebslisten = () =>
  useQuery({ queryKey: ['vertriebslisten'], queryFn: () => anfrage<{ dealId: string; adresse: string; stadt: string; einheiten: number; liste: { id: string; zeilen: number; zuletzt: string } | null }[]>('/api/vertriebslisten') });
export const useVertriebsliste = (id: string) =>
  useQuery({ queryKey: ['vertriebsliste', id], queryFn: () => anfrage<Vertriebsliste>(`/api/vertriebslisten/${id}`), staleTime: Infinity });
export function useVertriebslisteAnlegen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (dealId: string) => anfrage<Vertriebsliste>(`/api/deals/${dealId}/vertriebsliste`, senden('POST', {})), onSettled: () => qc.invalidateQueries({ queryKey: ['vertriebslisten'] }) });
}
export function useVertriebslisteLoeschen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => anfrage<{ id: string }>(`/api/vertriebslisten/${id}`, { method: 'DELETE' }), onSettled: () => qc.invalidateQueries({ queryKey: ['vertriebslisten'] }) });
}
export const vertriebslisteSpeichern = (id: string, e: VertriebslisteSpeichern) => anfrage<Vertriebsliste>(`/api/vertriebslisten/${id}`, senden('PUT', e));
export const useVlEinstellungen = () => useQuery({ queryKey: ['einstellungen', 'vertriebslisten'], queryFn: () => anfrage<VertriebslistenEinstellungen>('/api/einstellungen/vertriebslisten') });
export const useVlEinstellungenSpeichern = () =>
  useAendern('einstellungen', (e: VertriebslistenEinstellungen) => anfrage<VertriebslistenEinstellungen>('/api/einstellungen/vertriebslisten', senden('PUT', e)));

// ── Projektmanagement ─────────────────────────────────────
export const useProjekte = () => useQuery({ queryKey: ['projekte'], queryFn: () => anfrage<Projekt[]>('/api/projekte') });
export const useProjekt = (id: string) => useQuery({ queryKey: ['projekt', id], queryFn: () => anfrage<Projekt>(`/api/projekte/${id}`), staleTime: Infinity });
export const useProjektDealAuswahl = (aktiv: boolean) =>
  useQuery({ queryKey: ['projekte', 'deal-auswahl'], queryFn: () => anfrage<ProjektDealAuswahl[]>('/api/projekte/deal-auswahl'), enabled: aktiv });
export function useProjektAnlegen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (e: ProjektAnlegen) => anfrage<Projekt>('/api/projekte', senden('POST', e)), onSettled: () => qc.invalidateQueries({ queryKey: ['projekte'] }) });
}
export function useProjektLoeschen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => anfrage<{ id: string }>(`/api/projekte/${id}`, { method: 'DELETE' }), onSettled: () => qc.invalidateQueries({ queryKey: ['projekte'] }) });
}
export const projektSpeichern = (id: string, e: ProjektSpeichern) => anfrage<Projekt>(`/api/projekte/${id}`, senden('PUT', e));

// ── Listen und gespeicherte Filter ────────────────────────
export const useListen = () => useQuery({ queryKey: ['listen'], queryFn: () => anfrage<ListenAltformat>('/api/listen') });
export const useFilter = () => useQuery({ queryKey: ['filter'], queryFn: () => anfrage<GespeicherterFilter[]>('/api/filter') });
function useFilterAendern<E, R>(aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['filter'] }) });
}
export const useFilterVorlagen = () => useFilterAendern((modul: GespeicherterFilter['module']) => anfrage<GespeicherterFilter[]>(`/api/filter/vorlagen/${modul}`, senden('POST', {})));
export const useFilterAnlegen = () => useFilterAendern((e: GespeicherterFilterAnlegen) => anfrage<GespeicherterFilter>('/api/filter', senden('POST', e)));
export const useFilterUmbenennen = () => useFilterAendern((e: { id: string; name: string }) => anfrage<GespeicherterFilter>(`/api/filter/${e.id}`, senden('PUT', { name: e.name })));
export const useFilterLoeschen = () => useFilterAendern((id: string) => anfrage<{ id: string }>(`/api/filter/${id}`, { method: 'DELETE' }));

// ── Dokumente an Deal und Objekt (Protokoll 19) ───────────
export type DokumentBezug = { art: 'deal' | 'objekt'; id: string };
const bezugPfad = (b: DokumentBezug) => `/api/${b.art === 'deal' ? 'deals' : 'objekte'}/${b.id}/dokumente`;
/** Adresse zum Öffnen über die App — bei SharePoint leitet sie auf die kurzlebige Download-Adresse weiter */
export const dokumentDateiUrl = (b: DokumentBezug, dokId: string) => `${bezugPfad(b)}/${dokId}/datei`;
/** `mitDeals`: am Objekt auch die Dokumente seiner Deals */
export const useDokumente = (b: DokumentBezug, mitDeals = false, aktiv = true) =>
  useQuery({ queryKey: ['dokumente', b.art, b.id, mitDeals], enabled: aktiv, queryFn: () => anfrage<Dokument[]>(`${bezugPfad(b)}${mitDeals ? '?mitDeals=1' : ''}`) });
function useDokumentAendern<E, R>(b: DokumentBezug, aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  // Ein Deal-Dokument ändert auch die Liste des Objekts — alle Dokumentlisten neu laden
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['dokumente'] }) });
}
export const useDokumenteHochladen = (b: DokumentBezug) => useDokumentAendern(b, async (dateien: File[]) => {
  // Nacheinander: ein Stapel großer Scans soll die Leitung nicht mit zwanzig parallelen Uploads belegen
  const liegend: { key: string; name: string; typ: string }[] = [];
  for (const f of dateien) liegend.push({ key: await direktHochladen('dokument', f), name: f.name, typ: f.type || 'application/octet-stream' });
  try {
    return await anfrage<Dokument[]>(`${bezugPfad(b)}/uebernehmen`, senden('POST', { dateien: liegend }));
  } catch (e) {
    if (e instanceof ApiFehler) throw new ApiFehler(e.status, [e.message, (e.details as { hint?: string } | undefined)?.hint].filter(Boolean).join(' '));
    throw e;
  }
});
export const useDokumentBezeichnen = (b: DokumentBezug) => useDokumentAendern(b, (e: { id: string; label: string }) => anfrage<{ ok: true }>(`${bezugPfad(b)}/${e.id}`, senden('PATCH', { label: e.label })));
export const useDokumentLoeschen = (b: DokumentBezug) => useDokumentAendern(b, (id: string) => anfrage<{ ok: true }>(`${bezugPfad(b)}/${id}`, { method: 'DELETE' }));

// ── Kalkulationsvarianten und Einheiten aus Mieterliste ───
export const useVarianten = (dealId: string) => useQuery({ queryKey: ['varianten', dealId], queryFn: () => anfrage<KalkVariante[]>(`/api/deals/${dealId}/varianten`) });
function useVarianteAendern<E, R>(dealId: string, aufruf: (e: E) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: aufruf, onSettled: () => qc.invalidateQueries({ queryKey: ['varianten', dealId] }) });
}
export const useVarianteAnlegen = (dealId: string) => useVarianteAendern(dealId, (e: KalkVarianteAnlegen) => anfrage<{ variante: KalkVariante; anzahl: number }>(`/api/deals/${dealId}/varianten`, senden('POST', e)));
export const useVarianteLoeschen = (dealId: string) => useVarianteAendern(dealId, (id: string) => anfrage<{ ok: true }>(`/api/deals/${dealId}/varianten/${id}`, { method: 'DELETE' }));
export interface ErkannteEinheiten { docId: string; einheiten: { typ: string; lage?: string; zimmer?: number | null; flaeche?: number | null; kaltmiete?: number | null; stk?: number | null }[]; pages: number }
export function useEinheitenAusPdf(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (datei: File) => {
      const form = new FormData();
      form.append('file', datei, datei.name);
      const res = await fetch(`/api/deals/${dealId}/einheiten-aus-pdf`, { method: 'POST', body: form, headers: await mitToken() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiFehler(res.status, body?.fehler ?? `HTTP ${res.status}`);
      return body as ErkannteEinheiten;
    },
    // Das PDF liegt auch bei einem Fehler der KI in den Dokumenten des Deals
    onSettled: () => qc.invalidateQueries({ queryKey: ['dokumente'] }),
  });
}

export const useDealObjektWechseln = (id: string) =>
  useAendern('deals', (e: { objektId: string; version: number }) => anfrage<Geaendert>(`/api/deals/${id}/objekt`, senden('PATCH', e)));
export function useDealLoeschen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => anfrage<{ id: string }>(`/api/deals/${id}`, { method: 'DELETE' }),
    // Das Objekt geht mit seinem letzten Deal in den Papierkorb: Objekte mit neu laden
    onSettled: () => Promise.all(['deals', 'objekte', 'ankauf'].map((bereich) => qc.invalidateQueries({ queryKey: [bereich] }))),
  });
}

export const useVorlagen = () => useQuery({ queryKey: ['einstellungen', 'vorlagen'], queryFn: () => anfrage<VorlagenEinstellungen>('/api/einstellungen/vorlagen') });
export const useVorlagenSpeichern = () => useAendern('einstellungen', (e: VorlagenEinstellungen) => anfrage<VorlagenEinstellungen>('/api/einstellungen/vorlagen', senden('PUT', e)));

// ── Makler: Persönliches, KI, Stil, Transkription ─────────
export const useMaklerLoeschen = () => useAendern('makler', (id: string) => anfrage<{ id: string }>(`/api/makler/${id}`, { method: 'DELETE' }));
export const useMaklerPersoenlich = (id: string) =>
  useAendern('makler', (e: { geburtsdatum: string; anredeForm: '' | 'du' | 'sie' }) => anfrage<{ persoenlich: Record<string, unknown> }>(`/api/makler/${id}/persoenlich`, senden('PUT', e)));
export const useMaklerKi = <R,>(id: string, was: 'zusammenfassung' | 'beziehungsprofil' | 'persoenliches' | 'erwaehnungen' | 'entwurf') =>
  useAendern('makler', (e: object | void) => anfrage<R>(`/api/makler/${id}/ki/${was}`, senden('POST', e ?? {})));
export const usePersona = () => useQuery({ queryKey: ['persona'], queryFn: () => anfrage<PersonaStand>('/api/persona') });
export function usePersonaAnalysieren() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => anfrage<PersonaStand>('/api/persona/analyse', senden('POST', {})), onSuccess: (d) => qc.setQueryData(['persona'], d) });
}
export const useEntwurf = (id: string) => useMutation({ mutationFn: () => anfrage<NachrichtEntwurf>(`/api/makler/${id}/ki/entwurf`, senden('POST', {})) });
export async function transkribieren(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'audio.webm');
  const res = await fetch('/api/transkription', { method: 'POST', body: form, headers: await mitToken() });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.text !== 'string') throw new ApiFehler(res.status, body?.fehler ?? `Server antwortete mit HTTP ${res.status}`);
  return body.text;
}

export interface KontaktAnlass { emoji: string; text: string; priority: string; quelleUrl?: string }
/** Kontakt-Anlässe (KI + öffentliche Suche), 24 h je Makler (alt: immo-hooks-<id>). */
export const useAnlaesse = (maklerId: string, aktiv: boolean) =>
  useQuery({ queryKey: ['anlaesse', maklerId], queryFn: () => anfrage<{ anlaesse: KontaktAnlass[] }>(`/api/makler/${maklerId}/ki/anlaesse`, senden('POST', {})), enabled: aktiv, staleTime: 24 * 60 * 60 * 1000, retry: false });
export const useGespraechsoeffner = (maklerId: string | null) =>
  useQuery({ queryKey: ['gespraechsoeffner', maklerId], queryFn: () => anfrage<{ text: string }>(`/api/makler/${maklerId}/ki/gespraechsoeffner`, senden('POST', {})), enabled: !!maklerId, staleTime: Infinity, retry: false });
export const useOsint = (id: string) => useAendern('makler', () => anfrage<{ persoenlich: Record<string, unknown> }>(`/api/makler/${id}/osint`, senden('POST', {})));
