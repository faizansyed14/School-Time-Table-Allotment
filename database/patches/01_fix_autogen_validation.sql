-- Run once in Supabase SQL Editor if auto-generate reports:
--   Class 5 = 49 periods, workload sum mismatch, Vipin target > max teachable

UPDATE subjects SET periods_5 = 1 WHERE name = 'Games';
UPDATE teachers SET allotted_periods = 22 WHERE name = 'Vipin';
