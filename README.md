# school TT allotment — AY 2026-27

Full-stack timetable management system for an Indian school.
15 classes · 21 teachers · CP-SAT auto-allocation.

---

## Stack

| Layer | Tech |
|---|---|
| Database | PostgreSQL (Docker / **AWS RDS** / **Supabase** — switchable via `DATABASE_URL`) |
| Backend | **Python · FastAPI · Uvicorn** · JWT · RBAC |
| Solver | Python · OR-Tools CP-SAT (in-process) |
| Frontend | React · Vite · React Router |
| Runtime | Docker + Docker Compose (dev & prod) |

### What's included

- 🔐 **Two-step auth + Captcha** — step 1 verifies the username/password; only on
  success is an image captcha (random A–Z PNG) shown; step 2 verifies the captcha
  and signs in. The captcha never appears for a wrong password. The password step
  returns a short-lived signed challenge so the password isn't resent.
- 🎨 **Professional UI** — Inter/Lexend typography, an indigo school theme, reusable
  popups, and a blocking loading overlay during allotment. The allocation summary
  opens in a modal (not inline in the pre-check). Class-teacher period targets
  respect what's *attainable* (e.g. a CT who can only teach 5 periods in their class
  isn't wrongly flagged as needing 6).
- 👮 **RBAC** — `admin` and `user` roles. Admins get a **Users** screen to create users
  (username / password / role) and full CRUD.
- 🌱 **Seeded admin** — created automatically on startup from `ADMIN_USERNAME` /
  `ADMIN_PASSWORD` (defaults `admin` / `admin`, configurable in `.env`).
- 🚦 **Rate limiting** — on the login and captcha endpoints (configurable).
- 🐘 **PostgreSQL** — switch between Docker, AWS RDS and Supabase by changing one
  variable (`DATABASE_URL`).
- 🐳 **Docker** — identical dev and prod stacks (prod with more resources).

---

## Project structure

```
School-Time-Table-Allotment/
├── .env.example                    — template (copy → .env.dev or .env.prod)
├── .env.dev / .env.prod            — your secrets (git-ignored)
├── docker-compose.dev.yml          — dev stack (smaller resource limits)
├── docker-compose.prod.yml         — prod stack (full resource limits)
│
├── scripts/
│   ├── dev/  { start.sh, stop.sh } — start/stop the dev stack
│   └── prod/ { start.sh, stop.sh } — start/stop the prod stack
│
├── database/
│   ├── schema.sql                  — tables, triggers, RBAC `users` table
│   └── seeds/                      — subjects / teachers / classes / allocations
│
├── backend/                        — FastAPI app (layered for production)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 — app wiring, CORS, routers, health
│       ├── core/                   — config, security (JWT/bcrypt/RBAC), rate limiting
│       ├── db/                     — database pool + query helpers, startup bootstrap
│       ├── services/               — solver, solver_bridge, captcha,
│       │                             allocation validation, serialization
│       ├── schemas/                — pydantic request/response models
│       └── api/routers/            — auth, users, dashboard, teachers, classes,
│                                     subjects, timetable, absences,
│                                     allocations, allocate
│
└── frontend/                       — React + Vite SPA (nginx in Docker)
    ├── Dockerfile / nginx.conf
    └── src/ … (adds captcha login step + admin Users page)
```

---

## Quick start (Docker)

### Development

```bash
cp .env.example .env.dev      # first time only — then edit secrets
./scripts/dev/start.sh        # builds & starts db + api + web (.env.dev)
# Frontend : http://localhost:3000
# API      : http://localhost:4000/api/health
./scripts/dev/stop.sh         # stop  (add --wipe to drop the DB volume)
```

### Production

```bash
cp .env.example .env.prod     # first time only
# edit .env.prod — replace every CHANGE_ME secret
./scripts/prod/start.sh       # builds & starts db + api + web (.env.prod)
# Frontend : http://localhost
./scripts/prod/stop.sh
```

Login with the seeded admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, default `admin` / `admin`).
On the password field blur, a captcha appears — type the letters to sign in.

---

## Switching the database (Supabase ⇄ AWS RDS)

Edit **only** `DATABASE_URL` in `.env.dev` / `.env.prod`:

```bash
# Bundled Docker Postgres (default)
DATABASE_URL=postgresql://erp:erp_password@db:5432/school_erp
# AWS RDS
DATABASE_URL=postgresql://USER:PASS@xxxx.rds.amazonaws.com:5432/school_erp?sslmode=require
# Supabase
DATABASE_URL=postgresql://postgres:PASS@db.YOURREF.supabase.co:5432/postgres
```

With `AUTO_INIT_DB=true` the API applies the schema and seeds the admin user on
startup against whichever database `DATABASE_URL` points to.

---

## Local dev without Docker (optional)

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://erp:erp_password@localhost:5432/school_erp
export JWT_SECRET=dev-secret ADMIN_USERNAME=admin ADMIN_PASSWORD=admin
uvicorn app.main:app --reload --port 4000

# Frontend
cd frontend && npm install && npm run dev      # http://localhost:3000
```

---

## Feature overview

| Page | What you do |
|---|---|
| Dashboard | Overview — absent teachers today, quick stats |
| Timetable | View class/teacher/master timetable grid; master-cell editing |
| Absences | Mark teachers absent, assign period-by-period substitutes |
| Curriculum | Edit subject period requirements; assign class teachers |
| Allocations | Define who teaches what where; validate; auto-generate (CP-SAT) |
| Teachers | Manage teacher profiles, subjects, workload targets |
| Allotment | **One-click Auto Allotment** (generate + schedule + apply), or schedule saved allocations |
| **Users** *(admin)* | Create users (username/password/role) + full CRUD |

### One-click Auto Allotment

The Allotment page has a single **Auto Allotment** button that runs the whole
pipeline — generate allocations (Phase A) → schedule into the grid (Phase B) →
apply to the timetable — in one step. If a freshly generated allocation can't be
scheduled under the hard rules, it automatically falls back to scheduling your
existing saved allocations, so one click reliably produces a timetable. The
two-step flow (edit on **Allocations**, then **Schedule Saved Allocations**)
remains for when you want to preserve manually tuned allocations.

### Same teacher/subject in the same period every day (best-effort)

The scheduler keeps the same teacher + subject in the same daily period as much
as possible, so teachers follow a stable routine (toggle with
`SAME_PERIOD_CONSISTENCY`). A *strict* fixed column isn't always possible — a
subject whose weekly total isn't a multiple of 6 (e.g. English = 9) can't fill
one period across all 6 days — so this is a strong soft preference applied on top
of the hard rules R1–R5, not a rule that could make the timetable infeasible.

---

## Timetable rules (CP-SAT)

| Rule | Description |
|---|---|
| R1 | Class teacher teaches Period 1 in their own class |
| R2 | Diary is the last period for Classes 1–2 |
| R3 | A teacher is never double-booked |
| R4 | Teacher `min_period_start` respected |
| R5 | Max 2 periods of the same subject per day |

---

## Key data

- 21 teachers · 15 classes · 720 periods/week (15 × 48)
- Classes: 1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B, 5, 6A, 6B, 7, 8, 9, 10
- 6 days/week · 8 periods/day
- Solver: OR-Tools CP-SAT (time limit & workers configurable via env)

See **[DEPLOY.md](./DEPLOY.md)** for cloud deployment notes.
