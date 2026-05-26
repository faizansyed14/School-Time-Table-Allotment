import * as XLSX from 'xlsx';

const NUM_DAYS = 6;

/** Group Mon–Sat slots into "1-6 Subject (Teacher)" lines */
export function formatPeriodCell(daySlots) {
  // daySlots: { 1: { subject, teacherName }, ... }
  const segments = [];
  let start = null;
  let curKey = null;
  let curSubject = '';
  let curTeacher = '';

  const flush = (endDay) => {
    if (curKey == null || start == null) return;
    const range = start === endDay ? String(start) : `${start}-${endDay}`;
    segments.push(`${range} ${curSubject} (${curTeacher})`);
    start = null;
    curKey = null;
  };

  for (let d = 1; d <= NUM_DAYS; d++) {
    const slot = daySlots[d];
    const key = slot ? `${slot.subject}\0${slot.teacherName || ''}` : null;
    if (key === curKey) continue;
    if (curKey != null) flush(d - 1);
    if (slot) {
      start = d;
      curKey = key;
      curSubject = slot.subject;
      curTeacher = slot.teacherName || '—';
    }
  }
  if (curKey != null) flush(NUM_DAYS);

  return segments.join('\n');
}

/** Build matrix[classId][period] = formatted string */
export function buildMasterMatrix(timetableRows, classes) {
  const byClassPeriod = {};
  (timetableRows || []).forEach((r) => {
    const pid = r.period;
    const cid = r.class_id;
    if (!byClassPeriod[cid]) byClassPeriod[cid] = {};
    if (!byClassPeriod[cid][pid]) byClassPeriod[cid][pid] = {};
    byClassPeriod[cid][pid][r.day] = {
      subject: r.subject,
      teacherName: r.teachers?.name || '',
    };
  });

  const matrix = {};
  (classes || []).forEach((c) => {
    matrix[c.id] = {};
    for (let p = 1; p <= 8; p++) {
      const daySlots = byClassPeriod[c.id]?.[p] || {};
      matrix[c.id][p] = formatPeriodCell(daySlots);
    }
  });
  return matrix;
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NUMBERS = [1, 2, 3, 4, 5, 6];

/**
 * Parse cell text into segments. Example lines:
 *   1-6 English (Deepika)
 *   1-3 Maths (Annu)
 *   4-6 English (Deepika)
 */
export function parsePeriodCellText(text) {
  const lines = String(text || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Enter at least one line (e.g. 1-6 English (Deepika))');

  const segments = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)(?:\s*-\s*(\d+))?\s+(.+?)\s*\(([^)]+)\)\s*$/i);
    if (!m) {
      throw new Error(`Could not parse: "${line}". Use: 1-6 English (Teacher Name) or 4 English (Name)`);
    }
    const dayStart = parseInt(m[1], 10);
    const dayEnd = parseInt(m[2] || m[1], 10);
    if (dayStart < 1 || dayEnd > NUM_DAYS || dayStart > dayEnd) {
      throw new Error(`Invalid day range in: "${line}" (use 1–${NUM_DAYS})`);
    }
    segments.push({
      dayStart,
      dayEnd,
      subject: m[3].trim(),
      teacherName: m[4].trim(),
    });
  }

  const err = validateSegmentCoverage(segments);
  if (err) throw new Error(err);
  return segments;
}

export function validateSegmentCoverage(segments) {
  const covered = new Set();
  for (const s of segments) {
    for (let d = s.dayStart; d <= s.dayEnd; d++) {
      if (covered.has(d)) return `Overlapping days in ${s.dayStart}-${s.dayEnd}`;
      covered.add(d);
    }
  }
  for (let d = 1; d <= NUM_DAYS; d++) {
    if (!covered.has(d)) {
      return `Day ${d} (${DAY_NAMES[d - 1]}) is missing — cover all days 1–${NUM_DAYS}`;
    }
  }
  return null;
}

/** Build editor segments from DB rows for one class + period */
export function segmentsFromTimetableRows(rows) {
  if (!rows?.length) {
    return [{ dayStart: 1, dayEnd: 6, subject: '', teacher_id: '' }];
  }
  const byDay = {};
  rows.forEach((r) => {
    byDay[r.day] = { subject: r.subject, teacher_id: r.teacher_id || '' };
  });

  const segments = [];
  let start = null;
  let curKey = null;
  let subject = '';
  let teacher_id = '';

  const flush = (endDay) => {
    if (start == null) return;
    segments.push({ dayStart: start, dayEnd: endDay, subject, teacher_id });
    start = null;
    curKey = null;
  };

  for (let d = 1; d <= NUM_DAYS; d++) {
    const slot = byDay[d];
    const key = slot ? `${slot.subject}\0${slot.teacher_id}` : null;
    if (key === curKey) continue;
    if (curKey != null) flush(d - 1);
    if (slot) {
      start = d;
      curKey = key;
      subject = slot.subject;
      teacher_id = slot.teacher_id;
    }
  }
  if (curKey != null) flush(NUM_DAYS);

  return segments.length
    ? segments
    : [{ dayStart: 1, dayEnd: 6, subject: '', teacher_id: '' }];
}

export function getCoverageInfo(segments) {
  const covered = new Set();
  let overlap = false;
  let invalidRange = false;

  for (const s of segments || []) {
    const a = Number(s.dayStart);
    const b = Number(s.dayEnd);
    if (!a || !b || a < 1 || b > NUM_DAYS || a > b) {
      invalidRange = true;
      continue;
    }
    for (let d = a; d <= b; d++) {
      if (covered.has(d)) overlap = true;
      covered.add(d);
    }
  }

  const missing = [];
  for (let d = 1; d <= NUM_DAYS; d++) {
    if (!covered.has(d)) missing.push(d);
  }

  return {
    coveredCount: covered.size,
    maxDays: NUM_DAYS,
    overlap,
    invalidRange,
    missing,
    missingLabels: missing.map((d) => DAY_NAMES[d - 1]),
    coveredLabels: [...covered].sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1]),
    isComplete: covered.size === NUM_DAYS && !overlap && !invalidRange,
    overMax: covered.size > NUM_DAYS,
  };
}

export function validateFormSegments(segments) {
  if (!segments?.length) return 'Add at least one teaching block';
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const n = i + 1;
    if (!s.subject) return `Block ${n}: select a subject`;
    if (!s.teacher_id) return `Block ${n}: select a teacher`;
    const a = Number(s.dayStart);
    const b = Number(s.dayEnd);
    if (!a || !b) return `Block ${n}: set from and to day`;
    if (a < 1 || b > NUM_DAYS || a > b) {
      return `Block ${n}: days must be between 1 (Mon) and ${NUM_DAYS} (Sat), and From ≤ To`;
    }
  }
  const info = getCoverageInfo(segments);
  if (info.overMax) return `Cannot cover more than ${NUM_DAYS} days`;
  return validateSegmentCoverage(
    segments.map((s) => ({ dayStart: Number(s.dayStart), dayEnd: Number(s.dayEnd) })),
  );
}

export function segmentsToApiPayload(segments) {
  const err = validateFormSegments(segments);
  if (err) throw new Error(err);
  return segments.map((s) => ({
    dayStart: Number(s.dayStart),
    dayEnd: Number(s.dayEnd),
    subject: s.subject,
    teacher_id: s.teacher_id,
  }));
}

/** Resolve teacher names to IDs; throws if unknown */
export function resolveSegmentsTeachers(segments, teachers) {
  const byName = new Map((teachers || []).map((t) => [t.name.toLowerCase(), t.id]));
  return segments.map((s) => {
    const id = byName.get(s.teacherName.toLowerCase());
    if (!id) {
      throw new Error(`Unknown teacher: "${s.teacherName}". Use exact name from Teachers page.`);
    }
    return {
      dayStart: s.dayStart,
      dayEnd: s.dayEnd,
      subject: s.subject,
      teacher_id: id,
    };
  });
}

export function exportMasterGridExcel({ classes, timetableRows, filename }) {
  const matrix = buildMasterMatrix(timetableRows, classes);
  const classList = [...(classes || [])].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );

  const header = ['Class Period', ...classList.map((c) => c.name)];
  const body = [];
  for (let p = 1; p <= 8; p++) {
    const row = [p];
    classList.forEach((c) => {
      row.push(matrix[c.id]?.[p] || '');
    });
    body.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = [{ wch: 12 }, ...classList.map(() => ({ wch: 24 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Timetable');
  XLSX.writeFile(wb, filename || 'Master-Timetable.xlsx');
}
