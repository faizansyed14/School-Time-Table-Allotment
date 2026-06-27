"""Central configuration — every value comes from the environment (.env).

No secrets or environment-specific values are hard-coded: defaults exist only
for safe local development and are validated for production in `assert_production_safe`.
"""
import os


def _split_csv(value: str):
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def _bool(name: str, default: str) -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes", "on")


class Settings:
    # ── Environment ─────────────────────────────────────────────
    NODE_ENV = os.getenv("NODE_ENV", "development")

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV.lower() == "production"

    # ── Database: the single switch (docker / AWS RDS / Supabase) ─
    DB_PROVIDER = os.getenv("DB_PROVIDER", "postgres")  # informational only
    DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "10"))

    @property
    def database_url(self) -> str:
        url = os.getenv("DATABASE_URL", "").strip()
        if url:
            return url
        host = os.getenv("DB_HOST", "localhost")
        port = os.getenv("DB_PORT", "5432")
        name = os.getenv("DB_NAME", "school_erp")
        user = os.getenv("DB_USER", "postgres")
        password = os.getenv("DB_PASSWORD", "postgres")
        sslmode = os.getenv("DB_SSLMODE", "")
        url = f"postgresql://{user}:{password}@{host}:{port}/{name}"
        if sslmode:
            url += f"?sslmode={sslmode}"
        return url

    # ── Auth ────────────────────────────────────────────────────
    JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "7"))
    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

    # ── CORS ────────────────────────────────────────────────────
    @property
    def cors_origins(self):
        configured = _split_csv(os.getenv("CORS_ORIGIN", ""))
        if configured:
            return configured
        # Dev convenience only — never used in production (CORS_ORIGIN required there).
        if not self.is_production:
            return ["http://localhost:3000", "http://127.0.0.1:3000"]
        return []

    # ── Server ──────────────────────────────────────────────────
    PORT = int(os.getenv("PORT", "4000"))

    # ── Solver ──────────────────────────────────────────────────
    SOLVER_TIME_LIMIT = int(os.getenv("SOLVER_TIME_LIMIT", "60"))
    SOLVER_WORKERS = int(os.getenv("SOLVER_WORKERS", "8"))
    # Best-effort: keep the same teacher/subject in the same period every day.
    SAME_PERIOD_CONSISTENCY = _bool("SAME_PERIOD_CONSISTENCY", "true")

    # ── Captcha ─────────────────────────────────────────────────
    CAPTCHA_LENGTH = int(os.getenv("CAPTCHA_LENGTH", "6"))
    CAPTCHA_TTL_SECONDS = int(os.getenv("CAPTCHA_TTL_SECONDS", "300"))

    # ── Rate limiting ───────────────────────────────────────────
    RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "10/minute")
    RATE_LIMIT_CAPTCHA = os.getenv("RATE_LIMIT_CAPTCHA", "30/minute")

    # ── DB bootstrap ────────────────────────────────────────────
    AUTO_INIT_DB = _bool("AUTO_INIT_DB", "true")
    SEED_DEMO_DATA = _bool("SEED_DEMO_DATA", "false")

    # ── Safety checks ───────────────────────────────────────────
    def assert_production_safe(self):
        """Fail fast if production is started with insecure defaults."""
        if not self.is_production:
            return
        problems = []
        if "change-me" in self.JWT_SECRET.lower() or len(self.JWT_SECRET) < 16:
            problems.append("JWT_SECRET must be a long random value")
        if self.ADMIN_PASSWORD in ("admin", "", "CHANGE_ME_STRONG_ADMIN_PASS"):
            problems.append("ADMIN_PASSWORD must be changed from the default")
        if not os.getenv("DATABASE_URL") and not os.getenv("DB_PASSWORD"):
            problems.append("DATABASE_URL (or DB_PASSWORD) must be set")
        if not self.cors_origins:
            problems.append("CORS_ORIGIN must list the allowed frontend origin(s)")
        if problems:
            raise RuntimeError("Insecure production configuration: " + "; ".join(problems))


settings = Settings()
