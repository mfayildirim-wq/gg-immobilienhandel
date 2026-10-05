import { describe, expect, it } from 'vitest';
import { brotkrumen } from './brotkrumen.ts';

const SEITEN = [{ to: '/', label: 'Ankauf' }, { to: '/deals', label: 'Deals' }, { to: '/projekte', label: 'Projekte' }, { to: '/kundenkalkulationen', label: 'Kundenkalk' }];
const EINSTELLUNGEN = [{ pfad: 'kalkulation', label: 'Kalkulation' }, { pfad: 'papierkorb', label: 'Papierkorb' }];
const krumen = (pfad: string) => brotkrumen(pfad, SEITEN, EINSTELLUNGEN);

describe('brotkrumen (Kopfzeile: auf welcher Seite man ist)', () => {
  it('Startseite und Listenseiten: eine Krume mit dem Namen aus der Seitenleiste', () => {
    expect(krumen('/')).toEqual([{ label: 'Ankauf' }]);
    expect(krumen('/deals')).toEqual([{ label: 'Deals' }]);
  });

  it('Einstellungen: zwei Krumen, die Unterseite zuletzt', () => {
    expect(krumen('/einstellungen/papierkorb')).toEqual([{ label: 'Einstellungen' }, { label: 'Papierkorb' }]);
    expect(krumen('/einstellungen')).toEqual([{ label: 'Einstellungen' }]);
  });

  it('Unterseite einer Liste: die Liste als Verweis zurück, dahinter die Art des Eintrags', () => {
    expect(krumen('/projekte/p-1')).toEqual([{ label: 'Projekte', to: '/projekte' }, { label: 'Projekt' }]);
    expect(krumen('/kundenkalkulationen/k-1')).toEqual([{ label: 'Kundenkalk', to: '/kundenkalkulationen' }, { label: 'Kalkulation' }]);
  });

  it('Seiten ohne Eintrag in der Seitenleiste haben einen eigenen Namen; Unbekanntes bleibt leer', () => {
    expect(krumen('/expose-import')).toEqual([{ label: 'Exposé importieren' }]);
    expect(krumen('/praesentationen/x')).toEqual([{ label: 'Bank-Präsentation' }]);
    expect(krumen('/gibt-es-nicht')).toEqual([]);
  });
});
