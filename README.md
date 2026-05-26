# School ERP — AY 2026-27

Full-stack timetable management system for an Indian school. 15 classes · 21 teachers · CP-SAT auto-allocation.

---

## Stack

| Layer | Tech |
|---|---|
| Database | Supabase (PostgreSQL) |
| Backend | Node.js · Express · JWT |
| Solver | Python · OR-Tools CP-SAT |
| Frontend | React · Vite · React Router |

---

## Project Structure

```
school-erp/
├── database/
│   ├── schema.sql              — All tables, triggers, permissions
│   ├── README.md               — Run order & verification queries
│   └── seeds/
│       ├── 01_admin.sql        — Login: admin / admin123
│       ├── 02_subjects.sql     — 14 subjects × 15 class requirements
│       ├── 03_teachers.sql     — 21 teachers with workload targets
│       ├── 04_classes.sql      — 15 classes + class teacher assignments
│       └── 05_allocations.sql  — 143 rows = 720 periods total
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── index.js            — Express entry point
│   │   ├── config/
│   │   │   └── supabase.js
│   │   ├── middleware/
│   │   │   └── auth.js         — JWT bearer guard
│   │   └── routes/
│   │       ├── auth.js         — POST /api/auth/login
│   │       ├── dashboard.js    — GET  /api/dashboard/stats
│   │       ├── teachers.js     — CRUD /api/teachers
│   │       ├── classes.js      — CRUD /api/classes
│   │       ├── subjects.js     — CRUD /api/subjects
│   │       ├── timetable.js    — GET/PUT /api/timetable
│   │       ├── absences.js     — Absences + substitutes
│   │       ├── allocations.js  — CRUD + validate + auto-generate
│   │       └── allocate.js     — Run CP-SAT + apply to timetable
│   └── scripts/
│       ├── allocator.py        — CP-SAT timetable solver
│       └── autoGenerate.py     — Subject allocation generator
│
└── frontend/
    ├── package.json
    ├── vite.config.js          — Port 3000, proxy /api → 4000
    ├── index.html
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── styles.css
        ├── lib/
        │   ├── api.js          — Fetch wrapper with JWT
        │   ├── auth.jsx        — AuthContext + useAuth hook
        │   └── utils.js        — DAYS, PERIODS, helpers
        ├── components/
        │   └── Layout.jsx      — Sidebar + topbar
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── Timetable.jsx   — Class / Teacher / Master views
            ├── Absences.jsx    — Mark absent + assign substitutes
            ├── Curriculum.jsx  — Subjects matrix + Class teachers
            ├── Allocations.jsx — Subject allocations CRUD + auto-generate
            ├── Teachers.jsx    — Teacher profiles
            └── Allotment.jsx   — Run CP solver + apply
```

---

## Setup

### 1 — Database (Supabase)

Run in this order in Supabase SQL Editor:

```
database/schema.sql
database/seeds/01_admin.sql
database/seeds/02_subjects.sql
database/seeds/03_teachers.sql
database/seeds/04_classes.sql
database/seeds/05_allocations.sql
```

### 2 — Backend

```bash
cd backend
npm install
cp .env.example .env     # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
pip install ortools      # Python dependency for the solver
npm run dev              # starts on port 4000
```

### 3 — Frontend

```bash
cd frontend
npm install
npm run dev              # starts on port 3000
```

Login at http://localhost:3000 with `admin` / `admin123`

### Deploy (GitHub + Render)

See **[DEPLOY.md](./DEPLOY.md)** for push steps, Render web + static site setup, and env vars (`VITE_API_URL`, Supabase, JWT).

---

## Feature Overview

| Page | What you do |
|---|---|
| Dashboard | Overview — absent teachers today, quick actions |
| Timetable | View class/teacher/master timetable grid |
| Absences | Mark teachers absent, assign period-by-period substitutes |
| Curriculum | Edit subject period requirements; assign class teachers |
| Allocations | Define who teaches what where; validate; auto-generate |
| Teachers | Manage teacher profiles, subjects, workload targets |
| Allotment | Toggle R1/R2 rules, run CP-SAT solver, apply to timetable |

---

## Timetable Rules

| Rule | Description | Configurable |
|---|---|---|
| R1 | Class teacher teaches Period 1 every day | Toggle on/off |
| R2 | Diary is Period 8 for Classes 1–2 | Toggle on/off |
| R5 | Max 2 periods of the same subject per day | Always on |
| R6 | Games never in Period 8 | Always on |
| min_period_start | Teacher cannot be scheduled before this period | Per teacher |

---

## Key Data

- 21 teachers · 15 classes · 720 periods/week (15 × 48)
- Classes 1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B, 5, 6A, 6B, 7, 8, 9, 10
- 6 days/week · 8 periods/day
- Solver: OR-Tools CP-SAT (max 90s time limit, configurable)
