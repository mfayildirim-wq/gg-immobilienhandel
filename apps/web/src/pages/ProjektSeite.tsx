import type { Projekt } from '@gg/api-contract';
import {
  PM_GEB_PIP_STATUS, PM_KATEGORIE_VORSCHLAG, PM_LOESCHEN_FRAGE, PM_TODO_FILTER, PM_TODO_FILTER_START, PM_TODO_STATUS, PM_VERMIETET, PM_VSTATUS_EINHEIT, PM_VSTATUS_GLOBAL,
  type PmEinheit, type PmTodo, type PmTodoFilter, pmCheckliste, pmEinheitAendern, pmEinheitAnzeige, pmEinheitenSummen, pmFinanzleiste, pmGespraechEntfernen,
  pmGespraechHinzufuegen, pmGlobalAendern, pmKategorieEntferntHinweis, pmKategorieNeu, pmKategorieUmbenennen, pmMassnahmeNeu, pmTodoAendern, pmTodoDarunter,
  pmTodoInKategorie, pmTodoLoeschen, pmTodoStatistik, pmZahlEingabe, pmZahlFeld,
} from '@gg/domain';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Paper, Progress, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { heuteIso } from '../lib/ansicht.ts';
import { useAutomatischSpeichern } from '../lib/automatischSpeichern.ts';
import { projektSpeichern, useProjekt, useProjektLoeschen } from '../lib/api.ts';

type Stand = Omit<Projekt, 'id' | 'dealId' | 'version' | 'updatedAt'>;
type Aendern = (f: (s: Stand) => Stand) => void;

export function ProjektSeite() {
  const { id } = useParams({ from: '/projekte/$id' });
  const { data, isLoading, error } = useProjekt(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) return <Alert color="red">{error?.message ?? 'Projekt nicht gefunden'}</Alert>;
  return <Projektansicht key={data.id} start={data} />;
}

const inhalt = ({ id: _i, dealId: _d, version: _v, updatedAt: _u, ...rest }: Projekt): Stand => rest;

/** Textfeld, das wie `onchange` der alten App erst beim Verlassen speichert. */
function Feld({ wert, setzen, label, mehrzeilig, zeilen = 2, className, placeholder, style }: {
  wert: string; setzen: (t: string) => void; label: string; mehrzeilig?: boolean; zeilen?: number; className?: string; placeholder?: string; style?: React.CSSProperties;
}) {
  const [t, setT] = useState(wert);
  const [basis, setBasis] = useState(wert);
  if (wert !== basis) { setBasis(wert); setT(wert); }
  const p = { 'aria-label': label, value: t, placeholder, className: className ?? 'pm-feld', style, onBlur: () => t !== wert && setzen(t) };
  return mehrzeilig ? <textarea rows={zeilen} {...p} onChange={(e) => setT(e.currentTarget.value)} /> : <input type="text" {...p} onChange={(e) => setT(e.currentTarget.value)} />;
}

/** Zahlenfeld (pmSaveVTNum): deutsche Eingabe, gespeichert als Zahl, angezeigt gerundet mit Tausenderpunkten. */
function ZahlFeld({ wert, setzen, label, style }: { wert: unknown; setzen: (n: number) => void; label: string; style?: React.CSSProperties }) {
  const anzeige = pmZahlFeld(wert);
  return <Feld label={label} wert={anzeige} style={{ textAlign: 'right', ...style }} setzen={(t) => setzen(pmZahlEingabe(t))} placeholder="–" />;
}

function Projektansicht({ start }: { start: Projekt }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const loeschen = useProjektLoeschen();
  const [stand, setStand] = useState<Stand>(inhalt(start));
  const [reiter, setReiter] = useState<string | null>('todo');
  const zustand = useAutomatischSpeichern(stand, { version: start.version, stand: inhalt(start) },
    (s, version) => projektSpeichern(start.id, { ...s, version }), (neu) => { qc.setQueryData(['projekt', start.id], neu); void qc.invalidateQueries({ queryKey: ['projekte'] }); }, 300);
  const p = { ...start, ...stand };
  return (
    <Stack maw="100%">
      <style>{`
        .pm-tab { border-collapse: collapse; font-size: 12px; width: 100%; }
        .pm-tab th { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--mantine-primary-color-filled); white-space: nowrap; }
        .pm-tab td { border-bottom: 1px solid var(--mantine-color-default-border); padding: 4px 6px; vertical-align: top; }
        .pm-feld { border: none; border-bottom: 1px solid var(--mantine-color-default-border); background: transparent; font: inherit; font-size: 12px; color: inherit; width: 100%; padding: 2px 0; box-sizing: border-box; resize: vertical; display: block; }
        textarea.pm-feld { field-sizing: content; min-height: 22px; }
        .pm-feld:focus { outline: 1px solid var(--mantine-primary-color-filled); }
        .pm-kat td { background: var(--mantine-color-default-hover); font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .pm-erledigt { opacity: .5; }
        .pm-erledigt textarea { text-decoration: line-through; }
        .pm-einh th, .pm-einh td { white-space: nowrap; }
      `}</style>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Button variant="default" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={() => navigate({ to: '/projekte' })}>Übersicht</Button>
          <Title order={3}>{p.adresse || '–'}, {p.stadt}</Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Badge variant="light" color={typeof zustand === 'object' ? 'red' : zustand === 'gespeichert' ? 'green' : 'gray'} aria-label="Speicherstand">
            {typeof zustand === 'object' ? 'nicht gespeichert' : zustand === 'gespeichert' ? 'gespeichert' : 'speichert …'}
          </Badge>
          <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} loading={loeschen.isPending}
            onClick={() => window.confirm(PM_LOESCHEN_FRAGE) && loeschen.mutate(start.id, { onSuccess: () => navigate({ to: '/projekte' }) })}>Löschen</Button>
        </Group>
      </Group>
      {typeof zustand === 'object' && <Alert color="red" title="Nicht gespeichert">{zustand.fehler} – Seite neu laden, um den aktuellen Stand zu holen.</Alert>}
      <Tabs value={reiter} onChange={setReiter} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="todo">✅ Checkliste</Tabs.Tab>
          <Tabs.Tab value="einh">📊 Einheitenliste</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="todo" pt="sm"><Checkliste todos={stand.todos} aendern={setStand} /></Tabs.Panel>
        <Tabs.Panel value="einh" pt="sm"><Einheitenliste p={p} aendern={setStand} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ── ① Checkliste ─────────────────────────────────────────────
function Checkliste({ todos, aendern }: { todos: PmTodo[]; aendern: Aendern }) {
  const [filter, setFilter] = useState<PmTodoFilter>(PM_TODO_FILTER_START);
  const [zu, setZu] = useState<Set<string>>(new Set());
  const [hinweis, setHinweis] = useState<string | null>(null);
  useEffect(() => { if (!hinweis) return; const t = setTimeout(() => setHinweis(null), 5000); return () => clearTimeout(t); }, [hinweis]);
  const stat = pmTodoStatistik(todos);
  const kategorien = pmCheckliste(todos, filter, heuteIso(), zu);
  const todosSetzen = (f: (t: PmTodo[]) => PmTodo[]) => aendern((s) => ({ ...s, todos: f(s.todos) }));
  const neueId = () => crypto.randomUUID();
  return (
    <Stack gap="xs">
      <Paper withBorder p="xs">
        <Group gap="md" wrap="wrap" mb={6} aria-label="Checkliste Zähler">
          <Text size="xs" c="dimmed" data-zaehler="offen">● {stat.offen} Offen</Text>
          <Text size="xs" c="orange" data-zaehler="progress">● {stat.inProgress} In Progress</Text>
          <Text size="xs" c="teal" data-zaehler="erledigt">● {stat.erledigt} Erledigt</Text>
          <Group gap={6} ml="auto" wrap="nowrap">
            <Progress value={stat.pct} color="teal" w={100} size="sm" aria-label="Fortschritt" />
            <Text size="xs" data-zaehler="pct">{stat.pct}%</Text>
          </Group>
          <Button size="compact-xs" variant="default" onClick={() => {
            const cat = window.prompt('Name der neuen Kategorie:', PM_KATEGORIE_VORSCHLAG);
            if (cat) todosSetzen((t) => pmKategorieNeu(t, cat, neueId()));
          }}>+ Kategorie</Button>
        </Group>
        <Group gap={6}>
          {PM_TODO_FILTER.map((f) => (
            <Button key={f.wert} size="compact-xs" radius="xl" variant={filter === f.wert ? 'filled' : 'default'} aria-pressed={filter === f.wert} onClick={() => setFilter(f.wert)}>{f.label}</Button>
          ))}
        </Group>
      </Paper>
      {hinweis && <Alert color="blue" variant="light" withCloseButton onClose={() => setHinweis(null)}>{hinweis}</Alert>}
      <div style={{ overflowX: 'auto' }}>
        <table className="pm-tab" aria-label="Checkliste" style={{ minWidth: 700 }}>
          <thead>
            <tr><th style={{ width: '38%' }}>Thema / Position</th><th style={{ width: '13%', textAlign: 'center' }}>Verantwortung</th><th style={{ width: '11%', textAlign: 'center' }}>Deadline</th>
              <th style={{ width: '12%', textAlign: 'center' }}>Status</th><th>Kommentar</th><th style={{ width: 56 }} /></tr>
          </thead>
          <tbody>
            {kategorien.map((k) => [
              <tr key={`kat-${k.cat}`} className="pm-kat" data-kategorie={k.cat}>
                <td colSpan={5}>
                  <Group gap={6} wrap="nowrap">
                    <ActionIcon size="xs" variant="transparent" aria-label={`${k.cat} ${k.eingeklappt ? 'ausklappen' : 'einklappen'}`}
                      onClick={() => setZu((z) => { const n = new Set(z); if (n.has(k.cat)) n.delete(k.cat); else n.add(k.cat); return n; })}>{k.eingeklappt ? '▶' : '▼'}</ActionIcon>
                    <Feld label={`Kategorie ${k.cat}`} wert={k.cat} className="pm-feld" style={{ borderBottom: 'none', textTransform: 'uppercase', fontWeight: 700 }}
                      setzen={(neu) => todosSetzen((t) => pmKategorieUmbenennen(t, k.cat, neu))} />
                    <Text span fz={9} c={k.erledigt === k.gesamt && k.gesamt ? 'teal' : 'dimmed'} data-kategorie-zaehler>{k.erledigt}/{k.gesamt}</Text>
                  </Group>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <ActionIcon size="sm" variant="subtle" aria-label={`Zeile in ${k.cat} hinzufügen`} onClick={() => todosSetzen((t) => pmTodoInKategorie(t, k.cat, neueId()))}>＋</ActionIcon>
                </td>
              </tr>,
              ...k.todos.map((t) => (
                <tr key={t.id} className={t.status === 'erledigt' ? 'pm-erledigt' : undefined} data-todo={t.id}>
                  <td><Feld mehrzeilig zeilen={1} label="Thema" wert={t.text} setzen={(v) => todosSetzen((x) => pmTodoAendern(x, t.id, { text: v }))} style={{ borderBottom: 'none' }} /></td>
                  <td><Feld label="Verantwortung" wert={t.verantwortlich} placeholder="–" style={{ textAlign: 'center' }} setzen={(v) => todosSetzen((x) => pmTodoAendern(x, t.id, { verantwortlich: v }))} /></td>
                  <td><input aria-label="Deadline" type="date" className="pm-feld" value={t.faellig} onChange={(e) => { const v = e.currentTarget.value; todosSetzen((x) => pmTodoAendern(x, t.id, { faellig: v })); }} /></td>
                  <td>
                    <select aria-label="Status" className="pm-feld" value={t.status} onChange={(e) => { const v = e.currentTarget.value as PmTodo['status']; todosSetzen((x) => pmTodoAendern(x, t.id, { status: v })); }}>
                      {PM_TODO_STATUS.map((s) => <option key={s.wert} value={s.wert}>{s.label}</option>)}
                    </select>
                  </td>
                  <td><Feld label="Kommentar" wert={t.kommentar} placeholder="Kommentar…" setzen={(v) => todosSetzen((x) => pmTodoAendern(x, t.id, { kommentar: v }))} /></td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <ActionIcon size="sm" variant="subtle" aria-label="Zeile darunter" onClick={() => todosSetzen((x) => pmTodoDarunter(x, t.id, neueId()))}>＋</ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Löschen" onClick={() => aendern((s) => {
                      const r = pmTodoLoeschen(s.todos, t.id);
                      if (r.kategorieEntfernt) setHinweis(pmKategorieEntferntHinweis(r.kategorieEntfernt));
                      return { ...s, todos: r.todos };
                    })}>✕</ActionIcon>
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </Stack>
  );
}

// ── ② Einheitenliste ─────────────────────────────────────────
const AMPEL = [['grn', '🟢', 'grün'], ['yel', '🟡', 'gelb'], ['red', '🔴', 'rot']] as const;
const VSTATUS_FARBE: Record<string, string> = { sold: 'teal', notar: 'yellow', reserved: 'orange', active: 'blue' };

function Einheitenliste({ p, aendern }: { p: Stand; aendern: Aendern }) {
  const [gespraeche, setGespraeche] = useState<string | null>(null);
  const einheitSetzen = (id: string, a: Partial<PmEinheit>) => aendern((s) => ({ ...s, einheiten: pmEinheitAendern(s.einheiten, id, a) }));
  const fl = pmFinanzleiste(p as Projekt);
  const sum = pmEinheitenSummen(p.einheiten);
  const kp = (e: PmEinheit, feld: 'grundpreis' | 'provision' | 'sanIVT' | 'ergebnisIVT' | 'zielKP', label: string) => (
    <td><ZahlFeld label={label} wert={e[feld]} style={{ width: 92, fontWeight: feld === 'zielKP' ? 700 : undefined }} setzen={(n) => einheitSetzen(e.id, { [feld]: n })} /></td>
  );
  const offeneEinheit = p.einheiten.find((e) => e.id === gespraeche);
  return (
    <Stack gap="xs">
      <Paper withBorder p="xs">
        <Group gap="xs" wrap="wrap" aria-label="Gebäude-PIP">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">🏢 Gebäude-PIP</Text>
          {p.gebPIP.map((m, i) => (
            <Group key={m.id} gap={4} wrap="nowrap" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4, padding: '2px 6px' }} data-massnahme={i}>
              <select aria-label="Maßnahme Status" className="pm-feld" style={{ width: 'auto', borderBottom: 'none', fontSize: 10 }} value={m.status}
                onChange={(e) => { const v = e.currentTarget.value; aendern((s) => ({ ...s, gebPIP: s.gebPIP.map((x, j) => (j === i ? { ...x, status: v } : x)) })); }}>
                {!PM_GEB_PIP_STATUS.includes(m.status as never) && <option value={m.status}>{m.status}</option>}
                {PM_GEB_PIP_STATUS.map((st) => <option key={st}>{st}</option>)}
              </select>
              <Feld label="Maßnahme" wert={m.text} placeholder="Maßnahme…" style={{ minWidth: 140, borderBottom: 'none' }}
                setzen={(v) => aendern((s) => ({ ...s, gebPIP: s.gebPIP.map((x, j) => (j === i ? { ...x, text: v } : x)) }))} />
              <ActionIcon size="xs" variant="subtle" color="red" aria-label="Maßnahme entfernen" onClick={() => aendern((s) => ({ ...s, gebPIP: s.gebPIP.filter((_, j) => j !== i) }))}>✕</ActionIcon>
            </Group>
          ))}
          <Button size="compact-xs" variant="default" onClick={() => aendern((s) => ({ ...s, gebPIP: [...s.gebPIP, pmMassnahmeNeu(crypto.randomUUID())] }))}>+ Maßnahme</Button>
        </Group>
      </Paper>

      <Paper withBorder p="sm" aria-label="Finanzleiste">
        <Group gap="lg" wrap="wrap" align="center">
          <Stack gap={0} align="center">
            <Feld label="Ziel-VKP gesamt €" wert={fl.ziel} placeholder="–" style={{ width: 130, textAlign: 'center', fontSize: 17 }} setzen={(t) => aendern((s) => pmGlobalAendern(s as Projekt, 'zielVKP', t))} />
            <Text fz={10} c="dimmed" tt="uppercase">Ziel-VKP gesamt €</Text>
          </Stack>
          <Text c="dimmed">→</Text>
          <Stack gap={0} align="center"><Text fz={17} c="teal" data-fin="beurkundet">{fl.beurkundet}</Text><Text fz={10} c="dimmed" tt="uppercase">Beurkundet</Text></Stack>
          <Text c="dimmed">+</Text>
          <Stack gap={0} align="center"><Text fz={17} c={fl.offenPositiv ? 'orange' : 'teal'} data-fin="offen">{fl.offen}</Text><Text fz={10} c="dimmed" tt="uppercase" data-fin="offen-label">{fl.offenLabel}</Text></Stack>
          <Text size="sm" c="dimmed" ml="auto" data-fin="quote">{fl.quote}</Text>
        </Group>
      </Paper>

      <div style={{ overflowX: 'auto' }}>
        <table className="pm-tab pm-einh" aria-label="Einheitenliste" style={{ minWidth: 1400 }}>
          <thead>
            <tr>
              <th rowSpan={2}>TE-Nr.</th><th rowSpan={2}>Lage</th><th rowSpan={2}>Zi</th><th rowSpan={2}>m²</th><th rowSpan={2}>Vermietet</th><th rowSpan={2}>Kaltmiete IST</th><th rowSpan={2}>Kaltmiete mögl.</th>
              <th colSpan={5} style={{ textAlign: 'center' }}>Kaufpreisbestandteile</th>
              <th rowSpan={2}>Vertriebsstand</th><th rowSpan={2}>Mieter</th><th rowSpan={2}>PIP-Ampel</th><th rowSpan={2}>PIP / Wertsteigerungsstrategie</th><th rowSpan={2}>Todos aus PIP</th>
              <th rowSpan={2}>Mietergespräche</th><th rowSpan={2}>Todos aus Mietergespräch</th>
              <th colSpan={4} style={{ textAlign: 'center' }}>Notartermin</th>
            </tr>
            <tr>
              <th>Grundpreis Whg.</th><th>Provision</th><th>Sanierung IVT</th><th>Ergebnis IVT</th><th>Verkaufspreis</th>
              <th>Reserviert</th><th>Notar-Datum</th><th>Käufer</th><th>Ist-KP</th>
            </tr>
          </thead>
          <tbody>
            {p.einheiten.map((e, idx) => {
              const a = pmEinheitAnzeige(e, idx);
              return (
                <tr key={e.id} data-einheit={idx} style={{ background: e.vstatus === 'sold' ? 'rgba(77,184,122,.06)' : e.vstatus === 'notar' ? 'rgba(255,220,50,.04)' : undefined }}>
                  <td data-spalte="teNr">{a.teNr}</td>
                  <td data-spalte="lage" style={{ fontWeight: 600 }}>{a.lage}</td>
                  <td data-spalte="zimmer">{a.zimmer}</td>
                  <td data-spalte="flaeche">{a.flaeche}</td>
                  <td>
                    <select aria-label="Vermietet" className="pm-feld" style={{ width: 90 }} value={a.vermietet} onChange={(ev) => einheitSetzen(e.id, { vermietet: ev.currentTarget.value })}>
                      {PM_VERMIETET.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </td>
                  <td data-spalte="kaltmiete">{a.kaltmiete}</td>
                  <td data-spalte="kmMoeglich">{a.kmMoeglich}</td>
                  {kp(e, 'grundpreis', 'Grundpreis Whg.')}
                  {kp(e, 'provision', 'Provision')}
                  {kp(e, 'sanIVT', 'Sanierung IVT')}
                  {kp(e, 'ergebnisIVT', 'Ergebnis IVT')}
                  {kp(e, 'zielKP', 'Verkaufspreis')}
                  <td style={{ minWidth: 124 }}>
                    <select aria-label="Vertriebsstand" className="pm-feld" style={{ width: 112, marginBottom: 4, color: VSTATUS_FARBE[e.vstatus] ? `var(--mantine-color-${VSTATUS_FARBE[e.vstatus]}-7)` : undefined }}
                      value={e.vstatus} onChange={(ev) => einheitSetzen(e.id, { vstatus: ev.currentTarget.value as PmEinheit['vstatus'] })}>
                      {PM_VSTATUS_EINHEIT.map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
                    </select>
                    <Feld label="Vertriebsstand Notiz" wert={e.vertriebsstand} placeholder="z.B. 25.03 Jonas" style={{ width: 110 }} setzen={(v) => einheitSetzen(e.id, { vertriebsstand: v })} />
                  </td>
                  <td><Feld label="Mieter" wert={e.mieterName} placeholder="Name" style={{ width: 90 }} setzen={(v) => einheitSetzen(e.id, { mieterName: v })} /></td>
                  <td>
                    <Group gap={2} wrap="nowrap" justify="center">
                      {AMPEL.map(([w, zeichen, name]) => (
                        <button key={w} type="button" aria-label={`PIP ${name}`} aria-pressed={e.pip === w} onClick={() => einheitSetzen(e.id, { pip: w })}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: e.pip === w ? 1 : 0.25, padding: 0 }}>{zeichen}</button>
                      ))}
                    </Group>
                  </td>
                  <td><Feld mehrzeilig label="PIP-Strategie" wert={e.pipStrategie} placeholder="Strategie / PIP-Plan…" style={{ minWidth: 180 }} setzen={(v) => einheitSetzen(e.id, { pipStrategie: v })} /></td>
                  <td><Feld mehrzeilig label="Todos aus PIP" wert={e.pipTodosText} placeholder="Todos aus PIP…" style={{ minWidth: 140 }} setzen={(v) => einheitSetzen(e.id, { pipTodosText: v })} /></td>
                  <td style={{ cursor: 'pointer' }} data-spalte="gespraeche">
                    <button type="button" aria-label={`Mietergespräche ${e.lage || 'Einheit'}`} onClick={() => setGespraeche(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 140, padding: 0, color: 'inherit', font: 'inherit' }}>
                      {a.gespraeche ? <><Text size="xs" fw={600} c="blue">{a.gespraeche}</Text><Text fz={10} c="dimmed">{a.letztesGespraech}</Text></> : <Text size="xs" c="dimmed">+ Eintrag hinzufügen</Text>}
                    </button>
                  </td>
                  <td><Feld mehrzeilig label="Todos aus Mietergespräch" wert={e.mieterTodosText} placeholder="Todos aus Mietergespräch…" style={{ minWidth: 140 }} setzen={(v) => einheitSetzen(e.id, { mieterTodosText: v })} /></td>
                  <td><input aria-label="Reserviert" type="date" className="pm-feld" style={{ width: 120 }} value={e.reservDatum} onChange={(ev) => einheitSetzen(e.id, { reservDatum: ev.currentTarget.value })} /></td>
                  <td><input aria-label="Notar-Datum" type="date" className="pm-feld" style={{ width: 120 }} value={e.notarDatum} onChange={(ev) => einheitSetzen(e.id, { notarDatum: ev.currentTarget.value })} /></td>
                  <td><Feld label="Käufer" wert={e.kaeufer} placeholder="Käufer" style={{ width: 90 }} setzen={(v) => einheitSetzen(e.id, { kaeufer: v })} /></td>
                  <td><ZahlFeld label="Ist-KP" wert={e.istKP} style={{ width: 100, fontWeight: 700 }} setzen={(n) => einheitSetzen(e.id, { istKP: n })} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }} aria-label="Summen">
              <td colSpan={2}>∑ Gesamt</td><td /><td data-summe="flaeche">{sum.flaeche}</td><td /><td data-summe="kaltmiete">{sum.kaltmiete}</td><td />
              <td data-summe="grundpreis">{sum.grundpreis}</td><td data-summe="provision">{sum.provision}</td><td data-summe="sanIVT">{sum.sanIVT}</td>
              <td data-summe="ergebnisIVT">{sum.ergebnisIVT}</td><td data-summe="zielKP">{sum.zielKP}</td>
              <td colSpan={7} /><td /><td /><td /><td data-summe="istKP">{sum.istKP}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Paper withBorder aria-label="Globalverkauf">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" px="sm" py={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>🏢 Globalverkauf (gesamtes Objekt)</Text>
        <Group gap="sm" p="sm" align="flex-end" wrap="wrap">
          <Stack gap={2}><Text fz={9} c="dimmed">Status</Text>
            <select aria-label="Globalverkauf Status" className="pm-feld" style={{ width: 130 }} value={p.globalVstatus} onChange={(e) => { const v = e.currentTarget.value; aendern((s) => pmGlobalAendern(s as Projekt, 'globalVstatus', v)); }}>
              {PM_VSTATUS_GLOBAL.map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
            </select></Stack>
          <Stack gap={2}><Text fz={9} c="dimmed">Reserviert</Text>
            <input aria-label="Globalverkauf Reserviert" type="date" className="pm-feld" value={p.globalReservDatum} onChange={(e) => { const v = e.currentTarget.value; aendern((s) => pmGlobalAendern(s as Projekt, 'globalReservDatum', v)); }} /></Stack>
          <Stack gap={2}><Text fz={9} c="dimmed">Notar-Datum</Text>
            <input aria-label="Globalverkauf Notar-Datum" type="date" className="pm-feld" value={p.globalNotarDatum} onChange={(e) => { const v = e.currentTarget.value; aendern((s) => pmGlobalAendern(s as Projekt, 'globalNotarDatum', v)); }} /></Stack>
          <Stack gap={2}><Text fz={9} c="dimmed">Käufer</Text>
            <Feld label="Globalverkauf Käufer" wert={p.globalKaeufer} placeholder="Name" style={{ width: 120 }} setzen={(v) => aendern((s) => pmGlobalAendern(s as Projekt, 'globalKaeufer', v))} /></Stack>
          <Stack gap={2}><Text fz={9} c="dimmed">Ist-Kaufpreis €</Text>
            <Feld label="Globalverkauf Ist-Kaufpreis" wert={pmZahlFeld(p.globalIstKP)} style={{ width: 110 }} setzen={(v) => aendern((s) => pmGlobalAendern(s as Projekt, 'globalIstKP', v))} /></Stack>
          <Stack gap={2} style={{ flex: 1 }}><Text fz={9} c="dimmed">Kommentar</Text>
            <Feld label="Globalverkauf Kommentar" wert={p.globalKommentar} placeholder="Notiz…" setzen={(v) => aendern((s) => pmGlobalAendern(s as Projekt, 'globalKommentar', v))} /></Stack>
        </Group>
      </Paper>

      {offeneEinheit && <Mietergespraeche einheit={offeneEinheit} schliessen={() => setGespraeche(null)}
        setzen={(neu) => aendern((s) => ({ ...s, einheiten: s.einheiten.map((x) => (x.id === neu.id ? neu : x)) }))} />}
    </Stack>
  );
}

/** pmOpenMieterHist */
function Mietergespraeche({ einheit, setzen, schliessen }: { einheit: PmEinheit; setzen: (e: PmEinheit) => void; schliessen: () => void }) {
  const [datum, setDatum] = useState(heuteIso());
  const [inhalt, setInhalt] = useState('');
  const [ergebnis, setErgebnis] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  return (
    <Modal opened onClose={schliessen} title={`Mietergespräche – ${einheit.lage || 'Einheit'}`}>
      <Stack gap="xs">
        {einheit.mieterHistorie.length === 0 && <Text size="xs" c="dimmed">Noch keine Einträge</Text>}
        {einheit.mieterHistorie.map((h, i) => (
          <Paper key={h.id} withBorder p="xs" data-gespraech={i}>
            <Group justify="space-between"><Text size="xs" c="dimmed">{h.datum}</Text>
              <ActionIcon size="xs" variant="subtle" color="red" aria-label="Eintrag entfernen" onClick={() => setzen(pmGespraechEntfernen(einheit, i))}>✕</ActionIcon></Group>
            <Text size="sm">{h.inhalt}</Text>
            {h.ergebnis && <Text size="xs" c="teal">→ {h.ergebnis}</Text>}
          </Paper>
        ))}
        <Group gap="xs" wrap="nowrap">
          <input aria-label="Gesprächsdatum" type="date" className="pm-feld" style={{ width: 140 }} value={datum} onChange={(e) => setDatum(e.currentTarget.value)} />
          <input aria-label="Gesprächsinhalt" className="pm-feld" placeholder="Gesprächsinhalt…" value={inhalt} onChange={(e) => setInhalt(e.currentTarget.value)} />
        </Group>
        <Group gap="xs" wrap="nowrap">
          <input aria-label="Ergebnis" className="pm-feld" placeholder="Ergebnis / nächster Schritt…" value={ergebnis} onChange={(e) => setErgebnis(e.currentTarget.value)} />
          <Button size="xs" onClick={() => {
            const r = pmGespraechHinzufuegen(einheit, { datum, inhalt, ergebnis }, heuteIso(), crypto.randomUUID());
            if ('fehler' in r) { setFehler(r.fehler); return; }
            setFehler(null); setInhalt(''); setErgebnis(''); setDatum(heuteIso());
            setzen(r);
          }}>+ Eintrag</Button>
        </Group>
        {fehler && <Alert color="red">{fehler}</Alert>}
      </Stack>
    </Modal>
  );
}
