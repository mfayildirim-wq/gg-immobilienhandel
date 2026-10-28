import type { RechercheLauf, RechercheZeile } from '@gg/api-contract';
import { RECHERCHE_FELDER, RECHERCHE_QUELLEN, RECHERCHE_STATUS, type RechercheQuelle, type RechercheStatus } from '@gg/domain';
import {
  Alert, Anchor, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Progress, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  useRechercheAbbrechen, useRechercheEntscheiden, useRechercheGesehen, useRechercheLauf, useRechercheMakler, useRechercheSchaetzung, useRechercheStand,
  useRechercheStarten, useRechercheUebernehmen, useRechercheZeilen,
} from '../lib/api.ts';
import { datumDe, zeitpunktDe } from '../lib/format.ts';

const euroGenau = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const STATUS_FARBE: Record<string, string> = { gefunden: 'green', nicht_genannt: 'orange', nichts_gefunden: 'gray', fehler: 'red', laeuft: 'blue', wartet: 'blue', abgebrochen: 'gray' };
const FELD_LABEL: Record<string, string> = { ...RECHERCHE_FELDER.makler, ...RECHERCHE_FELDER.unternehmen };

type Filter = { suche: string; webseite: string; immoscout: string; status: string };
const FILTER_LEER: Filter = { suche: '', webseite: 'alle', immoscout: 'alle', status: 'alle' };

function Adresse({ a, art }: { a: RechercheZeile['webseite']; art: string }) {
  if (!a) return <Text size="xs" c="dimmed">–</Text>;
  return (
    <Stack gap={0}>
      <Anchor href={a.url} target="_blank" rel="noreferrer" size="xs" data-recherche-link={art}>{art === 'immoscout' ? 'Profil' : host(a.url)} ↗</Anchor>
      <Text size="10px" c="dimmed">{RECHERCHE_QUELLEN[a.quelle as RechercheQuelle] ?? a.quelle}</Text>
    </Stack>
  );
}

/** 🔎 Makler-Recherche (21.10.2026): Webseite und ImmoScout-Profil lesen, Vorschläge prüfen und übernehmen. */
export function MaklerRechercheEinstellungen() {
  const { data: zeilen = [], isLoading, error } = useRechercheZeilen();
  const { data: lauf } = useRechercheLauf();
  const gesehen = useRechercheGesehen();
  const uebernehmen = useRechercheUebernehmen();
  const [filter, setFilter] = useState<Filter>(FILTER_LEER);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [offen, setOffen] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  // Wer die Seite ansieht, hat das Ergebnis gesehen: Glocke aus
  useEffect(() => { if (lauf?.ungesehen) gesehen.mutate(lauf.id); }, [lauf?.id, lauf?.ungesehen]); // eslint-disable-line react-hooks/exhaustive-deps

  const sichtbar = useMemo(() => zeilen.filter((z) => {
    const s = filter.suche.trim().toLowerCase();
    if (s && !`${z.name ?? ''} ${z.firma ?? ''}`.toLowerCase().includes(s)) return false;
    if (filter.webseite !== 'alle' && (filter.webseite === 'ja') !== !!z.webseite) return false;
    if (filter.immoscout !== 'alle' && (filter.immoscout === 'ja') !== !!z.immoscout) return false;
    if (filter.status === 'nie' && z.letzteRecherche) return false;
    if (filter.status === 'vorschlaege' && !z.offeneVorschlaege) return false;
    if (!['alle', 'nie', 'vorschlaege'].includes(filter.status) && z.status !== filter.status) return false;
    return true;
  }), [zeilen, filter]);

  const alleSichtbarGewaehlt = sichtbar.length > 0 && sichtbar.every((z) => gewaehlt.has(z.id));
  const umschalten = (id: string) => setGewaehlt((g) => { const n = new Set(g); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const auswahl = [...gewaehlt];
  const mitVorschlaegen = zeilen.filter((z) => gewaehlt.has(z.id) && z.offeneVorschlaege > 0).map((z) => z.id);
  const laeuft = lauf?.status === 'laeuft';

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>🔎 Makler-Recherche</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={!mitVorschlaegen.length || uebernehmen.isPending} data-recherche-alle-uebernehmen
            onClick={() => uebernehmen.mutate(mitVorschlaegen, { onSuccess: (r) => setMeldung(`${r.uebernommen} Vorschläge übernommen${r.fehler.length ? ` — ${r.fehler.length} Makler mit Fehler (z. B. geändert): ${r.fehler[0]}` : ''}.`) })}>
            Vorschläge der Ausgewählten übernehmen ({mitVorschlaegen.length})
          </Button>
          <Button size="xs" disabled={!auswahl.length || laeuft} onClick={() => setDialog(true)} data-recherche-start>
            Recherche starten ({auswahl.length})
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        Je Makler: Firmen-Webseite lesen (bekannt oder aus der E-Mail-Domain), sonst das ImmoScout-Profil (aus dem Firmennamen), auf Wunsch die
        KI-Websuche. Gefundenes erscheint als Vorschlag — übernommen wird nur, was Sie anklicken. Adressen bleiben für die nächsten Läufe gespeichert.
      </Text>

      <LaufStand lauf={lauf ?? null} />
      {meldung && <Alert color="green" withCloseButton onClose={() => setMeldung(null)}>{meldung}</Alert>}
      {error && <Alert color="red">{error.message}</Alert>}

      <Group gap="xs" align="end">
        <TextInput size="xs" label="Suche" placeholder="Name oder Firma" value={filter.suche} onChange={(e) => setFilter({ ...filter, suche: e.currentTarget.value })} />
        <Select size="xs" label="Webseite" w={110} data={[{ value: 'alle', label: 'alle' }, { value: 'ja', label: 'vorhanden' }, { value: 'nein', label: 'keine' }]}
          value={filter.webseite} onChange={(v) => setFilter({ ...filter, webseite: v ?? 'alle' })} allowDeselect={false} />
        <Select size="xs" label="ImmoScout" w={110} data={[{ value: 'alle', label: 'alle' }, { value: 'ja', label: 'vorhanden' }, { value: 'nein', label: 'keins' }]}
          value={filter.immoscout} onChange={(v) => setFilter({ ...filter, immoscout: v ?? 'alle' })} allowDeselect={false} />
        <Select size="xs" label="Status" w={170} allowDeselect={false} value={filter.status} onChange={(v) => setFilter({ ...filter, status: v ?? 'alle' })}
          data={[{ value: 'alle', label: 'alle' }, { value: 'nie', label: 'nie geprüft' }, { value: 'vorschlaege', label: 'mit offenen Vorschlägen' },
            ...(['gefunden', 'nicht_genannt', 'nichts_gefunden', 'fehler'] as const).map((s) => ({ value: s, label: RECHERCHE_STATUS[s] }))]} />
        <Text size="xs" c="dimmed">{sichtbar.length} von {zeilen.length} · {gewaehlt.size} ausgewählt</Text>
        {gewaehlt.size > 0 && <Button size="compact-xs" variant="subtle" onClick={() => setGewaehlt(new Set())}>Auswahl leeren</Button>}
      </Group>

      {isLoading && <Loader size="sm" />}
      <Table striped highlightOnHover withTableBorder fz="xs" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={30}>
              <Checkbox size="xs" aria-label="Alle sichtbaren auswählen" checked={alleSichtbarGewaehlt} indeterminate={!alleSichtbarGewaehlt && sichtbar.some((z) => gewaehlt.has(z.id))}
                onChange={() => setGewaehlt((g) => { const n = new Set(g); for (const z of sichtbar) if (alleSichtbarGewaehlt) n.delete(z.id); else n.add(z.id); return n; })} />
            </Table.Th>
            <Table.Th>Makler</Table.Th><Table.Th>Firma</Table.Th><Table.Th>Webseite</Table.Th><Table.Th>ImmoScout</Table.Th>
            <Table.Th>Person gefunden</Table.Th><Table.Th>Letzte Recherche</Table.Th><Table.Th>Status</Table.Th><Table.Th>Vorschläge</Table.Th><Table.Th ta="right">Kosten</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sichtbar.map((z) => (
            <Fragment key={z.id}>
              <Table.Tr data-recherche-zeile={z.id} style={{ cursor: 'pointer' }} onClick={() => setOffen(offen === z.id ? null : z.id)}>
                <Table.Td onClick={(e) => e.stopPropagation()}><Checkbox size="xs" aria-label={`${z.name ?? 'Makler'} auswählen`} checked={gewaehlt.has(z.id)} onChange={() => umschalten(z.id)} /></Table.Td>
                <Table.Td><Text size="xs" fw={600}>{z.name ?? '–'}</Text>{z.prio && <Text size="10px" c="dimmed">Prio {z.prio}</Text>}</Table.Td>
                <Table.Td>{z.firma ?? '–'}</Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}><Adresse a={z.webseite} art="webseite" /></Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}><Adresse a={z.immoscout} art="immoscout" /></Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  {z.personUrl ? <Anchor href={z.personUrl} target="_blank" rel="noreferrer" size="xs">✓ {new URL(z.personUrl).pathname} ↗</Anchor> : z.letzteRecherche ? '✗' : '–'}
                </Table.Td>
                <Table.Td>{z.letzteRecherche ? datumDe(z.letzteRecherche) : '–'}</Table.Td>
                <Table.Td>{z.status ? <Badge size="xs" variant="light" color={STATUS_FARBE[z.status] ?? 'gray'} tt="none">{RECHERCHE_STATUS[z.status as RechercheStatus] ?? z.status}</Badge> : <Text size="xs" c="dimmed">offen</Text>}</Table.Td>
                <Table.Td>{z.offeneVorschlaege ? <Badge size="xs" color="yellow" variant="filled" tt="none" data-recherche-vorschlaege={z.offeneVorschlaege}>{z.offeneVorschlaege} offen</Badge> : '–'}</Table.Td>
                <Table.Td ta="right">{z.kostenEur ? euroGenau(z.kostenEur) : '–'}</Table.Td>
              </Table.Tr>
              {offen === z.id && (
                <Table.Tr><Table.Td colSpan={10} p={0}><MaklerRechercheDetail maklerId={z.id} name={z.name} /></Table.Td></Table.Tr>
              )}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
      {!isLoading && sichtbar.length === 0 && <Text size="sm" c="dimmed">Keine Makler für diesen Filter.</Text>}
      {sichtbar.length > 0 && <Text size="xs" c="dimmed" ta="right">Kosten bisher gesamt: {euroGenau(zeilen.reduce((s, z) => s + z.kostenEur, 0))}</Text>}

      <StartDialog offen={dialog} maklerIds={auswahl} onClose={() => setDialog(false)} onGestartet={() => { setDialog(false); setGewaehlt(new Set()); }} />
    </Stack>
  );
}

/** Fortschritt des laufenden Laufs bzw. Ergebnis des letzten. */
function LaufStand({ lauf }: { lauf: RechercheLauf | null }) {
  const abbrechen = useRechercheAbbrechen();
  if (!lauf) return null;
  const text = `${lauf.erledigt} von ${lauf.anzahl} · ${lauf.gefunden} gefunden${lauf.fehler ? ` · ${lauf.fehler} Fehler` : ''} · Kosten ${euroGenau(lauf.kostenEur)}${lauf.mitKi ? ' · mit KI-Websuche' : ''}`;
  if (lauf.status === 'laeuft') {
    return (
      <Paper withBorder p="xs" data-recherche-lauf="laeuft">
        <Group justify="space-between" mb={4}>
          <Text size="sm" fw={600}>Recherche läuft … {text}</Text>
          <Button size="compact-xs" color="red" variant="light" loading={abbrechen.isPending} onClick={() => abbrechen.mutate(lauf.id)}>Abbrechen</Button>
        </Group>
        <Progress value={lauf.anzahl ? (lauf.erledigt / lauf.anzahl) * 100 : 0} animated />
        <Text size="xs" c="dimmed" mt={4}>Läuft im Hintergrund weiter, solange die App in einem Fenster offen ist — auch auf anderen Seiten. Fertig: 🔔 bei Einstellungen.</Text>
      </Paper>
    );
  }
  return (
    <Text size="xs" c="dimmed" data-recherche-lauf={lauf.status}>
      Letzter Lauf {zeitpunktDe(lauf.gestartetAm)}: {lauf.status === 'abgebrochen' ? 'abgebrochen' : 'fertig'} — {text}
    </Text>
  );
}

function StartDialog({ offen, maklerIds, onClose, onGestartet }: { offen: boolean; maklerIds: string[]; onClose: () => void; onGestartet: () => void }) {
  const [mitKi, setMitKi] = useState(false);
  const { data: s, isFetching } = useRechercheSchaetzung(offen ? { maklerIds, mitKi } : null);
  const starten = useRechercheStarten();
  return (
    <Modal opened={offen} onClose={onClose} title="Recherche starten" size="md">
      <Stack gap="sm">
        {s ? (
          <Text size="sm">
            <b>{s.anzahl}</b> Makler ausgewählt — <b>{s.mitWebseite}</b> mit Webseite (bekannt oder aus der E-Mail), <b>{s.ohneWebseite}</b> ohne.
          </Text>
        ) : <Loader size="xs" />}
        <Checkbox label="Mit KI-Websuche nachsuchen (nur wo Webseite und ImmoScout nichts ergeben)" checked={mitKi} onChange={(e) => setMitKi(e.currentTarget.checked)} data-recherche-mit-ki />
        {s && (
          <Alert color={s.warnung ? 'red' : 'gray'} variant={s.warnung ? 'filled' : 'light'} data-recherche-kosten={s.warnung ? 'warnung' : 'ok'}>
            Geschätzte KI-Kosten: <b>ca. {euroGenau(s.euro)}</b>{isFetching ? ' …' : ''}
            {s.kiSucheMakler > 0 && <> — davon KI-Websuche für bis zu {s.kiSucheMakler} Makler</>}
            {s.warnung && <><br />Bei so vielen Maklern entstehen spürbare KI-Kosten. Ohne KI-Websuche wird es deutlich günstiger.</>}
          </Alert>
        )}
        {starten.error && <Alert color="red">{starten.error.message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!s?.anzahl} loading={starten.isPending} onClick={() => starten.mutate({ maklerIds, mitKi }, { onSuccess: onGestartet })} data-recherche-los>
            Starten
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Aufgeklappte Zeile: was gemacht wurde, Vorschläge zum Übernehmen, Adressen von Hand. */
export function MaklerRechercheDetail({ maklerId, name }: { maklerId: string; name: string | null }) {
  const { data, isLoading } = useRechercheMakler(maklerId);
  const navigate = useNavigate();
  const entscheiden = useRechercheEntscheiden();
  const stand = useRechercheStand();
  const [webseite, setWebseite] = useState<string | null>(null);
  const [immoscout, setImmoscout] = useState<string | null>(null);
  if (isLoading || !data) return <Loader size="xs" m="xs" />;
  const letzte = data.ergebnisse[0];
  return (
    <Paper p="sm" bg="var(--mantine-color-default-hover)" data-recherche-detail={maklerId}>
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={600}>{name ?? 'Makler'}</Text>
        <Anchor size="xs" onClick={() => navigate({ to: '/makler', search: { makler: maklerId } })}>Makler öffnen →</Anchor>
      </Group>
      {letzte ? (
        <>
          <Text size="xs" fw={600}>Was gemacht wurde {letzte.beendetAm ? `(${zeitpunktDe(letzte.beendetAm)})` : ''}</Text>
          <Stack gap={0} mb="xs">
            {letzte.schritte.map((s, i) => (
              <Text key={i} size="xs" c="dimmed">
                {new Date(s.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} {s.text}
                {s.url && <> · <Anchor href={s.url} target="_blank" rel="noreferrer" size="xs">öffnen ↗</Anchor></>}
              </Text>
            ))}
          </Stack>
          {letzte.vorschlaege.length > 0 && (
            <Table fz="xs" verticalSpacing={2} withTableBorder>
              <Table.Thead><Table.Tr><Table.Th>Feld</Table.Th><Table.Th>Bisher</Table.Th><Table.Th>Gefunden</Table.Th><Table.Th>Quelle</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {letzte.vorschlaege.map((v, i) => (
                  <Table.Tr key={i} data-recherche-vorschlag={v.feld}>
                    <Table.Td>{FELD_LABEL[v.feld] ?? v.feld}{v.ziel === 'unternehmen' ? ' (Firma)' : ''}</Table.Td>
                    <Table.Td c="dimmed">{v.alt ?? '–'}</Table.Td>
                    <Table.Td><Text size="xs" fw={600} bg={v.entscheidung ? undefined : 'yellow.1'} px={4}>{v.neu}</Text></Table.Td>
                    <Table.Td><Anchor href={v.quelle} target="_blank" rel="noreferrer" size="xs">{host(v.quelle)}{new URL(v.quelle).pathname} ↗</Anchor></Table.Td>
                    <Table.Td>
                      {v.entscheidung ? <Badge size="xs" variant="light" color={v.entscheidung === 'uebernommen' ? 'green' : 'gray'} tt="none">{v.entscheidung === 'uebernommen' ? 'übernommen' : 'verworfen'}</Badge> : (
                        <Group gap={4} wrap="nowrap">
                          <Button size="compact-xs" loading={entscheiden.isPending} onClick={() => entscheiden.mutate({ ergebnisId: letzte.id, index: i, entscheidung: 'uebernommen' })}>Übernehmen</Button>
                          <Button size="compact-xs" variant="default" onClick={() => entscheiden.mutate({ ergebnisId: letzte.id, index: i, entscheidung: 'verworfen' })}>Verwerfen</Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {entscheiden.error && <Alert color="red" mt="xs">{entscheiden.error.message}</Alert>}
        </>
      ) : <Text size="xs" c="dimmed" mb="xs">Noch nicht recherchiert.</Text>}
      <Group gap="xs" align="end" mt="sm">
        <TextInput size="xs" label="Webseite (von Hand)" placeholder="www.firma.de" w={220} value={webseite ?? data.webseite?.url ?? ''} onChange={(e) => setWebseite(e.currentTarget.value)} />
        <TextInput size="xs" label="ImmoScout-Profil (von Hand)" placeholder="https://www.immobilienscout24.de/anbieter/profil/…" w={320} value={immoscout ?? data.immoscout?.url ?? ''} onChange={(e) => setImmoscout(e.currentTarget.value)} />
        <Button size="xs" variant="default" disabled={webseite === null && immoscout === null} loading={stand.isPending}
          onClick={() => stand.mutate({ maklerId, ...(webseite !== null ? { webseite: webseite || null } : {}), ...(immoscout !== null ? { immoscoutUrl: immoscout || null } : {}) }, { onSuccess: () => { setWebseite(null); setImmoscout(null); } })}>
          Adressen speichern
        </Button>
      </Group>
      {stand.error && <Alert color="red" mt="xs">{stand.error.message}</Alert>}
    </Paper>
  );
}
