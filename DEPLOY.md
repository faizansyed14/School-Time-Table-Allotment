# Deploy to GitHub + Render

## 1. Push to GitHub

From the project root (PowerShell):

```powershell
git init
git add .
git commit -m "Initial commit: School ERP timetable app"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Do **not** commit `backend/.env` (it is in `.gitignore`). Keep secrets only in Render env vars.

---

## 2. Supabase (if not done)

In Supabase SQL Editor, run in order:

1. `database/schema.sql`
2. `database/seeds/01_admin.sql` … `05_allocations.sql`
3. Optional: `database/patches/02_fix_admin_password.sql` if login fails

Copy **Project URL** and **service_role** key (Settings → API).

---

## 3. Render — backend (Web Service)

| Setting | Value |
|--------|--------|
| **Root Directory** | `backend` |
| **Runtime** | Node |
| **Build Command** | `npm install && pip install -r requirements.txt` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/api/health` |

**Environment variables:**

| Key | Value |
|-----|--------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | your service role key |
| `JWT_SECRET` | long random string |
| `NODE_ENV` | `production` |
| `PYTHON` | `python3` |
| `CORS_ORIGIN` | `https://school-erp-web-2xc0.onrender.com` (your static site URL) |

After deploy, note the URL, e.g. `https://school-erp-api.onrender.com`.

**Python / allotment:** Render’s Node runtime includes Python. Allotment and auto-generate need `ortools` (installed via `requirements.txt`). First solver run may be slow on free tier.

---

## 4. Render — frontend (Static Site)

| Setting | Value |
|--------|--------|
| **Root Directory** | `frontend` |
| **Build Command** | `npm install && npm run build` |
| **Publish Directory** | `dist` |

**SPA routing (fixes refresh 404 on `/dashboard`, `/login`, etc.):**

1. **Render dashboard** → static site → **Redirects/Rewrites** → **Add rule**:
   - **Source:** `/*`
   - **Destination:** `/index.html`
   - **Action:** **Rewrite** (not Redirect 301)

2. **Redeploy** frontend after pull — `frontend/public/_redirects` is copied into `dist/` on build.

To verify: after deploy, open `https://YOUR-FRONTEND.onrender.com/dashboard` in a new tab — should load the app, not “Not Found”.

**Environment variable (required):**

| Key | Value |
|-----|--------|
| `VITE_API_URL` | `https://school-erp-api.onrender.com` (your backend URL, **no** trailing slash) |

Redeploy frontend after changing `VITE_API_URL` (required at **build** time — changing env alone without redeploy does nothing).

**Quick fallback:** edit `frontend/public/config.js` and set `window.__ERP_API_URL__ = 'https://your-api.onrender.com'`, then redeploy.

---

## 5. Optional: Blueprint

Repo includes `render.yaml`. In Render: **New → Blueprint** → connect repo → set the same secrets when prompted → set `VITE_API_URL` to the API service URL after the API is live.

---

## 6. Verify

1. `https://YOUR-API.onrender.com/api/health` → `{"status":"ok"}`
2. Open static site → login `admin` / `admin123`
3. Dashboard and timetable load without network errors in browser DevTools

---

## Local vs production

| | Local | Render |
|--|--------|--------|
| API | `http://localhost:4000` | Backend service URL |
| Frontend | Vite proxy `/api` → 4000 | `VITE_API_URL` + `/api/...` |
| DB | Supabase (same project) | Same Supabase project |

---

## Troubleshooting

- **CORS / failed fetch:** `VITE_API_URL` must match backend URL exactly (https, no trailing `/`).
- **502 / CORS on allotment:** Usually the solver ran longer than the HTTP connection. Deploy latest code (allotment returns **202** immediately, then polls `/allocate/status`). Also set `CORS_ORIGIN` to your frontend URL. Free tier: first run can take 1–2 minutes — keep UptimeRobot pinging the API.
- **Python not found:** Set `PYTHON=python3` on the backend service.
- **Login fails:** Run `database/patches/02_fix_admin_password.sql` in Supabase.
