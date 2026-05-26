const router = require('express').Router();
const supabase = require('../config/supabase');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

const CLASS_COLS = ['1a','1b','2a','2b','3a','3b','4a','4b','5','6a','6b','7','8','9','10'];

router.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('subjects').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const row = { name };
  CLASS_COLS.forEach((c) => { row[`periods_${c}`] = Number(req.body[`periods_${c}`]) || 0; });
  const { data, error } = await supabase.from('subjects').insert(row).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const updates = {};
  if ('name' in req.body) updates.name = req.body.name;
  CLASS_COLS.forEach((c) => {
    const k = `periods_${c}`;
    if (k in req.body) updates[k] = Number(req.body[k]) || 0;
  });
  const { data, error } = await supabase.from('subjects').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('subjects').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
