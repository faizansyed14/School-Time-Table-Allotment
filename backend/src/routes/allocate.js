const router = require('express').Router();
const supabase = require('../config/supabase');
const getPythonCommand = require('../config/python');
const requireAuth = require('../middleware/auth');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const allocatorRun = require('../lib/allocatorRun');

router.use(requireAuth);

const BACKEND_DIR = path.join(__dirname, '..', '..');
const ROOT = path.join(BACKEND_DIR, '..');

const SUBJECT_MAP = {
  'English':'S01','Hindi':'S02','Maths':'S03','S.St':'S04','E.V.S':'S04',
  'Science':'S05','G.K.':'S06','Drawing':'S07','Computer':'S08','Sanskrit':'S09',
  'Games':'S10','Library':'S11','Diary':'S12','I.T.':'S08',
};
const SUBJECT_LIST = [
  { id:'S01', name:'English' },  { id:'S02', name:'Hindi' },
  { id:'S03', name:'Maths' },    { id:'S04', name:'S.St/E.V.S' },
  { id:'S05', name:'Science' },  { id:'S06', name:'G.K.' },
  { id:'S07', name:'Drawing' },  { id:'S08', name:'Computer' },
  { id:'S09', name:'Sanskrit' }, { id:'S10', name:'Games' },
  { id:'S11', name:'Library' },  { id:'S12', name:'Diary' },
];

function getStoredRules(raw) {
  if (!raw || typeof raw !== 'object') return { R1: true, R2: true };
  return { R1: raw.rules?.R1 ?? true, R2: raw.rules?.R2 ?? true };
}

// GET last run result + rule flags
router.get('/result', async (_req, res) => {
  const { data } = await supabase
    .from('allocation_reports').select('*').eq('id', 1).maybeSingle();
  if (!data) return res.json({ rules: { R1: true, R2: true }, lastRun: null });
  const { rules, lastRun } = { rules: { R1: true, R2: true }, lastRun: null, ...data.report };
  res.json({ rules, lastRun, generated_at: data.generated_at });
});

// PATCH update rule flags
router.patch('/rules', async (req, res) => {
  const { rules } = req.body || {};
  const { data: existing } = await supabase
    .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
  const current = existing?.report || {};
  const updated = { ...current, rules: { ...getStoredRules(current), ...rules } };
  await supabase.from('allocation_reports').upsert({ id: 1, report: updated });
  res.json({ rules: updated.rules });
});

// GET /status — whether CP-SAT is still running (survives page navigation)
router.get('/status', (_req, res) => {
  res.json(allocatorRun.getStatus());
});

// POST /cancel — stop active Python solver
router.post('/cancel', (_req, res) => {
  const cancelled = allocatorRun.cancelRun();
  res.json({ cancelled });
});

// POST /run — build seed, run Python, return result
router.post('/run', async (req, res) => {
  const { timeLimitSeconds = 90 } = req.body || {};

  if (allocatorRun.isRunning()) {
    return res.status(409).json({ error: 'Allocator is already running' });
  }

  try {
    // 1. Fetch data
    const [allocs, classes, teachers, report] = await Promise.all([
      supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
      supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
      supabase.from('teachers').select('id, name, subjects, allotted_periods, min_period_start'),
      supabase.from('allocation_reports').select('report').eq('id', 1).maybeSingle(),
    ]);

    const ruleFlags = getStoredRules(report.data?.report);

    // 2. Build runtime seed
    const classById = {};
    (classes.data || []).forEach((c) => { classById[c.id] = c; });

    const teacherRows = (teachers.data || []).map((t) => ({
      id: t.id, name: t.name, erp_name: t.name,
      subjects: (t.subjects || []).map((s) => SUBJECT_MAP[s] || 'S01').filter(Boolean),
      max_class_level: 10,
      total_periods: t.allotted_periods || 0,
      min_period_start: t.min_period_start || 1,
    }));

    const allocationRows = (allocs.data || []).map((a) => ({
      teacher_id: a.teacher_id,
      class_id: a.class_id,
      subject_id: SUBJECT_MAP[a.subject] || 'S01',
      periods: a.periods_weekly,
    }));

    const classRows = (classes.data || []).map((c) => ({
      id: c.id, name: c.name, level: c.class_level,
      class_teacher_id: c.class_teacher_id || null,
    }));

    const rules = [
      { id: 'R1', type: 'class_teacher_first_period', active: ruleFlags.R1, description: 'First period = class teacher' },
      { id: 'R2', type: 'diary_last_period',           active: ruleFlags.R2, description: 'Last period = Diary (classes 1-2)' },
      { id: 'R5', type: 'max_subject_per_day', value: 2, active: true, description: 'Max 2 periods same subject/day' },
      { id: 'R6', type: 'games_not_last_period',        active: true, description: 'Games not in last period' },
    ];

    const seed = {
      teachers: teacherRows,
      classes: classRows,
      subjects: SUBJECT_LIST,
      allocations: allocationRows,
      rules,
      periods_per_day: 8,
      days_per_week: 6,
      total_periods: 48,
    };

    const tmpDir  = path.join(ROOT, 'database');
    const inFile  = path.join(tmpDir, '.cp_runtime_seed.json');
    const outFile = path.join(tmpDir, '.cp_runtime_result.json');
    await fs.writeFile(inFile, JSON.stringify(seed, null, 2));

    // 3. Run Python allocator
    const pyPath = path.join(BACKEND_DIR, 'scripts', 'allocator.py');
    const py = spawn(getPythonCommand(), [
      pyPath, '--input', inFile, '--output', outFile, '--time-limit', String(timeLimitSeconds),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    allocatorRun.registerRun(py, timeLimitSeconds);

    let stderr = '';
    py.stderr.on('data', (b) => { stderr += b.toString(); });

    await new Promise((resolve, reject) => {
      py.on('close', (code) => {
        if (allocatorRun.wasUserCancelled()) {
          return reject(new Error('Allocation cancelled'));
        }
        if (code === 0) return resolve();
        reject(new Error(`Python ${code}: ${stderr.slice(0, 500)}`));
      });
      py.on('error', reject);
    });

    const result = JSON.parse(await fs.readFile(outFile, 'utf-8'));

    // 4. Store report
    const { data: existing } = await supabase
      .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
    const prev = existing?.report || {};
    await supabase.from('allocation_reports').upsert({
      id: 1,
      report: { ...prev, lastRun: result },
      generated_at: new Date().toISOString(),
    });

    res.json(result);
  } catch (e) {
    const cancelled = e.message === 'Allocation cancelled';
    const status = cancelled ? 499 : 500;
    if (!res.writableEnded) {
      res.status(status).json({ success: false, cancelled, error: e.message });
    }
  }
});

// POST /apply — write CP result to timetable table
router.post('/apply', async (req, res) => {
  try {
    const { data: stored } = await supabase
      .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
    const result = stored?.report?.lastRun;
    if (!result?.success) return res.status(400).json({ error: 'No successful run to apply' });

    const grid = result.grid;
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows = [];

    // grid shape: { class_id: [[{teacher_id, subject_id}]] }
    for (const [class_id, days] of Object.entries(grid)) {
      for (let d = 0; d < days.length; d++) {
        for (let p = 0; p < days[d].length; p++) {
          const slot = days[d][p];
          if (!slot || !slot.length) continue;
          const entry = slot[0];
          const subjectName = Object.entries(SUBJECT_MAP).find(([, sid]) => sid === entry.subject_id)?.[0] || entry.subject_id;
          rows.push({ class_id, teacher_id: entry.teacher_id, day: d + 1, period: p + 1, subject: subjectName });
        }
      }
    }

    // Wipe existing timetable
    await supabase.from('timetable').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Insert in batches
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('timetable').insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }

    res.json({ success: true, slots_inserted: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
