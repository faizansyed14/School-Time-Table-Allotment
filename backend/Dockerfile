# school TT allotment — Python (FastAPI) API
# Build context is the REPO ROOT (so the database/ folder is available for
# the startup schema bootstrap).  See docker-compose.*.yml.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Fonts for the captcha renderer
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + database schema/seeds
COPY backend/app ./app
COPY database ./database

EXPOSE 4000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-4000}"]
