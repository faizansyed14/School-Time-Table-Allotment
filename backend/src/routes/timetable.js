const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /timetable?class_id=...&teacher_id=...
router.get('/', async (req, res) => {
  const { class_id, teacher_id } = req.query;
  let q = supabase
    .from('timetable')
    .select('id, class_id, teacher_id, day, period, subject, classes(name, class_level), teachers(name)')
    .order('day').order('period');
  if (class_id)   q = q.eq('class_id', class_id);
  if (teacher_id) q = q.eq('teacher_id', teacher_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /timetable/classes — plain list, no teacher join (avoids FK ambiguity)
router.get('/classes', async (_req, res) => {
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, class_level, section, display_order, class_teacher_id')
    .order('display_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PUT /master-cell — edit all Mon–Sat slots for one class + period row
router.put('/master-cell', async (req, res) => {
  const { class_id, period, segments } = req.body || {};
  const periodNum = Number(period);
  if (!class_id || !periodNum || periodNum < 1 || periodNum > 8) {
    return res.status(400).json({ error: 'class_id and period (1–8) required' });
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'segments array required' });
  }

  const covered = new Set();
  for (const s of segments) {
    const start = Number(s.dayStart);
    const end = Number(s.dayEnd);
    if (!s.teacher_id || !s.subject || !start || !end || start > end || start < 1 || end > 6) {
      return res.status(400).json({ error: 'Each segment needs dayStart, dayEnd (1–6), subject, teacher_id' });
    }
    for (let d = start; d <= end; d++) {
      if (covered.has(d)) return res.status(400).json({ error: `Overlapping day ${d} in segments` });
      covered.add(d);
    }
  }
  for (let d = 1; d <= 6; d++) {
    if (!covered.has(d)) {
      return res.status(400).json({ error: `Day ${d} not covered — use lines like 1-3 Maths (Name) and 4-6 English (Name)` });
    }
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('timetable')
      .select('id, day, teacher_id')
      .eq('class_id', class_id)
      .eq('period', periodNum);
    if (fetchErr) throw new Error(fetchErr.message);

    const byDay = Object.fromEntries((existing || []).map((r) => [r.day, r]));

    for (let d = 1; d <= 6; d++) {
      const seg = segments.find((s) => d >= Number(s.dayStart) && d <= Number(s.dayEnd));
      if (!seg) continue;

      const { data: clash } = await supabase
        .from('timetable')
        .select('id, classes(name)')
        .eq('teacher_id', seg.teacher_id)
        .eq('day', d)
        .eq('period', periodNum)
        .neq('class_id', class_id)
        .maybeSingle();

      if (clash) {
        const cn = clash.classes?.name || 'another class';
        const { data: t } = await supabase.from('teachers').select('name').eq('id', seg.teacher_id).single();
        return res.status(400).json({
          error: `${t?.name || 'Teacher'} is already teaching ${cn} on day ${d} period ${periodNum}`,
        });
      }

      const row = byDay[d];
      if (row) {
        const { error } = await supabase
          .from('timetable')
          .update({ teacher_id: seg.teacher_id, subject: seg.subject })
          .eq('id', row.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('timetable')
          .insert({ class_id, day: d, period: periodNum, teacher_id: seg.teacher_id, subject: seg.subject });
        if (error) throw new Error(error.message);
      }
    }

    const { data: updated, error: outErr } = await supabase
      .from('timetable')
      .select('id, class_id, teacher_id, day, period, subject, classes(name, class_level), teachers(name)')
      .eq('class_id', class_id)
      .eq('period', periodNum)
      .order('day');
    if (outErr) throw new Error(outErr.message);

    res.json({ success: true, rows: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT — edit a single timetable cell
router.put('/:id', async (req, res) => {
  const { teacher_id, subject } = req.body;
  const { data, error } = await supabase
    .from('timetable')
    .update({ teacher_id, subject })
    .eq('id', req.params.id)
    .select('*, teachers(name)')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE all rows (called before re-applying a CP run)
router.delete('/all', async (_req, res) => {
  const { error } = await supabase
    .from('timetable')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
