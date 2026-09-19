import { globaleSuche, SUCHE_HINWEIS_KURZ, SUCHE_HINWEIS_LEER, SUCHE_HINWEIS_OHNE_TREFFER, type SucheTreffer } from '@gg/domain';
import { Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useListen } from '../lib/api.ts';

/** 🔍 Suche (globalSearch): Adresse, Name, Telefon, PLZ — je Bereich höchstens fünf Treffer. */
export function GlobaleSuche({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { data } = useListen();
  const [eingabe, setEingabe] = useState('');
  const navigate = useNavigate();
  const treffer = useMemo(
    () => (data ? globaleSuche(data.objekte, data.deals, data.makler, eingabe) : null),
    [data, eingabe],
  );

  const gehe = (ziel: { to: string; search: Record<string, string> }) => {
    schliessen();
    setEingabe('');
    void navigate(ziel as never);
  };
  const bereiche: { titel: string; treffer: SucheTreffer[]; oeffnen: (id: string) => void }[] = treffer
    ? [
        { titel: `🏢 Objekte (${treffer.objekte.length})`, treffer: treffer.objekte, oeffnen: (objekt: string) => gehe({ to: '/objekte', search: { objekt } }) },
        { titel: `📋 Deals (${treffer.deals.length})`, treffer: treffer.deals, oeffnen: (deal: string) => gehe({ to: '/deals', search: { deal } }) },
        { titel: `🤝 Makler (${treffer.makler.length})`, treffer: treffer.makler, oeffnen: (makler: string) => gehe({ to: '/makler', search: { makler } }) },
      ].filter((b) => b.treffer.length)
    : [];

  return (
    <Modal opened={offen} onClose={schliessen} title="🔍 Suche" size="lg">
      <TextInput
        data-autofocus
        type="search"
        aria-label="Suche"
        placeholder="Adresse, Name, Telefon, PLZ…"
        value={eingabe}
        onChange={(e) => setEingabe(e.currentTarget.value)}
        mb="sm"
      />
      {!eingabe.trim() && <Text size="sm" c="dimmed">{SUCHE_HINWEIS_LEER}</Text>}
      {eingabe.trim() && treffer === null && <Text size="sm" c="dimmed">{SUCHE_HINWEIS_KURZ}</Text>}
      {treffer?.gesamt === 0 && <Text size="sm" c="dimmed" ta="center" py="md">{SUCHE_HINWEIS_OHNE_TREFFER}</Text>}
      <Stack gap={4}>
        {bereiche.map((b) => (
          <div key={b.titel}>
            <Text fz={10} fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '.08em' }} py={4}>{b.titel}</Text>
            {b.treffer.map((t) => (
              <UnstyledButton key={t.id} onClick={() => b.oeffnen(t.id)} data-treffer={t.id}
                style={{ display: 'block', width: '100%', padding: '8px 10px', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Text fw={600} size="sm">{t.titel.trim() || '–'}</Text>
                <Text fz={11} c="dimmed">{t.zusatz.trim()}</Text>
              </UnstyledButton>
            ))}
          </div>
        ))}
      </Stack>
    </Modal>
  );
}
