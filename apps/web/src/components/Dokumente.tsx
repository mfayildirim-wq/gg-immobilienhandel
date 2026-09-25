import type { Dokument } from '@gg/api-contract';
import { Alert, Badge, Button, Group, Paper, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useRef, useState } from 'react';
import { type DokumentBezug, dokumentDateiUrl, useDokumentBezeichnen, useDokumente, useDokumenteHochladen, useDokumentLoeschen } from '../lib/api.ts';

/** Anzeige wie alt (fmtBytes, fileIcon in deals.ts). */
export const dateigroesse = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export function dateiSymbol(mime: string) {
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('excel') || mime.includes('sheet')) return '📊';
  if (mime.includes('zip') || mime.includes('compress')) return '🗜';
  return '📎';
}
const AKZEPTIERT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.msg,.eml';
const datumDe = (iso: string) => new Date(iso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleDateString('de-DE');

/**
 * 📁 Dokumente an einem Geschäftsobjekt (Protokoll 19; alt: dealDateienHTML nur am Deal): Liste neueste zuerst mit
 * Ablageort und Pfad, Bezeichnung, „Anzeigen“ über die App, „In SharePoint öffnen“, Löschen, Hochladen per Auswahl
 * oder Ziehen. Am Objekt werden auch die Dokumente seiner Deals gezeigt — alles zu einer Immobilie an einem Ort.
 */
export function Dokumente({ bezug, mitDeals = false, objektId }: { bezug: DokumentBezug; mitDeals?: boolean; /** am Deal: auch die Dokumente seines Objekts zeigen */ objektId?: string }) {
  const { data: geladen = [], isLoading, error } = useDokumente(bezug, mitDeals);
  const objektBezug: DokumentBezug | null = bezug.art === 'deal' && objektId ? { art: 'objekt', id: objektId } : null;
  const { data: objektDokumente = [] } = useDokumente(objektBezug ?? bezug, false, objektBezug !== null);
  const dokumente = objektBezug ? [...geladen, ...objektDokumente] : geladen;
  const hochladen = useDokumenteHochladen(bezug);
  const loeschen = useDokumentLoeschen(bezug);
  const eingabe = useRef<HTMLInputElement>(null);
  const [ziehen, setZiehen] = useState(false);
  const senden = (dateien: FileList | null) => { if (dateien?.length) hochladen.mutate([...dateien]); };
  const eigene = dokumente.filter((d) => d.bezug.art === bezug.art && d.bezug.id === bezug.id);
  const fremde = dokumente.filter((d) => !(d.bezug.art === bezug.art && d.bezug.id === bezug.id));

  return (
    <Stack gap="xs" aria-label="Dateien">
      {error && <Alert color="red">⚠ {error.message}</Alert>}
      {isLoading && <Text c="dimmed" ta="center" p="lg" size="sm">Lade…</Text>}
      {!isLoading && eigene.length === 0 && <Text c="dimmed" ta="center" p="lg" size="sm">📁 Noch keine Dokumente</Text>}
      {eigene.map((d) => <DokumentZeile key={d.id} bezug={bezug} d={d} loeschen={() => window.confirm('Dokument unwiderruflich löschen?') && loeschen.mutate(d.id)} />)}
      <Paper withBorder p="lg" ta="center" role="button" tabIndex={0} aria-label="Dokumente hinzufügen"
        style={{ borderStyle: 'dashed', borderWidth: 2, cursor: 'pointer', borderColor: ziehen ? 'var(--mantine-primary-color-filled)' : undefined }}
        onClick={() => eingabe.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter') eingabe.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setZiehen(true); }} onDragLeave={() => setZiehen(false)}
        onDrop={(e) => { e.preventDefault(); setZiehen(false); senden(e.dataTransfer.files); }}>
        <Text fz={24}>＋</Text>
        <Text fw={600} size="sm">Dokumente hinzufügen</Text>
        <Text size="xs" c="dimmed">PDFs, Bilder, Word, Excel, PowerPoint · max. 200 MB je Datei · bis zu 20 auf einmal</Text>
        <input ref={eingabe} type="file" multiple hidden accept={AKZEPTIERT} data-testid="dokument-auswahl" onChange={(e) => { senden(e.currentTarget.files); e.currentTarget.value = ''; }} />
      </Paper>
      {hochladen.isPending && <Text size="sm" c="yellow.7">⏳ Lade hoch…</Text>}
      {hochladen.error && <Alert color="red">❌ Upload fehlgeschlagen: {hochladen.error.message}</Alert>}
      {hochladen.isSuccess && <Text size="sm" c="teal">{hochladen.data.length} Dokument{hochladen.data.length > 1 ? 'e' : ''} gespeichert</Text>}
      {fremde.length > 0 && (
        <Stack gap="xs" mt="sm" aria-label={bezug.art === 'objekt' ? 'Dokumente der Deals' : 'Dokumente des Objekts'}>
          <Text fw={600} size="sm">{bezug.art === 'objekt' ? '📁 Dokumente der Deals zu diesem Objekt' : '📁 Dokumente des Objekts'}</Text>
          {fremde.map((d) => <DokumentZeile key={d.id} bezug={bezug} d={d} />)}
        </Stack>
      )}
    </Stack>
  );
}

function DokumentZeile({ bezug, d, loeschen }: { bezug: DokumentBezug; d: Dokument; loeschen?: () => void }) {
  const bezeichnen = useDokumentBezeichnen(bezug);
  const [label, setLabel] = useState(d.label);
  return (
    <Paper withBorder p="sm" data-dokument={d.id} data-ablage={d.ablage}>
      <Group wrap="nowrap" align="flex-start">
        <Text fz={22}>{dateiSymbol(d.mimeType)}</Text>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" truncate title={d.dateiname}>{d.dateiname}</Text>
            {d.istExpose && <Badge size="xs" variant="light" tt="none">Exposé</Badge>}
            {d.ablage === 'sharepoint' && <Badge size="xs" variant="light" color="blue" tt="none">SharePoint</Badge>}
            {d.fehltSeit && <Badge size="xs" variant="light" color="red" tt="none" title={`seit ${datumDe(d.fehltSeit)}`}>in SharePoint nicht gefunden</Badge>}
          </Group>
          <Text size="xs" c="dimmed">{dateigroesse(d.groesseBytes)} · {datumDe(d.hochgeladenAm)}</Text>
          <Tooltip label={d.pfad} multiline maw={480} disabled={!d.pfad}>
            <Text size="xs" c="dimmed" truncate data-pfad title={d.pfad}>📂 {d.pfad || '–'}</Text>
          </Tooltip>
          {loeschen && (
            <TextInput size="xs" aria-label="Bezeichnung" placeholder="Bezeichnung (optional)" value={label} onChange={(e) => setLabel(e.currentTarget.value)}
              onBlur={() => label !== d.label && bezeichnen.mutate({ id: d.id, label })} />
          )}
          {!loeschen && d.label && <Text size="xs">{d.label}</Text>}
        </Stack>
        <Stack gap={4}>
          <Button size="compact-xs" variant="default" component="a" href={dokumentDateiUrl(bezug, d.id)} target="_blank" rel="noopener">Anzeigen</Button>
          {d.webUrl && <Button size="compact-xs" variant="light" color="blue" component="a" href={d.webUrl} target="_blank" rel="noopener">In SharePoint öffnen</Button>}
          {loeschen && <Button size="compact-xs" color="red" variant="light" onClick={loeschen}>Löschen</Button>}
        </Stack>
      </Group>
    </Paper>
  );
}

/** 📁 Datei-Leiste über den Reitern Übersicht und Kalkulation (dealDocsStrip): jedes Dokument als Link zum Öffnen. */
export function DateiLeiste({ dealId }: { dealId: string }) {
  const bezug: DokumentBezug = { art: 'deal', id: dealId };
  const { data: dokumente, isLoading, error } = useDokumente(bezug);
  const symbol = (mime: string) => (mime.includes('pdf') ? '📄' : mime.includes('image') ? '🖼' : '📎');
  return (
    <div aria-label="Datei-Leiste" style={{ marginBottom: 12 }}>
      <Text fz={10} c="dimmed" mb={4}>📁 Dateien</Text>
      <Group gap={4} wrap="wrap" mih={20}>
        {isLoading && <Text fz={10} c="dimmed">Lädt…</Text>}
        {!isLoading && !error && dokumente?.length === 0 && <Text fz={10} c="dimmed">Keine Dateien</Text>}
        {dokumente?.map((d) => {
          const name = d.label || d.dateiname || 'Datei';
          const kurz = name.length > 25 ? `${name.substring(0, 22)}…` : name;
          return (
            <Button key={d.id} component="a" href={dokumentDateiUrl(bezug, d.id)} target="_blank" rel="noopener" title={name}
              size="compact-xs" variant="default" fz={10} fw={400}>
              {symbol(d.mimeType)} {kurz}
            </Button>
          );
        })}
      </Group>
    </div>
  );
}
