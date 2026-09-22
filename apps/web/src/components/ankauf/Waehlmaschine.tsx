import type { AnrufErgebnisSpeichern, CockpitDeal, CockpitMakler } from '@gg/api-contract';
import { FREQUENZEN, isoPlusTage, type AnrufErgebnis } from '@gg/domain';
import { Alert, Badge, Button, Group, Modal, Progress, Select, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { holeWaehlmaschine, useAnrufErgebnis, useDealAnrufErgebnis } from '../../lib/api.ts';
import { leseEinstellung } from '../../lib/ansicht.ts';
import { euro } from '../../lib/format.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { FAELLIG_FARBE } from './Termin.tsx';
import { PRIO_FARBE } from './MaklerKarte.tsx';

const EXPRESS_SCHLUESSEL = 'gg.wm.express';

/**
 * Woher die Warteschlange kommt:
 *  • `deals` — „Liste durchwählen“ auf der Ankaufseite: die Deals aus „Deals nachverfolgen“ in der angezeigten
 *    Reihenfolge, je Halt der Makler des Deals; das Ergebnis wird am Deal gebucht (22.09.2026).
 *  • `makler` — die Liste „Makler kontaktieren“ (Charta §5, wie die alte Wählmaschine); das Ergebnis wird am Makler gebucht.
 */
export type WaehlQuelle = { art: 'deals'; deals: CockpitDeal[] } | { art: 'makler' };

/**
 * Wählmaschine (Charta §5): Warteschlange, Ergebnis Erreicht/Nicht erreicht/Rückruf, Notiz, Frequenz,
 * „Erledigt → Nächster“. Tasten 1/2/3, Enter, Strg/⌘+Enter, Esc; Express-Modus.
 */
export function Waehlmaschine({ offen, schliessen, heute, quelle = { art: 'makler' } }: { offen: boolean; schliessen: () => void; heute: string; quelle?: WaehlQuelle }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<Halt[] | null>(null);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ erreicht: 0, nicht: 0 });
  const [express, setExpress] = useState(() => leseEinstellung('wm.express', ['1', '0'] as const, '0') === '1');
  const [fehler, setFehler] = useState<string | null>(null);
  const einheit = quelle.art === 'deals' ? 'Deals' : 'Maklern';

  useEffect(() => {
    if (!offen) return;
    setQueue(null); setIndex(0); setStats({ erreicht: 0, nicht: 0 }); setFehler(null);
    // Die Deal-Liste ist die Liste der Seite selbst — sie wird nicht neu geladen, damit die Reihenfolge genau die angezeigte ist
    if (quelle.art === 'deals') setQueue(quelle.deals.map(dealHalt));
    else holeWaehlmaschine().then((m) => setQueue(m.map(maklerHalt))).catch((e: Error) => setFehler(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- die Liste wird beim Öffnen eingefroren
  }, [offen]);

  const zu = () => {
    void qc.invalidateQueries({ queryKey: ['ankauf'] });
    schliessen();
  };
  const aktuell = queue?.[index];
  const weiter = (ergebnis: AnrufErgebnis) => {
    if (ergebnis === 'erreicht') setStats((s) => ({ ...s, erreicht: s.erreicht + 1 }));
    if (ergebnis === 'nicht') setStats((s) => ({ ...s, nicht: s.nicht + 1 }));
    setIndex((i) => i + 1);
  };
  const expressSetzen = (an: boolean) => {
    setExpress(an);
    try { localStorage.setItem(EXPRESS_SCHLUESSEL, an ? '1' : '0'); } catch { /* nur Komfort */ }
  };
  const karte = { position: index + 1, gesamt: queue?.length ?? 0, einheit, heute, express, setExpress: expressSetzen, weiter, schliessen: zu };

  return (
    <Modal opened={offen} onClose={zu} title="📞 Wählmaschine" styles={{ title: { fontSize: 'var(--mantine-font-size-xl)', fontWeight: 700 } }} size="lg" closeOnEscape={false} closeButtonProps={{ 'aria-label': 'Wählmaschine schließen' }}>
      {fehler && <Alert color="red">{fehler}</Alert>}
      {!queue && !fehler && <Text c="dimmed">Lädt …</Text>}
      {queue && queue.length === 0 && <Text>{quelle.art === 'deals' ? 'Keine Deals diese Woche.' : 'Keine Makler diese Woche.'}</Text>}
      {aktuell?.art === 'deal' && <DealHalt key={aktuell.id} halt={aktuell} {...karte} />}
      {aktuell?.art === 'makler' && <MaklerHalt key={aktuell.id} halt={aktuell} {...karte} />}
      {queue && queue.length > 0 && !aktuell && (
        <Stack align="center" py="lg" aria-label="Zusammenfassung">
          <Text size="xl">✅ Fertig</Text>
          <Text c="green" fw={600}>{stats.erreicht} erreicht</Text>
          <Text c="red" fw={600}>{stats.nicht} nicht erreicht</Text>
          <Text c="dimmed">{queue.length - stats.erreicht - stats.nicht} übersprungen</Text>
          <Button onClick={zu}>Schließen</Button>
        </Stack>
      )}
    </Modal>
  );
}

// ── Ein Halt der Warteschlange: was die Karte zeigt, unabhängig davon, ob dahinter ein Deal oder ein Makler steht ──

interface HaltBasis {
  id: string;
  version: number;
  /** Überschrift (Makler-Name bzw. Objekt), darunter die Firma bzw. der Makler */
  titel: string;
  untertitel: string | null;
  /** rechts neben der Überschrift: Prio-Badge bzw. Deal-Status */
  abzeichen: ReactNode;
  /** Zeile unter der Überschrift, z. B. Kaufpreis */
  zeile: string | null;
  tel: string | null;
  faellig: CockpitDeal['faellig'];
  frequenz: string;
  frequenzLabel: string;
}
type Halt = (HaltBasis & { art: 'deal' }) | (HaltBasis & { art: 'makler' });

const dealHalt = (d: CockpitDeal): Halt => ({
  art: 'deal',
  id: d.id,
  version: d.version,
  titel: `📍 ${d.objekt.titel}${d.objekt.stadt ? `, ${d.objekt.stadt}` : ''}`,
  untertitel: d.makler ? [d.makler.firma, d.makler.name].filter(Boolean).join(' · ') || null : '– ohne Makler',
  abzeichen: <StatusBadge status={d.status} />,
  zeile: [d.kaufpreis ? euro(d.kaufpreis) : null, d.wohnflaeche ? `${d.wohnflaeche.toLocaleString('de-DE')} m²` : null].filter(Boolean).join(' · ') || null,
  tel: d.makler?.tel ?? null,
  faellig: d.faellig,
  frequenz: d.nachfassFrequenz || 'Wöchentlich',
  frequenzLabel: 'Nachfassfrequenz',
});

const maklerHalt = (m: CockpitMakler): Halt => ({
  art: 'makler',
  id: m.id,
  version: m.version,
  titel: m.name ?? '–',
  untertitel: m.firma ?? null,
  abzeichen: m.prio ? <Badge variant="light" color={PRIO_FARBE[m.prio] ?? 'gray'}>{m.prio}-Makler</Badge> : null,
  zeile: null,
  tel: m.tel ?? null,
  faellig: m.faellig,
  frequenz: m.kontaktFrequenz || 'Monatlich',
  frequenzLabel: 'Kontaktfrequenz',
});

type Speichern = { mutate: (e: AnrufErgebnisSpeichern, o: { onSuccess: () => void; onError: () => void }) => void; isPending: boolean; error: Error | null };
interface KartenProps {
  position: number; gesamt: number; einheit: string; heute: string; express: boolean;
  setExpress: (an: boolean) => void; weiter: (e: AnrufErgebnis) => void; schliessen: () => void;
}

/** Die Hüllen binden je einen Speicher-Hook — Hooks lassen sich nicht nach Art umschalten. */
function DealHalt({ halt, ...rest }: { halt: Halt } & KartenProps) {
  return <AnrufKarte halt={halt} speichern={useDealAnrufErgebnis(halt.id)} {...rest} />;
}
function MaklerHalt({ halt, ...rest }: { halt: Halt } & KartenProps) {
  return <AnrufKarte halt={halt} speichern={useAnrufErgebnis(halt.id)} {...rest} />;
}

function AnrufKarte({ halt: h, speichern, position, gesamt, einheit, heute, express, setExpress, weiter, schliessen }: { halt: Halt; speichern: Speichern } & KartenProps) {
  const [ergebnis, setErgebnis] = useState<AnrufErgebnis>(null);
  const [notiz, setNotiz] = useState('');
  const [frequenz, setFrequenz] = useState(h.frequenz);
  const [rueckruf, setRueckruf] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zustand = useRef({ ergebnis, notiz, frequenz, rueckruf, laeuft: false });
  zustand.current = { ...zustand.current, ergebnis, notiz, frequenz, rueckruf };

  const abschliessen = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const z = zustand.current;
    if (z.laeuft) return; // Knopf und Express-Zeitgeber dürfen sich nicht überholen
    z.laeuft = true;
    speichern.mutate(
      { version: h.version, ergebnis: z.ergebnis, notiz: z.notiz, frequenz: z.frequenz, rueckrufDatum: z.ergebnis === 'rueckruf' ? z.rueckruf || null : null },
      { onSuccess: () => weiter(z.ergebnis), onError: () => { z.laeuft = false; } },
    );
  }, [h.version, speichern, weiter]);

  const waehle = useCallback((e: Exclude<AnrufErgebnis, null>) => {
    setErgebnis(e);
    if (e === 'rueckruf') setRueckruf((r) => r || isoPlusTage(heute, 7));
    if (express && e !== 'rueckruf') {
      zustand.current.ergebnis = e;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(abschliessen, 200);
    }
  }, [abschliessen, express, heute]);

  useEffect(() => {
    const taste = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' && !(ev.metaKey || ev.ctrlKey)) return;
      if (tag === 'INPUT') return;
      if (ev.key === '1') { ev.preventDefault(); waehle('erreicht'); }
      else if (ev.key === '2') { ev.preventDefault(); waehle('nicht'); }
      else if (ev.key === '3') { ev.preventDefault(); waehle('rueckruf'); }
      else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey || zustand.current.ergebnis !== null)) { ev.preventDefault(); abschliessen(); }
      else if (ev.key === 'Escape') schliessen();
    };
    document.addEventListener('keydown', taste);
    return () => { document.removeEventListener('keydown', taste); if (timer.current) clearTimeout(timer.current); };
  }, [abschliessen, schliessen, waehle]);

  const knopf = (wert: Exclude<AnrufErgebnis, null>, text: string, farbe: string, taste: string) => (
    <Button variant={ergebnis === wert ? 'filled' : 'default'} color={farbe} onClick={() => waehle(wert)} aria-pressed={ergebnis === wert}>
      {text} <Text span size="xs" c="dimmed" ml={6}>({taste})</Text>
    </Button>
  );

  return (
    <Stack gap="sm" aria-label="Anruf" data-halt={`${h.art}:${h.id}`}>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" aria-label="Fortschritt">{position} von {gesamt} {einheit}</Text>
        <Switch size="xs" label="🚀 Express" checked={express} onChange={(e) => setExpress(e.currentTarget.checked)} />
      </Group>
      <Progress value={((position - 1) / gesamt) * 100} size="sm" />
      <div>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Title order={3}>{h.titel}</Title>
          {h.abzeichen}
        </Group>
        {h.untertitel && <Text c="dimmed">{h.untertitel}</Text>}
        {h.zeile && <Text size="sm" c="teal" fw={600}>{h.zeile}</Text>}
        <Badge variant="light" color={FAELLIG_FARBE[h.faellig.klasse]} mt={4}>{h.faellig.label}</Badge>
      </div>
      <Text size="xl" fw={700} c={h.tel ? 'green' : 'dimmed'}>{h.tel ?? 'Keine Nummer hinterlegt'}</Text>
      <Button component="a" href={h.tel ? `tel:${h.tel.replace(/\s/g, '')}` : undefined} disabled={!h.tel} color="green" size="lg">📞 Anrufen</Button>
      <Group grow>
        {knopf('erreicht', '✅ Erreicht', 'green', '1')}
        {knopf('nicht', '❌ Nicht erreicht', 'red', '2')}
        {knopf('rueckruf', '🔄 Rückruf', 'blue', '3')}
      </Group>
      {ergebnis === 'rueckruf' && <TextInput type="date" label="Rückruf am" value={rueckruf} onChange={(e) => setRueckruf(e.currentTarget.value)} />}
      <Textarea label="Gesprächsnotiz" autosize minRows={2} value={notiz} onChange={(e) => setNotiz(e.currentTarget.value)} />
      <Select label={h.frequenzLabel} data={[...new Set([...FREQUENZEN, frequenz])]} value={frequenz} allowDeselect={false} onChange={(v) => v && setFrequenz(v)} />
      {speichern.error && <Alert color="red" title="Nicht gespeichert">{speichern.error.message} – mit „Überspringen“ weiter.</Alert>}
      <Group justify="space-between">
        <Button variant="subtle" onClick={() => weiter(null)}>Überspringen</Button>
        <Button onClick={abschliessen} loading={speichern.isPending}>Erledigt → {h.art === 'deal' ? 'Nächster Deal' : 'Nächster Makler'}</Button>
      </Group>
    </Stack>
  );
}
