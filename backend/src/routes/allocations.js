const router = require('express').Router();
const supabase = require('../config/supabase');
const getPythonCommand = require('../config/python');
const requireAuth = require('../middleware/auth');
const { buildAllocationIssues } = require('../lib/allocationIssues');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

router.use(requireAuth);

const BACKEND_DIR = path.join(__dirname, '..', '..');   // school-erp/backend
const SCRIPTS_DIR = path.join(BACKEND_DIR, 'scripts');   // school-erp/backend/scripts

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
  const [subj, classes, teachers, allocs, report, tt] = await Promise.all([
    supabase.from('subjects').select('*'),
    supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
    supabase.from('teachers').select('id, name, allotted_periods, allocated_periods, min_period_start'),
    supabase.from('subject_allocations').select('teacher_id, class_id, subject, periods_weekly'),
    supabase.from('allocation_reports').select('report').eq('id', 1).maybeSingle(),
    supabase.from('timetable').select('class_id, teacher_id, day, period'),
  ]);

  const result = buildAllocationIssues({
    subjects: subj.data,
    classes: classes.data,
    teachers: teachers.data,
    allocations: allocs.data,
    lastRun: report.data?.report?.lastRun,
    timetable: tt.data,
  });
  res.json(result);
});

const { autoGenerateAllocations } = require('../lib/autoGenerator');

// ── POST /auto-generate ───────────────────────────────────────
// Reads live DB: subjects (curriculum), teachers (targets + subjects + levels), classes (class teachers).
// Does NOT read existing subject_allocations. On apply=1, replaces all allocation rows.
router.post('/auto-generate', async (req, res) => {
  const apply = req.query.apply === '1';
  try {
    const [teachersRes, classesRes, subjectsRes] = await Promise.all([
      supabase.from('teachers').select('id, name, subjects, min_class_level, max_class_level, allotted_periods'),
      supabase.from('classes').select('id, name, class_level, class_teacher_id').order('display_order'),
      supabase.from('subjects').select('*'),
    ]);
    if (teachersRes.error) throw new Error(teachersRes.error.message);
    if (classesRes.error)  throw new Error(classesRes.error.message);
    if (subjectsRes.error) throw new Error(subjectsRes.error.message);

    const result = autoGenerateAllocations({
      teachers: teachersRes.data || [],
      classes:  classesRes.data  || [],
      subjects: subjectsRes.data || [],
    });

    if (!result.success) return res.json({ success: false, errors: result.errors, warnings: result.warnings });

    if (apply) {
      // Clear existing allocations
      await supabase.from('subject_allocations').delete().neq('teacher_id', '00000000-0000-0000-0000-000000000000');
      
      // Insert new allocations in batches
      for (let i = 0; i < result.allocations.length; i += 100) {
        const batch = result.allocations.slice(i, i + 100);
        const { error } = await supabase.from('subject_allocations').insert(batch);
        if (error) throw new Error(error.message);
      }
    }

    res.json({
      success: true, 
      applied: apply, 
      count: result.allocations.length,
      warnings: result.warnings,
      allocations: apply ? undefined : result.allocations,
    });
  } catch (e) {
    console.error('[AUTO-GENERATE] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;