"""Gemeinsames für beide Proben: Szenario laden, Treffer bewerten, Kosten aus Token schätzen, Bericht schreiben."""
import json
import time
from pathlib import Path

HIER = Path(__file__).parent
SZENARIO = json.loads((HIER / "szenario.json").read_text())

# Preise Haiku 4.5 je 1 Mio. Token (US-$), für die Schätzung „was kostete das mit Claude statt lokal“
HAIKU_EIN, HAIKU_AUS = 1.0, 5.0


class Zaehler:
    """Zählt Aufrufe und Token des lokalen Modells (Ollama liefert prompt_eval_count/eval_count)."""

    def __init__(self):
        self.aufrufe = 0
        self.ein = 0
        self.aus = 0
        self.embeddings = 0

    def kosten_usd(self):
        return self.ein / 1e6 * HAIKU_EIN + self.aus / 1e6 * HAIKU_AUS

    def stand(self):
        return {"llm_aufrufe": self.aufrufe, "token_ein": self.ein, "token_aus": self.aus,
                "embeddings": self.embeddings, "kosten_haiku_usd": round(self.kosten_usd(), 5)}


def ollama_zaehlen(zaehler: Zaehler):
    """Ollama-Client so umhüllen, dass jeder chat/generate/embed-Aufruf gezählt wird."""
    import ollama

    def huelle(orig, art):
        def f(self, *a, **k):
            r = orig(self, *a, **k)
            if art == "embed":
                zaehler.embeddings += 1
            else:
                zaehler.aufrufe += 1
                g = r if isinstance(r, dict) else getattr(r, "__dict__", {})
                zaehler.ein += int((r.get("prompt_eval_count") if isinstance(r, dict) else getattr(r, "prompt_eval_count", 0)) or 0)
                zaehler.aus += int((r.get("eval_count") if isinstance(r, dict) else getattr(r, "eval_count", 0)) or 0)
            return r
        return f

    for name, art in (("chat", "llm"), ("generate", "llm"), ("embed", "embed"), ("embeddings", "embed")):
        if hasattr(ollama.Client, name):
            setattr(ollama.Client, name, huelle(getattr(ollama.Client, name), art))


def bewerten(frage: dict, texte: list[str]) -> dict:
    gesamt = " ".join(texte).lower()
    fehlt = [e for e in frage.get("erwartet", []) if e.lower() not in gesamt]
    verboten = [v for v in frage.get("verboten", []) if v.lower() in gesamt]
    return {"ok": not fehlt and not verboten, "fehlt": fehlt, "verboten_gefunden": verboten}


class Uhr:
    def __enter__(self):
        self.t = time.perf_counter()
        return self

    def __exit__(self, *_):
        self.s = round(time.perf_counter() - self.t, 2)


def bericht(name: str, daten: dict):
    pfad = HIER / "ergebnisse" / f"{name}.json"
    pfad.parent.mkdir(exist_ok=True)
    pfad.write_text(json.dumps(daten, ensure_ascii=False, indent=1))
    ok = sum(1 for f in daten["fragen"] if f["bewertung"]["ok"])
    print(f"\n{name}: {ok}/{len(daten['fragen'])} Fragen richtig · {daten['zeiten']} · {daten['verbrauch']}")
    for f in daten["fragen"]:
        b = f["bewertung"]
        print(f"  {'✔' if b['ok'] else '✘'} {f['id']} [{f['app']}/{f['bereich']}] {f['frage']}"
              + (f"  fehlt={b['fehlt']}" if b["fehlt"] else "") + (f"  VERBOTEN={b['verboten_gefunden']}" if b["verboten_gefunden"] else ""))


def zaehl_proxy(zaehler: Zaehler, port: int = 11500, ziel: str = "http://localhost:11434"):
    """Zählender Durchreicher vor Ollama — unabhängig davon, wie eine Engine Ollama anspricht
    (OpenAI-kompatibel /v1/… oder nativ /api/…). Nur für nicht gestreamte Antworten."""
    import threading
    import urllib.request
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def _weiter(self):
            laenge = int(self.headers.get("content-length") or 0)
            rumpf = self.rfile.read(laenge) if laenge else None
            anfrage = urllib.request.Request(ziel + self.path, data=rumpf, method=self.command,
                                             headers={k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length")})
            try:
                with urllib.request.urlopen(anfrage, timeout=600) as r:
                    status, kopf, daten = r.status, r.headers, r.read()
            except urllib.error.HTTPError as e:
                status, kopf, daten = e.code, e.headers, e.read()
            try:
                j = json.loads(daten)
                if "embed" in self.path:
                    zaehler.embeddings += 1
                else:
                    u = j.get("usage") or {}
                    zaehler.aufrufe += 1
                    zaehler.ein += int(u.get("prompt_tokens") or j.get("prompt_eval_count") or 0)
                    zaehler.aus += int(u.get("completion_tokens") or j.get("eval_count") or 0)
            except Exception:
                pass
            self.send_response(status)
            for k, v in kopf.items():
                if k.lower() not in ("transfer-encoding", "content-length", "connection"):
                    self.send_header(k, v)
            self.send_header("content-length", str(len(daten)))
            self.end_headers()
            self.wfile.write(daten)

        do_GET = do_POST = _weiter

    server = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"
