import type { Kundenkalkulation } from '@gg/api-contract';
import { bankgespraechPayload, bankgespraechPreviewHtml, bildFuerVorschau, dokumentBilder } from '@gg/documents';
import {
  computeKKalk,
  eigenkapitalAnwenden,
  eigenkapitalSchnell,
  hinweiseAusText,
  KK_PROZENTFELDER,
  kundenkalkFeldSetzen,
  type SanierungsModus,
  tranche1Schnell,
} from '@gg/domain';
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Divider, Group, Image, Loader, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { IconArrowLeft, IconFileTypePdf, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { KkErgebnis } from '../components/kundenkalk/KkErgebnis.tsx';
import { type AuswahlAuftrag, BildAuswahl } from '../components/praesentation/BildAuswahl.tsx';
import { useAutomatischSpeichern } from '../lib/automatischSpeichern.ts';
import { bankgespraechPdfLaden, kundenkalkulationSpeichern, useDealDetail, useKundenkalkEinstellungen, useKundenkalkulation } from '../lib/api.ts';

const ZAHL = { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } as const;
const MODI: { value: SanierungsModus; label: string }[] = [
  { value: 'sofort', label: 'Sofort abschreiben' },
  { value: 'aktivieren', label: 'Aktivieren (AfA)' },
  { value: 'weg_ruecklage', label: 'Aus WEG-Rücklage' },
];

type Felder = Omit<Kundenkalkulation, 'id' | 'dealId' | 'version' | 'scope' | 'einheitId' | 'createdAt' | 'updatedAt'>;
const felder = ({ id, dealId, version, scope, einheitId, createdAt, updatedAt, ...f }: Kundenkalkulation): Felder => {
  void id; void dealId; void version; void scope; void einheitId; void createdAt; void updatedAt;
  return f;
};

export function KundenkalkulationSeite() {
  const { id } = useParams({ from: '/kundenkalkulationen/$id' });
  const { data, isLoading, error } = useKundenkalkulation(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Kundenkalkulation nicht gefunden'}</Alert>;
  return <Editor key={data.id} start={data} />;
}

function Editor({ start }: { start: Kundenkalkulation }) {
  const navigate = useNavigate();
  const [k, setK] = useState<Felder>(felder(start));
  const qc = useQueryClient();
  // Wie in der alten App wird jede Änderung gespeichert – hier gebündelt nach kurzer Pause, mit Versionsprüfung.
  const zustand = useAutomatischSpeichern(k, { version: start.version, stand: felder(start) }, (stand, version) => kundenkalkulationSpeichern(start.id, { ...stand, version }), (neu) => {
    qc.setQueryData(['kundenkalkulation', start.id], neu);
    void qc.invalidateQueries({ queryKey: ['kundenkalkulationen'] });
  });
  const out = useMemo(() => computeKKalk(k.inputs), [k.inputs]);
  const i = k.inputs;
  const setzeFeld = (feld: string, v: number | string) => setK((alt) => kundenkalkFeldSetzen(alt, feld, typeof v === 'number' ? v : 0));
  const setzeInputs = (f: (inp: typeof i) => typeof i) => setK((alt) => ({ ...alt, inputs: f(alt.inputs) }));
  const pct = (feld: (typeof KK_PROZENTFELDER)[number]) => Math.round((i[feld] ?? 0) * 100 * 10000) / 10000;
  const gik = out.investition.gik;
  const ek = Math.round(out.finanzierung.eigenkapital);
  const luecke = Math.round(gik - out.finanzierung.darlehensummeGesamt - ek);

  return (
    <Stack maw={1400}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ActionIcon variant="subtle" aria-label="Zurück" onClick={() => window.history.length > 1 ? window.history.back() : navigate({ to: '/kundenkalkulationen' })}>
            <IconArrowLeft />
          </ActionIcon>
          <div style={{ minWidth: 0 }}>
            <TextInput variant="unstyled" aria-label="Name der Kalkulation" value={k.name} onChange={(e) => { const name = e.currentTarget.value; setK((a) => ({ ...a, name })); }} styles={{ input: { fontSize: 22, fontWeight: 700, height: 34 } }} />
            <Text size="sm" c="dimmed">{start.scope === 'aufteiler' ? '🏠 Aufteiler' : '🏢 Globalverkauf'} · {k.objSnapshot.adresse}</Text>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Badge variant="light" color={typeof zustand === 'object' ? 'red' : zustand === 'gespeichert' ? 'green' : 'gray'} aria-label="Speicherstand">
            {typeof zustand === 'object' ? 'nicht gespeichert' : zustand === 'gespeichert' ? 'gespeichert' : 'speichert …'}
          </Badge>
          <PdfKnopf id={start.id} bereit={zustand === 'gespeichert'} />
        </Group>
      </Group>
      {typeof zustand === 'object' && <Alert color="red" title="Nicht gespeichert">{zustand.fehler} – Seite neu laden, um den aktuellen Stand zu holen.</Alert>}

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
        <Stack gap="sm">
          <Abschnitt titel="Investition">
            <SimpleGrid cols={2} spacing="xs">
              <NumberInput label="Kaufpreis Wohnung" suffix=" €" value={k.kaufpreisWohnung} onChange={(v) => setzeFeld('kaufpreisWohnung', v)} {...ZAHL} />
              <NumberInput label="Kaufpreis Stellplatz" suffix=" €" value={k.kaufpreisStellplatz} onChange={(v) => setzeFeld('kaufpreisStellplatz', v)} {...ZAHL} />
              <NumberInput label="Stellplätze (Stk.)" value={k.stellplaetzeAnzahl} onChange={(v) => setzeFeld('stellplaetzeAnzahl', v)} {...ZAHL} />
              <NumberInput label="Mietfläche" suffix=" m²" value={k.objSnapshot.wohnflaecheGesamt} onChange={(v) => setzeFeld('mietflaeche', v)} {...ZAHL} />
            </SimpleGrid>
            <Text size="sm" mt={6}>Kaufpreis gesamt: <b>{i.kaufpreis.toLocaleString('de-DE')} €</b></Text>
            <Divider my="xs" label="Nebenkosten" labelPosition="left" />
            {([['notarPct', 'Notar'], ['grundbuchPct', 'Grundbuch'], ['grundsteuerPct', 'Grunderwerbsteuer'], ['maklerPct', 'Makler'], ['sonstigePct', 'Sonstige']] as const).map(([feld, label]) => (
              <Group key={feld} gap="xs" wrap="nowrap" mb={4}>
                <Text size="sm" style={{ flex: 1 }}>{label}</Text>
                <NumberInput w={90} size="xs" aria-label={`${label} %`} suffix=" %" decimalScale={4} value={pct(feld)} onChange={(v) => setzeFeld(feld, v)} {...ZAHL} />
                <NumberInput w={120} size="xs" aria-label={`${label} €`} suffix=" €" value={Math.round(i[feld] * i.kaufpreis)} onChange={(v) => setzeFeld(`${feld}__eur`, v)} {...ZAHL} />
              </Group>
            ))}
            <Divider my="xs" label="Sanierung" labelPosition="left" />
            {i.sanierungsposten.map((p, idx) => (
              <Group key={idx} gap={4} wrap="nowrap" mb={4}>
                <TextInput size="xs" style={{ flex: 1 }} aria-label="Bezeichnung" value={p.label} onChange={(e) => { const label = e.currentTarget.value; setzeInputs((inp) => ({ ...inp, sanierungsposten: inp.sanierungsposten.map((x, j) => (j === idx ? { ...x, label } : x)) })); }} />
                <NumberInput size="xs" w={110} aria-label="Betrag" suffix=" €" value={p.amount} onChange={(v) => setzeInputs((inp) => ({ ...inp, sanierungsposten: inp.sanierungsposten.map((x, j) => (j === idx ? { ...x, amount: typeof v === 'number' ? v : 0 } : x)) }))} {...ZAHL} />
                <Select size="xs" w={160} aria-label="Modus" data={MODI} value={p.modus} allowDeselect={false} onChange={(v) => v && setzeInputs((inp) => ({ ...inp, sanierungsposten: inp.sanierungsposten.map((x, j) => (j === idx ? { ...x, modus: v as SanierungsModus } : x)) }))} />
                <ActionIcon variant="subtle" color="red" aria-label="Posten entfernen" onClick={() => setzeInputs((inp) => ({ ...inp, sanierungsposten: inp.sanierungsposten.filter((_, j) => j !== idx) }))}><IconTrash size={14} /></ActionIcon>
              </Group>
            ))}
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setzeInputs((inp) => ({ ...inp, sanierungsposten: [...inp.sanierungsposten, { label: 'Neue Position', amount: 0, modus: 'sofort' }] }))}>Sanierungsposten</Button>
          </Abschnitt>

          <Abschnitt titel="Finanzierung">
            <Group gap="xs" align="flex-end">
              <EkFeld ek={ek} anwenden={(v) => setzeInputs((inp) => eigenkapitalAnwenden(inp, v))} />
              <Button size="compact-xs" variant="default" onClick={() => setzeInputs((inp) => eigenkapitalSchnell(inp, 'zero'))}>0 €</Button>
              <Button size="compact-xs" variant="default" onClick={() => setzeInputs((inp) => eigenkapitalSchnell(inp, 'nk'))}>Nebenkosten</Button>
              <Button size="compact-xs" variant="default" onClick={() => setzeInputs((inp) => eigenkapitalSchnell(inp, 'p10'))}>10 % vom KP</Button>
            </Group>
            <Text size="sm" mt={6}>Σ Fremdkapital: {Math.round(out.finanzierung.darlehensummeGesamt).toLocaleString('de-DE')} €</Text>
            {luecke !== 0 && <Alert color="orange" py={4} mt={4}>⚠️ Finanzierungslücke: {luecke.toLocaleString('de-DE')} € – EK oder Tranchen anpassen</Alert>}
            {i.darlehen.map((d, idx) => (
              <Group key={idx} gap={4} wrap="nowrap" mt={6}>
                <TextInput size="xs" style={{ flex: 1 }} aria-label="Tranche" value={d.label} onChange={(e) => { const label = e.currentTarget.value; setzeInputs((inp) => ({ ...inp, darlehen: inp.darlehen.map((x, j) => (j === idx ? { ...x, label } : x)) })); }} />
                <NumberInput size="xs" w={120} aria-label="Summe" suffix=" €" value={d.summe} onChange={(v) => setzeInputs((inp) => ({ ...inp, darlehen: inp.darlehen.map((x, j) => (j === idx ? { ...x, summe: typeof v === 'number' ? v : 0 } : x)) }))} {...ZAHL} />
                <NumberInput size="xs" w={80} aria-label="Zinssatz" suffix=" %" decimalScale={4} value={Math.round(d.zinssatz * 1e6) / 1e4} onChange={(v) => setzeInputs((inp) => ({ ...inp, darlehen: inp.darlehen.map((x, j) => (j === idx ? { ...x, zinssatz: (typeof v === 'number' ? v : 0) / 100 } : x)) }))} {...ZAHL} />
                <NumberInput size="xs" w={80} aria-label="Tilgung" suffix=" %" decimalScale={4} value={Math.round(d.tilgung * 1e6) / 1e4} onChange={(v) => setzeInputs((inp) => ({ ...inp, darlehen: inp.darlehen.map((x, j) => (j === idx ? { ...x, tilgung: (typeof v === 'number' ? v : 0) / 100 } : x)) }))} {...ZAHL} />
                <ActionIcon variant="subtle" color="red" aria-label="Tranche entfernen" disabled={i.darlehen.length <= 1} onClick={() => setzeInputs((inp) => ({ ...inp, darlehen: inp.darlehen.filter((_, j) => j !== idx) }))}><IconTrash size={14} /></ActionIcon>
              </Group>
            ))}
            <Group gap={4} mt={6}>
              <Text size="xs" c="dimmed">Tranche 1:</Text>
              {([['kp', '100 % KP'], ['kp_san', '100 % KP + Sanierung'], ['kp_nk', '100 % KP + Nebenkosten'], ['kp90', '90 % KP']] as const).map(([m, t]) => (
                <Button key={m} size="compact-xs" variant="default" onClick={() => setzeInputs((inp) => tranche1Schnell(inp, m))}>{t}</Button>
              ))}
            </Group>
            <Button size="xs" variant="light" mt={6} leftSection={<IconPlus size={14} />} onClick={() => setzeInputs((inp) => ({ ...inp, darlehen: [...inp.darlehen, { label: `Darlehen ${inp.darlehen.length + 1}`, summe: 0, zinssatz: 0.04, tilgung: 0.02 }] }))}>Tranche</Button>
          </Abschnitt>

          <Abschnitt titel="Miete, Wert & Steuer">
            <SimpleGrid cols={2} spacing="xs">
              <NumberInput label="Nettokaltmiete" suffix=" €/Mon." value={i.nettokaltmieteMonat} onChange={(v) => setzeFeld('nettokaltmieteMonat', v)} {...ZAHL} />
              <NumberInput label="Nicht umlagefähige Nebenkosten" suffix=" €/Mon." value={i.nichtUmlagefaehig} onChange={(v) => setzeFeld('nichtUmlagefaehig', v)} {...ZAHL} />
              <NumberInput label="Mietsteigerung" suffix=" %/J." decimalScale={4} value={pct('mieterhoehungJaehrlich')} onChange={(v) => setzeFeld('mieterhoehungJaehrlich', v)} {...ZAHL} />
              <NumberInput label="Wertsteigerung" suffix=" %/J." decimalScale={4} value={pct('wertsteigerungJaehrlich')} onChange={(v) => setzeFeld('wertsteigerungJaehrlich', v)} {...ZAHL} />
              <NumberInput label="AfA-Satz" suffix=" %/J." decimalScale={4} value={pct('afaSatz')} onChange={(v) => setzeFeld('afaSatz', v)} {...ZAHL} />
              <NumberInput label="Anteil Gebäude" suffix=" %" decimalScale={4} value={pct('anteilGebaeudeKaufpreis')} onChange={(v) => setzeFeld('anteilGebaeudeKaufpreis', v)} {...ZAHL} />
              <NumberInput label="Steuersatz" suffix=" %" decimalScale={4} value={pct('grenzsteuersatz')} onChange={(v) => setzeFeld('grenzsteuersatz', v)} {...ZAHL} />
              <NumberInput label="Betrachtungsdauer" suffix=" Jahre" value={i.betrachtungsdauerJahre ?? 10} onChange={(v) => setzeFeld('betrachtungsdauerJahre', v)} {...ZAHL} />
            </SimpleGrid>
          </Abschnitt>

          <Abschnitt titel="Bankgespräch: Kopf & Hinweise">
            <Stack gap="xs">
              <TextInput label="Projekt-Titel" value={k.projektTitel} onChange={(e) => { const projektTitel = e.currentTarget.value; setK((a) => ({ ...a, projektTitel })); }} />
              <HinweiseFeld hinweise={k.wertsteigerungBullets} setzen={(h) => setK((a) => ({ ...a, wertsteigerungBullets: h }))} />
              <Impressionen refs={k.bildRefs} dealId={start.dealId} setzen={(bildRefs) => setK((a) => ({ ...a, bildRefs }))} />
              <Checkbox label="Hinweise im PDF anzeigen" checked={k.wertsteigerungSichtbar} onChange={(e) => { const an = e.currentTarget.checked; setK((a) => ({ ...a, wertsteigerungSichtbar: an })); }} />
              <Textarea label="🔒 Intern (nicht im PDF)" autosize minRows={2} value={k.internNotiz} onChange={(e) => { const internNotiz = e.currentTarget.value; setK((a) => ({ ...a, internNotiz })); }} />
            </Stack>
          </Abschnitt>
        </Stack>

        <div style={{ position: 'sticky', top: 72, alignSelf: 'start' }}>
          <KkErgebnis out={out} dauer={i.betrachtungsdauerJahre ?? 10} />
        </div>
      </SimpleGrid>

      <Vorschau k={k} start={start} />
    </Stack>
  );
}

/** Der Server druckt den gespeicherten Stand; deshalb erst nach dem Speichern freigegeben. */
function PdfKnopf({ id, bereit }: { id: string; bereit: boolean }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const exportieren = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      const { datei, name } = await bankgespraechPdfLaden(id);
      const url = URL.createObjectURL(datei);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  };
  return (
    <>
      <Button size="sm" leftSection={<IconFileTypePdf size={16} />} loading={laeuft} disabled={!bereit} onClick={() => void exportieren()}>PDF</Button>
      {fehler && <Alert color="red" py={4} withCloseButton onClose={() => setFehler(null)}>{fehler}</Alert>}
    </>
  );
}

/** Live-Vorschau: dieselbe Vorlage und derselbe Payload-Bau wie der PDF-Export, aus dem aktuellen Bearbeitungsstand. */
function Vorschau({ k, start }: { k: Felder; start: Kundenkalkulation }) {
  const { data: einst } = useKundenkalkEinstellungen();
  const stand = useDeferredValue(k);
  const html = useMemo(() => {
    const p = bankgespraechPayload({ ...stand, scope: start.scope, createdAt: start.createdAt }, computeKKalk(stand.inputs), {
      heute: new Date(), ersteller: einst?.ersteller, disclaimer: einst?.disclaimer, bilder: dokumentBilder(stand.bildRefs).map(bildFuerVorschau),
    });
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${bankgespraechPreviewHtml(p)}</body></html>`;
  }, [stand, start.scope, start.createdAt, einst]);
  const rahmen = useRef<HTMLIFrameElement>(null);
  const [hoehe, setHoehe] = useState(1200);
  // Ohne Skripte im Rahmen (sandbox); die Höhe misst die Seite nach dem Laden
  const messen = () => {
    const h = rahmen.current?.contentDocument?.documentElement.scrollHeight;
    if (h) setHoehe(h + 4);
  };
  return (
    <Paper withBorder p="sm" component="section" aria-label="Bankgespräch-Vorschau" maw={880} w="100%" mx="auto">
      <Text ta="center" fw={600} mb="xs">📊 Live-Vorschau (entspricht der PDF-Ausgabe 1:1)</Text>
      <iframe ref={rahmen} title="Bankgespräch-Vorschau" sandbox="allow-same-origin" srcDoc={html} onLoad={messen} style={{ width: '100%', height: hoehe, border: 0, display: 'block' }} />
    </Paper>
  );
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <Paper withBorder p="sm" component="section" aria-label={titel}>
      <Title order={5} mb="xs">{titel}</Title>
      {children}
    </Paper>
  );
}

/** EK wird erst beim Verlassen übernommen: jede Änderung verschiebt Tranche 1. */
function EkFeld({ ek, anwenden }: { ek: number; anwenden: (v: number) => void }) {
  const [wert, setWert] = useState<number | string>(ek);
  useEffect(() => setWert(ek), [ek]);
  const uebernehmen = () => typeof wert === 'number' && wert !== ek && anwenden(wert);
  return (
    <NumberInput w={170} label="Eigenkapital" suffix=" €" value={wert} onChange={setWert} onBlur={uebernehmen} onKeyDown={(e) => e.key === 'Enter' && uebernehmen()} {...ZAHL} />
  );
}

function HinweiseFeld({ hinweise, setzen }: { hinweise: string[]; setzen: (h: string[]) => void }) {
  const [text, setText] = useState(hinweise.join('\n'));
  return (
    <Textarea label="Hinweise (eine Zeile je Hinweis)" autosize minRows={3} value={text} onChange={(e) => setText(e.currentTarget.value)} onBlur={() => setzen(hinweiseAusText(text))} />
  );
}

/** Impressionen fürs Bankgespräch: bis zu 9 Bilder aus den Objektfotos (alt: Foto-Picker der Kundenkalkulation). */
function Impressionen({ refs, dealId, setzen }: { refs: string[]; dealId: string; setzen: (r: string[]) => void }) {
  const { data: deal } = useDealDetail(dealId);
  const [auftrag, setAuftrag] = useState<AuswahlAuftrag | null>(null);
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>Impressionen ({refs.length}/9)</Text>
        <Button size="compact-xs" variant="default" onClick={() => setAuftrag({ titel: 'Impressionen', max: 9, vorauswahl: refs, fertig: setzen })}>Bilder auswählen</Button>
      </Group>
      {refs.length > 0 && (
        <SimpleGrid cols={5} spacing={4}>
          {dokumentBilder(refs).map((r) => <Image key={r} src={bildFuerVorschau(r)} h={48} fit="cover" radius="xs" alt="Impression" />)}
        </SimpleGrid>
      )}
      <BildAuswahl auftrag={auftrag} objektId={deal?.objekt.id ?? null} schliessen={() => setAuftrag(null)} />
    </Stack>
  );
}
