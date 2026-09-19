import type { CockpitMakler } from '@gg/api-contract';
import { FREQUENZEN, isoPlusTage, type AnrufErgebnis } from '@gg/domain';
import { Alert, Badge, Button, Group, Modal, Progress, Select, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { holeWaehlmaschine, useAnrufErgebnis } from '../../lib/api.ts';
import { leseEinstellung } from '../../lib/ansicht.ts';
import { FAELLIG_FARBE } from './Termin.tsx';
import { PRIO_FARBE } from './MaklerKarte.tsx';

const EXPRESS_SCHLUESSEL = 'gg.wm.express';

/**
 * Wählmaschine (Charta §5): Warteschlange fälliger Makler, Ergebnis Erreicht/Nicht erreicht/Rückruf,
 * Notiz, Frequenz, „Erledigt → Nächster Makler“. Tasten 1/2/3, Enter, Strg/⌘+Enter, Esc; Express-Modus.
 */
export function Waehlmaschine({ offen, schliessen, heute }: { offen: boolean; schliessen: () => void; heute: string }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<CockpitMakler[] | null>(null);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ erreicht: 0, nicht: 0 });
  const [express, setExpress] = useState(() => leseEinstellung('wm.express', ['1', '0'] as const, '0') === '1');
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!offen) return;
    setQueue(null); setIndex(0); setStats({ erreicht: 0, nicht: 0 }); setFehler(null);
    holeWaehlmaschine().then(setQueue).catch((e: Error) => setFehler(e.message));
  }, [offen]);

  const zu = () => {
    void qc.invalidateQueries({ queryKey: ['ankauf'] });
    schliessen();
  };
  const aktuell = queue?.[index];

  return (
    <Modal opened={offen} onClose={zu} title="📞 Wählmaschine" styles={{ title: { fontSize: 'var(--mantine-font-size-xl)', fontWeight: 700 } }} size="lg" closeOnEscape={false} closeButtonProps={{ 'aria-label': 'Wählmaschine schließen' }}>
      {fehler && <Alert color="red">{fehler}</Alert>}
      {!queue && !fehler && <Text c="dimmed">Lädt …</Text>}
      {queue && queue.length === 0 && <Text>Keine Makler diese Woche.</Text>}
      {queue && queue.length > 0 && aktuell && (
        <AnrufKarte
          key={aktuell.id}
          m={aktuell}
          position={index + 1}
          gesamt={queue.length}
          heute={heute}
          express={express}
          setExpress={(an) => {
            setExpress(an);
            try { localStorage.setItem(EXPRESS_SCHLUESSEL, an ? '1' : '0'); } catch { /* nur Komfort */ }
          }}
          weiter={(ergebnis) => {
            if (ergebnis === 'erreicht') setStats((s) => ({ ...s, erreicht: s.erreicht + 1 }));
            if (ergebnis === 'nicht') setStats((s) => ({ ...s, nicht: s.nicht + 1 }));
            setIndex((i) => i + 1);
          }}
          schliessen={zu}
        />
      )}
      {queue && queue.length > 0 && !aktuell && (
        <Stack align="center" py="lg" aria-label="Zusammenfassung">
          <Text size="xl">✅ Fertig</Text>
          <Text c="green" fw={600}>{stats.erreicht} Makler erreicht</Text>
          <Text c="red" fw={600}>{stats.nicht} nicht erreicht</Text>
          <Text c="dimmed">{queue.length - stats.erreicht - stats.nicht} übersprungen</Text>
          <Button onClick={zu}>Schließen</Button>
        </Stack>
      )}
    </Modal>
  );
}

function AnrufKarte({ m, position, gesamt, heute, express, setExpress, weiter, schliessen }: {
  m: CockpitMakler; position: number; gesamt: number; heute: string; express: boolean;
  setExpress: (an: boolean) => void; weiter: (e: AnrufErgebnis) => void; schliessen: () => void;
}) {
  const speichern = useAnrufErgebnis(m.id);
  const [ergebnis, setErgebnis] = useState<AnrufErgebnis>(null);
  const [notiz, setNotiz] = useState('');
  const [frequenz, setFrequenz] = useState(m.kontaktFrequenz || 'Monatlich');
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
      { version: m.version, ergebnis: z.ergebnis, notiz: z.notiz, frequenz: z.frequenz, rueckrufDatum: z.ergebnis === 'rueckruf' ? z.rueckruf || null : null },
      { onSuccess: () => weiter(z.ergebnis), onError: () => { z.laeuft = false; } },
    );
  }, [m.version, speichern, weiter]);

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
    <Stack gap="sm" aria-label="Anruf">
      <Group justify="space-between">
        <Text size="sm" c="dimmed" aria-label="Fortschritt">{position} von {gesamt} Maklern</Text>
        <Switch size="xs" label="🚀 Express" checked={express} onChange={(e) => setExpress(e.currentTarget.checked)} />
      </Group>
      <Progress value={((position - 1) / gesamt) * 100} size="sm" />
      <div>
        <Group justify="space-between">
          <Title order={3}>{m.name ?? '–'}</Title>
          {m.prio && <Badge variant="light" color={PRIO_FARBE[m.prio] ?? 'gray'}>{m.prio}-Makler</Badge>}
        </Group>
        {m.firma && <Text c="dimmed">{m.firma}</Text>}
        <Badge variant="light" color={FAELLIG_FARBE[m.faellig.klasse]} mt={4}>{m.faellig.label}</Badge>
      </div>
      <Text size="xl" fw={700} c={m.tel ? 'green' : 'dimmed'}>{m.tel ?? 'Keine Nummer hinterlegt'}</Text>
      <Button component="a" href={m.tel ? `tel:${m.tel.replace(/\s/g, '')}` : undefined} disabled={!m.tel} color="green" size="lg">📞 Anrufen</Button>
      <Group grow>
        {knopf('erreicht', '✅ Erreicht', 'green', '1')}
        {knopf('nicht', '❌ Nicht erreicht', 'red', '2')}
        {knopf('rueckruf', '🔄 Rückruf', 'blue', '3')}
      </Group>
      {ergebnis === 'rueckruf' && <TextInput type="date" label="Rückruf am" value={rueckruf} onChange={(e) => setRueckruf(e.currentTarget.value)} />}
      <Textarea label="Gesprächsnotiz" autosize minRows={2} value={notiz} onChange={(e) => setNotiz(e.currentTarget.value)} />
      <Select label="Kontaktfrequenz" data={[...new Set([...FREQUENZEN, frequenz])]} value={frequenz} allowDeselect={false} onChange={(v) => v && setFrequenz(v)} />
      {speichern.error && <Alert color="red" title="Nicht gespeichert">{speichern.error.message} – mit „Überspringen“ weiter.</Alert>}
      <Group justify="space-between">
        <Button variant="subtle" onClick={() => weiter(null)}>Überspringen</Button>
        <Button onClick={abschliessen} loading={speichern.isPending}>Erledigt → Nächster Makler</Button>
      </Group>
    </Stack>
  );
}
