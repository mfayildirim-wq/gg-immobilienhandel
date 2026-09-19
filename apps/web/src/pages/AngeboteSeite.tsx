import { Alert, Anchor, Badge, Button, Card, Group, Loader, Stack, Switch, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useM365, useM365Posteingang, useMailEntsperren, useMailSperren, useMailUebernehmen } from '../lib/api.ts';
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

/** 📧 Angebote: Exposé-Mails aus dem Posteingang übernehmen oder sperren (alt: Angebote-Panel). */
export function AngeboteSeite() {
  const { data: stand } = useM365();
  const [alle, setAlle] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useM365Posteingang(alle, Boolean(stand?.verbunden || stand?.testModus));
  const sperren = useMailSperren();
  const entsperren = useMailEntsperren();
  const uebernehmen = useMailUebernehmen();
  const navigate = useNavigate();

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
      {data && data.mails.some((m) => m.triage.verdict === 'LINK_LANDING_LOCKED') && (
        <Alert color="orange" py={6}>
          Für Landing-Pages mit Freischaltung („AGB bestätigen“) gibt es im Neubau noch keinen Bot — der Link lässt sich
          von Hand öffnen, das Exposé dann als Datei importieren. Die Freigabe dafür steht bereit (Einstellungen → Aktionen nach außen).
        </Alert>
      )}
      {data?.mails.map((m) => (
        <Card key={m.uid} withBorder padding="sm" data-mail={m.uid}>
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size="sm" truncate>{m.betreff}</Text>
              <Text size="xs" c="dimmed">{m.vonName || m.von} · {zeitpunktDe(m.datum)}</Text>
            </div>
            <Group gap={6} wrap="nowrap">
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
        </Card>
      ))}
    </Stack>
  );
}
