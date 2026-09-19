import type { Begleitschein, BsAktionErgebnis, BsZeile } from '@gg/api-contract';
import {
  BS_ABSCHLUSS_ID, BS_STATUS_FARBE, BS_STATUS_TEXTFARBE, bsAktionenFuer, bsNewId, bsVerschieben, bsZaehler, bsZeileEinfuegen, bsZeileLoeschen, type BsRow, type BsStatus,
} from '@gg/domain';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Table, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconIndentIncrease, IconPlus, IconX } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ebeneStil, StatusWahl } from '../components/begleitschein/farben.tsx';
import { useAutomatischSpeichern } from '../lib/automatischSpeichern.ts';
import { begleitscheinAktion, begleitscheinSpeichern, useBegleitschein } from '../lib/api.ts';

type Stand = { kopf: string; rows: BsZeile[] };

export function BegleitscheinSeite() {
  const { id } = useParams({ from: '/begleitscheine/$id' });
  const { data, isLoading, error } = useBegleitschein(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Begleitschein nicht gefunden'}</Alert>;
  return <Arbeitsflaeche key={data.id} start={data} />;
}

/** Freitext, der erst beim Verlassen übernommen wird (alt: contenteditable + onblur). */
function Freitext({ wert, setzen, label, fett, minRows = 1 }: { wert: string; setzen: (t: string) => void; label: string; fett?: boolean; minRows?: number }) {
  const [t, setT] = useState(wert);
  const [basis, setBasis] = useState(wert);
  if (wert !== basis) { setBasis(wert); setT(wert); }
  return (
    <Textarea variant="unstyled" aria-label={label} autosize minRows={minRows} value={t} onChange={(e) => setT(e.currentTarget.value)} onBlur={() => t.trim() !== wert && setzen(t.trim())}
      styles={{ input: { color: 'inherit', fontWeight: fett ? 700 : undefined, padding: 0, minHeight: 0, fontSize: 13 } }} />
  );
}

function Arbeitsflaeche({ start }: { start: Begleitschein }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stand, setStand] = useState<Stand>({ kopf: start.kopf, rows: start.rows });
  const [archiviert, setArchiviert] = useState(!!start.archiviertAm);
  const [anzeige, setAnzeige] = useState<Extract<BsAktionErgebnis, { art: 'anzeige' }> | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const zustand = useAutomatischSpeichern(stand, { version: start.version, stand: { kopf: start.kopf, rows: start.rows } },
    (s, version) => begleitscheinSpeichern(start.id, { ...s, version }), (neu) => {
      setArchiviert(!!neu.archiviertAm);
      qc.setQueryData(['begleitschein', start.id], neu);
      void qc.invalidateQueries({ queryKey: ['begleitscheine'] });
    }, 300);

  const zeilen = (f: (rows: BsRow[]) => BsRow[]) => setStand((s) => ({ ...s, rows: f(s.rows as BsRow[]) as BsZeile[] }));
  const zeile = (id: string, f: (r: BsRow) => BsRow) => zeilen((rows) => rows.map((r) => (r.id === id ? f(r) : r)));
  const z = bsZaehler(stand.rows as BsRow[]);

  const ausfuehren = async (aktionId: string) => {
    setMeldung(null);
    try {
      const e = await begleitscheinAktion(start.id, aktionId);
      if (e.art === 'fehler') setMeldung(e.meldung);
      else if (e.art === 'link') window.open(e.url, '_blank', 'noopener,noreferrer');
      else if (e.art === 'mail') window.location.href = e.href;
      else if (e.art === 'anzeige') setAnzeige(e);
      else if (e.art === 'modul') springen(e.modul, e.dealId);
    } catch (err) {
      setMeldung((err as Error).message);
    }
  };
  const springen = (modul: string, dealId?: string) => {
    const reiter: Record<string, string> = { 'deal-kalkulation': 'kalkulation', 'deal-kundenkalk': 'kundenkalkulation', 'deal-finanzpraes': 'praesentation' };
    if (dealId && reiter[modul]) {
      try { localStorage.setItem('gg.deal.reiter', reiter[modul]); } catch { /* nur Komfort */ }
      void navigate({ to: '/deals', search: { deal: dealId } });
      return;
    }
    const ziel: Record<string, string> = { objekte: '/objekte', deals: '/deals', kkalk: '/kundenkalkulationen', ankauf: '/', makler: '/makler', vertriebslisten: '/vertriebslisten' };
    if (ziel[modul]) void navigate({ to: ziel[modul] as '/' });
    else setMeldung('Dieses Modul gibt es im Neubau noch nicht.');
  };

  const knoepfe = (rowId: string, subId?: string) => bsAktionenFuer(start.aktionen as never, rowId, subId).map((a) => (
    <Button key={a.id} size="compact-xs" variant="default" onClick={() => void ausfuehren(a.id)}>{a.label}</Button>
  ));

  const kachel = (label: string, wert: number, bg: string, fg: string) => (
    <Paper key={label} p="xs" miw={96} ta="center" style={{ background: bg, color: fg }} aria-label={`${label}: ${wert}`}>
      <Text fz={19} fw={700} lh={1.1}>{wert}</Text><Text size="xs">{label}</Text>
    </Paper>
  );

  return (
    <Stack maw={1400}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ActionIcon variant="subtle" aria-label="Zur Übersicht" onClick={() => navigate({ to: '/begleitscheine' })}><IconArrowLeft /></ActionIcon>
          <Title order={3} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{start.name}</Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {archiviert && <Badge color="green" variant="filled">archiviert</Badge>}
          <Badge variant="light" color={typeof zustand === 'object' ? 'red' : zustand === 'gespeichert' ? 'green' : 'gray'} aria-label="Speicherstand">
            {typeof zustand === 'object' ? 'nicht gespeichert' : zustand === 'gespeichert' ? 'gespeichert' : 'speichert …'}
          </Badge>
        </Group>
      </Group>
      {typeof zustand === 'object' && <Alert color="red" title="Nicht gespeichert">{zustand.fehler} – Seite neu laden, um den aktuellen Stand zu holen.</Alert>}
      {meldung && <Alert color="orange" withCloseButton onClose={() => setMeldung(null)} py={6}>{meldung}</Alert>}

      <Paper withBorder p="xs"><Freitext label="Kopfbereich" wert={stand.kopf} minRows={2} setzen={(kopf) => setStand((s) => ({ ...s, kopf }))} /></Paper>

      <Group gap="xs" aria-label="Zähler">
        {kachel('Summe', z.summe, 'var(--mantine-color-default-hover)', 'inherit')}
        {kachel('Offen', z.offen, BS_STATUS_FARBE.offen, BS_STATUS_TEXTFARBE.offen)}
        {kachel('In Progress', z.inProgress, BS_STATUS_FARBE['In Progress'], BS_STATUS_TEXTFARBE['In Progress'])}
        {kachel('Erledigt', z.erledigt, BS_STATUS_FARBE.erledigt, BS_STATUS_TEXTFARBE.erledigt)}
      </Group>

      <Table.ScrollContainer minWidth={820}>
        <Table aria-label="Punkte des Begleitscheins" verticalSpacing={6} style={{ borderCollapse: 'collapse' }}>
          <Table.Thead>
            <Table.Tr><Table.Th>Punkt</Table.Th><Table.Th w={130}>Verantwortung</Table.Th><Table.Th w={190}>Aktion</Table.Th><Table.Th w={130}>Status</Table.Th><Table.Th w={110} /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(stand.rows as BsRow[]).map((r) => (
              <Table.Tr key={r.id} style={{ ...ebeneStil(r.lvl), verticalAlign: 'top' }} data-zeile={r.id}>
                <Table.Td>
                  <div style={{ paddingLeft: (r.lvl - 1) * 18 }}>
                    <Freitext label="Punkt" fett={r.lvl === 1} wert={r.text} setzen={(text) => zeile(r.id, (x) => ({ ...x, text }))} />
                    {r.sub.map((s) => (
                      <Group key={s.id} gap={6} wrap="nowrap" mt={4} pl={14} style={{ borderLeft: '2px solid rgba(0,0,0,.25)' }}>
                        <div style={{ flex: 1 }}><Freitext label="Unterpunkt" wert={s.text} setzen={(text) => zeile(r.id, (x) => ({ ...x, sub: x.sub.map((y) => (y.id === s.id ? { ...y, text } : y)) }))} /></div>
                        {knoepfe(r.id, s.id)}
                        <div style={{ width: 110, flex: 'none' }}><StatusWahl label="Status Unterpunkt" wert={s.status} aendern={(status) => zeile(r.id, (x) => ({ ...x, sub: x.sub.map((y) => (y.id === s.id ? { ...y, status } : y)) }))} /></div>
                        <ActionIcon size="xs" variant="subtle" color="red" aria-label="Unterpunkt löschen" onClick={() => zeile(r.id, (x) => ({ ...x, sub: x.sub.filter((y) => y.id !== s.id) }))}><IconX size={12} /></ActionIcon>
                      </Group>
                    ))}
                    {!r.fix && (
                      <Button size="compact-xs" variant="transparent" c="inherit" opacity={0.7} leftSection={<IconPlus size={12} />} mt={2}
                        onClick={() => zeile(r.id, (x) => ({ ...x, sub: [...x.sub, { id: bsNewId('s'), text: '', status: 'offen' as BsStatus }] }))}>Unterpunkt</Button>
                    )}
                  </div>
                </Table.Td>
                <Table.Td><Freitext label="Verantwortung" wert={r.verantwortung} setzen={(verantwortung) => zeile(r.id, (x) => ({ ...x, verantwortung }))} /></Table.Td>
                <Table.Td><Group gap={4}>{knoepfe(r.id)}</Group></Table.Td>
                <Table.Td><StatusWahl label={r.id === BS_ABSCHLUSS_ID ? 'Status Abschluss' : 'Status'} wert={r.status} aendern={(status) => zeile(r.id, (x) => ({ ...x, status }))} /></Table.Td>
                <Table.Td>
                  {!r.fix && (
                    <Group gap={0} wrap="nowrap">
                      <Tooltip label="nach oben"><ActionIcon size="sm" variant="subtle" c="inherit" aria-label="Punkt nach oben" onClick={() => zeilen((rows) => bsVerschieben(rows, r.id, -1))}><IconArrowUp size={14} /></ActionIcon></Tooltip>
                      <Tooltip label="nach unten"><ActionIcon size="sm" variant="subtle" c="inherit" aria-label="Punkt nach unten" onClick={() => zeilen((rows) => bsVerschieben(rows, r.id, 1))}><IconArrowDown size={14} /></ActionIcon></Tooltip>
                      <Tooltip label="Ebene"><ActionIcon size="sm" variant="subtle" c="inherit" aria-label="Ebene wechseln" onClick={() => zeile(r.id, (x) => ({ ...x, lvl: ((x.lvl % 3) + 1) as 1 | 2 | 3 }))}><IconIndentIncrease size={14} /></ActionIcon></Tooltip>
                      <Tooltip label="löschen"><ActionIcon size="sm" variant="subtle" color="red" aria-label="Punkt löschen" onClick={() => (!r.text || window.confirm('Punkt löschen?')) && zeilen((rows) => bsZeileLoeschen(rows, r.id))}><IconX size={14} /></ActionIcon></Tooltip>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group gap="xs">
        {([1, 2, 3] as const).map((l) => <Button key={l} size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => zeilen((rows) => bsZeileEinfuegen(rows, null, l))}>Punkt Ebene {l}</Button>)}
      </Group>

      <Modal opened={!!anzeige} onClose={() => setAnzeige(null)} title={anzeige?.titel} size="lg">
        {anzeige && (
          <Stack gap="xs">
            {anzeige.hinweis && <Text size="sm" c="dimmed">{anzeige.hinweis}</Text>}
            {anzeige.tabelle && (
              <Table striped fz="sm"><Table.Tbody>{anzeige.tabelle.map(([k, v], i) => <Table.Tr key={i}><Table.Td c="dimmed">{k}</Table.Td><Table.Td ta="right" fw={600}>{v}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
            )}
            {anzeige.text !== undefined && <Paper withBorder p="sm"><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{anzeige.text}</Text></Paper>}
            {anzeige.datei && <Text size="sm">Hinterlegte Datei: <b>{anzeige.datei}</b></Text>}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
