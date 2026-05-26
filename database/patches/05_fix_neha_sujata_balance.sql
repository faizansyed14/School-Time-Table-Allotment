-- After 03_fix_diary_2b: align Neha (43p) and Sujata (44p) with seeds/05_allocations.sql

-- ── Neha: add missing Computer (37 → 43) ─────────────────────
INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Computer', 3
FROM teachers t, classes c
WHERE t.name = 'Neha' AND c.name = '2A'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Computer'
  );

INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Computer', 3
FROM teachers t, classes c
WHERE t.name = 'Neha' AND c.name = '2B'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Computer'
  );

-- ── Sujata: drop 6 extra periods (50 → 44) ───────────────────
-- Not in seeds: 3A G.K. / Drawing on Sujata
DELETE FROM subject_allocations
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Sujata' LIMIT 1)
  AND class_id = (SELECT id FROM classes WHERE name = '3A' LIMIT 1)
  AND subject IN ('G.K.', 'Drawing');

-- Do NOT cap 2A Drawing here — curriculum 3p = Sujata + Shahina + Sunita (1 each). See 06_fix_2a_2b_3a_allocations.sql.

-- ── Sync workload targets with actual totals ─────────────────
UPDATE teachers t
SET allotted_periods = sub.total
FROM (
  SELECT teacher_id, SUM(periods_weekly)::int AS total
  FROM subject_allocations
  GROUP BY teacher_id
) sub
WHERE t.id = sub.teacher_id
  AND t.name IN ('Neha', 'Sujata');
