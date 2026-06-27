"""Database bootstrap — apply schema, seed the configurable admin, optional demo data.

Runs on API startup when AUTO_INIT_DB is true and is fully idempotent:

* `schema.sql` is `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE` only — it never
  drops or truncates existing tables, so live data is preserved.
* The admin user is inserted only if that username does not already exist.
* Demo data is loaded only when SEED_DEMO_DATA=true AND the database is completely
  empty (no subjects, teachers or classes), so it can never overwrite real data.
"""
import os

from app.core.config import settings
from app.core.security import hash_password
from app.db import database as db


def _init_dir() -> str:
    explicit = os.getenv("DB_INIT_DIR")
    if explicit:
        return explicit
    # app/db/bootstrap.py — walk up looking for a sibling/parent `database/` dir.
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "..", "..", "database"),        # /app/database (Docker)
        os.path.join(here, "..", "..", "..", "database"),   # repo/database (local)
        os.path.join(here, "..", "..", "..", "..", "database"),
    ]
    for candidate in candidates:
        if os.path.isdir(candidate):
            return os.path.abspath(candidate)
    return os.path.abspath(candidates[0])


def _run_sql_file(path: str):
    with open(path, "r", encoding="utf-8") as fh:
        sql = fh.read()
    with db.get_cursor() as cur:
        cur.execute(sql)


def apply_schema():
    schema = os.path.join(_init_dir(), "schema.sql")
    if os.path.exists(schema):
        print(f"[init-db] applying schema: {schema}")
        _run_sql_file(schema)
    else:
        print(f"[init-db] WARNING: schema.sql not found at {schema}")


def seed_admin():
    """Ensure the configurable admin account exists (username/password from .env)."""
    username = settings.ADMIN_USERNAME
    existing = db.query_one("SELECT id FROM users WHERE username = %s", [username])
    if existing:
        print(f"[init-db] admin user '{username}' already present")
        return
    db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (%s, %s, 'admin')",
        [username, hash_password(settings.ADMIN_PASSWORD)],
    )
    print(f"[init-db] seeded admin user '{username}'")


def _database_is_empty() -> bool:
    for table in ("subjects", "teachers", "classes"):
        if (db.query_one(f"SELECT COUNT(*) AS c FROM {table}") or {}).get("c", 0) > 0:
            return False
    return True


def seed_demo_data():
    """Load sample data ONLY into a completely empty database (never overwrites)."""
    if not _database_is_empty():
        print("[init-db] demo data skipped (database already contains data)")
        return
    seeds_dir = os.path.join(_init_dir(), "seeds")
    for fname in ("02_subjects.sql", "03_teachers.sql", "04_classes.sql", "05_allocations.sql"):
        path = os.path.join(seeds_dir, fname)
        if os.path.exists(path):
            print(f"[init-db] seeding {fname}")
            _run_sql_file(path)


def initialize():
    if not settings.AUTO_INIT_DB:
        print("[init-db] AUTO_INIT_DB disabled — skipping bootstrap")
        return
    apply_schema()
    seed_admin()
    if settings.SEED_DEMO_DATA:
        seed_demo_data()
