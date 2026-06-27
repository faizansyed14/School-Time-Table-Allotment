# Deployment

The app ships as three containers — **db** (Postgres), **api** (FastAPI) and
**web** (nginx) — orchestrated by Docker Compose. The database is switchable
between the bundled Postgres, **AWS RDS** and **Supabase** via `DATABASE_URL`.

---

## 1. Docker (recommended)

### Development
```bash
./scripts/dev/start.sh        # uses .env.dev — smaller resource limits
./scripts/dev/stop.sh         # --wipe also drops the DB volume
```

### Production
```bash
# 1. Edit .env.prod and replace every CHANGE_ME secret
#    (JWT_SECRET, POSTGRES_PASSWORD/DATABASE_URL, ADMIN_PASSWORD, CORS_ORIGIN)
./scripts/prod/start.sh       # uses .env.prod — full resource limits
./scripts/prod/stop.sh
```

| Service | Dev port | Prod port |
|---|---|---|
| web (frontend) | 3000 | 80 |
| api (FastAPI)  | 4000 | 4000 |
| db (Postgres)  | 5432 | internal |

Dev and prod stacks are structurally identical; only the resource limits
(`deploy.resources.limits` in the compose files) and secrets differ.

---

## 2. Using AWS RDS or Supabase instead of the bundled Postgres

Edit `DATABASE_URL` in the relevant `.env` file:

```bash
# AWS RDS
DATABASE_URL=postgresql://USER:PASS@xxxx.rds.amazonaws.com:5432/school_erp?sslmode=require
# Supabase
DATABASE_URL=postgresql://postgres:PASS@db.YOURREF.supabase.co:5432/postgres
```

The `db` service can then be left running (unused) or removed from the compose
file. On first boot the API applies `database/schema.sql` and seeds the admin
user automatically (`AUTO_INIT_DB=true`).

---

## 3. Render (optional, managed)

`render.yaml` deploys the FastAPI API (Python runtime) + the static frontend.
Provide a managed database via the `DATABASE_URL` env var (AWS RDS / Supabase),
set `ADMIN_PASSWORD`, `CORS_ORIGIN`, and `VITE_API_URL` (the API URL, no trailing
slash) on the static site.

---

## 4. Environment variables

| Key | Purpose |
|---|---|
| `DATABASE_URL` | **The DB switch** (docker / RDS / Supabase) |
| `JWT_SECRET` | Token signing secret |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeded admin login |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins |
| `AUTO_INIT_DB` | Apply schema + seed admin on startup |
| `SEED_DEMO_DATA` | Load demo subjects/teachers/classes when DB empty |
| `RATE_LIMIT_LOGIN` / `RATE_LIMIT_CAPTCHA` | e.g. `5/minute` |
| `CAPTCHA_LENGTH` / `CAPTCHA_TTL_SECONDS` | Captcha config |
| `SOLVER_TIME_LIMIT` / `SOLVER_WORKERS` | CP-SAT tuning |
| `SAME_PERIOD_CONSISTENCY` | Keep same teacher/subject in the same period daily (`true`/`false`) |
| `VITE_API_URL` | Frontend → API base (build-time) |

## Data safety / does it re-seed?

Startup is **non-destructive and idempotent**:

- `schema.sql` is `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE` only — it never
  drops or truncates tables.
- The admin user is inserted only if that username doesn't already exist.
- Demo data loads **only when `SEED_DEMO_DATA=true` AND the database is completely
  empty** (no subjects/teachers/classes). `.env.prod` sets `SEED_DEMO_DATA=false`.

So restarting the containers does **not** re-seed or overwrite live data. The
Docker volume persists data across restarts; only `stop.sh --wipe` (`down -v`)
deletes it. Starting in `NODE_ENV=production` with default/weak secrets fails fast
via a built-in safety check.

---

## 5. Verify

1. `http://localhost:4000/api/health` → `{"status":"ok","adminReady":true}`
2. Open the frontend → sign in as `admin` / `admin` (or your configured admin).
   Enter the captcha shown after the password field.
3. As admin, open **Users** to create additional users with roles.

---

## Troubleshooting

- **Login captcha fails:** captcha is single-use and expires after
  `CAPTCHA_TTL_SECONDS`; click refresh to get a new one.
- **CORS / failed fetch:** `VITE_API_URL` must match the API URL, and the API's
  `CORS_ORIGIN` must include the frontend origin.
- **DB connection errors:** verify `DATABASE_URL` (and `sslmode=require` for RDS/Supabase).
