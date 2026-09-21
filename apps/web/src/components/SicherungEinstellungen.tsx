import { Alert, Badge, Button, Group, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useRef, useState } from 'react';
import {
  type AutoSicherung, useAutoSicherungAnlegen, useAutoSicherungEinspielen, useAutoSicherungen, useAutoSicherungPlan,
  useMaklerImport, useMaklerImportVorschau, useSicherungEinspielen, useSicherungPlan, useSicherungUmfang,
} from '../lib/api.ts';

/** 💾 Sicherung (Einstellungen): Export als Datei, Einspielen in zwei Schritten (Plan, dann Ausführen). */
export function SicherungEinstellungen() {
  const { data: umfang, isLoading } = useSicherungUmfang();
  const plan = useSicherungPlan();
  const einspielen = useSicherungEinspielen();
  const [datei, setDatei] = useState<unknown>(null);
  const eingabe = useRef<HTMLInputElement>(null);

  const waehlen = async (f: File | undefined) => {
    if (!f) return;
    const inhalt: unknown = JSON.parse(await f.text());
    setDatei(inhalt);
    plan.mutate(inhalt);
  };

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>💾 Sicherung</Title>
        <Text size="xs" c="dimmed">
          Der Export enthält den ganzen Datenbestand als JSON-Datei. Dateien (Fotos, Dokumente) liegen im Speicher und werden dort gesichert;
          ihre Zeilen samt Schlüssel sind Teil der Sicherung. Eingespielt wird ergänzend — vorhandene Zeilen werden aktualisiert, nichts wird gelöscht.
        </Text>
      </div>
      {isLoading && <Loader size="sm" />}
      {umfang && (
        <Text size="sm" data-sicherung-umfang>Aktuell gesichert würden <b>{umfang.gesamt.toLocaleString('de-DE')}</b> Zeilen aus {umfang.zeilen.length} Tabellen.</Text>
      )}
      <Group gap="xs">
        <Button size="xs" component="a" href="/api/sicherung/export" target="_blank" rel="noopener">⬇ Sicherung herunterladen</Button>
        <Button size="xs" variant="default" onClick={() => eingabe.current?.click()}>⬆ Sicherung einlesen…</Button>
        <input ref={eingabe} type="file" accept="application/json" hidden data-testid="sicherung-datei"
          onChange={(e) => { void waehlen(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </Group>

      {plan.error && <Alert color="red">{plan.error.message}</Alert>}
      {plan.data && (
        <Paper withBorder p="sm" aria-label="Einspielplan">
          <Text size="sm" fw={600} mb={4}>Plan für die Sicherung vom {new Date(plan.data.erzeugtAm).toLocaleString('de-DE')}</Text>
          <Text size="xs" c="dimmed" mb={6} data-plan-summe>{plan.data.gesamtNeu} neue und {plan.data.gesamtAktualisiert} zu aktualisierende Zeilen.</Text>
          {plan.data.unbekannt.length > 0 && <Alert color="orange" py={4} mb={6}>Unbekannte Tabellen in der Datei (werden übergangen): {plan.data.unbekannt.join(', ')}</Alert>}
          <Table verticalSpacing={2}>
            <Table.Thead><Table.Tr><Table.Th>Tabelle</Table.Th><Table.Th ta="right">in Datei</Table.Th><Table.Th ta="right">neu</Table.Th><Table.Th ta="right">aktualisiert</Table.Th><Table.Th ta="right">im Bestand</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {plan.data.zeilen.filter((z) => z.inDatei || z.imBestand).map((z) => (
                <Table.Tr key={z.tabelle} data-plan={z.tabelle}>
                  <Table.Td><Text size="xs">{z.tabelle}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="xs">{z.inDatei}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="xs" c={z.neu ? 'teal' : 'dimmed'}>{z.neu}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="xs" c={z.aktualisiert ? 'yellow.7' : 'dimmed'}>{z.aktualisiert}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="xs" c="dimmed">{z.imBestand}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="flex-end" mt="xs">
            <Button size="xs" color="orange" loading={einspielen.isPending}
              onClick={() => window.confirm(`${plan.data!.gesamtNeu} neue und ${plan.data!.gesamtAktualisiert} bestehende Zeilen schreiben?\n\nVorhandene Zeilen werden mit dem Stand aus der Sicherung überschrieben.`)
                && einspielen.mutate(datei)}>
              ⬆ Jetzt einspielen
            </Button>
          </Group>
        </Paper>
      )}
      {einspielen.data && <Alert color="teal">✅ {einspielen.data.geschrieben} Zeilen eingespielt.</Alert>}
      {einspielen.error && <Alert color="red">{einspielen.error.message}</Alert>}
      {umfang && (
        <Text size="xs" c="dimmed">
          Nicht in der Sicherung: {Object.entries(umfang.ausgenommen).map(([t, grund]) => `${t} (${grund})`).join(' · ')}
        </Text>
      )}
      <AutoSicherungen />
      <MaklerImport />
    </Stack>
  );
}

// Die vier Stufen. `safety` gehört sichtbar dazu — die Einträge entstehen ohne Zutun, und wer sie nicht erklärt bekommt, hält sie für einen Fehler.
const STUFEN: { stufe: AutoSicherung['stufe']; titel: string; hinweis: string }[] = [
  { stufe: 'daily', titel: '📅 Täglich', hinweis: 'planmäßig, ein Stand je Tag' },
  { stufe: 'weekly', titel: '📆 Wöchentlich', hinweis: 'planmäßig, montags' },
  { stufe: 'monthly', titel: '🗓 Monatlich', hinweis: 'planmäßig, am 1. des Monats' },
  { stufe: 'safety', titel: '🛟 Sicherheitskopien', hinweis: 'entstehen automatisch vor jeder Wiederherstellung — niemand löst sie von Hand aus' },
];
// Das Modul rechnet und benennt in UTC; angezeigt wird Berliner Zeit MIT Kennzeichnung — eine Uhrzeit ohne Zone
// verleitet im Sommer zu einem Zwei-Stunden-Irrtum darüber, welcher Stand der jüngste ist.
const berlin = (ts: string) => `${new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr (Berlin)`;
const groesse = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** 📦 Automatische Sicherungen verwalten (alt: „Auto-Backups verwalten"): Liste je Stufe, Download, Wiederherstellen mit Vorschau. */
function AutoSicherungen() {
  const { data, isLoading, error } = useAutoSicherungen();
  const anlegen = useAutoSicherungAnlegen();
  const plan = useAutoSicherungPlan();
  const einspielen = useAutoSicherungEinspielen();

  return (
    <div aria-label="Automatische Sicherungen">
      <Title order={4} mt="md">📦 Automatische Sicherungen</Title>
      <Text size="xs" c="dimmed" mb="xs">
        Jede Nacht legt die App eine Sicherung ab. Aufbewahrt werden {data ? `${data.aufbewahrung.daily} tägliche, ${data.aufbewahrung.weekly} wöchentliche, ${data.aufbewahrung.monthly} monatliche und ${data.aufbewahrung.safety} Sicherheitskopien` : '…'};
        der jüngste Stand bleibt immer. Fotos und Dokumente sichert ein eigener Lauf in ein Archiv, das nie löscht.
      </Text>
      {isLoading && <Loader size="sm" />}
      {error && <Alert color="orange" py={4}>{error.message}</Alert>}
      {data && STUFEN.map((s) => {
        const eintraege = data.eintraege.filter((e) => e.stufe === s.stufe);
        return (
          <div key={s.stufe} data-stufe={s.stufe}>
            <Text size="sm" fw={600} mt={8}>{s.titel} <Text span c="dimmed" fw={400}>({eintraege.length})</Text></Text>
            <Text fz={11} c="dimmed" mb={4}>{s.hinweis}</Text>
            {eintraege.length === 0 && <Text size="xs" c="dimmed">– keine –</Text>}
            {eintraege.map((e) => (
              <Paper key={e.key} withBorder p={6} mb={4} data-sicherung={e.key}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <div style={{ minWidth: 0 }}>
                    <Text size="xs" fw={600} component="div">{e.zahlen.deals} Deals · {e.zahlen.objekte} Objekte · {e.zahlen.makler} Makler <Badge size="xs" variant="light" color="gray">{e.zahlen.zeilen.toLocaleString('de-DE')} Zeilen</Badge></Text>
                    <Text fz={11} c="dimmed">{berlin(e.ts)} · {groesse(e.groesseBytes)}</Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="default" component="a" href={`/api/sicherung/auto/datei?key=${encodeURIComponent(e.key)}`} target="_blank" rel="noopener">⬇</Button>
                    <Button size="compact-xs" variant="default" loading={plan.isPending && plan.variables === e.key} onClick={() => plan.mutate(e.key)}>↩ Wiederherstellen</Button>
                  </Group>
                </Group>
              </Paper>
            ))}
          </div>
        );
      })}
      {plan.error && <Alert color="red" mt="xs">{plan.error.message}</Alert>}
      {plan.data && (
        <Paper withBorder p="sm" mt="xs" aria-label="Wiederherstellung — Vorschau">
          <Text size="sm" fw={600}>↩ Wiederherstellung — Vorschau</Text>
          <Text size="xs" c="dimmed" mb={6} data-auto-plan>
            Stand {berlin(plan.data.kopf.ts)}: {plan.data.gesamtNeu} neue und {plan.data.gesamtAktualisiert} zu aktualisierende Zeilen. Es wird nichts gelöscht.
            Vor dem Überschreiben legt die App automatisch eine Sicherheitskopie (🛟) des jetzigen Standes an.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => plan.reset()}>Abbrechen</Button>
            <Button size="xs" color="red" loading={einspielen.isPending}
              onClick={() => window.confirm(`Stand vom ${berlin(plan.data!.kopf.ts)} wiederherstellen?\n\nVorhandene Zeilen werden mit dem Stand aus der Sicherung überschrieben.`)
                && einspielen.mutate(plan.data!.kopf.key, { onSuccess: () => plan.reset() })}>
              ↩ Jetzt wiederherstellen
            </Button>
          </Group>
        </Paper>
      )}
      {einspielen.data && <Alert color="teal" mt="xs">✅ {einspielen.data.geschrieben} Zeilen wiederhergestellt. Sicherheitskopie des vorherigen Standes: {einspielen.data.sicherheitskopie}</Alert>}
      {einspielen.error && <Alert color="red" mt="xs">{einspielen.error.message}</Alert>}
      {anlegen.data?.aufbewahrung.hinweis && <Alert color="gray" mt="xs" py={4}>{anlegen.data.aufbewahrung.hinweis}</Alert>}
      {anlegen.error && <Alert color="red" mt="xs">{anlegen.error.message}</Alert>}
      <Button size="xs" mt="xs" variant="light" loading={anlegen.isPending} onClick={() => anlegen.mutate()}>🔄 Sicherung jetzt erstellen</Button>
    </div>
  );
}

/** 📊 Makler aus einer Tabelle importieren (alt: „Makler aus XLSX importieren“). */
function MaklerImport() {
  const vorschau = useMaklerImportVorschau();
  const uebernehmen = useMaklerImport();
  const [datei, setDatei] = useState<File | null>(null);
  const eingabe = useRef<HTMLInputElement>(null);

  return (
    <div>
      <Title order={4} mt="md">📊 Makler aus Tabelle importieren</Title>
      <Text size="xs" c="dimmed" mb="xs">
        .xlsx oder .xls: die Spalten werden anhand der Überschriften erkannt. Zeilen ohne Namen und Makler mit bereits bekannter E-Mail werden übersprungen.
      </Text>
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => eingabe.current?.click()}>Tabelle auswählen…</Button>
        <input ref={eingabe} type="file" accept=".xlsx,.xls" hidden data-testid="makler-tabelle"
          onChange={(e) => { const f = e.currentTarget.files?.[0] ?? null; setDatei(f); if (f) vorschau.mutate(f); e.currentTarget.value = ''; }} />
        {datei && <Text size="xs" c="dimmed">{datei.name}</Text>}
      </Group>
      {vorschau.error && <Alert color="red" mt="xs">{vorschau.error.message}</Alert>}
      {vorschau.data && (
        <Paper withBorder p="sm" mt="xs" aria-label="Import-Vorschau">
          <Text size="sm" data-import-zeilen>{vorschau.data.zeilen} Zeilen · erkannte Spalten: {Object.keys(vorschau.data.zuordnung).join(', ') || 'keine'}</Text>
          <Table mt={6} verticalSpacing={2}>
            <Table.Thead><Table.Tr>{Object.keys(vorschau.data.zuordnung).map((f) => <Table.Th key={f}><Text size="xs">{f}</Text></Table.Th>)}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {vorschau.data.vorschau.map((zeile, i) => (
                // eslint-disable-next-line react/no-array-index-key -- Vorschauzeilen haben keine Kennung
                <Table.Tr key={i}>{Object.keys(vorschau.data!.zuordnung).map((f) => <Table.Td key={f}><Text size="xs">{zeile[f]}</Text></Table.Td>)}</Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="flex-end" mt="xs">
            <Button size="xs" loading={uebernehmen.isPending} onClick={() => datei && uebernehmen.mutate({ datei, zuordnung: vorschau.data!.zuordnung })}>
              ✓ {vorschau.data.zeilen} Zeilen übernehmen
            </Button>
          </Group>
        </Paper>
      )}
      {uebernehmen.data && <Alert color="teal" mt="xs">✅ {uebernehmen.data.uebernommen} Makler übernommen, {uebernehmen.data.uebersprungen} übersprungen.</Alert>}
      {uebernehmen.error && <Alert color="red" mt="xs">{uebernehmen.error.message}</Alert>}
    </div>
  );
}
