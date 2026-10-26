"""Gespräche der KI-Leisten (26.10.2026): das wörtliche Chat-Protokoll je App — getrennt vom Wissen.

Ein Gespräch ist kein Gedächtnis-Eintrag: es geht nicht durch Mem0, taucht in keiner Suche auf und ist für andere Apps
nicht lesbar, auch nicht mit Freigabe. Ins Gedächtnis kommt nur, was jemand ausdrücklich ablegt.
Jede App sieht nur ihre eigenen Gespräche (Mandant + App aus dem Zugang); Schreiben und Löschen brauchen Schreibrecht.
Gespräche, die GEDAECHTNIS_GESPRAECHE_TAGE (Standard 90) nicht mehr fortgesetzt wurden, werden gelöscht.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any, Protocol

import psycopg

from .zugang import Zugang, ZugangsFehler

TAGE = int(os.environ.get("GEDAECHTNIS_GESPRAECHE_TAGE", "90"))


def _schreibrecht(z: Zugang):
    if not z.schreiben:
        raise ZugangsFehler(403, f'Der Zugang "{z.label}" darf nur lesen.')


def _jetzt() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Gespraeche(Protocol):
    def liste(self, z: Zugang, bezug_art: str | None, bezug_id: str | None, anzahl: int) -> list[dict]: ...
    def laden(self, z: Zugang, gid: str) -> dict: ...
    def speichern(self, z: Zugang, gid: str, g: dict) -> dict: ...
    def loeschen(self, z: Zugang, gid: str) -> dict: ...


def _kopf(g: dict) -> dict:
    return {k: g.get(k) for k in ("id", "bezug", "titel", "von", "am", "anzahl")}


class GespraecheImSpeicher:
    """Für Tests und lokales Arbeiten ohne Datenbank — dieselben Regeln wie in Postgres."""

    def __init__(self, jetzt=_jetzt):
        self.alle: dict[tuple[str, str, str], dict] = {}
        self.jetzt = jetzt

    def _aufraeumen(self):
        grenze = self.jetzt() - dt.timedelta(days=TAGE)
        for k in [k for k, g in self.alle.items() if g["_geaendert"] < grenze]:
            del self.alle[k]

    def liste(self, z, bezug_art, bezug_id, anzahl):
        self._aufraeumen()
        def passt(g: dict) -> bool:
            b = g["bezug"] or {}
            return (b.get("art"), b.get("id")) == (bezug_art, bezug_id) if bezug_art else not g["bezug"]
        passend = [g for (m, a, _), g in self.alle.items() if (m, a) == (z.mandant, z.app) and passt(g)]
        return [_kopf(g) for g in sorted(passend, key=lambda g: g["_geaendert"], reverse=True)[:anzahl]]

    def laden(self, z, gid):
        self._aufraeumen()
        g = self.alle.get((z.mandant, z.app, gid))
        if not g:
            raise ZugangsFehler(404, "Gespräch nicht gefunden.")
        return {k: v for k, v in g.items() if not k.startswith("_")}

    def speichern(self, z, gid, g):
        _schreibrecht(z)
        self._aufraeumen()
        self.alle[(z.mandant, z.app, gid)] = {**g, "id": gid, "_geaendert": self.jetzt()}
        return _kopf(self.alle[(z.mandant, z.app, gid)])

    def loeschen(self, z, gid):
        _schreibrecht(z)
        return {"id": gid, "geloescht": self.alle.pop((z.mandant, z.app, gid), None) is not None}


class GespraecheInPostgres:
    def __init__(self, db: str):
        self.db = db
        with psycopg.connect(db, autocommit=True) as c:
            c.execute("""create table if not exists gedaechtnis_gespraeche (
                mandant text not null, app text not null, id text not null,
                bezug_art text, bezug_id text, titel text not null, von text, am text, anzahl int not null default 0,
                nachrichten jsonb not null, geaendert timestamptz not null default now(),
                primary key (mandant, app, id))""")
            c.execute("create index if not exists gedaechtnis_gespraeche_bezug on gedaechtnis_gespraeche (mandant, app, bezug_art, bezug_id, geaendert desc)")

    def _aufraeumen(self, c: Any):
        c.execute("delete from gedaechtnis_gespraeche where geaendert < now() - make_interval(days => %s)", (TAGE,))

    @staticmethod
    def _zeile(r) -> dict:
        art, bid, *rest = r
        return {"bezug": {"art": art, "id": bid} if art and bid else None, **dict(zip(("id", "titel", "von", "am", "anzahl"), rest))}

    def liste(self, z, bezug_art, bezug_id, anzahl):
        wo = "bezug_art = %s and bezug_id = %s" if bezug_art else "bezug_art is null"
        werte: list[Any] = [z.mandant, z.app, *([bezug_art, bezug_id] if bezug_art else []), anzahl]
        with psycopg.connect(self.db, autocommit=True) as c:
            self._aufraeumen(c)
            zeilen = c.execute(f"select bezug_art, bezug_id, id, titel, von, am, anzahl from gedaechtnis_gespraeche "
                               f"where mandant = %s and app = %s and {wo} order by geaendert desc limit %s", werte).fetchall()
        return [self._zeile(r) for r in zeilen]

    def laden(self, z, gid):
        with psycopg.connect(self.db, autocommit=True) as c:
            self._aufraeumen(c)
            r = c.execute("select bezug_art, bezug_id, id, titel, von, am, anzahl, nachrichten from gedaechtnis_gespraeche "
                          "where mandant = %s and app = %s and id = %s", (z.mandant, z.app, gid)).fetchone()
        if not r:
            raise ZugangsFehler(404, "Gespräch nicht gefunden.")
        return {**self._zeile(r[:7]), "nachrichten": r[7]}

    def speichern(self, z, gid, g):
        _schreibrecht(z)
        b = g.get("bezug") or {}
        with psycopg.connect(self.db, autocommit=True) as c:
            self._aufraeumen(c)
            c.execute("""insert into gedaechtnis_gespraeche (mandant, app, id, bezug_art, bezug_id, titel, von, am, anzahl, nachrichten)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (mandant, app, id) do update set titel = excluded.titel, am = excluded.am,
                  anzahl = excluded.anzahl, nachrichten = excluded.nachrichten, geaendert = now()""",
                      (z.mandant, z.app, gid, b.get("art"), b.get("id"), g["titel"], g.get("von"), g.get("am"), g.get("anzahl", 0),
                       json.dumps(g.get("nachrichten", []), ensure_ascii=False)))
        return _kopf({**g, "id": gid})

    def loeschen(self, z, gid):
        _schreibrecht(z)
        with psycopg.connect(self.db, autocommit=True) as c:
            n = c.execute("delete from gedaechtnis_gespraeche where mandant = %s and app = %s and id = %s", (z.mandant, z.app, gid)).rowcount
        return {"id": gid, "geloescht": n > 0}
