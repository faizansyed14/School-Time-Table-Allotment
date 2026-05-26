const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

function dateToSchoolDay(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  return dow === 0 ? 6 : dow;
}

function teacherCanCover(teacher, subject, classLevel) {
  const subjects = teacher.subjects || [];
  const teachesSubject = subjects.includes(subject);
  const inRange = classLevel >= (teacher.min_class_level || 1)
    && classLevel <= (teacher.max_class_level || 10);
  const minP = teacher.min_period_start || 1;
  return { teachesSubject, inRange, min_period_start: minP };
}

/**
 * best (green)    — teaches subject + class level in range + free at period
 * subject (yellow)— teaches subject but level out of range
 * other (white)   — free at period, different subject (or level-only fit)
 */
function substituteMatchTier(teacher, slot, classLevel) {
  const { teachesSubject, inRange, min_period_start } = teacherCanCover(teacher, slot.subject, classLevel);
  const periodOk = slot.period >= min_period_start;
  if (!periodOk) return 'none';
  if (teachesSubject && inRange) return 'best';
  if (teachesSubject && !inRange) return 'subject';
  return 'other';
}

// GET substitute options per period for an absent teacher on a date
router.get('/substitute-coverage', async (req, res) => {
  const { teacher_id, date, absence_id } = req.query;
  if (!teacher_id || !date) {
    return res.status(400).json({ error: 'teacher_id and date required' });
  }

  const day = dateToSchoolDay(date);

  const subsPromise = absence_id
    ? supabase
      .from('substitutions')
      .select('timetable_id, substitute_teacher_id, teachers!substitute_teacher_id(id, name)')
      .eq('absence_id', absence_id)
    : Promise.resolve({ data: [] });

  const [slotsRes, absentRes, dayTimetableRes, teachersRes, subsRes] = await Promise.all([
    supabase
      .from('timetable')
      .select('id, day, period, subject, class_id, classes(name, class_level)')
      .eq('teacher_id', teacher_id)
      .eq('day', day)
      .order('period'),
    supabase.from('absences').select('teacher_id').eq('absent_date', date),
    supabase.from('timetable').select('teacher_id, period').eq('day', day),
    supabase
      .from('teachers')
      .select('id, name, subjects, min_class_level, max_class_level, min_period_start')
      .order('name'),
    subsPromise,
  ]);

  if (slotsRes.error) return res.status(500).json({ error: slotsRes.error.message });
  if (absentRes.error) return res.status(500).json({ error: absentRes.error.message });
  if (dayTimetableRes.error) return res.status(500).json({ error: dayTimetableRes.error.message });
  if (teachersRes.error) return res.status(500).json({ error: teachersRes.error.message });

  const absentIds = new Set((absentRes.data || []).map((a) => a.teacher_id));
  absentIds.add(teacher_id);

  const busyByPeriod = {};
  for (let p = 1; p <= 8; p++) busyByPeriod[p] = new Set();
  (dayTimetableRes.data || []).forEach((row) => {
    if (row.teacher_id && row.period) busyByPeriod[row.period].add(row.teacher_id);
  });

  const pool = (teachersRes.data || []).filter((t) => !absentIds.has(t.id));
  const subByTimetable = Object.fromEntries(
    (subsRes.data || []).map((s) => [s.timetable_id, {
      id: s.substitute_teacher_id,
      name: s.teachers?.name || '',
    }]),
  );

  const slots = (slotsRes.data || []).map((slot) => {
    const classLevel = slot.classes?.class_level ?? 1;
    const busyHere = busyByPeriod[slot.period] || new Set();

    const available = pool
      .filter((t) => !busyHere.has(t.id))
      .map((t) => {
        const { teachesSubject, inRange, min_period_start } = teacherCanCover(t, slot.subject, classLevel);
        const periodOk = slot.period >= min_period_start;
        const match_tier = substituteMatchTier(t, slot, classLevel);
        return {
          id: t.id,
          name: t.name,
          subjects: t.subjects || [],
          min_class_level: t.min_class_level,
          max_class_level: t.max_class_level,
          level_label: `L${t.min_class_level}–L${t.max_class_level}`,
          teaches_subject: teachesSubject,
          in_class_range: inRange,
          period_ok: periodOk,
          match_tier,
          match_label: match_tier === 'best'
            ? 'Subject + level match'
            : match_tier === 'subject'
              ? 'Subject match, level mismatch'
              : 'Other (different subject)',
          recommended: match_tier === 'best',
        };
      })
      .filter((t) => t.match_tier !== 'none')
      .sort((a, b) => {
        const order = { best: 0, subject: 1, other: 2 };
        if (order[a.match_tier] !== order[b.match_tier]) return order[a.match_tier] - order[b.match_tier];
        return a.name.localeCompare(b.name);
      });

    const substitute = subByTimetable[slot.id] || null;

    return {
      id: slot.id,
      day: slot.day,
      period: slot.period,
      subject: slot.subject,
      class_id: slot.class_id,
      class_name: slot.classes?.name || '',
      class_level: classLevel,
      available,
      available_count: available.length,
      recommended_count: available.filter((t) => t.match_tier === 'best').length,
      substitute,
      needs_substitute: true,
    };
  });

  const classIds = [...new Set(slots.map((s) => s.class_id))];
  let classTimetables = {};

  if (classIds.length) {
    const { data: classRows, error: classErr } = await supabase
      .from('timetable')
      .select('id, class_id, period, subject, teacher_id, teachers(name), classes(name, class_level)')
      .eq('day', day)
      .in('class_id', classIds)
      .order('period');
    if (classErr) return res.status(500).json({ error: classErr.message });

    const absentSlotIds = new Set(slots.map((s) => s.id));
    classIds.forEach((cid) => {
      const rows = (classRows || []).filter((r) => r.class_id === cid);
      const first = rows[0];
      classTimetables[cid] = {
        class_id: cid,
        class_name: first?.classes?.name || '',
        class_level: first?.classes?.class_level ?? 1,
        periods: Array.from({ length: 8 }, (_, i) => {
          const p = i + 1;
          const row = rows.find((r) => r.period === p);
          if (!row) return { period: p, empty: true };
          const isAbsentSlot = absentSlotIds.has(row.id);
          const sub = subByTimetable[row.id];
          return {
            period: p,
            timetable_id: row.id,
            subject: row.subject,
            teacher_id: row.teacher_id,
            teacher_name: row.teachers?.name || '—',
            is_absent_slot: isAbsentSlot,
            substitute: sub,
            display_teacher: sub?.name || row.teachers?.name || '—',
          };
        }),
      };
    });
  }

  const classes = classIds
    .map((id) => classTimetables[id])
    .sort((a, b) => a.class_name.localeCompare(b.class_name));

  res.json({
    date,
    day,
    day_name: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day - 1],
    slots,
    classes,
    summary: {
      total_slots: slots.length,
      assigned: slots.filter((s) => s.substitute).length,
      pending: slots.filter((s) => !s.substitute).length,
    },
  });
});

// GET absences (optionally filtered by date)
router.get('/', async (req, res) => {
  const { date } = req.query;
  let q = supabase
    .from('absences')
    .select('*, teachers(id, name), substitutions(substitute_teacher_id, timetable_id, teachers!substitute_teacher_id(name))')
    .order('absent_date', { ascending: false });
  if (date) q = q.eq('absent_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET available substitutes (legacy — prefer substitute-coverage)
router.get('/available-substitutes', async (req, res) => {
  const { teacher_id, date } = req.query;
  if (!teacher_id || !date)
    return res.status(400).json({ error: 'teacher_id and date required' });

  const { data: absentIds } = await supabase
    .from('absences')
    .select('teacher_id')
    .eq('absent_date', date);
  const excluded = new Set([teacher_id, ...(absentIds || []).map((a) => a.teacher_id)]);

  const { data, error } = await supabase
    .from('teachers')
    .select('id, name, subjects, min_class_level, max_class_level, allotted_periods, allocated_periods')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).filter((t) => !excluded.has(t.id)).map((t) => ({
    ...t,
    level_label: `L${t.min_class_level}–L${t.max_class_level}`,
  })));
});

// POST mark absent
router.post('/', async (req, res) => {
  const { teacher_id, absent_date, reason } = req.body;
  if (!teacher_id || !absent_date)
    return res.status(400).json({ error: 'teacher_id and absent_date required' });
  const { data, error } = await supabase
    .from('absences')
    .upsert({ teacher_id, absent_date, reason }, { onConflict: 'teacher_id,absent_date' })
    .select('*, teachers(name)').single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE absence
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('absences').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// POST assign substitute
router.post('/:absence_id/substitute', async (req, res) => {
  const { timetable_id, substitute_teacher_id } = req.body;
  if (!timetable_id || !substitute_teacher_id)
    return res.status(400).json({ error: 'timetable_id and substitute_teacher_id required' });
  const { data, error } = await supabase
    .from('substitutions')
    .upsert({ absence_id: req.params.absence_id, timetable_id, substitute_teacher_id }, { onConflict: 'absence_id,timetable_id' })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
