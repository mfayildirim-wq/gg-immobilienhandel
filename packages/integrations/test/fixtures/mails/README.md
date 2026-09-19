# Beispielmails für die Triage

Acht echte Angebotsmails, wie sie der Katalog in
`docs/EXPOSE-MAIL-IMPORT-ANFORDERUNGEN.md`, Abschnitt 3, beschreibt. Sie sind
das Abnahmekriterium A1 in `server/expose-triage.test.ts`.

## Sie sind anonymisiert — und müssen es bleiben

Aufbau, Formulierungen, Anhänge, Links und Objektdaten stammen unverändert aus
den Originalen; nur die **natürlichen Personen** sind ersetzt: Namen,
persönliche E-Mail-Adressen, Durchwahlen, Mobilnummern, dazu die Adresse einer
privaten Verkäuferin in `05.json`. Erfunden sind auch die zwei Maklerbüros, die
nach ihren Inhabern heißen.

Der Grund ist der Umlauf: ein Git-Repo wird geklont, und jeder Klon trägt die
Historie mit. Ein Name, der einmal drinsteht, ist auch nach dem Löschen noch in
jedem älteren Commit.

**Was absichtlich echt bleibt**, sind die Firmen und Portal-Domains —
`fio.de`, `fioport.de`, `garant-immo.de`, `immobilienscout24.de`,
`deutsche-bank-immobilien.de`, `landingpage.immobilien`. Sie stehen als
Erlaubnisliste in `server/outward-gate.ts`, und der Kommentar dort nennt diese
Dateien als Herkunft. Mit ausgetauschten Domains ginge dieser Bezug verloren.

Kommt eine neunte Beispielmail dazu: **vor dem Commit anonymisieren**, nicht
danach.
