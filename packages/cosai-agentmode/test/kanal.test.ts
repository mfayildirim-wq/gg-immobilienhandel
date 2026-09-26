import { describe, expect, it, vi } from 'vitest';
import { ausfuehren, beobachten, melden, wertSetzen, zielFinden } from '../src/kanal.ts';

describe('Kanal (Oberfläche)', () => {
  it('findet Ziele und Listeneinträge über data-agent / data-agent-wert', () => {
    document.body.innerHTML = `<ul><li data-agent="ankauf.deals.eintrag" data-agent-wert="d1">A</li><li data-agent="ankauf.deals.eintrag" data-agent-wert="d2">B</li></ul>`;
    expect(zielFinden('ankauf.deals.eintrag')?.textContent).toBe('A');
    expect(zielFinden('ankauf.deals.eintrag', 'd2')?.textContent).toBe('B');
    expect(zielFinden('ankauf.deals.eintrag', 'd9')).toBeNull();
    document.querySelector('li')!.setAttribute('data-agent-auch', 'ankauf.deals.erster');
    expect(zielFinden('ankauf.deals.erster')?.textContent).toBe('A');
    expect(zielFinden('gibt.es.nicht')).toBeNull();
  });

  it('füllt ein kontrolliertes Feld so, dass React es merkt (input-Ereignis über den nativen Setter)', () => {
    document.body.innerHTML = `<div data-agent="deal.kommentar.text"><textarea></textarea></div>`;
    const feld = document.querySelector('textarea')!;
    const gesehen: string[] = [];
    feld.addEventListener('input', () => gesehen.push(feld.value));
    wertSetzen(zielFinden('deal.kommentar.text')!, 'Rückruf Montag');
    expect(gesehen).toEqual(['Rückruf Montag']);
  });

  it('führt oeffne/fuelle/sende aus und navigiert über den Host', async () => {
    document.body.innerHTML = `<button data-agent="deal.reiter.kommunikation">Kommunikation</button><div data-agent="deal.kommentar.text"><textarea></textarea></div><button data-agent="deal.kommentar.senden">Senden</button>`;
    const klicks: string[] = [];
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => klicks.push(b.dataset.agent!)));
    const navigiere = vi.fn();
    await ausfuehren({ art: 'navigiere', ziel: 'nav.ankauf' }, { navigiere });
    await ausfuehren({ art: 'oeffne', ziel: 'deal.reiter.kommunikation' }, { navigiere });
    await ausfuehren({ art: 'fuelle', ziel: 'deal.kommentar.text', wert: 'Hallo' }, { navigiere });
    await ausfuehren({ art: 'sende', ziel: 'deal.kommentar.senden' }, { navigiere });
    expect(navigiere).toHaveBeenCalledWith('nav.ankauf');
    expect(klicks).toEqual(['deal.reiter.kommunikation', 'deal.kommentar.senden']);
    expect(document.querySelector('textarea')!.value).toBe('Hallo');
    await expect(ausfuehren({ art: 'oeffne', ziel: 'fehlt.hier' }, { navigiere, wartenMs: 100 })).rejects.toThrow(/nicht gefunden/);
  });

  it('beobachtet Klicks mit Kontext und Meldungen der Host-Komponenten', () => {
    document.body.innerHTML = `<section data-agent-kontext='{"dealId":"d1"}'><button data-agent="deal.erledigt">Erledigt</button><button data-agent="x.y" data-agent-stumm>still</button></section>`;
    const gesehen: unknown[] = [];
    const ab = beobachten((b) => gesehen.push(b));
    document.querySelector<HTMLElement>('[data-agent="deal.erledigt"]')!.click();
    document.querySelector<HTMLElement>('[data-agent="x.y"]')!.click();
    melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf', kontext: { dealId: 'd1' } });
    ab();
    melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'danach' });
    expect(gesehen).toEqual([
      { art: 'klick', ziel: 'deal.erledigt', wert: undefined, kontext: { dealId: 'd1' } },
      { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf', kontext: { dealId: 'd1' } },
    ]);
  });
});
