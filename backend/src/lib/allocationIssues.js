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

function buildAllocationIssues({ subjects, classes, teachers, lastRun }) {
  const issues = sortIssues(dedupeIssues([
    ...buildPrecheckIssues({ subjects, classes, teachers }),
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
  buildAllocationIssues,
  subjectColumnForClass,
};
