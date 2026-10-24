"""Die Schicht vor Mem0: Mandant und App aus dem Zugang, Freigaben, Ersetzen überholter Fakten, Protokoll.

Abbildung auf Mem0: Mandant = user_id, App = agent_id; Bezug (z. B. gg:makler:123), Art und Quelle als metadata.
Mem0 2.x legt nur an — überholte Einträge löst diese Schicht ab (Ablaufdatum statt Löschen, der Verlauf bleibt):
  • Ereignis (App, wörtlich, ohne KI): ersetzt den letzten Eintrag gleicher Art am selben Bezug.
  • Merken (KI-Extraktion): ein kleiner KI-Aufruf prüft die neuen Fakten gegen die KI-Einträge zum selben Bezug.
    App-Ereignisse sind maßgeblich: sie ersetzt nur ein neues Ereignis der App, nie ein KI-Fakt (24.10.2026 — sonst
    löste „nur per E-Mail kontaktieren“ die Telefonnummern aus gg ab).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import uuid
from typing import Any, Callable

from .zugang import Zugang, ZugangsFehler

Protokoll = Callable[[Zugang, str, dict], None]

PRUEF_PROMPT = (
    "Bestehende Einträge:\n{liste}\n\nNeue Fakten:\n{neu}\n\nWelche bestehenden Einträge sind durch die neuen Fakten "
    "überholt? Überholt ist ein Eintrag nur, wenn ein neuer Fakt genau dieselbe Angabe mit einem anderen Wert nennt "
    "(z. B. dieselbe Telefonnummer-Art mit neuer Nummer, derselbe Termin mit neuem Datum). Vorlieben, Ergänzungen und "
    'andere Angaben überholen nichts. Im Zweifel nichts. Antworte nur als JSON {{"ueberholt": [Nummern]}}.'
)


def _gestern() -> str:
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


def eintrag(x: dict) -> dict:
    meta = x.get("metadata") or {}
    return {
        "id": x["id"], "text": x.get("memory"), "app": x.get("agent_id"),
        "objekt": meta.get("objekt"), "art": meta.get("art"), "quelle": meta.get("quelle"), "von": meta.get("von"),
        "score": round(x["score"], 3) if x.get("score") is not None else None,
        "am": x.get("updated_at") or x.get("created_at"),
    }


class Gedaechtnis:
    def __init__(self, memory: Any, protokoll: Protokoll = lambda *_: None):
        self.m = memory
        self.protokoll = protokoll

    # ── Hilfen ──────────────────────────────────────────────

    def _schreibrecht(self, z: Zugang):
        if not z.schreiben:
            raise ZugangsFehler(403, f'Der Zugang "{z.label}" darf nur lesen.')

    def _apps(self, z: Zugang, apps: list[str] | None) -> list[str] | None:
        """Welche Apps eine Suche sehen darf. None = alle Apps des Mandanten (nur mit Freigabe „*“)."""
        if apps:
            verboten = [a for a in apps if not z.darf_lesen(a)]
            if verboten:
                raise ZugangsFehler(403, f'Der Zugang "{z.label}" darf {", ".join(verboten)} nicht lesen.')
            return apps
        if "*" in z.lesen:
            return None
        return [z.app, *[a for a in z.lesen if a != z.app]]

    def _filter_je_app(self, z: Zugang, apps: list[str] | None, objekt: str | None) -> list[dict]:
        """Mem0 filtert agent_id nur auf genau einen Wert — je freigegebener App eine Abfrage (None = ganzer Mandant)."""
        basis: dict[str, Any] = {"user_id": z.mandant, **({"objekt": objekt} if objekt else {})}
        return [basis] if apps is None else [{**basis, "agent_id": a} for a in apps]

    def _eigener(self, z: Zugang, eintrag_id: str) -> dict:
        x = self.m.get(eintrag_id)
        if not x or x.get("user_id") != z.mandant:
            raise ZugangsFehler(404, "Eintrag nicht gefunden.")
        if x.get("agent_id") != z.app:
            raise ZugangsFehler(403, f'Der Eintrag gehört der App "{x.get("agent_id")}"; ändern darf nur sie.')
        return x

    def _am_bezug(self, z: Zugang, objekt: str) -> list[dict]:
        return self.m.get_all(filters={"user_id": z.mandant, "agent_id": z.app, "objekt": objekt}).get("results", [])

    def _abloesen(self, x: dict, durch: str):
        self.m.update(x["id"], metadata={**(x.get("metadata") or {}), "abgeloest_durch": durch}, expiration_date=_gestern())

    # ── Schreiben ───────────────────────────────────────────

    def ereignis(self, z: Zugang, text: str, objekt: str, art: str, von: str | None = None) -> dict:
        """App-Ereignis wörtlich ablegen (ohne KI). Ersetzt den letzten Eintrag gleicher Art am selben Bezug."""
        self._schreibrecht(z)
        alt = [x for x in self._am_bezug(z, objekt) if (x.get("metadata") or {}).get("art") == art]
        r = self.m.add(text, user_id=z.mandant, agent_id=z.app, infer=False,
                       metadata={"objekt": objekt, "art": art, "quelle": "api", "von": von or z.label})
        neu = [eintrag(x) for x in r.get("results", [])]
        for x in alt:
            self._abloesen(x, neu[0]["id"] if neu else "")
        ergebnis = {"neu": neu, "abgeloest": [eintrag(x) for x in alt]}
        self.protokoll(z, "ereignis", {"objekt": objekt, "art": art, "neu": len(neu), "abgeloest": len(alt)})
        return ergebnis

    def merken(self, z: Zugang, inhalt: str | list[dict], objekt: str | None = None, von: str | None = None) -> dict:
        """Text oder Gesprächsverlauf: Mem0 zieht die Fakten heraus; mit Bezug wird gegen Bestehendes geprüft."""
        self._schreibrecht(z)
        meta = {"quelle": "ki", "von": von or z.label, **({"objekt": objekt} if objekt else {})}
        # eigene Lauf-Kennung: Mem0 gibt sonst die letzten Nachrichten derselben App als Kontext mit, und das Modell legt
        # daraus alte Fakten neu an (24.10.2026, auch zu anderen Maklern). Den Abgleich mit Bestehendem macht diese Schicht.
        r = self.m.add(inhalt, user_id=z.mandant, agent_id=z.app, run_id=str(uuid.uuid4()), metadata=meta)
        neu = [x for x in r.get("results", []) if x.get("id")]
        abgeloest: list[dict] = []
        if objekt and neu:
            ids = {x["id"] for x in neu}
            bestehend = [x for x in self._am_bezug(z, objekt)
                         if x["id"] not in ids and (x.get("metadata") or {}).get("quelle") != "api"]
            if bestehend:
                antwort = self.m.llm.generate_response(messages=[{"role": "user", "content": PRUEF_PROMPT.format(
                    liste="\n".join(f'{i}: {x["memory"]}' for i, x in enumerate(bestehend)),
                    neu="\n".join(x["memory"] for x in neu))}])
                treffer = re.search(r"\{.*\}", str(antwort), re.S)
                try:
                    nummern = json.loads(treffer.group(0)).get("ueberholt", []) if treffer else []
                except json.JSONDecodeError:
                    nummern = []
                for i in nummern:
                    if isinstance(i, int) and 0 <= i < len(bestehend):
                        self._abloesen(bestehend[i], neu[0]["id"])
                        abgeloest.append(bestehend[i])
        ergebnis = {"neu": [eintrag(x) for x in neu], "abgeloest": [eintrag(x) for x in abgeloest]}
        self.protokoll(z, "merken", {"objekt": objekt, "neu": len(neu), "abgeloest": len(abgeloest)})
        return ergebnis

    def aendern(self, z: Zugang, eintrag_id: str, text: str) -> dict:
        self._schreibrecht(z)
        x = self._eigener(z, eintrag_id)
        self.m.update(eintrag_id, text=text, metadata={**(x.get("metadata") or {}), "quelle": "hand", "von": z.label})
        self.protokoll(z, "aendern", {"id": eintrag_id})
        return eintrag(self.m.get(eintrag_id))

    def vergessen(self, z: Zugang, eintrag_id: str) -> dict:
        self._schreibrecht(z)
        self._eigener(z, eintrag_id)
        self.m.delete(eintrag_id)
        self.protokoll(z, "vergessen", {"id": eintrag_id})
        return {"id": eintrag_id, "geloescht": True}

    # ── Lesen ───────────────────────────────────────────────

    def suchen(self, z: Zugang, frage: str, objekt: str | None = None, apps: list[str] | None = None, anzahl: int = 8) -> dict:
        erlaubt = self._apps(z, apps)
        n = max(1, min(anzahl, 50))
        roh = [x for f in self._filter_je_app(z, erlaubt, objekt) for x in self.m.search(frage, filters=f, top_k=n).get("results", [])]
        # zweite Sicherung: nichts außerhalb der Freigabe, auch wenn ein Filter einmal nicht greift
        treffer = [eintrag(x) for x in sorted(roh, key=lambda x: -(x.get("score") or 0))
                   if x.get("user_id", z.mandant) == z.mandant and (erlaubt is None or x.get("agent_id") in erlaubt)][:n]
        self.protokoll(z, "suchen", {"frage": frage[:200], "objekt": objekt, "treffer": len(treffer)})
        return {"treffer": treffer}

    def liste(self, z: Zugang, objekt: str | None = None, apps: list[str] | None = None, anzahl: int = 100) -> dict:
        erlaubt = self._apps(z, apps)
        n = max(1, min(anzahl, 500))
        roh = [x for f in self._filter_je_app(z, erlaubt, objekt) for x in self.m.get_all(filters=f, top_k=n).get("results", [])]
        eintraege = [eintrag(x) for x in roh
                     if x.get("user_id", z.mandant) == z.mandant and (erlaubt is None or x.get("agent_id") in erlaubt)][:n]
        return {"eintraege": eintraege}
