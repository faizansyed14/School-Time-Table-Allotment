const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

router.get('/stats', async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const [teachers, classes, allocs, absences, timetable] = await Promise.all([
    supabase.from('teachers').select('id', { count: 'exact', head: true }),
    supabase.from('classes').select('id', { count: 'exact', head: true }),
    supabase.from('subject_allocations').select('periods_weekly'),
    supabase.from('absences').select('teacher_id, teachers(name)').eq('absent_date', today),
    supabase.from('timetable').select('id', { count: 'exact', head: true }),
  ]);

  const totalPeriods = (allocs.data || []).reduce((s, r) => s + r.periods_weekly, 0);
  const absentToday = (absences.data || []).map((a) => ({
    teacher_id: a.teacher_id,
    teacher_name: a.teachers?.name,
  }));

  res.json({
    teacher_count:  teachers.count  ?? 0,
    class_count:    classes.count   ?? 0,
    total_periods:  totalPeriods,
    timetable_slots: timetable.count ?? 0,
    absent_today:   absentToday,
    timetable_ready: (timetable.count ?? 0) > 0,
  });
});

module.exports = router;
