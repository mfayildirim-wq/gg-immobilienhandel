/**
 * Einstellungen → AgentMode: feste Grundregeln (nicht löschbar), ergänzbare Listen „Immer“ und „Nie“, Wahl des
 * Modellanbieters. Gespeichert im Kern (`cosai.agenten`); wirkt ab der nächsten Nachricht.
 */
import { ActionIcon, Alert, Anchor, Badge, Button, Group, List, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconLock, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { agentAnfrage } from '../lib/api.ts';
import { AgentWerkzeuge } from './AgentWerkzeuge.tsx';

interface AnbieterStand { id: string; label: string; vorgabeModell: string; verfuegbar: boolean }
interface Einstellungen { grundregeln: string[]; regeln: string[]; nie: string[]; anbieter: string; modell: string; anbieterListe: AnbieterStand[]; mcp: { name: string; url: string; aktiv: boolean; mitZugang: boolean }[] }
type Aenderbar = Pick<Einstellungen, 'regeln' | 'nie' | 'anbieter' | 'modell'>;

async function holen(): Promise<Einstellungen> {
  const r = await agentAnfrage('/api/agent/einstellungen');
  if (!r.ok) throw new Error(r.status === 503 ? 'Der AgentMode ist ausgeschaltet.' : `Fehler ${r.status}`);
  return (await r.json()) as Einstellungen;
}

async function speichern(e: Aenderbar): Promise<Einstellungen> {
  const r = await agentAnfrage('/api/agent/einstellungen', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  const body = (await r.json().catch(() => ({}))) as Einstellungen & { fehler?: string; felder?: string[] };
  if (!r.ok) throw new Error([body.fehler, ...(body.felder ?? [])].filter(Boolean).join(' · ') || `Fehler ${r.status}`);
  return body;
}

/** Eine ergänzbare Regelliste („Immer“ oder „Nie“) */
function Regelliste({ titel, hinweis, regeln, setRegeln, platzhalter }: { titel: string; hinweis: string; regeln: string[]; setRegeln: (r: string[]) => void; platzhalter: string }) {
  const [neu, setNeu] = useState('');
  const hinzufuegen = () => {
    const t = neu.trim();
    if (!t || regeln.includes(t)) return;
    setRegeln([...regeln, t]);
    setNeu('');
  };
  return (
    <Paper withBorder p="sm" component="section" aria-label={titel}>
      <Text size="sm" fw={600}>{titel}</Text>
      <Text size="xs" c="dimmed" mb={6}>{hinweis}</Text>
      <Stack gap={6}>
        {regeln.map((r, i) => (
          <Group key={`${i}-${r}`} gap="xs" wrap="nowrap">
            <TextInput size="xs" style={{ flex: 1 }} value={r} aria-label={`${titel} ${i + 1}`} maxLength={300}
              onChange={(e) => setRegeln(regeln.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
            <ActionIcon variant="subtle" color="red" aria-label={`${titel} ${i + 1} entfernen`} onClick={() => setRegeln(regeln.filter((_, j) => j !== i))}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        {!regeln.length && <Text size="xs" c="dimmed">Noch keine.</Text>}
        <Group gap="xs" wrap="nowrap">
          <TextInput size="xs" style={{ flex: 1 }} placeholder={platzhalter} value={neu} maxLength={300} aria-label={`Neue Regel: ${titel}`}
            onChange={(e) => setNeu(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); hinzufuegen(); } }} />
          <Button size="xs" variant="light" onClick={hinzufuegen} disabled={!neu.trim()}>Hinzufügen</Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function AgentEinstellungen() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['agent', 'einstellungen'], queryFn: holen, retry: false });
  const [entwurf, setEntwurf] = useState<Aenderbar | null>(null);
  useEffect(() => { if (data && !entwurf) setEntwurf({ regeln: data.regeln, nie: data.nie, anbieter: data.anbieter, modell: data.modell }); }, [data, entwurf]);
  // Erfolg selbst merken: `isSuccess` von React Query kommt erst nach dem globalen onSettled der App (Listen neu laden)
  const [gespeichert, setGespeichert] = useState(false);
  const sichern = useMutation({
    mutationFn: speichern,
    onMutate: () => setGespeichert(false),
    onSuccess: (d) => { qc.setQueryData(['agent', 'einstellungen'], d); setEntwurf({ regeln: d.regeln, nie: d.nie, anbieter: d.anbieter, modell: d.modell }); setGespeichert(true); },
  });

  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data || !entwurf) return null;
  const anbieter = data.anbieterListe.find((a) => a.id === (entwurf.anbieter || 'anthropic'));
  const geaendert = JSON.stringify(entwurf) !== JSON.stringify({ regeln: data.regeln, nie: data.nie, anbieter: data.anbieter, modell: data.modell });

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>🤖 AgentMode</Title>
        <Text size="xs" c="dimmed">Was der Agent immer tut und nie tut, und mit welchem Modell er arbeitet. Gilt ab der nächsten Nachricht.</Text>
      </div>

      <Paper withBorder p="sm" component="section" aria-label="Grundregeln">
        <Group gap={6} mb={4}><IconLock size={14} /><Text size="sm" fw={600}>Grundregeln</Text><Badge size="xs" variant="light" color="gray">fest</Badge></Group>
        <Text size="xs" c="dimmed" mb={6}>Gelten immer und lassen sich nicht löschen. Die Anwendung erzwingt sie zusätzlich: nichts wird ohne dein „Ja“ gespeichert.</Text>
        <List size="sm" spacing={4}>{data.grundregeln.map((r) => <List.Item key={r}>{r}</List.Item>)}</List>
      </Paper>

      <Regelliste titel="Immer" hinweis="Was der Agent immer tun soll (Dos)." platzhalter="z. B. Antworte kurz und nenne zuerst die Zahl."
        regeln={entwurf.regeln} setRegeln={(regeln) => setEntwurf({ ...entwurf, regeln })} />
      <Regelliste titel="Nie" hinweis="Was der Agent nie tun soll (Don'ts)." platzhalter="z. B. Nenne nie Kaufpreise ohne Nachfrage."
        regeln={entwurf.nie} setRegeln={(nie) => setEntwurf({ ...entwurf, nie })} />

      <Paper withBorder p="sm" component="section" aria-label="Modell">
        <Text size="sm" fw={600}>Modell</Text>
        <Text size="xs" c="dimmed" mb={6}>
          Anbieter und Modell des Agenten. Schlüssel unter <Anchor component={Link} to="/einstellungen/zugaenge" size="xs">Einstellungen → Zugänge</Anchor>.
        </Text>
        <Group gap="xs" align="flex-end">
          <Select size="xs" label="Anbieter" style={{ minWidth: 220 }} allowDeselect={false}
            value={entwurf.anbieter || 'anthropic'}
            onChange={(v) => setEntwurf({ ...entwurf, anbieter: v === 'anthropic' ? '' : (v ?? ''), modell: '' })}
            data={data.anbieterListe.map((a) => ({ value: a.id, label: a.verfuegbar ? a.label : `${a.label} — kein Schlüssel` }))} />
          <TextInput size="xs" label="Modell" style={{ flex: 1, minWidth: 200 }} value={entwurf.modell} maxLength={100}
            placeholder={anbieter?.vorgabeModell ? `Vorgabe: ${anbieter.vorgabeModell}` : 'Modellname eintragen (siehe Anbieter)'}
            onChange={(e) => setEntwurf({ ...entwurf, modell: e.currentTarget.value.trim() })} />
        </Group>
        {anbieter && !anbieter.verfuegbar && <Alert mt="xs" color="yellow" p="xs">Für {anbieter.label} ist kein Schlüssel hinterlegt — der Agent meldet das, statt zu antworten.</Alert>}
        {anbieter && !anbieter.vorgabeModell && !entwurf.modell && <Alert mt="xs" color="yellow" p="xs">Für {anbieter.label} bitte den Modellnamen eintragen.</Alert>}
      </Paper>

      {sichern.error && <Alert color="red">{(sichern.error as Error).message}</Alert>}
      <Group>
        <Button onClick={() => sichern.mutate({ ...entwurf, regeln: entwurf.regeln.map((r) => r.trim()).filter(Boolean), nie: entwurf.nie.map((r) => r.trim()).filter(Boolean) })}
          loading={sichern.isPending} disabled={!geaendert}>Speichern</Button>
        {gespeichert && !geaendert && <Text size="xs" c="teal">Gespeichert — gilt ab der nächsten Nachricht.</Text>}
      </Group>

      <AgentWerkzeuge mcp={data.mcp ?? []} />
    </Stack>
  );
}
