"""Probe Cognee (selbst betrieben): alles in einem Postgres (relational, pgvector, Graph), lokales Modell über Ollama.

Abbildung: jede App ist ein Cognee-Nutzer mit eigenem Datensatz „<mandant>-<app>“; Mandanten-Trennung über die
Zugriffsrechte von Cognee (ENABLE_BACKEND_ACCESS_CONTROL). Apps derselben Firma bekommen gegenseitig Leserecht.
„eigene“ sucht nur im eigenen Datensatz, „firma“ in allen Datensätzen, die die App lesen darf.
App-Ereignisse und das KI-Gespräch kommen beide als Text hinein; cognify baut daraus den Wissensgraphen.
"""
import asyncio
import os

from gemeinsam import SZENARIO, Uhr, Zaehler, bericht, bewerten, zaehl_proxy

MODELL = os.environ.get("PROBE_MODELL", "mistral-small3.2")
EMBED = os.environ.get("PROBE_EMBED", "bge-m3")
zaehler = Zaehler()
DURCH = zaehl_proxy(zaehler)

PG = {"HOST": "127.0.0.1", "PORT": "55440", "USERNAME": "postgres", "PASSWORD": "probe", "NAME": "cognee"}
os.environ.update({
    **{f"DB_{k}": v for k, v in PG.items()}, "DB_PROVIDER": "postgres",
    **{f"GRAPH_DATABASE_{k}": v for k, v in PG.items()}, "GRAPH_DATABASE_PROVIDER": "postgres",
    "VECTOR_DB_PROVIDER": "pgvector",
    # eine Datenbank, je Datensatz ein Schema (sonst legt Cognee je Datensatz eine eigene Datenbank an)
    "VECTOR_DATASET_DATABASE_HANDLER": "pgvector_shared", "GRAPH_DATASET_DATABASE_HANDLER": "postgres_graph_shared",
    "ENABLE_BACKEND_ACCESS_CONTROL": "true",
    "LLM_PROVIDER": "ollama", "LLM_MODEL": MODELL, "LLM_ENDPOINT": DURCH, "LLM_API_KEY": "ollama",
    "EMBEDDING_PROVIDER": "ollama", "EMBEDDING_MODEL": EMBED, "EMBEDDING_ENDPOINT": f"{DURCH}/api/embed",
    "EMBEDDING_DIMENSIONS": "1024", "HUGGINGFACE_TOKENIZER": "BAAI/bge-m3",
    "TELEMETRY_DISABLED": "1", "COGNEE_SKIP_CONNECTION_TEST": "true",
})

import cognee  # noqa: E402
from cognee.modules.data.methods import get_datasets_by_name  # noqa: E402
from cognee.modules.search.types import SearchType  # noqa: E402
from cognee.modules.users.methods import create_user  # noqa: E402
from cognee.modules.users.permissions.methods import give_permission_on_dataset  # noqa: E402

ANWEISUNG = ("Extrahiere Personen, Firmen, Deals, Termine und Absprachen. Schreibe auf Deutsch und behalte "
             "Telefonnummern, Uhrzeiten, Beträge und Namen wörtlich.")


async def main():
    await cognee.prune.prune_data()
    await cognee.prune.prune_system(metadata=True)
    from cognee.modules.engine.operations.setup import setup
    await setup()

    nutzer, datensatz = {}, {}
    for mandant, apps in SZENARIO["mandanten"].items():
        for app in apps:
            nutzer[app] = await create_user(f"{app}@{mandant}.probe", "probe-passwort", is_verified=True)
            datensatz[app] = f"{mandant}-{app}"

    zeiten = {}
    with Uhr() as u:
        for e in SZENARIO["ereignisse"]:
            await cognee.add(f"[{e['art']} · {e['objekt']}] {e['text']}", dataset_name=datensatz[e["app"]],
                             user=nutzer[e["app"]], node_set=[e["objekt"]])
        g = SZENARIO["gespraech"]
        verlauf = "\n".join(f"{'Nutzer' if n['role'] == 'user' else 'Assistent'}: {n['content']}" for n in g["nachrichten"])
        await cognee.add(f"[Gespräch · {g['objekt']}]\n{verlauf}", dataset_name=datensatz[g["app"]],
                         user=nutzer[g["app"]], node_set=[g["objekt"]])
    zeiten["add_s"] = u.s

    with Uhr() as u:
        for app, name in datensatz.items():
            await cognee.cognify(datasets=[name], user=nutzer[app], custom_prompt=ANWEISUNG)
    zeiten["cognify_s"] = u.s
    nach_cognify = zaehler.stand()

    # Leserecht innerhalb der Firma: gg ↔ desk
    ids = {app: (await get_datasets_by_name([name], nutzer[app].id))[0].id for app, name in datensatz.items()}
    for mandant, apps in SZENARIO["mandanten"].items():
        for a in apps:
            for b in apps:
                if a != b:
                    await give_permission_on_dataset(nutzer[a], ids[b], "read")

    fragen = []
    with Uhr() as u:
        for f in SZENARIO["fragen"]:
            erlaubt = [ids[f["app"]]] if f["bereich"] == "eigene" else [ids[a] for a in SZENARIO["mandanten"][f["mandant"]]]
            antwort = await cognee.search(query_text=f["frage"], query_type=SearchType.GRAPH_COMPLETION,
                                          user=nutzer[f["app"]], dataset_ids=erlaubt, top_k=10)
            texte = [str(a.get("search_result", a)) if isinstance(a, dict) else str(a) for a in (antwort or [])]
            fragen.append({**f, "treffer": [{"text": t[:500]} for t in texte], "bewertung": bewerten(f, texte)})
        # Gegenprobe Trennung: desk versucht ausdrücklich den Datensatz der fremden Firma
        try:
            fremd = await cognee.search(query_text="Anna Beispiel", query_type=SearchType.CHUNKS,
                                        user=nutzer["desk"], dataset_ids=[ids["fremd"]])
            trennung = {"zugriff_moeglich": bool(fremd), "antwort": str(fremd)[:200]}
        except Exception as e:  # erwartet: keine Berechtigung
            trennung = {"zugriff_moeglich": False, "fehler": type(e).__name__}
    zeiten["fragen_s"] = u.s

    bericht(f"cognee-{MODELL.replace(':', '_')}-{EMBED}", {
        "engine": "cognee", "modell": MODELL, "embedding": EMBED, "zeiten": zeiten,
        "verbrauch": zaehler.stand(), "verbrauch_nach_cognify": nach_cognify,
        "trennung_fremder_datensatz": trennung, "fragen": fragen,
    })
    print("Trennung (desk → fremde Firma):", trennung)


if __name__ == "__main__":
    asyncio.run(main())
