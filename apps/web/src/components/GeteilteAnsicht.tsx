import { ActionIcon, Box, ScrollArea, Tooltip } from '@mantine/core';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { createContext, type KeyboardEvent, type PointerEvent, type ReactNode, useContext, useRef, useState } from 'react';
import { type Layout, teilerBegrenzen, useEinstellung, useZahlEinstellung } from '../lib/ansicht.ts';
import css from './GeteilteAnsicht.module.css';

const LISTE = ['auf', 'zu'] as const;
const TASTENSCHRITT = 24;

const ListeKontext = createContext<{ zu: boolean; umschalten: () => void } | null>(null);

/**
 * Knopf für den Kopf des Details (neben der Adresse): klappt die Liste zu, damit das Detail — etwa die
 * Kalkulation — die ganze Breite bekommt, und holt sie wieder. Außerhalb einer geteilten Ansicht bleibt er unsichtbar.
 */
export function ListeUmschalter() {
  const k = useContext(ListeKontext);
  if (!k) return null;
  const text = k.zu ? 'Liste einblenden' : 'Liste ausblenden';
  return (
    <Tooltip label={k.zu ? 'Liste einblenden' : 'Liste ausblenden — mehr Platz für das Detail'}>
      <ActionIcon variant="subtle" color="gray" aria-label={text} aria-pressed={k.zu} onClick={k.umschalten} style={{ flexShrink: 0 }}>
        {k.zu ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * Liste und Detail neben- oder untereinander („Fenster im Fenster“). Dazwischen liegt ein Teiler: ziehen ändert die
 * Größe der Liste (Pfeiltasten gehen auch, Doppelklick stellt den Standard wieder her), `ListeUmschalter` klappt sie
 * ganz zu. Größe und Zustand merkt sich die Ansicht je Gerät unter `schluessel`.
 */
export function GeteilteAnsicht({ schluessel, layout, listeLabel, liste, detailLabel, detail, standardBreite = 430, standardHoehe = '42%' }: {
  schluessel: string; layout: Layout; listeLabel: string; liste: ReactNode; detailLabel: string; detail: ReactNode;
  standardBreite?: number; standardHoehe?: string;
}) {
  const neben = layout === 'nebeneinander';
  const [zustand, setZustand] = useEinstellung(`${schluessel}.liste`, LISTE, 'auf');
  const [breite, setBreite] = useZahlEinstellung(`${schluessel}.breite`);
  const [hoehe, setHoehe] = useZahlEinstellung(`${schluessel}.hoehe`);
  const [beimZiehen, setBeimZiehen] = useState<number | null>(null);
  const rahmen = useRef<HTMLDivElement>(null);
  const listenfeld = useRef<HTMLDivElement>(null);
  const start = useRef<{ zeiger: number; groesse: number } | null>(null);
  const zu = zustand === 'zu';
  const merken = neben ? setBreite : setHoehe;

  const gesamt = () => { const r = rahmen.current?.getBoundingClientRect(); return r ? (neben ? r.width : r.height) : 0; };
  const aktuell = () => { const r = listenfeld.current?.getBoundingClientRect(); return r ? (neben ? r.width : r.height) : 0; };

  const ziehenBeginnt = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { zeiger: neben ? e.clientX : e.clientY, groesse: aktuell() };
    setBeimZiehen(aktuell());
  };
  const ziehen = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setBeimZiehen(teilerBegrenzen(start.current.groesse + (neben ? e.clientX : e.clientY) - start.current.zeiger, gesamt()));
  };
  const ziehenEndet = () => {
    if (!start.current) return;
    start.current = null;
    if (beimZiehen !== null) merken(beimZiehen);
    setBeimZiehen(null);
  };
  const taste = (e: KeyboardEvent<HTMLDivElement>) => {
    const richtung = (neben ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key as 'ArrowLeft'];
    if (!richtung) return;
    e.preventDefault();
    merken(teilerBegrenzen(aktuell() + richtung * TASTENSCHRITT, gesamt()));
  };

  const groesse = beimZiehen ?? (neben ? breite ?? standardBreite : hoehe ?? standardHoehe);
  return (
    <ListeKontext.Provider value={{ zu, umschalten: () => setZustand(zu ? 'auf' : 'zu') }}>
      <Box ref={rahmen} data-layout={layout} data-liste={zustand}
        style={{ display: 'flex', flexDirection: neben ? 'row' : 'column', flex: 1, height: '100%', minHeight: 0, userSelect: beimZiehen !== null ? 'none' : undefined }}>
        {!zu && (
          <>
            <ScrollArea ref={listenfeld} type="auto" aria-label={listeLabel} style={neben ? { width: groesse, flexShrink: 0 } : { height: groesse, flexShrink: 0 }}>
              {liste}
            </ScrollArea>
            <div
              role="separator" tabIndex={0} className={css.teiler} data-zieht={beimZiehen !== null || undefined}
              aria-orientation={neben ? 'vertical' : 'horizontal'} aria-label={neben ? 'Breite der Liste ändern' : 'Höhe der Liste ändern'}
              title="Ziehen ändert die Größe der Liste — Doppelklick stellt den Standard wieder her"
              onPointerDown={ziehenBeginnt} onPointerMove={ziehen} onPointerUp={ziehenEndet} onPointerCancel={ziehenEndet}
              onKeyDown={taste} onDoubleClick={() => merken(null)}
            />
          </>
        )}
        <Box component="section" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }} aria-label={detailLabel}>
          {detail}
        </Box>
      </Box>
    </ListeKontext.Provider>
  );
}
