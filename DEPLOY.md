# Deployment — Hostinger VPS (Docker + HTTPS)

The app runs as three containers — **db** (PostgreSQL), **api** (FastAPI) and
**web** (nginx serving the React build) — via Docker Compose. This guide deploys
it securely on a Hostinger VPS behind nginx + Let's Encrypt TLS.

---

## 0. Which plan?

| Plan | vCPU | RAM | Disk | Good for |
|---|---|---|---|---|
| KVM 1 | 1 | 4 GB | 50 GB | Bare minimum — works, but the CP‑SAT solver is CPU-heavy and will be slow on 1 core |
| **KVM 2 ✅ recommended** | **2** | **8 GB** | 100 GB | Comfortable for Postgres + API + solver + frontend |
| KVM 4 | 4 | 16 GB | 200 GB | Overkill unless many concurrent users / faster solves |

**Pick KVM 2.** The timetable solver (OR-Tools) benefits from ≥2 cores, and
8 GB RAM leaves room for Postgres + Docker comfortably. Set `SOLVER_WORKERS=2`
in `.env.prod` to match the 2 cores.

When creating the VPS in hPanel choose **Ubuntu 24.04** (or "Ubuntu 24.04 with
Docker" if offered — that skips step 4) and set a strong root password / add your
SSH key.

---

## 1. Connect via SSH

Find your VPS IP in hPanel → VPS → Overview.

**Windows (PowerShell)** or **macOS/Linux terminal:**
```bash
ssh root@YOUR_SERVER_IP
# first time: type "yes" to accept the fingerprint, then the password
```

Recommended: use an SSH key instead of a password.
```bash
# On your LOCAL machine — create a key if you don't have one
ssh-keygen -t ed25519 -C "you@email"
# copy it to the server
ssh-copy-id root@YOUR_SERVER_IP      # (or paste ~/.ssh/id_ed25519.pub into the server)
```

---

## 2. Create a non-root user (don't run as root)

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your SSH key
# reconnect as the new user:
exit
ssh deploy@YOUR_SERVER_IP
```

---

## 3. Basic firewall + hardening

```bash
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
# optional but recommended
sudo apt install -y fail2ban
```
After confirming key-based login works, disable password & root SSH login:
```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 4. Install Docker + Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                      # apply group without re-login
docker compose version             # verify
```

---

## 5. Get the code

```bash
cd ~
git clone https://github.com/faizansyed14/School-Time-Table-Allotment.git
cd School-Time-Table-Allotment
git checkout dev                   # or main, whichever branch you deploy
```

---

## 6. Configure `.env.prod` (secrets stay on the server only)

`.env.prod` is **git-ignored** — it never leaves the server. Copy the template,
then generate strong secrets and edit:

```bash
cp .env.example .env.prod
# generate values
openssl rand -hex 32        # → use for JWT_SECRET
openssl rand -base64 24     # → use for DB + admin passwords

nano .env.prod
```

Set at minimum (replace every CHANGE_ME):
```bash
DB_PROVIDER=postgres
DATABASE_URL=postgresql://erp:STRONG_DB_PASS@db:5432/school_erp
POSTGRES_DB=school_erp
POSTGRES_USER=erp
POSTGRES_PASSWORD=STRONG_DB_PASS          # must match DATABASE_URL

JWT_SECRET=PASTE_64_HEX_CHARS_HERE
ADMIN_USERNAME=admin
ADMIN_PASSWORD=STRONG_ADMIN_PASS          # change this!

NODE_ENV=production
CORS_ORIGIN=https://timetable.yourschool.com
AUTO_INIT_DB=true
SEED_DEMO_DATA=false                       # true ONLY for a first empty demo DB

SOLVER_TIME_LIMIT=60
SOLVER_WORKERS=2                           # = number of vCPUs (KVM 2 → 2)
SAME_PERIOD_CONSISTENCY=true

# Bind containers to localhost only — the host nginx (step 8) is the public entry
FRONTEND_PORT=127.0.0.1:8080
BACKEND_PORT=127.0.0.1:4000
VITE_API_URL=https://timetable.yourschool.com
```

> The API talks to AWS RDS or Supabase instead of the bundled Postgres by
> changing only `DATABASE_URL` (add `?sslmode=require`). If you do that, you can
> remove the `db` service from `docker-compose.prod.yml`.

---

## 7. Point your domain at the VPS

In your DNS (Hostinger hPanel → Domains → DNS) add an **A record**:
```
timetable.yourschool.com   →   YOUR_SERVER_IP
```
Wait a few minutes for it to propagate (`ping timetable.yourschool.com`).

---

## 8. Reverse proxy + HTTPS (host nginx + Let's Encrypt)

Install nginx + certbot on the host (not in Docker):
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/timetable`:
```nginx
server {
    listen 80;
    server_name timetable.yourschool.com;

    client_max_body_size 10m;

    # API → FastAPI container
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;     # solver runs can take ~1 min
    }

    # Everything else → frontend container
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable it and add TLS:
```bash
sudo ln -s /etc/nginx/sites-available/timetable /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d timetable.yourschool.com   # auto-configures HTTPS + renewal
```

---

## 9. Start the stack

```bash
cd ~/School-Time-Table-Allotment
chmod +x scripts/prod/*.sh
./scripts/prod/start.sh            # builds images and starts db + api + web
```
Check it:
```bash
curl -s http://127.0.0.1:4000/api/health      # {"status":"ok","adminReady":true}
docker compose -f docker-compose.prod.yml ps
```
Open `https://timetable.yourschool.com` and sign in with `ADMIN_USERNAME` /
`ADMIN_PASSWORD`. **Immediately log in as admin → Users → change/rotate the
admin password** if needed.

---

## 10. Updating, logs, backups

```bash
# Update to latest code
cd ~/School-Time-Table-Allotment && git pull
./scripts/prod/start.sh           # rebuilds + restarts

# Logs
docker compose -f docker-compose.prod.yml logs -f api

# Stop
./scripts/prod/stop.sh            # add --wipe ONLY to also delete the DB volume

# Backup the database (run via cron daily)
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U erp school_erp | gzip > ~/backup-$(date +%F).sql.gz
```

---

## Security checklist

- [ ] Non-root `deploy` user; root SSH + password auth disabled
- [ ] UFW firewall: only 22, 80, 443 open (DB/API ports bound to `127.0.0.1`)
- [ ] `.env.prod` has unique strong `JWT_SECRET`, DB and admin passwords
- [ ] `SEED_DEMO_DATA=false` in production
- [ ] HTTPS via certbot; auto-renew enabled (`systemctl status certbot.timer`)
- [ ] Regular `pg_dump` backups
- [ ] `CORS_ORIGIN` set to your exact HTTPS domain

---

## Environment variables (reference)

| Key | Purpose |
|---|---|
| `DATABASE_URL` | The DB switch (docker / AWS RDS / Supabase) |
| `JWT_SECRET` | Token signing secret (use `openssl rand -hex 32`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeded admin login |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma-separated |
| `AUTO_INIT_DB` | Apply schema + seed admin on startup (idempotent) |
| `SEED_DEMO_DATA` | Load demo data only into an empty DB |
| `SOLVER_TIME_LIMIT` / `SOLVER_WORKERS` | CP-SAT tuning (`WORKERS` = vCPU count) |
| `SAME_PERIOD_CONSISTENCY` | Keep same teacher/subject in same daily period |
| `RATE_LIMIT_LOGIN` / `RATE_LIMIT_CAPTCHA` | e.g. `5/minute` |
| `FRONTEND_PORT` / `BACKEND_PORT` | Host bind (use `127.0.0.1:PORT` behind nginx) |
| `VITE_API_URL` | Frontend → API base (build-time) |
