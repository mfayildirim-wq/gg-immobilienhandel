import { ActionIcon, Anchor, AppShell, Box, Burger, Button, Group, NavLink, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconBuildingCommunity,
  IconTarget,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMoonStars,
  IconReportMoney,
  IconSettings,
  IconBriefcase,
  IconFileImport,
  IconMail,
  IconSearch,
  IconUsers, IconChecklist, IconTableShare, IconChartBar } from '@tabler/icons-react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { AbmeldenKnopf } from './Anmeldung.tsx';
import { GlobaleSuche } from './GlobaleSuche.tsx';
import { EINSTELLUNGEN_SEITEN } from '../lib/einstellungenSeiten.tsx';
import { brotkrumen } from '../lib/brotkrumen.ts';
import { KopfPlatzKontext } from './AnsichtMenue.tsx';

const NAVIGATION = [
  { to: '/', label: 'Ankauf', icon: IconTarget },
  { to: '/deals', label: 'Deals', icon: IconReportMoney },
  { to: '/kundenkalkulationen', label: 'Kundenkalk', icon: IconBriefcase },
  { to: '/begleitscheine', label: 'Begleitscheine', icon: IconChecklist },
  { to: '/vertriebslisten', label: 'Vertriebslisten', icon: IconTableShare },
  { to: '/projekte', label: 'Projekte', icon: IconChartBar },
  { to: '/objekte', label: 'Objekte', icon: IconBuildingCommunity },
  { to: '/makler', label: 'Makler', icon: IconUsers },
  { to: '/angebote', label: 'Angebote', icon: IconMail },
] as const;

/**
 * App-Rahmen im neuen Design: einklappbare Seitenleiste links. Die Wählmaschine gehört zur Ankaufseite (Knopf über der Liste).
 * Die Kopfzeile zeigt als Brotkrumen, auf welcher Seite man ist, und hält links von „Exposé importieren“ einen Platz
 * frei, in den eine Seite ihr Menü „Ansicht und Filter“ setzt (`AnsichtMenue`).
 */
export function AppRahmen() {
  const [mobilOffen, { toggle: mobilUmschalten, close: mobilSchliessen }] = useDisclosure(false);
  const [leisteOffen, { toggle: leisteUmschalten }] = useDisclosure(true);
  // Eingeklappt bleibt die Leiste als Symbolspalte stehen; die Maus darüber klappt sie vorübergehend aus.
  const [ueberfahren, setUeberfahren] = useState(false);
  const [sucheOffen, suche] = useDisclosure(false);
  const { toggleColorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  const pfad = useRouterState({ select: (s) => s.location.pathname });
  const desktop = useMediaQuery('(min-width: 48em)', true);
  const ausgeklappt = leisteOffen || ueberfahren;
  const schmal = desktop && !ausgeklappt;
  const leisteSichtbar = desktop ? true : mobilOffen;
  // Untermenü Einstellungen: auf einer Einstellungsseite offen, sonst per Klick
  const [einstellungenOffen, setEinstellungenOffen] = useState(pfad.startsWith('/einstellungen'));
  const krumen = brotkrumen(pfad, NAVIGATION, EINSTELLUNGEN_SEITEN);
  const [kopfPlatz, setKopfPlatz] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (pfad.startsWith('/einstellungen')) setEinstellungenOffen(true); }, [pfad]);
  // ⌘F / Strg+F öffnet die globale Suche (wie main.ts der alten App)
  useEffect(() => {
    const auf = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); suche.open(); } };
    document.addEventListener('keydown', auf);
    return () => document.removeEventListener('keydown', auf);
  }, [suche]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: schmal ? 64 : 240, breakpoint: 'sm', collapsed: { mobile: !mobilOffen, desktop: false } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={mobilOffen} onClick={mobilUmschalten} hiddenFrom="sm" size="sm" aria-label="Menü" />
            <Title order={4} visibleFrom="xs" style={{ whiteSpace: 'nowrap' }}>GG Immobilienhandel</Title>
            {krumen.length > 0 && (
              <Group component="nav" aria-label="Brotkrumen" gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                {krumen.map((k, i) => (
                  <Fragment key={k.label}>
                    <Text c="dimmed" visibleFrom={i === 0 ? 'xs' : undefined} aria-hidden>›</Text>
                    {k.to
                      ? <Anchor component={Link} to={k.to} c="dimmed" underline="hover" data-krume style={{ whiteSpace: 'nowrap' }}>{k.label}</Anchor>
                      : <Text fw={i === krumen.length - 1 ? 600 : undefined} c={i === krumen.length - 1 ? undefined : 'dimmed'} truncate data-krume
                          aria-current={i === krumen.length - 1 ? 'page' : undefined}>{k.label}</Text>}
                  </Fragment>
                ))}
              </Group>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <div ref={setKopfPlatz} style={{ display: 'contents' }} />
            <Button size="compact-sm" variant="light" leftSection={<IconFileImport size={16} />} onClick={() => navigate({ to: '/expose-import' })} visibleFrom="xs">
              Exposé importieren
            </Button>
            <Tooltip label="Suche (⌘F)">
              <ActionIcon variant="light" size="lg" color="green" onClick={suche.open} aria-label="Suche öffnen">
                <IconSearch />
              </ActionIcon>
            </Tooltip>
            <ActionIcon variant="subtle" onClick={toggleColorScheme} aria-label="Hell/Dunkel">
              <IconMoonStars />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        p="xs"
        aria-label="Hauptnavigation"
        inert={!leisteSichtbar}
        data-schmal={schmal || undefined}
        onMouseEnter={() => desktop && !leisteOffen && setUeberfahren(true)}
        onMouseLeave={() => setUeberfahren(false)}
        style={{ transition: 'width 150ms ease', overflowX: 'hidden' }}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {NAVIGATION.map(({ to, label, icon: Icon }) => {
            const aktiv = to === '/' ? pfad === '/' : pfad.startsWith(to);
            return (
              <Tooltip key={to} label={label} position="right" disabled={!schmal}>
                <NavLink
                  component={Link}
                  to={to}
                  label={schmal ? undefined : label}
                  aria-label={label}
                  leftSection={<Icon size={18} />}
                  active={aktiv}
                  // Die gewählte Seite steht fett — auch dann erkennbar, wenn die Farbe wenig hergibt.
                  styles={{ label: { fontWeight: aktiv ? 700 : undefined } }}
                  onClick={() => { mobilSchliessen(); setUeberfahren(false); }}
                />
              </Tooltip>
            );
          })}
          <Tooltip label="Einstellungen" position="right" disabled={!schmal}>
            <NavLink
              label={schmal ? undefined : 'Einstellungen'}
              leftSection={<IconSettings size={18} />}
              active={pfad.startsWith('/einstellungen') && !einstellungenOffen}
              opened={einstellungenOffen && !schmal}
              onChange={setEinstellungenOffen}
              styles={{ label: { fontWeight: pfad.startsWith('/einstellungen') ? 700 : undefined } }}
              aria-label="Einstellungen"
            >
              {EINSTELLUNGEN_SEITEN.map(({ pfad: unter, label, icon: Icon }) => (
                <NavLink
                  key={unter}
                  component={Link}
                  to={`/einstellungen/${unter}`}
                  label={label}
                  leftSection={<Icon size={16} />}
                  active={pfad === `/einstellungen/${unter}`}
                  styles={{ label: { fontWeight: pfad === `/einstellungen/${unter}` ? 700 : undefined } }}
                  onClick={() => { mobilSchliessen(); setUeberfahren(false); }}
                />
              ))}
            </NavLink>
          </Tooltip>
        </div>

        {/* Abmelden und Auf-/Zuklappen stehen immer unten in der Leiste; eingeklappt untereinander, sonst nebeneinander. */}
        <Group justify={schmal ? 'center' : 'space-between'} gap="xs" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexDirection: schmal ? 'column' : 'row' }}>
          <AbmeldenKnopf schmal={schmal} />
          <Box visibleFrom="sm">
            <Tooltip label={leisteOffen ? 'Seitenleiste einklappen' : 'Seitenleiste ausklappen'} position="right">
              <ActionIcon
                variant="subtle"
                onClick={() => { leisteUmschalten(); setUeberfahren(false); }}
                aria-label={leisteOffen ? 'Seitenleiste einklappen' : 'Seitenleiste ausklappen'}
              >
                {leisteOffen ? <IconLayoutSidebarLeftCollapse /> : <IconLayoutSidebarLeftExpand />}
              </ActionIcon>
            </Tooltip>
          </Box>
        </Group>
      </AppShell.Navbar>

      <AppShell.Main>
        <KopfPlatzKontext.Provider value={kopfPlatz}>
          <Outlet />
        </KopfPlatzKontext.Provider>
      </AppShell.Main>

      <GlobaleSuche offen={sucheOffen} schliessen={suche.close} />
    </AppShell>
  );
}
