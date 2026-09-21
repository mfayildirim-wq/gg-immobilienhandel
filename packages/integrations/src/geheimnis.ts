/**
 * Verschlüsselung ruhender Geheimnisse (AES-256-GCM). Übernommen aus gg-immohandel server/krypto.ts;
 * geändert: der Schlüssel kommt aus `GG_ENCRYPTION_KEY` oder einer lokalen Datei, die erst beim ersten
 * Schreiben angelegt wird (kein Dateizugriff beim Import — auf Vercel ist alles außer /tmp schreibgeschützt).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Kennung vor dem Chiffrat: ein Wert ohne dieses Präfix ist Klartext aus der Zeit davor. */
export const ENC_PREFIX = 'enc:v1:';

const SCHLUESSEL_DATEI = () => path.join(process.env.GG_DATA_DIR ?? 'data', '.encryption-key');

let zwischengespeichert: Buffer | null = null;

function schluessel(): Buffer {
  if (zwischengespeichert) return zwischengespeichert;
  const ausUmgebung = process.env.GG_ENCRYPTION_KEY;
  if (ausUmgebung) {
    const buf = Buffer.from(ausUmgebung, 'base64');
    if (buf.length !== 32) throw new Error(`GG_ENCRYPTION_KEY hat ${buf.length} Byte statt 32 (base64 von 32 Byte erwartet).`);
    zwischengespeichert = buf;
    return buf;
  }
  // Online gibt es kein beständiges Dateisystem: ein dort erzeugter Schlüssel lebte nur bis zum nächsten Kaltstart,
  // und alles damit Verschlüsselte (Zugänge, Tokens) wäre danach unlesbar — still, ohne Fehlermeldung beim Speichern.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('GG_ENCRYPTION_KEY fehlt. In Produktion wird kein Schlüssel erzeugt — base64 von 32 Byte in der Umgebung hinterlegen.');
  }
  const datei = SCHLUESSEL_DATEI();
  if (fs.existsSync(datei)) {
    const buf = fs.readFileSync(datei);
    if (buf.length !== 32) throw new Error(`Schlüsseldatei hat ${buf.length} Byte statt 32.`);
    zwischengespeichert = buf;
    return buf;
  }
  const neu = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, neu, { mode: 0o600 });
  console.log('[geheimnis] Neuer Verschlüsselungsschlüssel angelegt:', datei);
  zwischengespeichert = neu;
  return neu;
}

/** Format: base64(iv|tag|ciphertext). */
export function verschluesseln(klartext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', schluessel(), iv);
  const ct = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function entschluesseln(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 28) throw new Error('Chiffrat zu kurz');
  const decipher = crypto.createDecipheriv('aes-256-gcm', schluessel(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** Zum Ablegen: mit Kennung, damit Klartext und Chiffrat unterscheidbar bleiben. Leer bleibt leer. */
export const geheimnisVerpacken = (klartext: string) => (klartext === '' ? '' : ENC_PREFIX + verschluesseln(klartext));

/** Beim Lesen: mit Kennung entschlüsseln, ohne Kennung unverändert zurückgeben (Altbestand). */
export function geheimnisAuspacken(gespeichert: string | null | undefined): string {
  if (!gespeichert) return '';
  if (!gespeichert.startsWith(ENC_PREFIX)) return gespeichert;
  return entschluesseln(gespeichert.slice(ENC_PREFIX.length));
}

/** Anzeige in der Oberfläche: nie der ganze Schlüssel, nur die letzten vier Zeichen. */
export const geheimnisMaske = (klartext: string) => (klartext ? `••••${klartext.slice(-4)}` : '');
