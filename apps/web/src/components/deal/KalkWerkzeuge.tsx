import type { DealEinheit, DealSanierung, KalkulationWerte, KalkVariante } from '@gg/api-contract';
import {
  einheitenAusErkennung, einheitenErsetzenFrage, MIETERHOEHUNG_KNOEPFE, sammelKpm2, sammelMietsteigerung, sammelRendite, type SammelErgebnis,
  VARIANTE_NAME_FRAGE, varianteGeladenHinweis, varianteGeloeschtHinweis, varianteGespeichertHinweis, varianteLadenFrage, varianteLoeschenFrage, varianteName, varianteOption,
} from '@gg/domain';
import { Alert, Button, Group, NativeSelect, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useEinheitenAusPdf, useVarianteAnlegen, useVarianteLoeschen, useVarianten } from '../../lib/api.ts';

type Einheit = Omit<DealEinheit, 'id'> & { id?: string };
type Sanierung = Omit<DealSanierung, 'id'> & { id?: string };
type Meldung = { farbe: 'teal' | 'red'; text: string } | null;

function useMeldung(dauer = 4000) {
  const [meldung, setMeldung] = useState<Meldung>(null);
  useEffect(() => { if (!meldung) return; const t = setTimeout(() => setMeldung(null), dauer); return () => clearTimeout(t); }, [meldung, dauer]);
  return [meldung, setMeldung] as const;
}

/** 📸 Varianten (dealVariantSave/Load/Delete): Momentaufnahmen der aktuellen Formularwerte. */
export function Variantenleiste({ dealId, aktuell, laden }: {
  dealId: string;
  aktuell: { kalkulation: KalkulationWerte; einheiten: Einheit[]; sanierungen: Sanierung[] };
  laden: (v: KalkVariante) => void;
}) {
  const { data: varianten = [] } = useVarianten(dealId);
  const anlegen = useVarianteAnlegen(dealId);
  const loeschen = useVarianteLoeschen(dealId);
  const [meldung, setMeldung] = useMeldung();

  const speichern = () => {
    const name = varianteName(window.prompt(VARIANTE_NAME_FRAGE, ''));
    if (!name) return;
    anlegen.mutate({ name, ...aktuell }, {
      onSuccess: (r) => setMeldung({ farbe: 'teal', text: varianteGespeichertHinweis(r.variante.name, r.anzahl) }),
      onError: (e) => setMeldung({ farbe: 'red', text: e.message }),
    });
  };
  const waehlen = (id: string) => {
    const v = varianten.find((x) => x.id === id);
    if (!v || !window.confirm(varianteLadenFrage(v.name))) return;
    laden(v);
    setMeldung({ farbe: 'teal', text: varianteGeladenHinweis(v.name) });
  };
  const entfernen = (v: KalkVariante) => {
    if (!window.confirm(varianteLoeschenFrage(v.name))) return;
    loeschen.mutate(v.id, { onSuccess: () => setMeldung({ farbe: 'teal', text: varianteGeloeschtHinweis(v.name) }) });
  };

  return (
    <div role="group" aria-label="Varianten" style={{ flex: 1, minWidth: 0 }}>
      <Group gap="xs" wrap="wrap">
        <Text size="xs" fw={600} c="dimmed">📸 Varianten:</Text>
        <Button size="compact-xs" variant="default" onClick={speichern} loading={anlegen.isPending}>💾 Speichern als…</Button>
        {varianten.length > 0 ? (
          <>
            <NativeSelect size="xs" aria-label="Variante laden" value="" onChange={(e) => waehlen(e.currentTarget.value)} style={{ maxWidth: 240 }}
              data={[{ value: '', label: 'Variante laden ▾' }, ...varianten.map((v) => ({ value: v.id, label: varianteOption(v.name, v.ts) }))]} />
            <Text size="xs" c="dimmed">{varianten.length} gespeichert</Text>
          </>
        ) : <Text size="xs" c="dimmed">Noch keine Variante gespeichert</Text>}
      </Group>
      {varianten.length > 0 && (
        <Group gap="md" mt={4}>
          {varianten.map((v) => (
            <Text key={v.id} size="xs" c="dimmed" data-variante={v.name}>
              📁 {v.name}{' '}
              <UnstyledButton onClick={() => entfernen(v)} aria-label={`Variante ${v.name} löschen`} title="Variante löschen" style={{ color: 'var(--mantine-color-red-6)', fontSize: 11 }}>🗑</UnstyledButton>
            </Text>
          ))}
        </Group>
      )}
      {meldung && <Alert color={meldung.farbe} variant="light" py={4} mt={6}>{meldung.text}</Alert>}
    </div>
  );
}

/** „Alle setzen:“ über der Einheitenliste und „📋 Aus Mieterliste-PDF“. */
export function AlleSetzen({ dealId, einheiten, setEinheiten, standardRendite }: {
  dealId: string; einheiten: Einheit[]; setEinheiten: (e: Einheit[]) => void; standardRendite: number;
}) {
  const [rendite, setRendite] = useState('');
  const [kpm2, setKpm2] = useState('');
  const [meldung, setMeldung] = useMeldung();
  const [status, setStatus] = useState('');
  const pdf = useEinheitenAusPdf(dealId);
  const eingabe = useRef<HTMLInputElement>(null);

  const anwenden = (r: SammelErgebnis<Einheit>) => {
    if (!r.ok) return setMeldung({ farbe: 'red', text: r.fehler });
    setEinheiten(r.einheiten);
    setMeldung({ farbe: 'teal', text: r.hinweis });
  };

  const ausPdf = (dateien: FileList | null) => {
    const datei = dateien?.[0];
    if (eingabe.current) eingabe.current.value = '';
    if (!datei) return;
    if (datei.type !== 'application/pdf') return setMeldung({ farbe: 'red', text: 'Nur PDF erlaubt' });
    setStatus('⏳ Lade hoch & analysiere…');
    pdf.mutate(datei, {
      onSuccess: ({ einheiten: erkannt, pages }) => {
        if (!erkannt.length) {
          setStatus('⚠️ Keine Einheiten erkannt');
          return setMeldung({ farbe: 'red', text: 'KI hat keine Einheiten gefunden — PDF prüfen' });
        }
        if (einheiten.length > 0 && !window.confirm(einheitenErsetzenFrage(erkannt, pages, einheiten.length))) {
          return setStatus('↩ Abgebrochen — bestehende Liste bleibt');
        }
        setEinheiten(einheitenAusErkennung(erkannt, standardRendite));
        setStatus(`✅ ${erkannt.length} Einheiten übernommen`);
        setMeldung({ farbe: 'teal', text: `✅ ${erkannt.length} Einheit(en) aus PDF übernommen` });
        setTimeout(() => setStatus(''), 5000);
      },
      onError: (e) => { setStatus(`❌ ${e.message}`); setMeldung({ farbe: 'red', text: `Fehler: ${e.message}` }); },
    });
  };

  return (
    <>
      <Group gap={6} wrap="wrap" mb="xs" p={6} aria-label="Alle setzen" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4 }}>
        <Text size="xs" fw={600} c="dimmed">Alle setzen:</Text>
        <TextInput size="xs" w={80} type="number" step="0.1" placeholder="Rendite %" aria-label="Rendite für alle" value={rendite} onChange={(e) => setRendite(e.currentTarget.value)} />
        <Button size="compact-xs" variant="default" onClick={() => anwenden(sammelRendite(einheiten, rendite))}>→ Rendite</Button>
        <Text size="xs" c="dimmed">│</Text>
        <TextInput size="xs" w={90} inputMode="numeric" placeholder="KP/m² €" aria-label="KP/m² für alle" value={kpm2} onChange={(e) => setKpm2(e.currentTarget.value)} />
        <Button size="compact-xs" variant="default" onClick={() => anwenden(sammelKpm2(einheiten, kpm2))}>→ KP/m²</Button>
        <Text size="xs" c="dimmed">│</Text>
        <Text size="xs" fw={600} c="dimmed">Mieterhöhung SOLL:</Text>
        {MIETERHOEHUNG_KNOEPFE.map((k) => (
          <Button key={k.pct} size="compact-xs" variant="default" title={k.titel} onClick={() => anwenden(sammelMietsteigerung(einheiten, k.pct))}>{k.label}</Button>
        ))}
        <span style={{ flex: 1 }} />
        <Button size="compact-xs" variant="light" loading={pdf.isPending} onClick={() => eingabe.current?.click()}
          title="PDF mit Mieterliste oder Flächenberechnung hochladen — KI extrahiert die Einheiten und ersetzt diese Liste">📋 Aus Mieterliste-PDF</Button>
        <input ref={eingabe} type="file" accept="application/pdf" hidden data-testid="einheiten-pdf" onChange={(e) => ausPdf(e.currentTarget.files)} />
        {status && <Text size="xs" c="dimmed" data-pdf-status>{status}</Text>}
      </Group>
      {meldung && <Alert color={meldung.farbe} variant="light" py={4} mb="xs">{meldung.text}</Alert>}
    </>
  );
}
