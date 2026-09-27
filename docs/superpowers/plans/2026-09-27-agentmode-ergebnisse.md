# AgentMode: Ergebnisse (generisch, mit Bezug auf App-Objekte) und Dokumente der App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** KI-Ergebnisse (Recherche, Dokumentanalyse, Vergleich …) bleiben erhalten — generisch in CoSAi, mit Verweis auf beliebige Objekte der App (Deal, Makler, Objekt …) — und der Agent kann die Dateien der App lesen („analysiere die Mietdokumente dieses Deals“).

**Entscheidungen des Auftraggebers (27.09.):**
- Speichern nur nach „Ja“ („Als Ergebnis bei Deal … speichern?“).
- Generisch, unabhängig von der App-Datenbank: eigene Tabellen im Schema `cosai` + Zwischentabelle zu den App-Objekten (Typ + ID, keine Fremdschlüssel). In einer anderen App genauso.
- Quellen nur Daten und Dateien der App (kein Hochladen im Agenten).
- Oberfläche ganz in `@cosai/agentmode`: 🗂-Knopf im Block; Ergebnisse im **zweiten Bereich** des Blocks (statt Eingabe/Knöpfe), ⤢ als Dialog vergrößern, ✕ schließen → Knöpfe wieder da. Keine Seitenleiste.

**Architecture:**
- **Schema `cosai`:** `ergebnisse` (titel, art, inhalt, quellen jsonb, frage, werkzeuge jsonb, modell, nutzer, sitzung_id, created_at) und `ergebnis_bezuege` (ergebnis_id, typ, ref_id, bezeichnung). Sichtbar für alle Nutzer der App (Geschäftsdaten), `nutzer` = wer gespeichert hat.
- **Fokus statt fester Typen:** die App markiert die geöffnete Ansicht mit `data-agent-fokus='{"dealId":"…","deal":"Musterweg 1"}'`. Der AgentMode schickt den Fokus als Kontext; jeder Schlüssel `<typ>Id` wird ein Bezug (`typ`, `ref_id`), `<typ>` die Bezeichnung.
- **Werkzeuge im Kern:** `ergebnis_speichern` (fragt immer; Bezüge aus dem Kontext), `ergebnisse_lesen` (lesend). Routen `GET /ergebnisse?typ=&id=`, `GET /ergebnisse/zaehlen?typ=&id=`, `DELETE /ergebnisse/:id`.
- **Erweiterungspunkt `zusatzWerkzeuge`:** der Host gibt eigene lesende Werkzeuge mit. gg-immo: `dokument_lesen(dealId, dokumentId)` → `dokumentDatei` + `pdfText` (Text, gekürzt). Liste der Dateien über das vorhandene Lesewerkzeug der App.
- **Oberfläche:** 🗂 mit Anzahl zum Fokus; zweiter Bereich zeigt die Liste (Titel, Art, Datum; Klick klappt Inhalt und Quellen auf; Löschen); ⤢ Dialog; ✕ zurück.

## Tasks
1. Kern: Schema + Migration; `ergebnisse`-Modul (speichern, lesen, zählen, löschen); Werkzeuge; Routen; `zusatzWerkzeuge`; Tests.
2. Host: `data-agent-fokus` an Deal-, Makler-, Objekt-Detail; `dokument_lesen`; Migration lokal einspielen.
3. Oberfläche: Fokus sammeln, 🗂 mit Anzahl, Ergebnisbereich, Dialog; Tests.
4. Attrappe + Klicktest; echter Lauf („Lage analysieren“ → speichern → im 🗂 sehen); Doku.

**Hinweis:** Die Deal-Dateien liegen auf diesem Branch in `fach.deal_dokumente`; nach PR 11 (SharePoint) ändert sich nur der Host-Adapter von `dokument_lesen`.
