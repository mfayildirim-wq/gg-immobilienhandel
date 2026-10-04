import '@mantine/core/styles.css';
import './auswahl.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Anmeldeschranke } from './components/Anmeldung.tsx';
import { router } from './router.tsx';

const theme = createTheme({ primaryColor: 'teal', defaultRadius: 'md' });
// Listen im Altformat (Deals/Objekte/Makler) hängen an jeder Änderung: nach jeder Mutation neu laden
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000 } },
  mutationCache: new MutationCache({ onSettled: () => queryClient.invalidateQueries({ queryKey: ['listen'] }) }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <Anmeldeschranke>
          <RouterProvider router={router} />
        </Anmeldeschranke>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
