import { type FinanzPraes, type FinanzpraesDefaults, mitStandards, type SlideTyp } from '@gg/domain';
import { renderSlideLivePreview, standardbilderEinsetzen } from '@gg/documents';
import type { Praesentation } from '@gg/api-contract';
import { Paper, Text } from '@mantine/core';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

const BREITE = 1123 + 24; // A4 quer bei 96 dpi + Rand

/**
 * Live-Vorschau der gewählten Folie: dieselbe Vorlage wie PDF/PowerPoint, mit den Standards aus den Einstellungen.
 * Gerendert in voller Breite in einem skriptlosen Rahmen und als Ganzes auf die verfügbare Breite verkleinert.
 */
export function FolienVorschau({ praes, folieId, standard }: { praes: Praesentation; folieId: string | null; standard: FinanzpraesDefaults | undefined }) {
  const stand = useDeferredValue(praes);
  const html = useMemo(() => {
    const p = stand as unknown as FinanzPraes;
    const erweitert = standardbilderEinsetzen(standard ? mitStandards(p, standard) : p);
    const folie = erweitert.slides.find((s) => s.id === folieId);
    if (!folie) return null;
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>body{margin:0;--fp-scale:1}</style></head><body>${renderSlideLivePreview(erweitert, { ...folie, typ: folie.typ as SlideTyp })}</body></html>`;
  }, [stand, folieId, standard]);

  const huelle = useRef<HTMLDivElement>(null);
  const rahmen = useRef<HTMLIFrameElement>(null);
  const [faktor, setFaktor] = useState(0.5);
  const [hoehe, setHoehe] = useState(820);
  useEffect(() => {
    const el = huelle.current;
    if (!el) return;
    const beobachter = new ResizeObserver(([e]) => e && setFaktor(Math.min(1, e.contentRect.width / BREITE)));
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, []);

  return (
    <Paper withBorder p="xs" component="section" aria-label="Live-Vorschau der Folie">
      <Text size="xs" c="dimmed" mb={4}>👁 Live-Vorschau · A4 Querformat</Text>
      <div ref={huelle} style={{ width: '100%', height: html ? hoehe * faktor : 120, overflow: 'hidden' }}>
        {html ? (
          <iframe ref={rahmen} title="Folienvorschau" sandbox="allow-same-origin" srcDoc={html}
            onLoad={() => { const h = rahmen.current?.contentDocument?.documentElement.scrollHeight; if (h) setHoehe(h); }}
            style={{ width: BREITE, height: hoehe, border: 0, transform: `scale(${faktor})`, transformOrigin: 'top left', display: 'block' }} />
        ) : <Text c="dimmed" ta="center" pt="xl">Keine Slide ausgewählt</Text>}
      </div>
    </Paper>
  );
}
