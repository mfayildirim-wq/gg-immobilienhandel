import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { afterAll, describe, expect, it } from 'vitest';
import { DrizzleSaver } from '../src/checkpointer.ts';
import { testDb, url } from './db.ts';

describe.skipIf(!url)('DrizzleSaver', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  afterAll(async () => { await client?.end(); });

  it('unterbricht einen Graphen und nimmt ihn aus der Datenbank wieder auf', async () => {
    const Zustand = Annotation.Root({
      schritte: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
      antwort: Annotation<string>,
    });
    // Derselbe Graph, je Aufruf neu gebaut — wie zwei getrennte Function-Aufrufe mit eigenem Saver
    const bauen = (saver: DrizzleSaver) => new StateGraph(Zustand)
      .addNode('vorbereiten', () => ({ schritte: ['vorbereitet'] }))
      .addNode('fragen', () => ({ schritte: ['gefragt'], antwort: interrupt({ frage: 'Kommentar abschicken?' }) as string }))
      .addNode('senden', (s) => ({ schritte: [s.antwort === 'ja' ? 'gesendet' : 'abgebrochen'] }))
      .addEdge(START, 'vorbereiten').addEdge('vorbereiten', 'fragen').addEdge('fragen', 'senden').addEdge('senden', END)
      .compile({ checkpointer: saver });
    const graph = bauen(new DrizzleSaver(db));

    const threadId = `test-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };
    const erst = await graph.invoke({}, config);
    expect(erst.schritte).toEqual(['vorbereitet']);
    const stand = await graph.getState(config);
    expect(stand.tasks[0]?.interrupts[0]?.value).toEqual({ frage: 'Kommentar abschicken?' });

    const zweiter = new DrizzleSaver(db);
    const ergebnis = await bauen(zweiter).invoke(new Command({ resume: 'ja' }), config);
    expect(ergebnis.schritte).toEqual(['vorbereitet', 'gefragt', 'gesendet']);

    const liste = [];
    for await (const t of zweiter.list(config)) liste.push(t);
    expect(liste.length).toBeGreaterThanOrEqual(3);
    await zweiter.deleteThread(threadId);
    expect(await zweiter.getTuple(config)).toBeUndefined();
  });
});
