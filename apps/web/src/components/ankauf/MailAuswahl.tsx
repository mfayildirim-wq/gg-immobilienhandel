import { mailAuswahl, vorlagenKontextDeal, vorlagenKontextMakler } from '@gg/domain';
import { Button, Modal, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import { useState } from 'react';
import { useListen, useVorlagen } from '../../lib/api.ts';

/**
 * ✉️ E-Mail-Vorlage wählen (vtDealMailPicker / vtMaklerMailPicker): echte mailto-Links je Vorlage, Platzhalter aufgelöst.
 * Ohne E-Mail-Vorlagen öffnet der Knopf direkt eine leere Mail.
 */
export function MailAuswahl({ email, dealId, makler, kompakt }: { email: string; dealId?: string; makler?: { name?: string | null; firma?: string | null }; kompakt?: boolean }) {
  const [offen, setOffen] = useState(false);
  const { data: vorlagen } = useVorlagen();
  const { data: listen } = useListen();
  const meinName = vorlagen?.meinName ?? '';
  const deal = dealId ? listen?.deals.find((d) => d.id === dealId) : null;
  const ctx = deal ? vorlagenKontextDeal(deal, listen?.objekte.find((o) => o.id === deal.objId) ?? null, meinName) : vorlagenKontextMakler(makler ?? {}, meinName);
  const eintraege = mailAuswahl(email, vorlagen?.vorlagen ?? [], ctx);
  const knopf = kompakt
    ? <Button size="xs" variant="default" aria-label="E-Mail" onClick={() => (eintraege.length ? setOffen(true) : window.location.assign(`mailto:${email}`))}><IconMail size={14} /></Button>
    : <Button size="xs" variant="default" leftSection={<IconMail size={14} />} title="E-Mail mit Vorlage" onClick={() => (eintraege.length ? setOffen(true) : window.location.assign(`mailto:${email}`))}>{email}</Button>;
  return (
    <>
      {knopf}
      <Modal opened={offen} onClose={() => setOffen(false)} title="✉️ E-Mail-Vorlage wählen" closeButtonProps={{ 'aria-label': 'Schließen' }}>
        <Text size="xs" c="dimmed" mb="sm">An: {email}</Text>
        <Stack gap={8}>
          {eintraege.map((e) => (
            <UnstyledButton key={e.id} component="a" href={e.href} onClick={() => setTimeout(() => setOffen(false), 50)} data-mailvorlage={e.name}
              style={{ display: 'block', padding: '10px 14px', border: '1px solid var(--mantine-color-default-border)', borderRadius: 6 }}>
              <Text size="sm" fw={600}>{e.name}</Text>
              {e.betreff && <Text size="xs" c="dimmed">{e.betreff}</Text>}
            </UnstyledButton>
          ))}
          <UnstyledButton component="a" href={`mailto:${email}`} onClick={() => setTimeout(() => setOffen(false), 50)}
            style={{ display: 'block', textAlign: 'center', padding: 9, border: '1px dashed var(--mantine-color-default-border)', borderRadius: 6 }}>
            <Text size="xs" c="dimmed">Leere E-Mail (ohne Vorlage)</Text>
          </UnstyledButton>
        </Stack>
      </Modal>
    </>
  );
}
