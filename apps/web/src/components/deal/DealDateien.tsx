import type { DealDokument } from '@gg/api-contract';
import { Alert, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useRef, useState } from 'react';
import { useDokumentBezeichnen, useDokumente, useDokumenteHochladen, useDokumentLoeschen } from '../../lib/api.ts';

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

/** 📁 Dateien (dealDateienHTML): Liste neueste zuerst, Bezeichnung, Öffnen, Löschen, Hochladen per Auswahl oder Ziehen. */
export function DealDateien({ dealId }: { dealId: string }) {
  const { data: dokumente = [], isLoading, error } = useDokumente(dealId);
  const hochladen = useDokumenteHochladen(dealId);
  const loeschen = useDokumentLoeschen(dealId);
  const eingabe = useRef<HTMLInputElement>(null);
  const [ziehen, setZiehen] = useState(false);
  const senden = (dateien: FileList | null) => { if (dateien?.length) hochladen.mutate([...dateien]); };

  return (
    <Stack gap="xs" aria-label="Dateien">
      {error && <Alert color="red">⚠ {error.message}</Alert>}
      {isLoading && <Text c="dimmed" ta="center" p="lg" size="sm">Lade…</Text>}
      {!isLoading && dokumente.length === 0 && <Text c="dimmed" ta="center" p="lg" size="sm">📁 Noch keine Dokumente</Text>}
      {dokumente.map((d) => <DokumentZeile key={d.id} dealId={dealId} d={d} loeschen={() => window.confirm('Dokument unwiderruflich löschen?') && loeschen.mutate(d.id)} />)}
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
    </Stack>
  );
}

function DokumentZeile({ dealId, d, loeschen }: { dealId: string; d: DealDokument; loeschen: () => void }) {
  const bezeichnen = useDokumentBezeichnen(dealId);
  const [label, setLabel] = useState(d.label);
  return (
    <Paper withBorder p="sm" data-dokument={d.id}>
      <Group wrap="nowrap" align="flex-start">
        <Text fz={22}>{dateiSymbol(d.mimeType)}</Text>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" truncate title={d.dateiname}>{d.dateiname}</Text>
          <Text size="xs" c="dimmed">{dateigroesse(d.groesseBytes)} · {new Date(d.hochgeladenAm.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleDateString('de-DE')}</Text>
          <TextInput size="xs" aria-label="Bezeichnung" placeholder="Bezeichnung (optional)" value={label} onChange={(e) => setLabel(e.currentTarget.value)}
            onBlur={() => label !== d.label && bezeichnen.mutate({ id: d.id, label })} />
        </Stack>
        <Stack gap={4}>
          <Button size="compact-xs" variant="default" component="a" href={`/api/deals/${dealId}/dokumente/${d.id}/datei`} target="_blank" rel="noopener">Öffnen</Button>
          <Button size="compact-xs" color="red" variant="light" onClick={loeschen}>Löschen</Button>
        </Stack>
      </Group>
    </Paper>
  );
}

/** 📁 Datei-Leiste über den Reitern Übersicht und Kalkulation (dealDocsStrip): jedes Dokument als Link zum Öffnen. */
export function DateiLeiste({ dealId }: { dealId: string }) {
  const { data: dokumente, isLoading, error } = useDokumente(dealId);
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
            <Button key={d.id} component="a" href={`/api/deals/${dealId}/dokumente/${d.id}/datei`} target="_blank" rel="noopener" title={name}
              size="compact-xs" variant="default" fz={10} fw={400}>
              {symbol(d.mimeType)} {kurz}
            </Button>
          );
        })}
      </Group>
    </div>
  );
}
