const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');
const {
  buildSolverPayload,
  buildTargetChanges,
  isFixedTarget,
  runSolver,
  transformSolverResult,
  persistAllocationsAndTargets,
} = require('../lib/solverBridge');
const { buildPrecheckIssues, buildAllocationIssues } = require('../lib/allocationIssues');

router.use(requireAuth);

const SUBJECT_ID_TO_NAME = {
  S01: 'English', S02: 'Hindi', S03: 'Maths', S04: 'S.St', S05: 'Science',
  S06: 'G.K.', S07: 'Drawing', S08: 'Computer', S09: 'Sanskrit', S10: 'Games',
  S11: 'Library', S12: 'Diary',
};

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

async function persistSolverOutput(result, ctx) {
  await persistAllocationsAndTargets(supabase, result, ctx);
}

// GET /result — last run result + rule flags
router.get('/result', async (_req, res) => {
  const { data } = await supabase
    .from('allocation_reports').select('*').eq('id', 1).maybeSingle();
  if (!data) return res.json({ rules: { R1: true, R2: true }, lastRun: null });
  const { rules, lastRun } = { rules: { R1: true, R2: true }, lastRun: null, ...data.report };
  res.json({ rules, lastRun, generated_at: data.generated_at });
});

router.patch('/rules', async (req, res) => {
  const { rules } = req.body || {};
  const { data: existing } = await supabase
    .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
  const current = existing?.report || {};
  const updated = { ...current, rules: { R1: true, R2: true, ...rules } };
  await supabase.from('allocation_reports').upsert({ id: 1, report: updated });
  res.json({ rules: updated.rules });
});

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

router.get('/status', (_req, res) => {
  res.json({ running: false });
});

router.post('/cancel', (_req, res) => {
  res.json({ cancelled: false, message: 'CP-SAT solver runs synchronously.' });
});

// POST /run — curriculum + teachers → CP-SAT (allocate + schedule) → persist
router.post('/run', async (_req, res) => {
  try {
    const startTime = Date.now();

    const [subjectsRes, classesRes, teachersRes] = await Promise.all([
      supabase.from('subjects').select('*').order('name'),
      supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
      supabase.from('teachers').select('id, name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start'),
    ]);

    if (subjectsRes.error) throw new Error(`DB error (subjects): ${subjectsRes.error.message}`);
    if (classesRes.error) throw new Error(`DB error (classes): ${classesRes.error.message}`);
    if (teachersRes.error) throw new Error(`DB error (teachers): ${teachersRes.error.message}`);

    const subjects = subjectsRes.data || [];
    const classes = classesRes.data || [];
    const teachers = teachersRes.data || [];

    const wasFixedByName = Object.fromEntries(
      teachers.map((t) => [t.name, isFixedTarget(t.allotted_periods)]),
    );
    const nameToTeacherId = Object.fromEntries(teachers.map((t) => [t.name, t.id]));
    const payload = buildSolverPayload({ teachers, classes, subjects, mode: 'full' });

    console.log('[CP-SAT] Running two-phase solver…');
    const raw = await runSolver(payload);
    const result = transformSolverResult(raw, { teachers, classes });

    result.targetChanges = buildTargetChanges(teachers, raw.targets, payload.teachers);
    if (result.success) {
      result.issues = buildPrecheckIssues({ subjects, classes, teachers })
        .filter((i) => i.severity === 'warning');
    } else {
      result.issues = buildAllocationIssues({
        subjects, classes, teachers,
        lastRun: result,
      }).issues;
    }
    result.elapsed_ms = Date.now() - startTime;
    if (result.success) {
      result.message = `${result.message} (${result.elapsed_ms}ms)`;
      await persistSolverOutput(result, { nameToTeacherId, wasFixedByName });
    }

    console.log(`[CP-SAT] ${result.success ? 'SUCCESS' : 'FAILED'}: ${result.filled}/${result.total} in ${result.elapsed_ms}ms`);
    if (result.errors?.length) {
      result.errors.slice(0, 5).forEach((e) => console.log(`  - ${e.message}`));
    }

    await persistLastRun(result);
    res.json(result);
  } catch (e) {
    console.error('[CP-SAT] Error:', e.message);
    const errorResult = {
      success: false,
      error: e.message,
      solver_status_name: 'ENGINE_ERROR',
      message: e.message,
      filled: 0,
      total: 0,
    };
    await persistLastRun(errorResult).catch(() => {});
    res.status(500).json(errorResult);
  }
});

router.post('/apply', async (req, res) => {
  try {
    const { data: stored } = await supabase
      .from('allocation_reports').select('report').eq('id', 1).maybeSingle();
    const result = stored?.report?.lastRun;
    if (!result?.success) return res.status(400).json({ error: 'No successful run to apply' });

    const grid = result.grid;
    const rows = [];

    for (const [class_id, days] of Object.entries(grid)) {
      for (let d = 0; d < days.length; d++) {
        for (let p = 0; p < days[d].length; p++) {
          const slot = days[d][p];
          if (!slot || !slot.length) continue;
          const entry = slot[0];
          let subjectName = entry.subject_id || entry.subject;
          if (subjectName && subjectName.startsWith('S') && SUBJECT_ID_TO_NAME[subjectName]) {
            subjectName = SUBJECT_ID_TO_NAME[subjectName];
          }
          rows.push({
            class_id,
            teacher_id: entry.teacher_id,
            day: d + 1,
            period: p + 1,
            subject: subjectName,
          });
        }
      }
    }

    await supabase.from('timetable').delete().neq('id', '00000000-0000-0000-0000-000000000000');

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
