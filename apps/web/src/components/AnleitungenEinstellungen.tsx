import { Accordion, Anchor, Code, List, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

const adresse = () => (typeof location !== 'undefined' ? location.origin : '');

/**
 * 📖 Anleitungen (Einstellungen). Inhaltlich aus den Bedienungsanleitungen der alten App
 * (settings.ts), auf die Wege des Neubaus gebracht.
 */
const ANLEITUNGEN: { wert: string; titel: string; inhalt: ReactNode }[] = [
  {
    wert: 'adresse',
    titel: '🌐 Unter welcher Adresse läuft die App?',
    inhalt: (
      <>
        <Text size="sm">Eine Adresse, überall dieselbe:</Text>
        <Code block data-app-adresse>{adresse()}</Code>
        <Text size="sm" mt={6}>
          Als Lesezeichen auf iPad und Mac ablegen. Es gibt keine zweite Adresse für unterwegs und keine VPN-Verbindung,
          die vorher stehen muss — die App läuft im Netz, nicht auf einem Rechner bei dir.
        </Text>
      </>
    ),
  },
  {
    wert: 'anrufe',
    titel: '📞 Eingehende Anrufe über den iOS-Kurzbefehl',
    inhalt: (
      <>
        <Text size="sm">Damit beim Klingeln automatisch das Anruf-Briefing erscheint:</Text>
        <List size="sm" type="ordered" mt={6}>
          <List.Item>iPhone → Kurzbefehle → „Automation“ → ➕ → „Persönliche Automation“</List.Item>
          <List.Item>Auslöser „Anruf empfangen“ → „Beliebiger Anrufer“</List.Item>
          <List.Item>Aktionen: „Anrufer abrufen“ → „Telefonnummer abrufen aus Anrufer“</List.Item>
          <List.Item>„Text“ mit Inhalt <Code>{adresse()}/?incoming=</Code> + Variable Telefonnummer</List.Item>
          <List.Item>„URL öffnen“ mit diesem Text; „Vor Ausführung fragen“ ausschalten</List.Item>
        </List>
        <Text size="sm" mt={6}>
          Bekannter Makler: das Briefing öffnet sich mit Verlauf, Anlässen und Gesprächsöffner. Unbekannte Nummer:
          die App zeigt sie im Cockpit an, damit du den Makler anlegen kannst. Gefunden wird auch bei abweichender
          Schreibweise (0049, +49, führende 0).
        </Text>
      </>
    ),
  },
  {
    wert: 'waehlmaschine',
    titel: '🚀 Wählmaschine',
    inhalt: (
      <Text size="sm">
        „📞 Deals durchwählen“ neben „Nächste Kontakte“ telefoniert die Liste „Deals nachverfolgen“ von oben nach unten
        ab: heute, überfällig, diese Woche — je Halt der Makler des Deals; das Ergebnis (Erreicht, Nicht erreicht, Rückruf,
        Notiz, Frequenz) wird am Deal gebucht. „Makler durchwählen“ im Schubfach „Makler kontaktieren“ macht dasselbe mit
        der Makler-Liste, gebucht am Makler; ein vereinbarter Rückruf zählt dort als Termin (Entscheidung vom 22.09.2026).
      </Text>
    ),
  },
  {
    wert: 'zugaenge',
    titel: '🔑 API-Schlüssel setzen',
    inhalt: (
      <Text size="sm">
        Unter <b>Einstellungen → Zugänge</b>. Der Schlüssel wird verschlüsselt gespeichert und nur maskiert angezeigt;
        er hat Vorrang vor der Umgebungsvariable. Ohne Anthropic-Schlüssel laufen Exposé-Analyse, Makler-KI und
        Einheiten-Erkennung nicht; ohne OpenAI-Schlüssel keine Transkription. Lokal geht auch <Code>KI_ATTRAPPE=1</Code> —
        dann antwortet die KI erkennbar im Test-Modus.
      </Text>
    ),
  },
  {
    wert: 'sicherung',
    titel: '💾 Sicherung und Wiederherstellung',
    inhalt: (
      <>
        <Text size="sm">
          Unter <b>Einstellungen → Sicherung</b>: „Sicherung herunterladen“ legt den ganzen Datenbestand als JSON-Datei ab.
          Zum Zurückholen die Datei einlesen — die App zeigt erst einen Plan (neu/aktualisiert je Tabelle) und schreibt erst
          nach Bestätigung. Es wird nichts gelöscht, vorhandene Zeilen werden auf den Stand der Sicherung gebracht.
        </Text>
        <Text size="sm" mt={6}>
          Fotos und Dokumente liegen im Speicher (Supabase Storage) und werden dort gesichert; ihre Zeilen samt Schlüssel
          sind Teil der Sicherung. Zugangsdaten und das Audit-Log sind bewusst nicht enthalten.
        </Text>
      </>
    ),
  },
  {
    wert: 'papierkorb',
    titel: '🗑 Papierkorb',
    inhalt: (
      <Text size="sm">
        Gelöschtes bleibt 30 Tage liegen: <b>Einstellungen → Papierkorb</b> zeigt es nach Bereichen, mit Restlaufzeit,
        „Wiederherstellen“ und „Endgültig“. Beim Öffnen räumt die App auf, was älter als 30 Tage ist — bei Deals samt Dateien.
      </Text>
    ),
  },
  {
    wert: 'dubletten',
    titel: '🔗 Dubletten zusammenführen',
    inhalt: (
      <>
        <Text size="sm">
          <b>Einstellungen → Dubletten</b> sucht Makler (gleiche E-Mail, gleiche Telefonnummer, ähnlicher Name),
          Objekte (gleiche Adresse mit Tippfehlertoleranz) und Deals (gleiche Objekt+Makler-Kombination).
        </Text>
        <List size="sm" mt={6}>
          <List.Item>„Vergleichen & Zusammenführen“ zeigt Konfliktfelder — pro Feld entscheidest du A oder B.</List.Item>
          <List.Item>Listen (Einheiten, Kalkulation, Persönliches) behältst du von A, von B oder vereinst sie.</List.Item>
          <List.Item>Der behaltene Eintrag behält seine Kennung; Deals, Projekte und Dateien hängen um.</List.Item>
          <List.Item>Das Duplikat landet im Papierkorb, das Zusammenführen ist 24 Stunden rückgängig zu machen.</List.Item>
        </List>
      </>
    ),
  },
  {
    wert: 'varianten',
    titel: '📸 Kalkulationsvarianten',
    inhalt: (
      <Text size="sm">
        Im Deal unter „Kalkulation“: „💾 Aktuelle speichern als…“ legt eine Momentaufnahme von Kalkulation, Einheiten und
        Sanierung an — auch von ungespeicherten Werten. „Variante laden“ überschreibt die aktuelle Kalkulation nach Rückfrage;
        gespeichert wird erst mit „Kalkulation speichern“.
      </Text>
    ),
  },
  {
    wert: 'kalkulation',
    titel: '🧮 Standardwerte der Kalkulation',
    inhalt: (
      <Text size="sm">
        <b>Einstellungen → Kalkulation</b> setzt die Vorbelegung für neue Deals (Notar, Grunderwerbsteuer, Provision, FK/EK,
        Euribor, Marge, Haltedauer, Risikopuffer, Zielrendite). Leere Felder im Deal rechnen mit diesen Werten — schon
        gespeicherte Deals bleiben unberührt.
      </Text>
    ),
  },
  {
    wert: 'audit',
    titel: '📜 Audit-Log',
    inhalt: (
      <Text size="sm">
        <b>Einstellungen → Audit-Log</b>: jede Änderung an Dokumenten, jeder KI-Aufruf mit Kosten, jeder PDF-Export und jedes
        Zusammenführen. Filter nach Typ, Entität und Zeitraum, Suche in Werten und Metadaten, Export als JSON oder CSV.
        „Hash-Kette prüfen“ rechnet die Verkettung nach: jede nachträgliche Änderung und jede Lücke fällt auf.
        „Älter als 180 Tage löschen“ hinterlässt einen Anker, damit die Prüfung danach weiterrechnen kann.
      </Text>
    ),
  },
  {
    wert: 'import',
    titel: '📊 Makler aus einer Tabelle importieren',
    inhalt: (
      <Text size="sm">
        <b>Einstellungen → Sicherung → Makler aus Tabelle importieren</b>: .xlsx oder .xls auswählen, die Spalten werden
        anhand der Überschriften erkannt (Name, Firma, Telefon, E-Mail, Prio, Frequenz, Adresse, Stadt, Notizen). Die Vorschau
        zeigt die ersten Zeilen; übernommen werden nur Zeilen mit Namen und unbekannter E-Mail.
      </Text>
    ),
  },
  {
    wert: 'offen',
    titel: '🚧 Was noch fehlt',
    inhalt: (
      <Text size="sm">
        Noch nicht im Neubau: Posteingang und Auto-Import von Exposé-Mails über Microsoft 365, die Propstack-Bewertung je
        Einheit und die MCP-Freigaben. Der Stand steht in <Code>protokoll/sessions/2026-09-17-restliste-neubau.md</Code>.
      </Text>
    ),
  },
];

export function AnleitungenEinstellungen() {
  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>📖 Anleitungen</Title>
        <Text size="xs" c="dimmed">Einrichtungsschritte und Abläufe, die man selten braucht. Aufklappen mit ▸.</Text>
      </div>
      <Accordion variant="separated">
        {ANLEITUNGEN.map((a) => (
          <Accordion.Item key={a.wert} value={a.wert}>
            <Accordion.Control>{a.titel}</Accordion.Control>
            <Accordion.Panel>{a.inhalt}</Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Text size="xs" c="dimmed">
        Fachliche Hintergründe stehen im <Anchor href="https://github.com" onClick={(e) => e.preventDefault()}>Protokoll</Anchor> des Projekts
        (Ordner <Code>protokoll/</Code>), die technische Übersicht in der <Code>README.md</Code>.
      </Text>
    </Stack>
  );
}
