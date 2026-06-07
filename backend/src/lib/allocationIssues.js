const PERIODS_PER_CLASS = 48;

function subjectColumnForClass(className) {
  return `periods_${String(className).toLowerCase()}`;
}

function eligibleTeachers(teachers, classLevel, subjectName) {
  return (teachers || []).filter((t) => {
    const subs = t.subjects || [];
    const minL = t.min_class_level ?? 1;
    const maxL = t.max_class_level ?? 10;
    return subs.includes(subjectName) && minL <= classLevel && maxL >= classLevel;
  });
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((i) => {
    const key = `${i.type}|${i.class_name || ''}|${i.subject || ''}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortIssues(issues) {
  const rank = { error: 0, warning: 1, info: 2 };
  return [...issues].sort(
    (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
      || (a.class_name || '').localeCompare(b.class_name || '')
      || (a.message || '').localeCompare(b.message || ''),
  );
}

/** Curriculum + coverage pre-checks only (no allocation/timetable re-derivation). */
function buildPrecheckIssues({ subjects, classes, teachers }) {
  const issues = [];

  for (const cls of classes || []) {
    const col = subjectColumnForClass(cls.name);
    let curriculumTotal = 0;
    const classSubjects = [];

    for (const s of subjects || []) {
      const p = s[col];
      if (p == null || Number(p) <= 0) continue;
      const periods = Number(p);
      curriculumTotal += periods;
      classSubjects.push({ subject: s.name, periods });

      if (eligibleTeachers(teachers, cls.class_level, s.name).length === 0) {
        issues.push({
          severity: 'error',
          type: 'no_subject_teacher',
          class_name: cls.name,
          subject: s.name,
          message: `No teacher can teach ${s.name} to class ${cls.name} (level ${cls.class_level}).`,
          actions: [
            { page: 'Teachers', label: 'Add subject to a teacher', link: '/teachers' },
            { page: 'Curriculum', label: 'Review curriculum', link: '/curriculum' },
          ],
        });
      }
    }

    if (curriculumTotal !== PERIODS_PER_CLASS) {
      issues.push({
        severity: 'error',
        type: 'curriculum_not_48',
        class_name: cls.name,
        message: `Class ${cls.name} curriculum sums to ${curriculumTotal} (must be ${PERIODS_PER_CLASS}).`,
        actions: [{ page: 'Curriculum', label: `Fix Class ${cls.name}`, link: '/curriculum' }],
      });
    }

    if (!cls.class_teacher_id) {
      issues.push({
        severity: 'warning',
        type: 'no_class_teacher',
        class_name: cls.name,
        message: `Class ${cls.name} has no class teacher assigned (R1 will be skipped).`,
        actions: [{ page: 'Teachers', label: 'Assign class teacher', link: '/teachers' }],
      });
    }
  }

  return issues;
}

/** Saved allocation rows must match curriculum before Allotment (Phase B). */
function buildAllocationPlanIssues({ subjects, classes, teachers, allocations }) {
  const issues = [];
  const teacherById = Object.fromEntries((teachers || []).map((t) => [t.id, t]));
  const classById = Object.fromEntries((classes || []).map((c) => [c.id, c]));

  if (!allocations?.length) {
    issues.push({
      severity: 'error',
      type: 'no_saved_allocations',
      message: 'No saved allocations. Auto-generate or enter rows on the Allocations page first.',
      actions: [{ page: 'Allocations', label: 'Open Allocations', link: '/allocations' }],
    });
    return issues;
  }

  const expected = {};
  for (const cls of classes || []) {
    const col = subjectColumnForClass(cls.name);
    expected[cls.name] = { total: 0, subjects: {} };
    for (const s of subjects || []) {
      const p = s[col];
      if (p != null && Number(p) > 0) {
        expected[cls.name].subjects[s.name] = Number(p);
        expected[cls.name].total += Number(p);
      }
    }
  }

  const actual = {};
  for (const row of allocations) {
    const cls = classById[row.class_id];
    const tch = teacherById[row.teacher_id];
    if (!cls || !tch) continue;
    const cname = cls.name;
    const periods = Number(row.periods_weekly);
    if (!actual[cname]) actual[cname] = { total: 0, subjects: {} };
    actual[cname].subjects[row.subject] = (actual[cname].subjects[row.subject] || 0) + periods;
    actual[cname].total += periods;

    if (!eligibleTeachers(teachers, cls.class_level, row.subject).some((t) => t.id === row.teacher_id)) {
      issues.push({
        severity: 'error',
        type: 'allocation_ineligible',
        class_name: cname,
        subject: row.subject,
        message: `${tch.name} cannot teach ${row.subject} to class ${cname} (level ${cls.class_level}).`,
        actions: [{ page: 'Allocations', label: 'Fix allocation row', link: '/allocations' }],
      });
    }
  }

  for (const cls of classes || []) {
    const cname = cls.name;
    const got = actual[cname]?.total || 0;
    if (got !== PERIODS_PER_CLASS) {
      issues.push({
        severity: 'error',
        type: 'allocation_not_48',
        class_name: cname,
        message: `Class ${cname} allocations sum to ${got} (must be ${PERIODS_PER_CLASS}).`,
        actions: [{ page: 'Allocations', label: `Fix Class ${cname}`, link: '/allocations' }],
      });
    }
    for (const [sub, need] of Object.entries(expected[cname]?.subjects || {})) {
      const have = actual[cname]?.subjects[sub] || 0;
      if (have !== need) {
        issues.push({
          severity: 'error',
          type: 'allocation_subject_mismatch',
          class_name: cname,
          subject: sub,
          message: `Class ${cname} ${sub}: allocated ${have}, curriculum requires ${need}.`,
          actions: [{ page: 'Allocations', label: 'Fix allocations', link: '/allocations' }],
        });
      }
    }
  }

  return issues;
}

function buildSolverIssues(lastRun) {
  if (!lastRun || lastRun.success) return [];
  const issues = [];

  (lastRun.errors || []).forEach((e) => {
    const message = typeof e === 'string' ? e : (e.message || String(e));
    if (!message) return;
    issues.push({
      severity: 'error',
      type: 'solver_error',
      message,
      actions: [{ page: 'Allotment', label: 'Open Allotment', link: '/allotment' }],
    });
  });

  if (lastRun.message && !(lastRun.errors || []).some((e) => (e.message || e) === lastRun.message)) {
    issues.push({
      severity: 'error',
      type: 'solver_error',
      message: lastRun.message,
      actions: [{ page: 'Allotment', label: 'Open Allotment', link: '/allotment' }],
    });
  }

  return issues;
}

function buildAllocationIssues({ subjects, classes, teachers, lastRun, planIssues = [] }) {
  const issues = sortIssues(dedupeIssues([
    ...buildPrecheckIssues({ subjects, classes, teachers }),
    ...planIssues,
    ...buildSolverIssues(lastRun),
  ]));

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    ok: errors.length === 0,
    error_count: errors.length,
    warning_count: issues.filter((i) => i.severity === 'warning').length,
    info_count: 0,
    issues,
  };
}

module.exports = {
  PERIODS_PER_CLASS,
  buildPrecheckIssues,
  buildAllocationPlanIssues,
  buildAllocationIssues,
  subjectColumnForClass,
};
