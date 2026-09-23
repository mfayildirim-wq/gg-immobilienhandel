import { ActionIcon, Group, Tabs, type TabsListProps } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import css from './Reiterleiste.module.css';

const SCHRITT = 240;

/**
 * Reiterleiste in einer Zeile (23.09.2026): Bei schmalem Fenster brechen die Reiter nicht in eine zweite Zeile um,
 * sondern scrollen seitlich. Pfeile links und rechts erscheinen nur, wenn dort noch Reiter verdeckt sind.
 * Ersetzt `Tabs.List` an allen Stellen mit mehr als zwei Reitern (Deal, Makler, Objekt, Ankauf, Projekt).
 */
export function Reiterleiste({ children, className, ...rest }: TabsListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState(false);
  const [rechts, setRechts] = useState(false);

  const pruefen = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setLinks(el.scrollLeft > 1);
    setRechts(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    pruefen();
    const beobachter = new ResizeObserver(pruefen);
    beobachter.observe(el);
    for (const kind of el.children) beobachter.observe(kind);
    el.addEventListener('scroll', pruefen, { passive: true });
    return () => { beobachter.disconnect(); el.removeEventListener('scroll', pruefen); };
  }, [pruefen]);

  const rollen = (richtung: -1 | 1) => ref.current?.scrollBy({ left: richtung * SCHRITT });

  return (
    <Group gap={0} wrap="nowrap" align="stretch">
      {links && (
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => rollen(-1)} aria-label="Reiter nach links">
          <IconChevronLeft size={18} />
        </ActionIcon>
      )}
      <Tabs.List ref={ref} className={[css.liste, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </Tabs.List>
      {rechts && (
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => rollen(1)} aria-label="Reiter nach rechts">
          <IconChevronRight size={18} />
        </ActionIcon>
      )}
    </Group>
  );
}
