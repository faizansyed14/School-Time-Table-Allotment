-- Neha: Diary only in 2A (6p). Sujata: Diary in 2B (6p) — class teacher of 2B.
-- Fixes "12 Diary periods" and allotment INFEASIBLE.

UPDATE subject_allocations sa
SET teacher_id = (SELECT id FROM teachers WHERE name = 'Sujata' LIMIT 1)
WHERE sa.subject = 'Diary'
  AND sa.class_id = (SELECT id FROM classes WHERE name = '2B' LIMIT 1)
  AND sa.teacher_id = (SELECT id FROM teachers WHERE name = 'Neha' LIMIT 1);

-- If 2B Diary row missing on Sujata after update, insert it
INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Diary', 6
FROM teachers t, classes c
WHERE t.name = 'Sujata' AND c.name = '2B'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.class_id = c.id AND sa.subject = 'Diary'
  );
