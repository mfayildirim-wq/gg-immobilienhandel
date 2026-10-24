"""Durchlauf gegen den laufenden Dienst (echtes Mem0): App-Ereignisse, KI-Gespräch, Ersetzen, Freigaben, MCP, Protokoll.
Aufruf: uv run python rauchtest.py [http://127.0.0.1:8800]   — braucht Zugänge gg, desk, fremd, claude (zugang_erzeugen.py)."""
import json
import sys
from pathlib import Path

import httpx

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8800"
S = json.loads((Path(__file__).parent / ".schluessel.local.json").read_text())
ok = True


def als(wer, methode, pfad, **k):
    r = httpx.request(methode, URL + pfad, headers={"authorization": f"Bearer {S[wer]}"}, timeout=300, **k)
    return r.json()


def pruefe(name, bedingung, info=""):
    global ok
    ok &= bool(bedingung)
    print(("✔ " if bedingung else "✘ ") + name + (f"  → {info}" if info and not bedingung else ""))


# frisch anfangen: eigene Einträge der Test-Apps löschen
for wer in ("gg", "desk", "fremd", "claude"):
    for e in als(wer, "GET", "/v1/eintraege")["eintraege"]:
        if e["app"] == {"claude": "claude"}.get(wer, wer):
            als(wer, "DELETE", f"/v1/eintraege/{e['id']}")

A = "gg:makler:anna-beispiel"
als("gg", "POST", "/v1/ereignis", json={"text": "Makler Anna Beispiel (Musterhaus Immobilien GmbH) hat die Mobilnummer 0171 5550001.", "objekt": A, "art": "mobil"})
als("gg", "POST", "/v1/ereignis", json={"text": "Makler Bernd Muster: Priorität A.", "objekt": "gg:makler:bernd-muster", "art": "prioritaet"})
als("desk", "POST", "/v1/ereignis", json={"text": "Termin mit Anna Beispiel am 30.10.2026 um 11 Uhr im Büro Stuttgart.", "objekt": A, "art": "termin"})
als("fremd", "POST", "/v1/ereignis", json={"text": "Anna Beispiel sucht eine 3-Zimmer-Wohnung in Ulm.", "objekt": "fremd:kontakt:anna", "art": "notiz"})
r = als("gg", "POST", "/v1/merken", json={"objekt": A, "nachrichten": [
    {"role": "user", "content": "Telefonat mit Anna Beispiel: Sie möchte nur telefonisch kontaktiert werden, nie vor 10 Uhr."},
    {"role": "assistant", "content": "Notiert."}]})
pruefe("merken: Fakt aus dem Gespräch", any("10 Uhr" in x["text"] for x in r["neu"]), r)

texte = lambda wer, frage, **x: " | ".join(t["text"] for t in als(wer, "POST", "/v1/suchen", json={"frage": frage, **x})["treffer"])
t = texte("gg", "Wie erreiche ich Anna Beispiel?", anzahl=3)
pruefe("gg findet die Absprache", "10 Uhr" in t, t)
t = texte("gg", "Wann ist der Termin mit Anna Beispiel?", anzahl=3)
pruefe("gg liest desk (freigegeben)", "30.10" in t, t)
t = texte("desk", "Welche Mobilnummer hat Anna Beispiel?")
pruefe("desk sieht gg nicht (keine Freigabe)", "0171" not in t, t)
t = texte("fremd", "Anna Beispiel")
pruefe("fremde Firma sieht nur eigenes", "Ulm" in t and "0171" not in t and "30.10" not in t, t)

als("gg", "POST", "/v1/ereignis", json={"text": "Makler Bernd Muster: Priorität B.", "objekt": "gg:makler:bernd-muster", "art": "prioritaet"})
t = texte("gg", "Welche Priorität hat Bernd Muster?")
pruefe("Ereignis ersetzt Priorität", "Priorität B" in t and "Priorität A" not in t, t)

r = als("gg", "POST", "/v1/merken", json={"objekt": A, "text": "Anna Beispiel hat eine neue Mobilnummer: 0172 9990002."})
pruefe("merken löst alte Nummer ab", any("0171" in x["text"] for x in r["abgeloest"]), r)
t = texte("gg", "Welche Mobilnummer hat Anna Beispiel?", objekt=A)
pruefe("Suche zeigt nur die neue Nummer", "0172" in t and "die Mobilnummer 0171" not in t, t)

# MCP mit dem Claude-Zugang (alle Apps der Firma lesen)
kopf = {"authorization": f"Bearer {S['claude']}", "accept": "application/json, text/event-stream"}
rpc = lambda i, m, p=None: httpx.post(URL + "/mcp", headers=kopf, json={"jsonrpc": "2.0", "id": i, "method": m, **({"params": p} if p else {})}, timeout=300).json()
init = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "rauchtest", "version": "1"}})
pruefe("MCP initialize", init.get("result", {}).get("serverInfo", {}).get("name") == "gedaechtnis", init)
r = rpc(2, "tools/call", {"name": "suchen", "arguments": {"frage": "Was wissen wir über Anna Beispiel?"}})
inhalt = r.get("result", {}).get("content", [{}])[0].get("text", "")
pruefe("MCP suchen über alle Apps der Firma", "30.10" in inhalt and "10 Uhr" in inhalt and "Ulm" not in inhalt, inhalt[:300])

prot = als("gg", "GET", "/v1/protokoll", params={"anzahl": 50})["protokoll"]
pruefe("Protokoll führt Buch", {"ereignis", "merken", "suchen"} <= {p["aktion"] for p in prot}, prot[:3])
print("\nALLES GUT" if ok else "\nFEHLER")
sys.exit(0 if ok else 1)
