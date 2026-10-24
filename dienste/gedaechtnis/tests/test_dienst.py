"""Rechte, Ersetzen und Schnittstellen — gegen ein Mem0-Double (ohne Modell, ohne Datenbank)."""
import datetime as dt
import hashlib
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from gedaechtnis.dienst import erzeuge
from gedaechtnis.zugang import verzeichnis


class LlmDouble:
    def __init__(self):
        self.antwort = '{"ueberholt": []}'

    def generate_response(self, messages):
        return self.antwort


class Mem0Double:
    """Verhält sich bei Filtern, Ablaufdatum und Rückgaben wie Mem0 2.x (soweit der Dienst es nutzt)."""

    def __init__(self):
        self.eintraege: dict[str, dict] = {}
        self.llm = LlmDouble()

    def _passt(self, x, filters):
        if isinstance((filters or {}).get("agent_id"), dict):  # wie Mem0: agent_id nur als einzelner Wert
            raise ValueError("Invalid agent_id")
        if x.get("expiration_date") and x["expiration_date"] < dt.date.today().isoformat():
            return False
        for k, v in (filters or {}).items():
            wert = x.get(k) if k in ("user_id", "agent_id") else (x.get("metadata") or {}).get(k)
            if isinstance(v, dict) and "in" in v:
                if wert not in v["in"]:
                    return False
            elif wert != v:
                return False
        return True

    def add(self, inhalt, *, user_id, agent_id, metadata=None, infer=True):
        texte = [inhalt] if not infer else (
            [n["content"] for n in inhalt if n["role"] == "user"] if isinstance(inhalt, list) else [s.strip() for s in inhalt.split(".") if s.strip()])
        neu = []
        for t in texte:
            i = str(uuid.uuid4())
            self.eintraege[i] = {"id": i, "memory": t, "user_id": user_id, "agent_id": agent_id, "metadata": dict(metadata or {}),
                                 "created_at": dt.datetime.now().isoformat()}
            neu.append({"id": i, "memory": t, "event": "ADD"})
        return {"results": neu}

    def get(self, i):
        return self.eintraege.get(i)

    def get_all(self, *, filters=None, top_k=20):
        return {"results": [x for x in self.eintraege.values() if self._passt(x, filters)][:top_k]}

    def search(self, frage, *, filters=None, top_k=20):
        woerter = {w.lower().strip("?.,") for w in frage.split() if len(w) > 3}
        treffer = []
        for x in self.eintraege.values():
            if self._passt(x, filters):
                score = sum(w in x["memory"].lower() for w in woerter) / max(len(woerter), 1)
                if score:
                    treffer.append({**x, "score": score})
        return {"results": sorted(treffer, key=lambda t: -t["score"])[:top_k]}

    def update(self, i, text=None, metadata=None, expiration_date=None):
        x = self.eintraege[i]
        if text:
            x["memory"] = text
        if metadata is not None:
            x["metadata"] = metadata
        if expiration_date:
            x["expiration_date"] = expiration_date

    def delete(self, i):
        del self.eintraege[i]


SCHLUESSEL = {"gg": "s-gg", "desk": "s-desk", "leser": "s-leser", "fremd": "s-fremd", "alle": "s-alle"}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


ZUGAENGE = json.dumps([
    {"label": "gg", "mandant": "ivtag", "app": "gg", "lesen": ["desk"], "schreiben": True, "sha256": h("s-gg")},
    {"label": "desk", "mandant": "ivtag", "app": "desk", "lesen": [], "schreiben": True, "sha256": h("s-desk")},
    {"label": "leser", "mandant": "ivtag", "app": "gg", "lesen": [], "schreiben": False, "sha256": h("s-leser")},
    {"label": "alle", "mandant": "ivtag", "app": "auswertung", "lesen": ["*"], "schreiben": False, "sha256": h("s-alle")},
    {"label": "fremd", "mandant": "andere", "app": "gg", "lesen": ["*"], "schreiben": True, "sha256": h("s-fremd")},
])


@pytest.fixture
def umgebung(monkeypatch):
    monkeypatch.setenv("GEDAECHTNIS_ZUGAENGE", ZUGAENGE)
    mem, protokoll = Mem0Double(), []
    app = erzeuge(mem, lambda z, aktion, d: protokoll.append((z.label, aktion, d)))
    with TestClient(app) as c:
        yield c, mem, protokoll


def als(c, wer, methode, pfad, **k):
    return c.request(methode, pfad, headers={"authorization": f"Bearer {SCHLUESSEL[wer]}"}, **k)


def test_anmeldung(umgebung):
    c, *_ = umgebung
    assert c.get("/health").status_code == 200
    assert c.get("/v1/ich").status_code == 401
    assert c.get("/v1/ich", headers={"authorization": "Bearer falsch"}).status_code == 401
    assert als(c, "gg", "GET", "/v1/ich").json() | {"verworfen": []} == {
        "label": "gg", "mandant": "ivtag", "app": "gg", "lesen": ["desk"], "schreiben": True, "verworfen": []}


def test_verzeichnis_verwirft_unvollstaendige_eintraege():
    eintraege, verworfen = verzeichnis(json.dumps([
        {"label": "ok", "mandant": "m", "app": "a", "lesen": [], "sha256": "a" * 64},
        {"label": "ok", "mandant": "m", "app": "a", "lesen": [], "sha256": "b" * 64},
        {"label": "Gross", "mandant": "m", "app": "a", "sha256": "c" * 64},
        {"label": "kurz", "mandant": "m", "app": "a", "sha256": "123"},
    ]))
    assert [z.label for z, _ in eintraege] == ["ok"]
    assert len(verworfen) == 3


def test_ereignis_ersetzt_gleiche_art_am_bezug(umgebung):
    c, _, protokoll = umgebung
    erst = als(c, "gg", "POST", "/v1/ereignis", json={"text": "Bernd Muster: Priorität A", "objekt": "gg:makler:b", "art": "prioritaet"}).json()
    als(c, "gg", "POST", "/v1/ereignis", json={"text": "Bernd Muster wohnt in Esslingen", "objekt": "gg:makler:b", "art": "adresse"})
    zweit = als(c, "gg", "POST", "/v1/ereignis", json={"text": "Bernd Muster: Priorität B", "objekt": "gg:makler:b", "art": "prioritaet"}).json()
    assert [x["id"] for x in zweit["abgeloest"]] == [erst["neu"][0]["id"]]
    texte = [x["text"] for x in als(c, "gg", "GET", "/v1/eintraege", params={"objekt": "gg:makler:b"}).json()["eintraege"]]
    assert sorted(texte) == ["Bernd Muster wohnt in Esslingen", "Bernd Muster: Priorität B"]
    assert ("gg", "ereignis", {"objekt": "gg:makler:b", "art": "prioritaet", "neu": 1, "abgeloest": 1}) in protokoll


def test_merken_loest_ueberholtes_per_ki_ab(umgebung):
    c, mem, _ = umgebung
    als(c, "gg", "POST", "/v1/ereignis", json={"text": "Anna Beispiel: Mobil 0171 5550001", "objekt": "gg:makler:a", "art": "recherche"})
    mem.llm.antwort = 'Antwort: {"ueberholt": [0]}'
    r = als(c, "gg", "POST", "/v1/merken", json={"nachrichten": [{"role": "user", "content": "Anna Beispiel hat jetzt Mobil 0172 9990002"}], "objekt": "gg:makler:a"}).json()
    assert [x["text"] for x in r["abgeloest"]] == ["Anna Beispiel: Mobil 0171 5550001"]
    treffer = als(c, "gg", "POST", "/v1/suchen", json={"frage": "Mobil Anna Beispiel"}).json()["treffer"]
    assert [t["text"] for t in treffer] == ["Anna Beispiel hat jetzt Mobil 0172 9990002"]
    assert treffer[0]["quelle"] == "ki" and treffer[0]["objekt"] == "gg:makler:a"


def test_lesen_nur_mit_freigabe_und_nie_ueber_mandanten(umgebung):
    c, *_ = umgebung
    als(c, "gg", "POST", "/v1/ereignis", json={"text": "Anna Beispiel Mobil 0171", "objekt": "gg:makler:a", "art": "recherche"})
    als(c, "desk", "POST", "/v1/ereignis", json={"text": "Termin Anna Beispiel am 30.10.", "objekt": "gg:makler:a", "art": "termin"})
    als(c, "fremd", "POST", "/v1/ereignis", json={"text": "Anna Beispiel sucht Wohnung in Ulm", "objekt": "x:kontakt:a", "art": "notiz"})
    frage = {"frage": "Anna Beispiel"}
    sieht = lambda wer, **extra: sorted(t["text"] for t in als(c, wer, "POST", "/v1/suchen", json=frage | extra).json()["treffer"])
    assert sieht("gg") == ["Anna Beispiel Mobil 0171", "Termin Anna Beispiel am 30.10."]  # gg darf desk lesen
    assert sieht("desk") == ["Termin Anna Beispiel am 30.10."]  # desk hat keine Freigabe für gg
    assert sieht("alle") == ["Anna Beispiel Mobil 0171", "Termin Anna Beispiel am 30.10."]  # „*“: alle Apps, nur eigener Mandant
    assert sieht("fremd") == ["Anna Beispiel sucht Wohnung in Ulm"]
    assert sieht("gg", apps=["desk"]) == ["Termin Anna Beispiel am 30.10."]
    assert als(c, "desk", "POST", "/v1/suchen", json=frage | {"apps": ["gg"]}).status_code == 403


def test_schreiben_nur_eigene_app_und_mit_schreibrecht(umgebung):
    c, *_ = umgebung
    neu = als(c, "gg", "POST", "/v1/ereignis", json={"text": "Notiz zu Deal K", "objekt": "gg:deal:k", "art": "notiz"}).json()["neu"][0]
    assert als(c, "leser", "POST", "/v1/ereignis", json={"text": "x", "objekt": "gg:deal:k", "art": "notiz"}).status_code == 403
    assert als(c, "desk", "DELETE", f"/v1/eintraege/{neu['id']}").status_code == 403
    assert als(c, "fremd", "DELETE", f"/v1/eintraege/{neu['id']}").status_code == 404
    assert als(c, "gg", "PATCH", f"/v1/eintraege/{neu['id']}", json={"text": "Notiz zu Deal K (korrigiert)"}).json()["quelle"] == "hand"
    assert als(c, "gg", "DELETE", f"/v1/eintraege/{neu['id']}").json() == {"id": neu["id"], "geloescht": True}


def test_mcp_werkzeuge_mit_demselben_schluessel(umgebung):
    c, *_ = umgebung
    kopf = {"authorization": f"Bearer {SCHLUESSEL['gg']}", "accept": "application/json, text/event-stream", "content-type": "application/json"}
    rpc = lambda body: c.post("/mcp", headers=kopf, content=json.dumps(body))
    init = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}})
    assert init.status_code == 200 and init.json()["result"]["serverInfo"]["name"] == "gedaechtnis"
    namen = [t["name"] for t in rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]]
    assert namen == ["merken", "suchen", "eintraege_zu", "vergessen"]
    r = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "merken", "arguments": {"text": "Anna Beispiel nur telefonisch ab 10 Uhr", "objekt": "gg:makler:a"}}}).json()
    assert r["result"]["isError"] is False
    r = rpc({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "suchen", "arguments": {"frage": "Anna telefonisch"}}}).json()
    assert "telefonisch" in r["result"]["content"][0]["text"]
    assert c.post("/mcp", headers={**kopf, "authorization": "Bearer falsch"}, content="{}").status_code == 401
