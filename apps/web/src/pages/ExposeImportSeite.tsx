import {
  ExposeMaklerDaten as MaklerVertrag, ExposeObjektDaten as ObjektVertrag, ExposeUebernehmen,
  type ExposeAnalyseAntwort, type ExposeMaklerDaten, type ExposeObjektDaten,
} from '@gg/api-contract';
import {
  DEAL_STATUS, emailPruefen, exposeKostenBestaetigen, exposeKostenSchaetzung, FREQUENZEN, telefonPruefen, WIZARD_KALK_FELDER, type WizardKalk,
} from '@gg/domain';
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Stepper, Table, Text, Textarea, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { IconFileUpload, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type ReactNode, useMemo, useRef, useState, useEffect } from 'react';
import {
  DublettenFehler, exposeAnalysieren, exposeHochladen, exposeUebernehmen, useBekannteExposeDateien, useKiStatus, useMakler,
} from '../lib/api.ts';

const ZAHL = { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } as const;
const WIZARD_STATUS = DEAL_STATUS.filter((s) => s !== 'Angekauft');
const KALK_LABEL: Record<(typeof WIZARD_KALK_FELDER)[number], string> = {
  kaufpreis: 'Kaufpreis €', notar: 'Notar %', gest: 'GrESt %', makler: 'Maklerprov. %', fk_p: 'FK %', ek_p: 'EK %',
  euribor: 'Euribor %', margeB: 'Marge Bank %', ek_r: 'EK-Rendite %', halt: 'Haltedauer Mon.', rp_pct: 'Risikopuffer %', glo_m: 'Ziel-Marge Global %',
};
const dateiSchluessel = (n: string) => n.toLowerCase().replace(/\s+/g, '');

/**
 * Prüfung je Schritt aus dem Vertrag der API — dieselbe Regel, nur früher.
 * Ohne sie fällt ein zu langer Text oder eine als Text gelieferte Zahl erst beim Anlegen auf,
 * und der Wizard meldet am Ende nur „Eingabe ungültig", ohne zu sagen wo.
 */
const DealVertrag = ExposeUebernehmen.shape.deal;

type Feldfehler = Record<string, string>;
/** So viel vom Schema, wie die Prüfung braucht — damit das Web ohne eigene zod-Abhängigkeit auskommt. */
type Pruefbar = { safeParse(wert: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } };

function pruefe(schema: Pruefbar, wert: unknown): Feldfehler {
  const e = schema.safeParse(wert);
  if (e.success || !e.error) return {};
  const fehler: Feldfehler = {};
  for (const problem of e.error.issues) {
    const pfad = problem.path.map(String).join('.') || '(Eingabe)';
    if (!fehler[pfad]) fehler[pfad] = problem.message;
  }
  return fehler;
}

/** Beschriftung für die Meldung: „kalk.kaufpreis" liest sich schlechter als „Kaufpreis €". */
const feldName = (pfad: string) => {
  const letztes = pfad.split('.').pop() ?? pfad;
  return (KALK_LABEL as Record<string, string>)[letztes] ?? letztes;
};

function FehlerListe({ fehler, titel }: { fehler: Feldfehler; titel: string }) {
  const eintraege = Object.entries(fehler);
  if (!eintraege.length) return null;
  return (
    <Alert color="red" title={titel} aria-label="Eingabefehler">
      <Stack gap={2}>
        {eintraege.map(([pfad, text]) => (
          <Text key={pfad} size="sm" data-feldfehler={pfad}><b>{feldName(pfad)}:</b> {text}</Text>
        ))}
      </Stack>
    </Alert>
  );
}

type Phase = { art: 'upload' } | { art: 'pruefen'; schritt: 1 | 2 | 3 } | { art: 'zwischenstand'; dealId: string; adresse: string; makler: string };

/** Exposé-Import (Charta Ablauf 1): 📄 Upload → 🏢 Objekt → 🤝 Makler → 📋 Deal & Kalkulation, auch als Stapel. */
export function ExposeImportSeite() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: ki } = useKiStatus();
  const { data: bekannt = [] } = useBekannteExposeDateien();
  const [stapel, setStapel] = useState<File[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>({ art: 'upload' });
  const [kostenOk, setKostenOk] = useState(false);
  const [status, setStatus] = useState<{ text: string; fehler?: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [a, setA] = useState<(ExposeAnalyseAntwort & { key: string }) | null>(null);
  const [objekt, setObjekt] = useState<ExposeObjektDaten>({});
  const [objektBestehend, setObjektBestehend] = useState<string | null>(null);
  const [makler, setMakler] = useState<ExposeMaklerDaten>({});
  const [maklerBestehend, setMaklerBestehend] = useState<string | null>(null);
  const [deal, setDeal] = useState<{ status: string; nachfassFreq: string; notizen: string; kalk: WizardKalk }>({ status: 'In Prüfung', nachfassFreq: 'Wöchentlich', notizen: '', kalk: {} });
  const [dublette, setDublette] = useState<string | null>(null);

  const schaetzung = useMemo(() => stapel.map((f) => exposeKostenSchaetzung(f.size)), [stapel]);
  const summe = schaetzung.reduce((s, e) => s + e.eur, 0);
  const bestaetigen = exposeKostenBestaetigen(stapel.length, summe);
  const verbleibend = stapel.length - idx - 1;
  const datei = stapel[idx];

  /** Ein bereits abgelegtes Exposé auswerten (Weg aus dem Posteingang: der Anhang liegt schon im Eingang). */
  const analysiereSchluessel = async (key: string, name: string) => {
    setLaeuft(true);
    try {
      setStatus({ text: 'Claude liest das Exposé …' });
      const r = await exposeAnalysieren(key, name);
      setA({ ...r, key });
      setObjekt(r.objekt);
      setObjektBestehend(null);
      setMakler(r.makler);
      setMaklerBestehend(r.dubletten.makler?.id ?? null);
      setDeal({ status: r.deal.status, nachfassFreq: r.deal.nachfassFreq, notizen: r.deal.notizen, kalk: r.deal.kalk });
      setDublette(null);
      setStatus({ text: `✅ Analyse abgeschlossen${r.hinweis ? ` · ${r.hinweis}` : ''}` });
      setPhase({ art: 'pruefen', schritt: 1 });
    } catch (e) {
      setStatus({ text: `❌ ${(e as Error).message}`, fehler: true });
    } finally {
      setLaeuft(false);
    }
  };

  // Aus dem Posteingang übernommen: ?key=…&name=… wertet den Anhang sofort aus
  const suche = useSearch({ from: '/expose-import' });
  const ausMail = useRef(false);
  useEffect(() => {
    if (ausMail.current || !suche.key) return;
    ausMail.current = true;
    void analysiereSchluessel(suche.key, suche.name ?? 'Exposé aus Mail.pdf');
    // analysiereSchluessel hängt nur an Zustandssetzern
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche.key]);

  const analysieren = async () => {
    if (!datei) return;
    const label = stapel.length > 1 ? ` (PDF ${idx + 1}/${stapel.length})` : '';
    setLaeuft(true);
    try {
      setStatus({ text: `Lade Exposé hoch${label} …` });
      const { key } = await exposeHochladen(datei);
      setStatus({ text: `Claude liest das Exposé${label} …` });
      const r = await exposeAnalysieren(key, datei.name);
      setA({ ...r, key });
      setObjekt(r.objekt);
      setObjektBestehend(null);
      setMakler(r.makler);
      setMaklerBestehend(r.dubletten.makler?.id ?? null);
      setDeal({ status: r.deal.status, nachfassFreq: r.deal.nachfassFreq, notizen: r.deal.notizen, kalk: r.deal.kalk });
      setDublette(null);
      setStatus({ text: `✅ Analyse abgeschlossen${label}${r.hinweis ? ` · ${r.hinweis}` : ''}` });
      setPhase({ art: 'pruefen', schritt: 1 });
    } catch (e) {
      setStatus({ text: `❌ ${(e as Error).message}`, fehler: true });
    } finally {
      setLaeuft(false);
    }
  };

  const naechstes = () => {
    setA(null);
    setIdx((i) => i + 1);
    setPhase({ art: 'upload' });
    setStatus(null);
  };

  const anlegen = async () => {
    if (!a || !datei) return;
    setLaeuft(true);
    try {
      const r = await exposeUebernehmen({
        key: a.key, dateiname: datei.name, extrahiert: a.extrahiert,
        objekt: { ...(objektBestehend ? { bestehendeId: objektBestehend } : {}), daten: objekt },
        makler: { ...(maklerBestehend ? { bestehendeId: maklerBestehend } : {}), daten: makler },
        deal: { ...deal, status: deal.status as (typeof DEAL_STATUS)[number] },
      });
      void qc.invalidateQueries();
      if (verbleibend > 0) {
        setPhase({ art: 'zwischenstand', dealId: r.dealId, adresse: [objekt.strasse, objekt.hausnr, objekt.plz, objekt.stadt].filter(Boolean).join(' ') || 'Objekt', makler: makler.name || '–' });
      } else {
        navigate({ to: '/deals', search: { deal: r.dealId } });
      }
      if (r.warnung) setStatus({ text: r.warnung, fehler: true });
    } catch (e) {
      if (e instanceof DublettenFehler) {
        if (verbleibend > 0) {
          setStatus({ text: `⏭ Übersprungen: ${objekt.strasse ?? 'Objekt'} + ${makler.name ?? 'Makler'} bereits vorhanden` });
          naechstes();
        } else {
          setDublette(e.dealId);
        }
      } else {
        // Feldpfade der API mitzeigen: „Eingabe ungültig" allein sagt nicht, was zu ändern ist.
        const f = e as { klartext?: string; message: string };
        setStatus({ text: `❌ ${f.klartext ?? f.message}`, fehler: true });
      }
    } finally {
      setLaeuft(false);
    }
  };

  const schritt = phase.art === 'pruefen' ? phase.schritt : 0;
  // Jeder Schritt prüft seinen eigenen Teil des Vertrags — der Fehler steht dort, wo er entsteht.
  const fehlerJeSchritt = useMemo(() => ({
    1: pruefe(ObjektVertrag, objekt),
    2: pruefe(MaklerVertrag, makler),
    3: pruefe(DealVertrag, deal),
  }), [objekt, makler, deal]);
  const zahl = (o: Feldfehler) => Object.keys(o).length;
  const offeneFehler = zahl(fehlerJeSchritt[1]) + zahl(fehlerJeSchritt[2]) + zahl(fehlerJeSchritt[3]);
  const SCHRITT_NAME: Record<1 | 2 | 3, string> = { 1: 'Objekt', 2: 'Makler', 3: 'Deal & Kalkulation' };

  return (
    <Stack maw={960} mx="auto">
      <Group justify="flex-end">
        <Button variant="subtle" color="red" leftSection={<IconX size={16} />} onClick={() => navigate({ to: '/deals' })}>Abbrechen</Button>
      </Group>
      <Stepper active={schritt} size="sm">
        <Stepper.Step label="Upload" description="📄" />
        {/* Ein Schritt mit Beanstandung ist schon am Balken erkennbar, nicht erst nach dem Hineinklicken. */}
        {([1, 2, 3] as const).map((nr) => {
          const anzahl = phase.art === 'pruefen' ? zahl(fehlerJeSchritt[nr]) : 0;
          return (
            <Stepper.Step
              key={nr}
              label={SCHRITT_NAME[nr]}
              description={anzahl ? `${anzahl} zu prüfen` : ['🏢', '🤝', '📋'][nr - 1]}
              color={anzahl ? 'red' : undefined}
              data-schritt-fehler={anzahl || undefined}
            />
          );
        })}
      </Stepper>
      {ki && !ki.verfuegbar && <Alert color="red" title="Keine KI eingerichtet">ANTHROPIC_API_KEY in der .env setzen (oder KI_ATTRAPPE=1 für Tests).</Alert>}
      {ki?.attrappe && <Alert color="yellow" title="Test-Modus">Die KI-Attrappe liefert Beispieldaten aus einfachen „Feld: Wert“-Zeilen. Für echte Exposés ANTHROPIC_API_KEY setzen.</Alert>}
      {status && <Alert color={status.fehler ? 'red' : 'teal'} aria-label="Status">{status.text}</Alert>}

      {phase.art === 'upload' && (
        <UploadSchritt
          stapel={stapel} idx={idx} bekannt={bekannt} schaetzung={schaetzung} summe={summe} bestaetigen={bestaetigen && idx === 0}
          kostenOk={kostenOk} setKostenOk={setKostenOk} laeuft={laeuft}
          hinzufuegen={(fs) => setStapel((s) => [...s, ...fs.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))])}
          entfernen={(i) => setStapel((s) => s.filter((_, j) => j !== i))}
          analysieren={analysieren} kiBereit={!!ki?.verfuegbar}
        />
      )}

      {phase.art === 'pruefen' && a && (
        <FehlerListe fehler={fehlerJeSchritt[phase.schritt]} titel={`${SCHRITT_NAME[phase.schritt]}: bitte prüfen`} />
      )}
      {phase.art === 'pruefen' && a && phase.schritt === 1 && (
        <ObjektSchritt a={a} objekt={objekt} setObjekt={setObjekt} bestehend={objektBestehend} setBestehend={setObjektBestehend} />
      )}
      {phase.art === 'pruefen' && a && phase.schritt === 2 && (
        <MaklerSchritt a={a} makler={makler} setMakler={setMakler} bestehend={maklerBestehend} setBestehend={setMaklerBestehend} />
      )}
      {phase.art === 'pruefen' && a && phase.schritt === 3 && <DealSchritt deal={deal} setDeal={setDeal} />}

      {dublette && (
        <Alert color="orange" title="Deal bereits vorhanden">
          <Text size="sm" mb="xs">Für „{[objekt.strasse, objekt.hausnr].filter(Boolean).join(' ') || 'Objekt'}“ mit Makler „{makler.name || 'Makler'}“ gibt es schon einen Deal.</Text>
          <Group>
            <Button size="xs" onClick={() => navigate({ to: '/deals', search: { deal: dublette } })}>Exposé überspringen</Button>
            <Button size="xs" variant="default" onClick={() => setDublette(null)}>Zurück zum Wizard</Button>
          </Group>
        </Alert>
      )}

      {phase.art === 'pruefen' && (
        <Group justify="space-between">
          <Button variant="default" disabled={phase.schritt === 1} onClick={() => setPhase({ art: 'pruefen', schritt: (phase.schritt - 1) as 1 | 2 })}>← Zurück</Button>
          {phase.schritt < 3 ? (
            <Button
              color={zahl(fehlerJeSchritt[phase.schritt]) ? 'orange' : undefined}
              onClick={() => setPhase({ art: 'pruefen', schritt: (phase.schritt + 1) as 2 | 3 })}
            >
              {phase.schritt === 1 ? 'Weiter: Makler →' : 'Weiter: Deal →'}
            </Button>
          ) : (
            <Button
              color="green"
              loading={laeuft}
              onClick={() => {
                // Nicht erst den Server abweisen lassen: zum ersten beanstandeten Schritt springen.
                const offen = ([1, 2, 3] as const).find((nr) => zahl(fehlerJeSchritt[nr]));
                if (offen) {
                  setPhase({ art: 'pruefen', schritt: offen });
                  setStatus({ text: `❌ ${SCHRITT_NAME[offen]}: ${zahl(fehlerJeSchritt[offen])} Feld(er) prüfen`, fehler: true });
                  return;
                }
                void anlegen();
              }}
            >
              {verbleibend > 0 ? `✅ Deal anlegen & nächstes PDF (${verbleibend} verbleibend)` : '✅ Deal anlegen'}
            </Button>
          )}
        </Group>
      )}

      {phase.art === 'zwischenstand' && (
        <Paper withBorder p="xl" ta="center">
          <Text size="48px">✅</Text>
          <Title order={3}>Deal angelegt</Title>
          <Text fw={600}>{phase.adresse}</Text>
          <Text size="sm" c="dimmed" mb="md">Makler: {phase.makler}</Text>
          <Text size="sm"><b>{idx + 1}</b> von <b>{stapel.length}</b> Exposés verarbeitet · noch <b>{verbleibend}</b></Text>
          <Stack mt="md">
            <Button onClick={naechstes}>📄 Weiter: Nächstes Exposé analysieren →</Button>
            <Button variant="subtle" onClick={() => navigate({ to: '/deals', search: { deal: phase.dealId } })}>Stapel abbrechen — restliche {verbleibend} überspringen</Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function UploadSchritt(p: {
  stapel: File[]; idx: number; bekannt: string[]; schaetzung: { seiten: number; eur: number }[]; summe: number; bestaetigen: boolean;
  kostenOk: boolean; setKostenOk: (v: boolean) => void; laeuft: boolean; hinzufuegen: (f: File[]) => void; entfernen: (i: number) => void;
  analysieren: () => void; kiBereit: boolean;
}) {
  const eingabe = useRef<HTMLInputElement>(null);
  const [ueber, setUeber] = useState(false);
  return (
    <Stack>
      <Paper
        withBorder p="xl" ta="center" aria-label="Exposé-Ablage"
        style={{ borderStyle: 'dashed', borderWidth: 2, background: ueber ? 'var(--mantine-primary-color-light)' : undefined, cursor: 'pointer' }}
        onDragOver={(e) => { e.preventDefault(); setUeber(true); }} onDragLeave={() => setUeber(false)}
        onDrop={(e) => { e.preventDefault(); setUeber(false); p.hinzufuegen([...e.dataTransfer.files]); }}
        onClick={() => eingabe.current?.click()}
      >
        <IconFileUpload size={40} />
        <Text fw={600}>PDF hierher ziehen oder klicken</Text>
        <Text size="sm" c="dimmed">Mehrere Exposés werden nacheinander geprüft</Text>
        <input ref={eingabe} type="file" accept="application/pdf" multiple hidden aria-label="Exposé-PDF wählen" onChange={(e) => { p.hinzufuegen([...(e.currentTarget.files ?? [])]); e.currentTarget.value = ''; }} />
      </Paper>
      {p.stapel.length > 0 && (
        <Paper withBorder p="sm" aria-label="Warteschlange">
          {p.stapel.map((f, i) => (
            <Group key={`${f.name}-${i}`} justify="space-between" py={4} style={{ opacity: i < p.idx ? 0.5 : 1 }}>
              <Group gap="xs">
                <Text size="sm" fw={i === p.idx ? 700 : 400}>{i === p.idx ? '▶ ' : ''}{f.name}</Text>
                {p.bekannt.includes(dateiSchluessel(f.name)) && <Badge color="orange" variant="light">bereits importiert</Badge>}
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">{(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB · ~{p.schaetzung[i]!.seiten} S. · ~{p.schaetzung[i]!.eur.toFixed(2).replace('.', ',')} €</Text>
                {i > p.idx && <ActionIcon variant="subtle" color="red" aria-label="Aus Warteschlange entfernen" onClick={() => p.entfernen(i)}><IconTrash size={14} /></ActionIcon>}
              </Group>
            </Group>
          ))}
          <Text size="sm" mt="xs">Geschätzte KI-Kosten gesamt: <b>~{p.summe.toFixed(2).replace('.', ',')} €</b></Text>
          {p.bestaetigen && <Checkbox mt="xs" label="Kosten bestätigen" checked={p.kostenOk} onChange={(e) => p.setKostenOk(e.currentTarget.checked)} />}
        </Paper>
      )}
      <Group justify="flex-end">
        <Button size="md" loading={p.laeuft} disabled={!p.stapel[p.idx] || !p.kiBereit || (p.bestaetigen && !p.kostenOk)} onClick={p.analysieren}>Analysieren →</Button>
      </Group>
    </Stack>
  );
}

function Punkt({ konf }: { konf?: string }) {
  const farbe = konf === 'hoch' ? 'green' : konf === 'mittel' ? 'orange' : 'red';
  const tipp = konf === 'hoch' ? 'Sicher erkannt' : konf === 'mittel' ? 'Unsicher – bitte prüfen' : 'Nicht erkannt';
  return <span title={tipp} aria-label={tipp} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${farbe}-6)`, marginLeft: 6 }} />;
}

const feldLabel = (text: string, konf?: string): ReactNode => <span>{text}<Punkt konf={konf} /></span>;

function ObjektSchritt({ a, objekt, setObjekt, bestehend, setBestehend }: { a: ExposeAnalyseAntwort; objekt: ExposeObjektDaten; setObjekt: (o: ExposeObjektDaten) => void; bestehend: string | null; setBestehend: (id: string | null) => void }) {
  const k = a.konfidenz;
  const t = (feld: keyof ExposeObjektDaten, label: string, konfSchluessel = feld as string) => (
    <TextInput label={feldLabel(label, k[konfSchluessel])} value={(objekt[feld] as string) ?? ''} onChange={(e) => setObjekt({ ...objekt, [feld]: e.currentTarget.value })} />
  );
  const n = (feld: keyof ExposeObjektDaten, label: string) => (
    <NumberInput label={feldLabel(label, k[feld as string])} value={(objekt[feld] as number) ?? ''} onChange={(v) => setObjekt({ ...objekt, [feld]: typeof v === 'number' ? v : null })} {...ZAHL} thousandSeparator={feld === 'baujahr' || feld === 'heizungsbaujahr' ? undefined : '.'} />
  );
  const ea = objekt.energieausweis ?? {};
  const einheiten = objekt.einheiten ?? [];
  const setE = (i: number, teil: object) => setObjekt({ ...objekt, einheiten: einheiten.map((e, j) => (j === i ? { ...e, ...teil } : e)) });
  return (
    <Stack>
      <Title order={3}>🏢 Objekt prüfen</Title>
      <Text size="sm" c="dimmed">Erkannte Werte prüfen und korrigieren. Punkt: grün sicher · orange unsicher · rot nicht erkannt.</Text>
      {a.dubletten.objekt && (
        <Alert color={bestehend ? 'green' : 'orange'} title={a.dubletten.objekt.sicherheit === 'exact' ? 'Objekt existiert bereits' : 'Ähnliches Objekt gefunden'}>
          <Text size="sm" mb="xs">{a.dubletten.objekt.titel}</Text>
          <Group>
            <Button size="xs" variant={bestehend ? 'filled' : 'light'} onClick={() => setBestehend(a.dubletten.objekt!.id)}>Bestehendes Objekt verwenden</Button>
            <Button size="xs" variant={bestehend ? 'default' : 'filled'} color="gray" onClick={() => setBestehend(null)}>Neu anlegen</Button>
          </Group>
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {t('strasse', 'Straße')}{t('hausnr', 'Hausnummer')}{t('plz', 'PLZ')}{t('stadt', 'Stadt')}{t('bundesland', 'Bundesland')}{n('baujahr', 'Baujahr')}
        {n('wohnflaeche', 'Wohnfläche m²')}{n('grundstueck', 'Grundstück m²')}{n('einheitenAnz', 'Einheiten gesamt')}{n('angebotspreis', 'Angebotspreis €')}
        {n('istmiete', 'Ist-Miete / Monat €')}{n('bruttorendite', 'Brutto-Rendite %')}
      </SimpleGrid>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase">Energie & Heizung</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {t('heizungsart', 'Heizungsart')}{n('heizungsbaujahr', 'Heizung Baujahr')}
        <TextInput label={feldLabel('Energieklasse', k.energieklasse)} value={ea.klasse ?? ''} onChange={(e) => setObjekt({ ...objekt, energieausweis: { ...ea, klasse: e.currentTarget.value } })} />
        <NumberInput label={feldLabel('Energiekennwert kWh/m²a', k.energiekennwert)} value={ea.kennwert ?? ''} onChange={(v) => setObjekt({ ...objekt, energieausweis: { ...ea, kennwert: typeof v === 'number' ? v : null } })} {...ZAHL} />
        <TextInput label={feldLabel('Energieausweis Art', k.energieart)} value={ea.art ?? ''} onChange={(e) => setObjekt({ ...objekt, energieausweis: { ...ea, art: e.currentTarget.value } })} />
      </SimpleGrid>
      <Paper withBorder p="sm" aria-label="Einheitenaufstellung">
        <Group justify="space-between" mb="xs">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">Einheitenaufstellung</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setObjekt({ ...objekt, einheiten: [...einheiten, { typ: 'Wohnung', lage: '', zimmer: 0, flaeche: 0, kaltmiete: null, vermiet: 'Vermietet' }] })}>Einheit</Button>
        </Group>
        <ScrollArea>
          <Table miw={620}>
            <Table.Thead><Table.Tr><Table.Th>Typ</Table.Th><Table.Th>Lage</Table.Th><Table.Th>Zi.</Table.Th><Table.Th>m²</Table.Th><Table.Th>Kaltmiete €</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {einheiten.map((e, i) => (
                <Table.Tr key={i}>
                  <Table.Td><Select size="xs" w={110} data={['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges']} value={e.typ ?? 'Wohnung'} allowDeselect={false} onChange={(v) => v && setE(i, { typ: v })} aria-label="Typ" /></Table.Td>
                  <Table.Td><TextInput size="xs" w={100} value={e.lage ?? ''} onChange={(ev) => setE(i, { lage: ev.currentTarget.value })} aria-label="Lage" /></Table.Td>
                  <Table.Td><NumberInput size="xs" w={60} value={e.zimmer ?? ''} onChange={(v) => setE(i, { zimmer: typeof v === 'number' ? v : null })} aria-label="Zimmer" {...ZAHL} /></Table.Td>
                  <Table.Td><NumberInput size="xs" w={70} value={e.flaeche ?? ''} onChange={(v) => setE(i, { flaeche: typeof v === 'number' ? v : null })} aria-label="Fläche" {...ZAHL} /></Table.Td>
                  <Table.Td><NumberInput size="xs" w={90} value={e.kaltmiete ?? ''} onChange={(v) => setE(i, { kaltmiete: typeof v === 'number' ? v : null })} aria-label="Kaltmiete" {...ZAHL} /></Table.Td>
                  <Table.Td><Select size="xs" w={110} data={['Vermietet', 'Leerstand']} value={e.vermiet ?? 'Vermietet'} allowDeselect={false} onChange={(v) => v && setE(i, { vermiet: v })} aria-label="Status" /></Table.Td>
                  <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Einheit entfernen" onClick={() => setObjekt({ ...objekt, einheiten: einheiten.filter((_, j) => j !== i) })}><IconTrash size={14} /></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Textarea label="Lagebeschreibung" autosize minRows={3} value={objekt.lagebeschreibung ?? ''} onChange={(e) => setObjekt({ ...objekt, lagebeschreibung: e.currentTarget.value })} />
        <Textarea label="Ausstattung" autosize minRows={3} value={objekt.ausstattung ?? ''} onChange={(e) => setObjekt({ ...objekt, ausstattung: e.currentTarget.value })} />
      </SimpleGrid>
      <Textarea label="Notizen aus Exposé" autosize minRows={2} value={objekt.notizen ?? ''} onChange={(e) => setObjekt({ ...objekt, notizen: e.currentTarget.value })} />
    </Stack>
  );
}

function MaklerSchritt({ a, makler, setMakler, bestehend, setBestehend }: { a: ExposeAnalyseAntwort; makler: ExposeMaklerDaten; setMakler: (m: ExposeMaklerDaten) => void; bestehend: string | null; setBestehend: (id: string | null) => void }) {
  const { data: alle = [] } = useMakler();
  const [suche, setSuche] = useState('');
  const k = a.konfidenz;
  const roh = (a.extrahiert.makler ?? {}) as { alleNamen?: string[]; alleTelefonnummern?: string[]; alleEmails?: string[] };
  const gewaehlt = alle.find((m) => m.id === bestehend);
  const treffer = alle.filter((m) => !suche || [m.name, m.firma, m.tel].some((x) => x?.toLowerCase().includes(suche.toLowerCase()))).slice(0, 30);
  const telFehler = telefonPruefen(makler.tel), mailFehler = emailPruefen(makler.email);

  const mitOptionen = (feld: 'name' | 'tel' | 'email', label: string, konf: string | undefined, optionen?: string[]) => {
    const extra = [...new Set((optionen ?? []).map((o) => o?.trim()).filter(Boolean))].filter((o) => o !== (makler[feld] ?? '').trim());
    return (
      <div>
        <TextInput label={feldLabel(label, konf)} value={makler[feld] ?? ''} onChange={(e) => setMakler({ ...makler, [feld]: e.currentTarget.value })}
          error={feld === 'tel' ? telFehler && `${telFehler} (wird trotzdem gespeichert)` : feld === 'email' ? mailFehler && `${mailFehler} (wird trotzdem gespeichert)` : undefined} />
        {extra.length > 0 && <Group gap={4} mt={4}>{extra.map((o) => <Button key={o} size="compact-xs" variant="light" onClick={() => setMakler({ ...makler, [feld]: o })}>{o}</Button>)}</Group>}
      </div>
    );
  };

  return (
    <Stack>
      <Title order={3}>🤝 Makler prüfen</Title>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb={4}>🔍 Bestehenden Makler auswählen</Text>
        <TextInput placeholder="Name, Firma oder Telefon …" value={suche} onChange={(e) => setSuche(e.currentTarget.value)} aria-label="Makler suchen" />
        <ScrollArea h={150} mt={6}>
          {treffer.map((m) => (
            <UnstyledButton key={m.id} display="block" w="100%" p={4} onClick={() => { setBestehend(m.id); if (m.prio) setMakler({ ...makler, prio: m.prio }); }} style={{ background: m.id === bestehend ? 'var(--mantine-primary-color-light)' : undefined, borderRadius: 4 }}>
              <Text size="sm">{m.name ?? '–'}{m.firma ? ` · ${m.firma}` : ''}{m.tel ? ` · ${m.tel}` : ''}{m.id === a.dubletten.makler?.id ? ' ⭐ Vorschlag' : ''}</Text>
            </UnstyledButton>
          ))}
        </ScrollArea>
      </Paper>
      {gewaehlt && (
        <Alert color="green" withCloseButton onClose={() => setBestehend(null)} closeButtonLabel="Abwählen">✅ Makler ausgewählt: {gewaehlt.name ?? '–'}{gewaehlt.firma ? ` (${gewaehlt.firma})` : ''}</Alert>
      )}
      <Text size="sm" fw={600}>{gewaehlt ? '📝 Makler-Daten anpassen (nur Telefon wird übernommen)' : '📝 Neuen Makler eintragen'}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {mitOptionen('name', 'Name', k.maklerName, roh.alleNamen)}
        <TextInput label={feldLabel('Firma', k.maklerFirma)} value={makler.firma ?? ''} onChange={(e) => setMakler({ ...makler, firma: e.currentTarget.value })} />
        {mitOptionen('tel', 'Telefon', k.maklerTel, roh.alleTelefonnummern)}
        {mitOptionen('email', 'E-Mail', k.maklerEmail, roh.alleEmails)}
        <TextInput label={feldLabel('Webseite', k.maklerWebseite)} value={makler.webseite ?? ''} onChange={(e) => setMakler({ ...makler, webseite: e.currentTarget.value })} />
      </SimpleGrid>
      <Group gap="xs">
        {(['A', 'B', 'C'] as const).map((p) => (
          <Button key={p} variant={(makler.prio ?? 'B') === p ? 'filled' : 'default'} onClick={() => setMakler({ ...makler, prio: p })}>{p === 'A' ? '▲ A-Makler' : p === 'B' ? '◆ B-Makler' : '○ C-Makler'}</Button>
        ))}
      </Group>
      <Select label="Kontaktfrequenz" w={220} data={[...FREQUENZEN]} value={makler.kontaktFreq === 'Nicht kontaktieren' ? 'Nie' : makler.kontaktFreq ?? 'Monatlich'} allowDeselect={false} onChange={(v) => v && setMakler({ ...makler, kontaktFreq: v })} />
      <Textarea label="Notizen" autosize minRows={2} value={makler.notizen ?? ''} onChange={(e) => setMakler({ ...makler, notizen: e.currentTarget.value })} />
    </Stack>
  );
}

function DealSchritt({ deal, setDeal }: { deal: { status: string; nachfassFreq: string; notizen: string; kalk: WizardKalk }; setDeal: (d: { status: string; nachfassFreq: string; notizen: string; kalk: WizardKalk }) => void }) {
  return (
    <Stack>
      <Title order={3}>📋 Deal & Kalkulation</Title>
      <SimpleGrid cols={2} spacing="sm">
        <Select label="Status" data={[...WIZARD_STATUS]} value={deal.status} allowDeselect={false} onChange={(v) => v && setDeal({ ...deal, status: v })} />
        <Select label="Nachfass-Frequenz" data={[...FREQUENZEN]} value={deal.nachfassFreq} allowDeselect={false} onChange={(v) => v && setDeal({ ...deal, nachfassFreq: v })} />
      </SimpleGrid>
      <Paper withBorder p="sm" aria-label="Kalkulations-Vorwerte">
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">🧮 Kalkulations-Vorwerte (aus Exposé, sonst Einstellungen)</Text>
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          {WIZARD_KALK_FELDER.map((f) => (
            <NumberInput key={f} label={KALK_LABEL[f]} value={deal.kalk[f] ?? ''} onChange={(v) => setDeal({ ...deal, kalk: { ...deal.kalk, [f]: typeof v === 'number' ? v : null } })} {...ZAHL} />
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="xs">Alle Werte lassen sich nach dem Import in der Kalkulation anpassen. Eine 0 bleibt 0.</Text>
      </Paper>
      <Textarea label="Deal-Notizen" autosize minRows={3} value={deal.notizen} onChange={(e) => setDeal({ ...deal, notizen: e.currentTarget.value })} />
    </Stack>
  );
}
