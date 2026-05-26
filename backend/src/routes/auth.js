const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

router.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const { data, error } = await supabase
    .from('admins')
    .select('id, username, password_hash')
    .eq('username', username)
    .single();

  if (error || !data)
    return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, data.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: data.id, username: data.username },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, username: data.username });
});

module.exports = router;
