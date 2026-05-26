const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// Plain class select — no teacher join (avoids FK ambiguity with timetable table)
// Frontend gets teacher names from the /teachers endpoint and maps by ID.
const CLASS_SELECT = 'id, name, class_level, section, display_order, class_teacher_id';

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('classes')
    .select(CLASS_SELECT)
    .order('display_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { name, class_level, section, display_order, class_teacher_id } = req.body;
  if (!name || !class_level) return res.status(400).json({ error: 'name and class_level required' });
  const { data, error } = await supabase
    .from('classes')
    .insert({ name, class_level, section, display_order: display_order || 0, class_teacher_id })
    .select(CLASS_SELECT)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const allowed = ['name', 'class_level', 'section', 'display_order', 'class_teacher_id'];
  const updates = {};
  allowed.forEach((k) => { if (k in req.body) updates[k] = req.body[k]; });
  const { data, error } = await supabase
    .from('classes')
    .update(updates)
    .eq('id', req.params.id)
    .select(CLASS_SELECT)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('classes').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
