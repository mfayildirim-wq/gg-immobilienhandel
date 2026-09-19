import type { GespeicherterFilter } from '@gg/api-contract';
import { describeFilter, type FilterCriterion, filterFuerModul, type SavedFilter } from '@gg/domain';
import { ActionIcon, Button, Group, Menu, Modal, Paper, Stack, Text } from '@mantine/core';
import { IconBookmark, IconCheck, IconDeviceFloppy, IconSettings } from '@tabler/icons-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFilter, useFilterAnlegen, useFilterLoeschen, useFilterUmbenennen, useFilterVorlagen } from '../lib/api.ts';

type Modul = GespeicherterFilter['module'];
const MODUL_LABEL: Record<Modul, string> = { deals: 'Deal-Tracking', ankauf: 'Ankauf', makler: 'Maklerdatenbank', objects: 'Objektdatenbank' };

// Aktiver Filter je Modul: wie alt nur im Speicher der laufenden Sitzung (_activeFilters), über Seitenwechsel hinweg
const aktiv: Record<Modul, string | null> = { deals: null, ankauf: null, makler: null, objects: null };
const hoerer = new Set<() => void>();
const setzeAktiv = (m: Modul, id: string | null) => { aktiv[m] = id; hoerer.forEach((h) => h()); };
const abonnieren = (h: () => void) => { hoerer.add(h); return () => { hoerer.delete(h); }; };

/** getActiveFilter: der aktive gespeicherte Filter des Moduls (null = ungefiltert). */
export function useAktiverFilter(modul: Modul): SavedFilter | null {
  const id = useSyncExternalStore(abonnieren, () => aktiv[modul]);
  const { data = [] } = useFilter();
  return (data.find((f) => f.id === id) as SavedFilter | undefined) ?? null;
}

/**
 * Filterleiste (savedFiltersUI.ts): Auswahl, Aktiv-Hinweis, „Aktuelle als Filter speichern…“, „Verwalten“.
 * Beim ersten Anzeigen je Modul werden fehlende Vorlagen angelegt — erst, wenn der Serverstand bekannt ist.
 */
export function GespeicherteFilterLeiste({ modul, aktuelleKriterien }: { modul: Modul; aktuelleKriterien?: FilterCriterion[] }) {
  const { data: alle, isSuccess } = useFilter();
  const vorlagen = useFilterVorlagen();
  const anlegen = useFilterAnlegen();
  const eingerichtet = useRef(false);
  useEffect(() => {
    if (isSuccess && !eingerichtet.current) { eingerichtet.current = true; vorlagen.mutate(modul); }
  }, [isSuccess, modul, vorlagen]);
  const aktivId = useSyncExternalStore(abonnieren, () => aktiv[modul]);
  const filter = filterFuerModul((alle ?? []) as SavedFilter[], modul);
  const aktiverFilter = filter.find((f) => f.id === aktivId) ?? null;
  const [verwalten, setVerwalten] = useState(false);
  const [meldung, setMeldung] = useState<{ farbe: string; text: string } | null>(null);
  useEffect(() => { if (!meldung) return; const t = setTimeout(() => setMeldung(null), 4000); return () => clearTimeout(t); }, [meldung]);

  return (
    <Group gap={6} wrap="nowrap" aria-label="Gespeicherte Filter">
      {/* Was gerade filtert, steht links vom Knopf — sichtbar, ohne das Menü zu öffnen. */}
      {meldung
        ? <Text size="xs" c={meldung.farbe} fw={600}>{meldung.text}</Text>
        : aktiverFilter
          ? <Text size="xs" c="dimmed" fw={600} title={describeFilter(aktiverFilter)} data-aktiver-filter>Filter: {aktiverFilter.name}</Text>
          : null}
      <Menu position="bottom-end" width={260} withinPortal shadow="md">
        <Menu.Target>
          <Button
            size="compact-sm"
            variant={aktiverFilter ? 'light' : 'default'}
            aria-label="Gespeicherte Filter"
            leftSection={<IconBookmark size={15} />}
          >
            {aktiverFilter ? '1' : 'Filter'}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{MODUL_LABEL[modul]}</Menu.Label>
          <Menu.Item data-filter-option="— Kein Filter —" onClick={() => setzeAktiv(modul, null)}
            rightSection={!aktivId ? <IconCheck size={14} /> : undefined}>
            — Kein Filter —
          </Menu.Item>
          {filter.map((f) => (
            <Menu.Item key={f.id} data-filter-option={f.name} data-filter-id={f.id} title={describeFilter(f)} onClick={() => setzeAktiv(modul, f.id)}
              rightSection={f.id === aktivId ? <IconCheck size={14} /> : undefined}>
              {f.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          {aktuelleKriterien && (
            <Menu.Item leftSection={<IconDeviceFloppy size={14} />} onClick={() => {
              if (aktuelleKriterien.length === 0) { setMeldung({ farbe: 'red', text: 'Keine Filter aktiv — wähle erst Status/Suche/Chip' }); return; }
              const name = window.prompt('Name für den gespeicherten Filter:');
              if (!name || !name.trim()) return;
              anlegen.mutate({ module: modul, name: name.trim(), criteria: aktuelleKriterien as GespeicherterFilter['criteria'] }, {
                onSuccess: (f) => { setzeAktiv(modul, f.id); setMeldung({ farbe: 'teal', text: `✅ Filter „${f.name}" gespeichert` }); },
                onError: (e) => setMeldung({ farbe: 'red', text: e.message }),
              });
            }}>
              Aktuelle als Filter speichern…
            </Menu.Item>
          )}
          <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => setVerwalten(true)}>⚙️ Verwalten</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {verwalten && <FilterVerwalten modul={modul} filter={filter} schliessen={() => setVerwalten(false)} />}
    </Group>
  );
}

function FilterVerwalten({ modul, filter, schliessen }: { modul: Modul; filter: SavedFilter[]; schliessen: () => void }) {
  const umbenennen = useFilterUmbenennen();
  const loeschen = useFilterLoeschen();
  return (
    <Modal opened onClose={schliessen} title={`🔖 Filter verwalten — ${MODUL_LABEL[modul]}`} size="lg">
      <Stack gap="xs">
        {filter.length === 0 && <Text c="dimmed" ta="center" p="md" size="sm">Noch keine Filter gespeichert.</Text>}
        {filter.map((f) => (
          <Paper key={f.id} withBorder p="xs" data-filter={f.name}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>{f.name}</Text>
              <Group gap={4} wrap="nowrap">
                <ActionIcon variant="subtle" aria-label={`${f.name} umbenennen`} onClick={() => {
                  const name = window.prompt('Neuer Name:', f.name);
                  if (!name || !name.trim() || name.trim() === f.name) return;
                  umbenennen.mutate({ id: f.id, name: name.trim() });
                }}>✏️</ActionIcon>
                <ActionIcon variant="subtle" color="red" aria-label={`${f.name} löschen`} onClick={() => {
                  if (!window.confirm(`Filter „${f.name}" wirklich löschen?`)) return;
                  loeschen.mutate(f.id, { onSuccess: () => { if (aktiv[modul] === f.id) setzeAktiv(modul, null); } });
                }}>🗑</ActionIcon>
              </Group>
            </Group>
            <Text fz={11} c="dimmed" ff="monospace" data-beschreibung>{describeFilter(f)}</Text>
          </Paper>
        ))}
      </Stack>
    </Modal>
  );
}
