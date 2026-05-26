-- ── Seed 01: Admin User ─────────────────────────────────────
-- Password: admin123 (bcrypt hash)
INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2b$10$ibHHFTmoaqYBo6MeCXL8i.r0E48hG0pSHIzB/1amixCLmA7shajLe')
ON CONFLICT (username) DO NOTHING;
