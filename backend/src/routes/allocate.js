const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');
const { runTimetableEngine } = require('../lib/timetableEngine');

router.use(requireAuth);

const SUBJECT_MAP = {
  'English': 'S01', 'Hindi': 'S02', 'Maths': 'S03', 'S.St': 'S04', 'E.V.S': 'S04',
  'Science': 'S05', 'G.K.': 'S06', 'Drawing': 'S07', 'Computer': 'S08', 'Sanskrit': 'S09',
  'Games': 'S10', 'Library': 'S11', 'Diary': 'S12', 'I.T.': 'S08',
};

// Reverse map for applying timetable
const SUBJECT_ID_TO_NAME = {};
Object.entries(SUBJECT_MAP).forEach(([name, id]) => {
  if (!SUBJECT_ID_TO_NAME[id]) SUBJECT_ID_TO_NAME[id] = name;
});

async function persistLastRun(lastRun) {
  const { data: existing } = await supabase
    .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
  const prev = existing?.report || {};
  await supabase.from('allocation_reports').upsert({
    id: 1,
    report: { ...prev, lastRun },
    generated_at: new Date().toISOString(),
  });
}

// GET /result — last run result + rule flags
router.get('/result', async (_req, res) => {
  const { data } = await supabase
    .from('allocation_reports').select('*').eq('id', 1).maybeSingle();
  if (!data) return res.json({ rules: { R1: true, R2: true }, lastRun: null });
  const { rules, lastRun } = { rules: { R1: true, R2: true }, lastRun: null, ...data.report };
  res.json({ rules, lastRun, generated_at: data.generated_at });
});

// PATCH /rules — update rules (kept for backward compat, but rules are now always active)
router.patch('/rules', async (req, res) => {
  const { rules } = req.body || {};
  const { data: existing } = await supabase
    .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
  const current = existing?.report || {};
  const updated = { ...current, rules: { R1: true, R2: true, ...rules } };
  await supabase.from('allocation_reports').upsert({ id: 1, report: updated });
  res.json({ rules: updated.rules });
});

// DELETE /result — clear stored lastRun
router.delete('/result', async (_req, res) => {
  const { data: existing } = await supabase
    .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
  const prev = existing?.report || {};
  const { lastRun: _removed, ...rest } = prev;
  await supabase.from('allocation_reports').upsert({
    id: 1,
    report: { ...rest, rules: { R1: true, R2: true } },
    generated_at: new Date().toISOString(),
  });
  res.json({ cleared: true });
});

// GET /status — backward compat (always idle now since JS engine is sync)
router.get('/status', (_req, res) => {
  res.json({ running: false });
});

// POST /cancel — no-op for JS engine
router.post('/cancel', (_req, res) => {
  res.json({ cancelled: false, message: 'JS engine runs synchronously, nothing to cancel.' });
});

// ─── POST /run — Main allocator: reads DB directly, runs JS engine, returns result ───
router.post('/run', async (_req, res) => {
  try {
    const startTime = Date.now();

    // 1. Fetch ALL data directly from database
    const [allocsRes, classesRes, teachersRes] = await Promise.all([
      supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
      supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
      supabase.from('teachers').select('id, name, subjects, allotted_periods, min_period_start'),
    ]);

    if (allocsRes.error) throw new Error(`DB error (allocations): ${allocsRes.error.message}`);
    if (classesRes.error) throw new Error(`DB error (classes): ${classesRes.error.message}`);
    if (teachersRes.error) throw new Error(`DB error (teachers): ${teachersRes.error.message}`);

    const allocs = allocsRes.data || [];
    const classes = classesRes.data || [];
    const teachers = (teachersRes.data || []).map(t => ({
      ...t,
      min_period_start: t.min_period_start || 1,
      allotted_periods: t.allotted_periods || 0,
    }));

    // 2. Run engine (synchronous, < 5 seconds)
    const result = runTimetableEngine({
      teachers,
      classes,
      allocations: allocs,
    });

    const elapsed = Date.now() - startTime;
    result.elapsed_ms = elapsed;
    result.message += ` (${elapsed}ms)`;

    console.log(`\n[TIMETABLE ENGINE] ${result.success ? 'SUCCESS' : 'PARTIAL'}: ${result.filled}/${result.total} slots in ${elapsed}ms`);
    if (result.errors?.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      result.errors.slice(0, 5).forEach(e => console.log(`    - ${e.message}`));
    }
    if (result.warnings?.length > 0) {
      console.log(`  Warnings: ${result.warnings.length}`);
    }

    // 3. Persist result
    await persistLastRun(result);

    // 4. Return result directly (synchronous, no polling needed)
    res.json(result);
  } catch (e) {
    console.error('[TIMETABLE ENGINE] Error:', e.message);
    const errorResult = { success: false, error: e.message, solver_status_name: 'ENGINE_ERROR' };
    await persistLastRun(errorResult).catch(() => {});
    res.status(500).json(errorResult);
  }
});

// POST /apply — write result to timetable table
router.post('/apply', async (req, res) => {
  try {
    const { data: stored } = await supabase
      .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
    const result = stored?.report?.lastRun;
    if (!result?.success) return res.status(400).json({ error: 'No successful run to apply' });

    const grid = result.grid;
    const rows = [];

    // grid shape: { class_id: [ [[ {teacher_id, subject_id} ]] ] }
    for (const [class_id, days] of Object.entries(grid)) {
      for (let d = 0; d < days.length; d++) {
        for (let p = 0; p < days[d].length; p++) {
          const slot = days[d][p];
          if (!slot || !slot.length) continue;
          const entry = slot[0];
          // subject_id might be the subject name directly (from JS engine) or a code (from old CP-SAT)
          let subjectName = entry.subject_id || entry.subject;
          // If it's a code like S01, convert to name
          if (subjectName && subjectName.startsWith('S') && SUBJECT_ID_TO_NAME[subjectName]) {
            subjectName = SUBJECT_ID_TO_NAME[subjectName];
          }
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
