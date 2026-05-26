# Database Setup

## Run order in Supabase SQL Editor

| Step | File | What it does |
|---|---|---|
| 1 | `schema.sql` | Create all tables, indexes, triggers |
| 2 | `seeds/01_admin.sql` | Create admin login (admin / admin123) |
| 3 | `seeds/02_subjects.sql` | 14 subjects × 15 class period requirements |
| 4 | `seeds/03_teachers.sql` | 21 teachers with workload targets |
| 5 | `seeds/04_classes.sql` | 15 classes + class teacher assignments |
| 6 | `seeds/05_allocations.sql` | 143 subject allocation rows (720 periods total) |

## Full reset (wipe and re-seed)

```sql
TRUNCATE substitutions, absences, timetable, subject_allocations,
  allocation_reports RESTART IDENTITY CASCADE;
TRUNCATE classes CASCADE;
TRUNCATE teachers CASCADE;
TRUNCATE subjects CASCADE;
DELETE FROM admins;
```

Then re-run seeds 01–06 in order.

## Verification query

After seeding, verify each class has exactly 48 periods:

```sql
SELECT c.name, c.class_level, SUM(sa.periods_weekly) as total
FROM classes c
LEFT JOIN subject_allocations sa ON sa.class_id = c.id
GROUP BY c.id, c.name, c.class_level
ORDER BY c.class_level, c.name;
```

Verify each teacher hits their allotted target:

```sql
SELECT t.name, t.allotted_periods as target, SUM(sa.periods_weekly) as actual
FROM teachers t
LEFT JOIN subject_allocations sa ON sa.teacher_id = t.id
GROUP BY t.id, t.name, t.allotted_periods
ORDER BY t.name;
```

## Expected counts

| Table | Rows |
|---|---|
| subjects | 14 |
| teachers | 21 |
| classes | 15 |
| subject_allocations | ~143 |
| Total periods | 720 (15 × 48) |
