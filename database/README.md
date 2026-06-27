# Database (PostgreSQL)

The app targets plain PostgreSQL and is **switchable via one variable** —
`DATABASE_URL` — between the bundled Docker Postgres, **AWS RDS** and **Supabase**.

## Automatic setup (recommended)

When the API starts with `AUTO_INIT_DB=true` it:

1. Applies [`schema.sql`](./schema.sql) (idempotent — safe to re-run).
2. Seeds the admin user from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. If `SEED_DEMO_DATA=true`, loads the demo subjects/teachers/classes/allocations
   (only when the database is empty).

So `scripts/dev/start.sh` / `scripts/prod/start.sh` give you a ready database with
no manual SQL.

## Manual setup

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seeds/01_admin.sql      # admin / admin
psql "$DATABASE_URL" -f database/seeds/02_subjects.sql
psql "$DATABASE_URL" -f database/seeds/03_teachers.sql
psql "$DATABASE_URL" -f database/seeds/04_classes.sql
psql "$DATABASE_URL" -f database/seeds/05_allocations.sql
```

## Run order

| Step | File | What it does |
|---|---|---|
| 1 | `schema.sql` | Create all tables, indexes, triggers (+ `users` RBAC table) |
| 2 | `seeds/01_admin.sql` | Admin login (admin / admin) — usually handled automatically |
| 3 | `seeds/02_subjects.sql` | 14 subjects × 15 class period requirements |
| 4 | `seeds/03_teachers.sql` | 21 teachers with workload targets |
| 5 | `seeds/04_classes.sql` | 15 classes + class teacher assignments |
| 6 | `seeds/05_allocations.sql` | Subject allocation rows |

## Switching database provider

Only `DATABASE_URL` changes (in `.env.dev` / `.env.prod`):

```bash
# Bundled Docker Postgres
DATABASE_URL=postgresql://erp:erp_password@db:5432/school_erp
# AWS RDS
DATABASE_URL=postgresql://USER:PASS@xxxx.rds.amazonaws.com:5432/school_erp?sslmode=require
# Supabase
DATABASE_URL=postgresql://postgres:PASS@db.YOURREF.supabase.co:5432/postgres
```

## Verification

```sql
-- Each class must total 48 periods
SELECT c.name, SUM(sa.periods_weekly) AS total
FROM classes c LEFT JOIN subject_allocations sa ON sa.class_id = c.id
GROUP BY c.id, c.name ORDER BY c.name;
```
