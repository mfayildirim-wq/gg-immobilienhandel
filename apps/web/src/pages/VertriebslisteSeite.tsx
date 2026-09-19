import type { Vertriebsliste, VlSpalte, VlZeile } from '@gg/api-contract';
import { computeRowValues, formatComputed, normalisiereDeutscheZahl, totalWohnflaeche, type Vertriebsliste as VlDomain, vlZellwert } from '@gg/domain';
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconSettings } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useAutomatischSpeichern } from '../lib/automatischSpeichern.ts';
import { useVertriebsliste, vertriebslisteSpeichern } from '../lib/api.ts';

const TYP_LABEL: Record<VlSpalte['type'], string> = { text: 'Text', multitext: 'Notiz', number: 'Zahl', euro: '€', percent: '%', date: 'Datum', dropdown: 'Auswahl', ampel: 'Ampel', checkbox: 'Ja/Nein' };
const AMPEL = [['gruen', 'Grün', '#4ade80'], ['gelb', 'Gelb', '#fbbf24'], ['rot', 'Rot', '#ef4444']] as const;

export function VertriebslisteSeite() {
  const { id } = useParams({ from: '/vertriebslisten/$id' });
  const { data, isLoading, error } = useVertriebsliste(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Vertriebsliste nicht gefunden'}</Alert>;
  return <Tabelle key={data.id} start={data} />;
}

type Stand = { versteckteSpalten: string[]; zeilen: VlZeile[] };

/** Zahlenzelle: beim Verlassen deutsche Schreibweise herstellen (deutscheZahlEingabe), dann wie vlUpdateCell umrechnen. */
function ZahlZelle({ wert, setzen, label }: { wert: unknown; setzen: (text: string) => void; label: string }) {
  const anzeige = wert === 0 || wert ? String(wert).replace('.', ',') : '';
  const [t, setT] = useState(anzeige);
  const [basis, setBasis] = useState(anzeige);
  if (anzeige !== basis) { setBasis(anzeige); setT(anzeige); }
  return <input aria-label={label} type="text" inputMode="decimal" value={t} onChange={(e) => setT(e.currentTarget.value)}
    onBlur={() => { const n = normalisiereDeutscheZahl(t); setT(n); if (n !== anzeige) setzen(n); }} style={{ width: '100%', textAlign: 'right' }} className="vl-feld" />;
}

function TextZelle({ wert, setzen, label, mehrzeilig }: { wert: unknown; setzen: (text: string) => void; label: string; mehrzeilig?: boolean }) {
  const anzeige = typeof wert === 'string' ? wert : wert == null ? '' : String(wert);
  const [t, setT] = useState(anzeige);
  const [basis, setBasis] = useState(anzeige);
  if (anzeige !== basis) { setBasis(anzeige); setT(anzeige); }
  const p = { 'aria-label': label, value: t, onBlur: () => t !== anzeige && setzen(t), className: 'vl-feld', style: { width: '100%' } };
  return mehrzeilig ? <textarea rows={1} {...p} onChange={(e) => setT(e.currentTarget.value)} /> : <input type="text" {...p} onChange={(e) => setT(e.currentTarget.value)} />;
}

function Tabelle({ start }: { start: Vertriebsliste }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stand, setStand] = useState<Stand>({ versteckteSpalten: start.versteckteSpalten, zeilen: start.zeilen });
  const [spaltenOffen, setSpaltenOffen] = useState(false);
  const zustand = useAutomatischSpeichern(stand, { version: start.version, stand: { versteckteSpalten: start.versteckteSpalten, zeilen: start.zeilen } },
    (s, version) => vertriebslisteSpeichern(start.id, { ...s, version }), (neu) => { qc.setQueryData(['vertriebsliste', start.id], neu); void qc.invalidateQueries({ queryKey: ['vertriebslisten'] }); }, 300);

  const versteckt = new Set(stand.versteckteSpalten);
  const sichtbar = start.spalten.filter((c) => !versteckt.has(c.id));
  const alsDomain = { rows: stand.zeilen.map((z) => ({ id: z.id, isStellplatz: z.istStellplatz, data: z.daten })) } as unknown as VlDomain;
  const totalWf = useMemo(() => totalWohnflaeche(alsDomain), [stand.zeilen]); // eslint-disable-line react-hooks/exhaustive-deps

  const zelleSetzen = (zeile: number, col: VlSpalte, value: unknown) => {
    const w = vlZellwert(col as never, col.id, value);
    if (w === null) return;
    setStand((s) => ({ ...s, zeilen: s.zeilen.map((z, i) => (i === zeile ? { ...z, daten: { ...z.daten, [col.id]: w } } : z)) }));
  };

  const zelle = (z: VlZeile, zi: number, col: VlSpalte, berechnet: Record<string, number>) => {
    const label = `${col.label} Zeile ${zi + 1}`;
    if (col.computed) return <td key={col.id} className={`vl-berechnet vl-${col.type}`} aria-label={label}>{formatComputed(col.type, berechnet[col.id])}</td>;
    const wert = z.daten[col.id];
    switch (col.type) {
      case 'number': case 'euro': case 'percent':
        return <td key={col.id}><ZahlZelle label={label} wert={wert} setzen={(t) => zelleSetzen(zi, col, t)} /></td>;
      case 'multitext':
        return <td key={col.id}><TextZelle mehrzeilig label={label} wert={wert} setzen={(t) => zelleSetzen(zi, col, t)} /></td>;
      case 'date':
        return <td key={col.id}><input aria-label={label} type="date" className="vl-feld" value={typeof wert === 'string' ? wert : ''} onChange={(e) => zelleSetzen(zi, col, e.currentTarget.value)} /></td>;
      case 'dropdown':
        return <td key={col.id}><select aria-label={label} className="vl-feld" value={typeof wert === 'string' ? wert : ''} onChange={(e) => zelleSetzen(zi, col, e.currentTarget.value)}>
          <option value="" />{(col.dropdownOptions ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>;
      case 'ampel':
        return <td key={col.id}><Group gap={2} wrap="nowrap">{AMPEL.map(([key, name, farbe]) => (
          <button key={key} type="button" aria-label={`${label}: ${name}`} aria-pressed={wert === key} onClick={() => zelleSetzen(zi, col, wert === key ? '' : key)}
            style={{ width: 14, height: 14, borderRadius: '50%', background: farbe, opacity: wert === key ? 1 : 0.3, border: '1px solid #ccc', cursor: 'pointer', padding: 0 }} />
        ))}</Group></td>;
      case 'checkbox':
        return <td key={col.id} style={{ textAlign: 'center' }}><input aria-label={label} type="checkbox" checked={wert === true || wert === 'true'} onChange={(e) => zelleSetzen(zi, col, e.currentTarget.checked)} /></td>;
      default:
        return <td key={col.id}><TextZelle label={label} wert={wert} setzen={(t) => zelleSetzen(zi, col, t)} /></td>;
    }
  };

  return (
    <Stack maw="100%">
      <style>{`
        .vl-table { border-collapse: collapse; font-size: 11px; }
        .vl-table th, .vl-table td { border: 1px solid var(--mantine-color-default-border); padding: 4px 6px; vertical-align: top; min-width: 90px; }
        .vl-table th { background: var(--mantine-color-body); position: sticky; top: 0; z-index: 2; text-align: left; font-size: 10px; line-height: 1.2; }
        .vl-table .vl-feld { border: none; background: transparent; font: inherit; padding: 2px 4px; min-height: 22px; box-sizing: border-box; color: inherit; }
        .vl-table .vl-feld:focus { outline: 1px solid var(--mantine-primary-color-filled); }
        .vl-table td.vl-berechnet { background: var(--mantine-color-default-hover); font-weight: 500; }
        .vl-table td.vl-euro, .vl-table td.vl-percent, .vl-table td.vl-number { text-align: right; }
        .vl-table tr.vl-stp td { background: rgba(0,0,0,.03); }
      `}</style>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon variant="subtle" aria-label="Zur Übersicht" onClick={() => navigate({ to: '/vertriebslisten' })}><IconArrowLeft /></ActionIcon>
          <Title order={3}>🏗️ Vertriebsliste — {start.titel}</Title>
        </Group>
        <Badge variant="light" color={typeof zustand === 'object' ? 'red' : zustand === 'gespeichert' ? 'green' : 'gray'} aria-label="Speicherstand">
          {typeof zustand === 'object' ? 'nicht gespeichert' : zustand === 'gespeichert' ? 'gespeichert' : 'speichert …'}
        </Badge>
      </Group>
      {typeof zustand === 'object' && <Alert color="red" title="Nicht gespeichert">{zustand.fehler} – Seite neu laden, um den aktuellen Stand zu holen.</Alert>}
      <Group gap="xs" wrap="wrap">
        <Button size="xs" variant="default" onClick={() => setStand((s) => ({ ...s, zeilen: [...s.zeilen, { id: crypto.randomUUID(), einheitId: null, istStellplatz: false, daten: {} }] }))}>➕ Wohnung</Button>
        <Button size="xs" variant="default" onClick={() => setStand((s) => ({ ...s, zeilen: [...s.zeilen, { id: crypto.randomUUID(), einheitId: null, istStellplatz: true, daten: {} }] }))}>➕ Stellplatz</Button>
        <Text size="xs" c="dimmed" ml="auto" aria-label="Kopfzeile">
          {stand.zeilen.length} Zeilen · {sichtbar.length}/{start.spalten.length} Spalten sichtbar
          {start.dealGik > 0 ? ` · GIK Aufteiler: ${Math.round(start.dealGik).toLocaleString('de-DE')} €` : ' · ⚠ keine GIK-Aufteiler-Kalk verfügbar'}
        </Text>
        <Button size="xs" variant="default" leftSection={<IconSettings size={14} />} onClick={() => setSpaltenOffen((x) => !x)}>Spalten</Button>
      </Group>
      {spaltenOffen && (
        <Paper withBorder p="xs">
          <Text size="xs" fw={600} mb={6}>Spalten ein-/ausblenden:</Text>
          <SimpleGrid cols={{ base: 1, sm: 3, lg: 4 }} spacing={4}>
            {start.spalten.map((c) => (
              <Checkbox key={c.id} size="xs" label={`${c.label}${c.computed ? ' 🔒' : ''}`} checked={!versteckt.has(c.id)}
                onChange={(e) => { const an = e.currentTarget.checked; setStand((s) => ({ ...s, versteckteSpalten: an ? s.versteckteSpalten.filter((x) => x !== c.id) : [...s.versteckteSpalten, c.id] })); }} />
            ))}
          </SimpleGrid>
        </Paper>
      )}
      <div style={{ overflow: 'auto', maxHeight: '75vh' }}>
        <table className="vl-table" aria-label="Vertriebsliste">
          <thead><tr><th>#</th>{sichtbar.map((c) => <th key={c.id} title={c.label}>{c.label}{c.computed ? ' 🔒' : ''}<Text span display="block" fz={9} c="dimmed">{TYP_LABEL[c.type]}</Text></th>)}</tr></thead>
          <tbody>
            {stand.zeilen.map((z, zi) => {
              const berechnet = computeRowValues({ id: z.id, isStellplatz: z.istStellplatz, data: z.daten as never }, start.dealGik, totalWf, start.provision);
              return (
                <tr key={z.id} className={z.istStellplatz ? 'vl-stp' : undefined} data-zeile={zi}>
                  <td style={{ minWidth: 30, textAlign: 'center' }}>{z.istStellplatz ? '🅿️' : '🏠'} {zi + 1}<br />
                    <button type="button" aria-label={`Zeile ${zi + 1} löschen`} onClick={() => window.confirm(`Zeile ${zi + 1} wirklich löschen?`) && setStand((s) => ({ ...s, zeilen: s.zeilen.filter((_, i) => i !== zi) }))}
                      style={{ background: 'none', border: 'none', color: 'var(--mantine-color-red-6)', cursor: 'pointer' }}>✕</button>
                  </td>
                  {sichtbar.map((c) => zelle(z, zi, c, berechnet))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Stack>
  );
}
