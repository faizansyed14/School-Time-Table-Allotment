-- ── Seed 03: Teachers ────────────────────────────────────────
-- 21 teachers for AY 2026-27
-- min_period_start: 1 = no restriction; 5 = cannot teach before Period 5

TRUNCATE teachers CASCADE;

INSERT INTO teachers (name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start) VALUES
  ('Deepika',      ARRAY['English','E.V.S','G.K.','Computer','Diary'],    1,  5,  43, 1),
  ('Annu',         ARRAY['Hindi','Maths','G.K.','Library','Diary'],       1,  5,  44, 1),
  ('Neha',         ARRAY['English','E.V.S','G.K.','Computer','Diary'],    2,  5,  43, 1),
  ('Sujata',       ARRAY['Hindi','Maths','G.K.','Drawing','Diary'],       2,  5,  44, 1),
  ('Priyanka',     ARRAY['Maths','Drawing','Sanskrit'],                   3, 10,  42, 1),
  ('Leena',        ARRAY['Science','G.K.'],                               3, 10,  42, 1),
  ('Shahina',      ARRAY['Drawing','Computer','Library'],                 2, 10,  39, 1),
  ('Anjali Sehgal',ARRAY['Maths'],                                        4, 10,  41, 1),
  ('Shallu',       ARRAY['English','Maths','S.St'],                       3, 10,  42, 1),
  ('Madhvi',       ARRAY['Hindi','S.St'],                                 5, 10,  42, 1),
  ('Kiran Sharma', ARRAY['English'],                                      5, 10,  32, 1),
  ('Megha',        ARRAY['English','Hindi','S.St','G.K.'],                3, 10,  43, 1),
  ('Aakriti',      ARRAY['English'],                                      8, 10,  24, 1),
  ('Nutan',        ARRAY['Science'],                                      6, 10,  36, 1),
  ('Sunita',       ARRAY['Drawing'],                                      1, 10,  13, 3),
  ('Neeru',        ARRAY['G.K.','Drawing','I.T.'],                        4, 10,  16, 3),
  ('Kiran Bansal', ARRAY['Hindi'],                                        9, 10,  10, 1),
  ('Vipin',        ARRAY['S.St','G.K.'],                                  8, 10,  24, 1),
  ('Vikas',        ARRAY['Maths','G.K.'],                                 7, 10,  28, 1),
  ('Nagender',     ARRAY['Games'],                                        1, 10,  29, 1),
  ('Pinki Singh',  ARRAY['Hindi','G.K.'],                                 3, 10,  43, 1);
