-- ── Seed 01: Admin User (RBAC) ──────────────────────────────
-- NOTE: The API seeds the admin automatically on startup using
--       ADMIN_USERNAME / ADMIN_PASSWORD from the .env file.
--       This file is only for manual seeding via psql.
--
-- Default credentials: admin / admin  (change in production!)
INSERT INTO users (username, password_hash, role)
VALUES ('admin', crypt('admin', gen_salt('bf', 10)), 'admin')
ON CONFLICT (username) DO NOTHING;
