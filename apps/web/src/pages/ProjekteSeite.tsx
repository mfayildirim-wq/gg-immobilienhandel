import type { Projekt } from '@gg/api-contract';
import { pmKarte } from '@gg/domain';
import { Alert, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { heuteIso } from '../lib/ansicht.ts';
import { useProjektAnlegen, useProjektDealAuswahl, useProjekte } from '../lib/api.ts';

/** pmRender: Projektübersicht („📊 Vertrieb“ der alten App). */
export function ProjekteSeite() {
  const { data: projekte = [], isLoading } = useProjekte();
  const [neuOffen, setNeuOffen] = useState(false);
  if (isLoading) return <Text c="dimmed">Lädt …</Text>;
  return (
    <Stack maw={1200}>
      {projekte.length === 0 ? (
        <Paper withBorder p="xl" ta="center" maw={640}>
          <Text fz={48}>🏗️</Text>
          <Title order={2} mb="xs">Projektmanagement & Vertrieb</Title>
          <Text c="dimmed" mb="lg">Noch keine Projekte vorhanden.<br />Setze einen Deal auf „Angekauft“ und lege ein Projekt an.</Text>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setNeuOffen(true)}>Neues Projekt anlegen</Button>
        </Paper>
      ) : (
        <>
          <Group justify="space-between">
            <Title order={2}>Projektübersicht</Title>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setNeuOffen(true)}>Projekt</Button>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {projekte.map((p) => <ProjektKarte key={p.id} p={p} />)}
          </SimpleGrid>
        </>
      )}
      <NeuesProjekt offen={neuOffen} schliessen={() => setNeuOffen(false)} />
    </Stack>
  );
}

function ProjektKarte({ p }: { p: Projekt }) {
  const navigate = useNavigate();
  const k = pmKarte(p);
  const kpi = (wert: string, label: string, unter: string, farbe: string | undefined, name: string) => (
    <Stack gap={0} align="center" data-kpi={name}>
      <Text fz={22} fw={700} c={farbe} data-wert>{wert}</Text>
      <Text size="xs" tt="uppercase" c="dimmed">{label}</Text>
      <Text fz={10} c="dimmed" data-unter>{unter}</Text>
    </Stack>
  );
  return (
    <Paper withBorder p="md" radius="md" style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`Projekt ${p.adresse}`} data-projekt={p.id}
      onClick={() => navigate({ to: '/projekte/$id', params: { id: p.id } })}
      onKeyDown={(e) => { if (e.key === 'Enter') void navigate({ to: '/projekte/$id', params: { id: p.id } }); }}>
      <Group justify="space-between" align="flex-start" mb="sm" wrap="nowrap">
        <div>
          <Text fw={700} data-feld="adresse">{p.adresse || '–'}</Text>
          <Text size="xs" c="dimmed" data-feld="unterzeile">{p.stadt} · {k.einheiten} Einheiten</Text>
        </div>
        <Text size="xs" c="dimmed">{p.datum}</Text>
      </Group>
      <SimpleGrid cols={3} mb="sm">
        {kpi(`${k.checklistePct}%`, 'Checkliste', `${k.erledigt}/${k.gesamt}`, k.checklistePct === 100 ? 'teal' : k.checklistePct > 50 ? 'yellow.7' : undefined, 'checkliste')}
        {kpi(String(k.verkauft), 'Verkauft', `${k.notar} Notar`, 'teal', 'verkauft')}
        {kpi(`${k.erloesePct}%`, 'Erlöse', k.erloeseText, 'yellow.7', 'erloese')}
      </SimpleGrid>
      <Group gap="xs" data-feld="ampel">
        {k.pipGrn > 0 && <Badge variant="dot" tt="none" color="teal">{k.pipGrn} grün</Badge>}
        {k.pipYel > 0 && <Badge variant="dot" tt="none" color="orange">{k.pipYel} gelb</Badge>}
        {k.pipRed > 0 && <Badge variant="dot" tt="none" color="red">{k.pipRed} rot</Badge>}
        {!k.pipGrn && !k.pipYel && !k.pipRed && <Text fz={10} c="dimmed">PIP noch nicht bewertet</Text>}
      </Group>
    </Paper>
  );
}

/** pmNewProject / pmCreateProject */
function NeuesProjekt({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { data: deals = [] } = useProjektDealAuswahl(offen);
  const anlegen = useProjektAnlegen();
  const [dealId, setDealId] = useState<string | null>(null);
  const [adresse, setAdresse] = useState('');
  const [stadt, setStadt] = useState('');
  const [datum, setDatum] = useState(heuteIso());
  const [fehler, setFehler] = useState<string | null>(null);
  const zu = () => { setDealId(null); setAdresse(''); setStadt(''); setDatum(heuteIso()); setFehler(null); anlegen.reset(); schliessen(); };
  return (
    <Modal opened={offen} onClose={zu} title="🏗️ Neues Projekt anlegen">
      <Stack>
        <Select label="Aus Deal übernehmen (optional)" placeholder="– Kein Deal (manuell eingeben) –" clearable value={dealId}
          data={deals.map((d) => ({ value: d.id, label: `${d.adresse} ${d.stadt} (${d.angebotsDatum})` }))}
          description="Nur Deals mit Status „Angekauft“ werden angezeigt"
          onChange={(v) => {
            setDealId(v);
            const d = deals.find((x) => x.id === v);
            if (d) { setAdresse(d.adresse); setStadt(d.stadt); }
          }} />
        <TextInput label="Adresse" placeholder="Musterstraße 12" value={adresse} onChange={(e) => setAdresse(e.currentTarget.value)} />
        <TextInput label="Stadt" placeholder="Stuttgart" value={stadt} onChange={(e) => setStadt(e.currentTarget.value)} />
        <TextInput label="Datum Ankauf" type="date" value={datum} onChange={(e) => setDatum(e.currentTarget.value)} />
        {dealId && <Alert color="teal" variant="light">✅ Einheiten und Kalkulation werden aus dem Deal übernommen</Alert>}
        {(fehler ?? anlegen.error) && <Alert color="red">{fehler ?? anlegen.error!.message}</Alert>}
        <Group justify="flex-end">
          <Button loading={anlegen.isPending} onClick={() => {
            if (!adresse.trim()) { setFehler('Bitte Adresse eingeben'); return; }
            setFehler(null);
            anlegen.mutate({ dealId, adresse, stadt, datum: datum || heuteIso() }, { onSuccess: zu });
          }}>Projekt anlegen</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
