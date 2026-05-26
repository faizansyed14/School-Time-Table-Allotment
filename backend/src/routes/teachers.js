const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');
const { buildAllocationIssues } = require('../lib/allocationIssues');

router.use(requireAuth);

/** Build timetable rows from CP solver grid for preview issues / summary */
function timetableRowsFromRunGrid(grid) {
  const rows = [];
  if (!grid || typeof grid !== 'object') return rows;
  for (const [class_id, days] of Object.entries(grid)) {
    for (let d = 0; d < days.length; d++) {
      for (let p = 0; p < days[d].length; p++) {
        const slot = days[d][p];
        if (!slot?.length) continue;
        rows.push({
          class_id,
          teacher_id: slot[0].teacher_id,
          day: d + 1,
          period: p + 1,
        });
      }
    }
  }
  return rows;
}

// GET /teachers/allotment-summary — workload vs allocations per teacher
router.get('/allotment-summary', async (_req, res) => {
  const [teachersRes, allocsRes, subjectsRes, classesRes, reportRes, ttRes] = await Promise.all([
    supabase.from('teachers')
      .select('id, name, subjects, min_class_level, max_class_level, allotted_periods, allocated_periods, min_period_start')
      .order('name'),
    supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
    supabase.from('subjects').select('*'),
    supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
    supabase.from('allocation_reports').select('report').eq('id', 1).maybeSingle(),
    supabase.from('timetable').select('class_id, teacher_id, day, period'),
  ]);
  if (teachersRes.error) return res.status(500).json({ error: teachersRes.error.message });
  if (allocsRes.error) return res.status(500).json({ error: allocsRes.error.message });
  if (subjectsRes.error) return res.status(500).json({ error: subjectsRes.error.message });
  if (classesRes.error) return res.status(500).json({ error: classesRes.error.message });

  const lastRun = reportRes.data?.report?.lastRun || null;
  const useRunPreview = !!(lastRun?.success && lastRun?.teacher_summary);
  const previewTimetable = useRunPreview && lastRun.grid
    ? timetableRowsFromRunGrid(lastRun.grid)
    : null;
  const timetableForIssues = previewTimetable?.length ? previewTimetable : (ttRes.data || []);

  const teachersForIssues = (teachersRes.data || []).map((t) => {
    if (!useRunPreview) return t;
    const preview = lastRun.teacher_summary[t.id]?.allocated ?? 0;
    return { ...t, allocated_periods: preview };
  });

  const issueReport = buildAllocationIssues({
    subjects: subjectsRes.data,
    classes: classesRes.data,
    teachers: teachersForIssues,
    allocations: allocsRes.data,
    lastRun,
    timetable: timetableForIssues,
  });

  const allocByTeacher = {};
  (allocsRes.data || []).forEach((a) => {
    allocByTeacher[a.teacher_id] = (allocByTeacher[a.teacher_id] || 0) + a.periods_weekly;
  });

  const teachers = (teachersRes.data || []).map((t) => {
    const minP = t.min_period_start || 1;
    const allocation_total = allocByTeacher[t.id] || 0;
    const rowIssues = issueReport.teacherIssuesById[t.id] || [];
    const timetable_db = t.allocated_periods || 0;
    const preview = useRunPreview ? (lastRun.teacher_summary[t.id]?.allocated ?? 0) : null;
    const timetable_periods = preview != null ? preview : timetable_db;
    return {
      id: t.id,
      name: t.name,
      subjects: t.subjects || [],
      min_class_level: t.min_class_level,
      max_class_level: t.max_class_level,
      level_label: `L${t.min_class_level}–L${t.max_class_level}`,
      allotted_periods: t.allotted_periods || 0,
      allocation_total,
      allocated_periods: timetable_periods,
      timetable_db,
      timetable_source: preview != null ? 'preview' : 'database',
      min_period_start: minP,
      capacity: (8 - (minP - 1)) * 6,
      issues: rowIssues,
      has_issues: rowIssues.length > 0,
    };
  });

  res.json({
    ok: issueReport.ok,
    error_count: issueReport.error_count,
    warning_count: issueReport.warning_count,
    issues: issueReport.issues,
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
    .select('*')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('teachers')
    .insert({ name, subjects: subjects || [], min_class_level: min_class_level || 1,
              max_class_level: max_class_level || 10, allotted_periods: allotted_periods || 0,
              min_period_start: min_period_start || 1 })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const allowed = ['name','subjects','min_class_level','max_class_level','allotted_periods','min_period_start'];
  const updates = {};
  allowed.forEach((k) => { if (k in req.body) updates[k] = req.body[k]; });
  const { data, error } = await supabase
    .from('teachers').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('teachers').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
