import {
  ExposeAnalyseAntwort,
  ExposeUebernahmeErgebnis,
  ExposeUebernehmen,
  Kundenkalkulation,
  KundenkalkulationAnlegen,
  KundenkalkulationEintrag,
  KundenkalkulationSpeichern,
  KundenkalkEinstellungen,
  FotoReihenfolge,
  DealDokument,
  PapierkorbEintrag,
  DublettenPaarSicht,
  AuditBefund,
  KiKosten,
  ZugangStatus,
  OutwardStand,
  BewertungsDaten,
  M365Posteingang,
  M365Stand,
  PropstackBewertung,
  PropstackStatusListe,
  PropstackStatusWahl,
  OutwardFreigabe,
  NachfassResetSicht,
  AuditFilter,
  AuditSeite,
  MergeAusfuehren,
  MergeProtokollEintrag,
  MergeVorschau,
  KalkVariante,
  KalkVarianteAnlegen,
  FilterModul,
  MaklerPersoenlich,
  NachrichtEntwurf,
  PersonaStand,
  VorlagenEinstellungen,
  GespeicherterFilter,
  GespeicherterFilterAnlegen,
  GespeicherterFilterUmbenennen,
  ListenAltformat,
  Projekt,
  ProjektAnlegen,
  ProjektDealAuswahl,
  ProjektSpeichern,
  Vertriebsliste,
  VertriebslistenEinstellungen,
  VertriebslistenEintrag,
  VertriebslisteSpeichern,
  Begleitschein,
  BegleitscheinAnlegen,
  BegleitscheinEintrag,
  BegleitscheinSpeichern,
  BsAktion,
  BsAktionErgebnis,
  BsTyp,
  BsVordruck,
  BsVorlage,
  BsVorlageSpeichern,
  FinanzpraesStandard,
  Praesentation,
  PraesentationAnlegen,
  PraesentationSpeichern,
  PraesentationVorbelegen,
  VorbelegungErgebnis,
  ObjektFoto,
  AnkaufCockpit,
  AnrufErgebnisSpeichern,
  CockpitMakler,
  TerminSetzen,
  DealAnlegen,
  DealDetail,
  DealInfoAendern,
  DealKommentar,
  DealListenEintrag,
  Fehler,
  KalkStandardSchema,
  KalkulationSpeichern,
  Kennzahlen,
  KommentarAnlegen,
  KommunikationAnlegen,
  Makler,
  MaklerAendern,
  MaklerAnlegen,
  MaklerDetail,
  MaklerKommunikation,
  Objekt,
  ObjektAendern,
  ObjektAnlegen,
  ObjektDetail,
  StatusHistorieEintrag,
  StatusWechsel,
} from '@gg/api-contract';
import type { Db } from '@gg/db';
import { AUFBEWAHRUNG, DealStatus, geplanteStufe, rueckwegPruefen, type RueckwegRegeln } from '@gg/domain';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { bankgespraechPdf, type BilderPorts, erzeugeSchleuse, finanzpraesPdf, finanzpraesPptx, KeinBrowserError, praesentationDateiname, SCHLEUSE_STANDARD, type Schleuse } from '@gg/documents/pdf';
import type { FinanzPraes } from '@gg/domain';
import { pdfDateiname, type BankgespraechPayload } from '@gg/documents';
import { FachFehler } from './fehler.ts';
import { renderTor } from './middleware/render-tor.ts';
import { bankgespraechDaten, pdfExportProtokollieren } from './services/dokumente.ts';
import {
  praesentationAnlegen, praesentationDetail, praesentationExportProtokollieren, praesentationFuerExport, praesentationLoeschen, praesentationSpeichern,
  praesentationStandardLesen, praesentationStandardSpeichern, praesentationVorbelegen, praesentationZumDeal,
} from './services/praesentationen.ts';
import {
  begleitscheinAktion, begleitscheinAnlegen, begleitscheinDetail, begleitscheineListe, begleitscheinLoeschen, begleitscheinSpeichern, bsAktionenLesen,
  bsAktionenSpeichern, bsVordruckeLesen, bsVordruckeSpeichern, bsVorlageLesen, bsVorlageSpeichern, bsVorlageZuruecksetzen,
} from './services/begleitscheine.ts';
import {
  vertriebslisteAnlegen, vertriebslisteDetail, vertriebslisteLoeschen, vertriebslistenUebersicht, vertriebslisteSpeichern, vlEinstellungenLesen, vlEinstellungenSpeichern,
} from './services/vertriebslisten.ts';
import { varianteAnlegen, varianteLoeschen, variantenListe } from './services/kalkVarianten.ts';
import { dokumentBezeichnen, dokumentDatei, einheitenAusMieterliste, dokumenteHochladen, dokumenteListe, dokumenteUebernehmen, dokumentLoeschen } from './services/dealDokumente.ts';
import { uploadTicket } from './services/direktUpload.ts';
import { alsStrom } from './strom.ts';
import { cronErlaubt } from './cron.ts';
import { ddVorlageLesen, ddVorlageSpeichern } from './services/ddVorlage.ts';
import { begrenzung, GRENZEN } from './middleware/begrenzung.ts';
import { archivSpiegeln, eingangAufraeumen } from './services/archivSpiegel.ts';
import { autoSicherungDatei, autoSicherungEinspielen, autoSicherungErstellen, autoSicherungListe, autoSicherungPlan, geplanteSicherung } from './services/autoSicherung.ts';
import { filterAnlegen, filterListe, filterLoeschen, filterUmbenennen, filterVorlagenEinrichten, listenAltformat } from './services/listen.ts';
import { projektAnlegen, projektDealAuswahl, projektDetail, projekteListe, projektLoeschen, projektSpeichern } from './services/projekte.ts';
import { fotoDatei, fotoHochladen, fotoLoeschen, fotoPort, fotosListe, fotosSortieren } from './services/fotos.ts';
import { type Dateispeicher, type GraphClient, type KiClient, type PropstackClient, nachrichtenSuche, webSuche, anthropicClient } from '@gg/integrations';
import { bekannteExposeDateien, exposeAnalysieren, exposeEingang, exposeEingangUebernehmen, type ExposeKontext, exposeUebernehmen, MAX_EXPOSE_BYTES } from './services/expose.ts';
import { auth, type AuthOptionen } from './middleware/auth.ts';
import {
  dealAnlegen,
  dealLoeschen,
  dealObjektWechseln,
  dealDetail,
  dealErledigt,
  dealInfoAendern,
  dealListe,
  kalkulationSpeichern,
  kommentarAnlegen,
  statusAendern,
  statusHistorie,
} from './services/deals.ts';
import { kalkStandardLesen, kalkStandardSpeichern, kundenkalkEinstellungenLesen, kundenkalkEinstellungenSpeichern, vorlagenLesen, vorlagenSpeichern } from './services/einstellungen.ts';
import {
  kundenkalkulationAnlegen,
  kundenkalkulationDetail,
  kundenkalkulationDuplizieren,
  kundenkalkulationenListe,
  kundenkalkulationLoeschen,
  kundenkalkulationSpeichern,
} from './services/kundenkalkulationen.ts';
import {
  ankaufCockpit,
  anrufErgebnis,
  briefingAbschliessen,
  terminloseEinplanen,
  terminSetzen,
  waehlmaschine,
  whatsappProtokollieren,
} from './services/ankauf.ts';
import { kommunikationAnlegen, maklerAendern, maklerAnlegen, maklerDetail, maklerErledigt, maklerListe, maklerLoeschen, maklerPersoenlichSpeichern } from './services/makler.ts';
import { beziehungsprofilErstellen, entwurfErstellen, erwaehnungenErgaenzen, gespraechsoeffnerErstellen, kontaktAnlaesseErmitteln, osintAusfuehren, personaAnalysieren, type Suchdienste, personaStand, persoenlichesErgaenzen, transkription, zusammenfassungErstellen } from './services/maklerKi.ts';
import { mcpAnmelden, mcpSchluesselAusKopfOderNull, mcpStand, mcpVerarbeiten } from './services/mcp.ts';
import { m365Entsperren, m365Anhang, m365AnmeldungStarten, m365KonfigurationSpeichern, m365OrdnerSpeichern, m365Posteingang, m365Rueckweg, m365Sperren, m365Stand, m365Trennen } from './services/m365.ts';
import { propstackAnlegen, propstackLesen, propstackStatusListe, propstackStatusSpeichern, propstackVorbelegen } from './services/propstack.ts';
import { freigabeBeantragen, freigabeEntscheiden, gateSpeichern, outwardStand } from './services/outward.ts';
import { maklerImportUebernehmen, maklerImportVorschau } from './services/maklerImport.ts';
import { sicherungEinspielen, sicherungExport, sicherungPlan, sicherungUmfang } from './services/sicherung.ts';
import { zugangLesen, zugangSpeichern, zugangStatus } from './services/zugaenge.ts';
import { kiKosten, nachfassResetAusfuehren, nachfassResetVorschau } from './services/werkzeuge.ts';
import { auditAufraeumen, auditExport, auditListe, auditPruefen } from './services/audit.ts';
import { dublettenIgnorieren, dublettenIgnoriertLeeren, dublettenProtokoll, dublettenRueckgaengig, dublettenScan, dublettenVorschau, dublettenZusammenfuehren } from './services/dubletten.ts';
import { papierkorbEndgueltig, papierkorbLeeren, papierkorbListe, papierkorbWiederherstellen } from './services/papierkorb.ts';
import { objektAendern, objektAnlegen, objektDetail, objekteListe, objektLoeschen } from './services/objekte.ts';

/** Fachlicher Tag in Deutschland (Nachfass-Termine), unabhängig von der Server-Zeitzone. */
const heuteBerlin = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

export interface AppKontext {
  db: Db;
  auth: AuthOptionen;
  expose?: ExposeKontext;
  /** KI (Anthropic oder Attrappe) für Makler-Funktionen; Standard: die des Exposé-Imports. */
  ki?: KiClient | null;
  /** Propstack-Client; ohne Vorgabe wird er aus dem hinterlegten Schlüssel gebaut. */
  propstack?: PropstackClient | null;
  /** Microsoft-Graph-Client; ohne Vorgabe wird er aus dem hinterlegten Zugang gebaut. */
  graph?: GraphClient | null;
  /** OpenAI-Schlüssel für die Whisper-Transkription */
  openaiKey?: string;
  /** Öffentliche Suche (DuckDuckGo, Google News); Standard: echte Abfragen, mit KI-Attrappe keine */
  suche?: Suchdienste;
  /** `CRON_SECRET`: ohne dieses Geheimnis antworten die Cron-Routen immer mit 401. */
  cronGeheimnis?: string;
  /** Wohin die Microsoft-Anmeldung zurückleiten darf; Standard: nur lokale Adressen (`rueckwegRegelnAusUmgebung`). */
  oauthRueckweg?: RueckwegRegeln;
  /** Dateiablage (Supabase Storage); ohne sie antworten Foto-Routen mit 422. */
  speicher?: Dateispeicher;
  /** PDF-Druck; Standard: lokales Chrome hinter der Render-Schleuse. Tests setzen einen Ersatz. */
  pdf?: {
    drucken: (p: BankgespraechPayload, fotos: BilderPorts) => Promise<Uint8Array>;
    praesentation?: (p: FinanzPraes, fotos: BilderPorts) => Promise<Uint8Array>;
    schleuse: Schleuse;
  };
}

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const fehler = (description: string) => json(Fehler, description);
const IdParam = z.object({ id: z.string().min(1) });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const Version = z.object({ version: z.number().int() });
const Geaendert = json(z.object({ id: z.string(), version: z.number().int() }), 'geändert');
const konflikt = { 400: fehler('Eingabe ungültig'), 404: fehler('nicht gefunden'), 409: fehler('Versionskonflikt') };

export function createApp({ db, auth: authOpt, expose, ki: kiOpt, propstack: propstackOpt, graph: graphOpt, openaiKey, suche: sucheOpt, speicher: speicherOpt, oauthRueckweg = { online: false, erlaubteHosts: [] }, cronGeheimnis, pdf = { drucken: bankgespraechPdf, schleuse: erzeugeSchleuse(SCHLEUSE_STANDARD) } }: AppKontext) {
  const exposeKontext = () => {
    if (!expose) throw new FachFehler(422, 'Dateiablage ist nicht eingerichtet (SUPABASE_SERVICE_ROLE_KEY).');
    return expose;
  };
  const ablage = () => {
    const s = speicherOpt ?? expose?.speicher;
    if (!s) throw new FachFehler(422, 'Dateiablage ist nicht eingerichtet (SUPABASE_SERVICE_ROLE_KEY).');
    return s;
  };
  const app = new OpenAPIHono({
    defaultHook: (ergebnis, c) => {
      if (!ergebnis.success) {
        // Die Feldpfade auch ins Protokoll: eine abgewiesene Eingabe, die nirgends steht,
        // ist im Betrieb nicht nachvollziehbar („Eingabe ungültig" allein sagt niemandem etwas).
        const felder = ergebnis.error.issues.map((i) => `${i.path.join('.') || '(Rumpf)'}: ${i.message}`);
        console.error(`[400] ${c.req.method} ${c.req.path} — ${felder.join(' · ')}`);
        return c.json({ fehler: 'Eingabe ungültig', details: z.treeifyError(ergebnis.error), felder }, 400);
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof FachFehler) return c.json({ fehler: err.message, details: err.details }, err.status);
    console.error(err);
    return c.json({ fehler: 'Interner Fehler' }, 500);
  });

  app.get('/api/health', async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  // ── Cron (Vercel ruft per GET, ohne Nutzer-Token) — bewusst VOR der Anmeldeprüfung, dafür mit eigenem Geheimnis ──
  const cron = (pfad: string, lauf: () => Promise<object>) => app.get(pfad, async (c) => {
    if (!cronErlaubt(cronGeheimnis, c.req.header('authorization'))) return c.json({ fehler: 'Nicht erlaubt', details: { hint: 'CRON_SECRET im Vercel-Projekt setzen.' } }, 401);
    return c.json({ ok: true, ...(await lauf()) }, 200);
  });
  cron('/api/cron/sicherung', async () => geplanteSicherung(db, ablage()));
  cron('/api/cron/archiv', async () => {
    const speicher = ablage();
    // Erst aufräumen, dann spiegeln — der Eingang gehört ohnehin nicht ins Archiv
    const eingangEntfernt = await eingangAufraeumen(speicher);
    return { eingangEntfernt, spiegel: await archivSpiegeln(db, speicher) };
  });

  app.use('/api/*', auth(authOpt));

  // Begrenzung der teuren und der zugangsnahen Wege (alt: rate-limits.ts) — nach der Anmeldeprüfung, vor den Routen
  app.use('/api/makler/:id/ki/*', begrenzung(GRENZEN.ki));
  app.use('/api/persona/analyse', begrenzung(GRENZEN.ki));
  app.use('/api/expose/analyse', begrenzung(GRENZEN.ki));
  app.use('/api/deals/:id/einheiten-aus-pdf', begrenzung(GRENZEN.ki));
  app.use('/api/transkription', begrenzung(GRENZEN.diktat));
  app.use('/api/m365/posteingang', begrenzung(GRENZEN.abruf));
  app.use('/api/m365/konfiguration', begrenzung(GRENZEN.zugang));
  app.use('/api/m365/anmeldung', begrenzung(GRENZEN.zugang));
  app.use('/api/propstack/konfiguration', begrenzung(GRENZEN.zugang));

  // ── Makler ───────────────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/makler', responses: { 200: json(z.array(Makler), 'Makler') } }),
    async (c) => c.json(await maklerListe(db), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/makler',
      request: { body: { content: { 'application/json': { schema: MaklerAnlegen } } } },
      responses: { 201: json(Makler, 'angelegt'), 400: fehler('Eingabe ungültig') },
    }),
    async (c) => c.json(await maklerAnlegen(db, c.req.valid('json')), 201),
  );

  // ── Objekte ──────────────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/objekte', responses: { 200: json(z.array(Objekt), 'Objekte') } }),
    async (c) => c.json(await objekteListe(db), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/objekte',
      request: { body: { content: { 'application/json': { schema: ObjektAnlegen } } } },
      responses: { 201: json(Objekt, 'angelegt'), 400: fehler('Eingabe ungültig') },
    }),
    async (c) => c.json(await objektAnlegen(db, c.req.valid('json')), 201),
  );

  // ── Deals ────────────────────────────────────────────────
  app.openapi(
    createRoute({ method: 'patch', path: '/api/deals/{id}/objekt', request: { params: IdParam, ...body(z.object({ objektId: z.string().min(1), version: z.number().int() })) }, responses: { 200: json(z.object({ id: z.string(), version: z.number().int() }), 'Objekt gewechselt, Kalkulation vorbelegt'), ...konflikt, 422: fehler('Objekt fehlt') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await dealObjektWechseln(db, c.req.valid('param').id, b.objektId, b.version), 200); },
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/deals/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await dealLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals', responses: { 200: json(z.array(DealListenEintrag), 'Deals') } }),
    async (c) => c.json(await dealListe(db), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/deals',
      request: { body: { content: { 'application/json': { schema: DealAnlegen } } } },
      responses: {
        201: json(z.object({ id: z.string() }), 'angelegt'),
        400: fehler('Eingabe ungültig'),
        422: fehler('Objekt nicht gefunden'),
      },
    }),
    async (c) => c.json(await dealAnlegen(db, c.req.valid('json'), 'ui', heuteBerlin()), 201),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/deals/{id}/status',
      request: { params: IdParam, body: { content: { 'application/json': { schema: StatusWechsel } } } },
      responses: {
        200: json(z.object({ id: z.string(), status: DealStatus, version: z.number() }), 'geändert'),
        400: fehler('Eingabe ungültig'),
        404: fehler('Deal nicht gefunden'),
        409: fehler('Versionskonflikt'),
      },
    }),
    async (c) => c.json(await statusAendern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/deals/{id}/status-historie',
      request: { params: IdParam },
      responses: { 200: json(z.array(StatusHistorieEintrag), 'Status-Verlauf') },
    }),
    async (c) => c.json(await statusHistorie(db, c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}', request: { params: IdParam }, responses: { 200: json(DealDetail, 'Deal'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await dealDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'patch', path: '/api/deals/{id}', request: { params: IdParam, ...body(DealInfoAendern) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => c.json(await dealInfoAendern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/deals/{id}/kalkulation',
      request: { params: IdParam, ...body(KalkulationSpeichern) },
      responses: { 200: json(z.object({ id: z.string(), version: z.number().int(), kennzahlen: Kennzahlen }), 'gespeichert'), ...konflikt },
    }),
    async (c) => c.json(await kalkulationSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/kommentare', request: { params: IdParam, ...body(KommentarAnlegen) }, responses: { 201: json(DealKommentar, 'angelegt'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await kommentarAnlegen(db, c.req.valid('param').id, c.req.valid('json').text), 201),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/erledigt', request: { params: IdParam, ...body(Version) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => c.json(await dealErledigt(db, c.req.valid('param').id, c.req.valid('json').version, heuteBerlin()), 200),
  );

  // ── Makler-Detail ────────────────────────────────────────
  const ki = () => kiOpt ?? expose?.ki;
  /** Hinterlegte Schlüssel haben Vorrang vor der Umgebung (alt: Einstellungen → API-Schlüssel). */
  const kiMitSchluessel = async () => {
    if (kiOpt || expose?.ki) return ki();
    const key = await zugangLesen(db, 'anthropic-api-key');
    return key ? anthropicClient(key) : null;
  };
  const openaiSchluessel = async () => (await zugangLesen(db, 'openai-api-key')) || openaiKey || '';
  const heuteDe = () => new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  app.openapi(
    createRoute({ method: 'delete', path: '/api/makler/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await maklerLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/makler/{id}/persoenlich', request: { params: IdParam, ...body(MaklerPersoenlich) }, responses: { 200: json(z.object({ persoenlich: z.record(z.string(), z.unknown()) }), 'gespeichert'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await maklerPersoenlichSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  const kiFehler = { 404: fehler('Makler fehlt'), 422: fehler('KI nicht eingerichtet oder zu wenig Daten') };
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/zusammenfassung', request: { params: IdParam }, responses: { 200: json(z.object({ kiSummary: z.string().nullable(), kiSummaryAt: z.string().nullable() }), 'Zusammenfassung'), ...kiFehler } }),
    async (c) => c.json(await zusammenfassungErstellen(db, await kiMitSchluessel(), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/erwaehnungen', request: { params: IdParam, ...body(z.object({ text: z.string().max(5000), kanal: z.string().max(40) })) }, responses: { 200: json(z.object({ neu: z.number() }), 'Erwähnungen ergänzt'), ...kiFehler } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await erwaehnungenErgaenzen(db, await kiMitSchluessel(), c.req.valid('param').id, b.text, b.kanal, heuteDe()), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/beziehungsprofil', request: { params: IdParam }, responses: { 200: json(z.object({ beziehungsNotiz: z.string() }), 'Beziehungsprofil'), ...kiFehler } }),
    async (c) => c.json(await beziehungsprofilErstellen(db, await kiMitSchluessel(), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/persoenliches', request: { params: IdParam }, responses: { 200: json(z.object({ persoenlich: z.record(z.string(), z.unknown()) }), 'Persönliches ergänzt'), ...kiFehler } }),
    async (c) => c.json(await persoenlichesErgaenzen(db, await kiMitSchluessel(), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/entwurf', request: { params: IdParam }, responses: { 200: json(NachrichtEntwurf, 'Entwurf WhatsApp + E-Mail'), ...kiFehler } }),
    async (c) => c.json(await entwurfErstellen(db, await kiMitSchluessel(), c.req.valid('param').id), 200),
  );
  const suche = (): Suchdienste => sucheOpt ?? (expose?.attrappe ? { web: async () => [], news: async () => [] } : { web: webSuche, news: nachrichtenSuche });
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/anlaesse', request: { params: IdParam }, responses: { 200: json(z.object({ anlaesse: z.array(z.object({ emoji: z.string(), text: z.string(), priority: z.string(), quelleUrl: z.string().optional() })) }), 'Kontakt-Anlässe'), ...kiFehler } }),
    async (c) => c.json(await kontaktAnlaesseErmitteln(db, await kiMitSchluessel(), suche(), c.req.valid('param').id, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/ki/gespraechsoeffner', request: { params: IdParam }, responses: { 200: json(z.object({ text: z.string() }), 'Gesprächsöffner'), ...kiFehler } }),
    async (c) => c.json(await gespraechsoeffnerErstellen(db, await kiMitSchluessel(), c.req.valid('param').id, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/osint', request: { params: IdParam }, responses: { 200: json(z.object({ persoenlich: z.record(z.string(), z.unknown()) }), 'OSINT-Ergebnis gespeichert'), 404: fehler('Makler fehlt') } }),
    async (c) => c.json(await osintAusfuehren(db, suche(), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/persona', responses: { 200: json(PersonaStand, 'Kommunikationsstil und Konfidenz') } }),
    async (c) => c.json(await personaStand(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/persona/analyse', responses: { 200: json(PersonaStand, 'analysiert'), 422: fehler('zu wenig Daten oder KI fehlt') } }),
    async (c) => c.json(await personaAnalysieren(db, await kiMitSchluessel()), 200),
  );
  app.post('/api/transkription', async (c) => {
    const form = await c.req.parseBody();
    const f = form['audio'];
    if (!f || typeof f === 'string') throw new FachFehler(400, 'Keine Audio-Datei');
    return c.json(await transkription(db, await openaiSchluessel(), new Uint8Array(await f.arrayBuffer()), f.type), 200);
  });
  app.openapi(
    createRoute({ method: 'get', path: '/api/makler/{id}', request: { params: IdParam }, responses: { 200: json(MaklerDetail, 'Makler'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await maklerDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'patch', path: '/api/makler/{id}', request: { params: IdParam, ...body(MaklerAendern) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => c.json(await maklerAendern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/kommunikation', request: { params: IdParam, ...body(KommunikationAnlegen) }, responses: { 201: json(MaklerKommunikation, 'angelegt'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await kommunikationAnlegen(db, c.req.valid('param').id, c.req.valid('json'), heuteBerlin()), 201),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/erledigt', request: { params: IdParam, ...body(Version) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => c.json(await maklerErledigt(db, c.req.valid('param').id, c.req.valid('json').version, heuteBerlin()), 200),
  );

  // ── Objekt-Detail ────────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/objekte/{id}', request: { params: IdParam }, responses: { 200: json(ObjektDetail, 'Objekt'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await objektDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'patch', path: '/api/objekte/{id}', request: { params: IdParam, ...body(ObjektAendern) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => c.json(await objektAendern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/objekte/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'in den Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await objektLoeschen(db, c.req.valid('param').id), 200),
  );

  // ── Ankauf-Cockpit ───────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/ankauf', responses: { 200: json(AnkaufCockpit, 'Cockpit') } }),
    async (c) => c.json(await ankaufCockpit(db, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/ankauf/einplanen', responses: { 200: json(z.object({ eingeplant: z.number().int() }), 'eingeplant') } }),
    async (c) => c.json(await terminloseEinplanen(db, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/ankauf/waehlmaschine', responses: { 200: json(z.array(CockpitMakler), 'Warteschlange') } }),
    async (c) => c.json(await waehlmaschine(db, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/anruf-ergebnis', request: { params: IdParam, ...body(AnrufErgebnisSpeichern) }, responses: { 200: json(z.object({ id: z.string(), version: z.number().int(), nextContact: z.string().nullable() }), 'gespeichert'), ...konflikt } }),
    async (c) => c.json(await anrufErgebnis(db, c.req.valid('param').id, c.req.valid('json'), heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/briefing-abschluss', request: { params: IdParam, ...body(TerminSetzen) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await briefingAbschliessen(db, c.req.valid('param').id, b.version, b.nextContact, heuteBerlin()), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/makler/{id}/whatsapp', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'protokolliert'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await whatsappProtokollieren(db, c.req.valid('param').id, heuteBerlin()), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/deals/{id}/termin', request: { params: IdParam, ...body(TerminSetzen) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await terminSetzen(db, 'deals', c.req.valid('param').id, b.version, b.nextContact), 200); },
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/makler/{id}/termin', request: { params: IdParam, ...body(TerminSetzen) }, responses: { 200: Geaendert, ...konflikt } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await terminSetzen(db, 'makler', c.req.valid('param').id, b.version, b.nextContact), 200); },
  );

  // ── Kundenkalkulation ────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/kundenkalkulationen', responses: { 200: json(z.array(KundenkalkulationEintrag), 'alle') } }),
    async (c) => c.json(await kundenkalkulationenListe(db), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/kundenkalkulationen', request: { params: IdParam }, responses: { 200: json(z.array(KundenkalkulationEintrag), 'zum Deal') } }),
    async (c) => c.json(await kundenkalkulationenListe(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/kundenkalkulationen', request: { params: IdParam, ...body(KundenkalkulationAnlegen) }, responses: { 201: json(Kundenkalkulation, 'angelegt'), 404: fehler('nicht gefunden'), 422: fehler('Einheit ungültig') } }),
    async (c) => c.json(await kundenkalkulationAnlegen(db, c.req.valid('param').id, c.req.valid('json'), heuteBerlin()), 201),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/kundenkalkulationen/{id}', request: { params: IdParam }, responses: { 200: json(Kundenkalkulation, 'Kalkulation'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await kundenkalkulationDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/kundenkalkulationen/{id}', request: { params: IdParam, ...body(KundenkalkulationSpeichern) }, responses: { 200: json(Kundenkalkulation, 'gespeichert'), ...konflikt } }),
    async (c) => c.json(await kundenkalkulationSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/kundenkalkulationen/{id}/duplizieren', request: { params: IdParam }, responses: { 201: json(Kundenkalkulation, 'Kopie'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await kundenkalkulationDuplizieren(db, c.req.valid('param').id), 201),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/kundenkalkulationen/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await kundenkalkulationLoeschen(db, c.req.valid('param').id), 200),
  );
  // Bankgespräch-PDF aus der gespeicherten Kalkulation (Vorschau im Web nutzt dieselbe Vorlage)
  app.get('/api/kundenkalkulationen/:id/pdf', renderTor(pdf.schleuse), async (c) => {
    const id = c.req.param('id');
    const payload = await bankgespraechDaten(db, id, new Date());
    let datei: Uint8Array;
    try {
      datei = await pdf.drucken(payload, fotoPort(db, speicherOpt ?? expose?.speicher));
    } catch (e) {
      if (e instanceof KeinBrowserError) throw new FachFehler(503, e.message);
      throw e;
    }
    await pdfExportProtokollieren(db, id, payload);
    return alsStrom(datei, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfDateiname(payload.kalkName)}"`,
      'Cache-Control': 'no-store',
    });
  });
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/vorlagen', responses: { 200: json(VorlagenEinstellungen, 'Textvorlagen und Mein Name') } }),
    async (c) => c.json(await vorlagenLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/vorlagen', request: body(VorlagenEinstellungen), responses: { 200: json(VorlagenEinstellungen, 'gespeichert'), 400: fehler('ungültig') } }),
    async (c) => c.json(await vorlagenSpeichern(db, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/kundenkalkulation', responses: { 200: json(KundenkalkEinstellungen, 'Einstellungen') } }),
    async (c) => c.json(await kundenkalkEinstellungenLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/kundenkalkulation', request: body(KundenkalkEinstellungen), responses: { 200: json(KundenkalkEinstellungen, 'gespeichert'), 400: fehler('Eingabe ungültig') } }),
    async (c) => c.json(await kundenkalkEinstellungenSpeichern(db, c.req.valid('json')), 200),
  );

  // ── Vertriebslisten ──────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/vertriebslisten', responses: { 200: json(z.array(VertriebslistenEintrag), 'angekaufte Deals mit Liste') } }),
    async (c) => c.json(await vertriebslistenUebersicht(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/vertriebsliste', request: { params: IdParam }, responses: { 201: json(Vertriebsliste, 'angelegt'), 404: fehler('Deal fehlt'), 409: fehler('bereits vorhanden'), 422: fehler('nicht angekauft') } }),
    async (c) => c.json(await vertriebslisteAnlegen(db, c.req.valid('param').id), 201),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/vertriebslisten/{id}', request: { params: IdParam }, responses: { 200: json(Vertriebsliste, 'Liste'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await vertriebslisteDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/vertriebslisten/{id}', request: { params: IdParam, ...body(VertriebslisteSpeichern) }, responses: { 200: json(Vertriebsliste, 'gespeichert'), ...konflikt } }),
    async (c) => c.json(await vertriebslisteSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/vertriebslisten/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await vertriebslisteLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/vertriebslisten', responses: { 200: json(VertriebslistenEinstellungen, 'Spalten und Provision') } }),
    async (c) => c.json(await vlEinstellungenLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/vertriebslisten', request: body(VertriebslistenEinstellungen), responses: { 200: json(VertriebslistenEinstellungen, 'gespeichert'), 400: fehler('ungültig') } }),
    async (c) => c.json(await vlEinstellungenSpeichern(db, c.req.valid('json')), 200),
  );

  // ── Deal-Dokumente (alt: /api/docs/:dealId) ─────────────
  const DokParam = z.object({ id: z.string().min(1), dokId: z.string().min(1) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/dokumente', request: { params: IdParam }, responses: { 200: json(z.array(DealDokument), 'Dokumente, neueste zuerst'), 404: fehler('Deal fehlt') } }),
    async (c) => c.json(await dokumenteListe(db, c.req.valid('param').id), 200),
  );
  // Mehrteilige Formulardaten (Feld „dateien“, bis 20 Dateien); Prüfung der Signatur im Service
  app.post('/api/deals/:id/dokumente', async (c) => {
    const form = await c.req.parseBody({ all: true });
    const roh = form['dateien'];
    const dateien = await Promise.all((Array.isArray(roh) ? roh : roh ? [roh] : []).filter((f): f is File => typeof f !== 'string')
      .map(async (f) => ({ name: f.name, typ: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    return c.json(await dokumenteHochladen(db, ablage(), c.req.param('id'), dateien), 201);
  });
  app.get('/api/deals/:id/dokumente/:dokId/datei', async (c) => {
    const d = await dokumentDatei(db, ablage(), c.req.param('id'), c.req.param('dokId'));
    return alsStrom(d.bytes, { 'Content-Type': d.mime, 'Content-Disposition': d.disposition, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  });
  app.openapi(
    createRoute({ method: 'patch', path: '/api/deals/{id}/dokumente/{dokId}', request: { params: DokParam, ...body(z.object({ label: z.string().max(500) })) }, responses: { 200: json(z.object({ ok: z.literal(true) }), 'Bezeichnung gespeichert'), 404: fehler('nicht gefunden') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await dokumentBezeichnen(db, p.id, p.dokId, c.req.valid('json').label), 200); },
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/deals/{id}/dokumente/{dokId}', request: { params: DokParam }, responses: { 200: json(z.object({ ok: z.literal(true) }), 'gelöscht'), 404: fehler('nicht gefunden') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await dokumentLoeschen(db, ablage(), p.id, p.dokId), 200); },
  );

  // Einheiten aus Mieterliste-PDF (alt POST /api/deals/:dealId/extract-units, Feld „file“)
  app.post('/api/deals/:id/einheiten-aus-pdf', async (c) => {
    const form = await c.req.parseBody();
    const f = form['file'];
    const datei = f && typeof f !== 'string' ? { name: f.name, typ: f.type, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    return c.json(await einheitenAusMieterliste(db, ablage(), await kiMitSchluessel(), c.req.param('id'), datei), 200);
  });

  // ── Kalkulationsvarianten (alt d.kalkVarianten) ─────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/varianten', request: { params: IdParam }, responses: { 200: json(z.array(KalkVariante), 'Varianten, neueste zuerst'), 404: fehler('Deal fehlt') } }),
    async (c) => c.json(await variantenListe(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/varianten', request: { params: IdParam, ...body(KalkVarianteAnlegen) }, responses: { 201: json(z.object({ variante: KalkVariante, anzahl: z.number() }), 'gespeichert'), 404: fehler('Deal fehlt') } }),
    async (c) => c.json(await varianteAnlegen(db, c.req.valid('param').id, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/deals/{id}/varianten/{varianteId}', request: { params: z.object({ id: z.string().min(1), varianteId: z.string().min(1) }) }, responses: { 200: json(z.object({ ok: z.literal(true) }), 'gelöscht'), 404: fehler('nicht gefunden') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await varianteLoeschen(db, p.id, p.varianteId), 200); },
  );

  // ── MCP-Server (alt: server/mcp.ts) ─────────────────────
  // Nur Kopfzeilen, kein Cookie: ein Browser schickt Cookies bei jedem fremden POST mit.
  app.post('/api/mcp', async (c) => {
    const anmeldung = mcpAnmelden(mcpSchluesselAusKopfOderNull(c.req.header()), process.env);
    if (!anmeldung.ok) {
      if (anmeldung.detail) console.warn('[mcp] Anmeldung abgelehnt:', anmeldung.detail);
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: anmeldung.message } }, anmeldung.status as 401 | 500);
    }
    const rumpf: unknown = await c.req.json().catch(() => null);
    if (rumpf === null) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Der Rumpf ist kein gültiges JSON.' } }, 400);
    const antwort = await mcpVerarbeiten(db, rumpf, anmeldung.sitzung);
    return antwort ? c.json(antwort, 200) : c.body(null, 204);
  });
  app.openapi(
    createRoute({ method: 'get', path: '/api/mcp', responses: { 200: json(z.object({ lokal: z.boolean(), schluessel: z.array(z.object({ label: z.string(), scopes: z.array(z.string()) })), verworfen: z.array(z.string()), werkzeuge: z.array(z.object({ name: z.string(), scope: z.string(), title: z.string(), description: z.string() })) }), 'Werkzeuge und Schlüssel') } }),
    (c) => c.json(mcpStand(process.env), 200),
  );

  // ── Microsoft 365: Zugang und Posteingang (alt: /api/oauth/*, /api/offers) ──
  app.openapi(
    createRoute({ method: 'get', path: '/api/m365', responses: { 200: json(M365Stand, 'Zugang und Verbindung') } }),
    async (c) => c.json(await m365Stand(db, graphOpt), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/m365/konfiguration', request: body(z.object({ clientId: z.string().max(200), tenantId: z.string().max(200), clientSecret: z.string().max(500).optional() })), responses: { 200: json(z.object({ ok: z.literal(true) }), 'gespeichert') } }),
    async (c) => c.json(await m365KonfigurationSpeichern(db, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/m365/ordner', request: body(z.object({ ordner: z.string().max(200) })), responses: { 200: json(z.object({ ordner: z.string() }), 'gespeichert') } }),
    async (c) => c.json(await m365OrdnerSpeichern(db, c.req.valid('json').ordner), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/m365/anmeldung', request: body(z.object({ redirectUri: z.string().url() })), responses: { 200: json(z.object({ url: z.string() }), 'Anmeldeadresse'), 400: fehler('Rücksprung-Adresse nicht freigegeben'), 422: fehler('nicht eingerichtet') } }),
    async (c) => {
      // Die Adresse kommt vom Client — nur freigegebene Hosts dürfen in einen Anmeldeversuch geraten
      const rueckweg = rueckwegPruefen(c.req.valid('json').redirectUri, oauthRueckweg);
      if (!rueckweg.ok) throw new FachFehler(400, rueckweg.grund);
      return c.json(await m365AnmeldungStarten(db, rueckweg.uri), 200);
    },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/m365/rueckweg', request: body(z.object({ code: z.string().min(1), state: z.string().min(1) })), responses: { 200: json(z.object({ email: z.string() }), 'verbunden'), 400: fehler('Anmeldeversuch unbekannt'), 422: fehler('nicht eingerichtet') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await m365Rueckweg(db, b.code, b.state), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/m365/trennen', responses: { 200: json(z.object({ ok: z.literal(true) }), 'getrennt') } }),
    async (c) => c.json(await m365Trennen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/m365/posteingang', request: { query: z.object({ alle: z.coerce.boolean().optional() }) }, responses: { 200: json(M365Posteingang, 'Angebote im Posteingang'), 422: fehler('nicht verbunden') } }),
    async (c) => c.json(await m365Posteingang(db, graphOpt, !c.req.valid('query').alle), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/m365/mails/{uid}/sperren', request: { params: z.object({ uid: z.string().min(1) }) }, responses: { 200: json(z.object({ uid: z.string(), gesperrt: z.literal(true) }), 'gesperrt') } }),
    async (c) => c.json(await m365Sperren(db, c.req.valid('param').uid), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/m365/mails/{uid}/sperren', request: { params: z.object({ uid: z.string().min(1) }) }, responses: { 200: json(z.object({ uid: z.string(), gesperrt: z.literal(false) }), 'Sperre aufgehoben') } }),
    async (c) => c.json(await m365Entsperren(db, c.req.valid('param').uid), 200),
  );
  // Anhang → Exposé-Eingang: dieselbe Strecke wie ein Datei-Upload, nur aus der Mail
  app.post('/api/m365/mails/:uid/anhaenge/:anhangId/uebernehmen', async (c) => {
    const bytes = await m365Anhang(db, graphOpt, c.req.param('uid'), c.req.param('anhangId'));
    const eingang = await exposeEingang(exposeKontext(), bytes);
    await m365Sperren(db, c.req.param('uid'));
    return c.json(eingang, 200);
  });

  // ── Propstack: Bewertung je Einheit (alt: /api/crm/propstack/units) ──
  const EinheitParam = z.object({ id: z.string().min(1), einheitId: z.string().min(1) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/einheiten/{einheitId}/propstack', request: { params: EinheitParam }, responses: { 200: json(PropstackBewertung, 'Vorbelegung der Bewertung'), 404: fehler('nicht gefunden'), 422: fehler('Stellplatz') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await propstackVorbelegen(db, p.id, p.einheitId), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/einheiten/{einheitId}/propstack', request: { params: EinheitParam, ...body(BewertungsDaten) }, responses: { 200: json(z.object({ unitId: z.string().nullable(), url: z.string().nullable(), daten: z.unknown() }), 'angelegt'), 403: fehler('vom Gate blockiert'), 422: fehler('nicht möglich'), 503: fehler('Propstack antwortet nicht') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await propstackAnlegen(db, propstackOpt, p.id, p.einheitId, c.req.valid('json')), 200); },
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/einheiten/{einheitId}/propstack/bewertung', request: { params: EinheitParam }, responses: { 200: json(z.object({ unitId: z.string(), url: z.string().nullable(), daten: z.unknown() }), 'Bewertung'), 422: fehler('noch nicht angelegt'), 503: fehler('Propstack antwortet nicht') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await propstackLesen(db, propstackOpt, p.id, p.einheitId), 200); },
  );

  // ── Aktionen nach außen: Gate und Freigaben (alt: /api/outward-gate, /api/mcp-approvals) ──
  app.openapi(
    createRoute({ method: 'get', path: '/api/outward-gate', responses: { 200: json(OutwardStand, 'Schalter, Umgebung, Proben, offene Freigaben') } }),
    async (c) => c.json(await outwardStand(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/outward-gate', request: body(z.object({ allowAgbSubmit: z.boolean().optional(), allowPropstackWrite: z.boolean().optional(), extraAgbHosts: z.array(z.string().max(200)).max(50).optional() })), responses: { 200: json(z.object({ allowAgbSubmit: z.boolean(), allowPropstackWrite: z.boolean(), extraAgbHosts: z.array(z.string()) }), 'gespeichert') } }),
    async (c) => c.json(await gateSpeichern(db, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/outward-gate/freigaben', request: body(z.object({ action: z.string().min(1), url: z.string().url(), grund: z.string().min(1).max(2000), bezug: z.string().max(200).optional(), beantragtVon: z.string().max(100).optional() })), responses: { 200: json(OutwardFreigabe, 'Antrag angelegt') } }),
    async (c) => c.json(await freigabeBeantragen(db, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/outward-gate/freigaben/{id}', request: { params: IdParam, ...body(z.object({ entscheidung: z.enum(['erlaubt', 'abgelehnt']) })) }, responses: { 200: json(z.object({ id: z.string(), entscheidung: z.string() }), 'entschieden'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await freigabeEntscheiden(db, c.req.valid('param').id, c.req.valid('json').entscheidung), 200),
  );

  // ── Makler aus Tabelle importieren (alt: /api/import/makler-xlsx) ──
  const tabellenDatei = async (c: { req: { parseBody: () => Promise<Record<string, unknown>> } }) => {
    const form = await c.req.parseBody();
    const f = form['file'];
    return f && typeof f !== 'string' ? { name: (f as File).name, bytes: new Uint8Array(await (f as File).arrayBuffer()), zuordnung: form['zuordnung'] } : null;
  };
  app.post('/api/import/makler-tabelle/vorschau', async (c) => {
    const datei = await tabellenDatei(c);
    return c.json(maklerImportVorschau(datei), 200);
  });
  app.post('/api/import/makler-tabelle', async (c) => {
    const datei = await tabellenDatei(c);
    const zuordnung = typeof datei?.zuordnung === 'string' ? (JSON.parse(datei.zuordnung) as Record<string, number>) : undefined;
    return c.json(await maklerImportUebernehmen(db, datei, zuordnung), 200);
  });

  // ── Sicherung (alt: Einstellungen → Sicherung & Datenimport) ──
  app.get('/api/sicherung/export', async (c) => {
    const e = await sicherungExport(db);
    return alsStrom(e.inhalt, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${e.name}"` });
  });
  app.openapi(
    createRoute({ method: 'get', path: '/api/sicherung', responses: { 200: json(z.object({ zeilen: z.array(z.object({ tabelle: z.string(), anzahl: z.number() })), gesamt: z.number(), ausgenommen: z.record(z.string(), z.string()) }), 'Umfang der Sicherung') } }),
    async (c) => c.json(await sicherungUmfang(db), 200),
  );
  // Automatische Sicherungen im Bucket `backups` (alt: „📦 Auto-Backups verwalten")
  const SicherungsEintragSchema = z.object({ key: z.string(), stufe: z.enum(['daily', 'weekly', 'monthly', 'safety']), ts: z.string(), groesseBytes: z.number(), zahlen: z.object({ deals: z.number(), objekte: z.number(), makler: z.number(), zeilen: z.number() }) });
  const SicherungsKey = z.object({ key: z.string().max(200) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/sicherung/auto', responses: { 200: json(z.object({ eintraege: z.array(SicherungsEintragSchema), aufbewahrung: z.record(z.string(), z.number()) }), 'Sicherungen, jüngste zuerst'), 422: fehler('Dateiablage nicht eingerichtet') } }),
    async (c) => c.json({ eintraege: await autoSicherungListe(ablage()), aufbewahrung: { ...AUFBEWAHRUNG } }, 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/sicherung/auto', responses: { 201: json(z.object({ eintrag: SicherungsEintragSchema, aufbewahrung: z.object({ entfernt: z.array(z.string()), behalten: z.number(), hinweis: z.string().nullable() }) }), 'angelegt') } }),
    async (c) => c.json(await autoSicherungErstellen(db, ablage(), geplanteStufe(new Date()), '/api/sicherung/auto'), 201),
  );
  app.get('/api/sicherung/auto/datei', async (c) => {
    const key = c.req.query('key') ?? '';
    return alsStrom(await autoSicherungDatei(ablage(), key), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${key.replace(/[^a-zA-Z0-9._-]/g, '_')}"` });
  });
  app.openapi(
    createRoute({ method: 'post', path: '/api/sicherung/auto/plan', request: body(SicherungsKey), responses: { 200: json(z.any(), 'was das Einspielen ändern würde'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await autoSicherungPlan(db, ablage(), c.req.valid('json').key), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/sicherung/auto/einspielen', request: body(SicherungsKey.extend({ bestaetigt: z.literal(true) })), responses: { 200: json(z.object({ geschrieben: z.number(), sicherheitskopie: z.string() }), 'eingespielt'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await autoSicherungEinspielen(db, ablage(), c.req.valid('json').key), 200),
  );
  app.post('/api/sicherung/plan', async (c) => c.json(await sicherungPlan(db, await c.req.json()), 200));
  app.post('/api/sicherung/einspielen', async (c) => c.json(await sicherungEinspielen(db, await c.req.json()), 200));

  // ── Zugänge: API-Schlüssel verschlüsselt hinterlegen ────
  app.openapi(
    createRoute({ method: 'get', path: '/api/zugaenge', responses: { 200: json(z.array(ZugangStatus), 'Zugänge mit Quelle und Maske') } }),
    async (c) => c.json(await zugangStatus(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/zugaenge/{schluessel}', request: { params: z.object({ schluessel: z.string().min(1) }), ...body(z.object({ wert: z.string().max(500) })) }, responses: { 200: json(z.object({ schluessel: z.string(), gesetzt: z.boolean() }), 'gespeichert'), 400: fehler('unbekannter Zugang') } }),
    async (c) => c.json(await zugangSpeichern(db, c.req.valid('param').schluessel, c.req.valid('json').wert), 200),
  );

  // ── Werkzeuge: Nachfass-Reset und KI-Kosten ─────────────
  const Datum = z.object({ datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/werkzeuge/nachfass-reset', request: { query: Datum }, responses: { 200: json(NachfassResetSicht, 'betroffene Deals und Makler') } }),
    async (c) => c.json(await nachfassResetVorschau(db, c.req.valid('query').datum), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/werkzeuge/nachfass-reset', request: body(Datum), responses: { 200: json(z.object({ deals: z.number(), makler: z.number() }), 'zurückgesetzt') } }),
    async (c) => c.json(await nachfassResetAusfuehren(db, c.req.valid('json').datum), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/werkzeuge/ki-kosten', request: { query: z.object({ tage: z.coerce.number().int().min(1).max(3650).default(30) }) }, responses: { 200: json(KiKosten, 'Kosten je Modell und Funktion') } }),
    async (c) => c.json(await kiKosten(db, c.req.valid('query').tage), 200),
  );

  // ── Audit-Log (alt: Einstellungen → Audit-Log) ──────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/audit', request: { query: AuditFilter }, responses: { 200: json(AuditSeite, 'Einträge, neueste zuerst') } }),
    async (c) => c.json(await auditListe(db, c.req.valid('query')), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/audit/pruefen', responses: { 200: json(AuditBefund, 'Befund der Hash-Kette') } }),
    async (c) => c.json(await auditPruefen(db), 200),
  );
  // Zwei feste Pfade wie alt (/api/audit/export.json und .csv)
  for (const format of ['json', 'csv'] as const) {
    app.get(`/api/audit/export.${format}`, async (c) => {
      const e = await auditExport(db, format);
      return alsStrom(e.inhalt, { 'Content-Type': e.mime, 'Content-Disposition': `attachment; filename="${e.name}"` });
    });
  }
  app.openapi(
    createRoute({ method: 'delete', path: '/api/audit/aelter-als/{tage}', request: { params: z.object({ tage: z.coerce.number().int().min(1).max(3650) }) }, responses: { 200: json(z.object({ entfernt: z.number() }), 'aufgeräumt, Anker gesetzt') } }),
    async (c) => c.json(await auditAufraeumen(db, c.req.valid('param').tage), 200),
  );

  // ── Dubletten (alt: Einstellungen → Dublettenprüfung) ───
  app.openapi(
    createRoute({ method: 'get', path: '/api/dubletten', responses: { 200: json(z.array(DublettenPaarSicht), 'gefundene Paare, exakte zuerst') } }),
    async (c) => c.json(await dublettenScan(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/dubletten/ignorieren', request: body(z.object({ id1: z.string().min(1), id2: z.string().min(1) })), responses: { 200: json(z.object({ ignoriert: z.number() }), 'Paar wird nicht mehr gemeldet') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await dublettenIgnorieren(db, b.id1, b.id2), 200); },
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/dubletten/ignorieren', responses: { 200: json(z.object({ ignoriert: z.number() }), 'Ignorierliste geleert') } }),
    async (c) => c.json(await dublettenIgnoriertLeeren(db), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/dubletten/vorschau', request: { query: z.object({ typ: z.enum(['makler', 'objekt', 'deal']), primaerId: z.string().min(1), sekundaerId: z.string().min(1) }) }, responses: { 200: json(MergeVorschau, 'Unterschiede'), 404: fehler('nicht gefunden') } }),
    async (c) => { const q = c.req.valid('query'); return c.json(await dublettenVorschau(db, q.typ, q.primaerId, q.sekundaerId), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/dubletten/zusammenfuehren', request: body(MergeAusfuehren), responses: { 200: json(z.object({ protokollId: z.string(), betroffeneDealIds: z.array(z.string()), betroffeneDateien: z.number() }), 'zusammengeführt'), 400: fehler('ungültig'), 404: fehler('nicht gefunden') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await dublettenZusammenfuehren(db, b.typ, b.primaerId, b.sekundaerId, { felder: b.felder, listen: b.listen }), 200); },
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/dubletten/protokoll', responses: { 200: json(z.array(MergeProtokollEintrag), 'letzte Zusammenführungen') } }),
    async (c) => c.json(await dublettenProtokoll(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/dubletten/protokoll/{id}/rueckgaengig', request: { params: IdParam, ...body(z.object({ erzwingen: z.boolean().default(false) })) }, responses: { 200: json(z.object({ ok: z.literal(true) }), 'zurückgenommen'), 404: fehler('nicht gefunden'), 409: fehler('abgelaufen oder inzwischen bearbeitet') } }),
    async (c) => c.json(await dublettenRueckgaengig(db, c.req.valid('param').id, c.req.valid('json').erzwingen), 200),
  );

  // ── Papierkorb (alt: Einstellungen → 🗑 Papierkorb) ──────
  const PapierkorbParam = z.object({ bereich: z.string().min(1), id: z.string().min(1) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/papierkorb', responses: { 200: json(z.array(PapierkorbEintrag), 'Gelöschtes, abgelaufene Einträge sind entfernt') } }),
    async (c) => c.json(await papierkorbListe(db, speicherOpt ?? expose?.speicher), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/papierkorb/{bereich}/{id}/wiederherstellen', request: { params: PapierkorbParam }, responses: { 200: json(z.object({ bereich: z.string(), id: z.string() }), 'wiederhergestellt'), 400: fehler('unbekannter Bereich'), 404: fehler('nicht im Papierkorb') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await papierkorbWiederherstellen(db, p.bereich, p.id), 200); },
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/papierkorb/{bereich}/{id}', request: { params: PapierkorbParam }, responses: { 200: json(z.object({ bereich: z.string(), id: z.string() }), 'endgültig entfernt'), 400: fehler('unbekannter Bereich'), 404: fehler('nicht im Papierkorb') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await papierkorbEndgueltig(db, speicherOpt ?? expose?.speicher, p.bereich, p.id), 200); },
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/papierkorb', responses: { 200: json(z.object({ entfernt: z.number() }), 'geleert') } }),
    async (c) => c.json(await papierkorbLeeren(db, speicherOpt ?? expose?.speicher), 200),
  );

  // ── Listen und gespeicherte Filter ──────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/listen', responses: { 200: json(ListenAltformat, 'Makler, Objekte, Deals im Altformat') } }),
    async (c) => c.json(await listenAltformat(db), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/filter', responses: { 200: json(z.array(GespeicherterFilter), 'alle gespeicherten Filter') } }),
    async (c) => c.json(await filterListe(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/filter', request: body(GespeicherterFilterAnlegen), responses: { 201: json(GespeicherterFilter, 'gespeichert'), 400: fehler('Eingabe ungültig') } }),
    async (c) => c.json(await filterAnlegen(db, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/filter/{id}', request: { params: IdParam, ...body(GespeicherterFilterUmbenennen) }, responses: { 200: json(GespeicherterFilter, 'umbenannt'), 400: fehler('Eingabe ungültig'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await filterUmbenennen(db, c.req.valid('param').id, c.req.valid('json').name), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/filter/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'gelöscht'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await filterLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/filter/vorlagen/{modul}', request: { params: z.object({ modul: FilterModul }) }, responses: { 200: json(z.array(GespeicherterFilter), 'Vorlagen eingerichtet, alle Filter') } }),
    async (c) => c.json(await filterVorlagenEinrichten(db, c.req.valid('param').modul), 200),
  );

  // ── Projektmanagement ────────────────────────────────────
  app.openapi(
    createRoute({ method: 'get', path: '/api/projekte', responses: { 200: json(z.array(Projekt), 'aktive Projekte, neuestes zuerst') } }),
    async (c) => c.json(await projekteListe(db), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/projekte/deal-auswahl', responses: { 200: json(z.array(ProjektDealAuswahl), 'angekaufte Deals ohne aktives Projekt') } }),
    async (c) => c.json(await projektDealAuswahl(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/projekte', request: body(ProjektAnlegen), responses: { 201: json(Projekt, 'angelegt'), 400: fehler('Eingabe ungültig'), 422: fehler('Adresse fehlt oder Deal nicht wählbar') } }),
    async (c) => c.json(await projektAnlegen(db, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/projekte/{id}', request: { params: IdParam }, responses: { 200: json(Projekt, 'Projekt'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await projektDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/projekte/{id}', request: { params: IdParam, ...body(ProjektSpeichern) }, responses: { 200: json(Projekt, 'gespeichert'), ...konflikt } }),
    async (c) => c.json(await projektSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/projekte/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await projektLoeschen(db, c.req.valid('param').id), 200),
  );

  // ── Begleitscheine ───────────────────────────────────────
  const TypParam = z.object({ typ: BsTyp });
  app.openapi(
    createRoute({ method: 'get', path: '/api/begleitscheine', responses: { 200: json(z.array(BegleitscheinEintrag), 'alle aktiven und archivierten') } }),
    async (c) => c.json(await begleitscheineListe(db), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/begleitscheine', request: body(BegleitscheinAnlegen), responses: { 201: json(Begleitschein, 'angelegt'), 400: fehler('ungültig'), 404: fehler('Objekt fehlt') } }),
    async (c) => c.json(await begleitscheinAnlegen(db, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/begleitscheine/{id}', request: { params: IdParam }, responses: { 200: json(Begleitschein, 'Begleitschein'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await begleitscheinDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/begleitscheine/{id}', request: { params: IdParam, ...body(BegleitscheinSpeichern) }, responses: { 200: json(Begleitschein, 'gespeichert'), ...konflikt } }),
    async (c) => c.json(await begleitscheinSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/begleitscheine/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await begleitscheinLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/begleitscheine/{id}/aktionen/{aktionId}', request: { params: z.object({ id: z.string().min(1), aktionId: z.string().min(1) }) }, responses: { 200: json(BsAktionErgebnis, 'was die Oberfläche tun soll'), 404: fehler('nicht gefunden') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await begleitscheinAktion(db, p.id, p.aktionId), 200); },
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/begleitscheine/{typ}/vorlage', request: { params: TypParam }, responses: { 200: json(BsVorlage, 'Vorlage') } }),
    async (c) => c.json(await bsVorlageLesen(db, c.req.valid('param').typ), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/begleitscheine/{typ}/vorlage', request: { params: TypParam, ...body(BsVorlageSpeichern) }, responses: { 200: json(z.object({ vorlage: BsVorlage, entfernteAktionen: z.number() }), 'gespeichert') } }),
    async (c) => c.json(await bsVorlageSpeichern(db, c.req.valid('param').typ, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/einstellungen/begleitscheine/{typ}/vorlage/zuruecksetzen', request: { params: TypParam }, responses: { 200: json(z.object({ vorlage: BsVorlage, entfernteAktionen: z.number() }), 'Auslieferungszustand') } }),
    async (c) => c.json(await bsVorlageZuruecksetzen(db, c.req.valid('param').typ), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/begleitscheine/{typ}/aktionen', request: { params: TypParam }, responses: { 200: json(z.array(BsAktion), 'Aktionen') } }),
    async (c) => c.json(await bsAktionenLesen(db, c.req.valid('param').typ), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/begleitscheine/{typ}/aktionen', request: { params: TypParam, ...body(z.array(BsAktion).max(2000)) }, responses: { 200: json(z.array(BsAktion), 'gespeichert'), 422: fehler('ungültig') } }),
    async (c) => c.json(await bsAktionenSpeichern(db, c.req.valid('param').typ, c.req.valid('json')), 200),
  );
  const VordruckMitVerwendung = BsVordruck.extend({ verwendung: z.number() });
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/vordrucke', responses: { 200: json(z.array(VordruckMitVerwendung), 'Vordrucke') } }),
    async (c) => c.json(await bsVordruckeLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/vordrucke', request: body(z.array(BsVordruck).max(500)), responses: { 200: json(z.array(VordruckMitVerwendung), 'gespeichert') } }),
    async (c) => c.json(await bsVordruckeSpeichern(db, c.req.valid('json')), 200),
  );

  // ── Bank-Präsentation ────────────────────────────────────
  const PraesOderNichts = z.object({ praesentation: Praesentation.nullable() });
  app.openapi(
    createRoute({ method: 'get', path: '/api/deals/{id}/praesentation', request: { params: IdParam }, responses: { 200: json(PraesOderNichts, 'Präsentation oder keine') } }),
    async (c) => c.json({ praesentation: await praesentationZumDeal(db, c.req.valid('param').id) }, 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/praesentation', request: { params: IdParam, ...body(PraesentationAnlegen) }, responses: { 201: json(Praesentation, 'angelegt'), 404: fehler('Deal fehlt'), 409: fehler('bereits vorhanden') } }),
    async (c) => c.json(await praesentationAnlegen(db, c.req.valid('param').id, c.req.valid('json').vorlage), 201),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/praesentationen/{id}', request: { params: IdParam }, responses: { 200: json(Praesentation, 'Präsentation'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await praesentationDetail(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/praesentationen/{id}', request: { params: IdParam, ...body(PraesentationSpeichern) }, responses: { 200: json(Praesentation, 'gespeichert'), ...konflikt, 422: fehler('ungültig') } }),
    async (c) => c.json(await praesentationSpeichern(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/praesentationen/{id}', request: { params: IdParam }, responses: { 200: json(z.object({ id: z.string() }), 'im Papierkorb'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await praesentationLoeschen(db, c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/praesentationen/{id}/vorbelegen', request: { params: IdParam, ...body(PraesentationVorbelegen) }, responses: { 200: json(VorbelegungErgebnis, 'Vorbelegung (nicht gespeichert)'), 404: fehler('nicht gefunden') } }),
    async (c) => c.json(await praesentationVorbelegen(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  const exportieren = (art: 'pdf' | 'pptx') => async (c: import('hono').Context) => {
    const praes = await praesentationFuerExport(db, c.req.param('id')!);
    const fotos = fotoPort(db, speicherOpt ?? expose?.speicher);
    let datei: Uint8Array;
    try {
      datei = art === 'pdf' ? await (pdf.praesentation ?? finanzpraesPdf)(praes, fotos) : await finanzpraesPptx(praes, fotos);
    } catch (e) {
      if (e instanceof KeinBrowserError) throw new FachFehler(503, e.message);
      throw e;
    }
    await praesentationExportProtokollieren(db, praes, art);
    return alsStrom(datei, {
      'Content-Type': art === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `${art === 'pdf' ? 'inline' : 'attachment'}; filename="${praesentationDateiname(praes.bankName, art)}"`,
      'Cache-Control': 'no-store',
    });
  };
  app.get('/api/praesentationen/:id/pdf', renderTor(pdf.schleuse), exportieren('pdf'));
  // PowerPoint braucht keinen Browser, also keine Schleuse (wie alt)
  app.get('/api/praesentationen/:id/pptx', exportieren('pptx'));
  app.openapi(
    createRoute({ method: 'get', path: '/api/propstack/status', responses: { 200: json(PropstackStatusListe, 'Statusliste'), 422: fehler('kein Zugang') } }),
    async (c) => c.json(await propstackStatusListe(db, propstackOpt), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/propstack/status', request: body(PropstackStatusWahl), responses: { 200: json(z.object({ gewaehlt: z.number().int().nullable() }), 'gespeichert'), 400: fehler('ungültig') } }),
    async (c) => c.json(await propstackStatusSpeichern(db, c.req.valid('json').id), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/praesentation', responses: { 200: json(FinanzpraesStandard, 'Standards') } }),
    async (c) => c.json(await praesentationStandardLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/praesentation', request: body(FinanzpraesStandard), responses: { 200: json(FinanzpraesStandard, 'gespeichert'), 400: fehler('ungültig') } }),
    async (c) => c.json(await praesentationStandardSpeichern(db, c.req.valid('json')), 200),
  );

  // ── Objektfotos ──────────────────────────────────────────
  const FotoParam = z.object({ id: z.string().min(1), fotoId: z.string().min(1) });
  app.openapi(
    createRoute({ method: 'get', path: '/api/objekte/{id}/fotos', request: { params: IdParam }, responses: { 200: json(z.array(ObjektFoto), 'Fotos') } }),
    async (c) => c.json(await fotosListe(db, c.req.valid('param').id), 200),
  );
  // Rohe Bytes statt base64-JSON (alte App: upload-base64): ein Drittel kleiner, Typ wird an der Signatur geprüft
  app.post('/api/objekte/:id/fotos', async (c) => {
    const laenge = Number(c.req.header('content-length') ?? 0);
    if (laenge > 8 * 1024 * 1024) return c.json({ fehler: 'Bild zu groß (> 8 MB nach Kompression)' }, 413);
    const name = c.req.header('x-dateiname');
    const foto = await fotoHochladen(db, ablage(), c.req.param('id'), new Uint8Array(await c.req.arrayBuffer()), name ? decodeURIComponent(name) : undefined);
    return c.json(foto, 201);
  });
  app.openapi(
    createRoute({ method: 'put', path: '/api/objekte/{id}/fotos/reihenfolge', request: { params: IdParam, ...body(FotoReihenfolge) }, responses: { 200: json(z.array(ObjektFoto), 'neu sortiert') } }),
    async (c) => c.json(await fotosSortieren(db, c.req.valid('param').id, c.req.valid('json').ids), 200),
  );
  app.openapi(
    createRoute({ method: 'delete', path: '/api/objekte/{id}/fotos/{fotoId}', request: { params: FotoParam }, responses: { 200: json(z.object({ id: z.string() }), 'gelöscht'), 404: fehler('nicht gefunden') } }),
    async (c) => { const p = c.req.valid('param'); return c.json(await fotoLoeschen(db, ablage(), p.id, p.fotoId), 200); },
  );
  // Pfad wie in der alten App: die Präsentationsvorlage löst `photo:` wörtlich zu /api/photos/… auf
  app.get('/api/photos/:objektId/:fotoId', async (c) => {
    const { bytes, mimeType } = await fotoDatei(db, ablage(), c.req.param('objektId'), c.req.param('fotoId'));
    // Das Titelbild wechselt beim Umsortieren: nur kurz zwischenspeichern
    const dauer = c.req.param('fotoId') === 'cover' ? 60 : 86400;
    return alsStrom(bytes, { 'Content-Type': mimeType, 'Cache-Control': `private, max-age=${dauer}`, 'X-Content-Type-Options': 'nosniff' });
  });

  // ── Exposé-Import ────────────────────────────────────────
  app.get('/api/ki/status', (c) => c.json({ verfuegbar: !!expose?.ki, attrappe: !!expose?.attrappe, ablage: !!expose }));
  app.post('/api/expose/eingang', async (c) => {
    const laenge = Number(c.req.header('content-length') ?? 0);
    if (laenge > MAX_EXPOSE_BYTES) return c.json({ fehler: 'Das PDF ist größer als 200 MB.' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await exposeEingang(exposeKontext(), bytes), 201);
  });
  // Direkt-Upload (Function-Grenze 4,5 MB): Ticket → Browser lädt in den Speicher → Übernahme prüft die liegende Datei
  app.openapi(
    createRoute({ method: 'post', path: '/api/upload/ticket', request: body(z.object({ zweck: z.enum(['expose', 'dokument']), groesse: z.number().int().nonnegative().optional() })), responses: { 200: json(z.object({ url: z.string(), key: z.string() }), 'Upload-Adresse'), 413: fehler('zu groß'), 422: fehler('Dateiablage nicht eingerichtet') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await uploadTicket(ablage(), b.zweck, b.groesse), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/expose/eingang/uebernehmen', request: body(z.object({ key: z.string() })), responses: { 201: json(z.object({ key: z.string(), groesse: z.number() }), 'im Eingang'), 404: fehler('Datei fehlt'), 422: fehler('kein PDF') } }),
    async (c) => c.json(await exposeEingangUebernehmen(exposeKontext(), c.req.valid('json').key), 201),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/deals/{id}/dokumente/uebernehmen', request: { params: IdParam, ...body(z.object({ dateien: z.array(z.object({ key: z.string(), name: z.string().min(1).max(300), typ: z.string().max(200) })).min(1).max(50) })) }, responses: { 201: json(z.array(DealDokument), 'übernommen'), 404: fehler('nicht gefunden'), 413: fehler('zu groß'), 415: fehler('Dateiart nicht erlaubt') } }),
    async (c) => c.json(await dokumenteUebernehmen(db, ablage(), c.req.valid('param').id, c.req.valid('json').dateien), 201),
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/expose/analyse', ...{ request: body(z.object({ key: z.string(), dateiname: z.string().max(300) })) }, responses: { 200: json(ExposeAnalyseAntwort, 'ausgewertet'), 404: fehler('Datei fehlt'), 422: fehler('nicht auswertbar') } }),
    async (c) => { const b = c.req.valid('json'); return c.json(await exposeAnalysieren(db, exposeKontext(), b.key, b.dateiname), 200); },
  );
  app.openapi(
    createRoute({ method: 'post', path: '/api/expose/uebernehmen', request: body(ExposeUebernehmen), responses: { 201: json(ExposeUebernahmeErgebnis, 'angelegt'), 404: fehler('nicht gefunden'), 409: fehler('Deal bereits vorhanden'), 422: fehler('ungültig') } }),
    async (c) => c.json(await exposeUebernehmen(db, exposeKontext(), c.req.valid('json'), heuteBerlin()), 201),
  );
  app.get('/api/expose/bekannte-dateien', async (c) => c.json(await bekannteExposeDateien(db)));

  // ── Einstellungen ────────────────────────────────────────
  const DdListe = z.object({ zeilen: z.array(z.object({ dokument: z.string().max(500), quelle: z.string().max(300) })).max(500), gespeichert: z.boolean() });
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/dd-vorlage', responses: { 200: json(DdListe, 'DD-Dokumentenliste') } }),
    async (c) => c.json(await ddVorlageLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/dd-vorlage', request: body(z.object({ zeilen: z.array(z.object({ dokument: z.string().max(500), quelle: z.string().max(300).optional() })).max(500) })), responses: { 200: json(DdListe, 'gespeichert') } }),
    async (c) => c.json(await ddVorlageSpeichern(db, c.req.valid('json').zeilen), 200),
  );
  app.openapi(
    createRoute({ method: 'get', path: '/api/einstellungen/kalk-standard', responses: { 200: json(KalkStandardSchema, 'Standardwerte') } }),
    async (c) => c.json(await kalkStandardLesen(db), 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/api/einstellungen/kalk-standard', request: body(KalkStandardSchema), responses: { 200: json(KalkStandardSchema, 'gespeichert'), 400: fehler('Eingabe ungültig') } }),
    async (c) => c.json(await kalkStandardSpeichern(db, c.req.valid('json')), 200),
  );

  app.doc31('/api/openapi.json', { openapi: '3.1.0', info: { title: 'GG Immobilienhandel API', version: '0.1.0' } });

  return app;
}

export type App = ReturnType<typeof createApp>;
