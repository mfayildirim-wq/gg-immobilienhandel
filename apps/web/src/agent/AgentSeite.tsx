/**
 * Die eigene Seite des AgentMode (`/agent`): dieselbe Leiste oben und unten wie im Overlay, in der Mitte statt der App
 * die Tages-Todos aus dem Cockpit und der Zeitstrahl „was ich getan habe“. Vom Gespräch aus springt der Agent in die
 * App — dann übernimmt das Overlay.
 */
import { Anchor, Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AgentModeHost } from './agent.tsx';
import { agentAnfrage, useAnkauf } from '../lib/api.ts';
import { datumDe } from '../lib/format.ts';

interface Episode { id?: string; schluessel: string; inhalt: string; zuletzt?: string }

function Zeitstrahl() {
  const { data } = useQuery({
    queryKey: ['agent', 'verlauf'],
    queryFn: async () => ((await (await agentAnfrage('/api/agent/gedaechtnis/verlauf')).json()) as { eintraege: Episode[] }).eintraege,
  });
  if (!data?.length) return <Text size="sm" c="dimmed">Noch nichts getan.</Text>;
  return (
    <ul className="am-liste" aria-label="Zeitstrahl">
      {data.map((e, i) => (
        <li key={e.id ?? i}>
          <time>{e.zuletzt ? new Date(e.zuletzt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</time>
          <span>{e.inhalt}</span>
        </li>
      ))}
    </ul>
  );
}

function Todos() {
  const { data } = useAnkauf();
  if (!data) return <Text size="sm" c="dimmed">Lade Cockpit …</Text>;
  const deals = data.deals.slice(0, 8);
  const makler = data.makler.slice(0, 5);
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge color={data.deals.length ? 'red' : 'gray'}>{data.deals.length} Deals</Badge>
        <Badge color={data.makler.length ? 'red' : 'gray'}>{data.makler.length} Makler</Badge>
        <Anchor component={Link} to="/" size="sm">Zum Ankauf →</Anchor>
      </Group>
      <ul className="am-liste">
        {deals.map((d) => (
          <li key={d.id}>
            <Badge size="xs" variant="light">{d.faellig.label}</Badge>
            <span><b>{d.objekt.titel}</b>{d.makler?.name ? ` · ${d.makler.name}` : ''}{d.nextContact ? ` · ${datumDe(d.nextContact)}` : ''}</span>
          </li>
        ))}
        {makler.map((m) => (
          <li key={m.id}>
            <Badge size="xs" variant="light" color="teal">Makler</Badge>
            <span><b>{m.name ?? m.firma ?? 'Makler'}</b>{m.nextContact ? ` · ${datumDe(m.nextContact)}` : ''}</span>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

export function AgentSeite() {
  return (
    <AgentModeHost modus="seite">
      <Stack gap="md">
        <div className="am-karte">
          <Title order={5} mb="xs">Heute</Title>
          <Todos />
        </div>
        <div className="am-karte">
          <Title order={5} mb="xs">Was ich getan habe</Title>
          <Zeitstrahl />
        </div>
      </Stack>
    </AgentModeHost>
  );
}
