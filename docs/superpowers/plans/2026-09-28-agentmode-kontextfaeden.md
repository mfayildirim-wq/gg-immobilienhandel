# AgentMode: Tagesbeginn, Gesprächsfäden je Bereich, roter Kreis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Wünsche des Auftraggebers (28.09.):**
1. Beim ersten Öffnen am Tag nicht die letzte Zeile von gestern zeigen, sondern kurz fragen: **dort weitermachen** oder
   **zusammenfassen, was heute ansteht** (Todos, Möglichkeiten).
2. **Kontext je Bereich:** wechselt der Nutzer (oder der Agent) z. B. von Ankauf zu Deals, fragt der Agent, was er dort
   tun kann; zurück im Ankauf fragt er, ob er dort weitermachen oder neu anfangen soll. Das Verhalten läuft über CoSAi.
3. **Overlay geschlossen:** oben in der Mitte ein kleiner **roter Agent-Kreis**; ein Klick öffnet das Overlay.

**Architecture (alles in CoSAi, ohne Modellaufruf — schnell, kostet nichts, handelt nicht von sich aus):**
- **Faden = Sitzung je Bereich.** Der Bereich ist der erste Teil des Pfads (`/`, `/deals`, `/makler` …); sein Name kommt
  aus der Oberflächenkarte (`nav.*`-Ziel mit dieser `seite`). LangGraph hält den Verlauf je Faden (Checkpointer) — das
  „Gedächtnis“ des Gesprächs; das Gedächtnis über Fäden hinweg bleibt `cosai.gedaechtnis`.
- `POST /kontext { ort, heute }` → `{ art, sitzungId, text, chips }`:
  - `tagesbeginn` (erster Aufruf des Tages, Merker `ereignisse.art='tag'`): „Guten Morgen! Zuletzt bei *Ankauf*: „…“ —
    dort weitermachen, oder soll ich zusammenfassen, was heute ansteht?“ → Chips *Weitermachen*, *Heute zusammenfassen*,
    *Neu beginnen*.
  - `fortsetzen` (im Bereich gibt es einen Faden): „Hier bei *Deals* waren wir bei: „…“ — weitermachen oder neu?“
  - `neu` (kein Faden im Bereich): „Du bist bei *Deals*. Hier kann ich zum Beispiel: …“ → Chips aus den Zielen der Seite.
- Chips der Art `kontext` wertet die Oberfläche selbst aus (keine Nachricht an das Modell): `weiter:<sitzungId>` lädt den
  Faden, `neu` beginnt einen neuen, `morgen` fragt die Tageszusammenfassung an (`POST /morgen`, nur lesend — nicht mehr
  automatisch beim Öffnen).
- **Navigation während der Agent arbeitet** unterbricht nicht: der Faden läuft mit. Ist der Agent fertig und hat der Ort
  gewechselt, zeigt er ohne Rückfrage an das Modell, was er im neuen Bereich tun kann.
- **Roter Kreis:** `<AgentKnopf>` in `@cosai/agentmode` (Sprechkreis klein, rot), im Host oben mittig, wenn das Overlay
  aus ist.

## Tasks
1. Kern: Bereich aus Ort, `kontext()` mit den drei Fällen, Merker „tag“; Routen; Tests (drei Fälle, Tageswechsel, Faden je Bereich).
2. Oberfläche: `POST /kontext` beim Öffnen und bei Ortswechsel (nur im Leerlauf), Chips `kontext`; Morgenlauf nur auf Wunsch; Tests.
3. Roter Kreis: Komponente + Einbau im `AppRahmen`; Test.
4. Klicktests: Tagesbeginn, Wechsel Ankauf → Deals → Ankauf; Doku, Protokoll.
