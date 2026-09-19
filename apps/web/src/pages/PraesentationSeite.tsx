import type { Praesentation, PraesentationFolie } from '@gg/api-contract';
import {
  ausEinstellungen, type FinanzPraes, finanzierungScope, finanzpraesCheckConsistency, folieVerschieben, leereFolie, SLIDE_TYPES,
} from '@gg/domain';
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, Paper, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton,
} from '@mantine/core';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconEye, IconEyeOff, IconFileTypePdf, IconPlus, IconPresentation, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { type AuswahlAuftrag, BildAuswahl } from '../components/praesentation/BildAuswahl.tsx';
import { FolienFormular, type Vorbelegung } from '../components/praesentation/FolienFormular.tsx';
import { FolienVorschau } from '../components/praesentation/FolienVorschau.tsx';
import { useAutomatischSpeichern } from '../lib/automatischSpeichern.ts';
import {
  dateiLaden, herunterladen, praesentationSpeichern, praesentationVorbelegen, useDealDetail, usePraesentation, usePraesentationLoeschen, usePraesentationStandard,
} from '../lib/api.ts';

type Stand = Pick<Praesentation, 'bankName' | 'internNotiz' | 'slides'>;

export function PraesentationSeite() {
  const { id } = useParams({ from: '/praesentationen/$id' });
  const { data, isLoading, error } = usePraesentation(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Präsentation nicht gefunden'}</Alert>;
  return <Editor key={data.id} start={data} />;
}

function Editor({ start }: { start: Praesentation }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: deal } = useDealDetail(start.dealId);
  const { data: standard } = usePraesentationStandard();
  const loeschen = usePraesentationLoeschen();
  const [stand, setStand] = useState<Stand>({ bankName: start.bankName, internNotiz: start.internNotiz, slides: start.slides });
  const [gewaehlt, setGewaehlt] = useState<string | null>(start.slides[0]?.id ?? null);
  const [auswahl, setAuswahl] = useState<AuswahlAuftrag | null>(null);
  const [hinweis, setHinweis] = useState<{ farbe: string; text: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [scopeFrage, setScopeFrage] = useState<((s: 'aufteiler' | 'global') => void) | null>(null);
  const [pruefung, setPruefung] = useState<ReturnType<typeof finanzpraesCheckConsistency> | null>(null);
  const [export_, setExport] = useState<'pdf' | 'pptx' | null>(null);

  const zustand = useAutomatischSpeichern(stand, { version: start.version, stand: { bankName: start.bankName, internNotiz: start.internNotiz, slides: start.slides } },
    (s, version) => praesentationSpeichern(start.id, { ...s, version }), (neu) => qc.setQueryData(['praesentation', start.id], neu));

  const breit = useMediaQuery('(min-width: 62em)');
  const praes: Praesentation = { ...start, ...stand };
  const folie = stand.slides.find((s) => s.id === gewaehlt) ?? null;
  const alsDomain = praes as unknown as FinanzPraes;
  const adresse = useMemo(() => deal ? [deal.objekt.titel, deal.objekt.stadt].filter(Boolean).join(', ') : '', [deal]);

  const folienAendern = (f: (slides: PraesentationFolie[]) => PraesentationFolie[]) => setStand((s) => ({ ...s, slides: f(s.slides) }));
  const datenSetzen = (folieId: string, data: Record<string, unknown>) => folienAendern((sl) => sl.map((x) => (x.id === folieId ? { ...x, data } : x)));

  const vorbelegen = async (art: Vorbelegung, spalten?: string[]) => {
    if (!folie) return;
    setHinweis(null);
    if ((art === 'organigramm' || art === 'abschluss') && standard) {
      datenSetzen(folie.id, ausEinstellungen(folie.data, art, standard));
      setHinweis({ farbe: 'teal', text: 'Aus Einstellungen geladen' });
      return;
    }
    const mitScope = async (scope?: 'aufteiler' | 'global') => {
      setLaeuft(true);
      try {
        const apiArt = art.startsWith('projektkalkulation') ? 'projektkalkulation' : art === 'finanzierung' ? 'finanzierung' : art;
        const r = await praesentationVorbelegen(start.id, { art: apiArt as 'deckblatt', data: folie.data, scope, spalten });
        if (r.data) { datenSetzen(folie.id, r.data); setHinweis({ farbe: 'teal', text: 'Aus Deal übernommen' }); }
        else setHinweis({ farbe: 'orange', text: r.hinweis ?? 'Nicht möglich' });
      } catch (e) {
        setHinweis({ farbe: 'red', text: (e as Error).message });
      } finally {
        setLaeuft(false);
      }
    };
    if (art === 'projektkalkulation-aufteiler') return mitScope('aufteiler');
    if (art === 'projektkalkulation-global') return mitScope('global');
    if (art === 'finanzierung') {
      // Scope der Projektkalkulation, sonst nachfragen (alt: confirm „OK = Aufteiler“)
      const scope = finanzierungScope(alsDomain);
      if (scope) return mitScope(scope);
      setScopeFrage(() => (s: 'aufteiler' | 'global') => void mitScope(s));
      return;
    }
    return mitScope();
  };

  const exportieren = async (art: 'pdf' | 'pptx') => {
    setHinweis(null);
    if (!stand.slides.some((s) => s.visible)) { setHinweis({ farbe: 'orange', text: 'Keine sichtbaren Slides — bitte mindestens eine Slide einblenden' }); return; }
    setExport(art);
    try {
      const { datei, name } = await dateiLaden(`/api/praesentationen/${start.id}/${art}`);
      herunterladen(datei, name);
    } catch (e) {
      setHinweis({ farbe: 'red', text: `${art.toUpperCase()}-Export fehlgeschlagen: ${(e as Error).message}` });
    } finally {
      setExport(null);
    }
  };

  const zurueck = () => navigate({ to: '/deals', search: { deal: start.dealId } });
  const gespeichert = zustand === 'gespeichert';

  return (
    <Stack maw={1600}>
      <Paper withBorder p="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 260 }}>
            <ActionIcon variant="subtle" aria-label="Zurück zum Deal" onClick={zurueck}><IconArrowLeft /></ActionIcon>
            <TextInput style={{ flex: 1 }} label="Bank" placeholder="z.B. Sparkasse Stuttgart" value={stand.bankName} onChange={(e) => { const bankName = e.currentTarget.value; setStand((s) => ({ ...s, bankName })); }} />
          </Group>
          <Group gap="xs">
            <Badge variant="light" color={typeof zustand === 'object' ? 'red' : gespeichert ? 'green' : 'gray'} aria-label="Speicherstand">
              {typeof zustand === 'object' ? 'nicht gespeichert' : gespeichert ? 'gespeichert' : 'speichert …'}
            </Badge>
            <Tooltip label="Prüft ob Werte zwischen Slides übereinstimmen (GIK, EM, FM, Verkaufserlöse)">
              <Button variant="default" leftSection={<IconSearch size={16} />} onClick={() => setPruefung(finanzpraesCheckConsistency(alsDomain))}>Check</Button>
            </Tooltip>
            <Button leftSection={<IconFileTypePdf size={16} />} disabled={!gespeichert} loading={export_ === 'pdf'} onClick={() => void exportieren('pdf')}>PDF</Button>
            <Button variant="light" leftSection={<IconPresentation size={16} />} disabled={!gespeichert} loading={export_ === 'pptx'} onClick={() => void exportieren('pptx')}>PowerPoint</Button>
            <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => {
              if (!window.confirm('Komplette Präsentation wirklich löschen?\n\nSie liegt danach im Papierkorb.')) return;
              loeschen.mutate(start.id, { onSuccess: zurueck });
            }}>Löschen</Button>
          </Group>
        </Group>
      </Paper>
      {typeof zustand === 'object' && <Alert color="red" title="Nicht gespeichert">{zustand.fehler} – Seite neu laden, um den aktuellen Stand zu holen.</Alert>}
      {hinweis && <Alert color={hinweis.farbe} withCloseButton onClose={() => setHinweis(null)} py={6}>{hinweis.text}</Alert>}

      <div style={{ display: 'grid', gap: 'var(--mantine-spacing-md)', gridTemplateColumns: breit ? '280px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
        <Paper withBorder p="xs" component="nav" aria-label="Folien">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">Slides ({stand.slides.length})</Text>
            <Menu position="bottom-end" width={280}>
              <Menu.Target><Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} />}>Slide</Button></Menu.Target>
              <Menu.Dropdown>
                <ScrollArea.Autosize mah={420}>
                  {SLIDE_TYPES.map((m) => (
                    <Menu.Item key={m.typ} leftSection={<span>{m.icon}</span>} onClick={() => {
                      if (!standard) return;
                      const neu = leereFolie(m.typ, standard, crypto.randomUUID());
                      folienAendern((sl) => [...sl, neu]);
                      setGewaehlt(neu.id);
                    }}>
                      <Text size="sm">{m.label}</Text><Text size="xs" c="dimmed">{m.beschreibung}</Text>
                    </Menu.Item>
                  ))}
                </ScrollArea.Autosize>
              </Menu.Dropdown>
            </Menu>
          </Group>
          {stand.slides.length === 0 && <Text c="dimmed" size="sm" ta="center" py="lg">Noch keine Slides. Mit „+ Slide“ hinzufügen.</Text>}
          <Stack gap={4}>
            {stand.slides.map((s, i) => {
              const meta = SLIDE_TYPES.find((m) => m.typ === s.typ);
              const aktiv = s.id === gewaehlt;
              return (
                <Paper key={s.id} withBorder p={4} bg={aktiv ? 'var(--mantine-primary-color-light)' : undefined} style={{ opacity: s.visible ? 1 : 0.5 }}>
                  <Group gap={4} wrap="nowrap">
                    <UnstyledButton style={{ flex: 1, minWidth: 0 }} onClick={() => setGewaehlt(s.id)} aria-current={aktiv ? 'true' : undefined} aria-label={`Folie ${i + 1}: ${meta?.label ?? s.typ}`}>
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" c="dimmed" w={16} ta="right">{i + 1}</Text>
                        <span>{meta?.icon ?? '📄'}</span>
                        <Text size="sm" fw={aktiv ? 600 : 400} truncate>{meta?.label ?? s.typ}</Text>
                      </Group>
                    </UnstyledButton>
{aktiv && (<>
                    <ActionIcon size="sm" variant="subtle" aria-label="Eine Position nach oben" disabled={i === 0} onClick={() => folienAendern((sl) => folieVerschieben(sl as never, s.id, -1) as never)}><IconArrowUp size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" aria-label="Eine Position nach unten" disabled={i === stand.slides.length - 1} onClick={() => folienAendern((sl) => folieVerschieben(sl as never, s.id, 1) as never)}><IconArrowDown size={14} /></ActionIcon>

                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Slide löschen" onClick={() => {
                      if (!window.confirm('Slide wirklich löschen?')) return;
                      const rest = stand.slides.filter((x) => x.id !== s.id);
                      folienAendern(() => rest);
                      if (gewaehlt === s.id) setGewaehlt(rest[0]?.id ?? null);
                    }}><IconTrash size={14} /></ActionIcon>
                    </>)}
                    <ActionIcon size="sm" variant="subtle" aria-label={s.visible ? 'Im Export sichtbar — ausblenden' : 'Ausgeblendet — anzeigen'} onClick={() => folienAendern((sl) => sl.map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)))}>
                      {s.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                    </ActionIcon>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        </Paper>

        <Stack gap="md" style={{ minWidth: 0 }}>
          <Paper withBorder p="md" component="section" aria-label="Folie bearbeiten">
            {folie ? (
              <FolienFormular key={folie.id} typ={folie.typ} c={{
                data: folie.data, setzen: (d) => datenSetzen(folie.id, d), bildWaehlen: setAuswahl, vorbelegen: (a, sp) => void vorbelegen(a, sp), adresse, laeuft,
              }} />
            ) : <Text c="dimmed" ta="center" py="xl">{stand.slides.length ? 'Wähle links eine Slide aus.' : 'Füge links eine Slide hinzu, um sie hier zu bearbeiten.'}</Text>}
          </Paper>
          <FolienVorschau praes={praes} folieId={gewaehlt} standard={standard} />
        </Stack>
      </div>

      <BildAuswahl auftrag={auswahl} objektId={deal?.objekt.id ?? null} praes={praes} schliessen={() => setAuswahl(null)} />

      <Modal opened={!!scopeFrage} onClose={() => setScopeFrage(null)} title="Finanzierung übernehmen">
        <Text size="sm">Soll die Finanzierung auf der Aufteiler- oder der Global-Kalkulation basieren?</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => { scopeFrage?.('global'); setScopeFrage(null); }}>Global</Button>
          <Button onClick={() => { scopeFrage?.('aufteiler'); setScopeFrage(null); }}>Aufteiler</Button>
        </Group>
      </Modal>

      <Modal opened={!!pruefung} onClose={() => setPruefung(null)} title="🔍 Konsistenz-Check" size="lg">
        {pruefung && (
          <Stack gap="xs">
            <Text fw={600} c={pruefung.length === 0 ? 'teal' : pruefung.some((p) => p.severity === 'error') ? 'red' : 'orange'}>
              {pruefung.length === 0 ? '✅ Alle Slides konsistent' : `⚠️ ${pruefung.filter((p) => p.severity === 'error').length} Fehler, ${pruefung.filter((p) => p.severity === 'warning').length} Warnung(en)`}
            </Text>
            {pruefung.length === 0 && <Text size="sm" c="dimmed">Alle Werte zwischen den Slides sind übereinstimmend. Keine Finanzierungslücke. Keine widersprüchlichen Beträge.</Text>}
            {pruefung.map((p, i) => (
              <Alert key={i} color={p.severity === 'error' ? 'red' : p.severity === 'warning' ? 'orange' : 'blue'} py={6}>{p.message}</Alert>
            ))}
            <Text size="xs" c="dimmed">Tipp: „Aus Deal-Kalkulation übernehmen“ auf der jeweiligen Slide synchronisiert die Werte.</Text>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

