require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const supabase = require('./config/supabase');

const app = express();

function corsOptions() {
  const fromEnv = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://school-erp-web-2xc0.onrender.com',
    ...fromEnv,
  ]);
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

app.use(cors(corsOptions()));
app.options('*', cors(corsOptions()));
app.use(express.json());

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/teachers',   require('./routes/teachers'));
app.use('/api/classes',    require('./routes/classes'));
app.use('/api/subjects',   require('./routes/subjects'));
app.use('/api/timetable',  require('./routes/timetable'));
app.use('/api/absences',   require('./routes/absences'));
app.use('/api/allocations',require('./routes/allocations'));
app.use('/api/allocate',   require('./routes/allocate'));

// ── Health check ─────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  service: 'school-erp-api',
  status: 'ok',
  health: '/api/health',
  hint: 'Use the static frontend site; API base is /api/...',
}));
app.get('/api/health', async (_req, res) => {
  const out = {
    status: 'ok',
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    adminReady: false,
  };
  if (out.supabaseConfigured) {
    const { data, error } = await supabase
      .from('admins')
      .select('username')
      .eq('username', 'admin')
      .maybeSingle();
    out.adminReady = !error && Boolean(data);
    if (error) out.dbError = error.message;
  }
  res.json(out);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
