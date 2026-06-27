/**
 * Class-teacher period helpers.
 *
 * Rule R1 wants the class teacher to teach ~6 periods in their own class (one per
 * day). But a teacher can only teach the subjects they're assigned, and only those
 * that exist in that class's curriculum. If those subjects total < 6 periods, six
 * is simply unattainable (e.g. Shahina teaches only Computer 3 + Drawing 2 = 5 in
 * Class 8). In that case the *attainable* maximum — not 6 — is the correct target,
 * and reaching it should not be flagged as an error.
 */
const TARGET_CT = 6;

function classColumn(className) {
  return `periods_${String(className).toLowerCase()}`;
}

/** Max periods the class teacher could possibly teach in their own class. */
export function ctMaxInClass(classObj, teacher, subjects) {
  if (!teacher) return 0;
  const col = classColumn(classObj.name);
  const taught = new Set(teacher.subjects || []);
  let max = 0;
  for (const s of subjects || []) {
    if (taught.has(s.name)) max += Number(s[col]) || 0;
  }
  return max;
}

/** The CT period target for this class = min(6, attainable). */
export function ctRequired(classObj, teacher, subjects) {
  return Math.min(TARGET_CT, ctMaxInClass(classObj, teacher, subjects));
}

/**
 * Evaluate a class teacher's CT periods.
 * @returns {{required:number, max:number, ok:boolean, capped:boolean}}
 *   capped = true when 6 is physically unattainable (so `required` < 6).
 */
export function ctStatus(classObj, teacher, subjects, ctAllocated) {
  if (!teacher) return { required: 0, max: 0, ok: true, capped: false };
  const max = ctMaxInClass(classObj, teacher, subjects);
  const required = Math.min(TARGET_CT, max);
  return {
    required,
    max,
    ok: ctAllocated >= required,
    capped: max < TARGET_CT,
  };
}

export { TARGET_CT };
