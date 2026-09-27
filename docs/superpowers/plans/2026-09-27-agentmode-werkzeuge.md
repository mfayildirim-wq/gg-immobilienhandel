# AgentMode: Websuche, MCP-Server, Werkzeugliste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Der Agent recherchiert im Web („mache eine Websuche zu diesem Objekt, Lage, vergleichbare Angebote“), und in den Einstellungen lassen sich MCP-Server (z. B. Mail, SharePoint) über ihre Internet-Adresse anbinden. Alle Werkzeuge stehen mit ihren Rechten auf der Einstellungsseite.

**Entscheidungen des Auftraggebers (27.09.):** Websuche „beides, automatisch“ (Claude-Websuche bei Anthropic, sonst die vorhandene DuckDuckGo/News-Suche; dazu „Seite lesen“) · MCP nur über Internet-Adresse (läuft auch auf Vercel) · alle Werkzeuge auf der Einstellungsseite auflisten. Rechte (Annahme, da offen gelassen): **jedes MCP-Werkzeug braucht das „Ja“**; einzelne lassen sich als „ohne Rückfrage“ freigeben.

**Architecture:**
- **Web:** Kern-Option `web: { suche, lesen, claudeSuche }`. Werkzeuge `websuche` (Host: DuckDuckGo + Google-News aus `@gg/integrations`) und `seite_lesen` (Host: nur öffentliche http(s)-Adressen, Text gekürzt). Mit Anthropic zusätzlich das Server-Werkzeug `web_search_20260209` (max. 5 Suchen je Antwort); LangChain führt `server_tool_use` nicht als Werkzeugaufruf — es bleibt im Inhalt und wird zurückgegeben. Alles lesend, auch im Morgenlauf erlaubt.
- **MCP:** `@modelcontextprotocol/sdk` (Client, Streamable HTTP, Rückfall SSE). Server in der DNA (`mcp: [{ name, url, kopf, aktiv }]`, `kopf` verschlüsselt über eine Host-Funktion), Freigaben `frei: string[]`. Werkzeuge heißen `mcp_<server>_<werkzeug>`; ohne Freigabe `interrupt` mit Frage und Argumenten → nur nach „Ja“ ausgeführt; im Morgenlauf nur freigegebene. Werkzeuglisten je Server 60 s zwischengespeichert, Verbindung mit Zeitgrenze.
- **Werkzeugliste:** `GET /werkzeuge` (Name, Beschreibung, Quelle app/agent/web/mcp, Recht lesen/fragt/frei); `PUT /werkzeuge/frei` (nur MCP); `POST /mcp` (Server hinzufügen, Verbindung prüfen), `DELETE /mcp/:name`.
- **Web-UI:** Einstellungen → AgentMode: Abschnitte „Werkzeuge“ und „MCP-Server“.

## Tasks
1. Kern: `websuche`, `seite_lesen`, Claude-Websuche beim Binden (Test mit Drehbuch; Test, dass das Server-Werkzeug nur bei Anthropic gebunden wird).
2. Host: Suche + Seite lesen mit Adressprüfung; Test der Adressprüfung.
3. Kern: MCP-Client, Werkzeuge mit Rückfrage/Freigabe; Test gegen einen echten MCP-Server im Test (Streamable HTTP).
4. Routen `/werkzeuge`, `/mcp`; Tests.
5. Web: Werkzeugliste und MCP-Server in den Einstellungen; Klicktest.
6. Echt prüfen: Websuche zu einem Objekt mit dem echten Modell. Doku.
