-- ── Seed 04: Classes ─────────────────────────────────────────
-- 15 classes, AY 2026-27
-- class_teacher_id set by teacher name lookup

TRUNCATE classes CASCADE;

INSERT INTO classes (name, class_level, section, display_order)
VALUES
  ('1A',  1, 'A',  1),
  ('1B',  1, 'B',  2),
  ('2A',  2, 'A',  3),
  ('2B',  2, 'B',  4),
  ('3A',  3, 'A',  5),
  ('3B',  3, 'B',  6),
  ('4A',  4, 'A',  7),
  ('4B',  4, 'B',  8),
  ('5',   5, NULL,  9),
  ('6A',  6, 'A', 10),
  ('6B',  6, 'B', 11),
  ('7',   7, NULL, 12),
  ('8',   8, NULL, 13),
  ('9',   9, NULL, 14),
  ('10', 10, NULL, 15);

-- Assign class teachers by name
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Deepika'      LIMIT 1) WHERE name = '1A';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Annu'         LIMIT 1) WHERE name = '1B';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Neha'         LIMIT 1) WHERE name = '2A';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Sujata'       LIMIT 1) WHERE name = '2B';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Priyanka'     LIMIT 1) WHERE name = '3A';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Shallu'       LIMIT 1) WHERE name = '3B';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Leena'        LIMIT 1) WHERE name = '4A';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Pinki Singh'  LIMIT 1) WHERE name = '4B';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Anjali Sehgal'LIMIT 1) WHERE name = '5';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Megha'        LIMIT 1) WHERE name = '6A';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Kiran Sharma' LIMIT 1) WHERE name = '6B';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Madhvi'       LIMIT 1) WHERE name = '7';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Shahina'      LIMIT 1) WHERE name = '8';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Aakriti'      LIMIT 1) WHERE name = '9';
UPDATE classes SET class_teacher_id = (SELECT id FROM teachers WHERE name = 'Vipin'        LIMIT 1) WHERE name = '10';
