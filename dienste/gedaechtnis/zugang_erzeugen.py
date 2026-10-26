"""Legt einen Zugang an: erzeugt einen Schlüssel, schreibt ihn nach .schluessel.local.json (nur hier, nicht ins Repo)
und den Hash nach .env.local (GEDAECHTNIS_ZUGAENGE). Aufruf: uv run python zugang_erzeugen.py <label> <mandant> <app> [lesen,…|*] [nur-lesen]
Mit ZIEL=server landen Schlüssel und Hashes in .schluessel.server.json und .env.server (für den Server, siehe README)."""
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

HIER = Path(__file__).parent
ZIEL = os.environ.get("ZIEL", "local")
label, mandant, app = sys.argv[1:4]
lesen = [x for x in (sys.argv[4] if len(sys.argv) > 4 else "").split(",") if x]
schreiben = "nur-lesen" not in sys.argv[5:]
schluessel = secrets.token_hex(32)

env = HIER / f".env.{ZIEL}"
zeilen = env.read_text().splitlines() if env.exists() else []
alt = next((json.loads(z.split("=", 1)[1].strip("'")) for z in zeilen if z.startswith("GEDAECHTNIS_ZUGAENGE=")), [])
alt = [z for z in alt if z["label"] != label] + [{"label": label, "mandant": mandant, "app": app, "lesen": lesen,
                                                    "schreiben": schreiben, "sha256": hashlib.sha256(schluessel.encode()).hexdigest()}]
zeilen = [z for z in zeilen if not z.startswith("GEDAECHTNIS_ZUGAENGE=")] + [f"GEDAECHTNIS_ZUGAENGE='{json.dumps(alt)}'"]
env.write_text("\n".join(zeilen) + "\n")

ablage = HIER / f".schluessel.{ZIEL}.json"
schl = json.loads(ablage.read_text()) if ablage.exists() else {}
schl[label] = schluessel
ablage.write_text(json.dumps(schl, indent=1))
print(f"Zugang {label} ({mandant}/{app}, lesen={lesen or '-'}, schreiben={schreiben}) angelegt; Schlüssel in {ablage.name}")
