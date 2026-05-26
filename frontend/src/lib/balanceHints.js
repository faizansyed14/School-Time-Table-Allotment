/** Maps class display name → curriculum subject column field */
export const CLASS_PERIOD_FIELD = {
  '1A': 'periods_1a', '1B': 'periods_1b', '2A': 'periods_2a', '2B': 'periods_2b',
  '3A': 'periods_3a', '3B': 'periods_3b', '4A': 'periods_4a', '4B': 'periods_4b',
  '5': 'periods_5', '6A': 'periods_6a', '6B': 'periods_6b',
  '7': 'periods_7', '8': 'periods_8', '9': 'periods_9', '10': 'periods_10',
};

export const CLASS_NAMES = Object.keys(CLASS_PERIOD_FIELD);

export function sumTeacherAlloc(teacherId, allocs) {
  return (allocs || [])
    .filter((a) => a.teacher_id === teacherId)
    .reduce((n, a) => n + (a.periods_weekly || 0), 0);
}

export function sumClassAlloc(classId, allocs) {
  return (allocs || [])
    .filter((a) => a.class_id === classId)
    .reduce((n, a) => n + (a.periods_weekly || 0), 0);
}

export function sumSubjectInClass(classId, subject, allocs) {
  return (allocs || [])
    .filter((a) => a.class_id === classId && a.subject === subject)
    .reduce((n, a) => n + (a.periods_weekly || 0), 0);
}

/** Apply a single allocation add/edit/delete to a copy of the list */
export function applyAllocationChange(allocs, change) {
  const { type, teacher_id, class_id, subject, oldPeriods, newPeriods } = change;
  if (type === 'delete') {
    return allocs.filter(
      (a) => !(a.teacher_id === teacher_id && a.class_id === class_id && a.subject === subject),
    );
  }
  if (type === 'add') {
    return [...allocs, { teacher_id, class_id, subject, periods_weekly: newPeriods }];
  }
  return allocs.map((a) =>
    (a.teacher_id === teacher_id && a.class_id === class_id && a.subject === subject)
      ? { ...a, periods_weekly: newPeriods }
      : a,
  );
}

export function buildRemindersAfterAllocationChange({ change, teachers, classes, allocs }) {
  const next = applyAllocationChange(allocs, change);
  const cls = classes.find((c) => c.id === change.class_id);
  const tch = teachers.find((t) => t.id === change.teacher_id);
  const className = cls?.name || 'class';
  const teacherName = tch?.name || 'teacher';
  const oldP = change.oldPeriods ?? 0;
  const newP = change.newPeriods ?? 0;
  const items = [];

  if (change.type === 'delete') {
    items.push({
      page: 'Curriculum',
      link: '/curriculum',
      text: `Curriculum → Subjects → **${change.subject}** → Class **${className}**: reduce by **${oldP}**p (column should match total allocated for that subject).`,
    });
  } else {
    items.push({
      page: 'Curriculum',
      link: '/curriculum',
      text: `Curriculum → Subjects → **${change.subject}** → Class **${className}**: set column to **${newP}**p/week${oldP ? ` (was ${oldP} in this row; whole subject in class must equal ${newP} if only one teacher)` : ''}.`,
    });
    const subjectTotal = sumSubjectInClass(change.class_id, change.subject, next);
    const allocRows = next.filter((a) => a.class_id === change.class_id && a.subject === change.subject);
    if (allocRows.length > 1) {
      items.push({
        page: 'Allocations',
        link: `/allocations?class=${change.class_id}`,
        text: `**${change.subject}** in **${className}** has **${allocRows.length}** teachers — curriculum column must equal **${subjectTotal}**p total (sum of all rows).`,
      });
    }
  }

  const teacherTotal = sumTeacherAlloc(change.teacher_id, next);
  const target = tch?.allotted_periods ?? 0;
  items.push({
    page: 'Teachers',
    link: '/teachers',
    text: `Teachers → **${teacherName}** → Allotted periods: set to **${teacherTotal}**p${target !== teacherTotal ? ` (target is ${target}p now)` : ''}.`,
  });

  const classTotal = sumClassAlloc(change.class_id, next);
  if (classTotal !== 48) {
    items.push({
      page: 'Allocations',
      link: `/allocations?class=${change.class_id}`,
      text: `Class **${className}** must stay **48/48**p — now **${classTotal}**p (${classTotal < 48 ? `add ${48 - classTotal}` : `remove ${classTotal - 48}`}).`,
    });
  }

  if (cls?.class_teacher_id === change.teacher_id && change.type !== 'delete') {
    const ctInClass = next
      .filter((a) => a.class_id === change.class_id && a.teacher_id === change.teacher_id)
      .reduce((n, a) => n + a.periods_weekly, 0);
    if (ctInClass > 0 && ctInClass < 6) {
      items.push({
        page: 'Allocations',
        link: `/allocations?class=${change.class_id}`,
        text: `**${teacherName}** is class teacher of **${className}** with **${ctInClass}**p (need **≥6** for period 1 every day). Add **${6 - ctInClass}** more in this class.`,
      });
    }
  }

  items.push({
    page: 'Allotment',
    link: '/allotment',
    text: 'When Curriculum + Teachers + Allocations all match → **Allotment** → Run Allocator → **Apply to Timetable**.',
  });

  return {
    source: 'allocations',
    title: 'Allocation changed — balance these too',
    items,
  };
}

export function buildRemindersAfterCurriculumChange({ subjectName, oldForm, newForm, classes, allocs, teachers }) {
  const items = [];
  CLASS_NAMES.forEach((className) => {
    const field = CLASS_PERIOD_FIELD[className];
    const oldV = Number(oldForm?.[field]) || 0;
    const newV = Number(newForm?.[field]) || 0;
    if (oldV === newV) return;
    const cls = classes.find((c) => c.name === className);
    if (!cls) return;
    const allocated = sumSubjectInClass(cls.id, subjectName, allocs);
    const delta = newV - oldV;
    items.push({
      page: 'Allocations',
      link: `/allocations?class=${cls.id}`,
      text: `Allocations → Class **${className}** → **${subjectName}**: ${delta > 0 ? `add ${delta}` : `remove ${-delta}`} period(s) across teacher row(s) so subject total = **${newV}**p (allocated **${allocated}**p now).`,
    });
    const rows = (allocs || []).filter((a) => a.class_id === cls.id && a.subject === subjectName);
    rows.forEach((row) => {
      const t = teachers.find((x) => x.id === row.teacher_id);
      if (!t) return;
      const newTeacherTotal = sumTeacherAlloc(row.teacher_id, allocs) - row.periods_weekly + (rows.length === 1 ? newV : row.periods_weekly);
      if (rows.length === 1) {
        items.push({
          page: 'Teachers',
          link: '/teachers',
          text: `Teachers → **${t.name}**: allotted target → **${sumTeacherAlloc(row.teacher_id, allocs) - row.periods_weekly + newV}**p after you set their **${subjectName}** row to **${newV}**p.`,
        });
      }
    });
  });

  if (!items.length) return null;

  items.push({
    page: 'Allotment',
    link: '/allotment',
    text: 'Then **Allotment** → re-run solver → Apply (timetable only updates after apply).',
  });

  return {
    source: 'curriculum',
    title: 'Curriculum changed — balance allocations & teachers',
    items,
  };
}

export function buildRemindersAfterTeacherTargetChange({ teacher, oldTarget, newTarget, allocs }) {
  const allocated = sumTeacherAlloc(teacher.id, allocs);
  if (Number(newTarget) === allocated) return null;
  return {
    source: 'teachers',
    title: 'Teacher workload target changed',
    items: [
      {
        page: 'Allocations',
        link: `/allocations?teacher=${teacher.id}`,
        text: `Allocations → **${teacher.name}**: rows should sum to **${newTarget}**p (currently **${allocated}**p). ${newTarget > allocated ? `Add ${newTarget - allocated}` : `Remove ${allocated - newTarget}`} period(s).`,
      },
      {
        page: 'Curriculum',
        link: '/curriculum',
        text: 'If you cannot fix by moving periods between classes, adjust **Curriculum** period counts for subjects they teach.',
      },
      {
        page: 'Allotment',
        link: '/allotment',
        text: 'Then re-run **Allotment** and Apply.',
      },
    ],
  };
}

export function buildRemindersAfterTeacherAllocFieldsChange({ teacher, oldForm, newForm, allocs, classes }) {
  const oldP = Number(oldForm?.allotted_periods) || 0;
  const newP = Number(newForm?.allotted_periods) || 0;
  if (oldP === newP) return null;
  return buildRemindersAfterTeacherTargetChange({
    teacher,
    oldTarget: oldP,
    newTarget: newP,
    allocs,
  });
}
