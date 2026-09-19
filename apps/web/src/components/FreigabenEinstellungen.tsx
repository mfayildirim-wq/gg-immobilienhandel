import { Alert, Badge, Button, Group, List, Loader, Paper, Stack, Switch, TagsInput, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useFreigabeEntscheiden, useGateSpeichern, useMcp, useOutwardGate } from '../lib/api.ts';
import { zeitpunktDe } from '../lib/format.ts';

const AKTION_LABEL: Record<string, string> = {
  'agb-submit': 'AGB-/Provisionsbestätigung absenden',
  'propstack-unit-create': 'Einheit in Propstack anlegen',
};

/** 🚦 Aktionen nach außen (Einstellungen): Schalter des Default-Deny-Gates und offene Freigabe-Anträge. */
export function FreigabenEinstellungen() {
  const { data, isLoading, error } = useOutwardGate();
  const speichern = useGateSpeichern();
  const entscheiden = useFreigabeEntscheiden();
  const [hosts, setHosts] = useState<string[] | null>(null);

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>🚦 Aktionen nach außen</Title>
        <Text size="xs" c="dimmed">
          Alles, was die App bei Dritten auslöst statt nur zu lesen. Standard ist aus. Freigegeben wird nur, wenn jede
          Bedingung erfüllt ist — die Umgebung steht im Code und lässt sich hier nicht umlegen.
        </Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {data && (
        <>
          <Group gap="xs">
            <Badge variant="light" tt="none" color={data.scharfeUmgebung ? 'teal' : 'gray'} data-umgebung>
              {data.scharfeUmgebung ? 'scharfe Umgebung (Vercel-Produktion)' : 'gesperrte Umgebung (lokal/Vorschau)'}
            </Badge>
            {data.notAus && <Badge variant="light" color="red" tt="none">Not-Aus gesetzt (OUTWARD_GATE_KILL)</Badge>}
          </Group>

          <Paper withBorder p="sm">
            <Switch label="AGB-/Provisionsbestätigung absenden (Auto-Import)" checked={data.schalter.allowAgbSubmit}
              onChange={(e) => speichern.mutate({ allowAgbSubmit: e.currentTarget.checked })} data-schalter="agb" />
            <Switch mt="xs" label="Einheit in Propstack anlegen" checked={data.schalter.allowPropstackWrite}
              onChange={(e) => speichern.mutate({ allowPropstackWrite: e.currentTarget.checked })} data-schalter="propstack" />
            <TagsInput mt="sm" size="xs" label="Zusätzliche Makler-Hosts für den AGB-Submit" placeholder="host.de"
              description="Ergänzt die Liste im Code. Einträge ohne Punkt oder mit Platzhalter werden ignoriert."
              value={hosts ?? data.schalter.extraAgbHosts} onChange={setHosts} />
            {hosts && (
              <Group mt="xs" justify="flex-end">
                <Button size="xs" variant="default" onClick={() => setHosts(null)}>Verwerfen</Button>
                <Button size="xs" loading={speichern.isPending} onClick={() => speichern.mutate({ extraAgbHosts: hosts }, { onSuccess: () => setHosts(null) })}>Hosts speichern</Button>
              </Group>
            )}
          </Paper>

          <Paper withBorder p="sm" aria-label="Proben">
            <Text size="sm" fw={600} mb={4}>Was gerade durchginge</Text>
            {data.proben.map((p) => (
              <div key={p.action} data-probe={p.action}>
                <Group gap="xs">
                  <Badge size="xs" variant="light" tt="none" color={p.erlaubt ? 'teal' : 'red'}>{p.erlaubt ? 'frei' : 'blockiert'}</Badge>
                  <Text size="xs">{AKTION_LABEL[p.action] ?? p.action} → {p.url}</Text>
                </Group>
                {!p.erlaubt && <Text fz={10} c="dimmed" mb={6}>Offene Bedingungen: {p.failed.join(', ')}</Text>}
              </div>
            ))}
          </Paper>

          <McpUebersicht />

          <Paper withBorder p="sm" aria-label="Freigabe-Anträge">
            <Text size="sm" fw={600} mb={4}>Freigabe-Anträge ({data.freigaben.length})</Text>
            {data.freigaben.length === 0 && <Text size="xs" c="dimmed">Keine offenen Anträge.</Text>}
            <List size="xs" spacing={6}>
              {data.freigaben.map((f) => (
                <List.Item key={f.id} data-freigabe={f.id}>
                  <Group gap="xs" wrap="nowrap" justify="space-between">
                    <div>
                      <Text size="xs" fw={600}>{AKTION_LABEL[f.action] ?? f.action} · {new URL(f.url).hostname}</Text>
                      <Text fz={10} c="dimmed">{f.grund} · {zeitpunktDe(f.ts)} · {f.beantragtVon}{f.bezug ? ` · ${f.bezug}` : ''}</Text>
                    </div>
                    <Group gap={6} wrap="nowrap">
                      <Button size="compact-xs" onClick={() => entscheiden.mutate({ id: f.id, entscheidung: 'erlaubt' })}>Freigeben</Button>
                      <Button size="compact-xs" variant="default" onClick={() => entscheiden.mutate({ id: f.id, entscheidung: 'abgelehnt' })}>Ablehnen</Button>
                    </Group>
                  </Group>
                </List.Item>
              ))}
            </List>
            <Text fz={10} c="dimmed" mt={6}>
              Eine Freigabe ersetzt das Gate nicht: auch danach müssen Umgebung, Schalter und Ziel-Host stimmen.
            </Text>
          </Paper>
        </>
      )}
    </Stack>
  );
}

/** Was der MCP-Server anbietet und wer ihn nutzen darf. */
function McpUebersicht() {
  const { data } = useMcp();
  if (!data) return null;
  return (
    <Paper withBorder p="sm" aria-label="MCP">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>MCP-Server</Text>
        <Badge size="xs" variant="light" tt="none" color={data.lokal ? 'yellow' : 'teal'} data-mcp-modus>
          {data.lokal ? 'lokal offen (voller Bereichssatz)' : `${data.schluessel.length} Schlüssel hinterlegt`}
        </Badge>
      </Group>
      <Text fz={10} c="dimmed" mb={6}>
        Endpunkt <code>/api/mcp</code> (JSON-RPC). Außerhalb der lokalen Umgebung braucht jeder Aufruf einen Schlüssel
        im Kopf <code>Authorization: Bearer …</code>; Cookies zählen nicht. Hinterlegt werden nur SHA-256-Hashes in <code>MCP_API_KEYS</code>.
      </Text>
      {data.schluessel.map((k) => (
        <Text key={k.label} size="xs" data-mcp-schluessel={k.label}>🔑 {k.label} · {k.scopes.join(', ')}</Text>
      ))}
      {data.verworfen.map((v) => <Text key={v} size="xs" c="red">⚠ {v}</Text>)}
      <List size="xs" mt={6} spacing={2}>
        {data.werkzeuge.map((w) => (
          <List.Item key={w.name} data-mcp-werkzeug={w.name}>
            <Text size="xs"><b>{w.name}</b> ({w.scope}) — {w.title}</Text>
          </List.Item>
        ))}
      </List>
    </Paper>
  );
}
