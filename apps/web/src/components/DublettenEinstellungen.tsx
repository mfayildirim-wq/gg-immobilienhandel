import type { DublettenPaarSicht, MergeVorschau } from '@gg/api-contract';
import { DUBLETTEN_KEINE, IGNORIEREN_LABEL } from '@gg/domain';
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Radio, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import {
  useDubletten, useDublettenIgnorieren, useDublettenIgnoriertLeeren, useMergeProtokoll, useMergeRueckgaengig, useMergeVorschau, useZusammenfuehren,
} from '../lib/api.ts';
import { zeitpunktDe } from '../lib/format.ts';

const TYP_LABEL = { makler: '🤝 Makler', objekt: '🏢 Objekt', deal: '📋 Deal' } as const;

/** 🔍 Dublettenprüfung (Einstellungen): Paare finden, vergleichen, zusammenführen, 24 h rückgängig. */
export function DublettenEinstellungen() {
  const { data: paare = [], isLoading, error, refetch } = useDubletten();
  const ignorieren = useDublettenIgnorieren();
  const ignoriertLeeren = useDublettenIgnoriertLeeren();
  const { data: protokoll = [] } = useMergeProtokoll();
  const rueckgaengig = useMergeRueckgaengig();
  const [paar, setPaar] = useState<DublettenPaarSicht | null>(null);
  const [tausch, setTausch] = useState(false);
  const zaehler = (typ: string) => paare.filter((p) => p.typ === typ).length;

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>🔍 Dublettenprüfung</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => void refetch()}>Neu suchen</Button>
          <Button size="xs" variant="subtle" onClick={() => ignoriertLeeren.mutate()}>Ignorierte wieder anzeigen</Button>
        </Group>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {!isLoading && paare.length === 0 && <Text size="sm" c="dimmed">{DUBLETTEN_KEINE}</Text>}
      {paare.length > 0 && (
        <Text size="xs" c="dimmed">Gefunden: <b>{zaehler('makler')}</b> Makler · <b>{zaehler('objekt')}</b> Objekte · <b>{zaehler('deal')}</b> Deals</Text>
      )}
      {paare.map((p) => (
        <Paper key={`${p.a.id}:${p.b.id}`} withBorder p="xs" data-dublette={`${p.a.id}:${p.b.id}`}>
          <Group gap="xs" mb={6}>
            <Text size="xs" fw={600} c="dimmed">{TYP_LABEL[p.typ]}</Text>
            <Badge size="xs" variant="outline" tt="none" color={p.sicherheit === 'exact' ? 'red' : 'orange'}>{p.sicherheit === 'exact' ? 'Exakt' : 'Unsicher'}</Badge>
            <Text size="xs" c="dimmed">{p.grund}</Text>
          </Group>
          <Text size="sm" mb={6}>{p.a.label} ↔ {p.b.label}</Text>
          <Group gap={6}>
            <Button size="compact-xs" onClick={() => { setPaar(p); setTausch(false); }}>Vergleichen & Zusammenführen</Button>
            <Button size="compact-xs" variant="default" onClick={() => ignorieren.mutate({ id1: p.a.id, id2: p.b.id })}>{IGNORIEREN_LABEL}</Button>
          </Group>
        </Paper>
      ))}

      {protokoll.length > 0 && (
        <>
          <Title order={5} mt="sm">Zuletzt zusammengeführt</Title>
          {protokoll.slice(0, 10).map((e) => (
            <Group key={e.id} justify="space-between" data-merge={e.id}>
              <Text size="xs" c="dimmed">
                {TYP_LABEL[e.typ as keyof typeof TYP_LABEL] ?? e.typ} · {zeitpunktDe(e.am)} · {e.betroffeneDeals} Deal(s)
                {e.rueckgaengigAm ? ' · zurückgenommen' : e.abgelaufen ? ' · Frist abgelaufen' : ''}
              </Text>
              {!e.rueckgaengigAm && !e.abgelaufen && (
                <Button size="compact-xs" variant="default" loading={rueckgaengig.isPending}
                  onClick={() => rueckgaengig.mutate({ id: e.id, erzwingen: false }, {
                    onError: (f) => { if ((f as { status?: number }).status === 409 && window.confirm(`${f.message}\n\nTrotzdem zurücknehmen?`)) rueckgaengig.mutate({ id: e.id, erzwingen: true }); },
                  })}>
                  ↩ Rückgängig
                </Button>
              )}
            </Group>
          ))}
        </>
      )}

      {paar && <MergeDialog paar={paar} tausch={tausch} tauschen={() => setTausch((t) => !t)} schliessen={() => setPaar(null)} />}
    </Stack>
  );
}

function MergeDialog({ paar, tausch, tauschen, schliessen }: { paar: DublettenPaarSicht; tausch: boolean; tauschen: () => void; schliessen: () => void }) {
  const primaerId = tausch ? paar.b.id : paar.a.id;
  const sekundaerId = tausch ? paar.a.id : paar.b.id;
  const { data: v, isLoading, error } = useMergeVorschau(paar.typ, primaerId, sekundaerId);
  const zusammenfuehren = useZusammenfuehren();
  const [felder, setFelder] = useState<Record<string, 'A' | 'B'>>({});
  const [listen, setListen] = useState<Record<string, 'A' | 'B' | 'union'>>({});

  return (
    <Modal opened onClose={schliessen} size="xl" title={`🔗 Zusammenführen: ${v?.primaerLabel ?? ''}`}>
      {isLoading && <Loader size="sm" />}
      {error && <Alert color="red">{error.message}</Alert>}
      {v && (
        <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm"><b>A (behalten):</b> {v.primaerLabel} · <b>B (aufgeben):</b> {v.sekundaerLabel}</Text>
            <Button size="compact-xs" variant="default" onClick={() => { setFelder({}); setListen({}); tauschen(); }}>⇄ Tauschen</Button>
          </Group>

          <Konflikte v={v} felder={felder} setFelder={setFelder} />

          {v.wahlListen.length > 0 && (
            <Paper withBorder p="xs" aria-label="Listen">
              <Text size="xs" fw={600} mb={4}>Listen</Text>
              {v.wahlListen.map((l) => (
                <Group key={l.name} gap="md" mb={4}>
                  <Text size="xs" style={{ width: 140 }}>{l.name} (A: {l.anzahlA} · B: {l.anzahlB})</Text>
                  <Radio.Group value={listen[l.name] ?? 'A'} onChange={(w) => setListen({ ...listen, [l.name]: w as 'A' | 'B' | 'union' })}>
                    <Group gap="sm">
                      <Radio size="xs" value="A" label="A behalten" />
                      <Radio size="xs" value="B" label="B behalten" />
                      <Radio size="xs" value="union" label="Beide vereinen" />
                    </Group>
                  </Radio.Group>
                </Group>
              ))}
            </Paper>
          )}

          <Alert color="orange" variant="light" py={6}>
            <Text size="xs">
              {v.vereinteListen.map((l) => `${l.name}: ${l.anzahlA + l.anzahlB} Einträge werden vereint`).join(' · ')}
              {v.dateienB > 0 && ` · ${v.dateienB} Datei(en) wechseln mit`}
              {paar.typ === 'makler' && ' · die KI-Zusammenfassung wird verworfen'}
              {' · '}Das Duplikat landet im Papierkorb, das Zusammenführen ist 24 Stunden rückgängig zu machen.
            </Text>
          </Alert>

          <Group justify="flex-end">
            <Button variant="default" onClick={schliessen}>Abbrechen</Button>
            <Button loading={zusammenfuehren.isPending}
              onClick={() => zusammenfuehren.mutate({ typ: paar.typ, primaerId, sekundaerId, felder, listen }, { onSuccess: schliessen })}>
              ✓ Zusammenführen
            </Button>
          </Group>
          {zusammenfuehren.error && <Alert color="red">{zusammenfuehren.error.message}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Konflikte({ v, felder, setFelder }: { v: MergeVorschau; felder: Record<string, 'A' | 'B'>; setFelder: (f: Record<string, 'A' | 'B'>) => void }) {
  const konflikte = v.felder.filter((f) => f.konflikt);
  const uebernommen = v.felder.filter((f) => !f.konflikt && f.wertB && !f.wertA);
  return (
    <>
      <Paper withBorder p="xs" aria-label="Konflikte">
        <Text size="xs" fw={600} mb={4}>Konflikte ({konflikte.length})</Text>
        {konflikte.length === 0 && <Text size="xs" c="dimmed">Keine widersprüchlichen Felder.</Text>}
        <Table verticalSpacing={2}>
          <Table.Tbody>
            {konflikte.map((f) => (
              <Table.Tr key={f.feld} data-konflikt={f.feld}>
                <Table.Td><Text size="xs" fw={600}>{f.feld}</Text></Table.Td>
                <Table.Td>
                  <Radio.Group value={felder[f.feld] ?? 'A'} onChange={(w) => setFelder({ ...felder, [f.feld]: w as 'A' | 'B' })}>
                    <Group gap="sm">
                      <Radio size="xs" value="A" label={f.wertA || '—'} />
                      <Radio size="xs" value="B" label={f.wertB || '—'} />
                    </Group>
                  </Radio.Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {uebernommen.length > 0 && (
        <Text size="xs" c="dimmed" data-uebernommen>
          Aus B übernommen (A ist leer): {uebernommen.map((f) => `${f.feld} = ${f.wertB}`).join(' · ')}
        </Text>
      )}
    </>
  );
}
