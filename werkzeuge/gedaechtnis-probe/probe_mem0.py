"""Probe Mem0 (OSS, selbst betrieben): Postgres+pgvector, lokales Modell über Ollama.

Abbildung: Mandant = user_id, App = agent_id, Bezug (gg:makler:…) und Art als metadata.
„eigene“ sucht mit user_id+agent_id, „firma“ nur mit user_id (= App liest die Einträge anderer Apps der Firma).
App-Ereignisse kommen wörtlich hinein (infer=False), das KI-Gespräch mit Faktenextraktion (infer=True).
"""
import os
import sys

from gemeinsam import SZENARIO, Uhr, Zaehler, anthropic_zaehlen, bericht, bewerten, ollama_zaehlen

ANBIETER = os.environ.get("PROBE_LLM", "ollama")  # ollama | anthropic
MODELL = os.environ.get("PROBE_MODELL", "claude-haiku-4-5" if ANBIETER == "anthropic" else "mistral-small3.2")
EMBED = os.environ.get("PROBE_EMBED", "bge-m3")
DIMS = {"bge-m3": 1024, "nomic-embed-text": 768}[EMBED]
zaehler = Zaehler()
ollama_zaehlen(zaehler)
if ANBIETER == "anthropic":
    anthropic_zaehlen(zaehler)

from mem0 import Memory  # noqa: E402  (nach dem Umhüllen von Ollama)

KONFIG = {
    "vector_store": {"provider": "pgvector", "config": {
        "connection_string": "postgresql://postgres:probe@127.0.0.1:55440/probe",
        "collection_name": f"mem0_{EMBED.replace('-', '_')}", "embedding_model_dims": DIMS}},
    "llm": {"provider": "anthropic", "config": {"model": MODELL, "temperature": 0}} if ANBIETER == "anthropic"
    else {"provider": "ollama", "config": {"model": MODELL, "temperature": 0, "ollama_base_url": "http://localhost:11434"}},
    "embedder": {"provider": "ollama", "config": {"model": EMBED, "embedding_dims": DIMS, "ollama_base_url": "http://localhost:11434"}},
    # Fakten in der Sprache des Gesprächs (sonst schreibt das Modell mal Englisch, mal Deutsch)
    "custom_instructions": "Schreibe jeden Fakt auf Deutsch, knapp und mit vollem Namen der Person oder des Deals. Behalte Telefonnummern, Uhrzeiten, Beträge und Namen wörtlich.",
    "history_db_path": str(__import__("pathlib").Path(__file__).parent / "ergebnisse" / "mem0-history.db"),
}


def widersprueche_aufloesen(m, neue: list[dict], filt: dict, objekt: str) -> list[dict]:
    """Schicht vor Mem0 (2.x legt nur noch an): bestehende Einträge zum selben Bezug, die ein neuer Fakt
    ausdrücklich ablöst, bekommen ein Ablaufdatum (nicht gelöscht, Verlauf bleibt). Ein kleiner KI-Aufruf je Ablage."""
    import json as _json
    bestehend = [x for x in m.get_all(filters=filt).get("results", [])
                 if (x.get("metadata") or {}).get("objekt") == objekt and x["id"] not in {n["id"] for n in neue}]
    if not bestehend or not neue:
        return []
    liste = "\n".join(f'{i}: {x["memory"]}' for i, x in enumerate(bestehend))
    neu = "\n".join(n["memory"] for n in neue)
    text = m.llm.generate_response(messages=[{"role": "user", "content":
        f"Bestehende Einträge:\n{liste}\n\nNeue Fakten:\n{neu}\n\nWelche bestehenden Einträge sind durch die neuen Fakten "
        "überholt (gleiche Angabe, neuer Wert)? Nur eindeutige Fälle. Antworte nur als JSON {\"ueberholt\": [Nummern]}."}])
    treffer = __import__("re").search(r"\{.*\}", text if isinstance(text, str) else str(text), __import__("re").S)
    nummern = _json.loads(treffer.group(0)).get("ueberholt", []) if treffer else []
    abgeloest = [bestehend[i] for i in nummern if isinstance(i, int) and 0 <= i < len(bestehend)]
    gestern = (__import__("datetime").date.today() - __import__("datetime").timedelta(days=1)).isoformat()
    for x in abgeloest:
        m.update(x["id"], metadata={**(x.get("metadata") or {}), "abgeloest": True}, expiration_date=gestern)
    return [{"abgeloest": x["memory"]} for x in abgeloest]


def main():
    m = Memory.from_config(KONFIG)
    # frischer Lauf: alles weg
    for mandant in SZENARIO["mandanten"]:
        try:
            m.delete_all(user_id=mandant)
        except Exception as e:  # leerer Bestand beim ersten Lauf
            print("delete_all:", e, file=sys.stderr)

    zeiten = {}
    with Uhr() as u:
        for e in SZENARIO["ereignisse"]:
            m.add(e["text"], user_id=e["mandant"], agent_id=e["app"], infer=False,
                  metadata={"objekt": e["objekt"], "art": e["art"], "quelle": "api"})
    zeiten["ereignisse_s"] = u.s
    nach_ereignissen = zaehler.stand()

    g = SZENARIO["gespraech"]
    with Uhr() as u:
        ergebnis = m.add(g["nachrichten"], user_id=g["mandant"], agent_id=g["app"],
                         metadata={"objekt": g["objekt"], "quelle": "ki"})
    zeiten["gespraech_s"] = u.s
    gespraech_fakten = [r.get("memory") for r in (ergebnis.get("results") or [])]

    fragen = []
    with Uhr() as u:
        for f in SZENARIO["fragen"]:
            filt = {"user_id": f["mandant"]}
            if f["bereich"] == "eigene":
                filt["agent_id"] = f["app"]
            treffer = m.search(f["frage"], filters=filt, top_k=5).get("results", [])
            texte = [t["memory"] for t in treffer]
            fragen.append({**f, "treffer": [{"text": t["memory"], "score": round(t.get("score") or 0, 3),
                                             "app": t.get("agent_id"), "meta": t.get("metadata")} for t in treffer],
                           "bewertung": bewerten(f, texte)})
    zeiten["fragen_s"] = u.s

    # Phase 2: Fakten ersetzen — per KI-Gespräch (infer=True, Mem0 entscheidet ADD/UPDATE/DELETE)
    # und per App-Ereignis. Ereignisse mit Bezug ersetzen den letzten Eintrag gleicher Art am selben Objekt
    # (das macht später unser Dienst; Mem0 selbst gleicht wörtliche Einträge nicht ab).
    aenderungen = []
    with Uhr() as u:
        for a in SZENARIO["aktualisierungen"]:
            if a["weg"] == "gespraech":
                r = m.add(a["nachrichten"], user_id=a["mandant"], agent_id=a["app"], metadata={"objekt": a["objekt"], "quelle": "ki"})
                neue = [{"id": x["id"], "memory": x["memory"]} for x in r.get("results", []) if x.get("id")]
                aenderungen += [{"weg": "gespraech", "event": x.get("event"), "text": x.get("memory")} for x in r.get("results", [])]
                aenderungen += widersprueche_aufloesen(m, neue, {"user_id": a["mandant"], "agent_id": a["app"]}, a["objekt"])
            else:
                alt = [x for x in m.get_all(filters={"user_id": a["mandant"], "agent_id": a["app"]}).get("results", [])
                       if (x.get("metadata") or {}).get("objekt") == a["objekt"] and (x.get("metadata") or {}).get("art") in ("hubspot", a["art"])]
                for x in alt:
                    m.delete(x["id"])
                m.add(a["text"], user_id=a["mandant"], agent_id=a["app"], infer=False,
                      metadata={"objekt": a["objekt"], "art": a["art"], "quelle": "api"})
                aenderungen.append({"weg": "ereignis", "ersetzt": [x["memory"] for x in alt], "text": a["text"]})
        for f in SZENARIO["fragen_nach_aktualisierung"]:
            treffer = m.search(f["frage"], filters={"user_id": f["mandant"], "agent_id": f["app"]}, top_k=5).get("results", [])
            texte = [t["memory"] for t in treffer]
            fragen.append({**f, "treffer": [{"text": t["memory"], "score": round(t.get("score") or 0, 3)} for t in treffer],
                           "bewertung": bewerten(f, texte)})
    zeiten["aktualisierung_s"] = u.s

    bericht(f"mem0-{MODELL.replace(':', '_')}-{EMBED}", {
        "engine": "mem0", "modell": MODELL, "embedding": EMBED, "zeiten": zeiten,
        "verbrauch": zaehler.stand(), "verbrauch_nach_ereignissen": nach_ereignissen,
        "gespraech_fakten": gespraech_fakten, "aenderungen": aenderungen, "fragen": fragen,
    })
    print("Fakten aus dem Gespräch:", *gespraech_fakten, sep="\n  - ")
    print("Änderungen:", *aenderungen, sep="\n  - ")


if __name__ == "__main__":
    main()
