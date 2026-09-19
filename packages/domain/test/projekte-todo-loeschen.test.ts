/* Nach gg-immohandel src/modules/projektmanagement/pm-todo-loeschen.test.ts: Löschen ist ein Klick, die letzte Zeile nimmt die Kategorie hörbar mit. */
import { describe, expect, test } from 'vitest';
import { pmKategorieEntferntHinweis, type PmTodo, pmTodoLoeschen } from '../src/index.ts';

const t = (id: string, cat: string, text: string): PmTodo => ({ id, cat, text, status: 'offen', kommentar: '', verantwortlich: '', faellig: '' });
const todos = [t('t1', '🏦 Bank', 'Finanzierung anfragen'), t('t2', '🏦 Bank', 'Termin bestätigen'), t('t3', '📐 Technik', 'Dach prüfen')];

describe('Eine Zeile mit Geschwistern', () => {
  test('verschwindet, ohne Hinweis', () => {
    const r = pmTodoLoeschen(todos, 't1');
    expect(r.todos.map((x) => x.id)).toEqual(['t2', 't3']);
    expect(r.kategorieEntfernt).toBeNull();
  });
});

describe('Die letzte Zeile einer Kategorie', () => {
  test('geht ebenfalls — keine Ersatzzeile', () => {
    const r = pmTodoLoeschen(todos, 't3');
    expect(r.todos.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(r.todos.some((x) => x.cat === '📐 Technik')).toBe(false);
  });

  test('nimmt die Kategorie hörbar mit, nicht still', () => {
    const r = pmTodoLoeschen(todos, 't3');
    expect(pmKategorieEntferntHinweis(r.kategorieEntfernt!)).toContain('📐 Technik');
  });
});
