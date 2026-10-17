import type { FirmendatenErgebnis, FirmenFeld, Unternehmen } from '@gg/api-contract';
import { FIRMEN_FELD_LABEL } from '@gg/domain';
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useFirmendatenPruefen, useUnternehmen, useUnternehmenAendern, useUnternehmenLoeschen, useUnternehmenZusammenfuehren } from '../lib/api.ts';

/** 🏢 Unternehmen der Makler (Normalform 17.10.2026): Liste, Bearbeiten (mit Impressum-Prüfung), Zusammenführen, Löschen ohne Makler. */
export function UnternehmenEinstellungen() {
  const { data = [], isLoading, error } = useUnternehmen();
  const loeschen = useUnternehmenLoeschen();
  const zusammen = useUnternehmenZusammenfuehren();
  const [suche, setSuche] = useState('');
  const [bearbeiten, setBearbeiten] = useState<Unternehmen | null>(null);
  const [weg, setWeg] = useState<Unternehmen | null>(null);
  const [behaltenId, setBehaltenId] = useState<string | null>(null);
  const q = suche.trim().toLowerCase();
  const liste = data.filter((u) => !q || u.name.toLowerCase().includes(q) || (u.domain ?? '').includes(q) || (u.ort ?? '').toLowerCase().includes(q));
  const fehler = error ?? loeschen.error ?? zusammen.error;

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>🏢 Unternehmen</Title>
        <TextInput size="xs" placeholder="Suchen (Name, Domain, Ort)" value={suche} onChange={(e) => setSuche(e.currentTarget.value)} w={260} aria-label="Unternehmen suchen" />
      </Group>
      <Text size="xs" c="dimmed">
        Die Firma eines Maklers ist ein Unternehmen aus dieser Liste. Im Makler-Dialog genügt der Name: vorhandene Unternehmen werden verknüpft, neue angelegt.
        Doppelte Schreibweisen hier zusammenführen — die Makler wandern mit.
      </Text>
      {fehler && <Alert color="red">{fehler.message}</Alert>}
      {isLoading ? <Loader size="sm" /> : (
        <Table striped highlightOnHover verticalSpacing={4} aria-label="Unternehmen">
          <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Rechtsform</Table.Th><Table.Th>Webseite</Table.Th><Table.Th>Ort</Table.Th><Table.Th>Makler</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {liste.map((u) => (
              <Table.Tr key={u.id} data-unternehmen={u.id}>
                <Table.Td>
                  {u.name}{u.quelle === 'hubspot' || u.notizen?.includes('Name prüfen') ? <Badge ml={6} size="xs" color="yellow" variant="light">Name prüfen</Badge> : null}
                  {u.geprueftAm && <Text span size="xs" c="dimmed" ml={6} title="Zuletzt gegen das Impressum geprüft">✓ {datumKurz(u.geprueftAm)}</Text>}
                </Table.Td>
                <Table.Td c="dimmed">{u.rechtsform ?? ''}</Table.Td>
                <Table.Td>{u.webseite ? <Anchor size="sm" href={`https://${u.webseite.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer">{u.webseite}</Anchor> : <Text size="sm" c="dimmed">{u.domain ?? ''}</Text>}</Table.Td>
                <Table.Td c="dimmed">{[u.plz, u.ort].filter(Boolean).join(' ')}</Table.Td>
                <Table.Td>{u.maklerAnzahl}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Button size="compact-xs" variant="default" onClick={() => setBearbeiten(u)}>Bearbeiten</Button>
                    <Button size="compact-xs" variant="default" onClick={() => { setWeg(u); setBehaltenId(null); }}>Zusammenführen</Button>
                    <Button size="compact-xs" variant="subtle" color="red" disabled={u.maklerAnzahl > 0} title={u.maklerAnzahl > 0 ? 'Hat noch Makler — erst zusammenführen' : undefined}
                      onClick={() => loeschen.mutate(u.id)}>Löschen</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {!liste.length && <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed">Keine Unternehmen.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      )}

      {bearbeiten && <BearbeitenDialog u={bearbeiten} schliessen={() => setBearbeiten(null)} />}

      <Modal opened={!!weg} onClose={() => setWeg(null)} title={`„${weg?.name ?? ''}“ zusammenführen`} closeButtonProps={{ 'aria-label': 'Schließen' }}>
        <Stack>
          <Text size="sm">Alle {weg?.maklerAnzahl ?? 0} Makler wechseln zum gewählten Unternehmen, leere Felder dort werden ergänzt, „{weg?.name}“ wandert in den Papierkorb.</Text>
          <Select label="Behalten" searchable placeholder="Unternehmen wählen" value={behaltenId} onChange={setBehaltenId}
            data={data.filter((u) => u.id !== weg?.id).map((u) => ({ value: u.id, label: `${u.name}${u.ort ? ` · ${u.ort}` : ''} (${u.maklerAnzahl})` }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setWeg(null)}>Abbrechen</Button>
            <Button disabled={!behaltenId} loading={zusammen.isPending}
              onClick={() => weg && behaltenId && zusammen.mutate({ behaltenId, wegId: weg.id }, { onSuccess: () => setWeg(null) })}>Zusammenführen</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

const datumKurz = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

const felderAus = (u: Unternehmen) => ({
  name: u.name, webseite: u.webseite ?? '', strasse: u.strasse ?? '', plz: u.plz ?? '', ort: u.ort ?? '', tel: u.tel ?? '', fax: u.fax ?? '', email: u.email ?? '', notizen: u.notizen ?? '',
});

function BearbeitenDialog({ u: start, schliessen }: { u: Unternehmen; schliessen: () => void }) {
  // Die Impressum-Prüfung ändert das Unternehmen serverseitig (leere Felder, geprüft-Datum, Version) — der Dialog folgt dem Ergebnis
  const [u, setU] = useState(start);
  const aendern = useUnternehmenAendern(u.id);
  const pruefen = useFirmendatenPruefen(u.id);
  const [f, setF] = useState(felderAus(start));
  const [ergebnis, setErgebnis] = useState<FirmendatenErgebnis | null>(null);
  const feld = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <TextInput label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.currentTarget.value })} {...extra} />
  );
  const impressumPruefen = (erneut = false) => pruefen.mutate({ erneut }, {
    onSuccess: (e) => {
      setErgebnis(e);
      setU(e.unternehmen);
      // Serverseitig gefüllte Felder auch im Formular zeigen; was der Nutzer gerade tippt, bleibt
      setF((alt) => {
        const neu = { ...alt };
        for (const k of e.uebernommen) if (k !== 'rechtsform' && !alt[k].trim()) neu[k] = e.unternehmen[k] ?? '';
        if (!alt.webseite.trim() && e.unternehmen.webseite) neu.webseite = e.unternehmen.webseite;
        return neu;
      });
    },
  });
  const uebernehmen = (a: { feld: FirmenFeld; ermittelt: string }) => {
    if (a.feld === 'rechtsform') return;
    setF({ ...f, [a.feld]: a.ermittelt });
    setErgebnis(ergebnis && { ...ergebnis, abweichend: ergebnis.abweichend.filter((x) => x.feld !== a.feld) });
  };
  const offeneAbweichungen = ergebnis?.abweichend.filter((a) => a.feld !== 'rechtsform') ?? [];
  return (
    <Modal opened onClose={schliessen} title="Unternehmen bearbeiten" closeButtonProps={{ 'aria-label': 'Schließen' }} size="lg">
      <Stack>
        {aendern.error && <Alert color="red">{aendern.error.message}</Alert>}
        {pruefen.error && <Alert color="red">{pruefen.error.message}</Alert>}
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">
            {u.geprueftAm ? `Zuletzt gegen das Impressum geprüft am ${datumKurz(u.geprueftAm)}` : 'Noch nicht gegen das Impressum geprüft'}
            {u.domain ? ` · ${u.domain}` : ' · keine Domain bekannt (Webseite oder E-Mail eintragen)'}
          </Text>
          <Group gap={4}>
            <Button size="compact-xs" variant="light" loading={pruefen.isPending} onClick={() => impressumPruefen(false)} title="Impressum der Webseite lesen: leere Felder werden gefüllt, Abweichungen vorgeschlagen">🌐 Impressum prüfen</Button>
            {ergebnis?.ausCache && <Button size="compact-xs" variant="subtle" loading={pruefen.isPending} onClick={() => impressumPruefen(true)} title="Zwischenspeicher übergehen und die Seite neu holen">neu holen</Button>}
          </Group>
        </Group>
        {ergebnis && (
          <Alert color={ergebnis.gefunden ? (offeneAbweichungen.length ? 'yellow' : 'green') : 'gray'} variant="light" p="xs" aria-label="Impressum-Ergebnis">
            <Stack gap={4}>
              {ergebnis.gefunden ? (
                <Text size="xs">
                  Impressum gelesen{ergebnis.url && <> von <Anchor size="xs" href={ergebnis.url} target="_blank" rel="noreferrer">{ergebnis.url.replace(/^https?:\/\//, '')}</Anchor></>}
                  {ergebnis.ausCache ? ` (Stand ${datumKurz(ergebnis.abgerufenAt)})` : ''}{ergebnis.mitKi ? '' : ' · ohne KI, nur Regeln'}.
                  {ergebnis.uebernommen.length ? ` Übernommen: ${ergebnis.uebernommen.map((k) => FIRMEN_FELD_LABEL[k]).join(', ')}.` : ''}
                  {!ergebnis.uebernommen.length && !offeneAbweichungen.length ? ' Alles stimmt überein.' : ''}
                </Text>
              ) : (
                <Text size="xs">Kein Impressum unter {ergebnis.domain} gefunden{ergebnis.ausCache ? ` (zuletzt versucht ${datumKurz(ergebnis.abgerufenAt)})` : ''}.</Text>
              )}
              {offeneAbweichungen.map((a) => (
                <Group key={a.feld} gap={6} wrap="nowrap" data-abweichung={a.feld}>
                  <Text size="xs" fw={600} w={70}>{FIRMEN_FELD_LABEL[a.feld]}</Text>
                  <Text size="xs" c="dimmed" td="line-through">{a.aktuell}</Text>
                  <Text size="xs">{a.ermittelt}</Text>
                  <Button size="compact-xs" variant="default" onClick={() => uebernehmen(a)}>Übernehmen</Button>
                </Group>
              ))}
            </Stack>
          </Alert>
        )}
        <SimpleGrid cols={2} spacing="xs">
          {feld('name', 'Name')}
          {feld('webseite', 'Webseite', { placeholder: 'beispiel-immo.de' })}
          {feld('tel', 'Telefon', { type: 'tel' })}
          {feld('fax', 'Fax', { type: 'tel' })}
          {feld('email', 'E-Mail (zentral)', { type: 'email' })}
        </SimpleGrid>
        {feld('strasse', 'Straße und Hausnummer')}
        <SimpleGrid cols={2} spacing="xs">
          {feld('plz', 'PLZ', { maxLength: 10 })}
          {feld('ort', 'Ort')}
        </SimpleGrid>
        <Textarea label="Notizen" autosize minRows={2} value={f.notizen} onChange={(e) => setF({ ...f, notizen: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">Rechtsform: {u.rechtsform ?? '–'} · Domain: {u.domain ?? '–'} · Quelle: {u.quelle ?? '–'}{u.geprueftAm ? ` · geprüft ${u.geprueftAm.slice(0, 10)}` : ''}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={schliessen}>Abbrechen</Button>
          <Button loading={aendern.isPending} onClick={() => aendern.mutate({ version: u.version, ...f }, { onSuccess: schliessen })}>Speichern</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
