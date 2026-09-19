import { Drawer } from '@mantine/core';
import type { ReactNode } from 'react';

/** Detailansicht als Schubfach von rechts (Makler, Objekte). */
export function Seitenschublade({ offen, schliessen, titel, breite = 'xl', children }: { offen: boolean; schliessen: () => void; titel: string; breite?: string; children: ReactNode }) {
  return (
    <Drawer opened={offen} onClose={schliessen} position="right" size={breite} title={titel} closeButtonProps={{ 'aria-label': 'Schließen' }}>
      {children}
    </Drawer>
  );
}
