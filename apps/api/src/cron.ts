import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Darf dieser Cron-Aufruf laufen? (alt: server/cron-auth.ts)
 *
 * Die Cron-Routen liegen VOR der Anmeldeprüfung — Vercel ruft sie ohne Nutzer-Token auf, nur mit
 * `Authorization: Bearer <CRON_SECRET>`, sobald die Variable im Projekt hinterlegt ist. Deshalb Default-Deny:
 * ohne gesetztes Geheimnis niemals. Ein vergessener Eintrag soll den Endpunkt schließen, nicht öffnen.
 */
export function cronErlaubt(geheimnis: string | undefined, authorization: string | undefined): boolean {
  if (!geheimnis || !authorization) return false;
  // Über SHA-256 auf gleiche Länge: timingSafeEqual wirft bei ungleicher Länge, und daraus entstünde wieder ein messbarer Unterschied
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(authorization), h(`Bearer ${geheimnis}`));
}
