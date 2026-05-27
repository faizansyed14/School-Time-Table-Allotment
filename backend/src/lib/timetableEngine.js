/**
 * Timetable Engine — Pure JS constraint-based scheduler.
 *
 * 4 HARD RULES:
 *   R1: Class teacher teaches Period 1 every day in their class
 *   R2: Diary at Period 8 for classes with class_level ≤ 2
 *   R3: No teacher in 2 classes at same day+period
 *   R4: Teacher can only teach periods ≥ min_period_start
 *
 * Algorithm:
 *   Phase 1: Pre-fill mandatory slots (R1, R2)
 *   Phase 2: Greedy fill remaining slots with shuffled ordering + backtrack
 *   Phase 3: Validate & report
 */

const NUM_DAYS = 6;
const PERIODS_PER_DAY = 8;
const TOTAL_SLOTS = NUM_DAYS * PERIODS_PER_DAY; // 48

/**
 * Run the timetable engine.
 *
 * @param {Object} params
 * @param {Array} params.teachers    - [{ id, name, subjects, allotted_periods, min_period_start }]
 * @param {Array} params.classes     - [{ id, name, class_level, class_teacher_id }]
 * @param {Array} params.allocations - [{ teacher_id, class_id, subject, periods_weekly }]
 * @returns {Object} - { success, grid, filled, total, errors, warnings, teacher_summary, class_summary }
 */
function runTimetableEngine({ teachers, classes, allocations }) {
  const errors = [];
  const warnings = [];

  // --- Lookup maps ---
  const teacherById = {};
  teachers.forEach(t => { teacherById[t.id] = t; });
  const classById = {};
  classes.forEach(c => { classById[c.id] = c; });

  // --- Build allocation demand per class ---
  // allocDemand[classId] = [{ teacher_id, subject, remaining }]
  const allocDemand = {};
  allocations.forEach(a => {
    if (!allocDemand[a.class_id]) allocDemand[a.class_id] = [];
    allocDemand[a.class_id].push({
      teacher_id: a.teacher_id,
      subject: a.subject,
      remaining: a.periods_weekly,
      original: a.periods_weekly,
    });
  });

  // --- Validate total periods per class = 48 ---
  classes.forEach(c => {
    const allocs = allocDemand[c.id] || [];
    const total = allocs.reduce((s, a) => s + a.remaining, 0);
    if (total !== TOTAL_SLOTS) {
      errors.push({
        type: 'class_period_mismatch',
        class_name: c.name,
        message: `Class ${c.name}: allocations sum to ${total} periods, but need exactly ${TOTAL_SLOTS}.`,
      });
    }
  });

  // If any class doesn't have exactly 48 periods, we can still try but warn
  // --- Initialize grid ---
  // grid[classId][day][period] = { teacher_id, subject } or null
  const grid = {};
  classes.forEach(c => {
    grid[c.id] = [];
    for (let d = 0; d < NUM_DAYS; d++) {
      grid[c.id][d] = new Array(PERIODS_PER_DAY).fill(null);
    }
  });

  // --- Global teacher busy tracker ---
  // teacherBusy["teacherId|day|period"] = classId
  const teacherBusy = {};

  function isTeacherBusy(teacherId, day, period) {
    return teacherBusy[`${teacherId}|${day}|${period}`] != null;
  }
  function markTeacherBusy(teacherId, day, period, classId) {
    teacherBusy[`${teacherId}|${day}|${period}`] = classId;
  }
  function unmarkTeacherBusy(teacherId, day, period) {
    delete teacherBusy[`${teacherId}|${day}|${period}`];
  }

  // --- Helper: place a slot ---
  function placeSlot(classId, day, period, teacherId, subject) {
    grid[classId][day][period] = { teacher_id: teacherId, subject };
    markTeacherBusy(teacherId, day, period, classId);
    // Decrement the allocation demand
    const allocs = allocDemand[classId] || [];
    const alloc = allocs.find(a => a.teacher_id === teacherId && a.subject === subject);
    if (alloc) alloc.remaining--;
  }

  function removeSlot(classId, day, period) {
    const entry = grid[classId][day][period];
    if (!entry) return;
    unmarkTeacherBusy(entry.teacher_id, day, period);
    // Restore the allocation demand
    const allocs = allocDemand[classId] || [];
    const alloc = allocs.find(a => a.teacher_id === entry.teacher_id && a.subject === entry.subject);
    if (alloc) alloc.remaining++;
    grid[classId][day][period] = null;
  }

  // --- Helper: check R4 (teacher starts from) ---
  function canTeachAtPeriod(teacherId, period) {
    const teacher = teacherById[teacherId];
    if (!teacher) return false;
    const minP = teacher.min_period_start || 1;
    return (period + 1) >= minP; // period is 0-indexed, minP is 1-indexed
  }

  // --- Helper: count how many times a subject appears on a given day in a class ---
  function subjectCountOnDay(classId, day, subject) {
    let count = 0;
    for (let p = 0; p < PERIODS_PER_DAY; p++) {
      const entry = grid[classId][day][p];
      if (entry && entry.subject === subject) count++;
    }
    return count;
  }

  // =========================================
  // MONTE CARLO SEARCH: Run many rapid random iterations to find the best configuration
  // =========================================
  const MAX_ATTEMPTS = 2000;
  const targetTotalPlaced = classes.length * TOTAL_SLOTS;

  let bestGrid = null;
  let bestErrors = [];
  let bestWarnings = [];
  let bestFilled = -1;
  let bestTeacherBusy = {};
  let bestAllocDemand = null;

  // Calculate true total workload once outside the loop
  const totalTeacherWorkload = {};
  classes.forEach(c => {
    (allocDemand[c.id] || []).forEach(a => {
      totalTeacherWorkload[a.teacher_id] = (totalTeacherWorkload[a.teacher_id] || 0) + a.original;
    });
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptGrid = {};
    const attemptDemand = JSON.parse(JSON.stringify(allocDemand)); // deep copy baseline demand
    const attemptErrors = [];
    const attemptWarnings = [];
    let attemptFilled = 0;
    const attemptTeacherBusy = {};

    classes.forEach(c => {
      attemptGrid[c.id] = [];
      for (let d = 0; d < NUM_DAYS; d++) {
        attemptGrid[c.id][d] = new Array(PERIODS_PER_DAY).fill(null);
      }
    });

    function _isBusy(tId, d, p) { return attemptTeacherBusy[`${tId}|${d}|${p}`] === true; }
    function _setBusy(tId, d, p) { attemptTeacherBusy[`${tId}|${d}|${p}`] = true; }
    
    function _place(classId, d, p, tId, sub) {
      attemptGrid[classId][d][p] = { teacher_id: tId, subject: sub };
      _setBusy(tId, d, p);
      attemptFilled++;
      const arr = attemptDemand[classId] || [];
      const f = arr.find(a => a.teacher_id === tId && a.subject === sub);
      if (f) f.remaining--;
    }

    function _subCount(classId, d, sub) {
      let c = 0;
      for (let p=0; p<PERIODS_PER_DAY; p++) {
        if (attemptGrid[classId][d][p]?.subject === sub) c++;
      }
      return c;
    }

    // --- Phase 1: Pre-fill Mandatory (R1, R2) ---
    classes.forEach(c => {
      // R2: Diary P8
      if (c.class_level <= 2) {
        const dAlloc = (attemptDemand[c.id]||[]).find(a => a.subject === 'Diary');
        if (dAlloc) {
          for (let d = 0; d < NUM_DAYS; d++) {
            if (_isBusy(dAlloc.teacher_id, d, PERIODS_PER_DAY - 1)) continue;
            if (!canTeachAtPeriod(dAlloc.teacher_id, PERIODS_PER_DAY - 1)) continue;
            _place(c.id, d, PERIODS_PER_DAY - 1, dAlloc.teacher_id, 'Diary');
          }
        }
      }
      // R1: Class Teacher P1
      if (c.class_teacher_id && canTeachAtPeriod(c.class_teacher_id, 0)) {
        const ctAllocs = (attemptDemand[c.id]||[]).filter(a => a.teacher_id === c.class_teacher_id);
        for (let d = 0; d < NUM_DAYS; d++) {
          if (attemptGrid[c.id][d][0] !== null) continue;
          if (_isBusy(c.class_teacher_id, d, 0)) continue;
          
          const avail = ctAllocs.filter(a => a.remaining > 0);
          if (avail.length === 0) continue;
          // Randomize pick for variety between attempts
          avail.sort(() => Math.random() - 0.5);
          const pick = avail.find(a => _subCount(c.id, d, a.subject) < 2) || avail[0];
          _place(c.id, d, 0, c.class_teacher_id, pick.subject);
        }
      }
    });

    // --- Phase 2: Horizontal Striping Fill ---
    // Group everything into chunks for consistent periods
    const chunks = [];
    classes.forEach(cls => {
      (attemptDemand[cls.id] || []).forEach(a => {
        let rem = a.remaining;
        while (rem > 0) {
          const size = Math.min(rem, NUM_DAYS); // Pack up to 6 horizontally
          chunks.push({ class_id: cls.id, teacher_id: a.teacher_id, subject: a.subject, size });
          rem -= size;
        }
      });
    });

    // Heuristic: Most constrained first (High Workload, High Min Period, High Size)
    // Teachers with > 40 periods only have a few free slots all week. They MUST be placed first
    // regardless of whether the chunk is 6 periods or 1 period.
    chunks.sort((a,b) => {
      if (Math.random() < 0.1) return Math.random() - 0.5; // Occasional random swap for better search space
      
      const wA = totalTeacherWorkload[a.teacher_id] || 0;
      const wB = totalTeacherWorkload[b.teacher_id] || 0;
      if (wB !== wA) return wB - wA; // 1. Heaviest workload first
      
      const minA = teacherById[a.teacher_id]?.min_period_start || 1;
      const minB = teacherById[b.teacher_id]?.min_period_start || 1;
      if (minB !== minA) return minB - minA; // 2. Most restricted period start first

      if (b.size !== a.size) return b.size - a.size; // 3. Largest chunks first
      return 0;
    });

    const leftovers = [];
    for (const chunk of chunks) {
      let placedSize = 0;
      let targetSize = chunk.size;
      
      const periods = [0,1,2,3,4,5,6,7].sort(() => Math.random() - 0.5); // Randomize row order
      let bestP = -1;
      let bestDays = [];

      for (const p of periods) {
        if (!canTeachAtPeriod(chunk.teacher_id, p)) continue;
        
        const days = [];
        for (let d = 0; d < NUM_DAYS; d++) {
          if (attemptGrid[chunk.class_id][d][p] === null && !_isBusy(chunk.teacher_id, d, p)) {
            days.push(d);
          }
        }
        
        if (days.length >= targetSize) {
          bestP = p; bestDays = days.slice(0, targetSize); break;
        } else if (days.length > bestDays.length) {
          bestP = p; bestDays = days;
        }
      }

      if (bestP !== -1 && bestDays.length > 0) {
        for (const d of bestDays) {
          _place(chunk.class_id, d, bestP, chunk.teacher_id, chunk.subject);
          placedSize++;
        }
      }

      const remainder = targetSize - placedSize;
      for (let i=0; i<remainder; i++) leftovers.push({...chunk, size: 1});
    }

    // --- Phase 3: Fallback single-slot fill ---
    const unplacedAfterFallback = [];
    for (const loose of leftovers) {
      let placed = false;
      const slots = [];
      for(let d=0; d<NUM_DAYS; d++) for(let p=0; p<PERIODS_PER_DAY; p++) slots.push({d,p});
      slots.sort(() => Math.random() - 0.5);

      for(const s of slots) {
        if (attemptGrid[loose.class_id][s.d][s.p] !== null) continue;
        if (!canTeachAtPeriod(loose.teacher_id, s.p)) continue;
        if (_isBusy(loose.teacher_id, s.d, s.p)) continue;
        if (_subCount(loose.class_id, s.d, loose.subject) >= 2) continue;
        
        _place(loose.class_id, s.d, s.p, loose.teacher_id, loose.subject);
        placed = true; break;
      }
      
      if (!placed) unplacedAfterFallback.push(loose);
    }

    // --- Phase 4: Resolution Swap (1-Level Ejection Chain) ---
    // If some slots are completely gridlocked, try resolving by moving 1 existing assignment out of the way.
    for (let i = unplacedAfterFallback.length - 1; i >= 0; i--) {
      const loose = unplacedAfterFallback[i];
      const classId = loose.class_id;
      let swapped = false;

      const days = [0,1,2,3,4,5].sort(()=>Math.random()-0.5);
      const periods = [0,1,2,3,4,5,6,7].sort(()=>Math.random()-0.5);
      
      swapSearch:
      for (let d of days) {
        for (let p of periods) {
          if (!canTeachAtPeriod(loose.teacher_id, p)) continue;
          if (_isBusy(loose.teacher_id, d, p)) continue;
          // check future max-2 limit
          if (_subCount(classId, d, loose.subject) >= 2) continue;

          const existing = attemptGrid[classId][d][p];
          if (!existing) continue; // Empty slots were already checked in Phase 3

          // Don't eject Class Teacher P1 or Diary P8 rules
          if (p === 0 && existing.teacher_id === classById[classId]?.class_teacher_id) continue;
          if (p === PERIODS_PER_DAY - 1 && existing.subject === 'Diary') continue;

          // Try to move `existing` to an actually empty slot `d2, p2`
          for (let d2 = 0; d2 < NUM_DAYS; d2++) {
            for (let p2 = 0; p2 < PERIODS_PER_DAY; p2++) {
              if (d2 === d && p2 === p) continue;
              if (attemptGrid[classId][d2][p2] !== null) continue;
              if (!canTeachAtPeriod(existing.teacher_id, p2)) continue;
              if (_isBusy(existing.teacher_id, d2, p2)) continue;
              
              if (d2 !== d && _subCount(classId, d2, existing.subject) >= 2) continue;

              // Action Swap!
              attemptGrid[classId][d][p] = null;
              attemptTeacherBusy[`${existing.teacher_id}|${d}|${p}`] = false;

              attemptGrid[classId][d2][p2] = existing;
              attemptTeacherBusy[`${existing.teacher_id}|${d2}|${p2}`] = true;

              _place(classId, d, p, loose.teacher_id, loose.subject);
              swapped = true;
              break swapSearch;
            }
          }
        }
      }

      if (swapped) {
        unplacedAfterFallback.splice(i, 1);
      } else {
        // Record ultimate failure
        const tName = teacherById[loose.teacher_id]?.name || loose.teacher_id;
        const cName = classById[classId]?.name || classId;
        attemptErrors.push({
          type: 'unplaceable',
          class_name: cName,
          message: `Could not place ${tName} → ${loose.subject} in class ${cName}. Blocked by R3 or R4.`
        });
      }
    }

    // Evaluate iteration best
    if (attemptFilled > bestFilled) {
      bestFilled = attemptFilled;
      bestGrid = attemptGrid;
      bestErrors = attemptErrors;
      bestWarnings = attemptWarnings;
      bestAllocDemand = attemptDemand;
      bestTeacherBusy = attemptTeacherBusy;
    }
    
    // Stop early if perfect 100% fill rate achieved
    if (bestFilled === targetTotalPlaced && bestErrors.length === 0) {
      console.log(`[TIMETABLE ENGINE] Found perfect 100% horizontal match on attempt ${attempt + 1}.`);
      break;
    }
  }

  // =========================================
  // REPORTING
  // =========================================
  return buildResult(bestGrid, bestAllocDemand, classes, teachers, bestErrors, bestWarnings, bestTeacherBusy);
}

/**
 * Build the result object from the filled grid.
 */
function buildResult(grid, allocDemand, classes, teachers, errors, warnings) {
  const teacherById = {};
  teachers.forEach(t => { teacherById[t.id] = t; });

  let totalFilled = 0;
  const total = classes.length * TOTAL_SLOTS;
  const classSummary = {};
  const teacherSummary = {};
  const teacherSlotCheck = {}; // final R3 validation

  // Convert grid to output format: grid[classId][day][period] = [{ teacher_id, subject_id }]
  const outputGrid = {};

  for (const c of classes) {
    outputGrid[c.id] = [];
    let classFilled = 0;

    for (let d = 0; d < NUM_DAYS; d++) {
      const daySlots = [];
      for (let p = 0; p < PERIODS_PER_DAY; p++) {
        const entry = grid[c.id]?.[d]?.[p];
        if (entry) {
          daySlots.push([{ teacher_id: entry.teacher_id, subject_id: entry.subject }]);
          classFilled++;
          totalFilled++;

          // Track teacher summary
          if (!teacherSummary[entry.teacher_id]) {
            teacherSummary[entry.teacher_id] = { allocated: 0, classes: new Set() };
          }
          teacherSummary[entry.teacher_id].allocated++;
          teacherSummary[entry.teacher_id].classes.add(c.id);

          // R3 final check
          const slotKey = `${entry.teacher_id}|${d}|${p}`;
          if (teacherSlotCheck[slotKey]) {
            const otherClassName = classes.find(cl => cl.id === teacherSlotCheck[slotKey])?.name || 'unknown';
            errors.push({
              type: 'r3_conflict',
              message: `R3 VIOLATION: ${teacherById[entry.teacher_id]?.name} in ${c.name} and ${otherClassName} on day ${d + 1} period ${p + 1}.`,
            });
          } else {
            teacherSlotCheck[slotKey] = c.id;
          }
        } else {
          daySlots.push([]);
        }
      }
      outputGrid[c.id].push(daySlots);
    }

    classSummary[c.id] = { periods_filled: classFilled };
  }

  // Check unfilled classes
  for (const c of classes) {
    const filled = classSummary[c.id]?.periods_filled || 0;
    if (filled < TOTAL_SLOTS) {
      errors.push({
        type: 'class_incomplete',
        class_name: c.name,
        message: `Class ${c.name}: only ${filled}/${TOTAL_SLOTS} slots filled (${TOTAL_SLOTS - filled} empty).`,
      });
    }
  }

  // Serialize teacher summary
  const serializedTeacherSummary = {};
  for (const [tid, data] of Object.entries(teacherSummary)) {
    serializedTeacherSummary[tid] = {
      allocated: data.allocated,
      classes: Array.from(data.classes).sort(),
    };
  }

  const hasErrors = errors.filter(e => e.type === 'r3_conflict' || e.type === 'class_incomplete' || e.type === 'unplaceable').length > 0;

  return {
    success: !hasErrors,
    filled: totalFilled,
    total,
    solver_status_name: !hasErrors ? 'COMPLETE' : 'PARTIAL',
    message: !hasErrors
      ? `Timetable generated successfully: ${totalFilled}/${total} slots filled.`
      : `Timetable has issues: ${totalFilled}/${total} slots filled.`,
    grid: outputGrid,
    teacher_summary: serializedTeacherSummary,
    class_summary: classSummary,
    preflight_issues: {
      fatal: errors.map(e => ({ reason: e.message, type: e.type, class_name: e.class_name })),
      warn: warnings.map(w => ({ reason: w.message, type: w.type, class_name: w.class_name })),
    },
    errors,
    warnings,
    phases: ['js_engine'],
  };
}

module.exports = { runTimetableEngine };
