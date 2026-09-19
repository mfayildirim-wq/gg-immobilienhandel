import { describe, expect, it } from 'vitest';
import { beziehungsprofil, erwaehnungenExtrahieren, kiAttrappe, maklerZusammenfassung, nachrichtEntwerfen, persoenlichesExtrahieren, stilAnalysieren, type KiClient } from '../src/index.ts';

const komm = [{ ts: '16.9.2026 10:15', kanal: 'email', richtung: 'ausgehend', betreff: 'Exposé', text: 'Können Sie mir Ihre Unterlagen senden?' }, { ts: 'Altbestand', kanal: 'notiz', text: 'Urlaub geplant' }];

describe('Persona-KI (Prompts wie alt, Auswertung)', () => {
  it('schickt die Prompts der alten App mit Modell und Tokenlimit', async () => {
    const gesendet: any[] = [];
    const ki: KiClient = { ...kiAttrappe(), async nachricht(body) { gesendet.push(body); return kiAttrappe().nachricht(body); } };
    expect((await maklerZusammenfassung(ki, { name: 'Anna', firma: 'A GmbH' }, komm))!.wert).toContain('Test-Modus');
    expect(gesendet[0]).toMatchObject({ model: 'claude-haiku-4-5-20251001', max_tokens: 400 });
    expect(gesendet[0].messages[0].content).toContain('Makler: Anna, A GmbH\n\nKommunikationshistorie:\n[16.9.2026 10:15] [email · ausgehend] Betreff: Exposé:\nKönnen Sie');
    await expect(beziehungsprofil(ki, { name: 'Anna' }, komm.slice(0, 1))).rejects.toThrow('Noch zu wenig Kommunikation mit diesem Makler');
    expect((await beziehungsprofil(ki, { name: 'Anna' }, komm)).wert).toContain('Test-Modus');
    expect((await erwaehnungenExtrahieren(ki, 'Nach dem Urlaub melde ich mich wieder bei Ihnen', 'email')).wert).toEqual([{ thema: 'Urlaub', detail: 'Erwähnt Urlaub (Test-Modus)' }]);
    expect((await persoenlichesExtrahieren(ki, { name: 'Anna' }, komm))!.wert).toMatchObject({ hobbies: ['Test-Modus'] });
    await expect(stilAnalysieren(ki, [], 2, 10, '2026-09-17T10:00:00Z')).rejects.toThrow('min. 3');
    const profil = (await stilAnalysieren(ki, [{ ts: 'x', kanal: 'email', makler: 'Anna', text: 'Hallo' }], 3, 40, '2026-09-17T10:00:00Z')).wert;
    expect(profil).toMatchObject({ analysisTs: '2026-09-17T10:00:00Z', commAnalyzed: 3, confidence: 40, anrede: 'Hallo' });
    expect(gesendet.at(-1)).toMatchObject({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1500 });
    const entwurf = await nachrichtEntwerfen(ki, profil, { name: 'Anna', lastContact: '2026-09-07', relationshipNote: 'per Sie', personal: { geburtsdatum: '09-17' } }, komm, [{ adresse: 'Hafenweg', stadt: 'Hamburg', status: 'In Prüfung' }], new Date(2026, 8, 17, 12));
    expect(entwurf.wert.email.subject).toContain('Test-Modus');
    const p = gesendet.at(-1).messages[0].content as string;
    expect(p).toContain('⚠️ WICHTIG: Mit diesem Makler wird konsequent "Sie" gesprochen.');
    expect(p).toContain('HEUTE IST SEIN/IHR GEBURTSTAG');
    expect(p).toContain('AKTIVE DEALS: Hafenweg, Hamburg (In Prüfung)');
    expect(p).toContain('KONTEXT: 10 Tage seit letztem Kontakt');
  });
});
