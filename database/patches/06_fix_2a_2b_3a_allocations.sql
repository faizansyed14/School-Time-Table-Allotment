-- Fix class totals after 05_fix_neha_sujata_balance.sql
-- Seeds: 2A/2B Computer = Neha 3 only. 2A Drawing = Sujata 1 + Shahina 1 + Sunita 1. 3A Drawing = Priyanka 2.

-- ── Remove wrong Computer on Shahina in 2A / 2B (Neha already has 3 each) ──
DELETE FROM subject_allocations
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Shahina' LIMIT 1)
  AND class_id IN (SELECT id FROM classes WHERE name IN ('2A', '2B'))
  AND subject = 'Computer';

-- ── 2A Drawing: curriculum 3 = three teachers × 1p (not one teacher × 3) ──
INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Drawing', 1
FROM teachers t, classes c
WHERE t.name = 'Sujata' AND c.name = '2A'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Drawing'
  );

INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Drawing', 1
FROM teachers t, classes c
WHERE t.name = 'Shahina' AND c.name = '2A'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Drawing'
  );

INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Drawing', 1
FROM teachers t, classes c
WHERE t.name = 'Sunita' AND c.name = '2A'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Drawing'
  );

-- If Sujata 2A Drawing was set to 3, cap at 1
UPDATE subject_allocations
SET periods_weekly = 1
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Sujata' LIMIT 1)
  AND class_id = (SELECT id FROM classes WHERE name = '2A' LIMIT 1)
  AND subject = 'Drawing'
  AND periods_weekly > 1;

-- ── 3A Drawing: Priyanka 2p (removed from Sujata by mistake in patch 05) ──
INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
SELECT t.id, c.id, 'Drawing', 2
FROM teachers t, classes c
WHERE t.name = 'Priyanka' AND c.name = '3A'
  AND NOT EXISTS (
    SELECT 1 FROM subject_allocations sa
    WHERE sa.teacher_id = t.id AND sa.class_id = c.id AND sa.subject = 'Drawing'
  );

-- ── Re-sync teacher workload targets ─────────────────────────
UPDATE teachers t
SET allotted_periods = sub.total
FROM (
  SELECT teacher_id, SUM(periods_weekly)::int AS total
  FROM subject_allocations
  GROUP BY teacher_id
) sub
WHERE t.id = sub.teacher_id;
