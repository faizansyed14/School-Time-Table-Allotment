"""FastAPI application entrypoint.

Wires together the layered packages:
  core/      — config, security, rate limiting
  db/        — connection pool + startup bootstrap
  services/  — solver, captcha, validation, business logic
  api/routers/ — HTTP route modules
  schemas/   — request/response models
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routers import (absences, allocate, allocations, auth, classes, dashboard,
                             subjects, teachers, timetable, users)
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db import bootstrap
from app.db import database as db


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_production_safe()  # refuse to boot prod with insecure defaults
    db.init_pool()
    try:
        bootstrap.initialize()
    except Exception as e:  # don't crash the API if an external DB isn't reachable yet
        print(f"[startup] DB init skipped/failed: {e}")
    yield
    db.close_pool()


app = FastAPI(title="School ERP API", version="2.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── Routes ───────────────────────────────────────────────────
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(teachers.router, prefix="/api/teachers", tags=["teachers"])
app.include_router(classes.router, prefix="/api/classes", tags=["classes"])
app.include_router(subjects.router, prefix="/api/subjects", tags=["subjects"])
app.include_router(timetable.router, prefix="/api/timetable", tags=["timetable"])
app.include_router(absences.router, prefix="/api/absences", tags=["absences"])
app.include_router(allocations.router, prefix="/api/allocations", tags=["allocations"])
app.include_router(allocate.router, prefix="/api/allocate", tags=["allocate"])


# ── Health ───────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "service": "school-erp-api",
        "status": "ok",
        "health": "/api/health",
        "hint": "Use the static frontend site; API base is /api/...",
    }


@app.get("/api/health")
async def health():
    out = {"status": "ok", "dbConfigured": bool(settings.database_url), "adminReady": False}
    try:
        row = db.query_one("SELECT username FROM users WHERE role = 'admin' LIMIT 1")
        out["adminReady"] = bool(row)
    except Exception as e:
        out["dbError"] = str(e)
    return out
