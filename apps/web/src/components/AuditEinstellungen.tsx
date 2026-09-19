import { AUDIT_AUFRAEUM_TAGE, AUDIT_ENTITAETEN, AUDIT_TYPEN, auditZeile } from '@gg/domain';
import { Alert, Button, Group, Loader, NativeSelect, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useAudit, useAuditAufraeumen, useAuditPruefen } from '../lib/api.ts';

/** 📋 Audit-Log (Einstellungen): Filter, Liste, Export, Hash-Kette prüfen, Aufräumen. */
export function AuditEinstellungen() {
  const [filter, setFilter] = useState({ type: '', entity: '', von: '', bis: '', suche: '' });
  const { data, isLoading, error } = useAudit({ ...filter, limit: 500 });
  const pruefen = useAuditPruefen();
  const aufraeumen = useAuditAufraeumen();
  const zeilen = data?.zeilen ?? [];

  return (
    <Stack gap="sm">
      <Title order={4}>📋 Audit-Log</Title>
      <Group gap="xs">
        <NativeSelect size="xs" aria-label="Typ" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.currentTarget.value })}
          data={AUDIT_TYPEN.map((t) => ({ value: t.wert, label: t.label }))} />
        <NativeSelect size="xs" aria-label="Entität" value={filter.entity} onChange={(e) => setFilter({ ...filter, entity: e.currentTarget.value })}
          data={AUDIT_ENTITAETEN.map((t) => ({ value: t.wert, label: t.label }))} />
        <TextInput size="xs" type="date" aria-label="Von" value={filter.von} onChange={(e) => setFilter({ ...filter, von: e.currentTarget.value })} />
        <TextInput size="xs" type="date" aria-label="Bis" value={filter.bis} onChange={(e) => setFilter({ ...filter, bis: e.currentTarget.value })} />
      </Group>
      <TextInput size="xs" type="search" aria-label="Audit durchsuchen" placeholder="Suche in Werten / IDs / Metadaten…" value={filter.suche}
        onChange={(e) => setFilter({ ...filter, suche: e.currentTarget.value })} />

      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      <Text size="xs" c="dimmed" data-audit-zaehler>
        {zeilen.length.toLocaleString('de-DE')} Einträge{data && data.gesamt > zeilen.length ? ` (von insgesamt ${data.gesamt.toLocaleString('de-DE')})` : ''}
      </Text>

      <Paper withBorder p="xs" style={{ maxHeight: 480, overflowY: 'auto' }} aria-label="Audit-Liste">
        {zeilen.length === 0 && !isLoading && <Text size="xs" c="dimmed" ta="center" p="md">Keine Einträge</Text>}
        {zeilen.map((z) => {
          const a = auditZeile(z);
          return (
            <div key={z.id} data-audit={z.id} style={{ padding: '6px 4px', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Text size="xs">{a.kopf}</Text>
              {a.wert && <Text fz={10} c="dimmed" style={{ fontFamily: 'ui-monospace, monospace' }}>{a.wert}</Text>}
            </div>
          );
        })}
      </Paper>

      <Group gap="xs">
        <Button size="xs" component="a" href="/api/audit/export.json" target="_blank" rel="noopener">💾 Als JSON exportieren</Button>
        <Button size="xs" variant="default" component="a" href="/api/audit/export.csv" target="_blank" rel="noopener">📊 Als CSV exportieren</Button>
        <Button size="xs" variant="default" loading={pruefen.isPending} onClick={() => pruefen.mutate()}>🔐 Hash-Kette prüfen</Button>
        <Button size="xs" variant="subtle" color="orange" loading={aufraeumen.isPending}
          onClick={() => window.confirm(`Einträge älter als ${AUDIT_AUFRAEUM_TAGE} Tage endgültig entfernen?\n\nEin Anker bleibt zurück, damit die Kette prüfbar bleibt.`) && aufraeumen.mutate(AUDIT_AUFRAEUM_TAGE)}>
          🗑 Älter als {AUDIT_AUFRAEUM_TAGE} Tage löschen
        </Button>
      </Group>
      {pruefen.data && (
        <Alert color={pruefen.data.ok ? 'teal' : 'red'} data-kette>
          {pruefen.data.ok
            ? `✅ Kette in Ordnung — ${pruefen.data.checkedRows} von ${pruefen.data.totalRows} Einträgen geprüft${pruefen.data.anker ? ` (ab Anker #${pruefen.data.anker.auditId})` : ''}.`
            : `❌ Kette gebrochen bei Eintrag #${pruefen.data.brokenAt?.id}. ${pruefen.data.note ?? ''}`}
        </Alert>
      )}
      {aufraeumen.data && <Alert color="teal">{aufraeumen.data.entfernt} Einträge entfernt, Anker gesetzt.</Alert>}
    </Stack>
  );
}
