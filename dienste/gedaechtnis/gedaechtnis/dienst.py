"""Der Dienst: REST für Apps (/v1/…), MCP für KI (/mcp, Streamable HTTP), beide mit demselben Schlüssel.

Umgebung:
  GEDAECHTNIS_DB         Postgres mit pgvector (postgresql://…)
  GEDAECHTNIS_ZUGAENGE   JSON-Liste der Zugänge (siehe zugang.py), Schlüssel nur als SHA-256
  GEDAECHTNIS_LLM        ollama (Standard) | anthropic   ·  GEDAECHTNIS_MODELL  z. B. mistral-small3.2 / claude-haiku-4-5
  GEDAECHTNIS_EMBED      bge-m3 (Ollama, mehrsprachig)   ·  OLLAMA_URL  http://localhost:11434
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import os
from typing import Any

import psycopg
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from .gespraeche import Gespraeche, GespraecheImSpeicher, GespraecheInPostgres
from .kern import Gedaechtnis
from .zugang import Zugang, ZugangsFehler, anmelden, schluessel_aus_kopf, verzeichnis

DB = os.environ.get("GEDAECHTNIS_DB", "postgresql://postgres:probe@127.0.0.1:55440/probe")
LLM = os.environ.get("GEDAECHTNIS_LLM", "ollama")
MODELL = os.environ.get("GEDAECHTNIS_MODELL", "claude-haiku-4-5" if LLM == "anthropic" else "mistral-small3.2")
# Embeddings: lokal über Ollama (bge-m3) oder im Prozess über fastembed (ONNX, ohne PyTorch — für den Server)
EMBED_ANBIETER = os.environ.get("GEDAECHTNIS_EMBED_ANBIETER", "ollama")
EMBED = os.environ.get("GEDAECHTNIS_EMBED", "bge-m3" if EMBED_ANBIETER == "ollama" else "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
DIMS = {"bge-m3": 1024, "nomic-embed-text": 768, "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": 384,
        "sentence-transformers/paraphrase-multilingual-mpnet-base-v2": 768, "intfloat/multilingual-e5-large": 1024}.get(EMBED, 1024)
# je Embedding eine eigene Sammlung: Vektoren verschiedener Modelle sind nicht vergleichbar
SAMMLUNG = "gedaechtnis" if EMBED == "bge-m3" else "gedaechtnis_" + "".join(c if c.isalnum() else "_" for c in EMBED.split("/")[-1].lower())

ANWEISUNG = ("Schreibe jeden Fakt auf Deutsch, knapp und mit vollem Namen der Person, Firma oder des Deals. "
             "Behalte Telefonnummern, Uhrzeiten, Beträge und Namen wörtlich.")


class Ereignis(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    objekt: str = Field(min_length=1, max_length=200)
    art: str = Field(min_length=1, max_length=60)
    von: str | None = None

class Ablage(BaseModel):
    titel: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100_000)
    objekt: str = Field(min_length=1, max_length=200)
    von: str | None = None

class Merken(BaseModel):
    text: str | None = Field(default=None, max_length=20000)
    nachrichten: list[dict] | None = None
    objekt: str | None = None
    von: str | None = None

class Suchen(BaseModel):
    frage: str = Field(min_length=1, max_length=1000)
    objekt: str | None = None
    apps: list[str] | None = None
    anzahl: int = 8

class Aendern(BaseModel):
    text: str = Field(min_length=1, max_length=4000)

class Bezug(BaseModel):
    art: str = Field(min_length=1, max_length=40)
    id: str = Field(min_length=1, max_length=200)

class Gespraech(BaseModel):
    """Ein Gespräch der KI-Leiste; die Nachrichten speichert der Dienst unverändert (Format: @gg/ki-kern KiNachricht)."""
    bezug: Bezug | None = None
    titel: str = Field(min_length=1, max_length=200)
    von: str | None = Field(default=None, max_length=200)
    am: str | None = Field(default=None, max_length=40)
    anzahl: int = Field(default=0, ge=0)
    nachrichten: list[dict] = Field(default_factory=list, max_length=500)


def mem0_konfig() -> dict:
    return {
        "vector_store": {"provider": "pgvector", "config": {
            "connection_string": DB, "collection_name": SAMMLUNG, "embedding_model_dims": DIMS}},
        # das Anthropic-SDK nimmt keine Sampling-Parameter mehr an (temperature/top_p) — Mem0 darf sie nicht senden
        "llm": {"provider": "anthropic", "config": {"model": MODELL, "enable_sampling_parameters": False}} if LLM == "anthropic"
        else {"provider": "ollama", "config": {"model": MODELL, "temperature": 0, "ollama_base_url": OLLAMA}},
        "embedder": {"provider": "fastembed", "config": {"model": EMBED, "embedding_dims": DIMS}} if EMBED_ANBIETER == "fastembed"
        else {"provider": "ollama", "config": {"model": EMBED, "embedding_dims": DIMS, "ollama_base_url": OLLAMA}},
        "custom_instructions": ANWEISUNG,
        "history_db_path": os.environ.get("GEDAECHTNIS_VERLAUF", os.path.join(os.path.dirname(__file__), "..", "verlauf.db")),
    }


def protokoll_schreiben(z: Zugang, aktion: str, details: dict):
    with psycopg.connect(DB, autocommit=True) as c:
        c.execute("insert into gedaechtnis_protokoll (label, mandant, app, aktion, details) values (%s,%s,%s,%s,%s)",
                  (z.label, z.mandant, z.app, aktion, json.dumps(details, ensure_ascii=False)))


def protokoll_anlegen():
    with psycopg.connect(DB, autocommit=True) as c:
        c.execute("""create table if not exists gedaechtnis_protokoll (
            id bigserial primary key, am timestamptz not null default now(),
            label text not null, mandant text not null, app text not null, aktion text not null, details jsonb)""")
        c.execute("create index if not exists gedaechtnis_protokoll_mandant_am on gedaechtnis_protokoll (mandant, am desc)")


def protokoll_lesen(z: Zugang, anzahl: int) -> list[dict]:
    """Protokoll der eigenen und der freigegebenen Apps desselben Mandanten."""
    sql = "select am, label, app, aktion, details from gedaechtnis_protokoll where mandant=%s"
    werte: list[Any] = [z.mandant]
    if "*" not in z.lesen:
        sql += " and app = any(%s)"
        werte.append([z.app, *z.lesen])
    with psycopg.connect(DB) as c:
        zeilen = c.execute(sql + " order by am desc limit %s", (*werte, anzahl)).fetchall()
    return [{"am": a.isoformat(), "label": l, "app": ap, "aktion": ak, "details": d} for a, l, ap, ak, d in zeilen]


def erzeuge(memory: Any = None, protokoll=None, gespraeche: Gespraeche | None = None) -> FastAPI:
    """memory/protokoll/gespraeche sind für Tests austauschbar; ohne Angabe: Mem0 auf Postgres, Protokoll- und Gesprächstabelle."""
    if memory is None:
        from mem0 import Memory
        os.environ.setdefault("MEM0_TELEMETRY", "False")
        memory = Memory.from_config(mem0_konfig())
        protokoll_anlegen()
        protokoll = protokoll_schreiben
        gespraeche = gespraeche or GespraecheInPostgres(DB)
    verlauf: Gespraeche = gespraeche or GespraecheImSpeicher()
    g = Gedaechtnis(memory, protokoll or (lambda *_: None))
    aktuell: contextvars.ContextVar[Zugang | None] = contextvars.ContextVar("zugang", default=None)

    # ── MCP ─────────────────────────────────────────────────
    # Kein Host-Abgleich der Bibliothek: jeder Aufruf braucht ohnehin einen Schlüssel im Kopf (kein Cookie-Pfad)
    mcp = FastMCP("gedaechtnis", stateless_http=True, json_response=True, streamable_http_path="/mcp",
                  transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))

    def zugang() -> Zugang:
        z = aktuell.get()
        if not z:
            raise ZugangsFehler(401, "nicht angemeldet")
        return z

    @mcp.tool(description="Etwas merken: Text oder Notiz aus dem Gespräch. Die Fakten werden herausgezogen; mit `objekt` "
                          "(z. B. gg:makler:123) werden überholte Angaben zum selben Bezug abgelöst.")
    def merken(text: str, objekt: str | None = None) -> dict:
        return g.merken(zugang(), text, objekt)

    @mcp.tool(description="Ein Ergebnis (z. B. eine Recherche) wörtlich als genau einen Eintrag ablegen, Markdown erlaubt. "
                          "`objekt` ist der Bezug (z. B. gg:deal:123); derselbe `titel` am selben Bezug ersetzt den alten Eintrag.")
    def ablegen(titel: str, text: str, objekt: str) -> dict:
        return g.ablegen(zugang(), titel, text, objekt)

    @mcp.tool(description="Im Gedächtnis suchen. `objekt` grenzt auf einen Bezug ein, `apps` auf freigegebene Apps "
                          "(leer = eigene und freigegebene).")
    def suchen(frage: str, objekt: str | None = None, apps: list[str] | None = None, anzahl: int = 8) -> dict:
        return g.suchen(zugang(), frage, objekt, apps, anzahl)

    @mcp.tool(description="Alle gültigen Einträge zu einem Bezug, z. B. gg:makler:123.")
    def eintraege_zu(objekt: str) -> dict:
        return g.liste(zugang(), objekt)

    @mcp.tool(description="Einen eigenen Eintrag löschen (id aus suchen/eintraege_zu).")
    def vergessen(id: str) -> dict:
        return g.vergessen(zugang(), id)

    mcp_app = mcp.streamable_http_app()

    @contextlib.asynccontextmanager
    async def lebenszeit(_):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title="Gedächtnis-Dienst", version="0.1.0", lifespan=lebenszeit)

    class Anmeldung(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.url.path in ("/health", "/docs", "/openapi.json"):
                return await call_next(request)
            try:
                z = anmelden(schluessel_aus_kopf(dict(request.headers)), os.environ.get("GEDAECHTNIS_ZUGAENGE"))
            except ZugangsFehler as e:
                return JSONResponse({"fehler": e.text}, status_code=e.status)
            token = aktuell.set(z)
            request.state.zugang = z
            try:
                return await call_next(request)
            finally:
                aktuell.reset(token)

    app.add_middleware(Anmeldung)

    @app.exception_handler(ZugangsFehler)
    async def _fehler(_, e: ZugangsFehler):
        return JSONResponse({"fehler": e.text}, status_code=e.status)

    def wer(request: Request) -> Zugang:
        return request.state.zugang

    @app.get("/health")
    def health():
        return {"ok": True, "llm": LLM, "modell": MODELL, "embed": EMBED, "embed_anbieter": EMBED_ANBIETER}

    @app.get("/v1/ich")
    def ich(z: Zugang = Depends(wer)):
        return {"label": z.label, "mandant": z.mandant, "app": z.app, "lesen": list(z.lesen), "schreiben": z.schreiben,
                "verworfen": verzeichnis(os.environ.get("GEDAECHTNIS_ZUGAENGE"))[1]}

    @app.post("/v1/ereignis")
    def ereignis(e: Ereignis, z: Zugang = Depends(wer)):
        return g.ereignis(z, e.text, e.objekt, e.art, e.von)

    @app.post("/v1/ablegen")
    def ablegen_rest(e: Ablage, z: Zugang = Depends(wer)):
        return g.ablegen(z, e.titel, e.text, e.objekt, e.von)

    @app.post("/v1/merken")
    def merken_rest(e: Merken, z: Zugang = Depends(wer)):
        inhalt = e.nachrichten or e.text
        if not inhalt:
            raise ZugangsFehler(400, "text oder nachrichten angeben")
        return g.merken(z, inhalt, e.objekt, e.von)

    @app.post("/v1/suchen")
    def suchen_rest(e: Suchen, z: Zugang = Depends(wer)):
        return g.suchen(z, e.frage, e.objekt, e.apps, e.anzahl)

    @app.get("/v1/eintraege")
    def eintraege(objekt: str | None = None, z: Zugang = Depends(wer)):
        return g.liste(z, objekt)

    @app.patch("/v1/eintraege/{eintrag_id}")
    def aendern(eintrag_id: str, e: Aendern, z: Zugang = Depends(wer)):
        return g.aendern(z, eintrag_id, e.text)

    @app.delete("/v1/eintraege/{eintrag_id}")
    def loeschen(eintrag_id: str, z: Zugang = Depends(wer)):
        return g.vergessen(z, eintrag_id)

    @app.get("/v1/protokoll")
    def protokoll_rest(anzahl: int = 100, z: Zugang = Depends(wer)):
        return {"protokoll": protokoll_lesen(z, max(1, min(anzahl, 1000)))}

    # ── Gespräche der KI-Leisten (nur REST, nur die eigene App) ──
    @app.get("/v1/gespraeche")
    def gespraeche_liste(bezug_art: str | None = None, bezug_id: str | None = None, anzahl: int = 20, z: Zugang = Depends(wer)):
        if bool(bezug_art) != bool(bezug_id):
            raise ZugangsFehler(400, "bezug_art und bezug_id nur zusammen angeben")
        return {"gespraeche": verlauf.liste(z, bezug_art, bezug_id, max(1, min(anzahl, 100)))}

    @app.get("/v1/gespraeche/{gid}")
    def gespraech_laden(gid: str, z: Zugang = Depends(wer)):
        return verlauf.laden(z, gid)

    @app.put("/v1/gespraeche/{gid}")
    def gespraech_speichern(gid: str, e: Gespraech, z: Zugang = Depends(wer)):
        return verlauf.speichern(z, gid, e.model_dump())

    @app.delete("/v1/gespraeche/{gid}")
    def gespraech_loeschen(gid: str, z: Zugang = Depends(wer)):
        r = verlauf.loeschen(z, gid)
        g.protokoll(z, "gespraech-geloescht", {"id": gid})
        return r

    app.mount("/", mcp_app)  # nach den Routen: /v1/… zuerst, /mcp aus der MCP-App
    return app
