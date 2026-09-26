/**
 * Der Sprechkreis — das Gesicht des Agenten, in drei Stilen zur Auswahl:
 * `kern` (der Leuchtkern aus CoSAi: glühender Kern, gegenläufig drehende Ringe), `puls` (eine weiche, atmende
 * Scheibe wie ein Sprachassistent) und `orbit` (nur Ringe, die beim Sprechen aufblühen).
 *
 * Zustände: ruhig (atmet), hoert (der Rand reagiert auf den Pegel des Mikrofons), denkt (dreht schneller),
 * spricht (pulsiert im Takt). Der Pegel (0–1) skaliert den Schein — beim Hören das Mikrofon, beim Sprechen die Stimme.
 */
import { konstellation, type Ring } from './konstellation.ts';

export type SprechkreisStil = 'kern' | 'puls' | 'orbit';
export const SPRECHKREIS_STILE: { wert: SprechkreisStil; label: string }[] = [
  { wert: 'kern', label: 'Leuchtkern' },
  { wert: 'puls', label: 'Puls' },
  { wert: 'orbit', label: 'Orbit' },
];
export type SprechkreisZustand = 'ruhig' | 'hoert' | 'denkt' | 'spricht';

export interface SprechkreisProps {
  stil?: SprechkreisStil;
  zustand?: SprechkreisZustand;
  /** 0–1: Lautstärke beim Hören oder Sprechen */
  pegel?: number;
  groesse?: number;
  farbe?: string;
  saat?: number;
  titel?: string;
  onClick?: () => void;
}

const NACHT = '#0f1720';

function Bogenring({ ring, farbe, klasse, opacity, tempo }: { ring: Ring; farbe: string; klasse?: string; opacity: number; tempo: number }) {
  const umfang = 2 * Math.PI * ring.r;
  const teil = umfang / ring.segmente;
  const strich = teil * ring.anteil;
  // Der Startwinkel sitzt auf der Gruppe, die Drehung auf dem Kreis — sonst überschriebe die Animation den Winkel.
  return (
    <g style={{ transform: `rotate(${ring.drehung}deg)`, transformOrigin: '60px 60px' }}>
      <circle
        cx="60" cy="60" r={ring.r} fill="none" stroke={farbe} strokeWidth={ring.breite} strokeLinecap="butt"
        strokeDasharray={`${strich.toFixed(2)} ${(teil - strich).toFixed(2)}`} opacity={opacity} className={klasse}
        style={{ transformOrigin: '60px 60px', animationDuration: klasse === 'am-dreht' ? `${ring.dauer / tempo}s` : undefined, animationDirection: ring.richtung === 1 ? 'normal' : 'reverse' }}
      />
    </g>
  );
}

/** Ein Funke als Zeichen in der Mitte — neutral, kein Beruf. */
function Funke({ farbe }: { farbe: string }) {
  return <path d="M60 48l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill={farbe} opacity="0.9" />;
}

export function Sprechkreis({ stil = 'kern', zustand = 'ruhig', pegel = 0, groesse = 120, farbe = '#2f9e8f', saat = 7, titel = 'Agent', onClick }: SprechkreisProps) {
  const spricht = zustand === 'spricht';
  const denkt = zustand === 'denkt';
  const hoert = zustand === 'hoert';
  const p = Math.max(0, Math.min(1, pegel));
  const schein = 0.08 + (spricht || hoert ? p * 0.3 : 0);
  const gemeinsam = {
    viewBox: '0 0 120 120', width: groesse, height: groesse, role: 'img' as const, 'aria-label': `${titel}: ${zustand}`,
    'data-zustand': zustand, 'data-stil': stil, className: `am-sprechkreis am-${zustand}`, onClick, style: onClick ? { cursor: 'pointer' } : undefined,
  };

  if (stil === 'puls') {
    const radius = 34 + (spricht || hoert ? p * 10 : 0);
    return (
      <svg {...gemeinsam}>
        <defs>
          <radialGradient id={`am-puls-${saat}`}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="45%" stopColor={farbe} stopOpacity="0.9" />
            <stop offset="100%" stopColor={farbe} stopOpacity="0.1" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="56" fill={farbe} opacity={schein} className={spricht ? 'am-schein' : undefined} style={{ transformOrigin: '60px 60px' }} />
        <circle cx="60" cy="60" r={radius} fill={`url(#am-puls-${saat})`} className={spricht ? 'am-pulst' : denkt ? 'am-atmet am-atmet-schnell' : 'am-atmet'} style={{ transformOrigin: '60px 60px', transition: 'r 120ms' }} />
        <circle cx="60" cy="60" r="44" fill="none" stroke={farbe} strokeWidth="1" opacity={hoert ? 0.6 : 0.25} strokeDasharray={hoert ? '3 5' : undefined} className={denkt ? 'am-dreht' : undefined} style={{ transformOrigin: '60px 60px' }} />
      </svg>
    );
  }

  const ringe = konstellation(saat);
  const ringKlasse = spricht ? 'am-vibriert' : 'am-dreht';
  const tempo = denkt ? 3 : 1;

  if (stil === 'orbit') {
    return (
      <svg {...gemeinsam}>
        <circle cx="60" cy="60" r="56" fill={farbe} opacity={schein} className={spricht ? 'am-schein' : undefined} style={{ transformOrigin: '60px 60px' }} />
        {ringe.map((ring, i) => (
          <Bogenring key={ring.r} ring={{ ...ring, r: ring.r + (spricht || hoert ? p * 6 : 0) }} farbe={farbe} klasse={ringKlasse} opacity={0.45 + i * 0.18} tempo={tempo} />
        ))}
        <circle cx="60" cy="60" r={6 + p * 6} fill={farbe} className="am-atmet" style={{ transformOrigin: '60px 60px' }} />
      </svg>
    );
  }

  // kern — der Leuchtkern aus CoSAi
  const kernKlasse = spricht ? 'am-pulst' : denkt ? 'am-atmet am-atmet-schnell' : 'am-atmet';
  const striche = ((saat >>> 5) & 1) === 1;
  const id = `am-kern-${saat.toString(36)}`;
  return (
    <svg {...gemeinsam}>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="38%" stopColor={farbe} stopOpacity="0.95" />
          <stop offset="100%" stopColor={farbe} stopOpacity="0.15" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill={farbe} opacity={schein} className={spricht || denkt ? 'am-schein' : undefined} style={{ transformOrigin: '60px 60px' }} />
      {ringe.map((ring, i) => (
        <Bogenring key={ring.r} ring={ring} farbe={farbe} klasse={ringKlasse} opacity={i === ringe.length - 1 ? 0.95 : 0.55 + i * 0.12} tempo={tempo} />
      ))}
      <circle cx="60" cy="60" r={ringe[0]!.r - 5} fill="none" stroke={farbe} strokeWidth="0.8" opacity="0.35" />
      {striche && (
        <g stroke={farbe} strokeWidth="1.2" opacity="0.5" className="am-dreht am-dreht-langsam" style={{ transformOrigin: '60px 60px' }}>
          {Array.from({ length: 24 }, (_, i) => {
            const w = (i * 15 * Math.PI) / 180;
            const r1 = 57.5;
            const r2 = i % 6 === 0 ? 55 : 56.5;
            return <line key={i} x1={60 + r1 * Math.cos(w)} y1={60 + r1 * Math.sin(w)} x2={60 + r2 * Math.cos(w)} y2={60 + r2 * Math.sin(w)} />;
          })}
        </g>
      )}
      <circle cx="60" cy="60" r={18 + (hoert ? p * 4 : 0)} fill={`url(#${id})`} className={kernKlasse} style={{ transformOrigin: '60px 60px' }} />
      <circle cx="60" cy="60" r="11" fill={farbe} opacity="0.9" className={kernKlasse} style={{ transformOrigin: '60px 60px' }} />
      <Funke farbe={NACHT} />
    </svg>
  );
}
