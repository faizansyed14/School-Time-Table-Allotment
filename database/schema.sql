-- ============================================================
-- School ERP — Database Schema
-- Run ONCE in Supabase SQL Editor before seeding.
-- ============================================================

-- ── 1. SUBJECTS ─────────────────────────────────────────────
-- One row per subject; per-class weekly period requirements stored as columns.
CREATE TABLE IF NOT EXISTS subjects (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT    NOT NULL UNIQUE,
  periods_1a  INTEGER DEFAULT 0,
  periods_1b  INTEGER DEFAULT 0,
  periods_2a  INTEGER DEFAULT 0,
  periods_2b  INTEGER DEFAULT 0,
  periods_3a  INTEGER DEFAULT 0,
  periods_3b  INTEGER DEFAULT 0,
  periods_4a  INTEGER DEFAULT 0,
  periods_4b  INTEGER DEFAULT 0,
  periods_5   INTEGER DEFAULT 0,
  periods_6a  INTEGER DEFAULT 0,
  periods_6b  INTEGER DEFAULT 0,
  periods_7   INTEGER DEFAULT 0,
  periods_8   INTEGER DEFAULT 0,
  periods_9   INTEGER DEFAULT 0,
  periods_10  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. TEACHERS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL UNIQUE,
  subjects          TEXT[]      NOT NULL DEFAULT '{}',
  min_class_level   INTEGER     NOT NULL DEFAULT 1,
  max_class_level   INTEGER     NOT NULL DEFAULT 10,
  allotted_periods  INTEGER     NOT NULL DEFAULT 0,
  allocated_periods INTEGER     NOT NULL DEFAULT 0,
  min_period_start  SMALLINT    NOT NULL DEFAULT 1 CHECK (min_period_start BETWEEN 1 AND 8),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. CLASSES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classes (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT    NOT NULL UNIQUE,
  class_level      INTEGER NOT NULL,
  section          TEXT,
  display_order    INTEGER NOT NULL DEFAULT 0,
  class_teacher_id UUID    REFERENCES teachers(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. SUBJECT ALLOCATIONS ──────────────────────────────────
-- CP solver reads this to know who teaches what to whom, how many times/week.
CREATE TABLE IF NOT EXISTS subject_allocations (
  teacher_id     UUID    NOT NULL REFERENCES teachers(id)  ON DELETE CASCADE,
  class_id       UUID    NOT NULL REFERENCES classes(id)   ON DELETE CASCADE,
  subject        TEXT    NOT NULL,
  periods_weekly INTEGER NOT NULL CHECK (periods_weekly > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, class_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_allocations_class   ON subject_allocations(class_id);
CREATE INDEX IF NOT EXISTS idx_allocations_teacher ON subject_allocations(teacher_id);

-- ── 5. TIMETABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timetable (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID    NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  teacher_id UUID             REFERENCES teachers(id) ON DELETE SET NULL,
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
  period     INTEGER NOT NULL CHECK (period BETWEEN 1 AND 8),
  subject    TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, day, period)
);

CREATE INDEX IF NOT EXISTS idx_timetable_class      ON timetable(class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher    ON timetable(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_day_period ON timetable(day, period);

-- ── 6. ABSENCES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS absences (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID  NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  absent_date  DATE  NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, absent_date)
);

CREATE INDEX IF NOT EXISTS idx_absences_date    ON absences(absent_date);
CREATE INDEX IF NOT EXISTS idx_absences_teacher ON absences(teacher_id);

-- ── 7. SUBSTITUTIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS substitutions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id            UUID NOT NULL REFERENCES absences(id)      ON DELETE CASCADE,
  timetable_id          UUID NOT NULL REFERENCES timetable(id)     ON DELETE CASCADE,
  substitute_teacher_id UUID NOT NULL REFERENCES teachers(id)      ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (absence_id, timetable_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_absence ON substitutions(absence_id);

-- ── 8. ALLOCATION REPORT (single row — last CP run) ─────────
CREATE TABLE IF NOT EXISTS allocation_reports (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  report       JSONB   NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. ADMIN ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT  NOT NULL UNIQUE,
  password_hash TEXT  NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TRIGGERS ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_teachers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teachers_updated_at ON teachers;
CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION fn_teachers_updated_at();

CREATE OR REPLACE FUNCTION fn_sync_allocated_periods()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.teacher_id IS NOT NULL THEN
    UPDATE teachers
    SET allocated_periods = (SELECT COUNT(*) FROM timetable WHERE teacher_id = OLD.teacher_id)
    WHERE id = OLD.teacher_id;
  END IF;
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.teacher_id IS NOT NULL THEN
    UPDATE teachers
    SET allocated_periods = (SELECT COUNT(*) FROM timetable WHERE teacher_id = NEW.teacher_id)
    WHERE id = NEW.teacher_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_allocated_periods ON timetable;
CREATE TRIGGER trg_sync_allocated_periods
  AFTER INSERT OR UPDATE OR DELETE ON timetable
  FOR EACH ROW EXECUTE FUNCTION fn_sync_allocated_periods();

-- ── PERMISSIONS ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL   ON ALL TABLES    IN SCHEMA public TO postgres, service_role;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
