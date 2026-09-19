# CLAUDE.md · gg-immobilienhandel (Neubau)

Lies zuerst `README.md`. Fachlicher und architektonischer Hintergrund: `../protokoll/AGENTS.md` → Dokumente 07, 08, 09, 10, 11.

## Regeln

- **Charta:** Die 8 Bedienabläufe der alten App bleiben bedienbar (`../protokoll/memory/workflow-charta-unantastbar.md`). Das neue Design (Seitenleiste, Wählmaschine als Schubfach, Layout-Umschaltung) ist gewollt.
- **Ist-Verhalten:** Solange die Fachfragen in `../protokoll/11-fragebogen-fachfragen.md` offen sind, das Verhalten der alten App nachbauen. Entscheidungen ändern **Regel und Test gemeinsam**.
- **Schichten:** Fachregeln nur in `packages/domain` (mit Test). Routen sind dünn, Logik gehört in `apps/api/src/services`. Kein SQL in Routen, keine Fachlogik in React-Komponenten.
- **Schema:** nur über `packages/db/src/schema.ts` + `pnpm db:generate`; Migrationen nie von Hand nachträglich ändern.
- **Rechenkerne:** Ankaufs- und Kundenkalkulation rechnen nachweislich wie die alte App (Golden Master in `packages/domain/test/golden/`); das Bankgespräch (Vorlage + Payload) ebenso (`packages/documents/test/golden/`). Nichts „verbessern“, was ein Golden-Master-Ergebnis ändert, ohne Fachentscheidung. Gerechnet wird nur in `@gg/domain`; Web (Live-Anzeige) und API (gespeicherte Kennzahlen) nutzen dieselbe Funktion.
- **Parallelprüfung:** Fachfunktionen werden nicht nur per Golden Master, sondern gegen die **laufende alte App** geprüft (`pnpm paritaet`, `tests/paritaet/`). Jede neu übernommene Fachfunktion bekommt dort einen Vergleich. Abweichungen sind Befunde: angleichen (Ist-Verhalten) oder als bewusste Korrektur dokumentieren.
- **Umzug:** Jede neue Tabelle, die Altdaten bekommt, braucht Umformung + Prüfung im Bericht + Test mit Altformaten (`packages/umzug/test/altbestand.ts`). Zuerst `pnpm umzug:probe`.
- **Statuswechsel** immer über den Service (schreibt `deal_status_historie`, prüft `version`).
- **Hosting:** Supabase + Vercel (vorerst). Speicherzugriffe trotzdem hinter Adaptern halten.
- **Alte App** (`../gg-immohandel`) nicht verändern; deren `CLAUDE.md` gilt dort (kein Push auf main, Merge nur durch Jonas).
- **Keine Secrets** lesen oder ausgeben (`.env`, Schlüssel).

## Vor jedem Abschluss

`pnpm verify` grün, bei UI-Änderungen zusätzlich `pnpm e2e`, bei Fachfunktionen zusätzlich `pnpm paritaet` (alte App muss laufen).
