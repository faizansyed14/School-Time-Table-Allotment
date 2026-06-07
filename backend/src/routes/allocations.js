const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');
const { buildPrecheckIssues, buildAllocationIssues, buildAllocationPlanIssues } = require('../lib/allocationIssues');
const {
  buildSolverPayload,
  buildTargetChanges,
  isFixedTarget,
  runSolver,
  transformAllocateResult,
  persistAllocationsAndTargets,
} = require('../lib/solverBridge');

router.use(requireAuth);

// ── GET all allocations ───────────────────────────────────────
router.get('/', async (req, res) => {
  const { teacher_id, class_id } = req.query;
  let q = supabase
    .from('subject_allocations')
    .select('teacher_id, class_id, subject, periods_weekly, teachers(name), classes(name, class_level)')
    .order('class_id')
    .order('subject');
  if (teacher_id) q = q.eq('teacher_id', teacher_id);
  if (class_id)   q = q.eq('class_id', class_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r) => ({
    teacher_id:  r.teacher_id,
    teacher_name: r.teachers?.name   || null,
    class_id:    r.class_id,
    class_name:  r.classes?.name     || null,
    class_level: r.classes?.class_level || null,
    subject:     r.subject,
    periods_weekly: r.periods_weekly,
  }));
  res.json(rows);
});

// ── POST create (single or array) ────────────────────────────
router.post('/', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  for (const it of items) {
    if (!it.teacher_id || !it.class_id || !it.subject || !it.periods_weekly)
      return res.status(400).json({ error: 'teacher_id, class_id, subject, periods_weekly all required' });
  }
  const rows = items.map((it) => ({
    teacher_id: it.teacher_id, class_id: it.class_id,
    subject: it.subject, periods_weekly: Number(it.periods_weekly),
  }));
  const { data, error } = await supabase
    .from('subject_allocations')
    .upsert(rows, { onConflict: 'teacher_id,class_id,subject' })
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// ── PUT update periods ────────────────────────────────────────
router.put('/:teacher_id/:class_id/:subject', async (req, res) => {
  const { teacher_id, class_id, subject } = req.params;
  const { periods_weekly } = req.body;
  const { data, error } = await supabase
    .from('subject_allocations')
    .update({ periods_weekly: Number(periods_weekly) })
    .eq('teacher_id', teacher_id).eq('class_id', class_id).eq('subject', subject)
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── DELETE one row ────────────────────────────────────────────
router.delete('/:teacher_id/:class_id/:subject', async (req, res) => {
  const { teacher_id, class_id, subject } = req.params;
  const { error } = await supabase
    .from('subject_allocations')
    .delete()
    .eq('teacher_id', teacher_id).eq('class_id', class_id).eq('subject', subject);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /swap-teacher ────────────────────────────────────────
router.post('/swap-teacher', async (req, res) => {
  const { from_teacher_id, to_teacher_id } = req.body || {};
  if (!from_teacher_id || !to_teacher_id)
    return res.status(400).json({ error: 'from_teacher_id and to_teacher_id required' });
  const { data: rows, error: e1 } = await supabase
    .from('subject_allocations').select('class_id, subject, periods_weekly').eq('teacher_id', from_teacher_id);
  if (e1) return res.status(500).json({ error: e1.message });
  if (!rows || rows.length === 0) return res.json({ success: true, swapped: 0 });
  const { error: e2 } = await supabase.from('subject_allocations')
    .upsert(rows.map((r) => ({ ...r, teacher_id: to_teacher_id })), { onConflict: 'teacher_id,class_id,subject' });
  if (e2) return res.status(400).json({ error: e2.message });
  const { error: e3 } = await supabase.from('subject_allocations').delete().eq('teacher_id', from_teacher_id);
  if (e3) return res.status(400).json({ error: e3.message });
  await supabase.from('classes').update({ class_teacher_id: to_teacher_id }).eq('class_teacher_id', from_teacher_id);
  res.json({ success: true, swapped: rows.length });
});

// ── GET /validate ─────────────────────────────────────────────
router.get('/validate', async (_req, res) => {
  const [subj, classes, teachers, report, allocs] = await Promise.all([
    supabase.from('subjects').select('*'),
    supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
    supabase.from('teachers').select('id, name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start'),
    supabase.from('allocation_reports').select('report').eq('id', 1).maybeSingle(),
    supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
  ]);

  const lastRun = report.data?.report?.lastRun || null;
  const planIssues = buildAllocationPlanIssues({
    subjects: subj.data,
    classes: classes.data,
    teachers: teachers.data,
    allocations: allocs.data,
  });
  const result = buildAllocationIssues({
    subjects: subj.data,
    classes: classes.data,
    teachers: teachers.data,
    lastRun,
    planIssues,
  });
  res.json(result);
});

// ── POST /auto-generate — CP-SAT Phase A (same engine as Allotment) ──
router.post('/auto-generate', async (req, res) => {
  const apply = req.query.apply === '1';
  try {
    const [teachersRes, classesRes, subjectsRes] = await Promise.all([
      supabase.from('teachers').select('id, name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start'),
      supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
      supabase.from('subjects').select('*'),
    ]);
    if (teachersRes.error) throw new Error(teachersRes.error.message);
    if (classesRes.error) throw new Error(classesRes.error.message);
    if (subjectsRes.error) throw new Error(subjectsRes.error.message);

    const teachers = teachersRes.data || [];
    const classes = classesRes.data || [];
    const subjects = subjectsRes.data || [];

    const wasFixedByName = Object.fromEntries(
      teachers.map((t) => [t.name, isFixedTarget(t.allotted_periods)]),
    );
    const nameToTeacherId = Object.fromEntries(teachers.map((t) => [t.name, t.id]));
    const payload = buildSolverPayload({ teachers, classes, subjects, mode: 'allocate' });

    const raw = await runSolver(payload);
    const result = transformAllocateResult(raw, { teachers, classes });
    const targetChanges = buildTargetChanges(teachers, raw.targets, payload.teachers);
    const precheckIssues = buildPrecheckIssues({ subjects, classes, teachers });

    if (!result.success) {
      const issues = buildAllocationIssues({
        subjects, classes, teachers,
        lastRun: { success: false, message: result.message, errors: result.errors },
      }).issues;
      return res.json({
        success: false,
        ok: false,
        errors: result.errors?.map((e) => e.message) || [result.message],
        message: result.message,
        issues,
        targetChanges,
      });
    }

    if (apply) {
      await persistAllocationsAndTargets(
        supabase,
        { allocations: result.allocations, targets: result.targets },
        { nameToTeacherId, wasFixedByName },
      );
    }

    res.json({
      success: true,
      ok: true,
      applied: apply,
      count: result.allocations.length,
      totalAssigned: result.totalAssigned,
      totalExpected: result.totalExpected,
      filled: result.filled,
      total: result.total,
      message: result.message,
      class_summary: result.class_summary,
      allocations: apply ? undefined : result.allocations,
      targets: result.targets,
      targetChanges,
      issues: precheckIssues.filter((i) => i.severity === 'warning'),
    });
  } catch (e) {
    console.error('[AUTO-GENERATE] Error:', e.message);
    res.status(500).json({ success: false, error: e.message, errors: [e.message] });
  }
});

module.exports = router;