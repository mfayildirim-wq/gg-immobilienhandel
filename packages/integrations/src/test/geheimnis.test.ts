import { describe, expect, it } from 'vitest';
import { ENC_PREFIX, geheimnisAuspacken, geheimnisMaske, geheimnisVerpacken } from '../geheimnis.ts';

describe('Geheimnisse verschlüsseln', () => {
  it('Runde: verpacken und auspacken ergibt denselben Wert', () => {
    const verpackt = geheimnisVerpacken('sk-ant-geheim-1234');
    expect(verpackt.startsWith(ENC_PREFIX)).toBe(true);
    expect(verpackt).not.toContain('geheim');
    expect(geheimnisAuspacken(verpackt)).toBe('sk-ant-geheim-1234');
  });

  it('Leer bleibt leer, Klartext ohne Kennung bleibt unverändert (Altbestand)', () => {
    expect(geheimnisVerpacken('')).toBe('');
    expect(geheimnisAuspacken('')).toBe('');
    expect(geheimnisAuspacken('sk-alt-klartext')).toBe('sk-alt-klartext');
  });

  it('Maske zeigt nur die letzten vier Zeichen', () => {
    expect(geheimnisMaske('sk-ant-geheim-1234')).toBe('••••1234');
    expect(geheimnisMaske('')).toBe('');
  });
});
