-- Reset teachers, subjects, and subject_allocations for a clean re-seed.
-- Keeps: classes, admins, schema.
-- Also clears timetable / absences / substitutions (they depend on teachers).
-- Does NOT delete classes — run 04_classes.sql after 03_teachers.sql to restore class teachers.

BEGIN;

-- Dependent data first
DELETE FROM substitutions;
DELETE FROM absences;
DELETE FROM timetable;

-- Allocations & class teacher links
DELETE FROM subject_allocations;
UPDATE classes SET class_teacher_id = NULL;

-- Core tables you are re-seeding
DELETE FROM teachers;
DELETE FROM subjects;

-- Optional: clear last CP-SAT run cache
DELETE FROM allocation_reports WHERE id = 1;

COMMIT;

-- Re-seed order (Supabase SQL Editor):
--   database/seeds/02_subjects.sql
--   database/seeds/03_teachers.sql
--   database/seeds/04_classes.sql   (sets class_teacher_id)
--   database/seeds/05_allocations.sql
