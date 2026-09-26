# AgentMode Lieferung 2b: Routinen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Der Agent erkennt wiederkehrende Abläufe des Nutzers (z. B. Notiz, dann „Erledigt“ im selben Deal) und bietet sie als ▶-Chip an; ein Klick startet den Ablauf, jedes Senden wird einzeln bestätigt.

**Architecture:** Erkennung als reine Funktion `routinenAus(episoden)` in `@cosai/kern` (ohne DB testbar). Der Kern rechnet nach jedem `gespeichert` neu und legt Routinen als Gedächtnis-Einträge `art = 'routine'` ab (sichtbar, löschbar). Löschen setzt einen Merker (`ereignisse.art = 'routine-geloescht'`); gezählt wird danach nur, was nach dem Löschen passiert. `GET /api/agent/routinen` liefert Label und Auftragstext; `AgentMode` zeigt ▶-Chips und schickt den Auftrag als Nachricht. Voraussetzung (erledigt, `1aba3f6`): nach „Ja“ läuft kein weiteres `sende` ungefragt mit.

Entscheidung des Auftraggebers (26.09.): Routinen als Ein-Klick-Ablauf, jeder Schritt wird weiter bestätigt.

## Regeln der Erkennung
- Episoden nach Kontext gruppiert (Kontext ohne `sitzungId`, z. B. `{dealId}`), zeitlich sortiert, Pausen > 30 min trennen Läufe.
- Aufeinanderfolgende gleiche Schritte zählen einmal; Folgen der Länge 2–3 aus einem Lauf zählen je Lauf einmal.
- Routine ab 3 Läufen; eine kürzere Folge entfällt, wenn eine längere sie enthält und mindestens so oft vorkommt.

## Tasks
1. `packages/cosai-kern/src/routinen.ts` + `test/routinen.test.ts`: `routinenAus(episoden, { mindestens = 3, pauseMin = 30 })` → `{ folge: string[]; anzahl: number }[]`, absteigend nach Anzahl.
2. `gedaechtnis.setze(art, schluessel, inhalt, haeufigkeit, kontext)` (Upsert mit fester Häufigkeit).
3. Kern: `routinenNeu(nutzer)` (nach `gespeichert`), `routinen(nutzer)` (Liste mit `label`, `auftrag`), `loeschen(nutzer, id)` (Routine → Merker). Label und Auftrag aus der Oberflächenkarte: Ziel = Schlüssel oder erstes Ziel mit Präfix `<schluessel>.`; Kurzname = Text in „…“ der Beschreibung, sonst der Schlüssel. Der Auftrag nennt die häufigste Formulierung als Vorschlag.
4. Routen: `GET /routinen`; `DELETE /gedaechtnis/:id` über `kern.loeschen`.
5. Attrappe: „Routine ausführen“ → `steuere` mit Füllen + Senden der Notiz + Senden „Erledigt“; nach „Noch nicht ausgeführt: […]“ die offenen Schritte erneut steuern.
6. `AgentMode`: Routinen beim Öffnen und nach jeder Antwort laden, ▶-Chips (`data-art="routine"`) neben den Chips; Klick → `nachricht(auftrag)`.
7. Klicktest: drei Abläufe Notiz → Erledigt in eigenen Deals erzeugen, ▶-Chip im vierten Deal, „Ja“ für die Notiz, „Ja“ für Erledigt, Notiz gespeichert und letzter Kontakt heute; danach Routine löschen.
8. README, OFFEN, Protokoll 20.
