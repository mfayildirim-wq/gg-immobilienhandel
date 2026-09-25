/**
 * SharePoint über Microsoft Graph: App-Token (client_credentials) und die Drive-Aufrufe, die der
 * Dateispeicher-Adapter braucht (Protokoll 19). Nur das, was gebraucht wird — keine Bibliothek, dieselben
 * einfachen HTTPS-Aufrufe wie beim Postfach (`m365/graph.ts`), mit Wiederholung bei Drosselung.
 *
 * Begriffe: Site → Drive (Dokumentbibliothek) → DriveItem (Ordner oder Datei). Items werden hier über ihren
 * Pfad unterhalb der Bibliothekswurzel angesprochen (`root:/Ordner/Datei.pdf`); die stabile `id` kommt in
 * jeder Antwort mit und wird von der Datenbank gemerkt (Phase 2).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Graph liefert lose typisierte Antworten */

export interface AppTokenKonfiguration { tenantId: string; clientId: string; clientSecret: string }

/**
 * App-Token ohne angemeldeten Nutzer (`client_credentials`, Scope `.default`): die Rechte sind die der
 * App-Registrierung (`Sites.Selected`, vom Admin je Site gewährt). Wird gecacht und 60 s vor Ablauf erneuert.
 */
export function appToken(cfg: AppTokenKonfiguration, loginBasis = 'https://login.microsoftonline.com'): () => Promise<string> {
  let token = '';
  let ablauf = 0;
  return async () => {
    if (token && Date.now() < ablauf - 60_000) return token;
    const res = await fetch(`${loginBasis}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) throw new Error(`Microsoft antwortete mit ${res.status}: ${body.error_description ?? 'kein App-Token'}`);
    token = body.access_token;
    ablauf = Date.now() + (body.expires_in ?? 3600) * 1000;
    return token;
  };
}

/**
 * Graph spricht Sites auch über `hostname:/sites/Name` an — die Adresse aus dem Browser reicht als Site-Kennung.
 * `https://firma.sharepoint.com/sites/GGImmohandel` → `firma.sharepoint.com:/sites/GGImmohandel:`; eine Kennung
 * der Form `host,guid,guid` bleibt, wie sie ist.
 */
export function siteIdAusUrl(siteUrl: string): string {
  const s = siteUrl.trim();
  if (!/^https?:\/\//i.test(s)) return s;
  const u = new URL(s);
  const pfad = u.pathname.replace(/\/+$/, '');
  return pfad && pfad !== '/' ? `${u.hostname}:${pfad}:` : u.hostname;
}

export interface DriveItem {
  id: string;
  name: string;
  /** Pfad unterhalb der Bibliothekswurzel, ohne führenden Schrägstrich */
  pfad: string;
  groesse: number;
  /** ISO-8601 */
  geaendert: string;
  eTag: string;
  webUrl: string;
  ordner: boolean;
  /** vorab autorisierte, kurzlebige Adresse (~1 h) — nur bei Dateien, nur wenn Graph sie mitliefert */
  downloadUrl?: string;
}

export interface DeltaErgebnis {
  eintraege: (DriveItem & { geloescht: boolean })[];
  /** für den nächsten Aufruf — nur Änderungen seit diesem Stand */
  token: string;
}

export interface GraphDrive {
  /** Kennung der Dokumentbibliothek der Site (wird einmal ermittelt) */
  driveId(): Promise<string>;
  item(pfad: string): Promise<DriveItem | null>;
  /** Item über seine stabile Kennung — findet es auch, wenn es in SharePoint verschoben oder umbenannt wurde */
  itemNachId(id: string): Promise<DriveItem | null>;
  /** legt fehlende Ordner auf dem Weg an; gibt das Ordner-Item zurück */
  ordnerSicherstellen(pfad: string): Promise<DriveItem>;
  /** Dateien bis 4 MB in einem Aufruf; größere über eine Upload-Session in Stücken (vom Server aus) */
  ablegen(pfad: string, bytes: Uint8Array, typ: string): Promise<DriveItem>;
  /** vorab autorisierte Adresse, an die der Browser die Datei in Stücken schickt (Content-Range) */
  uploadSession(pfad: string): Promise<{ uploadUrl: string }>;
  /** Inhalt über die kurzlebige Download-Adresse; `bereich` = Bytes von–bis (einschließlich) */
  holen(pfad: string, bereich?: { von: number; bis: number }): Promise<Uint8Array>;
  loeschen(pfad: string): Promise<void>;
  verschieben(von: string, nach: string): Promise<DriveItem>;
  /** kopiert asynchron; wartet, bis Graph fertig meldet */
  kopieren(von: string, nach: string): Promise<void>;
  /** alle Dateien unterhalb eines Ordners, auch in Unterordnern (Ordner selbst nicht) */
  dateienUnter(pfad: string): Promise<DriveItem[]>;
  /** Änderungen seit `token` (leer: alles) — für den Abgleich, wenn jemand in SharePoint direkt arbeitet */
  delta(token?: string): Promise<DeltaErgebnis>;
}

/** Graph drosselt (429) und meldet Überlast (5xx) — beides ist vorübergehend und wird wiederholt. */
const WIEDERHOLBAR = new Set([429, 500, 502, 503, 504]);
const VERSUCHE = 4;
/** Ab hier über eine Upload-Session in Stücken; Graph nimmt in einem Aufruf höchstens 4 MB. */
export const KLEIN_BIS = 4 * 1024 * 1024;
/** Stückgröße für Upload-Sessions — Vielfaches von 320 KiB, wie Graph es verlangt. */
export const STUECK = 10 * 320 * 1024 * 4; // 12,5 MiB

const encodePfad = (pfad: string) => pfad.split('/').filter(Boolean).map(encodeURIComponent).join('/');

function alsItem(d: Record<string, any>): DriveItem {
  const eltern = String(d.parentReference?.path ?? ''); // "/drives/<id>/root:/Ordner"
  const ordnerPfad = eltern.includes('root:') ? decodeURIComponent(eltern.slice(eltern.indexOf('root:') + 5)).replace(/^\//, '') : '';
  return {
    id: d.id, name: d.name, pfad: ordnerPfad ? `${ordnerPfad}/${d.name}` : d.name,
    groesse: Number(d.size ?? 0), geaendert: d.lastModifiedDateTime ?? '', eTag: d.eTag ?? d.cTag ?? '', webUrl: d.webUrl ?? '',
    ordner: Boolean(d.folder), downloadUrl: d['@microsoft.graph.downloadUrl'],
  };
}

export function graphDrive(accessToken: () => Promise<string>, siteId: string, basis = 'https://graph.microsoft.com/v1.0'): GraphDrive {
  let drive = '';

  const rufe = async (methode: string, pfad: string, body?: unknown, kopf: Record<string, string> = {}): Promise<Response> => {
    let letzter = '';
    for (let versuch = 1; versuch <= VERSUCHE; versuch++) {
      const res = await fetch(pfad.startsWith('http') ? pfad : basis + pfad, {
        method: methode,
        headers: {
          Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json',
          ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...kopf,
        },
        body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      });
      if (res.ok) return res;
      letzter = `Graph ${res.status} bei ${methode} ${pfad}: ${(await res.text()).slice(0, 300)}`;
      if (!WIEDERHOLBAR.has(res.status) || versuch === VERSUCHE) throw Object.assign(new Error(letzter), { status: res.status });
      const warte = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(warte) && warte > 0 ? warte * 1000 : 1000 * 2 ** (versuch - 1), 20_000)));
    }
    throw new Error(letzter);
  };
  const json = async <T>(methode: string, pfad: string, body?: unknown, kopf?: Record<string, string>): Promise<T> => (await rufe(methode, pfad, body, kopf)).json() as Promise<T>;
  const status = (e: unknown) => (e as { status?: number })?.status;

  const driveId = async () => {
    if (!drive) drive = (await json<{ id: string }>('GET', `/sites/${siteId.includes(':') ? siteId : encodeURIComponent(siteId)}/drive?$select=id`)).id;
    return drive;
  };
  const wurzel = async (pfad: string) => `/drives/${await driveId()}/root${pfad ? `:/${encodePfad(pfad)}:` : ''}`;

  const item = async (pfad: string): Promise<DriveItem | null> => {
    try {
      return alsItem(await json('GET', pfad ? `${await wurzel(pfad)}` : `/drives/${await driveId()}/root`));
    } catch (e) {
      if (status(e) === 404) return null;
      throw e;
    }
  };

  const itemNachId = async (id: string): Promise<DriveItem | null> => {
    try {
      return alsItem(await json('GET', `/drives/${await driveId()}/items/${encodeURIComponent(id)}`));
    } catch (e) {
      if (status(e) === 404) return null;
      throw e;
    }
  };

  const ordnerSicherstellen = async (pfad: string): Promise<DriveItem> => {
    const teile = pfad.split('/').filter(Boolean);
    let bisher = '';
    let aktuell: DriveItem | null = null;
    for (const teil of teile) {
      const eltern = bisher;
      bisher = bisher ? `${bisher}/${teil}` : teil;
      aktuell = await item(bisher);
      if (aktuell) continue;
      try {
        aktuell = alsItem(await json('POST', `${await wurzel(eltern)}/children`, { name: teil, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }));
      } catch (e) {
        // gleichzeitig von anderer Stelle angelegt: kein Fehler
        if (status(e) !== 409) throw e;
        aktuell = await item(bisher);
      }
    }
    return aktuell ?? (await item(''))!;
  };

  const elternPfad = (pfad: string) => pfad.split('/').slice(0, -1).join('/');

  const uploadSession = async (pfad: string) => {
    await ordnerSicherstellen(elternPfad(pfad));
    const d = await json<{ uploadUrl: string }>('POST', `${await wurzel(pfad)}/createUploadSession`, { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
    return { uploadUrl: d.uploadUrl };
  };

  const ablegen = async (pfad: string, bytes: Uint8Array, typ: string): Promise<DriveItem> => {
    if (bytes.byteLength <= KLEIN_BIS) {
      await ordnerSicherstellen(elternPfad(pfad));
      return alsItem(await json('PUT', `${await wurzel(pfad)}/content`, bytes, { 'Content-Type': typ }));
    }
    // Groß: Upload-Session, Stücke der Reihe nach — die Session-Adresse ist vorab autorisiert, kein Token nötig
    const { uploadUrl } = await uploadSession(pfad);
    let letzte: Record<string, any> = {};
    for (let von = 0; von < bytes.byteLength; von += STUECK) {
      const bis = Math.min(von + STUECK, bytes.byteLength);
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bis - von), 'Content-Range': `bytes ${von}-${bis - 1}/${bytes.byteLength}` }, body: bytes.subarray(von, bis) });
      if (!res.ok) throw new Error(`Graph ${res.status} beim Upload-Stück ${von}-${bis - 1}: ${(await res.text()).slice(0, 200)}`);
      letzte = (await res.json().catch(() => ({}))) as Record<string, any>;
    }
    return letzte.id ? alsItem(letzte) : (await item(pfad))!;
  };

  const holen = async (pfad: string, bereich?: { von: number; bis: number }): Promise<Uint8Array> => {
    const it = await item(pfad);
    if (!it || it.ordner) throw new Error(`SharePoint: ${pfad} nicht gefunden`);
    const url = it.downloadUrl ?? `${basis}${await wurzel(pfad)}/content`;
    const res = await fetch(url, {
      headers: { ...(it.downloadUrl ? {} : { Authorization: `Bearer ${await accessToken()}` }), ...(bereich ? { Range: `bytes=${bereich.von}-${bereich.bis}` } : {}) },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`SharePoint: Holen ${pfad} fehlgeschlagen (${res.status})`);
    const daten = new Uint8Array(await res.arrayBuffer());
    // Ein Speicher, der Range ignoriert, schickt alles — dann selbst zuschneiden
    return bereich && res.status === 200 ? daten.subarray(bereich.von, bereich.bis + 1) : daten;
  };

  const loeschen = async (pfad: string) => {
    try {
      await rufe('DELETE', await wurzel(pfad));
    } catch (e) {
      if (status(e) !== 404) throw e;
    }
  };

  const verschieben = async (von: string, nach: string): Promise<DriveItem> => {
    const ziel = await ordnerSicherstellen(elternPfad(nach));
    return alsItem(await json('PATCH', await wurzel(von), { parentReference: { id: ziel.id }, name: nach.split('/').pop(), '@microsoft.graph.conflictBehavior': 'replace' }));
  };

  const kopieren = async (von: string, nach: string) => {
    const ziel = await ordnerSicherstellen(elternPfad(nach));
    const res = await rufe('POST', `${await wurzel(von)}/copy`, { parentReference: { id: ziel.id, driveId: await driveId() }, name: nach.split('/').pop() });
    // 202: Graph kopiert im Hintergrund und nennt eine Adresse zum Nachfragen
    const monitor = res.headers.get('location');
    if (res.status !== 202 || !monitor) return;
    for (let i = 0; i < 60; i++) {
      const r = await fetch(monitor);
      const s = (await r.json().catch(() => ({}))) as { status?: string; percentageComplete?: number; error?: unknown };
      if (s.status === 'completed') return;
      if (s.status === 'failed' || s.error) throw new Error(`SharePoint: Kopieren ${von} → ${nach} fehlgeschlagen`);
      await new Promise((w) => setTimeout(w, 500));
    }
    throw new Error(`SharePoint: Kopieren ${von} → ${nach} nicht abgeschlossen`);
  };

  const dateienUnter = async (pfad: string): Promise<DriveItem[]> => {
    const aus: DriveItem[] = [];
    const offen = [pfad];
    while (offen.length) {
      const ordner = offen.pop()!;
      let seite: string | undefined = `${await wurzel(ordner)}/children?$top=200`;
      while (seite) {
        let d: { value: Record<string, any>[]; '@odata.nextLink'?: string };
        try {
          d = await json('GET', seite);
        } catch (e) {
          if (status(e) === 404 && ordner === pfad) return aus; // Wurzel des Präfixes gibt es noch nicht
          throw e;
        }
        for (const e of d.value ?? []) {
          const it = alsItem(e);
          if (it.ordner) offen.push(it.pfad);
          else aus.push(it);
        }
        seite = d['@odata.nextLink'];
      }
    }
    return aus.sort((a, b) => a.pfad.localeCompare(b.pfad));
  };

  const delta = async (token?: string): Promise<DeltaErgebnis> => {
    const eintraege: DeltaErgebnis['eintraege'] = [];
    let seite: string | undefined = token || `/drives/${await driveId()}/root/delta`;
    let neuerToken = '';
    while (seite) {
      const d: { value: Record<string, any>[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await json('GET', seite);
      for (const e of d.value ?? []) eintraege.push({ ...alsItem(e), geloescht: Boolean(e.deleted) });
      seite = d['@odata.nextLink'];
      if (d['@odata.deltaLink']) neuerToken = d['@odata.deltaLink'];
    }
    return { eintraege, token: neuerToken };
  };

  return { driveId, item, itemNachId, ordnerSicherstellen, ablegen, uploadSession, holen, loeschen, verschieben, kopieren, dateienUnter, delta };
}
