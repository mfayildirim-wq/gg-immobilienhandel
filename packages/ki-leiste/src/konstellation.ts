/**
 * Die Konstellation eines Leuchtkerns — aus dem Saatwert, bei jedem Rendern dieselbe. Übernommen aus CoSAi
 * (`frontend/components/figur/konstellation.ts`).
 *
 * Zwei bis vier Ringe von innen nach außen; je Ring die Zahl der Bogen-Segmente, wie viel des Umfangs sie füllen,
 * die Strichbreite, die Umlaufdauer, die Richtung und der Startwinkel. Getrennt von der Zeichnung, damit sie sich
 * ohne Browser prüfen lässt.
 */

const SEGMENTE = [3, 4, 6, 8, 12] as const;
const DAUER = [9, 13, 17, 22] as const;
const RADIEN = [30, 39, 47, 54] as const;

export type Ring = {
  r: number;
  segmente: number;
  /** wie viel des Umfangs die Bögen füllen (0–1) */
  anteil: number;
  breite: number;
  dauer: number;
  richtung: 1 | -1;
  /** Startwinkel in Grad */
  drehung: number;
};

export function konstellation(saat: number): Ring[] {
  const anzahl = 2 + (saat % 3);
  const ringe: Ring[] = [];
  for (let i = 0; i < anzahl; i++) {
    const bits = saat >>> (2 + i * 7);
    ringe.push({
      r: RADIEN[i]!,
      segmente: SEGMENTE[bits % SEGMENTE.length]!,
      anteil: 0.3 + ((bits >>> 3) % 5) * 0.12,
      breite: i === anzahl - 1 ? 1.6 : [2.2, 3.4, 4.6][(bits >>> 6) % 3]!,
      dauer: DAUER[(bits >>> 8) % DAUER.length]!,
      richtung: ((bits >>> 10) & 1) === 0 ? 1 : -1,
      drehung: (bits >>> 11) % 360,
    });
  }
  return ringe;
}

/** Saatwert aus einem Text (Name des Agenten, Nutzer) — stabil über Sitzungen. */
export function saatAus(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
