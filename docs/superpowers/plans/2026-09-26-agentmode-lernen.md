# AgentMode Lieferung 2a: Lernen, Vorschläge am Feld, Morgenvorschlag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Agent lernt Formulierungen auch ohne Overlay, zeigt sie als Vorschläge direkt am Notizfeld und begrüßt beim ersten Öffnen des Tages mit dem, was ansteht.

**Architecture:** Drei Bausteine, alle ohne Import aus `@gg/*` in `packages/cosai-*`:
(1) `Lernen` — eine immer eingebundene Komponente, die nur `gespeichert`-Meldungen an `/api/agent/ereignis` schickt; `AgentMode` schickt diese Art nicht mehr (sonst doppelt).
(2) `FeldVorschlaege` — Chips unter einem Feld aus `/api/agent/vorschlaege?ziel=…`; ein Klick füllt das Feld, abschicken tut der Nutzer. Nach einem `gespeichert` für dasselbe Ziel lädt sie neu.
(3) `kern.morgen(nutzer, heute)` + `POST /morgen` — einmal je Nutzer und Tag (Merker in `cosai.ereignisse`, `art = 'morgen'`, `kontext.datum`) läuft ein Auftrag „was steht heute an“ durch den Graphen in einer neuen Sitzung; `AgentMode` ruft das beim Öffnen und zeigt die Antwort. Der Tag kommt aus dem Browser (lokales Datum des Nutzers). Steuerungen aus dem Morgenvorschlag werden **nicht** ausgeführt — er ist nur lesend.

Entscheidungen des Auftraggebers (26.09.): immer lernen; Vorschläge direkt am Feld; danach Morgenvorschlag, dann Routinen (eigener Plan 2b).

**Tech Stack:** TypeScript, React 19, Hono, Drizzle, LangGraph.js, Vitest + Testing Library, Playwright.

---

## Dateistruktur

```
packages/cosai-kern/src/kern.ts          + morgen(nutzer, heute), Option morgenAuftrag
packages/cosai-kern/src/hono.ts          + POST /morgen
packages/cosai-kern/test/kern.test.ts    + Test „Morgenvorschlag einmal am Tag“
packages/cosai-kern/test/hono.test.ts    + Test POST /morgen (Datum geprüft)
packages/cosai-agentmode/src/lernen.tsx  NEU: Lernen, FeldVorschlaege, heuteLokal()
packages/cosai-agentmode/src/AgentMode.tsx  gespeichert nicht mehr senden; Morgenvorschlag beim Öffnen
packages/cosai-agentmode/src/index.ts    + export lernen.tsx
packages/cosai-agentmode/src/agentmode.css  + .am-feldvorschlaege
packages/cosai-agentmode/test/lernen.test.tsx  NEU
packages/cosai-agentmode/test/agentmode.test.tsx  + Morgenvorschlag, kein gespeichert
apps/web/src/components/AppRahmen.tsx    <Lernen> immer, wenn der Agent verfügbar ist
apps/web/src/components/deal/DealKommunikation.tsx  <FeldVorschlaege> unter der Notiz
tests/e2e/agentmode.spec.ts             + ohne Overlay lernen → Vorschlag am Feld; Morgenvorschlag
README.md, OFFEN.md                      Abschnitt AgentMode ergänzen
```

---

### Task 1: Kern — Morgenvorschlag einmal am Tag

**Files:**
- Modify: `packages/cosai-kern/src/kern.ts` (Optionen, Rückgabeobjekt)
- Test: `packages/cosai-kern/test/kern.test.ts`

- [ ] **Step 1: Failing test** — ans Ende des `describe('Kern', …)` in `kern.test.ts`:

```ts
  it('macht den Morgenvorschlag einmal am Tag, in einer eigenen Sitzung', async () => {
    const tag = `2099-01-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
    const drehbuch = [ki('', [['get_api_ankauf', {}]]), ki('Heute ist ein Deal fällig: Weraststraße 12.')];
    const kern = agentKern({ db, modell: drehbuchModell(drehbuch), openapi, ziele, aufruf });
    const a = await kern.morgen(nutzer, tag);
    expect(a?.text).toBe('Heute ist ein Deal fällig: Weraststraße 12.');
    expect(a?.sitzungId).toBeTruthy();
    // Zweites Öffnen am selben Tag — auch über einen neuen Kern: nichts mehr
    const zweiter = agentKern({ db, modell: drehbuchModell([]), openapi, ziele, aufruf });
    expect(await zweiter.morgen(nutzer, tag)).toBeNull();
    // Ein anderer Nutzer bekommt seinen eigenen
    expect(await agentKern({ db, modell: drehbuchModell([ki('Guten Morgen.')]), openapi, ziele, aufruf }).morgen({ id: 'test-kern-2@example' }, tag)).not.toBeNull();
  });
```

- [ ] **Step 2: Run** `cd packages/cosai-kern && npx vitest run test/kern.test.ts` — erwartet FAIL: `kern.morgen is not a function`.

- [ ] **Step 3: Implement** in `kern.ts`:

In `KernOptionen` (neben `dna?`):
```ts
  /** Auftrag des Morgenvorschlags — nur lesen, nichts ändern */
  morgenAuftrag?: string;
```
Konstante über `agentKern`:
```ts
export const MORGEN_AUFTRAG = 'Guten Morgen. Was steht heute an? Nenne, wie viele Einträge fällig sind, und schlage vor, womit ich anfange. Nur lesen, nichts ändern.';
```
Im Rückgabeobjekt (nach `nachricht`):
```ts
    /**
     * Der Morgenvorschlag: beim ersten Öffnen des Tages (Datum `heute` aus dem Browser, JJJJ-MM-TT) einmal je Nutzer.
     * Der Merker steht vor dem Lauf in `ereignisse` — zwei Fenster gleichzeitig erzeugen so höchstens selten zwei.
     */
    async morgen(nutzer: Nutzer, heute: string): Promise<AgentAntwort | null> {
      const [schon] = await db.select({ id: ereignisse.id }).from(ereignisse)
        .where(and(eq(ereignisse.nutzer, nutzer.id), eq(ereignisse.art, 'morgen'), sql`${ereignisse.kontext}->>'datum' = ${heute}`)).limit(1);
      if (schon) return null;
      await db.insert(ereignisse).values({ nutzer: nutzer.id, sitzungId: null, richtung: 'steuerung', art: 'morgen', ziel: null, wert: null, kontext: { datum: heute } });
      return this.nachricht(nutzer, { text: opt.morgenAuftrag ?? MORGEN_AUFTRAG, ort: '/', kontext: {} });
    },
```
Imports ergänzen: `and`, `sql` aus `drizzle-orm` (falls nicht vorhanden). Das Rückgabeobjekt nutzt `this` — wenn es als Objektliteral zurückgegeben wird, funktioniert `this.nachricht` nur bei Aufruf als `kern.morgen(...)`; sicherer: die Nachricht-Funktion vorher als `const nachricht = async (...) => {…}` herausziehen und in beiden verwenden.

- [ ] **Step 4: Run** `npx vitest run` in `packages/cosai-kern` — erwartet alle grün; `npx tsc -p tsconfig.json`.

- [ ] **Step 5: Commit** `git commit -m "cosai-kern: Morgenvorschlag einmal je Nutzer und Tag"`

---

### Task 2: Route `POST /morgen`

**Files:** Modify `packages/cosai-kern/src/hono.ts`; Test `packages/cosai-kern/test/hono.test.ts`

- [ ] **Step 1: Failing test** in `hono.test.ts` (Muster der vorhandenen Tests dort übernehmen — Kern-Ersatz mit `morgen`):

```ts
  it('POST /morgen prüft das Datum und liefert die Antwort oder null', async () => {
    const aufrufe: string[] = [];
    const kern = { morgen: async (_n: unknown, heute: string) => { aufrufe.push(heute); return heute === '2099-01-01' ? { sitzungId: 's', text: 'Guten Morgen', steuerung: [], chips: [] } : null; } } as unknown as Kern;
    const app = agentRouten(kern, () => ({ id: 'n' }));
    expect((await app.request('/morgen', { method: 'POST', body: JSON.stringify({ heute: 'gestern' }), headers: { 'content-type': 'application/json' } })).status).toBe(400);
    const r = await app.request('/morgen', { method: 'POST', body: JSON.stringify({ heute: '2099-01-01' }), headers: { 'content-type': 'application/json' } });
    expect(await r.json()).toEqual({ antwort: { sitzungId: 's', text: 'Guten Morgen', steuerung: [], chips: [] } });
    const leer = await app.request('/morgen', { method: 'POST', body: JSON.stringify({ heute: '2099-01-02' }), headers: { 'content-type': 'application/json' } });
    expect(await leer.json()).toEqual({ antwort: null });
  });
```

- [ ] **Step 2: Run** `npx vitest run test/hono.test.ts` — FAIL (404).

- [ ] **Step 3: Implement** in `hono.ts` nach `/entscheidung`:

```ts
  app.post('/morgen', async (c) => {
    const e = await json(c, z.object({ heute: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
    if (e instanceof Response) return e;
    return c.json({ antwort: await kern.morgen(nutzerAus(c)!, e.heute) });
  });
```

- [ ] **Step 4: Run** alle Kern-Tests + `tsc` — grün.
- [ ] **Step 5: Commit** `git commit -m "cosai-kern: Route POST /morgen"`

---

### Task 3: Paket — `Lernen`, `FeldVorschlaege`, `heuteLokal`

**Files:** Create `packages/cosai-agentmode/src/lernen.tsx`; modify `src/index.ts`, `src/agentmode.css`; test `packages/cosai-agentmode/test/lernen.test.tsx`

- [ ] **Step 1: Failing test** `test/lernen.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { melden } from '../src/kanal.ts';
import { FeldVorschlaege, heuteLokal, Lernen } from '../src/lernen.tsx';

const antwort = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Lernen', () => {
  it('schickt nur gespeicherte Meldungen an den Kern — Klicks nicht', async () => {
    const aufrufe: { pfad: string; body: unknown }[] = [];
    const anfrage = async (pfad: string, init?: RequestInit) => { aufrufe.push({ pfad, body: JSON.parse(String(init?.body)) }); return antwort({ ok: true }); };
    render(<><Lernen api="/api/agent" anfrage={anfrage} /><button data-agent="deal.kommentar.senden">x</button></>);
    fireEvent.click(screen.getByText('x'));
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf Montag', kontext: { dealId: 'd1' } }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: '/api/agent/ereignis', body: { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf Montag', kontext: { dealId: 'd1' } } }]));
  });
});

describe('FeldVorschlaege', () => {
  it('zeigt die Formulierungen als Chips, ein Klick wählt, nach dem Speichern wird neu geladen', async () => {
    let liste = ['Mailbox besprochen', 'Rückruf Montag'];
    const pfade: string[] = [];
    const anfrage = async (pfad: string) => { pfade.push(pfad); return antwort({ vorschlaege: liste }); };
    const gewaehlt: string[] = [];
    render(<FeldVorschlaege api="/api/agent" anfrage={anfrage} ziel="deal.kommentar" waehlen={(t) => gewaehlt.push(t)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rückruf Montag' }));
    expect(gewaehlt).toEqual(['Rückruf Montag']);
    expect(pfade[0]).toBe('/api/agent/vorschlaege?ziel=deal.kommentar');
    liste = ['Neu gelernt'];
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Neu gelernt' }));
    expect(await screen.findByRole('button', { name: 'Neu gelernt' })).toBeTruthy();
  });

  it('zeigt nichts ohne Vorschläge', async () => {
    const { container } = render(<FeldVorschlaege api="/api/agent" anfrage={async () => antwort({ vorschlaege: [] })} ziel="deal.kommentar" waehlen={() => undefined} />);
    await waitFor(() => expect(container.querySelector('.am-feldvorschlaege')).toBeNull());
  });

  it('heuteLokal liefert das lokale Datum als JJJJ-MM-TT', () => {
    expect(heuteLokal(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07');
  });
});
```

- [ ] **Step 2: Run** `cd packages/cosai-agentmode && npx vitest run test/lernen.test.tsx` — FAIL (Modul fehlt).

- [ ] **Step 3: Implement** `src/lernen.tsx`:

```tsx
/**
 * Lernen ohne Overlay: `Lernen` hängt immer in der App und meldet gespeicherte Eingaben an den Kern — daraus werden
 * Formulierungen und Episoden (sichtbar und löschbar in der Gedächtnis-Leiste). `FeldVorschlaege` zeigt die häufigsten
 * Formulierungen eines Ziels als Chips direkt am Feld; ein Klick füllt nur, abschicken tut der Nutzer.
 */
import { useCallback, useEffect, useState } from 'react';
import { beobachten, type Beobachtung } from './kanal.ts';

export type Anfrage = (pfad: string, init?: RequestInit) => Promise<Response>;

/** Das lokale Datum des Nutzers (nicht UTC) — der „Tag“ des Morgenvorschlags. */
export function heuteLokal(jetzt = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`;
}

export function Lernen({ api, anfrage }: { api: string; anfrage: Anfrage }) {
  useEffect(() => beobachten((b: Beobachtung) => {
    if (b.art !== 'gespeichert') return;
    void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, kontext: b.kontext ?? {} }) }).catch(() => undefined);
  }), [anfrage, api]);
  return null;
}

export function FeldVorschlaege({ api, anfrage, ziel, waehlen, anzahl = 5 }: { api: string; anfrage: Anfrage; ziel: string; waehlen: (text: string) => void; anzahl?: number }) {
  const [liste, setListe] = useState<string[]>([]);
  const laden = useCallback(() => {
    anfrage(`${api}/vorschlaege?ziel=${encodeURIComponent(ziel)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { vorschlaege: string[] }).vorschlaege : []))
      .then((v) => setListe(v.slice(0, anzahl)))
      .catch(() => setListe([]));
  }, [anfrage, api, ziel, anzahl]);
  useEffect(laden, [laden]);
  // Nach dem Speichern an diesem Ziel neu laden — der Kern hat dann mitgezählt (kurz warten, er schreibt asynchron)
  useEffect(() => beobachten((b) => { if (b.art === 'gespeichert' && b.ziel === ziel) window.setTimeout(laden, 300); }), [laden, ziel]);
  if (!liste.length) return null;
  return (
    <div className="am-feldvorschlaege" role="group" aria-label="Vorschläge aus dem Gedächtnis">
      {liste.map((t) => (
        <button key={t} type="button" className="am-chip" data-art="vorschlag" title={t} onClick={() => waehlen(t)}>{t}</button>
      ))}
    </div>
  );
}
```

`src/index.ts`: `export * from './lernen.tsx';`
`src/agentmode.css` ergänzen:
```css
.am-feldvorschlaege { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
.am-feldvorschlaege .am-chip { max-width: 28ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: Run** Paket-Tests + `npx tsc -p tsconfig.json` — grün. (Im Test mit `setTimeout(…, 300)`: `findByRole` wartet bis 1 s — reicht.)
- [ ] **Step 5: Commit** `git commit -m "cosai-agentmode: Lernen ohne Overlay, Vorschläge am Feld"`

---

### Task 4: `AgentMode` — kein `gespeichert` mehr, Morgenvorschlag beim Öffnen

**Files:** Modify `packages/cosai-agentmode/src/AgentMode.tsx`; test `packages/cosai-agentmode/test/agentmode.test.tsx`

- [ ] **Step 1: Failing tests** in `agentmode.test.tsx`:
  - im `kernErsatz` eine Antwort für `/api/agent/morgen` ergänzen: `if (pfad === '/api/agent/morgen') return antwort({ antwort: morgen });` mit `let morgen: unknown = null;` und einer Rückgabe `setzeMorgen(m)`;
  - neuer Test:

```tsx
  it('zeigt beim Öffnen den Morgenvorschlag — ohne dessen Steuerung auszuführen', async () => {
    const k = kernErsatz();
    k.setzeMorgen({ sitzungId: 'm1', text: 'Heute sind 3 Deals fällig.', steuerung: [{ art: 'oeffne', ziel: 'deal.reiter.kommunikation' }], chips: [{ label: 'Ersten Deal öffnen', wert: 'Öffne den ersten Deal' }] });
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={() => undefined} ort="/" stil="kern" />);
    expect(await screen.findByText('Heute sind 3 Deals fällig.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ersten Deal öffnen' })).toBeTruthy();
    const m = k.aufrufe.find((a) => a.pfad === '/api/agent/morgen');
    expect((m?.body as { heute: string }).heute).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/ereignis')).toBe(false);
  });

  it('meldet gespeicherte Eingaben nicht selbst — das macht <Lernen>', async () => {
    const k = kernErsatz();
    render(<AgentMode api="/api/agent" anfrage={k.anfrage} modus="seite" navigiere={() => undefined} ort="/" stil="kern" />);
    act(() => melden({ art: 'gespeichert', ziel: 'deal.kommentar', wert: 'x' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(k.aufrufe.some((a) => a.pfad === '/api/agent/ereignis')).toBe(false);
  });
```
(`import { melden } from '../src/kanal.ts';` ergänzen.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `AgentMode.tsx`:
  - Beobachtungs-Effekt: `if (b.art === 'gespeichert') return;` als erste Zeile im Callback; Kommentar anpassen („gespeicherte Eingaben meldet `<Lernen>`, auch ohne Overlay“).
  - Im Effekt „Beim Öffnen“ nach dem Verlauf (im `.then((d) => …)`, nur wenn `!d?.wartetAuf`): 

```ts
        if (d.wartetAuf) return;
        // Einmal am Tag: der Morgenvorschlag — nur lesend, Steuerungen daraus werden nicht ausgeführt
        return anfrage(`${api}/morgen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ heute: heuteLokal() }) })
          .then(async (r) => (r.ok ? ((await r.json()) as { antwort: AgentAntwortDaten | null }).antwort : null))
          .then((m) => {
            if (!aktiv || !m) return;
            sitzungMerken(m.sitzungId);
            zeile('agent', m.text);
            setChips(m.chips);
          });
```
    (Struktur des bestehenden Effekts beibehalten: der `wartetAuf`-Zweig bleibt, der Morgenvorschlag kommt danach; `heuteLokal` aus `./lernen.tsx` importieren. Auch wenn `d` leer ist oder kein Verlauf besteht, soll der Morgenvorschlag laufen — die frühe `return`-Stelle `if (!d.verlauf.length) return;` so umbauen, dass danach der Morgen-Aufruf erreicht wird.)

- [ ] **Step 4: Run** Paket-Tests + `tsc` — grün.
- [ ] **Step 5: Commit** `git commit -m "cosai-agentmode: Morgenvorschlag beim Öffnen; gespeichert meldet nur noch <Lernen>"`

---

### Task 5: gg-immo — `<Lernen>` im Rahmen, Vorschläge an der Notiz

**Files:** Modify `apps/web/src/components/AppRahmen.tsx`, `apps/web/src/components/deal/DealKommunikation.tsx`

- [ ] **Step 1: AppRahmen** — Import `import { Lernen } from '@cosai/agentmode';` und `import { agentAnfrage } from '../lib/api.ts';` (falls nicht vorhanden); direkt vor der Zeile mit `agentOverlay ? <AgentModeHost …` einfügen:

```tsx
        {/* Lernen auch ohne Overlay (Entscheidung 26.09.): gespeicherte Notizen werden zu Vorschlägen */}
        {agentVerfuegbar && <Lernen api="/api/agent" anfrage={agentAnfrage} />}
```

- [ ] **Step 2: DealKommunikation** — in `Kommentare` unter der `<Group>` mit Textarea und Knopf:

```tsx
      {agentVerfuegbar && <FeldVorschlaege api="/api/agent" anfrage={agentAnfrage} ziel="deal.kommentar" waehlen={setText} />}
```
mit `const agentVerfuegbar = useAgentVerfuegbar().data === true;` und Imports `FeldVorschlaege` aus `@cosai/agentmode`, `useAgentVerfuegbar` aus `../../agent/agent.tsx`, `agentAnfrage` aus `../../lib/api.ts`.

- [ ] **Step 3: Run** `pnpm --filter @gg/web typecheck && pnpm --filter @gg/web test` — grün (Kartentest unverändert, die Chips tragen keine `data-agent`-Marke).
- [ ] **Step 4: Commit** `git commit -m "gg-immo: Lernen immer, Vorschläge unter der Gesprächsnotiz"`

---

### Task 6: Klicktests

**Files:** Modify `tests/e2e/agentmode.spec.ts`

- [ ] **Step 1: Tests ergänzen** (Hilfen `faelligerDeal`, `notiz`, `afterEach` bestehen schon):

```ts
  test('lernt ohne Overlay und schlägt die Formulierung am Feld vor', async ({ page }) => {
    const erster = await faelligerDeal(page, `Agent-Lernen ${Date.now()}`);
    const zweiter = await faelligerDeal(page, `Agent-Vorschlag ${Date.now()}`);
    const text = notiz();
    await page.goto('/');
    await page.getByLabel(`Deal ${erster.titel}`).click();
    await page.getByLabel('Neue Gesprächsnotiz').fill(text);
    await page.getByRole('button', { name: '+ Eintrag' }).click();
    await expect.poll(async () => ((await (await page.request.get('/api/agent/vorschlaege?ziel=deal.kommentar')).json()) as { vorschlaege: string[] }).vorschlaege, { timeout: 10_000 }).toContain(text);

    await page.getByLabel(`Deal ${zweiter.titel}`).click();
    const vorschlaege = page.getByRole('group', { name: 'Vorschläge aus dem Gedächtnis' });
    await vorschlaege.getByRole('button', { name: text }).click();
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toHaveValue(text);
  });

  test('begrüßt am ersten Öffnen des Tages mit dem Morgenvorschlag, danach nicht mehr', async ({ page }) => {
    // Ein Tag, den es für diesen Nutzer noch nicht gab
    await page.clock.setFixedTime(new Date(2090, 0, 1 + Math.floor(Math.random() * 300), 9, 0));
    await page.goto('/agent');
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText(/Heute sind \d+ Deals/, { timeout: 15_000 });
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText(/Heute sind \d+ Deals/);
    const n = await page.getByText(/Heute sind \d+ Deals/).count();
    expect(n).toBeLessThanOrEqual(2); // Verlauf zeigt ihn einmal, kein zweiter Aufruf
  });
```
(Das zweite `toContainText` prüft, dass der Verlauf ihn aus der Sitzung zeigt; die Zählung deckt „kein zweiter Morgenvorschlag“ ab — oben in der Blase und im Gespräch der Seite steht derselbe Text je einmal.)

- [ ] **Step 2: Run** (Attrappe nötig — `.env` auf `KI_ATTRAPPE=1`, API neu laden) `npx playwright test tests/e2e/agentmode.spec.ts` — grün; danach `.env` zurück auf `KI_ATTRAPPE=0`.
- [ ] **Step 3: Commit** `git commit -m "Klicktests: Lernen ohne Overlay, Vorschlag am Feld, Morgenvorschlag"`

---

### Task 7: Doku und Prüfung

- [ ] `README.md`, Abschnitt „AgentMode“: zwei Sätze zu `<Lernen>` (immer eingebunden, nur `gespeichert`) und `<FeldVorschlaege>` (unter der Gesprächsnotiz) und zum Morgenvorschlag (einmal je Tag, nur lesend, `POST /api/agent/morgen`).
- [ ] `OFFEN.md`: Lieferung 2a abhaken, 2b Routinen offen.
- [ ] `pnpm verify` (bekannte 9+3 Umgebungsfehler), Klicktests Agent 8/8.
- [ ] Mit echtem Modell (Dev, `KI_ATTRAPPE=0`) einmal `/agent` öffnen: Morgenvorschlag nennt die richtigen Zahlen.
- [ ] Commit `git commit -m "AgentMode Lieferung 2a: Doku"`
