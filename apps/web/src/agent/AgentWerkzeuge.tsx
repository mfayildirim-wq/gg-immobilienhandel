/**
 * Einstellungen → AgentMode: alle Werkzeuge des Agenten mit Quelle und Recht, und die angebundenen MCP-Server.
 * MCP-Werkzeuge fragen vor jedem Aufruf; einzelne lassen sich hier „ohne Rückfrage“ freigeben (z. B. Mails suchen).
 */
import { Accordion, Alert, Badge, Button, Group, Paper, PasswordInput, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { agentAnfrage } from '../lib/api.ts';

interface Werkzeug { name: string; beschreibung: string; quelle: 'app' | 'web' | 'mcp' | 'agent'; recht: 'lesen' | 'fragt' | 'frei' | 'intern'; server?: string; liestNur?: boolean }
interface McpServer { name: string; url: string; aktiv: boolean; mitZugang: boolean }

const QUELLEN: { quelle: Werkzeug['quelle']; titel: string; hinweis: string }[] = [
  { quelle: 'web', titel: 'Web', hinweis: 'Recherche im Internet — liest nur.' },
  { quelle: 'mcp', titel: 'Von MCP-Servern', hinweis: 'Werkzeuge angebundener Server. Jedes fragt vor dem Aufruf, außer du gibst es frei.' },
  { quelle: 'agent', titel: 'Agent', hinweis: 'Bedienung der Oberfläche und Gedächtnis.' },
  { quelle: 'app', titel: 'App (lesend)', hinweis: 'Alles, was die App zum Lesen anbietet — automatisch aus ihrer Schnittstelle.' },
];

const RECHT: Record<Werkzeug['recht'], { label: string; farbe: string }> = {
  lesen: { label: 'liest nur', farbe: 'teal' },
  fragt: { label: 'fragt vorher', farbe: 'yellow' },
  frei: { label: 'ohne Rückfrage', farbe: 'orange' },
  intern: { label: 'intern', farbe: 'gray' },
};

async function json<T>(pfad: string, init?: RequestInit): Promise<T> {
  const r = await agentAnfrage(pfad, init);
  const body = (await r.json().catch(() => ({}))) as T & { fehler?: string; felder?: string[] };
  if (!r.ok) throw new Error([body.fehler, ...(body.felder ?? [])].filter(Boolean).join(' · ') || `Fehler ${r.status}`);
  return body;
}
const mitKoerper = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function AgentWerkzeuge({ mcp }: { mcp: McpServer[] }) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['agent', 'werkzeuge'], queryFn: () => json<{ werkzeuge: Werkzeug[] }>('/api/agent/werkzeuge') });
  const neuLaden = () => Promise.all([qc.invalidateQueries({ queryKey: ['agent', 'werkzeuge'] }), qc.invalidateQueries({ queryKey: ['agent', 'einstellungen'] })]);
  // onSuccess/onError statt onSettled: der globale onSettled der App lädt erst die Listen neu (mit Wiederholungen bei
  // Fehlern) — danach käme die Anzeige hier spürbar spät
  const frei = useMutation({ mutationFn: (e: { name: string; frei: boolean }) => json('/api/agent/werkzeuge/frei', mitKoerper('PUT', e)), onSuccess: neuLaden, onError: neuLaden });
  const werkzeuge = data?.werkzeuge ?? [];

  return (
    <Stack gap="sm">
      <McpServerListe mcp={mcp} neuLaden={neuLaden} />
      <Paper withBorder p="sm" component="section" aria-label="Werkzeuge">
        <Text size="sm" fw={600}>Werkzeuge</Text>
        <Text size="xs" c="dimmed" mb={6}>Was der Agent benutzen kann. Alles, was etwas speichert oder sendet, braucht dein „Ja“.</Text>
        {isLoading && <Text size="xs" c="dimmed">Lade …</Text>}
        {error && <Alert color="red" p="xs">{(error as Error).message}</Alert>}
        {frei.error && <Alert color="red" p="xs">{(frei.error as Error).message}</Alert>}
        <Accordion multiple defaultValue={['web', 'mcp']} variant="separated">
          {QUELLEN.map(({ quelle, titel, hinweis }) => {
            const liste = werkzeuge.filter((w) => w.quelle === quelle);
            return (
              <Accordion.Item key={quelle} value={quelle}>
                <Accordion.Control><Group gap="xs"><Text size="sm">{titel}</Text><Badge size="xs" variant="light" color="gray">{liste.length}</Badge></Group></Accordion.Control>
                <Accordion.Panel>
                  <Text size="xs" c="dimmed" mb={6}>{hinweis}</Text>
                  {!liste.length && <Text size="xs" c="dimmed">Keine.</Text>}
                  {!!liste.length && (
                    <Table striped withRowBorders={false} verticalSpacing={4} fz="xs">
                      <Table.Tbody>
                        {liste.map((w) => (
                          <Table.Tr key={w.name} data-werkzeug={w.name}>
                            <Table.Td style={{ width: '32%' }}><code>{w.name}</code>{w.server && <Text size="xs" c="dimmed">{w.server}</Text>}</Table.Td>
                            <Table.Td>{w.beschreibung}{w.liestNur && <Text size="xs" c="dimmed">Der Server kennzeichnet es als nur lesend.</Text>}</Table.Td>
                            <Table.Td style={{ width: 170 }}>
                              {w.quelle === 'mcp'
                                ? <Switch size="xs" label="ohne Rückfrage" aria-label={`${w.name} ohne Rückfrage`} checked={w.recht === 'frei'}
                                    onChange={(e) => frei.mutate({ name: w.name, frei: e.currentTarget.checked })} />
                                : <Badge size="xs" variant="light" color={RECHT[w.recht].farbe}>{RECHT[w.recht].label}</Badge>}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      </Paper>
    </Stack>
  );
}

function McpServerListe({ mcp, neuLaden }: { mcp: McpServer[]; neuLaden: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kopf, setKopf] = useState('');
  const hinzufuegen = useMutation({
    mutationFn: () => json<{ werkzeuge: number }>('/api/agent/mcp', mitKoerper('POST', { name: name.trim(), url: url.trim(), kopf: kopf.trim() })),
    onSuccess: async () => { setName(''); setUrl(''); setKopf(''); await neuLaden(); },
  });
  const entfernen = useMutation({ mutationFn: (n: string) => json(`/api/agent/mcp/${encodeURIComponent(n)}`, { method: 'DELETE' }), onSuccess: neuLaden, onError: neuLaden });

  return (
    <Paper withBorder p="sm" component="section" aria-label="MCP-Server">
      <Text size="sm" fw={600}>MCP-Server</Text>
      <Text size="xs" c="dimmed" mb={6}>
        Weitere Werkzeuge anbinden (z. B. Mail, SharePoint, Kalender) über die Internet-Adresse eines MCP-Servers. Zugangsdaten werden verschlüsselt gespeichert und nie wieder angezeigt.
      </Text>
      <Stack gap={6}>
        {mcp.map((m) => (
          <Group key={m.name} gap="xs" wrap="nowrap" data-mcp={m.name}>
            <Text size="sm" fw={500}>{m.name}</Text>
            <Text size="xs" c="dimmed" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.url}</Text>
            {m.mitZugang && <Badge size="xs" variant="light" color="teal">mit Zugang</Badge>}
            <Button size="compact-xs" variant="subtle" color="red" loading={entfernen.isPending && entfernen.variables === m.name} onClick={() => entfernen.mutate(m.name)}>Entfernen</Button>
          </Group>
        ))}
        {!mcp.length && <Text size="xs" c="dimmed">Noch keiner angebunden.</Text>}
        <Group gap="xs" align="flex-end" mt={4}>
          <TextInput size="xs" label="Name" placeholder="z. B. Postfach" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ width: 150 }} maxLength={40} />
          <TextInput size="xs" label="Adresse" placeholder="https://…/mcp" value={url} onChange={(e) => setUrl(e.currentTarget.value)} style={{ flex: 1, minWidth: 220 }} />
          <PasswordInput size="xs" label="Kopfzeile (optional)" placeholder="Authorization: Bearer …" value={kopf} onChange={(e) => setKopf(e.currentTarget.value)} style={{ width: 240 }} />
          <Button size="xs" loading={hinzufuegen.isPending} disabled={!name.trim() || !url.trim()} onClick={() => hinzufuegen.mutate()}>Verbinden</Button>
        </Group>
        {hinzufuegen.error && <Alert color="red" p="xs">{(hinzufuegen.error as Error).message}</Alert>}
        {hinzufuegen.data && <Text size="xs" c="teal">Verbunden — {hinzufuegen.data.werkzeuge} Werkzeuge gefunden. Sie fragen vor jedem Aufruf.</Text>}
      </Stack>
    </Paper>
  );
}
