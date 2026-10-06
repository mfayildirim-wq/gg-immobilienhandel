/* Formulare je Folientyp — Felder, Beschriftungen und Platzhalter wie in der alten App (finanzpraes.ts, render*Editor). */
import {
  entferneBild, HELLIGKEIT_KNOPF, HELLIGKEIT_TITEL, istSektionsZeile, KI_DENKT, LAGE_KI_KNOPF, MIETEN_SPALTEN, mietflaecheSumme, OBJEKT_KI_KNOPF, SLIDE_TYPES, teileTabellenzeilen, verschiebeBild,
} from '@gg/domain';
import { bildFuerVorschau } from '@gg/documents';
import { ActionIcon, Alert, Button, Checkbox, CloseButton, Group, Image, Modal, Paper, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { IconArrowBackUp, IconArrowLeft, IconArrowRight, IconBolt, IconMap, IconPhoto, IconTable, IconTrash } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import type { AuswahlAuftrag } from './BildAuswahl.tsx';
import type { BildPlatz } from './bilder.ts';

type Daten = Record<string, unknown>;
export type Vorbelegung = 'deckblatt' | 'objektbeschreibung' | 'projektkalkulation-aufteiler' | 'projektkalkulation-global' | 'verkaufspreise' | 'mietenaufstellung' | 'finanzierung' | 'organigramm' | 'abschluss';

export interface FormularKontext {
  data: Daten;
  setzen: (neu: Daten) => void;
  bildWaehlen: (a: AuswahlAuftrag) => void;
  vorbelegen: (art: Vorbelegung, spalten?: string[]) => void;
  /** KI-Text für die Folie erzeugen; was schon getippt ist, geht als Vorgabe mit. */
  kiText: (art: 'lage' | 'objekt') => void;
  /** Bild an diesem Platz durch eine aufgehellte Kopie ersetzen (Auto-Levels, keine KI). */
  aufhellen: (platz: BildPlatz, ref: string) => void;
  adresse: string;
  laeuft: boolean;
}

const HelligkeitKnopf = ({ c, platz, bild, kompakt }: { c: FormularKontext; platz: BildPlatz; bild: string; kompakt?: boolean }) => (
  <Button size="compact-xs" variant="default" title={HELLIGKEIT_TITEL} disabled={c.laeuft} fullWidth={kompakt} onClick={() => c.aufhellen(platz, bild)}>{HELLIGKEIT_KNOPF}</Button>
);

const t = (d: Daten, k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');

function Feld({ k, label, platzhalter, zeilen, hinweis, c }: { k: string; label: string; platzhalter?: string; zeilen?: number; hinweis?: string; c: FormularKontext }) {
  const wert = t(c.data, k);
  const aendern = (v: string) => c.setzen({ ...c.data, [k]: v });
  return zeilen
    ? <Textarea label={label} description={hinweis} placeholder={platzhalter} autosize minRows={zeilen} value={wert} onChange={(e) => aendern(e.currentTarget.value)} />
    : <TextInput label={label} description={hinweis} placeholder={platzhalter} value={wert} onChange={(e) => aendern(e.currentTarget.value)} />;
}

function Einzelbild({ k, label, hinweis, c }: { k: string; label: string; hinweis?: string; c: FormularKontext }) {
  const wert = t(c.data, k);
  const waehlen = () => c.bildWaehlen({ titel: label, max: 1, vorauswahl: wert ? [wert] : [], fertig: ([ref]) => c.setzen({ ...c.data, [k]: ref ?? '' }) });
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {hinweis && <Text size="xs" c="dimmed">{hinweis}</Text>}
      {wert ? (
        <Group align="flex-start" gap="xs">
          <Image src={bildFuerVorschau(wert)} alt={label} mah={180} maw={260} fit="contain" radius="sm" style={{ border: '1px solid var(--mantine-color-default-border)' }} />
          <Stack gap={4}>
            <Button size="compact-xs" variant="default" leftSection={<IconPhoto size={12} />} onClick={waehlen}>Bild wechseln</Button>
            <HelligkeitKnopf c={c} platz={{ feld: k }} bild={wert} />
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => c.setzen({ ...c.data, [k]: '' })}>Entfernen</Button>
          </Stack>
        </Group>
      ) : (
        <Button variant="default" leftSection={<IconPhoto size={14} />} onClick={waehlen} style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }}>Bild auswählen / hochladen</Button>
      )}
    </Stack>
  );
}

function Mehrbild({ label, max, hinweis, beschriftung, c }: { label: string; max: number; hinweis: string; beschriftung: string; c: FormularKontext }) {
  const bilder = Array.isArray(c.data.bilder) ? (c.data.bilder as string[]) : [];
  const captions = Array.isArray(c.data.captions) ? (c.data.captions as string[]) : [];
  const setze = (neu: { bilder: string[]; captions: string[] }, captionsAnlegen = true) =>
    c.setzen({ ...c.data, bilder: neu.bilder, ...(captionsAnlegen || Array.isArray(c.data.captions) ? { captions: neu.captions } : {}) });
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>{label} ({bilder.length}/{max})</Text>
        <Button size="xs" variant="default" leftSection={<IconPhoto size={14} />} onClick={() => c.bildWaehlen({ titel: label, max, vorauswahl: bilder, fertig: (refs) => {
          const alt = { bilder, captions };
          c.setzen({ ...c.data, bilder: refs, captions: refs.map((r) => { const i = alt.bilder.indexOf(r); return i >= 0 ? alt.captions[i] || '' : ''; }) });
        } })}>Bild auswählen / hochladen</Button>
      </Group>
      {bilder.length === 0 && <Paper withBorder p="md" ta="center" c="dimmed" style={{ borderStyle: 'dashed' }}>Noch keine Bilder hochgeladen</Paper>}
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
        {bilder.map((b, i) => (
          <Paper key={`${b}-${i}`} withBorder p={4} aria-label={`${label} ${i + 1}`}>
            <div style={{ position: 'relative' }}>
              <Image src={bildFuerVorschau(b)} h={100} fit="cover" radius="sm" alt={`${label} ${i + 1}`} />
              <CloseButton size="sm" aria-label="Bild entfernen" style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.6)', color: 'white' }} onClick={() => setze(entferneBild(bilder, captions, i), false)} />
            </div>
            <Group gap={2} mt={4} wrap="nowrap">
              <ActionIcon size="sm" variant="default" aria-label="Nach links" disabled={i === 0} onClick={() => setze(verschiebeBild(bilder, captions, i, i - 1))}><IconArrowLeft size={12} /></ActionIcon>
              <ActionIcon size="sm" variant="default" aria-label="Nach rechts" disabled={i === bilder.length - 1} onClick={() => setze(verschiebeBild(bilder, captions, i, i + 1))}><IconArrowRight size={12} /></ActionIcon>
              <TextInput size="xs" style={{ flex: 1 }} aria-label={`Beschriftung ${i + 1}`} placeholder={beschriftung} value={captions[i] ?? ''}
                onChange={(e) => { const v = e.currentTarget.value; const neu = [...captions]; while (neu.length < bilder.length) neu.push(''); neu[i] = v; c.setzen({ ...c.data, captions: neu }); }} />
            </Group>
            <HelligkeitKnopf c={c} platz={{ index: i }} bild={b} kompakt />
          </Paper>
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed">{hinweis}</Text>
    </Stack>
  );
}

function Tabelle({ c, aktionen }: { c: FormularKontext; aktionen: ReactNode }) {
  const rows = Array.isArray(c.data.tableRows) ? (c.data.tableRows as string[][]) : [];
  const headers = Array.isArray(c.data.tableHeaders) ? (c.data.tableHeaders as string[]) : [];
  const modus = rows.length ? 'Tabelle' : t(c.data, 'bildPath') ? 'Bild' : 'leer';
  const seiten = teileTabellenzeilen(rows).length;
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm" c="dimmed">Aktueller Modus: <b>{modus}</b></Text>
        {modus !== 'leer' && (
          <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => {
            if (!window.confirm('Tabelle und Bild dieser Slide löschen?')) return;
            const { tableHeaders: _h, tableRows: _r, tableTitle: _t, ...rest } = c.data;
            c.setzen({ ...rest, bildPath: '' });
          }}>Inhalt löschen</Button>
        )}
      </Group>
      <Group gap="xs">{aktionen}</Group>
      {rows.length > 0 && (
        <>
          {seiten > 1 && <Text size="xs" c="dimmed">{rows.length} Zeilen — im Export auf {seiten} Folien verteilt.</Text>}
          <Table.ScrollContainer minWidth={300} mah={280}>
            <Table striped withTableBorder fz="xs" aria-label="Tabelle der Folie">
              {headers.length > 0 && <Table.Thead><Table.Tr>{headers.map((h, i) => <Table.Th key={i}>{h}</Table.Th>)}</Table.Tr></Table.Thead>}
              <Table.Tbody>{rows.map((r, i) => <Table.Tr key={i} fw={istSektionsZeile(r) ? 700 : undefined}>{r.map((z, j) => <Table.Td key={j}>{z}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </Stack>
  );
}

function MietenSpaltenDialog({ offen, schliessen, anwenden }: { offen: boolean; schliessen: () => void; anwenden: (keys: string[]) => void }) {
  const [gewaehlt, setGewaehlt] = useState(() => MIETEN_SPALTEN.filter((s) => s.default).map((s) => s.key));
  return (
    <Modal opened={offen} onClose={schliessen} title="Spalten für Mietenaufstellung wählen">
      <SimpleGrid cols={2} spacing="xs">
        {MIETEN_SPALTEN.map((s) => (
          <Checkbox key={s.key} label={s.label} checked={gewaehlt.includes(s.key)} onChange={(e) => { const an = e.currentTarget.checked; setGewaehlt((g) => (an ? [...g, s.key] : g.filter((x) => x !== s.key))); }} />
        ))}
      </SimpleGrid>
      {gewaehlt.length === 0 && <Alert color="orange" mt="sm" py={4}>Bitte mindestens eine Spalte wählen</Alert>}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={schliessen}>Abbrechen</Button>
        <Button disabled={gewaehlt.length === 0} onClick={() => { anwenden(gewaehlt); schliessen(); }}>Tabelle einfügen</Button>
      </Group>
    </Modal>
  );
}

export function FolienFormular({ typ, c }: { typ: string; c: FormularKontext }) {
  const meta = SLIDE_TYPES.find((m) => m.typ === typ);
  const [spaltenOffen, setSpaltenOffen] = useState(false);
  const vorbelegenKnopf = (art: Vorbelegung, text: string, icon: ReactNode = <IconBolt size={14} />) => (
    <Button size="xs" variant="light" leftSection={icon} loading={c.laeuft} onClick={() => c.vorbelegen(art)}>{text}</Button>
  );
  const kiKnopf = (art: 'lage' | 'objekt', text: string, titel: string) => (
    <Button size="xs" variant="light" title={titel} disabled={c.laeuft} onClick={() => c.kiText(art)}>{c.laeuft ? KI_DENKT : text}</Button>
  );

  const inhalt = (() => {
    switch (typ) {
      case 'deckblatt':
        return <>
          <Feld k="titel" label="Titel" platzhalter="z.B. ANKAUF Mehrfamilienhaus" c={c} />
          <Feld k="untertitel" label="Untertitel" platzhalter="z.B. in Stuttgart, Tölzer Straße 23" c={c} />
          <Group>{vorbelegenKnopf('deckblatt', 'Titel und Untertitel aus Deal übernehmen')}</Group>
          <Einzelbild k="bildPath" label="Hauptbild (1 Bild)" c={c} />
        </>;
      case 'objektbeschreibung':
        return <>
          <Feld k="adresse" label="Adresse" platzhalter={c.adresse} c={c} />
          <SimpleGrid cols={3} spacing="xs">
            <Feld k="baujahr" label="Baujahr" platzhalter="z.B. 1965" c={c} />
            <Feld k="einheiten" label="Einheiten" platzhalter="z.B. 9" c={c} />
            <Feld k="stellplaetze" label="Stellplätze" platzhalter="z.B. 4" c={c} />
            {/* Mietfläche an der Stelle der früheren Wohnfläche, darunter Wohn- und Gewerbefläche; leere Felder erscheinen nicht in der Präsentation */}
            <Stack gap={4}>
              {/* rechts daneben: Mietfläche = Wohnfläche + Gewerbefläche aus den Feldern darunter — sonst nichts */}
              <Group gap={4} wrap="nowrap" align="flex-end">
                <div style={{ flex: 1, minWidth: 0 }}><Feld k="mietflaeche" label="Mietfläche m²" c={c} /></div>
                <Tooltip label="Summe aus Wohn- und Gewerbefläche übernehmen">
                  <ActionIcon variant="light" size={36} aria-label="Summe aus Wohn- und Gewerbefläche übernehmen"
                    onClick={() => c.setzen({ ...c.data, mietflaeche: mietflaecheSumme(c.data.wohnflaeche, c.data.gewerbeflaeche) })}>
                    <IconArrowBackUp size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {/* an der Unterkante ausgerichtet: bricht eine Beschriftung um, stehen die Felder trotzdem auf einer Linie */}
              <Group grow gap={4} wrap="nowrap" align="flex-end">
                <Feld k="wohnflaeche" label="Wohnfläche m²" c={c} />
                <Feld k="gewerbeflaeche" label="Gewerbefläche m²" c={c} />
              </Group>
            </Stack>
            <Feld k="grundstueck" label="Grundstück m²" c={c} />
            <Feld k="gik" label="Kaufpreis €" c={c} />
            <Feld k="kaufpreisPerM2" label="Kaufpreis pro m²" platzhalter="z.B. 2.450 €/m²" c={c} />
            <Feld k="jnkm" label="Jahresnettokaltmiete" platzhalter="z.B. 48.000 €" c={c} />
            <Feld k="renditeIst" label="Rendite IST" platzhalter="z.B. 5,2 %" c={c} />
          </SimpleGrid>
          <Feld k="beschreibung" label="Beschreibung" platzhalter="Mehrzeiliger Beschreibungstext…" zeilen={6} c={c} />
          <Einzelbild k="bildPath" label="Hauptbild" c={c} />
          <Group>
            {vorbelegenKnopf('objektbeschreibung', 'Aus Deal/Objekt vorbelegen')}
            {kiKnopf('objekt', OBJEKT_KI_KNOPF, 'Generiert 4-7-Sätze-Beschreibungstext im Stil der echten IVT-Pitches mit Claude Haiku 4.5')}
          </Group>
        </>;
      case 'lagebeschreibung':
        return <>
          <Feld k="standortBullets" label="Standort" hinweis="Bullets — eine Zeile pro Punkt" platzhalter={'Eine Zeile pro Bullet, z.B.\nZentrale Lage in Stuttgart-West\nNähe zu Schulen und Einkaufsmöglichkeiten'} zeilen={4} c={c} />
          <Feld k="anbindungBullets" label="Anbindung" hinweis="Bullets — eine Zeile pro Punkt" platzhalter={'S-Bahn-Anschluss in 5 Min Fußweg\nAutobahnauffahrt A8 in 10 Min'} zeilen={4} c={c} />
          <Group>
            {kiKnopf('lage', LAGE_KI_KNOPF, 'Generiert Standort + Anbindung mit Claude Haiku 4.5 basierend auf Adresse aus Deal/Objekt')}
            <Button size="xs" variant="default" leftSection={<IconMap size={14} />} disabled={!c.adresse} component="a" target="_blank" rel="noopener"
              href={`https://www.google.com/maps/search/${encodeURIComponent(c.adresse)}/@,17z/data=!3m1!1e3`}>In Google Maps öffnen</Button>
          </Group>
          <Einzelbild k="bildPath" label="Karte / Foto" hinweis="Karte öffnen → Screenshot in die Zwischenablage → in der Bildauswahl „Aus Zwischenablage“" c={c} />
        </>;
      case 'projektbeschreibung':
        return <>
          <Feld k="aktuellerStand" label="Aktueller Stand" platzhalter="Beschreibung des Ist-Zustands…" zeilen={4} c={c} />
          <Feld k="geplanteMassnahmen" label="Geplante Maßnahmen" platzhalter="Sanierung, Aufteilung, etc." zeilen={4} c={c} />
          <Feld k="vertrieb" label="Vertrieb" platzhalter="Vertriebsstrategie, Zielgruppe, Vermarktung" zeilen={4} c={c} />
        </>;
      case 'geschaeftsmodell':
        return <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {([['zielgruppe', 'Zielgruppe'], ['angebot', 'Angebot der IVT'], ['kundengewinnung', 'Kundengewinnung'], ['vorteile', 'Vorteile für die Kunden'], ['vorteileIvt', 'Vorteile für die IVT']] as const)
            .map(([k, l]) => <Feld key={k} k={k} label={l} platzhalter="Eine Zeile pro Bullet…" zeilen={4} c={c} />)}
        </SimpleGrid>;
      case 'projektkalkulation':
        return <>
          <Tabelle c={c} aktionen={<>
            {vorbelegenKnopf('projektkalkulation-aufteiler', 'Aufteiler-Kalkulation aus Deal übernehmen', <IconTable size={14} />)}
            {vorbelegenKnopf('projektkalkulation-global', 'Global-Kalkulation aus Deal übernehmen', <IconTable size={14} />)}
          </>} />
          <Einzelbild k="bildPath" label="… oder Bild der Kalkulation" hinweis="z.B. Excel-Screenshot — wird nur verwendet wenn keine Tabelle gesetzt ist" c={c} />
          <Feld k="beschreibung" label="Beschreibung (optional)" platzhalter="Erläuterung zur Kalkulation…" zeilen={3} c={c} />
        </>;
      case 'verkaufspreise':
        return <>
          <Tabelle c={c} aktionen={vorbelegenKnopf('verkaufspreise', 'Vollständige Einheitenliste aus Deal-Kalk übernehmen', <IconTable size={14} />)} />
          <Einzelbild k="bildPath" label="… oder Bild der Verkaufspreis-Tabelle" hinweis="wird nur verwendet wenn keine Tabelle gesetzt ist" c={c} />
          <Feld k="beschreibung" label="Beschreibung (optional)" zeilen={2} c={c} />
        </>;
      case 'mietenaufstellung':
        return <>
          <Tabelle c={c} aktionen={<Button size="xs" variant="light" leftSection={<IconTable size={14} />} loading={c.laeuft} onClick={() => setSpaltenOffen(true)}>Einheitenliste aus Deal — Spalten auswählen…</Button>} />
          <MietenSpaltenDialog offen={spaltenOffen} schliessen={() => setSpaltenOffen(false)} anwenden={(keys) => c.vorbelegen('mietenaufstellung', keys)} />
          <Einzelbild k="bildPath" label="… oder Bild der Mietenaufstellung" hinweis="wird nur verwendet wenn keine Tabelle gesetzt ist" c={c} />
          <Feld k="beschreibung" label="Beschreibung (optional)" zeilen={2} c={c} />
        </>;
      case 'finanzierungsstruktur':
        return <>
          <SimpleGrid cols={3} spacing="xs">
            <Feld k="gik" label="Gesamt-Investition (GIK)" platzhalter="z.B. 1.287.000 €" c={c} />
            <Feld k="em" label="Eigenmittel (EM)" platzhalter="z.B. 237.000 €" c={c} />
            <Feld k="ekAnteil" label="EK-Anteil" platzhalter="z.B. 18%" c={c} />
          </SimpleGrid>
          <SimpleGrid cols={2} spacing="xs">
            <Feld k="fm" label="Fremdmittel Bank (FM)" platzhalter="z.B. 1.050.000 €" c={c} />
            <Feld k="fkAnteil" label="FK-Anteil" platzhalter="z.B. 82%" c={c} />
          </SimpleGrid>
          <Feld k="zinsbindung" label="Zinsbindung Bank" platzhalter="z.B. Euribor 3 Monate + 2,5% Marge" c={c} />
          <SimpleGrid cols={2} spacing="xs">
            <Feld k="strukturierungsentgelt" label="Strukturierungsentgelt Bank" platzhalter="z.B. 1,5%" c={c} />
            <Feld k="kreditlaufzeit" label="Kreditlaufzeit" platzhalter="z.B. 18 Monate" c={c} />
            <Feld k="kreditnehmer" label="Kreditnehmer" platzhalter="z.B. IVT Wohnen GmbH" c={c} />
            <Feld k="verwendungszweck" label="Verwendungszweck" platzhalter="z.B. Zum gewerbsmäßigen Weiterverkauf" c={c} />
          </SimpleGrid>
          <Feld k="buergschaft" label="Bürgschaft" platzhalter="z.B. Blanco Anteil 50% Sven Neubert, 50% IVT AG" c={c} />
          <Feld k="grundschuldeintragung" label="Grundschuldeintragung" platzhalter="z.B. mit enger Zweckerklärung" c={c} />
          <Feld k="grundschuldAufteilung" label="Aufteilung Grundschuld" platzhalter="z.B. vollstreckbare und nicht vollstreckbare Grundschuld" c={c} />
          <Feld k="ausschuettung" label="Ausschüttung" platzhalter="z.B. aus Übererlös der verkauften Einheiten" c={c} />
          <Feld k="verzinsung" label="Verzinsung p.a. (optional)" platzhalter="z.B. 4,2%" c={c} />
          <SimpleGrid cols={2} spacing="xs">
            <Feld k="tilgung" label="Tilgung p.a. (optional)" platzhalter="z.B. 2%" c={c} />
            <Feld k="bereitstellung" label="Bereitstellung (optional)" platzhalter="z.B. 12 Monate" c={c} />
          </SimpleGrid>
          <Feld k="zusatzBullets" label="Zusätzliche Punkte" hinweis="Optional" platzhalter="Eine Zeile pro Bullet…" zeilen={3} c={c} />
          <Group>{vorbelegenKnopf('finanzierung', 'Aus Deal-Kalkulation + IVT-Standard übernehmen')}</Group>
        </>;
      case 'grundrisse':
        return <Mehrbild label="Grundrisse" max={12} hinweis="Pro Bild wird eine eigene PDF-/PPTX-Seite erzeugt" beschriftung="z.B. „1. OG“, „Erdgeschoss“" c={c} />;
      case 'impressionen':
        return <Mehrbild label="Impressionen" max={8} hinweis="Galerie auf einer Seite" beschriftung="z.B. „Küche“, „Whg. 1.OG links“" c={c} />;
      case 'organigramm':
        return <>
          <Einzelbild k="bild" label="Organigramm-Bild" hinweis="Vollformat-Bild der Konzern-Struktur (z.B. PowerPoint-Screenshot); leer = Bild aus den Einstellungen" c={c} />
          <Feld k="beschreibung" label="Beschreibungstext (optional)" platzhalter="Erscheint unter dem Bild" zeilen={3} c={c} />
          <Group>{vorbelegenKnopf('organigramm', 'Aus Einstellungen laden')}</Group>
        </>;
      case 'abschluss':
        return <>
          <Einzelbild k="bild" label="Foto" hinweis="Gemeinsames Foto (z.B. Geschäftsführer); leer = Bild aus den Einstellungen" c={c} />
          <Feld k="untertitel" label="Untertitel" platzhalter="Namen + Positionen" zeilen={2} c={c} />
          <Group>{vorbelegenKnopf('abschluss', 'Aus Einstellungen laden')}</Group>
        </>;
      case 'referenz':
        return <>
          <Feld k="projektName" label="Projekt-Name" platzhalter="z.B. Calwer Straße 5, Stuttgart" c={c} />
          <Feld k="zeilen" label="Termine & Werte" hinweis="Format: Phase | Datum | Wert" zeilen={8} c={c}
            platzhalter={'Eine Zeile pro Eintrag, mit | als Trenner:\nNotartermin | 12.05.2025 | 750.000 €\nÜbergabe | 01.07.2025 | –\nVerkaufsstart | 15.08.2025 | 850.000 €'} />
        </>;
      case 'kundenliste':
        return <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Feld k="einzelverkauf" label="Einzelverkauf" platzhalter="Eine Zeile pro Eintrag" zeilen={8} c={c} />
          <Feld k="globalansprachen" label="Globalansprachen" platzhalter="Eine Zeile pro Eintrag" zeilen={8} c={c} />
        </SimpleGrid>;
      case 'marktvergleich':
        return <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {([1, 2] as const).map((n) => (
            <Paper key={n} withBorder p="sm"><Stack gap="xs">
              <Text size="xs" tt="uppercase" c="dimmed">Vergleich {n}</Text>
              <Feld k={`titel${n}`} label="Titel" platzhalter={n === 1 ? 'Titel (z.B. Sprengnetter)' : 'Titel (z.B. ImmoScout)'} c={c} />
              <Einzelbild k={`bild${n}`} label={`Bild ${n}`} c={c} />
              <Feld k={`text${n}`} label="Beschreibung" platzhalter="Beschreibung…" zeilen={3} c={c} />
            </Stack></Paper>
          ))}
        </SimpleGrid>;
      default:
        return <Alert color="gray">Unbekannter Slide-Typ „{typ}“ — die Vorlage zeigt einen Platzhalter.</Alert>;
    }
  })();

  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="nowrap" pb="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Text fz={28} lh={1}>{meta?.icon ?? '📄'}</Text>
        <div>
          <Title order={4}>{meta?.label ?? typ}</Title>
          <Text size="xs" c="dimmed">{meta?.beschreibung}</Text>
        </div>
      </Group>
      {inhalt}
    </Stack>
  );
}
