"""Wer darf was: Zugänge als Liste in GEDAECHTNIS_ZUGAENGE (JSON), Schlüssel nur als SHA-256.

Ein Zugang gehört genau einer App eines Mandanten. Schreiben geht nur in die eigene App, Lesen in die eigene App
und in die freigegebenen Apps desselben Mandanten („*“ = alle Apps des Mandanten). Über Mandanten hinweg gibt es nichts.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class Zugang:
    label: str
    mandant: str
    app: str
    lesen: tuple[str, ...]  # freigegebene fremde Apps desselben Mandanten, "*" = alle
    schreiben: bool

    def darf_lesen(self, app: str) -> bool:
        return app == self.app or "*" in self.lesen or app in self.lesen


class ZugangsFehler(Exception):
    def __init__(self, status: int, text: str):
        super().__init__(text)
        self.status = status
        self.text = text


def verzeichnis(roh: str | None) -> tuple[list[tuple[Zugang, str]], list[str]]:
    """Liest die Zugänge; was nicht vollständig passt, wird mit Grund verworfen statt großzügig ausgelegt."""
    eintraege: list[tuple[Zugang, str]] = []
    verworfen: list[str] = []
    try:
        liste = json.loads(roh or "[]")
    except json.JSONDecodeError:
        return [], ["GEDAECHTNIS_ZUGAENGE ist kein gültiges JSON"]
    labels: set[str] = set()
    for e in liste if isinstance(liste, list) else []:
        label, mandant, app = (str(e.get(k, "")) for k in ("label", "mandant", "app"))
        h = str(e.get("sha256", "")).lower()
        lesen = e.get("lesen", [])
        if not all(NAME_RE.match(x) for x in (label, mandant, app)):
            verworfen.append(f"{label or '(leer)'}: label, mandant und app müssen kurz und klein geschrieben sein")
        elif label in labels:
            verworfen.append(f"{label}: Label doppelt")
        elif not HASH_RE.match(h):
            verworfen.append(f"{label}: sha256 fehlt oder ist kein SHA-256 in Hex")
        elif not isinstance(lesen, list) or not all(x == "*" or NAME_RE.match(str(x)) for x in lesen):
            verworfen.append(f"{label}: lesen muss eine Liste von Apps oder [\"*\"] sein")
        else:
            labels.add(label)
            eintraege.append((Zugang(label, mandant, app, tuple(str(x) for x in lesen), bool(e.get("schreiben", False))), h))
    return eintraege, verworfen


def anmelden(vorgelegt: str | None, roh: str | None) -> Zugang:
    eintraege, _ = verzeichnis(roh)
    if not eintraege:
        raise ZugangsFehler(500, "Auf diesem Dienst ist kein Zugang eingerichtet (GEDAECHTNIS_ZUGAENGE).")
    if not vorgelegt:
        raise ZugangsFehler(401, 'Kein Schlüssel. Kopfzeile "Authorization: Bearer <schluessel>" setzen.')
    digest = hashlib.sha256(vorgelegt.encode()).hexdigest()
    treffer = None
    for z, h in eintraege:  # ohne vorzeitigen Ausstieg
        if hmac.compare_digest(h, digest):
            treffer = z
    if not treffer:
        raise ZugangsFehler(401, "Der Schlüssel ist ungültig oder wurde widerrufen.")
    return treffer


def schluessel_aus_kopf(kopf: dict[str, str]) -> str | None:
    m = re.match(r"^Bearer\s+(.+)$", (kopf.get("authorization") or "").strip(), re.I)
    return (m.group(1).strip() if m else None) or None
