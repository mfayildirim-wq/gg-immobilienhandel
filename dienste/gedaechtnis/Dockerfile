# Gedächtnis-Dienst für den Server: Haiku (Anthropic) für Fakten, fastembed (ONNX, im Prozess) für Embeddings
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy FASTEMBED_CACHE_PATH=/modelle PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# Embedding-Modell ins Image, damit der Start nicht vom Download abhängt
ARG EMBED=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('$EMBED', cache_dir='/modelle')"
COPY gedaechtnis ./gedaechtnis
ENV GEDAECHTNIS_LLM=anthropic GEDAECHTNIS_EMBED_ANBIETER=fastembed GEDAECHTNIS_EMBED=$EMBED \
    GEDAECHTNIS_VERLAUF=/daten/verlauf.db MEM0_DIR=/daten/mem0 MEM0_TELEMETRY=False
EXPOSE 8800
CMD ["uvicorn", "--factory", "gedaechtnis.dienst:erzeuge", "--host", "0.0.0.0", "--port", "8800", "--proxy-headers", "--forwarded-allow-ips", "*"]
