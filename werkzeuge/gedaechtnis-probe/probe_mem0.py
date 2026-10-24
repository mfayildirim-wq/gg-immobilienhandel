"""Probe Mem0 (OSS, selbst betrieben): Postgres+pgvector, lokales Modell über Ollama.

Abbildung: Mandant = user_id, App = agent_id, Bezug (gg:makler:…) und Art als metadata.
„eigene“ sucht mit user_id+agent_id, „firma“ nur mit user_id (= App liest die Einträge anderer Apps der Firma).
App-Ereignisse kommen wörtlich hinein (infer=False), das KI-Gespräch mit Faktenextraktion (infer=True).
"""
import os
import sys

from gemeinsam import SZENARIO, Uhr, Zaehler, bericht, bewerten, ollama_zaehlen

MODELL = os.environ.get("PROBE_MODELL", "mistral-small3.2")
EMBED = os.environ.get("PROBE_EMBED", "bge-m3")
DIMS = {"bge-m3": 1024, "nomic-embed-text": 768}[EMBED]
zaehler = Zaehler()
ollama_zaehlen(zaehler)

from mem0 import Memory  # noqa: E402  (nach dem Umhüllen von Ollama)

KONFIG = {
    "vector_store": {"provider": "pgvector", "config": {
        "connection_string": "postgresql://postgres:probe@127.0.0.1:55440/probe",
        "collection_name": f"mem0_{EMBED.replace('-', '_')}", "embedding_model_dims": DIMS}},
    "llm": {"provider": "ollama", "config": {"model": MODELL, "temperature": 0, "ollama_base_url": "http://localhost:11434"}},
    "embedder": {"provider": "ollama", "config": {"model": EMBED, "embedding_dims": DIMS, "ollama_base_url": "http://localhost:11434"}},
    # Fakten in der Sprache des Gesprächs (sonst schreibt das Modell mal Englisch, mal Deutsch)
    "custom_instructions": "Schreibe jeden Fakt auf Deutsch, knapp und mit vollem Namen der Person oder des Deals. Behalte Telefonnummern, Uhrzeiten, Beträge und Namen wörtlich.",
    "history_db_path": str(__import__("pathlib").Path(__file__).parent / "ergebnisse" / "mem0-history.db"),
}


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

    bericht(f"mem0-{MODELL.replace(':', '_')}-{EMBED}", {
        "engine": "mem0", "modell": MODELL, "embedding": EMBED, "zeiten": zeiten,
        "verbrauch": zaehler.stand(), "verbrauch_nach_ereignissen": nach_ereignissen,
        "gespraech_fakten": gespraech_fakten, "fragen": fragen,
    })
    print("Fakten aus dem Gespräch:", *gespraech_fakten, sep="\n  - ")


if __name__ == "__main__":
    main()
