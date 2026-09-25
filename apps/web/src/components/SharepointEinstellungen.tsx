import { Alert, Anchor, Badge, Button, Code, Group, List, Loader, Paper, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useSharepoint, useSharepointAbgleich, useSharepointKonfiguration, useSharepointMigration, useSharepointMigrieren, useSharepointTest } from '../lib/api.ts';

/**
 * 📂 SharePoint (Einstellungen, Protokoll 19): Site und Wurzelordner eintragen, Verbindung prüfen, einschalten.
 * Die Azure-App (Client-ID, Tenant, Geheimnis) ist dieselbe wie unter Microsoft 365 — dort einmal eintragen.
 * Solange der Schalter aus ist, bleiben neue Dokumente in Supabase; Bestände bleiben ohnehin, wo sie liegen.
 */
export function SharepointEinstellungen() {
  const { data, isLoading, error } = useSharepoint();
  const speichern = useSharepointKonfiguration();
  const test = useSharepointTest();
  const { data: bestand } = useSharepointMigration();
  const migrieren = useSharepointMigrieren();
  const abgleich = useSharepointAbgleich();
  const [form, setForm] = useState<{ siteUrl: string; wurzel: string; aktiv: boolean } | null>(null);
  const werte = form ?? { siteUrl: data?.siteUrl ?? '', wurzel: data?.wurzel ?? data?.wurzelStandard ?? '', aktiv: data?.aktiv ?? false };
  const geaendert = form !== null && (form.siteUrl !== data?.siteUrl || form.wurzel !== data?.wurzel || form.aktiv !== data?.aktiv);

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>📂 SharePoint</Title>
        <Text size="xs" c="dimmed">
          Dokumente an Deals und Objekten in einer SharePoint-Dokumentbibliothek ablegen — Ordner je Objekt, Deals als Unterordner.
          Die App greift mit eigener Berechtigung nur auf diese eine Site zu (<Code>Sites.Selected</Code>); Anwender brauchen keinen SharePoint-Zugang.
        </Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {data && (
        <>
          <Group gap="xs">
            <Badge variant="light" tt="none" color={data.aktiv ? 'teal' : data.siteUrl ? 'yellow' : 'gray'} data-sharepoint-status>
              {data.aktiv ? 'aktiv — neue Dokumente gehen nach SharePoint' : data.siteUrl ? 'eingerichtet, nicht aktiv' : 'nicht eingerichtet'}
            </Badge>
            {!data.m365Eingerichtet && (
              <Text size="xs" c="orange">
                Azure-App fehlt: erst unter <Anchor component={Link} to="/einstellungen/m365" size="xs">Microsoft 365</Anchor> Client-ID, Tenant und Geheimnis eintragen.
              </Text>
            )}
          </Group>

          <Paper withBorder p="sm">
            <Text size="sm" fw={600} mb={6}>Site und Ablage</Text>
            <Stack gap="xs">
              <TextInput size="xs" label="Site-Adresse" placeholder="https://firma.sharepoint.com/sites/GGImmohandel" value={werte.siteUrl}
                onChange={(e) => setForm({ ...werte, siteUrl: e.currentTarget.value })} />
              <TextInput size="xs" label="Wurzelordner in der Dokumentbibliothek" placeholder={data.wurzelStandard} value={werte.wurzel}
                onChange={(e) => setForm({ ...werte, wurzel: e.currentTarget.value })} />
              <Switch size="sm" label="SharePoint aktiv — neue Dokumente dort ablegen" checked={werte.aktiv} disabled={!werte.siteUrl || !data.m365Eingerichtet}
                onChange={(e) => setForm({ ...werte, aktiv: e.currentTarget.checked })} />
              <Group gap="xs">
                <Button size="xs" loading={speichern.isPending} disabled={!geaendert}
                  onClick={() => speichern.mutate(werte, { onSuccess: () => setForm(null) })}>
                  Speichern
                </Button>
                <Button size="xs" variant="light" loading={test.isPending} disabled={!data.siteUrl || !data.m365Eingerichtet || geaendert}
                  onClick={() => test.mutate()}>
                  Verbindung prüfen
                </Button>
                {geaendert && <Text size="xs" c="dimmed">erst speichern, dann prüfen</Text>}
              </Group>
            </Stack>
            {speichern.error && <Alert color="red" mt="xs">{speichern.error.message}</Alert>}
            {test.error && <Alert color="red" mt="xs" title="Verbindung fehlgeschlagen" data-sharepoint-test="fehler">{test.error.message}</Alert>}
            {test.data && (
              <Alert color="teal" mt="xs" title={`Verbindung steht (${test.data.dauerMs} ms)`} data-sharepoint-test="ok">
                <List size="xs">{test.data.schritte.map((s) => <List.Item key={s}>{s}</List.Item>)}</List>
                <Anchor href={test.data.webUrl} target="_blank" rel="noopener" size="xs">Ordner in SharePoint öffnen</Anchor>
              </Alert>
            )}
          </Paper>

          <Paper withBorder p="sm" aria-label="Bestand und Abgleich">
            <Text size="sm" fw={600} mb={6}>Bestand und Abgleich</Text>
            <Text size="xs" c="dimmed" mb={6}>
              {bestand ? `${bestand.inSupabase} Dokument${bestand.inSupabase === 1 ? '' : 'e'} in Supabase · ${bestand.inSharepoint} in SharePoint${bestand.fehlend ? ` · ${bestand.fehlend} in SharePoint nicht mehr gefunden` : ''}` : '…'}
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="light" loading={migrieren.isPending} disabled={!data.aktiv || !bestand?.inSupabase} onClick={() => migrieren.mutate(25)}>
                Bestand nach SharePoint übertragen (25 je Lauf)
              </Button>
              <Button size="xs" variant="default" loading={abgleich.isPending} disabled={!data.aktiv || !bestand?.inSharepoint} onClick={() => abgleich.mutate()}>
                Abgleich mit SharePoint
              </Button>
            </Group>
            {migrieren.data && (
              <Alert color={migrieren.data.fehler.length ? 'orange' : 'teal'} mt="xs" data-sharepoint-migration>
                {migrieren.data.migriert} übertragen, noch {migrieren.data.offen} offen{migrieren.data.offen > 0 && !migrieren.data.fehler.length ? ' — erneut klicken für das nächste Bündel' : ''}.
                {migrieren.data.fehler.length > 0 && <List size="xs" mt={4}>{migrieren.data.fehler.map((f) => <List.Item key={f}>{f}</List.Item>)}</List>}
              </Alert>
            )}
            {abgleich.data && (
              <Alert color={abgleich.data.verschwunden || abgleich.data.fehler.length ? 'orange' : 'teal'} mt="xs" data-sharepoint-abgleich>
                {abgleich.data.geprueft} geprüft · {abgleich.data.verschoben} in SharePoint verschoben oder umbenannt (eingeholt) · {abgleich.data.verschwunden} nicht mehr gefunden · {abgleich.data.zurueck} wieder da
                {abgleich.data.fehler.length > 0 && <List size="xs" mt={4}>{abgleich.data.fehler.map((f) => <List.Item key={f}>{f}</List.Item>)}</List>}
              </Alert>
            )}
            {(migrieren.error || abgleich.error) && <Alert color="red" mt="xs">{(migrieren.error ?? abgleich.error)!.message}</Alert>}
            <Text fz={10} c="dimmed" mt={6}>
              Übertragen kopiert nach SharePoint und stellt die Zeile um; die Datei in Supabase bleibt als Rückweg liegen. Der Abgleich findet Dateien über ihre Kennung wieder, auch wenn sie in SharePoint verschoben wurden; Verschwundenes wird datiert, nie gelöscht.
            </Text>
          </Paper>

          <Paper withBorder p="sm">
            <Text size="sm" fw={600} mb={6}>Einrichtung in Microsoft Entra (einmalig, Administrator)</Text>
            <List size="xs" type="ordered">
              <List.Item>App-Registrierung (dieselbe wie unter Microsoft 365): API-Berechtigung <Code>Sites.Selected</Code> als <b>Anwendungsberechtigung</b> hinzufügen, Administratorzustimmung erteilen.</List.Item>
              <List.Item>Der App Schreibrechte auf genau diese Site geben — im Graph Explorer als Administrator: <Code>POST /sites/{'{site-id}'}/permissions</Code> mit <Code>{'{ "roles": ["write"], "grantedToIdentities": [ { "application": { "id": "<Client-ID>" } } ] }'}</Code>.</List.Item>
              <List.Item>Hier die Site-Adresse eintragen, speichern, „Verbindung prüfen“, dann einschalten.</List.Item>
            </List>
            <Text fz={10} c="dimmed" mt={6}>
              Ablage: <Code>{werte.wurzel || data.wurzelStandard}/Objekte/&lt;Adresse&gt; [&lt;objekt-id&gt;]/…</Code> und <Code>…/Deals/&lt;deal-id&gt;/…</Code>. Vorhandene Dokumente bleiben in Supabase lesbar.
            </Text>
          </Paper>
        </>
      )}
    </Stack>
  );
}
