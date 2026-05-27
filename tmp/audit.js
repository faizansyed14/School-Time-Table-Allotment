const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/FAIZAN/Desktop/School Time Table 2/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const CLASS_COL_MAP = {
  '1A': 'periods_1a', '1B': 'periods_1b',
  '2A': 'periods_2a', '2B': 'periods_2b',
  '3A': 'periods_3a', '3B': 'periods_3b',
  '4A': 'periods_4a', '4B': 'periods_4b',
  '5': 'periods_5', '6A': 'periods_6a', '6B': 'periods_6b',
  '7': 'periods_7', '8': 'periods_8',
  '9': 'periods_9', '10': 'periods_10',
};

async function audit() {
  const [tRes, cRes, sRes] = await Promise.all([
    supabase.from('teachers').select('*'),
    supabase.from('classes').select('*'),
    supabase.from('subjects').select('*'),
  ]);

  const teachers = tRes.data;
  const classes = cRes.data;
  const subjects = sRes.data;

  const demand = {};
  const capacity = {};

  // 1. Calculate Demand
  for (const cls of classes) {
    const col = CLASS_COL_MAP[cls.name];
    if (!col) continue;
    for (const sub of subjects) {
      const p = sub[col] || 0;
      if (p > 0) {
        demand[sub.name] = (demand[sub.name] || 0) + p;
      }
    }
  }

  // 2. Calculate Capacity (Considering levels)
  for (const teacher of teachers) {
    const subs = teacher.subjects || [];
    const minL = teacher.min_class_level || 0;
    const maxL = teacher.max_class_level || 10;
    
    // This is tricky because one teacher can teach multiple subjects.
    // We'll report "Potential Support"
    subs.forEach(s => {
        if (!capacity[s]) capacity[s] = { total_workload: 0, teachers: [] };
        capacity[s].teachers.push(teacher.name);
        capacity[s].total_workload += (teacher.allotted_periods || 0);
    });
  }

  console.log("--- SUBJECT AUDIT ---");
  for (const sname in demand) {
    const d = demand[sname];
    const cap = capacity[sname] || { total_workload: 0, teachers: [] };
    const diff = cap.total_workload - d;
    console.log(`${sname.padEnd(12)} | Need: ${d.toString().padEnd(3)} | Specialist Max Cap: ${cap.total_workload.toString().padEnd(3)} | Diff: ${diff}`);
    if (diff < 0) {
        console.log(`   !!! INSUFFICIENT SPECIALISTS for ${sname} !!!`);
    }
  }
}

audit();
