import type { NachrichtEntwurf } from '@gg/api-contract';
import { personaStufe, whatsappNummer } from '@gg/domain';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEntwurf, usePersona } from '../../lib/api.ts';

/**
 * 🤖 KI-Entwurf auf der Makler-Karte (vtDraftSection): unter 20 % Konfidenz Hinweis, sonst „Nachricht entwerfen“;
 * Entwurf als WhatsApp- und E-Mail-Link mit Kopieren. Zwischengespeichert je Makler, Tag und Stand (alt: _draftCache).
 */
export function KiEntwurf({ maklerId, tel, email, stand, heute, stilOeffnen }: { maklerId: string; tel: string | null; email: string | null; stand: number; heute: string; stilOeffnen: () => void }) {
  const { data: persona } = usePersona();
  const qc = useQueryClient();
  const schluessel = ['entwurf', maklerId, heute, stand];
  const [entwurf, setEntwurf] = useState<NachrichtEntwurf | undefined>(() => qc.getQueryData(schluessel));
  const erstellen = useEntwurf(maklerId);
  const [meldung, setMeldung] = useState<string | null>(null);
  if (!persona) return null;
  const stufe = personaStufe(persona.konfidenz);
  const holen = () => erstellen.mutate(undefined, { onSuccess: (d) => { qc.setQueryData(schluessel, d); setEntwurf(d); }, onError: (e) => setMeldung(e.message) });

  if (persona.konfidenz < 20) {
    return (
      <Text size="xs" c="dimmed" ta="center" p={6} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        🤖 KI lernt noch — {stufe.fehlendFuerLernphase} weitere ausgehende Nachricht{stufe.fehlendFuerLernphase !== 1 ? 'en' : ''} nötig
        <Button size="compact-xs" variant="transparent" onClick={stilOeffnen}>Details →</Button>
      </Text>
    );
  }
  if (erstellen.isPending) return <Text size="xs" c="dimmed" ta="center" p={6}>⏳ KI schreibt Entwurf…</Text>;
  if (!entwurf) {
    return (
      <Stack gap={4}>
        <Button size="xs" variant="light" fullWidth onClick={holen}>🤖 Nachricht entwerfen {persona.konfidenz >= 80 ? '✦' : ''}</Button>
        {meldung && <Text size="xs" c="red">{meldung}</Text>}
      </Stack>
    );
  }
  const wa = whatsappNummer(tel);
  const vorschau = entwurf.email.body.length > 150 ? entwurf.email.body.substring(0, 150) + '…' : entwurf.email.body;
  return (
    <Paper withBorder p="xs" aria-label="KI-Entwurf">
      <Group justify="space-between" mb={6}>
        <Text fz={10} fw={700} tt="uppercase" c="yellow.7">🤖 KI-Entwurf</Text>
        <Button size="compact-xs" variant="subtle" title="Neu generieren" onClick={holen}>↺</Button>
      </Group>
      <Text size="xs" style={{ whiteSpace: 'pre-wrap' }} p={6} bg="var(--mantine-color-default-hover)" data-entwurf-wa>{entwurf.wa}</Text>
      <Group gap={6} my={6}>
        {wa && <Button size="xs" color="green" variant="light" component="a" href={`https://wa.me/${wa}?text=${encodeURIComponent(entwurf.wa)}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1 }}>📱 Als WA senden</Button>}
        <Button size="xs" variant="default" title="Text kopieren" onClick={() => void navigator.clipboard?.writeText(entwurf.wa)}>📋</Button>
      </Group>
      <Text fz={10} c="dimmed">✉️ {entwurf.email.subject}</Text>
      <Text fz={11} c="dimmed" style={{ whiteSpace: 'pre-wrap' }} p={6} bg="var(--mantine-color-default-hover)">{vorschau}</Text>
      <Group gap={6} mt={6}>
        {email && <Button size="xs" variant="light" component="a" href={`mailto:${email}?subject=${encodeURIComponent(entwurf.email.subject)}&body=${encodeURIComponent(entwurf.email.body)}`} style={{ flex: 1 }}>✉️ Als E-Mail öffnen</Button>}
        <Button size="xs" variant="default" title="E-Mail kopieren" onClick={() => void navigator.clipboard?.writeText(`${entwurf.email.subject}\n\n${entwurf.email.body}`)}>📋</Button>
      </Group>
    </Paper>
  );
}
