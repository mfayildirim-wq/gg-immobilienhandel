import type { ExposeAngabe, ExposeAngabenAntwort, ExposeUebernahme } from '@gg/api-contract';
import { Alert, Button, Group, Loader, Modal, Select, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { ExposeKonflikt, useExposeAngaben, useExposeUebernahme } from '../lib/api.ts';
import { datumDe } from '../lib/format.ts';

type Art = 'objekte' | 'makler';
type Wert = ExposeAngabe['wert'];

/** Jüngster Import zuerst. */
const importeSortiert = (importe: ExposeAngabenAntwort['importe']) => [...importe].sort((a, b) => b.datum.localeCompare(a.datum));

/** Die Zeilen des jüngsten Imports — der Reiter zeigt sie zuerst. */
export function neuesteAngaben(antwort: ExposeAngabenAntwort | undefined): ExposeAngabe[] {
  if (!antwort) return [];
  const neuester = importeSortiert(antwort.importe)[0]?.id;
  return antwort.angaben.filter((a) => a.importId === neuester);
}

/** Reiterbeschriftung „Aus dem Exposé (n)“: Zeilen, die noch nicht so im Datenmodell stehen (nur zählen). */
export const anzahlOffen = (angaben: ExposeAngabe[]) => angaben.filter((a) => a.ziel.status !== 'gleich').length;

/** Konfidenz-Punkt wie auf der Prüfseite: grün sicher · orange unsicher · rot nicht erkannt. */
export function KonfidenzPunkt({ konf }: { konf?: string | null }) {
  const farbe = konf === 'hoch' ? 'green' : konf === 'mittel' ? 'orange' : 'red';
  const tipp = konf === 'hoch' ? 'Sicher erkannt' : konf === 'mittel' ? 'Unsicher – bitte prüfen' : 'Nicht erkannt';
  return <span title={tipp} aria-label={tipp} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${farbe}-6)`, marginLeft: 6 }} />;
}

const wertText = (w: Wert | undefined, einheit: string | null): string => {
  if (w === null || w === undefined || w === '') return '–';
  if (typeof w === 'boolean') return w ? 'Ja' : 'Nein';
  const t = typeof w === 'number' ? w.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : w;
  return einheit ? `${t} ${einheit}` : t;
};

/** Spalte oder Zusatzangabe: die API nennt das Zielfeld, Zusatzangaben in `details` mit dem Präfix „details.“. */
const zielArt = (a: ExposeAngabe): ExposeUebernahme['ziel'] => (a.ziel.feld?.startsWith('details.') ? 'details' : 'spalte');

function Fundstelle({ a }: { a: ExposeAngabe }) {
  if (a.belegt === false) return <Text size="xs" c="red">nicht belegt</Text>;
  if (a.seite === null) return <Text size="xs" c="dimmed">–</Text>;
  return <Text size="xs" title={a.zitat ?? undefined} style={{ cursor: a.zitat ? 'help' : undefined }}>S. {a.seite}</Text>;
}

function ImDatenmodell({ a }: { a: ExposeAngabe }) {
  switch (a.ziel.status) {
    case 'gleich': return <Text size="sm" c="teal">✓ gleich</Text>;
    case 'abweichend': return <Text size="sm" c="orange">≠ abweichend <Text span c="dimmed" size="xs">· {wertText(a.ziel.aktuell, a.einheit)}</Text></Text>;
    case 'leer': return <Text size="sm" c="dimmed">leer</Text>;
    default: return <Text size="sm" c="dimmed">—</Text>;
  }
}

/**
 * Reiter „Aus dem Exposé“: alle Angaben der gespeicherten Analyse mit Fundstelle, Konfidenz und Vergleich zum Datenmodell.
 * Welche Angabe wohin gehört und ob sie gleich oder abweichend ist, entscheidet die API — hier wird nur gezeigt und geklickt.
 */
export function ExposeAngaben({ art, id, version }: { art: Art; id: string; version: number }) {
  const { data, isLoading, error } = useExposeAngaben(art, id);
  const uebernahme = useExposeUebernahme(art, id);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [ersetzen, setErsetzen] = useState<{ angabe: ExposeAngabe; aktuell: Wert } | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Exposé-Angaben nicht geladen'}</Alert>;

  const importe = importeSortiert(data.importe);
  const importId = importe.some((i) => i.id === gewaehlt) ? gewaehlt : importe[0]?.id ?? null;
  const zeilen = data.angaben.filter((a) => a.importId === importId);
  const wer = art === 'makler' ? 'Makler' : 'Objekt';

  const senden = (a: ExposeAngabe, ziel: ExposeUebernahme['ziel'], ersetzt = false) => {
    setMeldung(null);
    uebernahme.mutate({ version, importId: a.importId, feld: a.feld, ziel, ersetzen: ersetzt }, {
      onSuccess: () => setErsetzen(null),
      onError: (e) => {
        if (e instanceof ExposeKonflikt && e.aktuell !== undefined) { setErsetzen({ angabe: a, aktuell: e.aktuell }); return; }
        if (e instanceof ExposeKonflikt) { setMeldung(`${art === 'makler' ? 'Der Makler' : 'Das Objekt'} wurde zwischenzeitlich geändert — bitte neu laden.`); return; }
        setMeldung(e.message);
      },
    });
  };

  return (
    <Stack component="section" gap="sm" aria-label="Exposé-Angaben">
      {meldung && <Alert color="red" withCloseButton onClose={() => setMeldung(null)}>{meldung}</Alert>}
      {importe.length > 1 && (
        <Select size="xs" maw={420} aria-label="Exposé-Import" allowDeselect={false} value={importId} onChange={setGewaehlt}
          data={importe.map((i) => ({ value: i.id, label: `Exposé vom ${datumDe(i.datum)} · ${i.dateiname ?? 'ohne Dateiname'}` }))} />
      )}
      {zeilen.length === 0 ? (
        <Text size="sm" c="dimmed">Keine Exposé-Angaben zu diesem {wer}.</Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped verticalSpacing={4} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Gruppe</Table.Th><Table.Th>Angabe</Table.Th><Table.Th>Wert</Table.Th><Table.Th>Fundstelle</Table.Th>
                <Table.Th>Konfidenz</Table.Th><Table.Th>Im Datenmodell</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {zeilen.map((a) => (
                <Table.Tr key={`${a.importId}:${a.feld}`} data-feld={a.feld} data-status={a.ziel.status}>
                  <Table.Td c="dimmed" fz="xs">{a.gruppe}</Table.Td>
                  <Table.Td>{a.bezeichnung}</Table.Td>
                  <Table.Td fw={600} data-wert>{wertText(a.wert, a.einheit)}</Table.Td>
                  <Table.Td><Fundstelle a={a} /></Table.Td>
                  <Table.Td>{a.konfidenz ? <KonfidenzPunkt konf={a.konfidenz} /> : <Text size="xs" c="dimmed">–</Text>}</Table.Td>
                  <Table.Td><ImDatenmodell a={a} /></Table.Td>
                  <Table.Td>
                    {a.ziel.status === 'leer' && (
                      <Button size="compact-xs" variant="light" disabled={uebernahme.isPending} onClick={() => senden(a, zielArt(a))}>Übernehmen</Button>
                    )}
                    {a.ziel.status === 'abweichend' && (
                      <Button size="compact-xs" variant="light" color="orange" disabled={uebernahme.isPending} onClick={() => setErsetzen({ angabe: a, aktuell: a.ziel.aktuell })}>Ersetzen</Button>
                    )}
                    {a.ziel.status === 'keinFeld' && art === 'objekte' && (
                      <Button size="compact-xs" variant="subtle" disabled={uebernahme.isPending} onClick={() => senden(a, 'notizen')}>In Notizen</Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={!!ersetzen} onClose={() => setErsetzen(null)} title="Wert ersetzen?">
        {ersetzen && (
          <Stack gap="sm">
            <Text size="sm">{ersetzen.angabe.bezeichnung}{ersetzen.angabe.ziel.label ? ` → ${ersetzen.angabe.ziel.label}` : ''}</Text>
            <Group grow>
              <div>
                <Text fz={10} c="dimmed" tt="uppercase">Im Datenmodell</Text>
                <Text fw={600} data-wert="aktuell">{wertText(ersetzen.aktuell, ersetzen.angabe.einheit)}</Text>
              </div>
              <div>
                <Text fz={10} c="dimmed" tt="uppercase">Aus dem Exposé</Text>
                <Text fw={600} data-wert="expose">{wertText(ersetzen.angabe.wert, ersetzen.angabe.einheit)}</Text>
              </div>
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setErsetzen(null)}>Abbrechen</Button>
              <Button color="orange" loading={uebernahme.isPending} onClick={() => senden(ersetzen.angabe, zielArt(ersetzen.angabe), true)}>Ersetzen</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
