# syntax=docker/dockerfile:1

# TenXLab AI plane (FastAPI): plagiarism, quality, speech, webhook verify.
# Build context is the repository root:
#   docker build -f services/ai/Dockerfile .

FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY services/ai/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ai/app ./app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
