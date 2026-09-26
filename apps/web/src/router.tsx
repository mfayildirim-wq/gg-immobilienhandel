import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { Stack, Title } from '@mantine/core';
import { EINSTELLUNGEN_SEITEN } from './lib/einstellungenSeiten.tsx';
import { AppRahmen } from './components/AppRahmen.tsx';
import { AgentSeite } from './agent/AgentSeite.tsx';
import { AnkaufSeite } from './pages/AnkaufSeite.tsx';
import { BegleitscheineSeite } from './pages/BegleitscheineSeite.tsx';
import { BegleitscheinSeite } from './pages/BegleitscheinSeite.tsx';
import { DealsSeite } from './pages/DealsSeite.tsx';
import { AngeboteSeite } from './pages/AngeboteSeite.tsx';
import { M365Rueckweg } from './pages/M365Rueckweg.tsx';
import { ExposeImportSeite } from './pages/ExposeImportSeite.tsx';
import { KundenkalkulationenSeite } from './pages/KundenkalkulationenSeite.tsx';
import { KundenkalkulationSeite } from './pages/KundenkalkulationSeite.tsx';
import { MaklerSeite } from './pages/MaklerSeite.tsx';
import { ObjekteSeite } from './pages/ObjekteSeite.tsx';
import { PraesentationSeite } from './pages/PraesentationSeite.tsx';
import { VertriebslistenSeite } from './pages/VertriebslistenSeite.tsx';
import { ProjekteSeite } from './pages/ProjekteSeite.tsx';
import { ProjektSeite } from './pages/ProjektSeite.tsx';
import { VertriebslisteSeite } from './pages/VertriebslisteSeite.tsx';

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

const root = createRootRoute({ component: AppRahmen });

const routen = [
  createRoute({
    getParentRoute: () => root,
    path: '/',
    component: AnkaufSeite,
    // ?incoming=<telefonnummer> vom iOS-Kurzbefehl: öffnet das Briefing des Anrufers
    validateSearch: (s: Record<string, unknown>): { incoming?: string } => ({ incoming: text(s.incoming) }),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/deals',
    component: DealsSeite,
    // ?deal=<id> öffnet einen Deal, ?neu=<maklerId> den Dialog „Neuer Deal“ mit diesem Makler
    validateSearch: (s: Record<string, unknown>): { deal?: string; neu?: string } => ({ deal: text(s.deal), neu: text(s.neu) }),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/objekte',
    component: ObjekteSeite,
    // ?objekt=<id> öffnet das Objekt (z. B. „→ Öffnen“ im Deal)
    validateSearch: (s: Record<string, unknown>): { objekt?: string } => ({ objekt: text(s.objekt) }),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/makler',
    component: MaklerSeite,
    validateSearch: (s: Record<string, unknown>): { makler?: string } => ({ makler: text(s.makler) }),
  }),
  createRoute({ getParentRoute: () => root, path: '/kundenkalkulationen', component: KundenkalkulationenSeite }),
  createRoute({ getParentRoute: () => root, path: '/kundenkalkulationen/$id', component: KundenkalkulationSeite }),
  createRoute({ getParentRoute: () => root, path: '/praesentationen/$id', component: PraesentationSeite }),
  createRoute({ getParentRoute: () => root, path: '/vertriebslisten', component: VertriebslistenSeite }),
  createRoute({ getParentRoute: () => root, path: '/vertriebslisten/$id', component: VertriebslisteSeite }),
  createRoute({ getParentRoute: () => root, path: '/projekte', component: ProjekteSeite }),
  createRoute({ getParentRoute: () => root, path: '/projekte/$id', component: ProjektSeite }),
  createRoute({ getParentRoute: () => root, path: '/begleitscheine', component: BegleitscheineSeite }),
  createRoute({ getParentRoute: () => root, path: '/begleitscheine/$id', component: BegleitscheinSeite }),
  createRoute({
    getParentRoute: () => root,
    path: '/expose-import',
    component: ExposeImportSeite,
    // ?key=…&name=… kommt aus dem Posteingang: der Anhang liegt bereits im Exposé-Eingang
    validateSearch: (s: Record<string, unknown>): { key?: string; name?: string } => ({ key: text(s.key), name: text(s.name) }),
  }),
  createRoute({ getParentRoute: () => root, path: '/angebote', component: AngeboteSeite }),
  createRoute({ getParentRoute: () => root, path: '/agent', component: AgentSeite }),
  createRoute({
    getParentRoute: () => root,
    path: '/m365/rueckweg',
    component: M365Rueckweg,
    validateSearch: (s: Record<string, unknown>): { code?: string; state?: string; error_description?: string } =>
      ({ code: text(s.code), state: text(s.state), error_description: text(s.error_description) }),
  }),
];

const einstellungen = createRoute({
  getParentRoute: () => root,
  path: '/einstellungen',
  component: () => (
    <Stack gap="sm">
      <Title order={2}>Einstellungen</Title>
      <Outlet />
    </Stack>
  ),
});
const einstellungenSeiten = [
  createRoute({ getParentRoute: () => einstellungen, path: '/', beforeLoad: () => { throw redirect({ to: `/einstellungen/${EINSTELLUNGEN_SEITEN[0]!.pfad}` as '/' }); } }),
  ...EINSTELLUNGEN_SEITEN.map((s) => createRoute({ getParentRoute: () => einstellungen, path: s.pfad, component: () => <s.komponente /> })),
];

export const router = createRouter({ routeTree: root.addChildren([...routen, einstellungen.addChildren(einstellungenSeiten)]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
