import { Alert, Center, Loader, Stack, Text } from '@mantine/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useM365Rueckweg } from '../lib/api.ts';

/** Rückweg von Microsoft: Code gegen Token tauschen, dann zurück in die Einstellungen. */
export function M365Rueckweg() {
  const { code, state, error_description: fehler } = useSearch({ from: '/m365/rueckweg' });
  const rueckweg = useM365Rueckweg();
  const navigate = useNavigate();
  const gestartet = useRef(false);

  useEffect(() => {
    if (gestartet.current || !code || !state) return;
    gestartet.current = true;
    rueckweg.mutate({ code, state }, { onSuccess: () => void navigate({ to: '/einstellungen/m365' as '/einstellungen' }) });
  }, [code, state, rueckweg, navigate]);

  return (
    <Center h="60vh">
      <Stack align="center" gap="xs">
        {fehler && <Alert color="red">Microsoft meldet: {fehler}</Alert>}
        {rueckweg.error && <Alert color="red">{rueckweg.error.message}</Alert>}
        {!fehler && !rueckweg.error && <Loader size="sm" />}
        <Text size="sm" c="dimmed">{rueckweg.isPending ? 'Verbindung wird hergestellt …' : 'Rückweg von Microsoft 365'}</Text>
      </Stack>
    </Center>
  );
}
