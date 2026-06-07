const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

const TEACHER_SELECT = 'id, name, subjects, min_class_level, max_class_level, allotted_periods, allocated_periods, min_period_start';

// GET /teachers/allotment-summary — workload vs allocations per teacher
router.get('/allotment-summary', async (_req, res) => {
  const [teachersRes, allocsRes, reportRes] = await Promise.all([
    supabase.from('teachers')
      .select('id, name, subjects, min_class_level, max_class_level, allotted_periods, allocated_periods, min_period_start')
      .order('name'),
    supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
    supabase.from('allocation_reports').select('report, generated_at').eq('id', 1).maybeSingle(),
  ]);
  if (teachersRes.error) return res.status(500).json({ error: teachersRes.error.message });
  if (allocsRes.error) return res.status(500).json({ error: allocsRes.error.message });

  const lastRun = reportRes.data?.report?.lastRun || null;
  const useRunPreview = !!(lastRun?.success && lastRun?.teacher_summary);

  const allocByTeacher = {};
  (allocsRes.data || []).forEach((a) => {
    allocByTeacher[a.teacher_id] = (allocByTeacher[a.teacher_id] || 0) + a.periods_weekly;
  });

  const teachers = (teachersRes.data || []).map((t) => {
    const minP = t.min_period_start || 1;
    const allocation_total = allocByTeacher[t.id] || 0;
    const timetable_db = t.allocated_periods || 0;
    const preview = useRunPreview ? (lastRun.teacher_summary[t.id]?.allocated ?? 0) : null;
    const timetable_periods = preview != null ? preview : timetable_db;
    const targetLabel = (t.allotted_periods || 0) > 0 ? t.allotted_periods : 'Auto';
    return {
      id: t.id,
      name: t.name,
      subjects: t.subjects || [],
      min_class_level: t.min_class_level,
      max_class_level: t.max_class_level,
      level_label: `L${t.min_class_level}–L${t.max_class_level}`,
      allotted_periods: t.allotted_periods || 0,
      target_label: targetLabel,
      allocation_total,
      allocated_periods: timetable_periods,
      timetable_db,
      timetable_source: preview != null ? 'preview' : 'database',
      min_period_start: minP,
      capacity: (8 - (minP - 1)) * 6,
    };
  });

  res.json({
    summary_source: useRunPreview ? 'preview' : 'database',
    totals: {
      teacher_count: teachers.length,
      allotted_sum: teachers.reduce((s, t) => s + t.allotted_periods, 0),
      allocation_sum: teachers.reduce((s, t) => s + t.allocation_total, 0),
      timetable_sum: teachers.reduce((s, t) => s + t.allocated_periods, 0),
      timetable_db_sum: teachers.reduce((s, t) => s + (t.timetable_db || 0), 0),
    },
    teachers,
    last_run: lastRun ? {
      success: lastRun.success,
      filled: lastRun.filled,
      total: lastRun.total,
      solver_status_name: lastRun.solver_status_name,
      generated_at: reportRes.data?.generated_at,
    } : null,
  });
});

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('teachers')
    .select(TEACHER_SELECT)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const {
    name, subjects, min_class_level, max_class_level,
    allotted_periods, min_period_start,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase
    .from('teachers')
    .insert({
      name: name.trim(),
      subjects: subjects || [],
      min_class_level: min_class_level ?? 1,
      max_class_level: max_class_level ?? 10,
      allotted_periods: allotted_periods ?? 0,
      min_period_start: min_period_start ?? 1,
    })
    .select(TEACHER_SELECT)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const allowed = [
    'name', 'subjects', 'min_class_level', 'max_class_level',
    'allotted_periods', 'min_period_start',
  ];
  const updates = {};
  allowed.forEach((k) => { if (k in req.body) updates[k] = req.body[k]; });
  const { data, error } = await supabase
    .from('teachers')
    .update(updates)
    .eq('id', req.params.id)
    .select(TEACHER_SELECT)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('teachers').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
