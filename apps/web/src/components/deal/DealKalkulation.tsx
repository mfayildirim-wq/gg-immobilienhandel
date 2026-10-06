import type { DealDetail, DealEinheit, DealSanierung, KalkulationWerte } from '@gg/api-contract';
import {
  type AnkaufErgebnis,
  aufteilungskostenVorschlag,
  berechneAnkauf,
  KALK_UNGESPEICHERT_FRAGE,
  einheitAlsEingabe,
  KALK_STANDARD,
  type KalkStandard,
  margenAmpel,
  sanierungAlsEingabe, kalkMitStandard, einheitMieteGeaendert, einheitPreisSetzen, type PreisFeld } from '@gg/domain';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDeviceFloppy, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import { type ReactNode, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKalkStandard, useKalkulationSpeichern } from '../../lib/api.ts';
import { alsZahl, euro, euroProQm, prozent } from '../../lib/format.ts';
import { useUngespeichert } from '../../lib/ungespeichert.ts';
import { AlleSetzen, Variantenleiste } from './KalkWerkzeuge.tsx';
import { PropstackDialog } from './PropstackDialog.tsx';
import css from './DealDetail.module.css';

type Einheit = Omit<DealEinheit, 'id'> & { id?: string };
type Sanierung = Omit<DealSanierung, 'id'> & { id?: string };

const ZAHL = { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } as const;

const AMPEL_FARBE = { gruen: 'green', gelb: 'yellow', rot: 'red', verlust: 'red' } as const;
const AMPEL_TEXT = { gruen: '✅ Attraktiv', gelb: '⚠️ Akzeptabel', rot: '🔴 Schwach', verlust: '❌ Verlust' } as const;
const FARBE = { ist: 'blue.7', soll: 'green.7', vkp: 'orange.7' } as const;
const de2 = (n: number) => n.toFixed(2).replace('.', ',');
const de1 = (n: number) => n.toFixed(1).replace('.', ',');

/**
 * Aufbau und Reihenfolge wie in der alten App (dealKalkHTML): Einheitenliste IST / SOLL →
 * Kaufpreis & Nebenkosten → Finanzierung → Sanierungskosten → GIK & Ergebnis mit den Boxen
 * Aufteiler und Global (Projektkosten → Herstellungskosten → Exit). Gerechnet wird nur in @gg/domain.
 */

/** `leistenPlatz`: fester Platz unter der Reiterleiste des Deals — dorthin kommt die Knopfleiste, damit sie beim Scrollen stehen bleibt. */
export function DealKalkulation({ deal, leistenPlatz }: { deal: DealDetail; leistenPlatz: HTMLElement | null }) {
  const { data: standard = KALK_STANDARD } = useKalkStandard();
  const speichern = useKalkulationSpeichern(deal.id);
  const [kalk, setKalk] = useState<KalkulationWerte>(deal.kalkulation);
  const [einheiten, setEinheiten] = useState<Einheit[]>(deal.einheiten);
  const [sanierungen, setSanierungen] = useState<Sanierung[]>(deal.sanierungen);

  const ergebnis = useMemo(
    () => berechneAnkauf(kalkMitStandard(kalk, standard), einheiten.map(einheitAlsEingabe), sanierungen.map(sanierungAlsEingabe), standard),
    [kalk, einheiten, sanierungen, standard],
  );
  const geaendert =
    JSON.stringify([kalk, einheiten, sanierungen]) !== JSON.stringify([deal.kalkulation, deal.einheiten, deal.sanierungen]);
  // Reiterwechsel und ein anderer Deal bauen die Kalkulation neu auf — ohne Rückfrage wären die Eingaben still verloren
  useUngespeichert(geaendert, KALK_UNGESPEICHERT_FRAGE);

  const setzeFeld = (feld: string, v: number | string) => {
    const n = alsZahl(v);
    setKalk((k) => {
      const neu = { ...k };
      if (n === null) delete neu[feld];
      else neu[feld] = n;
      // FK und EK ergänzen sich zu 100 % (wie dkSyncEk/dkSyncFk)
      if (feld === 'fk_p' && n !== null) neu.ek_p = Math.max(0, 100 - n);
      if (feld === 'ek_p' && n !== null) neu.fk_p = Math.max(0, 100 - n);
      // Risikopuffer wie dkRpSync: Prozent oder fester Betrag — wer das eine setzt, nimmt das andere zurück
      if (feld === 'rp_pct' && n !== null) delete neu.rp_fix;
      if (feld === 'rp_fix') neu.rp_pct = 0;
      return neu;
    });
  };
  const zahlAus = (feld: string) => (typeof kalk[feld] === 'number' ? (kalk[feld] as number) : '');

  // Links die Varianten, rechts Verwerfen und Speichern — in einer Leiste, die mit der Reiterleiste stehen bleibt
  const leiste = (
    <div className={css.leiste} role="group" aria-label="Kalkulation speichern und Varianten">
      <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
        <Variantenleiste
          dealId={deal.id}
          aktuell={{ kalkulation: kalk, einheiten, sanierungen }}
          laden={(v) => {
            setKalk(v.kalkulation);
            setEinheiten(v.einheiten);
            setSanierungen(v.sanierungen);
          }}
        />
        <Stack gap={4} align="flex-end">
          <Group gap="xs" wrap="nowrap">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRestore size={16} />}
              disabled={!geaendert}
              onClick={() => {
                setKalk(deal.kalkulation);
                setEinheiten(deal.einheiten);
                setSanierungen(deal.sanierungen);
              }}
            >
              Verwerfen
            </Button>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={16} />}
              disabled={!geaendert}
              loading={speichern.isPending}
              onClick={() => speichern.mutate({ version: deal.version, kalkulation: kalk, einheiten, sanierungen })}
            >
              Speichern
            </Button>
          </Group>
          {geaendert && <Badge color="orange">ungespeichert</Badge>}
        </Stack>
      </Group>
      {speichern.error && (
        <Alert color="red" py={4} mt={6}>
          {speichern.error.message}
        </Alert>
      )}
    </div>
  );

  const c: FeldKontext = { zahlAus, setzeFeld, standard };
  const r = ergebnis;
  const wf = r.einheiten.wohnflaeche;

  return (
    <Stack>
      {leistenPlatz && createPortal(leiste, leistenPlatz)}

      {/* Einheitenliste IST / SOLL */}
      <EinheitenTabelle dealId={deal.id} einheiten={einheiten} setEinheiten={setEinheiten} ergebnis={ergebnis} standardRendite={standard.rend_k} />

      {/* Kaufpreis & Nebenkosten */}
      <Abschnitt titel="Kaufpreis & Nebenkosten" farbe={FARBE.ist}>
        <Zeile label="Kaufpreis IVT">
          <Eingabe c={c} feld="kaufpreis" einheit="€" w={130} label="Kaufpreis" />
          <Neben label="KP/m²" wert={wf ? euroProQm(r.kaufpreis / wf) : '–'} k="kaufpreis-m2" />
          <Neben label="Rendite" wert={r.kaufpreis ? prozent((r.jahresmieteIst / r.kaufpreis) * 100, 2) : '–'} k="rendite-kp" />
        </Zeile>
        <Zeile label="Notar & Grundbuch">
          <Eingabe c={c} feld="notar" einheit="%" w={80} step={0.01} label="Notar" />
          <Wert k="notar" wert={euro(r.notar)} />
        </Zeile>
        <Zeile label="Grunderwerbsteuer">
          <Eingabe c={c} feld="gest" einheit="%" w={80} step={0.01} label="Grunderwerbsteuer" />
          <Wert k="grunderwerbsteuer" wert={euro(r.grunderwerbsteuer)} />
        </Zeile>
        <Zeile label="Maklerprovision">
          <Eingabe c={c} feld="makler" einheit="%" w={80} step={0.01} label="Maklerprovision" />
          <Wert k="makler" wert={euro(r.maklerprovision)} />
        </Zeile>
        <Zeile label="Anschaffungskosten" stark>
          <Wert k="anschaffungskosten" wert={euro(r.anschaffungskosten)} stark />
          <Neben label="AK/m²" wert={wf ? euroProQm(r.anschaffungskosten / wf) : '–'} />
          <Neben label="Rendite" wert={r.anschaffungskosten ? prozent((r.jahresmieteIst / r.anschaffungskosten) * 100, 2) : '–'} />
        </Zeile>
        <span hidden data-kennzahl="kaufpreis" data-wert={euro(r.kaufpreis)} />
      </Abschnitt>

      {/* Finanzierung */}
      <Abschnitt titel="Finanzierung">
        <Text size="xs" c="dimmed" mb={4}>
          Konfiguration der Kapitalstruktur. Konkrete €-Beträge erscheinen unten in den Aufteiler/Global-Boxen.
        </Text>
        <Zeile label="FK %"><Eingabe c={c} feld="fk_p" einheit="%" w={80} label="Fremdkapital" /></Zeile>
        <Zeile label="EK %"><Eingabe c={c} feld="ek_p" einheit="%" w={80} label="Eigenkapital" /></Zeile>
        <Zeile label="Euribor"><Eingabe c={c} feld="euribor" einheit="%" w={80} step={0.01} label="Euribor" /></Zeile>
        <Zeile label="Marge Bank"><Eingabe c={c} feld="margeB" einheit="%" w={80} step={0.01} label="Marge Bank" /></Zeile>
        <Zeile label="Abschlussgebühr Bank"><Eingabe c={c} feld="bank_abgeb" einheit="% v. FK" w={110} step={0.01} label="Abschlussgebühr Bank" /></Zeile>
        <Zeile label="EK Rendite p.a."><Eingabe c={c} feld="ek_r" einheit="%" w={80} step={0.1} label="EK-Rendite p. a." /></Zeile>
        <Zeile label="Haltedauer"><Eingabe c={c} feld="halt" einheit="Mo." w={90} label="Haltedauer" /></Zeile>
        <Zeile label="– Mieteinnahmen (Abzug IST)" farbe="green.7">
          <Wert k="mietabzug" wert={r.mietabzug ? `– ${euro(r.mietabzug)}` : '–'} farbe="green.7" />
        </Zeile>
      </Abschnitt>

      {/* 🔨 Sanierungskosten */}
      <SanierungenTabelle sanierungen={sanierungen} setSanierungen={setSanierungen} ergebnis={ergebnis} kalk={kalk} setzeFeld={setzeFeld} zahlAus={zahlAus} />

      {/* GIK & Ergebnis */}
      <Abschnitt titel="GIK & Ergebnis" farbe="orange.8">
        <Zeile label="GIK Total" stark><Wert wert={euro(r.aufteiler.gik)} stark /></Zeile>
        <Zeile label="GIK pro m²"><Wert wert={wf ? euroProQm(r.aufteiler.gik / wf) : '–'} /></Zeile>
        <Zeile label="Mietrendite auf GIK (SOLL)"><Wert wert={r.aufteiler.gik ? prozent((r.jahresnettokaltmieteSoll / r.aufteiler.gik) * 100, 2) : '–'} /></Zeile>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="xs">
          <ExitBox titel="🏠 Aufteiler" label="Aufteiler" marge={r.aufteiler.marge} k="aufteiler.marge">
            <Projektkosten r={r} weg={r.aufteiler} k="aufteiler" />
            <Gruppe>HERSTELLUNGSKOSTEN</Gruppe>
            <SanierungsListe sanierungen={sanierungen} bereich="auf" />
            <Kb label="+ Sanierungskosten" wert={euro(r.aufteiler.sanierung)} />
            <Kb label="+ Puffer" wert={euro(r.aufteiler.sanierungPuffer)} k="aufteiler.sanierung" kWert={euro(r.aufteiler.sanierung + r.aufteiler.sanierungPuffer)} />
            <Kb label="+ Vertriebsprovision" wert={euro(r.vertriebsprovision)} k="aufteiler.vertriebsprovision">
              <Eingabe c={c} feld="vprov" einheit="%" w={76} step={0.01} label="Vertriebsprovision" />
            </Kb>
            <Kb label="+ Aufteilungskosten" wert={euro(r.teilungskosten)} k="aufteiler.teilungskosten">
              <Eingabe c={c} feld="aufk" einheit="€" w={110} label="Aufteilungskosten" />
            </Kb>
            <Group gap={6} wrap="wrap" px={8}>
              <Text size="xs" c="dimmed" title="Hilfsrechner — Wert oben gilt">Helfer:</Text>
              <Text size="xs" c="dimmed">H</Text>
              <NumberInput size="xs" w={56} value={zahlAus('auf_h')} placeholder={String(standard.auf_h)} onChange={(v) => setzeFeld('auf_h', v)} aria-label="Anzahl Häuser" {...ZAHL} />
              <Text size="xs" c="dimmed">×6.000 E</Text>
              <NumberInput size="xs" w={56} value={zahlAus('auf_e')} placeholder={String(standard.auf_e)} onChange={(v) => setzeFeld('auf_e', v)} aria-label="Anzahl Einheiten" {...ZAHL} />
              <Text size="xs" c="dimmed">×600</Text>
              <Text size="xs">= {euro(aufteilungskostenVorschlag(Number(kalk.auf_h ?? 0), Number(kalk.auf_e ?? 0)), '0 €')}</Text>
              <Button size="compact-xs" variant="light" onClick={() => setzeFeld('aufk', aufteilungskostenVorschlag(Number(kalk.auf_h ?? 0), Number(kalk.auf_e ?? 0)))}>
                → Übernehmen
              </Button>
            </Group>
            <Kb label="= Herstellungskosten ∑" wert={euro(r.aufteiler.herstellkosten)} stark />
            <Kb label="= GIK Aufteiler" wert={euro(r.aufteiler.gik)} neben={wf ? euroProQm(r.aufteiler.gik / wf) : undefined} stark farbe="orange.8" k="aufteiler.gik" />
            <Gruppe>EXIT AUFTEILER</Gruppe>
            <Kb label="Verkaufserlöse (Σ KP Kunden)" wert={euro(r.aufteiler.verkaufspreis)} neben={wf ? euroProQm(r.aufteiler.verkaufspreis / wf) : undefined} k="aufteiler.verkaufspreis" />
            <Kb label="Gewinn Aufteiler" wert={euro(r.aufteiler.gewinn)} stark farbe="green.7" k="aufteiler.gewinn" />
            <Kb label="Marge auf Verkaufserlöse" wert={prozent(r.aufteiler.marge, 2)} />
          </ExitBox>

          <ExitBox titel="🏢 Global" label="Global" marge={r.global.marge} k="global.marge">
            <Projektkosten r={r} weg={r.global} k="global" />
            <Gruppe>HERSTELLUNGSKOSTEN</Gruppe>
            <SanierungsListe sanierungen={sanierungen} bereich="glo" />
            <Kb label="+ Sanierungskosten" wert={euro(r.global.sanierung)} />
            <Kb label="+ Puffer" wert={euro(r.global.sanierungPuffer)} k="global.sanierung" kWert={euro(r.global.sanierung + r.global.sanierungPuffer)} />
            <Kb label="= Herstellungskosten ∑" wert={euro(r.global.herstellkosten)} stark />
            <Kb label="= GIK Global" wert={euro(r.global.gik)} neben={wf ? euroProQm(r.global.gik / wf) : undefined} stark farbe="orange.8" k="global.gik" />
            <Gruppe>EXIT GLOBAL</Gruppe>
            <Kb label="Ziel-Marge auf GIK" wert="">
              <Eingabe c={c} feld="glo_m" einheit="%" w={76} step={0.1} label="Marge Global" />
            </Kb>
            <Kb label="Verkaufserlöse (GIK × 1+Marge)" wert={euro(r.global.verkaufspreis)} neben={wf ? euroProQm(r.global.verkaufspreis / wf) : undefined} farbe="orange.8" k="global.verkaufspreis" />
            <Kb label="JNKM SOLL" wert={euro(r.jahresnettokaltmieteSoll)} />
            <Kb
              label="KP-Faktor Kunde"
              wert={r.global.faktor ? `${de1(r.global.faktor)}x` : '–'}
              k="global.faktor"
              kWert={r.global.faktor ? `${de1(r.global.faktor)}x · ${prozent(r.global.kaufpreisrendite, 2)}` : '–'}
            />
            <Kb label="Bruttorendite Kunde" wert={prozent(r.global.kaufpreisrendite, 2)} farbe="orange.8" />
            <Kb label="Gewinn Global" wert={euro(r.global.gewinn)} stark farbe="green.7" k="global.gewinn" />
            <Kb label="Marge auf Verkaufserlöse" wert={prozent(r.global.marge, 2)} />
          </ExitBox>
        </SimpleGrid>
      </Abschnitt>
    </Stack>
  );
}

/* ───────────── Bausteine der Darstellung ───────────── */

/** Was ein Eingabefeld der Kalkulation braucht: aktueller Wert, Setzen und die Standardwerte der Einstellungen. */
interface FeldKontext { zahlAus: (feld: string) => number | ''; setzeFeld: (feld: string, v: number | string) => void; standard: KalkStandard }

/**
 * Kompaktes Eingabefeld einer Kalkulationszeile; leer = Standardwert aus den Einstellungen.
 * Bewusst auf Modulebene: in DealKalkulation deklariert, wäre es bei jedem Tastendruck ein neuer Komponententyp —
 * React baute das Feld neu auf, und es verlöre nach dem ersten Zeichen den Fokus.
 */
function Eingabe({ c, feld, einheit, w = 90, step, label }: { c: FeldKontext; feld: string; einheit?: string; w?: number; step?: number; label: string }) {
  return (
    <NumberInput
      size="xs"
      w={w}
      value={c.zahlAus(feld)}
      placeholder={feld in c.standard ? String(c.standard[feld as keyof KalkStandard]).replace('.', ',') : feld === 'rp_pct' ? '10' : ''}
      onChange={(v) => c.setzeFeld(feld, v)}
      aria-label={label}
      step={step}
      rightSection={einheit ? <Text size="xs" c="dimmed" pr={4}>{einheit}</Text> : undefined}
      rightSectionWidth={einheit ? (einheit.length > 2 ? 52 : 26) : undefined}
      {...ZAHL}
    />
  );
}

function Abschnitt({ titel, farbe, children }: { titel: string; farbe?: string; children: ReactNode }) {
  return (
    <Paper withBorder p="sm">
      <Title order={6} mb={6} c={farbe} tt="uppercase" fz="xs" style={{ letterSpacing: 0.6 }}>
        {titel}
      </Title>
      <Stack gap={4}>{children}</Stack>
    </Paper>
  );
}

/** Eine Zeile: Beschriftung links, Eingabe und Werte rechts daneben (wie .krow in der alten App). */
function Zeile({ label, children, stark, farbe }: { label: string; children: ReactNode; stark?: boolean; farbe?: string }) {
  return (
    <Group gap="sm" wrap="wrap" align="center" py={stark ? 4 : 0} style={stark ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}>
      <Text size="sm" w={230} c={farbe ?? (stark ? 'orange.8' : 'dimmed')} fw={stark ? 600 : 400}>
        {label}
      </Text>
      {children}
    </Group>
  );
}

/** Berechneter Wert (schreibgeschützt) mit Kennzahl-Anker für die Paritätsprüfung. */
function Wert({ wert, k, stark, farbe }: { wert: string; k?: string; stark?: boolean; farbe?: string }) {
  return (
    <Text size="sm" fw={stark ? 700 : 500} c={farbe} ta="right" miw={96} data-kennzahl={k} data-wert={k ? wert : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {wert}
    </Text>
  );
}

/** Nebenwert in einer Zeile: „KP/m² 3.200 €/m²". */
function Neben({ label, wert, k }: { label: string; wert: string; k?: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xs" fw={500} data-kennzahl={k} data-wert={k ? wert : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>{wert}</Text>
    </Group>
  );
}

function Gruppe({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" fw={700} c="dimmed" px={8} py={3} mt={4} bg="var(--mantine-color-default-hover)" style={{ letterSpacing: 1 }}>
      {children}
    </Text>
  );
}

/** Zeile in den Ergebnis-Boxen (wie .kbrow): Beschriftung, optional Eingabe, Wert, Nebenwert. */
function Kb({ label, wert, neben, k, kWert, stark, farbe, children }: { label: string; wert: string; neben?: string; k?: string; kWert?: string; stark?: boolean; farbe?: string; children?: ReactNode }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" px={8} py={1} style={stark ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}>
      <Text size="xs" c={stark ? undefined : 'dimmed'} fw={stark ? 700 : 400}>{label}</Text>
      <Group gap={6} wrap="nowrap">
        {children}
        <Text size="xs" fw={stark ? 700 : 500} c={farbe} data-kennzahl={k} data-wert={k ? (kWert ?? wert) : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {wert}
        </Text>
        {neben ? <Text size="xs" c="dimmed">{neben}</Text> : null}
      </Group>
    </Group>
  );
}

function Sub({ text }: { text: string }) {
  return (
    <Text size="xs" c="dimmed" fs="italic" ta="right" px={8} mt={-2}>
      {text}
    </Text>
  );
}

/** PROJEKTKOSTEN-Block – in beiden Boxen gleich aufgebaut. */
function Projektkosten({ r, weg, k }: { r: AnkaufErgebnis; weg: AnkaufErgebnis['aufteiler']; k: 'aufteiler' | 'global' }) {
  return (
    <>
      <Gruppe>PROJEKTKOSTEN</Gruppe>
      <Kb label="Kaufpreis" wert={euro(r.kaufpreis)} />
      <Kb label="+ Notar & Grundbuch" wert={euro(r.notar)} />
      <Kb label="+ Grunderwerbsteuer" wert={euro(r.grunderwerbsteuer)} />
      <Kb label="+ Maklerprovision" wert={euro(r.maklerprovision)} />
      <Kb label="= Anschaffungskosten" wert={euro(r.anschaffungskosten)} stark />
      <Kb label="+ FK-Zinskosten" wert={weg.fkZinsen ? euro(weg.fkZinsen) : '–'} k={`${k}.fkz`} kWert={euro(weg.fkZinsen)} />
      <Sub text={weg.fremdkapital ? `auf ${euro(weg.fremdkapital)} Fremdkapital` : 'kein FK aktiv'} />
      <Kb label="+ Abschlussgebühr Bank" wert={weg.bankAbschluss ? euro(weg.bankAbschluss) : '–'} k={`${k}.bankabgeb`} kWert={euro(weg.bankAbschluss)} />
      <Sub text={`${de2(r.bankAbschlussPct)} % auf FK`} />
      <Kb label="+ EK-Opportunitätskosten" wert={weg.ekKosten ? euro(weg.ekKosten) : '–'} k={`${k}.ekk`} kWert={euro(weg.ekKosten)} />
      <Sub text={weg.eigenkapital ? `auf ${euro(weg.eigenkapital)} Eigenkapital` : 'kein EK aktiv'} />
      <Kb label="– Mieteinnahmen IST" wert={r.mietabzug ? `– ${euro(r.mietabzug)}` : '–'} farbe="green.7" />
    </>
  );
}

function SanierungsListe({ sanierungen, bereich }: { sanierungen: Sanierung[]; bereich: 'auf' | 'glo' }) {
  const rows = sanierungen.filter((s) => (!s.bereich || s.bereich === 'both' || s.bereich === bereich) && s.betrag);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((s, i) => (
        <Group key={s.id ?? i} justify="space-between" px={8} wrap="nowrap">
          <Text size="xs" c="dimmed" fs="italic" truncate>· {s.beschreibung || 'Position'}</Text>
          <Text size="xs" c="dimmed">{euro(s.betrag)}</Text>
        </Group>
      ))}
    </>
  );
}

function ExitBox({ titel, label, marge, k, children }: { titel: string; label: string; marge: number; k: string; children: ReactNode }) {
  const a = margenAmpel(marge);
  return (
    <Paper withBorder p={0} aria-label={label} style={{ overflow: 'hidden' }}>
      <Group justify="space-between" px="sm" py={6} bg="var(--mantine-color-default-hover)">
        <Title order={6}>{titel}</Title>
      </Group>
      <Stack gap={2} py={6}>{children}</Stack>
      <Group justify="space-between" px="sm" py={6} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Badge color={AMPEL_FARBE[a]} variant="light">{AMPEL_TEXT[a]}</Badge>
        <Text size="sm" fw={700} c={AMPEL_FARBE[a]} data-kennzahl={k} data-wert={Number.isFinite(marge) ? marge.toFixed(1) : ''}>
          {a === 'verlust' ? 'Verlust' : prozent(marge)}
        </Text>
      </Group>
    </Paper>
  );
}

/* ───────────── Einheitenliste IST / SOLL ───────────── */

const TYPEN = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'];

function EinheitenTabelle({
  dealId,
  einheiten,
  setEinheiten,
  ergebnis,
  standardRendite,
}: {
  dealId: string;
  einheiten: Einheit[];
  setEinheiten: (f: (e: Einheit[]) => Einheit[]) => void;
  ergebnis: AnkaufErgebnis;
  standardRendite: number;
}) {
  const aendere = (i: number, teil: Partial<Einheit>) => setEinheiten((es) => es.map((e, j) => (j === i ? { ...e, ...teil } : e)));
  // Miete geändert: bei festem VKP passt sich die Rendite an
  const aendereMiete = (i: number, teil: Partial<Einheit>) => setEinheiten((es) => es.map((e, j) => (j === i ? einheitMieteGeaendert({ ...e, ...teil }) : e)));
  // Rendite, VKP und KP/m²: eines eingeben, die anderen beiden folgen (wie in der alten App)
  const preis = (i: number, feld: PreisFeld, wert: number | null) => setEinheiten((es) => es.map((e, j) => (j === i ? { ...e, ...einheitPreisSetzen(e, feld, wert) } : e)));
  const s = ergebnis.einheiten;
  const zeilen = s.zeilen;
  const [propstack, setPropstack] = useState<string | null>(null);
  // Durchschnitte der Fußzeile (reine Anzeige wie dk-avg-*)
  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number' && x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const avgKqmIst = avg(zeilen.map((z) => z.kaltmieteProQmIst));
  const avgKqmSoll = avg(zeilen.map((z) => z.kaltmieteProQmSoll));
  const avgRendite = avg(einheiten.map((e) => e.renditeK));
  const avgKpm2 = avg(zeilen.map((z) => z.verkaufspreisProQm));

  return (
    <Paper withBorder p="sm" aria-label="Einheiten">
      <Title order={6} mb={6} c={FARBE.ist} tt="uppercase" fz="xs" style={{ letterSpacing: 0.6 }}>
        Einheitenliste IST / SOLL
      </Title>
      <AlleSetzen dealId={dealId} einheiten={einheiten} setEinheiten={(neu) => setEinheiten(() => neu)} standardRendite={standardRendite} />
      <Table.ScrollContainer minWidth={980}>
        <Table verticalSpacing={3} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Typ</Table.Th><Table.Th>Lage</Table.Th><Table.Th>Zi/Stk</Table.Th>
              <Table.Th c={FARBE.ist}>m²/Stk IST</Table.Th><Table.Th c={FARBE.ist}>KM IST €</Table.Th><Table.Th c={FARBE.ist}>€/m² IST</Table.Th>
              <Table.Th c={FARBE.soll}>KM SOLL €</Table.Th><Table.Th c={FARBE.soll}>€/m² SOLL</Table.Th><Table.Th c={FARBE.soll}>Rendite %</Table.Th>
              <Table.Th c={FARBE.vkp}>VKP €</Table.Th><Table.Th c={FARBE.vkp}>KP/m² €</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {einheiten.map((e, i) => {
              const z = zeilen[i];
              const stpl = e.typ === 'Stellplatz';
              return (
                <Table.Tr key={e.id ?? `neu-${i}`}>
                  <Table.Td><Select size="xs" w={110} data={TYPEN} value={e.typ} allowDeselect={false} onChange={(v) => aendere(i, { typ: v })} aria-label="Typ" /></Table.Td>
                  <Table.Td><TextInput size="xs" w={90} value={e.lage ?? ''} onChange={(ev) => aendere(i, { lage: ev.currentTarget.value || null })} aria-label="Lage" /></Table.Td>
                  <Table.Td>
                    {stpl ? (
                      <NumberInput size="xs" w={60} value={e.stueck ?? ''} onChange={(v) => aendere(i, { stueck: alsZahl(v) })} aria-label="Stück" {...ZAHL} />
                    ) : (
                      <NumberInput size="xs" w={60} value={e.zimmer ?? ''} onChange={(v) => aendere(i, { zimmer: alsZahl(v) })} aria-label="Zimmer" {...ZAHL} />
                    )}
                  </Table.Td>
                  <Table.Td>{stpl ? <Text size="xs" c="dimmed">–</Text> : <NumberInput size="xs" w={80} value={e.flaeche ?? ''} onChange={(v) => aendere(i, { flaeche: alsZahl(v) })} aria-label="Fläche" {...ZAHL} />}</Table.Td>
                  <Table.Td><NumberInput size="xs" w={90} value={e.mieteIst ?? ''} onChange={(v) => aendereMiete(i, { mieteIst: alsZahl(v) })} aria-label="Miete ist" {...ZAHL} /></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{z?.kaltmieteProQmIst ? de2(z.kaltmieteProQmIst) : ''}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      <NumberInput
                        size="xs"
                        w={90}
                        placeholder={e.mieteIst ? String(e.mieteIst).replace('.', ',') : ''}
                        value={e.mieteNeuManuell ? (e.mieteNeu ?? '') : ''}
                        onChange={(v) => aendereMiete(i, { mieteNeu: alsZahl(v), mieteNeuManuell: alsZahl(v) !== null })}
                        aria-label="Miete neu"
                        {...ZAHL}
                      />
                      <Checkbox size="xs" checked={e.mieteNeuManuell} onChange={(ev) => aendereMiete(i, { mieteNeuManuell: ev.currentTarget.checked })} aria-label="Miete neu manuell" title="manuell" />
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{z?.kaltmieteProQmSoll ? de2(z.kaltmieteProQmSoll) : ''}</Text></Table.Td>
                  <Table.Td>
                    {/* Pfeile hoch/runter in 0,1-Schritten (alt: <input type="number" step="0.1">) */}
                    <NumberInput size="xs" w={78} value={e.renditeK ?? ''} onChange={(v) => preis(i, 'rendite', alsZahl(v))} aria-label="Rendite"
                      {...ZAHL} hideControls={false} step={0.1} min={0} decimalScale={1} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      w={110}
                      placeholder={z?.verkaufspreis ? z.verkaufspreis.toLocaleString('de-DE') : ''}
                      value={e.verkaufspreis ?? ''}
                      onChange={(v) => preis(i, 'vkp', alsZahl(v))}
                      aria-label="Verkaufspreis"
                      {...ZAHL}
                    />
                  </Table.Td>
                  <Table.Td>
                    {/* KP/m² eingeben setzt den VKP (× Fläche); errechnete Werte stehen grau als Platzhalter wie beim VKP */}
                    {stpl || !e.flaeche ? <Text size="xs" c="dimmed">{z?.verkaufspreisProQm ? z.verkaufspreisProQm.toLocaleString('de-DE') : '–'}</Text> : (
                      <NumberInput size="xs" w={84} placeholder={z?.verkaufspreisProQm ? z.verkaufspreisProQm.toLocaleString('de-DE') : ''}
                        value={e.verkaufspreis && z?.verkaufspreisProQm ? z.verkaufspreisProQm : ''} onChange={(v) => preis(i, 'kpm2', alsZahl(v))} aria-label="KP/m²" {...ZAHL} />
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      {!stpl && e.id && (
                        <ActionIcon variant="subtle" color="yellow" aria-label="Bewertung über Propstack" title="An Propstack senden zur Bewertung" onClick={() => setPropstack(e.id!)}>
                          📊
                        </ActionIcon>
                      )}
                      <ActionIcon variant="subtle" color="red" onClick={() => setEinheiten((es) => es.filter((_, j) => j !== i))} aria-label="Einheit entfernen">
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th>{s.anzahlEinheiten} Einh.</Table.Th>
              <Table.Th>{s.anzahlStellplaetze ? `${s.anzahlStellplaetze} Stpl.` : '–'}</Table.Th>
              <Table.Th>–</Table.Th>
              <Table.Th>{s.wohnflaeche ? `${s.wohnflaeche.toLocaleString('de-DE')} m²` : '–'}</Table.Th>
              <Table.Th>{euro(s.mieteIst)}</Table.Th>
              <Table.Th fz="xs">{avgKqmIst ? `Ø ${de2(avgKqmIst)}` : '–'}</Table.Th>
              <Table.Th>{euro(s.mieteSoll)}</Table.Th>
              <Table.Th fz="xs">{avgKqmSoll ? `Ø ${de2(avgKqmSoll)}` : '–'}</Table.Th>
              <Table.Th fz="xs">{avgRendite ? `Ø ${de1(avgRendite)} %` : '–'}</Table.Th>
              <Table.Th>{euro(s.verkaufspreise)}</Table.Th>
              <Table.Th fz="xs">{avgKpm2 ? `Ø ${Math.round(avgKpm2).toLocaleString('de-DE')}` : '–'}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
      <Button
        mt={6}
        size="xs"
        variant="light"
        leftSection={<IconPlus size={14} />}
        onClick={() =>
          setEinheiten((es) => [...es, { typ: 'Wohnung', lage: null, zimmer: null, flaeche: null, mieteIst: null, mieteNeu: null, mieteNeuManuell: false, renditeK: null, verkaufspreis: null, stueck: null }])
        }
      >
        Einheit
      </Button>
      <PropstackDialog dealId={dealId} einheitId={propstack} schliessen={() => setPropstack(null)} />
    </Paper>
  );
}

/* ───────────── 🔨 Sanierungskosten ───────────── */

const BEREICHE = [
  { value: 'auf', label: 'Auf' },
  { value: 'both', label: 'Beide' },
  { value: 'glo', label: 'Glo' },
];

function SanierungenTabelle({
  sanierungen,
  setSanierungen,
  ergebnis,
  kalk,
  setzeFeld,
  zahlAus,
}: {
  sanierungen: Sanierung[];
  setSanierungen: (f: (s: Sanierung[]) => Sanierung[]) => void;
  ergebnis: AnkaufErgebnis;
  kalk: KalkulationWerte;
  setzeFeld: (feld: string, v: number | string) => void;
  zahlAus: (feld: string) => number | '';
}) {
  const aendere = (i: number, teil: Partial<Sanierung>) => setSanierungen((ss) => ss.map((s, j) => (j === i ? { ...s, ...teil } : s)));
  const gesamt = ergebnis.sanierungNetto + ergebnis.sanierungPuffer;
  return (
    <Paper withBorder p="sm" aria-label="Sanierung">
      <Title order={6} mb={6} tt="uppercase" fz="xs" style={{ letterSpacing: 0.6 }}>
        🔨 Sanierungskosten
      </Title>
      <Stack gap={6}>
        {sanierungen.map((s, i) => (
          <Group key={s.id ?? `neu-${i}`} gap="xs" wrap="nowrap">
            <TextInput size="xs" style={{ flex: 1 }} placeholder="Beschreibung…" value={s.beschreibung ?? ''} onChange={(e) => aendere(i, { beschreibung: e.currentTarget.value || null })} aria-label="Beschreibung" />
            <NumberInput size="xs" w={120} placeholder="€" value={s.betrag ?? ''} onChange={(v) => aendere(i, { betrag: alsZahl(v) })} aria-label="Betrag" {...ZAHL} />
            <SegmentedControl size="xs" data={BEREICHE} value={s.bereich ?? 'both'} onChange={(v) => aendere(i, { bereich: v as Sanierung['bereich'] })} aria-label="Bereich" />
            <ActionIcon variant="subtle" color="red" onClick={() => setSanierungen((ss) => ss.filter((_, j) => j !== i))} aria-label="Posten entfernen">
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} aria-label="Posten" onClick={() => setSanierungen((ss) => [...ss, { beschreibung: null, betrag: null, bereich: 'both' }])}>
            Sanierungsposition
          </Button>
        </Group>

        {/* Risikopuffer: Prozent oder fester Betrag (fest hat Vorrang) */}
        <Group gap={8} wrap="wrap" p={6} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 6 }}>
          <Text size="xs" style={{ flex: 1 }}>Risikopuffer</Text>
          <NumberInput size="xs" w={70} value={zahlAus('rp_pct')} placeholder="10" step={0.5} onChange={(v) => setzeFeld('rp_pct', v)} aria-label="Risikopuffer Sanierung" rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>} rightSectionWidth={24} {...ZAHL} />
          <Text size="xs" c="dimmed">oder</Text>
          <NumberInput size="xs" w={130} value={zahlAus('rp_fix')} placeholder="fester €-Betrag" onChange={(v) => setzeFeld('rp_fix', v)} aria-label="Risikopuffer fest (vorrangig)" rightSection={<Text size="xs" c="dimmed" pr={4}>€</Text>} rightSectionWidth={24} {...ZAHL} />
          {kalk.rp_fix ? <Text size="xs" c="orange.7">fester Betrag gilt</Text> : null}
        </Group>

        {sanierungen.length > 0 ? (
          <Box>
            <Group justify="space-between" px={8} py={3} style={{ background: 'rgba(224,144,64,.08)', borderRadius: 6 }}>
              <Text size="xs" c="dimmed">Sanierungskosten</Text>
              <Text size="xs" fw={600}>{euro(ergebnis.sanierungNetto)}</Text>
            </Group>
            <Group justify="space-between" px={8} py={3} mt={2} style={{ background: 'rgba(224,144,64,.08)', borderRadius: 6 }}>
              <Text size="xs" c="orange.7">+ Puffer</Text>
              <Text size="xs" fw={600} c="orange.7">{euro(ergebnis.sanierungPuffer)}</Text>
            </Group>
            <Group justify="space-between" px={8} py={4} mt={2} style={{ border: '1px solid var(--mantine-color-orange-6)', borderRadius: 6 }}>
              <Text size="xs" fw={700} c="orange.7">Sanierung inkl. Puffer</Text>
              <Text size="sm" fw={700} c="orange.7">{euro(gesamt)}</Text>
            </Group>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
