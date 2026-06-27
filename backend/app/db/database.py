"""Thin PostgreSQL access layer (psycopg2 + dict rows + a small connection pool).

Replaces the Supabase JS client. Every query returns plain dicts/lists so the
route handlers read very close to the original Node/Supabase code.
"""
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from app.core.config import settings

psycopg2.extras.register_uuid()

_pool: ThreadedConnectionPool | None = None


def init_pool():
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=settings.DB_POOL_MAX,
            dsn=settings.database_url,
        )
    return _pool


def close_pool():
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn():
    pool = init_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()


def query(sql: str, params=None):
    """Run a SELECT, return list[dict]."""
    with get_cursor() as cur:
        cur.execute(sql, params or [])
        return [dict(r) for r in cur.fetchall()]


def query_one(sql: str, params=None):
    """Run a SELECT, return first dict or None."""
    with get_cursor() as cur:
        cur.execute(sql, params or [])
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql: str, params=None):
    """Run a write statement. Returns rowcount."""
    with get_cursor() as cur:
        cur.execute(sql, params or [])
        return cur.rowcount


def execute_returning(sql: str, params=None):
    """Run a write statement with RETURNING — return first dict or None."""
    with get_cursor() as cur:
        cur.execute(sql, params or [])
        row = cur.fetchone()
        return dict(row) if row else None


def execute_returning_all(sql: str, params=None):
    with get_cursor() as cur:
        cur.execute(sql, params or [])
        return [dict(r) for r in cur.fetchall()]
