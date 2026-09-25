/**
 * Nachbau der Graph-Drive-API für Tests — nur das, was der Adapter benutzt: Token, Site → Drive, Items über Pfad,
 * Ordner anlegen, Inhalt ablegen, Upload-Session mit Content-Range, Download-Adresse mit Range, löschen,
 * verschieben, kopieren (202 + Nachfragen), Kinder, Delta. Dazu eine einmalige Drosselung (429) auf Wunsch.
 * Gleiche Bauart wie `autoimport/testseiten.ts`: echter HTTP-Server, echte Anfragen des Codes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface Eintrag { id: string; name: string; pfad: string; ordner: boolean; bytes: Uint8Array; eTag: string; geaendert: string; geloescht?: boolean }

export interface GraphNachbau {
  basis: string;
  loginBasis: string;
  siteId: string;
  eintraege: Map<string, Eintrag>;
  /** die nächste Anfrage auf diesen Pfad-Teil bekommt einmal 429 */
  drosselnEinmal(pfadTeil: string): void;
  anfragen: string[];
  stop(): Promise<void>;
}

export async function graphNachbauStarten(): Promise<GraphNachbau> {
  const eintraege = new Map<string, Eintrag>();
  const sessions = new Map<string, { pfad: string; teile: Uint8Array[]; erwartet: number }>();
  const monitore = new Set<string>();
  const anfragen: string[] = [];
  let drossel: string | null = null;
  let zaehler = 0;
  const DRIVE = 'drive-test';
  const SITE = 'test.sharepoint.com,site-guid,web-guid';
  let basis = '';
  const neueId = () => `item-${++zaehler}`;
  const jetzt = () => new Date().toISOString();

  const wurzel: Eintrag = { id: 'root', name: 'root', pfad: '', ordner: true, bytes: new Uint8Array(0), eTag: '"root"', geaendert: jetzt() };
  const hole = (pfad: string) => (pfad === '' ? wurzel : eintraege.get(pfad));
  const elternVon = (pfad: string) => pfad.split('/').slice(0, -1).join('/');
  const alsGraph = (e: Eintrag) => ({
    id: e.id, name: e.name, size: e.bytes.byteLength, eTag: e.eTag, lastModifiedDateTime: e.geaendert,
    webUrl: `https://test.sharepoint.com/sites/test/Dokumente/${e.pfad}`,
    parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:${e.pfad.includes('/') ? '/' + elternVon(e.pfad) : ''}` },
    ...(e.ordner ? { folder: { childCount: 0 } } : { file: { mimeType: 'application/octet-stream' }, '@microsoft.graph.downloadUrl': `${basis}/_download/${e.id}` }),
  });
  const anlegen = (pfad: string, ordner: boolean, bytes = new Uint8Array(0)): Eintrag => {
    const e: Eintrag = { id: neueId(), name: pfad.split('/').pop()!, pfad, ordner, bytes, eTag: `"${neueId()}"`, geaendert: jetzt() };
    eintraege.set(pfad, e);
    return e;
  };
  const lesen = (req: IncomingMessage) => new Promise<Buffer>((r) => { const t: Buffer[] = []; req.on('data', (d) => t.push(d)); req.on('end', () => r(Buffer.concat(t))); });
  const antwort = (res: ServerResponse, status: number, body?: unknown, kopf: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...kopf });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const p = decodeURIComponent(url.pathname);
    anfragen.push(`${req.method} ${p}`);
    if (drossel && p.includes(drossel)) { drossel = null; return antwort(res, 429, { error: { code: 'tooManyRequests' } }, { 'retry-after': '0' }); }

    // Token
    if (req.method === 'POST' && p.endsWith('/oauth2/v2.0/token')) {
      const body = new URLSearchParams((await lesen(req)).toString());
      if (body.get('grant_type') !== 'client_credentials' || body.get('client_secret') !== 'geheim') return antwort(res, 401, { error_description: 'falsches Secret' });
      return antwort(res, 200, { access_token: 'app-token', expires_in: 3600 });
    }
    if (req.headers.authorization !== 'Bearer app-token' && !p.startsWith('/_')) return antwort(res, 401, { error: { code: 'InvalidAuthenticationToken' } });

    // Site → Drive
    if (req.method === 'GET' && p === `/v1.0/sites/${SITE}/drive`) return antwort(res, 200, { id: DRIVE, name: 'Dokumente' });

    // Upload-Session (vorab autorisiert, ohne Token)
    if (p.startsWith('/_upload/')) {
      const s = sessions.get(p.slice('/_upload/'.length));
      if (!s) return antwort(res, 404, {});
      const bereich = /bytes (\d+)-(\d+)\/(\d+)/.exec(String(req.headers['content-range'] ?? ''));
      if (!bereich) return antwort(res, 400, { error: { message: 'Content-Range fehlt' } });
      s.teile.push(new Uint8Array(await lesen(req)));
      s.erwartet = Number(bereich[3]);
      const bisher = s.teile.reduce((n, t) => n + t.byteLength, 0);
      if (bisher < s.erwartet) return antwort(res, 202, { nextExpectedRanges: [`${bisher}-`] });
      const zusammen = new Uint8Array(bisher); let o = 0; for (const t of s.teile) { zusammen.set(t, o); o += t.byteLength; }
      const e = anlegen(s.pfad, false, zusammen);
      return antwort(res, 201, alsGraph(e));
    }
    // Download-Adresse (vorab autorisiert, mit Range)
    if (p.startsWith('/_download/')) {
      const e = [...eintraege.values()].find((x) => x.id === p.slice('/_download/'.length));
      if (!e) return antwort(res, 404, {});
      const range = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''));
      if (range) {
        const von = Number(range[1]); const bis = Math.min(Number(range[2]), e.bytes.byteLength - 1);
        res.writeHead(206, { 'content-range': `bytes ${von}-${bis}/${e.bytes.byteLength}` }); return res.end(Buffer.from(e.bytes.subarray(von, bis + 1)));
      }
      res.writeHead(200); return res.end(Buffer.from(e.bytes));
    }
    // Kopier-Monitor
    if (p.startsWith('/_monitor/')) return antwort(res, 200, monitore.has(p) ? { status: 'completed', percentageComplete: 100 } : { status: 'failed' });

    // Delta
    if (req.method === 'GET' && p === `/v1.0/drives/${DRIVE}/root/delta`) {
      return antwort(res, 200, { value: [...eintraege.values()].map((e) => ({ ...alsGraph(e), ...(e.geloescht ? { deleted: { state: 'deleted' } } : {}) })), '@odata.deltaLink': `${basis}/v1.0/drives/${DRIVE}/root/delta?token=t1` });
    }
    if (req.method === 'GET' && p === `/v1.0/drives/${DRIVE}/root/delta` && url.searchParams.get('token')) return antwort(res, 200, { value: [], '@odata.deltaLink': `${basis}${p}?token=t2` });

    // Items über Pfad: /v1.0/drives/<d>/root[:/<pfad>:][/<aktion>]
    const m = /^\/v1\.0\/drives\/drive-test\/root(?::\/(.*?):)?(?:\/(children|content|createUploadSession|copy))?$/.exec(p);
    if (!m) return antwort(res, 404, { error: { code: 'itemNotFound', message: p } });
    const pfad = m[1] ?? '';
    const aktion = m[2];
    const e = hole(pfad);

    if (aktion === 'children') {
      if (!e || !e.ordner) return antwort(res, 404, { error: { code: 'itemNotFound' } });
      if (req.method === 'GET') {
        const kinder = [...eintraege.values()].filter((x) => !x.geloescht && elternVon(x.pfad) === pfad && x.pfad !== '');
        const seite = Number(url.searchParams.get('$skip') ?? 0);
        const stueck = kinder.slice(seite, seite + 2); // klein, damit die Blätterung geprüft wird
        return antwort(res, 200, { value: stueck.map(alsGraph), ...(seite + 2 < kinder.length ? { '@odata.nextLink': `${basis}${p}?$top=2&$skip=${seite + 2}` } : {}) });
      }
      const body = JSON.parse((await lesen(req)).toString()) as { name: string; folder?: object; '@microsoft.graph.conflictBehavior'?: string };
      const neu = pfad ? `${pfad}/${body.name}` : body.name;
      if (eintraege.has(neu)) return antwort(res, 409, { error: { code: 'nameAlreadyExists' } });
      return antwort(res, 201, alsGraph(anlegen(neu, Boolean(body.folder))));
    }
    if (aktion === 'content' && req.method === 'PUT') {
      if (!hole(elternVon(pfad))) return antwort(res, 404, { error: { code: 'itemNotFound', message: 'Ordner fehlt' } });
      const bytes = new Uint8Array(await lesen(req));
      if (bytes.byteLength > 4 * 1024 * 1024) return antwort(res, 413, { error: { code: 'tooLarge' } });
      const alt = eintraege.get(pfad);
      const neu = anlegen(pfad, false, bytes);
      if (alt) neu.id = alt.id;
      return antwort(res, alt ? 200 : 201, alsGraph(neu));
    }
    if (aktion === 'createUploadSession') {
      const id = neueId();
      sessions.set(id, { pfad, teile: [], erwartet: 0 });
      return antwort(res, 200, { uploadUrl: `${basis}/_upload/${id}` });
    }
    if (aktion === 'copy') {
      if (!e) return antwort(res, 404, {});
      const body = JSON.parse((await lesen(req)).toString()) as { parentReference: { id: string }; name: string };
      const ziel = [...eintraege.values()].find((x) => x.id === body.parentReference.id) ?? wurzel;
      anlegen(ziel.pfad ? `${ziel.pfad}/${body.name}` : body.name, false, new Uint8Array(e.bytes));
      const mon = `/_monitor/${neueId()}`; monitore.add(mon);
      return antwort(res, 202, undefined, { location: `${basis}${mon}` });
    }
    if (!aktion) {
      if (req.method === 'GET') return e && !e.geloescht ? antwort(res, 200, alsGraph(e)) : antwort(res, 404, { error: { code: 'itemNotFound' } });
      if (req.method === 'DELETE') { if (!e) return antwort(res, 404, {}); for (const [k, x] of eintraege) if (k === pfad || k.startsWith(`${pfad}/`)) { x.geloescht = true; eintraege.delete(k); eintraege.set(`\u0000${k}`, x); } return antwort(res, 204); }
      if (req.method === 'PATCH') {
        if (!e) return antwort(res, 404, {});
        const body = JSON.parse((await lesen(req)).toString()) as { parentReference?: { id: string }; name?: string };
        const ziel = body.parentReference ? ([...eintraege.values()].find((x) => x.id === body.parentReference!.id) ?? wurzel) : hole(elternVon(pfad))!;
        const neuPfad = ziel.pfad ? `${ziel.pfad}/${body.name ?? e.name}` : body.name ?? e.name;
        eintraege.delete(pfad); e.pfad = neuPfad; e.name = neuPfad.split('/').pop()!; eintraege.set(neuPfad, e);
        return antwort(res, 200, alsGraph(e));
      }
    }
    return antwort(res, 405, {});
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  basis = `http://127.0.0.1:${port}`;
  return {
    basis: `${basis}/v1.0`, loginBasis: basis, siteId: SITE, eintraege, anfragen,
    drosselnEinmal: (t) => { drossel = t; },
    stop: () => new Promise((r) => server.close(() => r())),
  };
}
