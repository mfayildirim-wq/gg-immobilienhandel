import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { abmelden, anmelden, anmeldungEingerichtet, sitzungStarten } from '../lib/sitzung.ts';

/**
 * Anmeldeschranke: ohne eingerichtete Anmeldung (lokal) läuft die App wie bisher durch.
 * Mit Anmeldung erscheint die Maske, bis eine Sitzung besteht.
 */
export function Anmeldeschranke({ children }: { children: React.ReactNode }) {
  const [sitzung, setSitzung] = useState<Session | null>(null);
  const [geladen, setGeladen] = useState(!anmeldungEingerichtet());

  useEffect(() => {
    if (!anmeldungEingerichtet()) return;
    void sitzungStarten((s) => setSitzung(s)).then((s) => { setSitzung(s); setGeladen(true); });
  }, []);

  if (!anmeldungEingerichtet()) return <>{children}</>;
  if (!geladen) return <Center h="100vh"><Text c="dimmed">Sitzung wird geprüft …</Text></Center>;
  if (!sitzung) return <Anmeldemaske />;
  return <>{children}</>;
}

function Anmeldemaske() {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const senden = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaeuft(true);
    setFehler('');
    const r = await anmelden(email, passwort);
    setLaeuft(false);
    if (!r.ok) setFehler(r.fehler ?? 'Anmeldung fehlgeschlagen');
  };

  return (
    <Center h="100vh" px="md">
      <Paper withBorder p="lg" w={380} component="form" onSubmit={senden} aria-label="Anmeldung">
        <Stack gap="sm">
          <Title order={4}>GG Immobilienhandel</Title>
          <Text size="xs" c="dimmed">Bitte mit E-Mail und Passwort anmelden.</Text>
          {fehler && <Alert color="red" py={6}>{fehler}</Alert>}
          <TextInput label="E-Mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
          <PasswordInput label="Passwort" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.currentTarget.value)} required />
          <Button type="submit" loading={laeuft}>Anmelden</Button>
        </Stack>
      </Paper>
    </Center>
  );
}

/** Abmelden im Kopfbereich — nur sichtbar, wenn eine Anmeldung eingerichtet ist. */
export function AbmeldenKnopf() {
  if (!anmeldungEingerichtet()) return null;
  return (
    <Button size="compact-sm" variant="subtle" onClick={() => void abmelden().then(() => location.reload())}>
      Abmelden
    </Button>
  );
}
