const CLASS_COL_MAP = {
  '1A': 'periods_1a', '1B': 'periods_1b',
  '2A': 'periods_2a', '2B': 'periods_2b',
  '3A': 'periods_3a', '3B': 'periods_3b',
  '4A': 'periods_4a', '4B': 'periods_4b',
  '5': 'periods_5', '6A': 'periods_6a', '6B': 'periods_6b',
  '7': 'periods_7', '8': 'periods_8',
  '9': 'periods_9', '10': 'periods_10',
};

function buildRequiredFromSubjects(subjects, classes) {
  const required = {};
  const classByName = {};
  (classes || []).forEach((c) => { classByName[c.name] = c; });
  (subjects || []).forEach((s) => {
    for (const [cname, col] of Object.entries(CLASS_COL_MAP)) {
      const v = s[col];
      if (v == null || v <= 0) continue;
      const c = classByName[cname];
      if (!c) continue;
      required[`${c.id}|${s.name}`] = { class_id: c.id, class_name: c.name, subject: s.name, required: v };
    }
  });
  return required;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN_CT_PERIODS_IN_CLASS = 6;

function buildAllocationIssues({ subjects, classes, teachers, allocations, lastRun, timetable }) {
  const issues = [];
  const classById = {};
  (classes || []).forEach((c) => { classById[c.id] = c; });
  const teacherById = {};
  (teachers || []).forEach((t) => { teacherById[t.id] = t; });

  const allocByClass = {};
  const allocByTeacher = {};
  const allocByClassSubject = {};
  (allocations || []).forEach((a) => {
    allocByClass[a.class_id] = (allocByClass[a.class_id] || 0) + a.periods_weekly;
    allocByTeacher[a.teacher_id] = (allocByTeacher[a.teacher_id] || 0) + a.periods_weekly;
    const key = `${a.class_id}|${a.subject}`;
    allocByClassSubject[key] = (allocByClassSubject[key] || 0) + a.periods_weekly;
  });

  const required = buildRequiredFromSubjects(subjects, classes);
  for (const { class_id, class_name, subject, required: need } of Object.values(required)) {
    const key = `${class_id}|${subject}`;
    const have = allocByClassSubject[key] || 0;
    if (have < need) {
      issues.push({
        severity: 'error',
        type: 'curriculum_unallocated',
        class_name,
        subject,
        message: `Class ${class_name} · ${subject}: curriculum needs ${need}p/week but only ${have}p allocated (${need - have} short).`,
        actions: [{ page: 'Allocations', label: `Allocate ${need - have} more ${subject} for ${class_name}`, link: `/allocations?class=${class_id}` }],
      });
    } else if (have > need) {
      issues.push({
        severity: 'error',
        type: 'curriculum_over_allocated',
        class_name,
        subject,
        message: `Class ${class_name} · ${subject}: ${have}p allocated but curriculum requires only ${need}p (${have - need} excess).`,
        actions: [{ page: 'Allocations', label: `Fix ${subject} for ${class_name}`, link: `/allocations?class=${class_id}` }],
      });
    }
  }

  (classes || []).forEach((c) => {
    const total = allocByClass[c.id] || 0;
    if (total < 48) {
      issues.push({
        severity: 'error', type: 'class_short', class_name: c.name,
        message: `Class ${c.name} has only ${total}/48 periods allocated. Add ${48 - total} more.`,
        actions: [{ page: 'Allocations', label: `Add ${48 - total} period(s) to Class ${c.name}`, link: `/allocations?class=${c.id}` }],
      });
    } else if (total > 48) {
      issues.push({
        severity: 'error', type: 'class_excess', class_name: c.name,
        message: `Class ${c.name} has ${total} periods (exceeds 48 by ${total - 48}).`,
        actions: [{ page: 'Allocations', label: `Remove ${total - 48} period(s) from Class ${c.name}`, link: `/allocations?class=${c.id}` }],
      });
    }
    if (!c.class_teacher_id) {
      issues.push({
        severity: 'warning', type: 'no_class_teacher', class_name: c.name,
        message: `Class ${c.name} has no class teacher (R1 will be skipped).`,
        actions: [{ page: 'Teachers', label: `Assign a class teacher for Class ${c.name}`, link: '/teachers' }],
      });
    } else {
      const ctAlloc = (allocations || [])
        .filter((a) => a.class_id === c.id && a.teacher_id === c.class_teacher_id)
        .reduce((n, a) => n + a.periods_weekly, 0);
      const ctName = teacherById[c.class_teacher_id]?.name || 'Class teacher';
      if (ctAlloc > 0 && ctAlloc < MIN_CT_PERIODS_IN_CLASS) {
        issues.push({
          severity: 'warning',
          type: 'ct_periods_low',
          class_name: c.name,
          message: `Class ${c.name}: class teacher ${ctName} has only ${ctAlloc}p in this class (needs ≥${MIN_CT_PERIODS_IN_CLASS} for R1 every day). One weekday P1 may be another teacher.`,
          actions: [
            { page: 'Allocations', label: `Add period(s) for ${ctName} in Class ${c.name}`, link: `/allocations?class=${c.id}` },
            { page: 'Curriculum', label: 'Or increase subject periods in curriculum', link: '/curriculum' },
            { page: 'Teachers', label: 'Or change class teacher', link: '/teachers' },
          ],
        });
      }
    }
  });

  if (timetable?.length) {
    (classes || []).forEach((c) => {
      if (!c.class_teacher_id) return;
      const ctName = teacherById[c.class_teacher_id]?.name || 'Class teacher';
      DAY_NAMES.forEach((day, di) => {
        const p1 = timetable.find((s) => s.class_id === c.id && s.day === di + 1 && s.period === 1);
        if (!p1 || p1.teacher_id === c.class_teacher_id) return;
        const actualName = teacherById[p1.teacher_id]?.name || 'Unknown';
        issues.push({
          severity: 'warning',
          type: 'p1_not_class_teacher',
          class_name: c.name,
          message: `Class ${c.name} ${day}: P1 has ${actualName} but class teacher is ${ctName}.`,
          actions: [
            { page: 'Allocations', label: 'Fix CT periods (≥6 in class)', link: `/allocations?class=${c.id}` },
            { page: 'Allotment', label: 'Re-run with R1 enabled', link: '/allotment' },
          ],
        });
      });
    });
  }

  const diaryByTeacher = {};
  (allocations || []).forEach((a) => {
    if (a.subject !== 'Diary') return;
    if (!diaryByTeacher[a.teacher_id]) diaryByTeacher[a.teacher_id] = { total: 0, classIds: new Set() };
    diaryByTeacher[a.teacher_id].total += a.periods_weekly;
    diaryByTeacher[a.teacher_id].classIds.add(a.class_id);
  });
  Object.entries(diaryByTeacher).forEach(([tid, info]) => {
    const t = teacherById[tid];
    if (!t) return;
    const classNames = [...info.classIds].map((id) => classById[id]?.name || id).join(', ');
    if (info.total > 6) {
      issues.push({
        severity: 'error',
        type: 'diary_teacher_overload',
        teacher_name: t.name,
        message: `${t.name} has ${info.total} Diary periods (max 6 — one period 8 slot per day).`,
        actions: [
          { page: 'Allocations', label: `Reduce Diary for ${t.name}`, link: `/allocations?teacher=${tid}` },
        ],
      });
    } else if (info.classIds.size > 1) {
      issues.push({
        severity: 'error',
        type: 'diary_teacher_multi_class',
        teacher_name: t.name,
        message: `${t.name} teaches Diary in multiple classes (${classNames}). Cannot be at P8 in two classes the same day — assign 2B Diary to Sujata (class teacher).`,
        actions: [
          { page: 'Allocations', label: `Fix Diary for Class 2B`, link: '/allocations' },
        ],
      });
    }
  });

  const teacherIssuesById = {};
  (teachers || []).forEach((t) => {
    const rowIssues = [];
    const actual = allocByTeacher[t.id] || 0;
    const minP = t.min_period_start || 1;
    const capacity = (8 - (minP - 1)) * 6;

    if (actual > capacity) {
      const msg = `Over capacity: ${actual}p allocated, max ${capacity}p (P${minP}–8 × 6 days).`;
      rowIssues.push(msg);
      issues.push({
        severity: 'error', type: 'teacher_capacity_exceeded', teacher_name: t.name, teacher_id: t.id,
        message: `${t.name} has ${actual} periods but capacity is ${capacity}.`,
        actions: [
          { page: 'Teachers', label: `Lower ${t.name}'s period restriction`, link: '/teachers' },
          { page: 'Allocations', label: `Reduce by ${actual - capacity}`, link: `/allocations?teacher=${t.id}` },
        ],
      });
    }

    const target = t.allotted_periods || 0;
    if (target > 0 && actual !== target) {
      const diff = target - actual;
      const msg = diff > 0
        ? `Under target: ${actual}p allocated vs ${target}p target (${diff} short).`
        : `Over target: ${actual}p allocated vs ${target}p target (${-diff} excess).`;
      rowIssues.push(msg);
      issues.push({
        severity: diff > 0 ? 'error' : 'warning',
        type: 'workload_mismatch',
        teacher_name: t.name,
        teacher_id: t.id,
        message: `${t.name}: target ${target}p, allocated ${actual}p.`,
        actions: [
          { page: 'Teachers', label: `Set target to ${actual}`, link: '/teachers' },
          { page: 'Allocations', label: `Adjust allocations to ${target}`, link: `/allocations?teacher=${t.id}` },
        ],
      });
    }

    const timetable = t.allocated_periods || 0;
    if (timetable > 0 && timetable !== actual) {
      rowIssues.push(`Timetable mismatch: ${timetable}p in timetable vs ${actual}p in allocations.`);
      issues.push({
        severity: 'warning',
        type: 'timetable_allocation_mismatch',
        teacher_name: t.name,
        teacher_id: t.id,
        message: `${t.name}: timetable has ${timetable}p but allocations sum to ${actual}p.`,
        actions: [{ page: 'Allotment', label: 'Re-run allocator', link: '/allotment' }],
      });
    }

    teacherIssuesById[t.id] = rowIssues;
  });

  if (lastRun && !lastRun.success) {
    issues.push({
      severity: 'error',
      type: 'timetable_solver_failed',
      message: lastRun.message || lastRun.error || `Timetable solver failed (${lastRun.solver_status_name || 'unknown'}).`,
      actions: [{ page: 'Allotment', label: 'Open Allotment', link: '/allotment' }],
    });
    (lastRun.preflight_issues?.fatal || []).forEach((f) => {
      issues.push({
        severity: 'error',
        type: 'timetable_preflight_fatal',
        message: f.reason || f.message || String(f),
        actions: (f.actions || []).map((a) => ({
          page: a.page,
          label: a.action || a.label,
          link: a.link || (a.page === 'Teachers' ? '/teachers' : a.page === 'Allocations' ? '/allocations' : '/allotment'),
        })),
      });
    });
  } else if (lastRun?.success && lastRun.filled != null && lastRun.total != null && lastRun.filled < lastRun.total) {
    const missing = lastRun.total - lastRun.filled;
    issues.push({
      severity: 'error',
      type: 'timetable_partial',
      message: `Timetable solver placed only ${lastRun.filled}/${lastRun.total} slots (${missing} could not be scheduled).`,
      actions: [{ page: 'Allotment', label: 'Review rules & re-run', link: '/allotment' }],
    });
    if (lastRun.class_summary && classes) {
      for (const c of classes) {
        const sum = lastRun.class_summary[c.id];
        if (!sum) continue;
        const short = 48 - (sum.periods_filled || 0);
        if (short > 0) {
          issues.push({
            severity: 'error',
            type: 'class_timetable_short',
            class_name: c.name,
            message: `Class ${c.name}: only ${sum.periods_filled}/48 periods placed in last CP run.`,
            actions: [{ page: 'Timetable', label: `View Class ${c.name}`, link: `/timetable?class=${c.id}` }],
          });
        }
      }
    }
  }

  if (lastRun?.preflight_issues?.warn?.length) {
    lastRun.preflight_issues.warn.forEach((w) => {
      issues.push({
        severity: 'warning',
        type: 'timetable_preflight_warn',
        message: w.reason || w.message || String(w),
      });
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    ok: errors.length === 0,
    error_count: errors.length,
    warning_count: issues.filter((i) => i.severity === 'warning').length,
    info_count: issues.filter((i) => i.severity === 'info').length,
    issues,
    teacherIssuesById,
  };
}

module.exports = { buildAllocationIssues, CLASS_COL_MAP };
