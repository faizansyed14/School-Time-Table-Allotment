require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
    process.exit(1);
  }
  console.log('Supabase URL:', url);

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from('admins')
    .select('id, username, password_hash')
    .eq('username', 'admin')
    .single();

  if (error) {
    console.error('Query error:', error.message, error.code, error.details);
    process.exit(1);
  }
  console.log('Found admin:', data.username, 'id:', data.id);
  console.log('Hash prefix:', data.password_hash?.slice(0, 20));

  const ok = bcrypt.compareSync('admin123', data.password_hash);
  console.log('admin123 matches hash:', ok);
  if (!ok) {
    console.log('Run database/patches/02_fix_admin_password.sql in Supabase');
    process.exit(1);
  }
  console.log('OK — credentials valid for this Supabase project');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
