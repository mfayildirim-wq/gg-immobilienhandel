import type { ExposeAngabe, ExposeAngabenAntwort } from '@gg/api-contract';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Select, Spoiler, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { ApiFehler, ExposeKonflikt, useExposeAngaben, useExposeUebernahme } from '../lib/api.ts';
import { datumDe } from '../lib/format.ts';

type Art = 'objekte' | 'makler';
type Wert = ExposeAngabe['ziel']['aktuell'];
type Ziel = ExposeAngabenAntwort['ziele'][number];

/** Jüngster Import zuerst. */
const importeSortiert = (importe: ExposeAngabenAntwort['importe']) => [...importe].sort((a, b) => b.datum.localeCompare(a.datum));

/** Die Zeilen des jüngsten Imports — der Reiter zeigt sie zuerst. */
export function neuesteAngaben(antwort: ExposeAngabenAntwort | undefined): ExposeAngabe[] {
  if (!antwort) return [];
  const neuester = importeSortiert(antwort.importe)[0]?.id;
  return antwort.angaben.filter((a) => a.importId === neuester);
}

/** Einheiten-Zeilen (`einheiten.*`) zeigen nur die Mietliste; sie werden nicht einzeln zugeordnet. */
export const istEinheit = (a: Pick<ExposeAngabe, 'feld'>) => a.feld.startsWith('einheiten.');

/** Reiterbeschriftung „Aus dem Exposé (n)“: Angaben, die noch nicht so im Datenmodell stehen (nur zählen). */
export const anzahlOffen = (angaben: ExposeAngabe[]) => angaben.filter((a) => !istEinheit(a) && a.ziel.status !== 'gleich').length;

/** Konfidenz-Punkt wie auf der Prüfseite: grün sicher · orange unsicher · rot nicht erkannt. */
export function KonfidenzPunkt({ konf }: { konf?: string | null }) {
  const farbe = konf === 'hoch' ? 'green' : konf === 'mittel' ? 'orange' : 'red';
  const tipp = konf === 'hoch' ? 'Sicher erkannt' : konf === 'mittel' ? 'Unsicher – bitte prüfen' : 'Nicht erkannt';
  return <span title={tipp} aria-label={tipp} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${farbe}-6)`, marginLeft: 6 }} />;
}

/** Gespeicherten bzw. gelesenen Wert anzeigen (Zahl deutsch, Ja/Nein). */
export const wertText = (w: Wert | undefined, einheit?: string | null): string => {
  if (w === null || w === undefined || w === '') return '–';
  if (typeof w === 'boolean') return w ? 'Ja' : 'Nein';
  const t = typeof w === 'number' ? w.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : w;
  return einheit ? `${t} ${einheit}` : t;
};

/** Wert wörtlich aus dem Exposé; lange Texte eingeklappt. */
export function Wortlaut({ text }: { text: string }) {
  if (text.length <= 160) return <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{text || '–'}</Text>;
  return (
    <Spoiler maxHeight={44} showLabel="mehr" hideLabel="weniger" styles={{ control: { fontSize: 12 } }}>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{text}</Text>
    </Spoiler>
  );
}

/** Wörtliche Bezeichnung, darunter klein die Standard-Bezeichnung. */
export function Bezeichnung({ a }: { a: Pick<ExposeAngabe, 'bezeichnung' | 'standard'> }) {
  return (
    <div>
      <Text size="sm">{a.bezeichnung}</Text>
      {a.standard && a.standard !== a.bezeichnung && <Text fz={11} c="dimmed">{a.standard}</Text>}
    </div>
  );
}

/** Seite, ✓ wenn der Wert auf der Seite steht. */
export function Fundstelle({ a }: { a: Pick<ExposeAngabe, 'seite' | 'belegt'> }) {
  if (a.seite === null) return <Text size="xs" c="dimmed">–</Text>;
  return (
    <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
      S. {a.seite}
      {a.belegt === true && <Text span c="teal" title="Wert steht auf dieser Seite"> ✓</Text>}
      {a.belegt === false && <Text span c="orange" title="Wert nicht auf dieser Seite gefunden"> ?</Text>}
    </Text>
  );
}

function StatusBadge({ a, einheit }: { a: ExposeAngabe; einheit: string | null }) {
  switch (a.ziel.status) {
    case 'gleich': return <Badge size="sm" color="teal" variant="light">gleich</Badge>;
    case 'abweichend': return <Group gap={4} wrap="nowrap"><Badge size="sm" color="orange" variant="light">abweichend</Badge><Text size="xs" c="dimmed">{wertText(a.ziel.aktuell, einheit)}</Text></Group>;
    case 'leer': return <Badge size="sm" color="gray" variant="light">leer</Badge>;
    default: return null;
  }
}

const NOTIZEN = 'notizen';

/** Dropdown-Einträge: freie Felder zuerst, belegte mit „(belegt)“; der Vorschlag ist markiert. */
function zielOptionen(ziele: Ziel[], vorschlag: string | null) {
  const eintrag = (z: Ziel) => ({ value: z.schluessel, label: `${z.label}${z.einheit ? ` (${z.einheit})` : ''}${z.leer ? '' : ' (belegt)'}${z.schluessel === vorschlag ? ' · Vorschlag' : ''}` });
  const frei = ziele.filter((z) => z.leer).map(eintrag);
  const belegt = ziele.filter((z) => !z.leer).map(eintrag);
  return [
    ...(frei.length ? [{ group: 'Frei', items: frei }] : []),
    ...(belegt.length ? [{ group: 'Belegt', items: belegt }] : []),
    { group: 'Sonstiges', items: [{ value: NOTIZEN, label: 'In Notizen' }] },
  ];
}

type Ersetzen = { angabe: ExposeAngabe; ziel: string; zielLabel: string | null; aktuell: Wert; einheit: string | null };

/**
 * Reiter „Aus dem Exposé“: alle erfassten Angaben der gespeicherten Analyse — wörtlich, mit Seite und Vergleich zum Datenmodell.
 * Automatisch zugeordnete Angaben (Mapping) lassen sich übernehmen bzw. ersetzen; die übrigen per Dropdown einem gg-Feld
 * oder den Notizen zuordnen. Ob ein Wert passt und was geschrieben wird, entscheidet die API.
 */
export function ExposeAngaben({ art, id, version }: { art: Art; id: string; version: number }) {
  const { data, isLoading, error } = useExposeAngaben(art, id);
  const uebernahme = useExposeUebernahme(art, id);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [auswahl, setAuswahl] = useState<Record<string, string | null>>({});
  const [ersetzen, setErsetzen] = useState<Ersetzen | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  /** Zeilen, deren Zuordnung nicht im Wörterbuch gemerkt werden soll (Standard: merken) */
  const [nichtMerken, setNichtMerken] = useState<Record<string, boolean>>({});

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Exposé-Angaben nicht geladen'}</Alert>;

  const importe = importeSortiert(data.importe);
  const importId = importe.some((i) => i.id === gewaehlt) ? gewaehlt : importe[0]?.id ?? null;
  const zeilen = data.angaben.filter((a) => a.importId === importId);
  const wer = art === 'makler' ? 'Makler' : 'Objekt';
  const zielInfo = (s: string | null) => data.ziele.find((z) => z.schluessel === s) ?? null;
  const gruppen = [...new Set(zeilen.map((a) => a.gruppe))];

  const senden = (a: ExposeAngabe, ziel: string, ersetzt = false) => {
    setMeldung(null);
    uebernahme.mutate({ version, importId: a.importId, feld: a.feld, ziel, ersetzen: ersetzt, ...(nichtMerken[`${a.importId}:${a.feld}`] ? { merken: false } : {}) }, {
      onSuccess: () => setErsetzen(null),
      onError: (e) => {
        if (e instanceof ExposeKonflikt && e.aktuell !== undefined) {
          const z = zielInfo(ziel);
          setErsetzen({ angabe: a, ziel, zielLabel: z?.label ?? null, aktuell: e.aktuell, einheit: z?.einheit ?? null });
          return;
        }
        setErsetzen(null);
        if (e instanceof ExposeKonflikt) { setMeldung(`${art === 'makler' ? 'Der Makler' : 'Das Objekt'} wurde zwischenzeitlich geändert — bitte neu laden.`); return; }
        if (e instanceof ApiFehler && e.status === 422) { setMeldung(`Wert passt nicht zu diesem Feld: „${a.wert}“`); return; }
        setMeldung(e.message);
      },
    });
  };

  const zeile = (a: ExposeAngabe) => {
    const schluessel = `${a.importId}:${a.feld}`;
    const einheit = zielInfo(a.ziel.feld)?.einheit ?? null;
    const perMapping = a.zuordnung === 'zugeordnet' && a.ziel.quelle === 'mapping';
    const frei = !istEinheit(a) && a.zuordnung !== 'zugeordnet';
    const vorschlag = a.ziel.quelle === 'vorschlag' ? a.ziel.feld : null;
    const wahl = schluessel in auswahl ? auswahl[schluessel]! : vorschlag;
    return (
      <Table.Tr key={schluessel} data-feld={a.feld} data-status={a.ziel.status}>
        <Table.Td><Bezeichnung a={a} />{a.zuordnung === 'doppelt' && <Badge size="xs" color="yellow" variant="light" mt={2}>doppelt</Badge>}</Table.Td>
        <Table.Td data-wert maw={320}><Wortlaut text={a.wert} /></Table.Td>
        <Table.Td><Fundstelle a={a} /></Table.Td>
        <Table.Td>
          {perMapping && (
            <Stack gap={2}>
              <Text size="xs" c="dimmed">→ {a.ziel.label ?? a.ziel.feld}</Text>
              <Group gap={6} wrap="nowrap">
                <StatusBadge a={a} einheit={einheit} />
                {a.ziel.status === 'leer' && (
                  <Button size="compact-xs" variant="light" disabled={uebernahme.isPending} onClick={() => senden(a, a.ziel.feld!)}>Übernehmen</Button>
                )}
                {a.ziel.status === 'abweichend' && (
                  <Button size="compact-xs" variant="light" color="orange" disabled={uebernahme.isPending}
                    onClick={() => setErsetzen({ angabe: a, ziel: a.ziel.feld!, zielLabel: a.ziel.label, aktuell: a.ziel.aktuell, einheit })}>Ersetzen</Button>
                )}
              </Group>
            </Stack>
          )}
          {frei && (
            <Stack gap={4}>
              {a.ziel.feld && a.ziel.status === 'gleich' && <Group gap={4}><Text size="xs" c="dimmed">→ {a.ziel.label}</Text><StatusBadge a={a} einheit={einheit} /></Group>}
              <Group gap={6} wrap="nowrap">
                <Select size="xs" w={240} aria-label="Übernehmen in …" placeholder="Übernehmen in …" searchable clearable
                  data={zielOptionen(data.ziele, vorschlag)} value={wahl} onChange={(v) => setAuswahl((s) => ({ ...s, [schluessel]: v }))} />
                <Button size="compact-xs" variant="light" disabled={!wahl || uebernahme.isPending} onClick={() => wahl && senden(a, wahl)}>Übernehmen</Button>
              </Group>
              <Checkbox size="xs" data-merken={a.feld} label="für künftige Importe merken" checked={!nichtMerken[schluessel]}
                onChange={(e) => setNichtMerken((m) => ({ ...m, [schluessel]: !e.currentTarget.checked }))} />
              {a.ziel.hinweis && <Text fz={11} c="dimmed">{a.ziel.hinweis}</Text>}
            </Stack>
          )}
          {!perMapping && !frei && <Text size="sm" c="dimmed">—</Text>}
        </Table.Td>
      </Table.Tr>
    );
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
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing={4} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr><Table.Th>Bezeichnung</Table.Th><Table.Th>Wert (wörtlich)</Table.Th><Table.Th>Seite</Table.Th><Table.Th>Ziel / Status</Table.Th></Table.Tr>
            </Table.Thead>
            {gruppen.map((g) => (
              <Table.Tbody key={g} data-gruppe={g}>
                {gruppen.length > 1 && (
                  <Table.Tr><Table.Td colSpan={4}><Text fz={11} fw={700} c="dimmed" tt="uppercase">{g}</Text></Table.Td></Table.Tr>
                )}
                {zeilen.filter((a) => a.gruppe === g).map(zeile)}
              </Table.Tbody>
            ))}
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={!!ersetzen} onClose={() => setErsetzen(null)} title="Wert ersetzen?">
        {ersetzen && (
          <Stack gap="sm">
            <Text size="sm">{ersetzen.angabe.bezeichnung}{ersetzen.zielLabel ? ` → ${ersetzen.zielLabel}` : ''}</Text>
            <Text size="sm">Das Feld hat schon einen Wert. Ersetzen?</Text>
            <Group grow align="flex-start">
              <div>
                <Text fz={10} c="dimmed" tt="uppercase">Im Datenmodell</Text>
                <Text fw={600} data-wert="aktuell">{wertText(ersetzen.aktuell, ersetzen.einheit)}</Text>
              </div>
              <div>
                <Text fz={10} c="dimmed" tt="uppercase">Aus dem Exposé</Text>
                <Text fw={600} data-wert="expose">{ersetzen.angabe.wert}</Text>
              </div>
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setErsetzen(null)}>Abbrechen</Button>
              <Button color="orange" loading={uebernahme.isPending} onClick={() => senden(ersetzen.angabe, ersetzen.ziel, true)}>Ersetzen</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
