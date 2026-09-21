import { Alert, Anchor, Badge, Button, Card, Collapse, Group, Loader, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core';
import type { AutoImportLauf } from '@gg/api-contract';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiFehler, autoImportAbbrechen, autoImportLauf, useM365, useM365Posteingang, useMailEntsperren, useMailSperren, useMailUebernehmen } from '../lib/api.ts';
import { zeitpunktDe } from '../lib/format.ts';

/** Triage-Ergebnis in Worten (Stufe 0 der Exposé-Erkennung). */
const TRIAGE_LABEL: Record<string, string> = {
  ATTACHMENT: '📎 Exposé liegt im Anhang',
  BODY: '✉️ Angaben stehen im Mailtext',
  LINK_DIRECT_PDF: '🔗 Link führt direkt zum PDF',
  LINK_LANDING_OPEN: '🔗 Landing-Page ohne Freischaltung',
  LINK_LANDING_LOCKED: '🔒 Landing-Page mit Freischaltung (AGB)',
  SUPPLEMENT: '📄 nur Zusatzunterlagen',
  ANNOUNCEMENT: '📣 nur Ankündigung',
  NONE: '— kein Exposé erkennbar',
};
const TRIAGE_FARBE: Record<string, string> = {
  ATTACHMENT: 'teal', BODY: 'blue', LINK_DIRECT_PDF: 'teal', LINK_LANDING_OPEN: 'yellow',
  LINK_LANDING_LOCKED: 'orange', SUPPLEMENT: 'gray', ANNOUNCEMENT: 'gray', NONE: 'gray',
};

// Ausgang eines Laufs (R10 — es gibt nie einen stummen Fehler)
const AUSGANG: Record<string, { label: string; farbe: string }> = {
  sicher: { label: '✅ Exposé gefunden', farbe: 'teal' },
  unsicher: { label: '⚠️ unvollständig — bitte prüfen', farbe: 'yellow' },
  wiedervorlage: { label: '📣 Wiedervorlage — noch keine Daten', farbe: 'blue' },
  'nichts-gefunden': { label: '✗ nichts gefunden', farbe: 'red' },
};
/** Wie die alte App: nacheinander oder drei gleichzeitig — mehr Plätze gibt der Server nicht her. */
const GLEICHZEITIG = { nacheinander: 1, parallel: 3 } as const;
type Zustand = { laeuft: true } | { laeuft: false; lauf?: AutoImportLauf; fehler?: string };

/** 📧 Angebote: Exposé-Mails aus dem Posteingang übernehmen oder sperren (alt: Angebote-Panel). */
export function AngeboteSeite() {
  const { data: stand } = useM365();
  const [alle, setAlle] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useM365Posteingang(alle, Boolean(stand?.verbunden || stand?.testModus));
  const sperren = useMailSperren();
  const entsperren = useMailEntsperren();
  const uebernehmen = useMailUebernehmen();
  const navigate = useNavigate();

  // ── Auto-Import: Zustand je Mail, Warteschlange, Abbruch ──
  const [zustand, setZustand] = useState<Record<string, Zustand>>({});
  const [modus, setModus] = useState<keyof typeof GLEICHZEITIG>('nacheinander');
  const [schlange, setSchlange] = useState<{ gesamt: number; fertig: number } | null>(null);
  const [offenSchritte, setOffenSchritte] = useState<string | null>(null);
  const gestoppt = useRef(false);

  const importieren = async (uid: string) => {
    setZustand((z) => ({ ...z, [uid]: { laeuft: true } }));
    try {
      const lauf = await autoImportLauf(uid);
      setZustand((z) => ({ ...z, [uid]: { laeuft: false, lauf } }));
    } catch (e) {
      setZustand((z) => ({ ...z, [uid]: { laeuft: false, fehler: e instanceof ApiFehler || e instanceof Error ? e.message : String(e) } }));
    }
  };
  const alleImportieren = async (uids: string[]) => {
    gestoppt.current = false;
    setSchlange({ gesamt: uids.length, fertig: 0 });
    const offen = [...uids];
    const arbeiter = async () => {
      for (let uid = offen.shift(); uid && !gestoppt.current; uid = offen.shift()) {
        await importieren(uid);
        setSchlange((s) => (s ? { ...s, fertig: s.fertig + 1 } : s));
      }
    };
    await Promise.all(Array.from({ length: GLEICHZEITIG[modus] }, arbeiter));
    setSchlange(null);
    void refetch();
  };
  const offeneUids = (data?.mails ?? []).filter((m) => !m.gesperrt && !m.importiert && !zustand[m.uid]).map((m) => m.uid);

  if (stand && !stand.verbunden && !stand.testModus) {
    return (
      <Alert color="yellow">
        Microsoft 365 ist nicht verbunden. Unter <Anchor onClick={() => void navigate({ to: '/einstellungen/m365' as '/einstellungen' })}>Einstellungen → Microsoft 365</Anchor> einrichten.
      </Alert>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={3}>📧 Angebote{data ? ` · ${data.ordner}` : ''}</Title>
          {stand?.testModus && !stand.verbunden && <Badge size="xs" variant="light" color="yellow" tt="none">Test-Modus</Badge>}
        </Group>
        <Group gap="xs">
          <Switch size="xs" label="auch gesperrte" checked={alle} onChange={(e) => setAlle(e.currentTarget.checked)} />
          <Button size="xs" variant="default" loading={isFetching} onClick={() => void refetch()}>Neu laden</Button>
        </Group>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {data?.mails.length === 0 && <Text c="dimmed" size="sm">Keine offenen Mails.</Text>}
      {data && data.mails.length > 0 && (
        <Card withBorder padding="xs" aria-label="Auto-Import">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 260 }}>
              🤖 Der Auto-Import holt das Exposé selbst: aus dem Anhang, aus dem Mailtext oder von der Seite des Maklers.
              Eine AGB-/Provisionsbestätigung sendet er nur ab, wenn sie unter Einstellungen → Freigaben erlaubt ist.
            </Text>
            <Group gap="xs" wrap="nowrap">
              <SegmentedControl size="xs" value={modus} onChange={(v) => setModus(v as keyof typeof GLEICHZEITIG)} disabled={!!schlange}
                data={[{ value: 'nacheinander', label: 'nacheinander' }, { value: 'parallel', label: '3 gleichzeitig' }]} />
              {schlange
                ? <Button size="xs" color="red" variant="light" onClick={() => { gestoppt.current = true; }}>⏹ Stopp ({schlange.fertig}/{schlange.gesamt})</Button>
                : <Button size="xs" disabled={offeneUids.length === 0} onClick={() => void alleImportieren(offeneUids)}>🤖 Alle offenen importieren ({offeneUids.length})</Button>}
            </Group>
          </Group>
        </Card>
      )}
      {data?.mails.map((m) => (
        <Card key={m.uid} withBorder padding="sm" data-mail={m.uid}>
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size="sm" truncate>{m.betreff}</Text>
              <Text size="xs" c="dimmed">{m.vonName || m.von} · {zeitpunktDe(m.datum)}</Text>
            </div>
            <Group gap={6} wrap="nowrap">
              {m.importiert && <Badge size="xs" variant="light" color="teal" tt="none">importiert</Badge>}
              {m.gesperrt && <Badge size="xs" variant="light" color="gray" tt="none">gesperrt</Badge>}
              {m.gesperrt
                ? <Button size="compact-xs" variant="default" onClick={() => entsperren.mutate(m.uid)}>↩ Sperre aufheben</Button>
                : <Button size="compact-xs" variant="default" onClick={() => sperren.mutate(m.uid)}>🚫 Sperren</Button>}
            </Group>
          </Group>
          <Text size="xs" c="dimmed" mt={4} lineClamp={2}>{m.vorschau}</Text>
          <Group gap={6} mt={6} wrap="wrap" data-triage={m.triage.verdict}>
            <Badge size="xs" variant="light" tt="none" color={TRIAGE_FARBE[m.triage.verdict] ?? 'gray'}>{TRIAGE_LABEL[m.triage.verdict] ?? m.triage.verdict}</Badge>
            {m.triage.kandidat && <Text fz={10} c="dimmed">{m.triage.kandidat.ref} · {m.triage.kandidat.score} Punkte · {m.triage.kandidat.warum.slice(0, 2).join(', ')}</Text>}
            {m.triage.objektnummern.length > 0 && <Text fz={10} c="dimmed">Objektnr.: {m.triage.objektnummern.join(', ')}</Text>}
            {m.triage.rechtsdokumente.length > 0 && <Text fz={10} c="dimmed">nie laden: {m.triage.rechtsdokumente.join(', ')}</Text>}
          </Group>
          {m.anhaengeUnvollstaendig && <Alert color="orange" py={4} mt={6}>Die Anhangsliste konnte nicht vollständig geladen werden — bitte neu laden.</Alert>}
          <Group gap={6} mt={6} wrap="wrap">
            {m.anhaenge.map((a) => (
              <Button key={a.id} size="compact-xs" variant={a.auswertbar ? 'light' : 'default'} disabled={!a.auswertbar} loading={uebernehmen.isPending}
                onClick={() => uebernehmen.mutate({ uid: m.uid, anhangId: a.id }, { onSuccess: (r) => void navigate({ to: '/expose-import', search: { key: r.key, name: a.name } }) })}>
                📄 {a.name} ({a.groesseMb} MB)
              </Button>
            ))}
            {m.links.map((l) => (
              <Anchor key={l} href={l} target="_blank" rel="noopener" size="xs">🔗 {new URL(l).hostname}</Anchor>
            ))}
          </Group>
          <AutoImportZeile uid={m.uid} zustand={zustand[m.uid]} schonImportiert={m.importiert} starten={() => void importieren(m.uid)}
            offen={offenSchritte === m.uid} umschalten={() => setOffenSchritte(offenSchritte === m.uid ? null : m.uid)}
            oeffnen={(lauf) => void navigate({ to: '/expose-import', search: { key: lauf.eingangKey!, name: lauf.dateiname ?? 'expose.pdf' } })} />
        </Card>
      ))}
    </Stack>
  );
}

/** Eine Mail im Auto-Import: Start, Abbruch, Ausgang im Klartext, Schritte zum Nachvollziehen, Weg in den Assistenten. */
function AutoImportZeile({ uid, zustand, schonImportiert, starten, offen, umschalten, oeffnen }: {
  uid: string; zustand: Zustand | undefined; schonImportiert: boolean; starten: () => void; offen: boolean; umschalten: () => void; oeffnen: (lauf: AutoImportLauf) => void;
}) {
  const lauf = zustand && !zustand.laeuft ? zustand.lauf : undefined;
  const ausgang = lauf ? AUSGANG[lauf.ausgang ?? ''] ?? (lauf.status === 'aborted' ? { label: '⏹ abgebrochen', farbe: 'gray' } : { label: '✗ fehlgeschlagen', farbe: 'red' }) : null;
  return (
    <Stack gap={4} mt={8} data-auto-import={uid}>
      <Group gap={6} wrap="wrap">
        {zustand?.laeuft
          ? <><Button size="compact-xs" loading>🤖 läuft…</Button><Button size="compact-xs" variant="default" onClick={() => void autoImportAbbrechen(uid)}>⏹ Abbrechen</Button></>
          : <Button size="compact-xs" variant="light" onClick={starten}>{lauf || schonImportiert ? '🤖 erneut versuchen' : '🤖 Auto-Import'}</Button>}
        {ausgang && <Badge size="xs" variant="light" tt="none" color={ausgang.farbe} data-ausgang={lauf?.ausgang ?? lauf?.status}>{ausgang.label}</Badge>}
        {lauf?.eingangKey && <Button size="compact-xs" onClick={() => oeffnen(lauf)}>→ Im Assistenten prüfen</Button>}
        {lauf && lauf.schritte.length > 0 && <Anchor size="xs" onClick={umschalten}>{offen ? 'Schritte ausblenden' : `${lauf.schritte.length} Schritte`}</Anchor>}
      </Group>
      {zustand && !zustand.laeuft && zustand.fehler && <Alert color="red" py={4}>{zustand.fehler}</Alert>}
      {lauf?.grund && <Text size="xs" c={lauf.eingangKey ? 'dimmed' : 'red.7'}>{lauf.grund}</Text>}
      <Collapse expanded={offen}>
        {lauf?.schritte.map((s, i) => (
          // eslint-disable-next-line react/no-array-index-key -- Schritte haben keine Kennung, die Reihenfolge ist die Information
          <Text key={i} fz={11} c={s.ok ? 'dimmed' : 'red.7'} ff="monospace">
            {s.ok ? '✓' : '✗'} {s.schritt} · {s.dauerMs} ms{s.fehler ? ` · ${s.fehler}` : ''}
          </Text>
        ))}
      </Collapse>
    </Stack>
  );
}
