import type { DealDetail } from '@gg/api-contract';
import { kkEinheitVerkaufspreis } from '@gg/domain';
import { Alert, Button, Checkbox, Group, Modal, Radio, Stack, Text, TextInput } from '@mantine/core';
import { IconBuilding, IconHome, IconPlus } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useKundenkalkAnlegen, useKundenkalkulationen } from '../../lib/api.ts';
import { euro } from '../../lib/format.ts';
import { KkZeile } from '../kundenkalk/KkListe.tsx';

const alsKk = (e: DealDetail['einheiten'][number]) => ({ id: e.id, typ: e.typ, lage: e.lage, fl: e.flaeche, mi_ist: e.mieteIst, mi_neu: e.mieteNeu, rend_k: e.renditeK, vkp: e.verkaufspreis });

/** Reiter „Kundenkalkulation“ im Deal: Liste (Global zuerst), neu als Globalverkauf oder Aufteiler (Einheit + Stellplätze). */
export function DealKundenkalkulationen({ deal }: { deal: DealDetail }) {
  const { data: liste = [], isLoading } = useKundenkalkulationen(deal.id);
  const anlegen = useKundenkalkAnlegen(deal.id);
  const navigate = useNavigate();
  const [aufteilerOffen, setAufteilerOffen] = useState(false);
  const oeffnen = (id: string) => navigate({ to: '/kundenkalkulationen/$id', params: { id } });
  const wohnungen = deal.einheiten.filter((e) => e.typ !== 'Stellplatz');

  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={600}>💼 Kundenkalkulationen ({liste.length})</Text>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconBuilding size={14} />} loading={anlegen.isPending} onClick={() => anlegen.mutate({ scope: 'global' }, { onSuccess: (k) => oeffnen(k.id) })}>
            Globalverkauf
          </Button>
          {wohnungen.length > 0 && (
            <Button size="xs" variant="default" leftSection={<IconHome size={14} />} onClick={() => setAufteilerOffen(true)}>
              Aufteiler …
            </Button>
          )}
        </Group>
      </Group>
      {anlegen.error && <Alert color="red">{anlegen.error.message}</Alert>}
      {isLoading && <Text c="dimmed">Lädt …</Text>}
      {!isLoading && liste.length === 0 && (
        <Stack align="center" py="lg" gap={2}>
          <Text size="xl">📋</Text>
          <Text>Noch keine Kundenkalkulation für diesen Deal</Text>
          <Text size="xs" c="dimmed">„Globalverkauf“ oder „Aufteiler …“ wählen, um zu starten</Text>
        </Stack>
      )}
      <Stack gap="xs">{liste.map((k) => <KkZeile key={k.id} k={k} />)}</Stack>
      <AufteilerDialog deal={deal} offen={aufteilerOffen} schliessen={() => setAufteilerOffen(false)} anlegen={(e) => anlegen.mutate({ scope: 'aufteiler', ...e }, { onSuccess: (k) => oeffnen(k.id) })} />
    </Stack>
  );
}

function AufteilerDialog({ deal, offen, schliessen, anlegen }: { deal: DealDetail; offen: boolean; schliessen: () => void; anlegen: (e: { einheitId: string; stellplatzIds: string[]; name?: string }) => void }) {
  const wohnungen = deal.einheiten.filter((e) => e.typ !== 'Stellplatz');
  const stellplaetze = deal.einheiten.filter((e) => e.typ === 'Stellplatz');
  const [einheitId, setEinheitId] = useState<string | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string[]>([]);
  const [name, setName] = useState('');
  const einheit = wohnungen.find((e) => e.id === einheitId);

  return (
    <Modal opened={offen} onClose={schliessen} title="Aufteiler-Kalkulation" size="lg" closeButtonProps={{ 'aria-label': 'Schließen' }}>
      <Stack>
        <Radio.Group label="Einheit" value={einheitId} onChange={(v) => { setEinheitId(v); setName(''); }}>
          <Stack gap={6} mt={6}>
            {wohnungen.map((e, i) => (
              <Radio key={e.id} value={e.id} label={
                <Group gap="md"><Text size="sm" fw={600}>{e.lage || `Einheit ${i + 1}`}</Text><Text size="xs" c="dimmed">{e.typ} · {e.flaeche ? `${e.flaeche.toLocaleString('de-DE')} m²` : '–'}</Text><Text size="sm" c="green">{euro(kkEinheitVerkaufspreis(alsKk(e)))}</Text></Group>
              } />
            ))}
          </Stack>
        </Radio.Group>
        {einheit && stellplaetze.length > 0 && (
          <Checkbox.Group label="🅿️ Stellplätze dazu?" value={gewaehlt} onChange={setGewaehlt}>
            <Stack gap={6} mt={6}>
              {stellplaetze.map((s, i) => (
                <Checkbox key={s.id} value={s.id} label={<Group gap="md"><Text size="sm">{`Stellplatz ${i + 1}${s.lage ? ` — ${s.lage}` : ''}`}</Text><Text size="sm" c="green">{euro(kkEinheitVerkaufspreis(alsKk(s)))}</Text></Group>} />
              ))}
            </Stack>
          </Checkbox.Group>
        )}
        {einheit && <TextInput label="Name der Kalkulation" placeholder={`Kalkulation ${einheit.lage || 'Einheit'}`} value={name} onChange={(e) => setName(e.currentTarget.value)} />}
        <Group justify="flex-end">
          <Button disabled={!einheitId} leftSection={<IconPlus size={16} />} onClick={() => { anlegen({ einheitId: einheitId!, stellplatzIds: gewaehlt, ...(name.trim() ? { name: name.trim() } : {}) }); schliessen(); }}>
            Kalkulation anlegen
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
