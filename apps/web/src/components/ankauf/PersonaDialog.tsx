import { personaStufe } from '@gg/domain';
import { Alert, Button, Modal, Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import { usePersona, usePersonaAnalysieren } from '../../lib/api.ts';

/** 🧠 KI-Stil (personaRenderModal): Konfidenz, Analyse starten, Stilprofil. */
export function PersonaDialog({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { data } = usePersona();
  const analysieren = usePersonaAnalysieren();
  const stufe = personaStufe(data?.konfidenz ?? 0);
  const p = data?.profil;
  return (
    <Modal opened={offen} onClose={schliessen} title="🧠 Kommunikationsstil" size="lg" closeButtonProps={{ 'aria-label': 'Schließen' }}>
      {data && (
        <Stack>
          <div>
            <Text size="sm" fw={700} mb={4}>{stufe.label} <Text span fz={18} fw={700} c={stufe.farbe} ml="sm" data-konfidenz>{data.konfidenz}%</Text></Text>
            <Progress value={data.konfidenz} color={stufe.farbe} />
            <Text size="xs" c="dimmed" mt={4}>{data.ausgehend} ausgehende Nachrichten gespeichert{stufe.fehlendFuerLernphase ? ` · noch ${stufe.fehlendFuerLernphase} weitere für Lernphase` : ''}</Text>
          </div>
          <Button variant="light" loading={analysieren.isPending} onClick={() => analysieren.mutate()}>{p ? '↺ Neu analysieren (Sonnet)' : '🧠 Kommunikationsstil analysieren (Sonnet)'}</Button>
          {analysieren.isPending && <Text size="xs" c="dimmed" ta="center">⏳ Claude Sonnet analysiert deinen Kommunikationsstil…</Text>}
          {analysieren.error && <Alert color="red">❌ Fehler: {analysieren.error.message}</Alert>}
          {p ? (
            <>
              <SimpleGrid cols={2} spacing="xs">
                {([['Anrede', p.anrede], ['Ton WA', p.tonWA], ['Ton E-Mail', p.tonEmail], ['Länge WA', p.laenge.wa], ['Länge E-Mail', p.laenge.email], ['Themen', p.themenMuster], ['Vokabular', p.vokabular], ['Abschluss WA', p.abschluss.wa]] as const).map(([l, v]) => (
                  <Paper key={l} withBorder p="xs"><Text fz={10} fw={700} c="dimmed" tt="uppercase">{l}</Text><Text size="xs">{v || '–'}</Text></Paper>
                ))}
              </SimpleGrid>
              <Paper withBorder p="sm" bg="var(--mantine-primary-color-light)"><Text fz={10} fw={700} tt="uppercase">🧠 Kerncharakter</Text><Text size="xs">{p.rawAnalysis || '–'}</Text></Paper>
              <Text fz={10} c="dimmed" ta="right">Analysiert: {new Date(p.analysisTs).toLocaleDateString('de-DE')} · {p.commAnalyzed} Einträge ausgewertet</Text>
            </>
          ) : <Text size="sm" c="dimmed" ta="center" p="lg">Noch kein Profil vorhanden — klicke „Analysieren“ um zu starten.</Text>}
        </Stack>
      )}
    </Modal>
  );
}
