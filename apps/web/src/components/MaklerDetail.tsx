import type { MaklerDetail as Detail } from '@gg/api-contract';
import {
  dublettenMakler, emailPruefen, kommunikationKopf, kommZeitstempel, mailEntwurf, MAKLER_FREQUENZ_OPTIONEN, maklerDeals, nachfassStand, NICHT_KONTAKTIEREN_FRAGE,
  normalisiereFrequenz, personaDetectAnrede, resolveVorlage, telefonPruefen, vorlagenFuerKanal, vorlagenKontext, whatsappNummer,
} from '@gg/domain';
import {
  Alert, Anchor, Badge, Button, Group, Loader, Paper, SegmentedControl, Select, SimpleGrid, Stack, Tabs, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { Reiterleiste } from './Reiterleiste.tsx';
import { IconCheck, IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  transkribieren, useKommunikationAnlegen, useListen, useMaklerAendern, useMaklerDetail, useMaklerErledigt, useMaklerKi, useMaklerLoeschen, useMaklerPersoenlich,
  useOsint, useVorlagen, useWhatsappProtokoll,
} from '../lib/api.ts';
import { heuteIso } from '../lib/ansicht.ts';
import { datumDe } from '../lib/format.ts';
import { StatusBadge } from './StatusBadge.tsx';

/** `start`: der Reiter beim Öffnen — auf der Ankaufseite „Kommunikation“, auf der Makler-Liste das Profil. */
export function MaklerDetail({ id, geloescht, start = 'profil' }: { id: string; geloescht?: () => void; start?: 'profil' | 'komm' }) {
  const { data: m, isLoading, error } = useMaklerDetail(id);
  const [reiter, setReiter] = useState<string | null>(start);
  if (isLoading) return <Loader size="sm" />;
  if (error || !m) return <Alert color="red">{error?.message ?? 'Makler nicht gefunden'}</Alert>;
  return (
    <Tabs value={reiter} onChange={setReiter} keepMounted={false}>
      <Reiterleiste>
        <Tabs.Tab value="profil">👤 Profil</Tabs.Tab>
        <Tabs.Tab value="komm">💬 Kommunikation</Tabs.Tab>
        <Tabs.Tab value="persoenlich">🎯 Persönlich</Tabs.Tab>
        <Tabs.Tab value="deals">🤝 Deals</Tabs.Tab>
      </Reiterleiste>
      <Tabs.Panel value="profil" pt="md"><Profil key={m.version} m={m} geloescht={geloescht} /></Tabs.Panel>
      <Tabs.Panel value="komm" pt="md"><Kommunikation m={m} /></Tabs.Panel>
      <Tabs.Panel value="persoenlich" pt="md"><Persoenlich key={m.version} m={m} /></Tabs.Panel>
      <Tabs.Panel value="deals" pt="md"><Deals maklerId={m.id} /></Tabs.Panel>
    </Tabs>
  );
}

// ── 👤 Profil (mkFormHTML, mkSave, mkDelete) ─────────────────
function Profil({ m, geloescht }: { m: Detail; geloescht?: () => void }) {
  const aendern = useMaklerAendern(m.id);
  const erledigt = useMaklerErledigt(m.id);
  const loeschen = useMaklerLoeschen();
  const [f, setF] = useState({
    name: m.name ?? '', firma: m.firma ?? '', tel: m.tel ?? '', email: m.email ?? '', webseite: m.webseite ?? '',
    mobil: m.mobil ?? '', festnetz: m.festnetz ?? '', strasse: m.strasse ?? '', plz: m.plz ?? '', ort: m.ort ?? '',
  });
  const [prio, setPrio] = useState<'A' | 'B' | 'C'>(m.prio ?? 'B');
  const [frequenz, setFrequenz] = useState(normalisiereFrequenz(m.kontaktFrequenz));
  const [zuletzt, setZuletzt] = useState(m.lastContact ?? '');
  const [hinweis, setHinweis] = useState<string | null>(null);
  const telFehler = telefonPruefen(f.tel.trim());
  const mailFehler = emailPruefen(f.email.trim());
  const { faellig } = nachfassStand({ nextContact: m.nextContact, lastContact: m.lastContact, frequenz }, heuteIso());
  const fehler = aendern.error ?? erledigt.error ?? loeschen.error;

  return (
    <Stack>
      {fehler && <Alert color="red">{fehler.message}</Alert>}
      {hinweis && <Alert color="yellow" variant="light">{hinweis}</Alert>}
      <Group gap="xs">
        <Text size="xs" fw={700} c="dimmed">Priorität</Text>
        <SegmentedControl size="xs" aria-label="Priorität" value={prio} onChange={(v) => setPrio(v as 'A' | 'B' | 'C')}
          data={[{ value: 'A', label: '▲ A' }, { value: 'B', label: '◆ B' }, { value: 'C', label: '○ C' }]} />
      </Group>
      <Title order={6}>👤 Kontaktdaten</Title>
      <SimpleGrid cols={2} spacing="xs">
        <TextInput label="Name" placeholder="Max Müller" value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <TextInput label="Firma" placeholder="Immobilien GmbH" value={f.firma} onChange={(e) => setF({ ...f, firma: e.currentTarget.value })} />
        <TextInput label="Telefon" type="tel" placeholder="+49 711 123456" value={f.tel} error={telFehler} onChange={(e) => setF({ ...f, tel: e.currentTarget.value })} />
        <TextInput label="E-Mail" type="email" placeholder="name@firma.de" value={f.email} error={mailFehler} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
        <TextInput label="Webseite" value={f.webseite} onChange={(e) => setF({ ...f, webseite: e.currentTarget.value })} />
        <TextInput label="Mobil" type="tel" placeholder="+49 171 1234567" value={f.mobil} onChange={(e) => setF({ ...f, mobil: e.currentTarget.value })} />
        <TextInput label="Festnetz" type="tel" placeholder="+49 711 123456" value={f.festnetz} onChange={(e) => setF({ ...f, festnetz: e.currentTarget.value })} />
      </SimpleGrid>
      <Title order={6}>📍 Anschrift</Title>
      <TextInput label="Straße und Hausnummer" value={f.strasse} onChange={(e) => setF({ ...f, strasse: e.currentTarget.value })} />
      <SimpleGrid cols={2} spacing="xs">
        <TextInput label="PLZ" value={f.plz} maxLength={10} onChange={(e) => setF({ ...f, plz: e.currentTarget.value })} />
        <TextInput label="Ort" value={f.ort} onChange={(e) => setF({ ...f, ort: e.currentTarget.value })} />
      </SimpleGrid>
      {m.weitereKontakte && (
        <Paper withBorder p="xs">
          <Text size="xs" fw={700} c="dimmed" mb={4}>Weitere Kontakte aus Exposés</Text>
          {m.weitereKontakte.namen.length > 0 && <Text size="xs">👤 {m.weitereKontakte.namen.join(' · ')}</Text>}
          {m.weitereKontakte.telefonnummern.length > 0 && (
            <Group gap={6}>{m.weitereKontakte.telefonnummern.map((t) => <Anchor key={t} size="xs" href={`tel:${t}`}>📞 {t}</Anchor>)}</Group>
          )}
          {m.weitereKontakte.emails.length > 0 && (
            <Group gap={6}>{m.weitereKontakte.emails.map((x) => <Anchor key={x} size="xs" href={`mailto:${x}`}>✉️ {x}</Anchor>)}</Group>
          )}
        </Paper>
      )}
      <Title order={6}>📅 Kontakt-Frequenz</Title>
      <SimpleGrid cols={2} spacing="xs">
        <Select label="Frequenz" data={MAKLER_FREQUENZ_OPTIONEN.map((o) => ({ value: o.wert, label: o.label }))} value={frequenz} allowDeselect={false}
          description="„Nicht kontaktieren“ → Makler erscheint nie im Vertriebsmodul"
          onChange={(v) => { if (!v) return; if (v === 'Nie' && frequenz !== 'Nie' && !window.confirm(NICHT_KONTAKTIEREN_FRAGE)) return; setFrequenz(v as typeof frequenz); }} />
        <TextInput label="Zuletzt kontaktiert" type="date" value={zuletzt} description="Wird automatisch gesetzt beim „✓ Erledigt“" onChange={(e) => setZuletzt(e.currentTarget.value)} />
      </SimpleGrid>
      <Group gap="xs">
        <Badge color={faellig?.klasse === 'ueberfaellig' ? 'red' : faellig?.klasse === 'heute' ? 'orange' : 'gray'}>{faellig?.label ?? `nächster Kontakt ${datumDe(m.nextContact)}`}</Badge>
        <Button size="xs" variant="light" leftSection={<IconCheck size={14} />} loading={erledigt.isPending} onClick={() => erledigt.mutate(m.version)}>Erledigt</Button>
      </Group>
      <Group gap="xs">
        {m.tel && <Button component="a" href={`tel:${m.tel}`} variant="default" size="xs">📞 {m.tel}</Button>}
        {m.email && <Button component="a" href={`mailto:${m.email}`} variant="default" size="xs">✉️ {m.email}</Button>}
      </Group>
      <Group justify="space-between">
        <Button color="red" variant="light" leftSection={<IconTrash size={16} />} loading={loeschen.isPending}
          onClick={() => loeschen.mutate(m.id, { onSuccess: () => geloescht?.() })}>Löschen</Button>
        <Button leftSection={<IconDeviceFloppy size={16} />} loading={aendern.isPending} onClick={() => {
          // Keine Pflichtfelder; Format-Fehler nur als Warnung (mkSave)
          setHinweis(telFehler || mailFehler ? '⚠️ Tel/E-Mail-Format ungewöhnlich (trotzdem gespeichert)' : null);
          aendern.mutate({ version: m.version, ...f, prio, kontaktFrequenz: frequenz, lastContact: zuletzt || m.lastContact || null });
        }}>Speichern</Button>
      </Group>
    </Stack>
  );
}

/** Dublettenprüfung beim Anlegen (mkSave ohne mkEditId). */
export function maklerDublettenFrage(makler: { name?: string | null; email?: string | null; tel?: string | null }[], neu: { name: string; email: string; tel: string }): string | null {
  const d = dublettenMakler(makler.map((x) => ({ name: x.name ?? '', email: x.email ?? '', tel: x.tel ?? '' })), neu);
  if (!d) return null;
  const ex = d.match;
  const label = d.confidence === 'exact' ? `Exaktes Duplikat: "${ex.name}" (${ex.email || ex.tel || ''})` : `Ähnlicher Makler gefunden: "${ex.name}" (${ex.email || ex.tel || ''})`;
  return `⚠️ ${label}\n\nTrotzdem neuen Makler anlegen?`;
}

// ── 💬 Kommunikation (mkKommHTML) ────────────────────────────
function Kommunikation({ m }: { m: Detail }) {
  const anlegen = useKommunikationAnlegen(m.id);
  const aendern = useMaklerAendern(m.id);
  const zusammenfassung = useMaklerKi<{ kiSummary: string | null }>(m.id, 'zusammenfassung');
  const erwaehnungen = useMaklerKi<{ neu: number }>(m.id, 'erwaehnungen');
  const beziehung = useMaklerKi<{ beziehungsNotiz: string }>(m.id, 'beziehungsprofil');
  const wa = useWhatsappProtokoll(m.id);
  const [notiz, setNotiz] = useState('');
  const [bez, setBez] = useState(m.beziehungsNotiz ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [mail, setMail] = useState<{ an: string; betreff: string; text: string } | null>(null);
  const [meldung, setMeldung] = useState<{ farbe: string; text: string } | null>(null);
  useEffect(() => setBez(m.beziehungsNotiz ?? ''), [m.beziehungsNotiz]);
  const komm = m.kommunikation.map((k) => ({ ...k, ts: kommZeitstempel(k.zeitpunkt) }));
  const anrede = (m.persoenlich as { anredeForm?: 'du' | 'sie' } | null)?.anredeForm || personaDetectAnrede(komm);
  const waNum = whatsappNummer(m.tel);

  /** mkAddKomm: Eintrag, danach KI-Zusammenfassung und Erwähnungen im Hintergrund. */
  const eintragen = (e: { kanal: 'anruf' | 'email' | 'whatsapp' | 'notiz'; richtung?: 'eingehend' | 'ausgehend'; text: string; betreff?: string }, ok?: () => void) =>
    anlegen.mutate(e, {
      onSuccess: () => {
        ok?.();
        zusammenfassung.mutate(undefined, { onError: () => {} });
        erwaehnungen.mutate({ text: e.text, kanal: e.kanal }, { onError: () => {} });
      },
      onError: (err) => setMeldung({ farbe: 'red', text: `❌ Nicht gespeichert: ${err.message}` }),
    });

  return (
    <Stack>
      <Paper withBorder p="sm" style={{ borderLeft: '3px solid var(--mantine-primary-color-filled)' }} aria-label="KI-Zusammenfassung">
        <Title order={6}>🤖 KI-Zusammenfassung</Title>
        {m.kiSummary ? <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} data-ki-zusammenfassung>{m.kiSummary}</Text> : <Text size="sm" c="dimmed" fs="italic">Wird nach dem ersten Eintrag automatisch generiert…</Text>}
        {zusammenfassung.isPending && <Text size="xs" c="dimmed">⏳ wird aktualisiert…</Text>}
        {m.kiSummaryAt && <Text fz={10} c="dimmed" mt={4}>Zuletzt: {m.kiSummaryAt}</Text>}
      </Paper>

      <Paper withBorder p="sm" aria-label="Beziehungsprofil">
        <Group gap="xs" mb={6}>
          <Title order={6}>🤝 Beziehungsprofil</Title>
          {anrede !== 'unbekannt' && <Badge variant="light" color={anrede === 'du' ? 'teal' : 'blue'} tt="none" title="Automatisch erkannt aus ausgehenden Nachrichten">{anrede === 'du' ? '🤝 Du' : '🎩 Sie'}</Badge>}
          <Button size="compact-xs" variant="light" ml="auto" loading={beziehung.isPending} onClick={() => beziehung.mutate(undefined, {
            onSuccess: (r) => { setBez(r.beziehungsNotiz); setStatus('✓ Beziehungsprofil extrahiert'); },
            onError: (e) => { setStatus('Fehler bei der Analyse'); setMeldung({ farbe: 'red', text: e.message }); },
          })}>🤖 Analysieren</Button>
        </Group>
        <Text size="xs" c="dimmed" mb={6}>Was muss die KI über diese spezifische Beziehung wissen? Du/Sie, Ton, persönliche Details — hat Vorrang über den allgemeinen Stil.</Text>
        <Textarea aria-label="Beziehungsprofil" autosize minRows={3} value={bez} onChange={(e) => setBez(e.currentTarget.value)}
          placeholder="z.B.: Wir duzen uns seit dem ersten Treffen. Er ist sehr direkt und schätzt kurze WAs." />
        <Group gap="xs" mt={6}>
          <Button size="xs" loading={aendern.isPending} onClick={() => aendern.mutate({ version: m.version, beziehungsNotiz: bez.trim() || null }, { onSuccess: () => setStatus('✓ Gespeichert') })}>Speichern</Button>
          {status && <Text size="xs" c="dimmed">{status}</Text>}
        </Group>
      </Paper>

      <Group gap="xs" aria-label="Schnellaktionen">
        {waNum && <Button component="a" href={`https://wa.me/${waNum}`} target="_blank" rel="noopener noreferrer" size="xs" variant="default"
          onClick={() => setTimeout(() => wa.mutate(undefined), 800)}>📱 WhatsApp</Button>}
        <Aufnahme maklerId={m.id} speichern={(text, ok) => eintragen({ kanal: 'anruf', text }, ok)} />
        {m.email && <Button size="xs" variant="default" onClick={() => setMail(mail ? null : { an: m.email ?? '', betreff: '', text: '' })}>✉️ E-Mail vorbereiten</Button>}
        <Button size="xs" variant="default" onClick={() => document.getElementById(`notiz-${m.id}`)?.focus()}>📝 Notiz</Button>
      </Group>
      {meldung && <Alert color={meldung.farbe} variant="light" withCloseButton onClose={() => setMeldung(null)}>{meldung.text}</Alert>}
      {mail && <MailVorbereiten m={m} mail={mail} setMail={setMail} gesendet={(betreff, text) => eintragen({ kanal: 'email', richtung: 'ausgehend', text, betreff })} meldung={setMeldung} />}

      <Stack gap={6}>
        <Title order={6}>📝 Neue Notiz</Title>
        <Textarea id={`notiz-${m.id}`} aria-label="Neue Notiz" placeholder="Gesprächsnotiz, Beobachtung, Hinweis…" autosize minRows={2} value={notiz} onChange={(e) => setNotiz(e.currentTarget.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); document.getElementById(`notiz-senden-${m.id}`)?.click(); } }} />
        <Group><Button id={`notiz-senden-${m.id}`} size="xs" variant="default" loading={anlegen.isPending} onClick={() => {
          if (!notiz.trim()) { setMeldung({ farbe: 'red', text: 'Bitte Notiz eingeben' }); return; }
          eintragen({ kanal: 'notiz', text: notiz }, () => { setNotiz(''); setMeldung({ farbe: 'teal', text: 'Notiz gespeichert' }); });
        }}>+ Hinzufügen <Text span fz={10} c="dimmed" ml={4}>(⌘+Enter)</Text></Button></Group>
      </Stack>

      <section aria-label="Kommunikation">
        <Title order={6} mb={4}>📋 Verlauf</Title>
        {komm.length === 0 && <Text size="sm" c="dimmed">Noch keine Einträge</Text>}
        <Stack gap={0}>
          {komm.map((k) => {
            const kopf = kommunikationKopf(k);
            return (
              <div key={k.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--mantine-color-default-border)' }} data-komm={k.id}>
                <Group gap={8} mb={4}>
                  <Text fz={14}>{kopf.icon}</Text>
                  <Text fz={11} fw={600} c="dimmed" data-kanal>{kopf.text}</Text>
                  <Text fz={10} c="dimmed" ml="auto" data-ts>{k.ts}</Text>
                </Group>
                {k.betreff && <Text fz={11} c="dimmed" mb={3}>Betreff: {k.betreff}</Text>}
                <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }} data-text>{k.text}</Text>
              </div>
            );
          })}
        </Stack>
      </section>
    </Stack>
  );
}

/** ✉️ E-Mail vorbereiten (mailto:, Vorlagen, Protokoll) — die App versendet selbst keine Mails. */
function MailVorbereiten({ m, mail, setMail, gesendet, meldung }: {
  m: Detail; mail: { an: string; betreff: string; text: string }; setMail: (x: { an: string; betreff: string; text: string } | null) => void;
  gesendet: (betreff: string, text: string) => void; meldung: (x: { farbe: string; text: string }) => void;
}) {
  const { data: vorlagen } = useVorlagen();
  const { data: listen } = useListen();
  return (
    <Paper withBorder p="sm" aria-label="E-Mail vorbereiten">
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={600}>✉️ E-Mail vorbereiten</Text>
        <Select size="xs" w={200} placeholder="📋 Vorlage…" aria-label="Vorlage" value={null}
          data={vorlagenFuerKanal(vorlagen?.vorlagen ?? [], 'email').map((v) => ({ value: v.id, label: v.name }))}
          onChange={(id) => {
            const v = vorlagen?.vorlagen.find((x) => x.id === id);
            if (!v) return;
            const ctx = vorlagenKontext(listen?.makler.find((x) => x.id === m.id) ?? { id: m.id, name: m.name, firma: m.firma }, listen?.deals ?? [], listen?.objekte ?? [], vorlagen?.meinName ?? '');
            setMail({ ...mail, ...(v.betreff ? { betreff: resolveVorlage(v.betreff, ctx) } : {}), text: resolveVorlage(v.text, ctx) });
          }} />
      </Group>
      <SimpleGrid cols={2} spacing="xs">
        <TextInput size="xs" label="An" value={mail.an} onChange={(e) => setMail({ ...mail, an: e.currentTarget.value })} />
        <TextInput size="xs" label="Betreff" placeholder="Betreff…" value={mail.betreff} onChange={(e) => setMail({ ...mail, betreff: e.currentTarget.value })} />
      </SimpleGrid>
      <Textarea size="sm" mt="xs" label="Nachricht" placeholder="Ihre Nachricht…" autosize minRows={4} value={mail.text} onChange={(e) => setMail({ ...mail, text: e.currentTarget.value })} />
      <Alert color="blue" variant="light" mt="xs" p="xs"><Text size="xs">ℹ️ <b>Sicherheit:</b> Die App versendet keine E-Mails direkt. „Im Mail-Programm öffnen“ startet deinen Mail-Client mit vorausgefüllter Nachricht — du sendest selbst.</Text></Alert>
      <Group gap="xs" mt="xs">
        <Button size="xs" onClick={() => {
          const r = mailEntwurf(mail.an, mail.betreff, mail.text);
          if ('fehler' in r) { meldung({ farbe: 'red', text: r.fehler }); return; }
          window.open(r.url, '_self');
          gesendet(mail.betreff.trim(), mail.text.trim());
          meldung({ farbe: 'teal', text: r.gekuerzt ? 'E-Mail vorbereitet (Nachricht leicht gekürzt für mailto:)' : 'Mail-Programm wird geöffnet ✓' });
          setMail(null);
        }}>📨 Im Mail-Programm öffnen</Button>
        <Button size="xs" variant="subtle" onClick={() => setMail(null)}>Abbrechen</Button>
      </Group>
    </Paper>
  );
}

/** 🎤 Anruf aufnehmen → Whisper → prüfbares Transkript; bei Fehler bleibt die Aufnahme (Erneut versuchen / sichern). */
export function Aufnahme({ maklerId, speichern }: { maklerId: string; speichern: (text: string, ok: () => void) => void }) {
  const [zustand, setZustand] = useState<'bereit' | 'nimmt' | 'transkribiert' | 'pruefen' | 'fehler'>('bereit');
  const [sekunden, setSekunden] = useState(0);
  const [text, setText] = useState('');
  const [grund, setGrund] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const aufnahme = useRef<Blob | null>(null);
  useEffect(() => {
    if (zustand !== 'nimmt') return;
    const t = setInterval(() => setSekunden((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [zustand]);
  // Schließen der Ansicht beendet eine laufende Aufnahme und gibt das Mikrofon frei
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); recorder.current?.stream.getTracks().forEach((t) => t.stop()); }, [maklerId]);

  const senden = async (blob: Blob) => {
    setZustand('transkribiert');
    try {
      setText(await transkribieren(blob));
      aufnahme.current = null;
      setZustand('pruefen');
    } catch (e) {
      setGrund((e as Error).message);
      setZustand('fehler');
    }
  };
  const starten = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const typ = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const r = new MediaRecorder(stream, typ ? { mimeType: typ } : undefined);
      const teile: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size > 0) teile.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); aufnahme.current = new Blob(teile, { type: r.mimeType || 'audio/webm' }); void senden(aufnahme.current); };
      r.start(500);
      recorder.current = r;
      setSekunden(0);
      setZustand('nimmt');
    } catch {
      setGrund('Mikrofon-Zugriff verweigert');
      setZustand('fehler');
    }
  };

  if (zustand === 'bereit') return <Button size="xs" variant="default" onClick={() => void starten()}>🎤 Anruf aufnehmen</Button>;
  return (
    <Paper withBorder p="xs" w="100%" aria-label="Anruf-Aufnahme">
      {zustand === 'nimmt' && (
        <Group gap="xs">
          <Text size="sm" fw={600} c="red">● Aufnahme läuft…</Text>
          <Text size="xs" ff="monospace">{Math.floor(sekunden / 60)}:{String(sekunden % 60).padStart(2, '0')}</Text>
          <Button size="xs" variant="default" ml="auto" onClick={() => recorder.current?.stop()}>■ Stopp</Button>
        </Group>
      )}
      {zustand === 'transkribiert' && <Text size="sm" c="dimmed">⏳ Transkribiere Aufnahme…</Text>}
      {zustand === 'pruefen' && (
        <Stack gap="xs">
          <Textarea label="📝 Transkription (bearbeitbar)" autosize minRows={4} value={text} onChange={(e) => setText(e.currentTarget.value)} />
          <Group gap="xs">
            <Button size="xs" onClick={() => { if (text.trim()) speichern(text.trim(), () => { setText(''); setZustand('bereit'); }); }}>✓ Als Anruf-Notiz speichern</Button>
            <Button size="xs" variant="subtle" onClick={() => { setText(''); setZustand('bereit'); }}>✗ Verwerfen</Button>
          </Group>
        </Stack>
      )}
      {zustand === 'fehler' && (
        <Stack gap="xs">
          <Text size="sm" c="red">❌ Transkription fehlgeschlagen: {grund}</Text>
          {aufnahme.current ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Die Aufnahme ist erhalten geblieben.</Text>
              <Button size="xs" onClick={() => aufnahme.current && void senden(aufnahme.current)}>🔁 Erneut versuchen</Button>
              <Button size="xs" variant="default" onClick={() => {
                if (!aufnahme.current) return;
                const url = URL.createObjectURL(aufnahme.current);
                Object.assign(document.createElement('a'), { href: url, download: `anruf-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm` }).click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
              }}>⬇ Aufnahme sichern</Button>
            </Group>
          ) : <Button size="xs" variant="default" onClick={() => setZustand('bereit')}>OK</Button>}
        </Stack>
      )}
    </Paper>
  );
}

// ── 🎯 Persönlich (mkPersonalHTML) ───────────────────────────
function Persoenlich({ m }: { m: Detail }) {
  const p = (m.persoenlich ?? {}) as { geburtsdatum?: string; anredeForm?: 'du' | 'sie'; letzteErwaehnung?: { ts: string; thema: string; detail: string }[] };
  const speichern = useMaklerPersoenlich(m.id);
  const extrahieren = useMaklerKi<{ persoenlich: Record<string, unknown> }>(m.id, 'persoenliches');
  const [geb, setGeb] = useState(p.geburtsdatum ?? '');
  const [anrede, setAnrede] = useState<'' | 'du' | 'sie'>(p.anredeForm ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const erwaehnungen = (p.letzteErwaehnung ?? []).slice(0, 8);
  return (
    <Stack>
      <Group gap="xs">
        <Button variant="light" style={{ flex: 1 }} loading={extrahieren.isPending} onClick={() => extrahieren.mutate(undefined, {
          onSuccess: () => setStatus('✓ Persönliches ergänzt'), onError: (e) => setStatus(`Fehler: ${e.message}`),
        })}>🤖 Persönliches aus Kommunikation extrahieren (Haiku)</Button>
        {status && <Text size="xs" c="dimmed">{status}</Text>}
      </Group>
      <Paper withBorder p="sm" style={{ borderLeft: '3px solid var(--mantine-primary-color-filled)' }} aria-label="Persönliche Erwähnungen">
        <Title order={6}>📌 Persönliche Erwähnungen</Title>
        <Text fz={10} c="dimmed" mb={6}>Automatisch aus jeder neuen Kommunikation extrahiert</Text>
        {erwaehnungen.length === 0
          ? <Text size="xs" c="dimmed">Noch keine Erwähnungen gespeichert — erscheinen automatisch nach neuer Kommunikation.</Text>
          : erwaehnungen.map((e, i) => (
            <Group key={i} gap={8} wrap="nowrap" align="flex-start" py={5} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }} data-erwaehnung={i}>
              <Badge size="xs" variant="light" tt="none">{e.thema}</Badge>
              <Text size="xs" style={{ flex: 1 }}>{e.detail}</Text>
              <Text fz={10} c="dimmed">{e.ts}</Text>
            </Group>
          ))}
      </Paper>
      <SimpleGrid cols={2} spacing="xs">
        <TextInput label="🎂 Geburtstag" placeholder="MM-DD oder YYYY-MM-DD" description="z.B. 03-15 für 15. März" value={geb} onChange={(e) => setGeb(e.currentTarget.value)} />
        <Select label="🤝 Ansprache" value={anrede} allowDeselect={false} onChange={(v) => setAnrede((v ?? '') as '' | 'du' | 'sie')}
          data={[{ value: '', label: 'Automatisch (KI)' }, { value: 'du', label: 'per Du' }, { value: 'sie', label: 'per Sie' }]} />
      </SimpleGrid>
      <Button loading={speichern.isPending} onClick={() => speichern.mutate({ geburtsdatum: geb, anredeForm: anrede }, { onSuccess: () => setStatus('Persönliches gespeichert') })}>Persönliches speichern</Button>
      <Osint m={m} />
    </Stack>
  );
}

// ── 🤝 Deals (mkDealsHTML) ───────────────────────────────────
function Deals({ maklerId }: { maklerId: string }) {
  const { data: listen } = useListen();
  const navigate = useNavigate();
  if (!listen) return <Loader size="sm" />;
  const d = maklerDeals(listen.deals, maklerId);
  if (!d.kennzahlen.gesamt) return <Text c="dimmed" ta="center" p="xl">🤝 Keine Deals</Text>;
  const karte = (x: (typeof d.aktiv)[number]) => (
    <Paper key={x.id} withBorder p="xs" style={{ cursor: 'pointer' }} onClick={() => navigate({ to: '/deals', search: { deal: x.id } })} data-makler-deal={x.id}>
      <Group justify="space-between" wrap="nowrap">
        <div><Text size="sm" fw={600}>{x.titel}</Text><Text size="xs" c="dimmed">{x.unter}</Text></div>
        <Group gap="xs" wrap="nowrap">
          <StatusBadge status={x.status as never} />
          {x.kaufpreis && <Stack gap={0} align="flex-end"><Text size="sm" fw={600}>{x.kaufpreis}</Text><Text fz={10} c="dimmed">Kaufpreis</Text></Stack>}
        </Group>
      </Group>
    </Paper>
  );
  return (
    <Stack>
      <Title order={6}>Aktive Deals ({d.aktiv.length})</Title>
      {d.aktiv.length ? d.aktiv.map(karte) : <Text size="xs" c="dimmed">Keine aktiven Deals</Text>}
      {d.archiv.length > 0 && <><Title order={6}>Archiv ({d.archiv.length})</Title>{d.archiv.map(karte)}</>}
      <SimpleGrid cols={3}>
        {([['Deals gesamt', d.kennzahlen.gesamt], ['Aktiv', d.kennzahlen.aktiv], ['Angebote', d.kennzahlen.angebote]] as const).map(([l, v]) => (
          <Paper key={l} withBorder p="xs" ta="center"><Text fz={10} c="dimmed">{l}</Text><Text fz={22} fw={700}>{v}</Text></Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

/** 🔍 OSINT — Web-Suche (mkPersonalOSINTHTML, mkRunOSINT): Treffer, XING/LinkedIn, Handelsregister. */
function Osint({ m }: { m: Detail }) {
  const suchen = useOsint(m.id);
  const info = ((m.persoenlich ?? {}) as { personenInfo?: { ts: string; allgemein?: { titel: string; url: string }[]; xingUrl?: string; linkedinUrl?: string; handelsregister?: { hrNummer?: string; amtsgericht?: string; rechtsform?: string; quelleUrl?: string } } }).personenInfo;
  const hr = info?.handelsregister;
  return (
    <Paper withBorder p="sm" aria-label="OSINT">
      <Group justify="space-between" mb={6}>
        <Title order={6}>🔍 OSINT — Web-Suche</Title>
        {info?.ts && <Text fz={10} c="dimmed">Zuletzt: {new Date(info.ts).toLocaleDateString('de-DE')}</Text>}
      </Group>
      <Button variant="default" fullWidth justify="flex-start" loading={suchen.isPending} onClick={() => suchen.mutate(undefined)}>
        🔍 {info ? 'OSINT neu suchen' : 'OSINT-Suche starten'} (Web + Handelsregister)
      </Button>
      {suchen.error && <Text size="xs" c="red" mt={4}>❌ Fehler bei der Suche</Text>}
      {(info?.xingUrl || info?.linkedinUrl) && (
        <Group gap="xs" mt="xs">
          {info.xingUrl && <Anchor size="xs" href={info.xingUrl} target="_blank" rel="noopener noreferrer">XING →</Anchor>}
          {info.linkedinUrl && <Anchor size="xs" href={info.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn →</Anchor>}
        </Group>
      )}
      {hr?.hrNummer && (
        <Text size="xs" mt="xs" p={6} bg="var(--mantine-color-default-hover)">
          🏛️ <b>Handelsregister:</b> {hr.hrNummer}{hr.amtsgericht ? ` · AG ${hr.amtsgericht}` : ''}{hr.rechtsform ? ` (${hr.rechtsform})` : ''}
          {hr.quelleUrl && <Anchor size="xs" ml="xs" href={hr.quelleUrl} target="_blank" rel="noopener noreferrer">Quelle →</Anchor>}
        </Text>
      )}
      {info?.allgemein?.length
        ? <Stack gap={4} mt="xs">{info.allgemein.map((r) => (
          <div key={r.url}><Anchor size="xs" fw={600} href={r.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }} truncate>{r.titel}</Anchor><Text fz={10} c="dimmed" truncate>{r.url}</Text></div>
        ))}</Stack>
        : <Text size="xs" c="dimmed" mt="xs">{info ? 'Keine Ergebnisse gefunden.' : 'Noch keine Suche durchgeführt.'}</Text>}
    </Paper>
  );
}
