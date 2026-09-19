import type { BsAktion, BsVordruck, BsVorlage, BsZeile } from '@gg/api-contract';
import {
  BS_AKTION_LABEL, BS_ANALYSETYPEN, BS_DATENQUELLEN, BS_MODULE, BS_PLATZHALTER, bsEigenePunkte, bsNewId, bsVerschieben, bsZeileEinfuegen, bsZeileLoeschen,
  type BsRow, type BsVorlage as BsVorlageDomain,
} from '@gg/domain';
import { ActionIcon, Alert, Badge, Button, Checkbox, Code, Group, Paper, ScrollArea, SegmentedControl, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconRestore, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useSofortSpeichern } from '../../lib/sofortSpeichern.ts';
import {
  useBsAktionen, useBsAktionenSpeichern, useBsVorlage, useBsVorlageSpeichern, useBsVorlageZuruecksetzen, useVordrucke, useVordruckeSpeichern,
} from '../../lib/api.ts';
import { ebeneStil } from './farben.tsx';

type Typ = 'ankauf' | 'verkauf';

/** Einstellungen → Begleitscheine: welcher Punkt welche Aktion bekommt, Vorlage, Vordrucke (§Y, §E, §M). Jede Änderung speichert sofort (wie alt). */
export function BegleitscheinEinstellungen() {
  const [typ, setTyp] = useState<Typ>('ankauf');
  return (
    <Paper withBorder p="md" component="section" aria-label="Begleitscheine Einstellungen">
      <Title order={4}>📑 Begleitscheine</Title>
      <Text size="sm" c="dimmed" mb="sm">Hier wird festgelegt, welcher Punkt welche Aktion bekommt, wie die Vorlage aussieht und welche Vordrucke zur Verfügung stehen.</Text>
      <SegmentedControl mb="sm" value={typ} onChange={(v) => setTyp(v as Typ)} data={[{ value: 'ankauf', label: 'Ankaufsvorlage' }, { value: 'verkauf', label: 'Verkaufsvorlage' }]} />
      <Tabs defaultValue="aktionen" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="aktionen">Aktionen</Tabs.Tab>
          <Tabs.Tab value="vorlage">Vorlage</Tabs.Tab>
          <Tabs.Tab value="vordrucke">Vordrucke</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="aktionen" pt="sm"><Aktionen key={typ} typ={typ} /></Tabs.Panel>
        <Tabs.Panel value="vorlage" pt="sm"><Vorlage key={typ} typ={typ} /></Tabs.Panel>
        <Tabs.Panel value="vordrucke" pt="sm"><Vordrucke /></Tabs.Panel>
      </Tabs>
    </Paper>
  );
}

function Aktionen({ typ }: { typ: Typ }) {
  const { data: vorlage } = useBsVorlage(typ);
  const { data: server } = useBsAktionen(typ);
  const { data: vordrucke = [] } = useVordrucke();
  const speichern = useBsAktionenSpeichern(typ);
  const { stand: aktionen, aendern: liste, fehler } = useSofortSpeichern(server, (l) => speichern.mutateAsync(l));
  const [filter, setFilter] = useState('');
  if (!vorlage || !aktionen) return <Text c="dimmed">Lädt …</Text>;
  const aendern = (id: string, feld: keyof BsAktion, wert: unknown) => liste((l) => l.map((a) => (a.id === id ? { ...a, [feld]: wert === '' ? undefined : wert } : a)));
  const f = filter.toLowerCase();
  const rows = f ? vorlage.rows.filter((r) => r.text.toLowerCase().includes(f) || r.sub.some((s) => s.text.toLowerCase().includes(f))) : vorlage.rows;
  const mitAktion = new Set(aktionen.map((a) => a.rowId)).size;

  const zeile = (a: BsAktion) => {
    const art = a.typ === 'vordruck-datei' ? 'datei' : 'brief';
    const auswahl = (feld: keyof BsAktion, opts: Record<string, string>, leer: string) => (
      <Select size="xs" w={230} placeholder={leer} aria-label={leer} clearable data={Object.entries(opts).map(([value, label]) => ({ value, label }))} value={(a[feld] as string) ?? null} onChange={(v) => aendern(a.id, feld, v ?? '')} />
    );
    return (
      <Group key={a.id} gap={6} py={6} wrap="wrap" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }} aria-label={`Aktion ${a.label}`}>
        <Checkbox size="xs" aria-label="sichtbar" checked={a.aktiv} onChange={(e) => aendern(a.id, 'aktiv', e.currentTarget.checked)} />
        <TextInput size="xs" w={190} aria-label="Beschriftung" defaultValue={a.label} onBlur={(e) => e.currentTarget.value !== a.label && aendern(a.id, 'label', e.currentTarget.value)} />
        <Select size="xs" w={170} aria-label="Aktionstyp" allowDeselect={false} data={Object.entries(BS_AKTION_LABEL).map(([value, label]) => ({ value, label }))} value={a.typ} onChange={(v) => v && aendern(a.id, 'typ', v)} />
        {a.typ === 'link' && <TextInput size="xs" w={240} aria-label="Adresse" placeholder="https://…" defaultValue={a.url ?? ''} onBlur={(e) => e.currentTarget.value !== (a.url ?? '') && aendern(a.id, 'url', e.currentTarget.value)} />}
        {a.typ === 'modul' && auswahl('modul', BS_MODULE, '– Ziel wählen –')}
        {a.typ === 'daten' && auswahl('datenQuelle', BS_DATENQUELLEN, '– Quelle wählen –')}
        {a.typ === 'analyse' && auswahl('analyseTyp', BS_ANALYSETYPEN, '– Analyse wählen –')}
        {(a.typ === 'vordruck-brief' || a.typ === 'vordruck-datei') && auswahl('vordruckId',
          Object.fromEntries(vordrucke.filter((v) => (art === 'datei') === (v.art === 'datei')).map((v) => [v.id, `${v.nummer} — ${v.titel}`])), '– noch kein Vordruck hinterlegt –')}
        {a.typ === 'mail' && <>
          <TextInput size="xs" w={170} aria-label="Empfänger" placeholder="Empfänger" defaultValue={a.empfaenger ?? ''} onBlur={(e) => e.currentTarget.value !== (a.empfaenger ?? '') && aendern(a.id, 'empfaenger', e.currentTarget.value)} />
          <TextInput size="xs" w={180} aria-label="Betreff" placeholder="Betreff" defaultValue={a.betreff ?? ''} onBlur={(e) => e.currentTarget.value !== (a.betreff ?? '') && aendern(a.id, 'betreff', e.currentTarget.value)} />
        </>}
        <ActionIcon size="sm" variant="subtle" color="red" aria-label="Aktion löschen" onClick={() => liste((l) => l.filter((x) => x.id !== a.id))}><IconX size={14} /></ActionIcon>
      </Group>
    );
  };
  const neu = (rowId: string, subId?: string) => liste((l) => [...l, { id: bsNewId('a'), label: 'Neue Aktion', typ: 'link', aktiv: true, rowId, ...(subId ? { subId } : {}) }]);

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {aktionen.length} Aktionen an {mitAktion} von {vorlage.rows.length} Punkten. Eine Aktion liest Daten, erzeugt einen Entwurf oder springt in ein Modul — sie schreibt nie in Objekte, Deals oder Kalkulationen zurück.
      </Text>
      {fehler && <Alert color="red">{fehler}</Alert>}
      <TextInput placeholder="Punkte durchsuchen…" aria-label="Punkte durchsuchen" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
      <ScrollArea.Autosize mah={600}>
        <Stack gap={6}>
          {rows.length === 0 && <Text size="sm" c="dimmed">Kein Punkt gefunden.</Text>}
          {rows.map((r) => {
            const eigene = aktionen.filter((a) => a.rowId === r.id && !a.subId);
            const subs = r.sub.map((s) => ({ s, liste: aktionen.filter((a) => a.rowId === r.id && a.subId === s.id) })).filter((x) => x.liste.length || f);
            return (
              <Paper key={r.id} withBorder p="xs" opacity={!eigene.length && !subs.length ? 0.6 : 1} aria-label={`Punkt ${r.text}`}>
                <Group gap={8} wrap="nowrap" align="flex-start">
                  <Badge size="xs" radius="sm" style={ebeneStil(r.lvl)}>E{r.lvl}</Badge>
                  <Text size="xs" style={{ whiteSpace: 'pre-wrap', flex: 1 }}>{r.text}</Text>
                </Group>
                {eigene.map(zeile)}
                {subs.map(({ s, liste }) => (
                  <div key={s.id} style={{ paddingLeft: 16, borderLeft: '2px solid var(--mantine-color-default-border)', marginTop: 6 }}>
                    <Text size="xs" c="dimmed">↳ {s.text || '(ohne Text)'}</Text>
                    {liste.map(zeile)}
                    <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => neu(r.id, s.id)}>Aktion</Button>
                  </div>
                ))}
                <Button size="compact-xs" variant="subtle" mt={4} leftSection={<IconPlus size={12} />} onClick={() => neu(r.id)}>Aktion</Button>
              </Paper>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function Vorlage({ typ }: { typ: Typ }) {
  const { data } = useBsVorlage(typ);
  const speichern = useBsVorlageSpeichern(typ);
  const zuruecksetzen = useBsVorlageZuruecksetzen(typ);
  const [meldung, setMeldung] = useState<string | null>(null);
  const { stand: v, aendern, ersetzen, fehler } = useSofortSpeichern<BsVorlage>(data, async (neu) => {
    const r = await speichern.mutateAsync({ kopf: neu.kopf, rows: neu.rows });
    if (r.entfernteAktionen) setMeldung(`${r.entfernteAktionen} Aktion(en) am gelöschten Punkt entfernt`);
  });
  if (!v) return <Text c="dimmed">Lädt …</Text>;
  const sichern = (neu: { kopf: string; rows: BsZeile[] }) => aendern((alt) => ({ ...alt, ...neu }));
  const rows = (f: (r: BsRow[]) => BsRow[]) => aendern((alt) => ({ ...alt, rows: f(alt.rows as BsRow[]) as BsZeile[] }));

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">Änderungen wirken auf <b>neu angelegte</b> Begleitscheine. Bestehende Begleitscheine werden nicht angefasst.</Text>
      {meldung && <Alert color="blue" withCloseButton onClose={() => setMeldung(null)} py={6}>{meldung}</Alert>}
      {(fehler || zuruecksetzen.error) && <Alert color="red">{fehler ?? zuruecksetzen.error!.message}</Alert>}
      <Textarea label="Kopfbereich" autosize minRows={2} defaultValue={v.kopf} onBlur={(e) => { const kopf = e.currentTarget.value.trim(); if (kopf !== v.kopf) aendern((alt) => ({ ...alt, kopf })); }} />
      <ScrollArea.Autosize mah={480} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4 }}>
        {v.rows.map((r) => (
          <Group key={r.id} gap={6} wrap="nowrap" px={8} py={4} align="flex-start" style={{ ...ebeneStil(r.lvl), borderBottom: '1px solid rgba(0,0,0,.12)' }} aria-label={`Vorlagenpunkt ${r.text}`}>
            <Button size="compact-xs" variant="transparent" c="inherit" aria-label="Ebene wechseln" onClick={() => rows((x) => x.map((y) => (y.id === r.id ? { ...y, lvl: ((y.lvl % 3) + 1) as 1 | 2 | 3 } : y)))}>E{r.lvl}</Button>
            <Textarea variant="unstyled" autosize minRows={1} style={{ flex: 1 }} aria-label="Text" defaultValue={r.text} key={`${r.id}-${r.text}`} styles={{ input: { color: 'inherit', fontSize: 12, padding: 0, minHeight: 0 } }}
              onBlur={(e) => { const text = e.currentTarget.value.trim(); if (text !== r.text) rows((x) => x.map((y) => (y.id === r.id ? { ...y, text } : y))); }} />
            <TextInput size="xs" w={92} aria-label="Verantwortung" placeholder="Verantw." defaultValue={r.verantwortung} key={`${r.id}-v-${r.verantwortung}`}
              onBlur={(e) => { const verantwortung = e.currentTarget.value.trim(); if (verantwortung !== r.verantwortung) rows((x) => x.map((y) => (y.id === r.id ? { ...y, verantwortung } : y))); }} />
            {!r.fix && <>
              <ActionIcon size="sm" variant="subtle" c="inherit" aria-label="nach oben" onClick={() => rows((x) => bsVerschieben(x, r.id, -1))}><IconArrowUp size={12} /></ActionIcon>
              <ActionIcon size="sm" variant="subtle" c="inherit" aria-label="nach unten" onClick={() => rows((x) => bsVerschieben(x, r.id, 1))}><IconArrowDown size={12} /></ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" aria-label="Punkt aus der Vorlage löschen" onClick={() => window.confirm('Punkt aus der Vorlage löschen?') && rows((x) => bsZeileLoeschen(x, r.id))}><IconX size={12} /></ActionIcon>
            </>}
          </Group>
        ))}
      </ScrollArea.Autosize>
      <Group gap="xs">
        {([1, 2, 3] as const).map((l) => <Button key={l} size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => rows((x) => bsZeileEinfuegen(x, null, l))}>Punkt Ebene {l}</Button>)}
        <Button size="xs" variant="subtle" color="red" ml="auto" leftSection={<IconRestore size={14} />} loading={zuruecksetzen.isPending} onClick={() => {
          const eigene = bsEigenePunkte(typ, v as unknown as BsVorlageDomain);
          const zusatz = eigene ? `\n\n${eigene} selbst angelegte${eigene === 1 ? 'r Punkt' : ' Punkte'} und alle daran hängenden Aktionen werden dabei entfernt.` : '';
          if (!window.confirm(`Vorlage auf den Auslieferungszustand aus der Excel zurücksetzen? Bestehende Begleitscheine bleiben unverändert.${zusatz}`)) return;
          zuruecksetzen.mutate(undefined, { onSuccess: (r) => { ersetzen(r.vorlage); setMeldung(r.entfernteAktionen ? `Vorlage zurückgesetzt · ${r.entfernteAktionen} verwaiste Aktion(en) entfernt` : 'Vorlage zurückgesetzt'); } });
        }}>Auslieferungszustand</Button>
      </Group>
    </Stack>
  );
}

function Vordrucke() {
  const { data: server } = useVordrucke();
  const speichern = useVordruckeSpeichern();
  const ohneZaehler = useMemo(() => server?.map(({ verwendung: _v, ...v }) => v), [server]);
  const { stand: liste = [], aendern: setzenMit, fehler } = useSofortSpeichern<BsVordruck[]>(ohneZaehler, (l) => speichern.mutateAsync(l));
  const verwendung = new Map((server ?? []).map((v) => [v.id, v.verwendung]));
  const data = liste.map((v) => ({ ...v, verwendung: verwendung.get(v.id) ?? 0 }));
  const aendern = (id: string, feld: keyof BsVordruck, wert: unknown) => setzenMit((l) => l.map((v) => (v.id === id ? { ...v, [feld]: wert } : v)));
  const blur = (v: BsVordruck, feld: 'nummer' | 'titel' | 'inhalt' | 'betreff' | 'dateiName') => (e: { currentTarget: { value: string } }) => { const w = e.currentTarget.value; if (w !== (v[feld] ?? '')) aendern(v.id, feld, w); };
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Ein Vordruck wird hier gepflegt und im Reiter „Aktionen“ einem Punkt zugeordnet. Platzhalter werden beim Öffnen ersetzt:{' '}
        {BS_PLATZHALTER.map((p) => <Code key={p} mr={4}>{`{${p}}`}</Code>)} Es wird nie automatisch versendet.
      </Text>
      {fehler && <Alert color="red">{fehler}</Alert>}
      {data.length === 0 && <Text size="sm" c="dimmed">Noch kein Vordruck hinterlegt.</Text>}
      {data.map((v) => (
        <Paper key={v.id} withBorder p="xs" aria-label={`Vordruck ${v.nummer} ${v.titel}`}>
          <Group gap={6} mb={6} wrap="wrap">
            <Checkbox size="xs" aria-label="aktiv" checked={v.aktiv} onChange={(e) => aendern(v.id, 'aktiv', e.currentTarget.checked)} />
            <TextInput size="xs" w={80} aria-label="Nummer" placeholder="F000" defaultValue={v.nummer} onBlur={blur(v, 'nummer')} />
            <TextInput size="xs" style={{ flex: 1, minWidth: 160 }} aria-label="Titel" placeholder="Titel" defaultValue={v.titel} onBlur={blur(v, 'titel')} />
            <Select size="xs" w={100} aria-label="Art" allowDeselect={false} data={[{ value: 'brief', label: 'Brief' }, { value: 'mail', label: 'Mail' }, { value: 'datei', label: 'Datei' }]} value={v.art} onChange={(a) => a && aendern(v.id, 'art', a)} />
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Vordruck löschen" onClick={() => {
              const warnung = v.verwendung ? `Dieser Vordruck ist an ${v.verwendung} Stelle(n) zugeordnet. Diese Aktionen haben danach keinen Vordruck mehr.\n\nTrotzdem löschen?` : 'Vordruck löschen?';
              if (window.confirm(warnung)) setzenMit((l) => l.filter((x) => x.id !== v.id));
            }}><IconX size={14} /></ActionIcon>
          </Group>
          {v.art === 'datei'
            ? <TextInput size="xs" aria-label="Dateiname" placeholder="Dateiname" defaultValue={v.dateiName ?? ''} onBlur={blur(v, 'dateiName')} />
            : <>
              {v.art === 'mail' && <TextInput size="xs" mb={6} aria-label="Betreff" placeholder="Betreff" defaultValue={v.betreff ?? ''} onBlur={blur(v, 'betreff')} />}
              <Textarea size="xs" autosize minRows={3} aria-label="Text" placeholder="Text mit {platzhaltern}" defaultValue={v.inhalt ?? ''} onBlur={blur(v, 'inhalt')} />
            </>}
          <Text size="xs" c="dimmed" mt={4}>Verwendet an {v.verwendung} Stelle(n).</Text>
        </Paper>
      ))}
      <Button size="xs" variant="default" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setzenMit((l) => [...l, { id: bsNewId('v'), nummer: '', titel: 'Neuer Vordruck', art: 'brief', inhalt: '', aktiv: true }])}>Vordruck</Button>
    </Stack>
  );
}
