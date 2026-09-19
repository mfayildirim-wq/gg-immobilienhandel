import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useM365, useM365Anmeldung, useM365Konfiguration, useM365Ordner, useM365Trennen } from '../lib/api.ts';
import { zeitpunktDe } from '../lib/format.ts';

/** 📧 Microsoft 365 (Einstellungen): Azure-App eintragen, verbinden, Ordner wählen. Nur Lesezugriff. */
export function M365Einstellungen() {
  const { data, isLoading, error } = useM365();
  const konfiguration = useM365Konfiguration();
  const ordner = useM365Ordner();
  const anmeldung = useM365Anmeldung();
  const trennen = useM365Trennen();
  const [form, setForm] = useState<{ clientId: string; tenantId: string; clientSecret: string } | null>(null);
  const [ordnerWert, setOrdnerWert] = useState<string | null>(null);

  const werte = form ?? { clientId: data?.clientId ?? '', tenantId: data?.tenantId ?? '', clientSecret: '' };

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>📧 Microsoft 365</Title>
        <Text size="xs" c="dimmed">
          Liest den Posteingang, um Exposé-Mails zu übernehmen. Angefordert werden nur Leserechte
          ({data?.scopes.join(', ') ?? 'Mail.Read, User.Read, offline_access'}).
        </Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {data && (
        <>
          <Group gap="xs">
            <Badge variant="light" tt="none" color={data.verbunden ? 'teal' : data.eingerichtet ? 'yellow' : 'gray'} data-m365-status>
              {data.verbunden ? `verbunden als ${data.email}` : data.eingerichtet ? 'eingerichtet, nicht verbunden' : 'nicht eingerichtet'}
            </Badge>
            {data.verbundenSeit && <Text size="xs" c="dimmed">seit {zeitpunktDe(data.verbundenSeit)}</Text>}
          </Group>

          <Paper withBorder p="sm">
            <Text size="sm" fw={600} mb={6}>Azure-App</Text>
            <Group gap="xs" align="flex-end" wrap="wrap">
              <TextInput size="xs" label="Client-ID" style={{ flex: 1, minWidth: 220 }} value={werte.clientId}
                onChange={(e) => setForm({ ...werte, clientId: e.currentTarget.value })} />
              <TextInput size="xs" label="Verzeichnis (Tenant)" style={{ flex: 1, minWidth: 180 }} placeholder="common" value={werte.tenantId}
                onChange={(e) => setForm({ ...werte, tenantId: e.currentTarget.value })} />
              <TextInput size="xs" type="password" label="Client-Geheimnis" style={{ flex: 1, minWidth: 180 }} placeholder={data.eingerichtet ? '•••• (bleibt)' : 'neu eintragen'}
                value={werte.clientSecret} onChange={(e) => setForm({ ...werte, clientSecret: e.currentTarget.value })} />
              <Button size="xs" loading={konfiguration.isPending} disabled={!werte.clientId}
                onClick={() => konfiguration.mutate({ clientId: werte.clientId, tenantId: werte.tenantId, ...(werte.clientSecret ? { clientSecret: werte.clientSecret } : {}) }, { onSuccess: () => setForm(null) })}>
                Speichern
              </Button>
            </Group>
            <Text fz={10} c="dimmed" mt={6}>
              In Azure als Weiterleitungs-URL eintragen: <code>{typeof location !== 'undefined' ? `${location.origin}/m365/rueckweg` : '/m365/rueckweg'}</code>
            </Text>
          </Paper>

          <Group gap="xs">
            <Button size="xs" disabled={!data.eingerichtet} loading={anmeldung.isPending}
              onClick={() => anmeldung.mutate(`${location.origin}/m365/rueckweg`, { onSuccess: (r) => { location.href = r.url; } })}>
              {data.verbunden ? 'Neu verbinden' : 'Mit Microsoft verbinden'}
            </Button>
            {data.verbunden && <Button size="xs" variant="subtle" color="red" onClick={() => trennen.mutate()}>Verbindung trennen</Button>}
          </Group>

          <Paper withBorder p="sm">
            <Group gap="xs" align="flex-end">
              <TextInput size="xs" label="Ordner" description="Name des Ordners oder „inbox“" value={ordnerWert ?? data.ordner}
                onChange={(e) => setOrdnerWert(e.currentTarget.value)} />
              {ordnerWert !== null && (
                <Button size="xs" loading={ordner.isPending} onClick={() => ordner.mutate(ordnerWert, { onSuccess: () => setOrdnerWert(null) })}>Ordner speichern</Button>
              )}
            </Group>
          </Paper>
          {konfiguration.error && <Alert color="red">{konfiguration.error.message}</Alert>}
          {anmeldung.error && <Alert color="red">{anmeldung.error.message}</Alert>}
        </>
      )}
    </Stack>
  );
}
