-- Seed had wrong hash (matched "password", not "admin123"). Run once in Supabase SQL editor.
UPDATE admins
SET password_hash = '$2b$10$ibHHFTmoaqYBo6MeCXL8i.r0E48hG0pSHIzB/1amixCLmA7shajLe'
WHERE username = 'admin';
