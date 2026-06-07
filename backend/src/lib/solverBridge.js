const { spawn } = require('child_process');
const path = require('path');
const getPythonCommand = require('../config/python');

const PERIODS_PER_CLASS = 48;

/** User typed a target (>0) ⇒ fixed; blank/0 ⇒ auto (solver decides). */
function fixedTargetFromDb(allottedPeriods) {
  const n = Number(allottedPeriods);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isFixedTarget(allottedPeriods) {
  return fixedTargetFromDb(allottedPeriods) != null;
}

function beforeTargetFromDb(allottedPeriods) {
  return fixedTargetFromDb(allottedPeriods);
}

function subjectColumnForClass(className) {
  return `periods_${String(className).toLowerCase()}`;
}

function buildCurriculum(subjects, classes) {
  const curriculum = {};
  for (const s of subjects) {
    curriculum[s.name] = {};
    for (const cls of classes) {
      const col = subjectColumnForClass(cls.name);
      if (!(col in s)) continue;
      const p = s[col];
      if (p != null && Number(p) > 0) curriculum[s.name][cls.name] = Number(p);
    }
  }
  return curriculum;
}

function mapAllocationsToDb(rawAllocations, teachers, classes) {
  const nameToTeacherId = Object.fromEntries(teachers.map((t) => [t.name, t.id]));
  const nameToClassId = Object.fromEntries(classes.map((c) => [c.name, c.id]));
  return (rawAllocations || []).map((a) => ({
    teacher_id: nameToTeacherId[a.teacher],
    class_id: nameToClassId[a.class],
    subject: a.subject,
    periods_weekly: a.periods,
  }));
}

function mapDbAllocationsToSolver(dbRows, teachers, classes) {
  const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  return (dbRows || [])
    .filter((r) => Number(r.periods_weekly) > 0)
    .map((r) => ({
      teacher: r.teacher_name || teacherById[r.teacher_id]?.name,
      class: r.class_name || classById[r.class_id]?.name,
      subject: r.subject,
      periods: Number(r.periods_weekly),
    }))
    .filter((a) => a.teacher && a.class);
}

function buildSolverPayload({ teachers, classes, subjects, mode = 'full', allocations = null }) {
  const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
  const payload = {
    mode,
    teachers: teachers.map((t) => ({
      name: t.name,
      subjects: t.subjects || [],
      min_class_level: t.min_class_level ?? 1,
      max_class_level: t.max_class_level ?? 10,
      min_period_start: t.min_period_start ?? 1,
      fixed_target: fixedTargetFromDb(t.allotted_periods),
    })),
    classes: classes.map((c) => ({
      name: c.name,
      class_level: c.class_level,
      class_teacher: c.class_teacher_id ? teacherById[c.class_teacher_id]?.name ?? null : null,
    })),
    curriculum: buildCurriculum(subjects, classes),
    time_limit: Number(process.env.SOLVER_TIME_LIMIT || 60),
    workers: Number(process.env.SOLVER_WORKERS || 8),
  };
  if (mode === 'schedule' && allocations?.length) {
    payload.allocations = allocations;
  }
  return payload;
}

function buildTargetChanges(teachers, targets, payloadTeachers) {
  const fixedByName = Object.fromEntries(
    payloadTeachers.map((t) => [t.name, t.fixed_target != null]),
  );
  const changes = teachers.map((t) => {
    const before = beforeTargetFromDb(t.allotted_periods);
    const after = targets?.[t.name] ?? 0;
    return {
      teacher: t.name,
      fixed: fixedByName[t.name] ?? false,
      before,
      after,
      delta: before == null ? null : after - before,
    };
  });
  changes.sort(
    (a, b) => (Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)) || a.teacher.localeCompare(b.teacher),
  );
  return changes;
}

function runSolver(payload) {
  const pyCmd = getPythonCommand();
  const script = path.join(__dirname, '..', '..', 'scripts', 'solver.py');
  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', (e) => reject(new Error(`Failed to start Python (${pyCmd}): ${e.message}`)));
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(err.trim() || `solver.py exited with code ${code}`));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`Invalid solver JSON: ${out.slice(0, 500)}`));
      }
    });
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

function buildClassSummaryFromAllocations(allocations, classes) {
  const summary = {};
  for (const cls of classes) {
    const rows = (allocations || []).filter((a) => a.class_id === cls.id);
    summary[cls.id] = {
      periods_filled: rows.reduce((n, a) => n + a.periods_weekly, 0),
      ct_periods: cls.class_teacher_id
        ? rows.filter((a) => a.teacher_id === cls.class_teacher_id).reduce((n, a) => n + a.periods_weekly, 0)
        : 0,
    };
  }
  return summary;
}

function transformAllocateResult(raw, { teachers, classes }) {
  const totalExpected = classes.length * PERIODS_PER_CLASS;

  if (!raw.ok) {
    return {
      success: false,
      totalAssigned: raw.filled || 0,
      totalExpected: raw.total || totalExpected,
      solver_status_name: (raw.phase || 'FAILED').toUpperCase(),
      message: raw.message || (raw.errors || []).join('\n'),
      errors: (raw.errors || []).map((msg) => ({ type: 'solver_error', message: msg })),
      phase: raw.phase,
      targets: raw.targets || null,
    };
  }

  const allocations = mapAllocationsToDb(raw.allocations, teachers, classes);
  const totalAssigned = allocations.reduce((n, a) => n + a.periods_weekly, 0);
  const class_summary = buildClassSummaryFromAllocations(allocations, classes);

  return {
    success: true,
    allocations,
    targets: raw.targets,
    totalAssigned,
    totalExpected: raw.total || totalExpected,
    filled: totalAssigned,
    total: raw.total || totalExpected,
    class_summary,
    message: raw.message || `Allocation complete: ${totalAssigned}/${totalExpected}.`,
    errors: [],
  };
}

async function persistAllocationsAndTargets(supabase, { allocations, targets }, { nameToTeacherId, wasFixedByName }) {
  if (!allocations?.length) return;

  await supabase.from('subject_allocations')
    .delete().neq('teacher_id', '00000000-0000-0000-0000-000000000000');

  for (let i = 0; i < allocations.length; i += 100) {
    const batch = allocations.slice(i, i + 100);
    const { error } = await supabase.from('subject_allocations').insert(batch);
    if (error) throw new Error(`Failed to save allocations: ${error.message}`);
  }

  if (targets && typeof targets === 'object') {
    for (const [name, target] of Object.entries(targets)) {
      const tid = nameToTeacherId[name];
      if (!tid) continue;
      const fixed = wasFixedByName[name] === true;
      const row = {
        allocated_periods: target,
        allotted_periods: fixed ? target : 0,
      };
      const { error } = await supabase.from('teachers').update(row).eq('id', tid);
      if (error) throw new Error(`Failed to update teacher target: ${error.message}`);
    }
  }
}

function transformSolverResult(raw, { teachers, classes }) {
  const nameToTeacherId = Object.fromEntries(teachers.map((t) => [t.name, t.id]));
  const nameToClassId = Object.fromEntries(classes.map((c) => [c.name, c.id]));
  const totalSlots = classes.length * PERIODS_PER_CLASS;

  if (!raw.ok) {
    return {
      success: false,
      filled: raw.filled || 0,
      total: raw.total || totalSlots,
      solver_status_name: (raw.phase || 'FAILED').toUpperCase(),
      message: raw.message || (raw.errors || []).join('\n'),
      errors: (raw.errors || []).map((msg) => ({ type: 'solver_error', message: msg })),
      phase: raw.phase,
      targets: raw.targets || null,
      phases: raw.phase === 'done' ? ['cp_sat_schedule'] : ['cp_sat_two_phase'],
    };
  }

  const grid = {};
  const teacherSummary = {};
  const classSummary = {};

  for (const cls of classes) {
    const days = raw.grid[cls.name] || [];
    grid[cls.id] = [];
    let classFilled = 0;
    for (let d = 0; d < days.length; d++) {
      const row = [];
      for (let p = 0; p < (days[d]?.length || 0); p++) {
        const slot = days[d][p];
        if (!slot) {
          row.push([]);
          continue;
        }
        const tid = nameToTeacherId[slot.teacher];
        const subject = slot.subject;
        row.push([{ teacher_id: tid, subject_id: subject }]);
        classFilled++;
        if (!teacherSummary[tid]) {
          teacherSummary[tid] = { allocated: 0, subjects: {}, classes: new Set() };
        }
        teacherSummary[tid].allocated++;
        teacherSummary[tid].subjects[subject] = (teacherSummary[tid].subjects[subject] || 0) + 1;
        teacherSummary[tid].classes.add(cls.id);
      }
      grid[cls.id].push(row);
    }
    classSummary[cls.id] = { periods_filled: classFilled, subjects: {} };
  }

  const serializedTeacherSummary = {};
  for (const [tid, data] of Object.entries(teacherSummary)) {
    serializedTeacherSummary[tid] = {
      allocated: data.allocated,
      subjects: data.subjects,
      classes: Array.from(data.classes).sort(),
    };
  }

  const allocations = mapAllocationsToDb(raw.allocations, teachers, classes);
  const class_summary = buildClassSummaryFromAllocations(allocations, classes);
  // Merge grid-fill counts for full mode
  for (const cls of classes) {
    if (classSummary[cls.id]) {
      class_summary[cls.id] = {
        ...class_summary[cls.id],
        periods_filled: classSummary[cls.id].periods_filled,
      };
    }
  }

  return {
    success: true,
    filled: raw.filled,
    total: raw.total || totalSlots,
    solver_status_name: 'OPTIMAL',
    message: raw.message,
    grid,
    teacher_summary: serializedTeacherSummary,
    class_summary,
    allocations,
    targets: raw.targets,
    phases: ['cp_sat_schedule'],
    preflight_issues: { fatal: [], warn: [] },
    errors: [],
    warnings: [],
  };
}

module.exports = {
  PERIODS_PER_CLASS,
  fixedTargetFromDb,
  isFixedTarget,
  buildSolverPayload,
  buildTargetChanges,
  buildClassSummaryFromAllocations,
  mapDbAllocationsToSolver,
  mapAllocationsToDb,
  runSolver,
  transformAllocateResult,
  transformSolverResult,
  persistAllocationsAndTargets,
};
