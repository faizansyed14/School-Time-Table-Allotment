const CLASS_COL_MAP = {
  '1A': 'periods_1a', '1B': 'periods_1b',
  '2A': 'periods_2a', '2B': 'periods_2b',
  '3A': 'periods_3a', '3B': 'periods_3b',
  '4A': 'periods_4a', '4B': 'periods_4b',
  '5': 'periods_5', '6A': 'periods_6a', '6B': 'periods_6b',
  '7': 'periods_7', '8': 'periods_8',
  '9': 'periods_9', '10': 'periods_10',
};

function autoGenerateAllocations({ teachers, classes, subjects }) {
  const requirements = [];
  let totalDemand = 0;

  for (const cls of classes) {
    const colName = CLASS_COL_MAP[cls.name];
    if (!colName) continue;
    for (const sub of subjects) {
      const p = sub[colName];
      if (p && p > 0) {
        requirements.push({
          class_id: cls.id,
          class_name: cls.name,
          class_level: cls.class_level,
          class_teacher_id: cls.class_teacher_id,
          subject: sub.name,
          periods_weekly: p,
          key: `${cls.id}|${sub.name}`
        });
        totalDemand += p;
      }
    }
  }

  const totalTarget = teachers.reduce((sum, t) => sum + (t.allotted_periods || 0), 0);
  const warnings = [];
  if (totalTarget !== totalDemand) {
    warnings.push(`Workload Mismatch: Teachers sum to ${totalTarget}p, but Curriculum needs ${totalDemand}p.`);
  }

  // Pre-calculate eligibility and sort by MRV (Minimum Remaining Values)
  requirements.forEach(req => {
    req.eligibleTeachers = teachers.filter(t => {
      const hasSubject = (t.subjects || []).includes(req.subject);
      const levelMatch = req.class_level >= (t.min_class_level || 0) && req.class_level <= (t.max_class_level || 10);
      
      // RULE: Only the Class Teacher can teach 'Diary' in their own class
      if (req.subject === 'Diary') {
        return t.id === req.class_teacher_id && hasSubject;
      }
      return hasSubject && levelMatch;
    }).map(t => t.id);
  });

  // Sort requirements: 
  // 1. Prioritize requirements where a Class Teacher is eligible and needs periods (to lock them in).
  // 2. Then follow MRV (hardest subjects first).
  const sortReqs = (reqs, ctLoadMap) => {
    return reqs.sort((a, b) => {
      // Rule: If one requirement can be filled by its own CT who is under 6p, do it first
      const aNeedsCT = a.eligibleTeachers.includes(a.class_teacher_id) && (ctLoadMap[a.class_teacher_id] || 0) < 6;
      const bNeedsCT = b.eligibleTeachers.includes(b.class_teacher_id) && (ctLoadMap[b.class_teacher_id] || 0) < 6;
      
      if (aNeedsCT && !bNeedsCT) return -1;
      if (!aNeedsCT && bNeedsCT) return 1;
      
      // Fallback to MRV
      return a.eligibleTeachers.length - b.eligibleTeachers.length || Math.random() - 0.5;
    });
  };

  let bestResult = null;
  let bestScore = -1;

  // Multi-pass Search (Monte Carlo + Priority Heuristic + Splitting Support)
  // We run 50,000 iterations to ensure we explore nearly every possible path.
  for (let iter = 0; iter < 50000; iter++) {
    const currentAllocations = [];
    const teacherLoad = {};
    const diaryLoad = {};
    const ctClassLoad = {}; // Track periods a CT teaches in THEIR OWN class
    const tempReqs = JSON.parse(JSON.stringify(requirements)); 

    teachers.forEach(t => { 
      teacherLoad[t.id] = 0; 
      diaryLoad[t.id] = 0;
      ctClassLoad[t.id] = 0;
    });

    let filledCount = 0;
    
    while (tempReqs.length > 0) {
      // Re-sort every time because ctClassLoad changes
      sortReqs(tempReqs, ctClassLoad);
      const req = tempReqs.shift();

      // Find candidates who have workload capacity left
      let candidateIds = req.eligibleTeachers.filter(tid => {
        const t = teachers.find(x => x.id === tid);
        return teacherLoad[tid] < (t.allotted_periods || 0);
      });

      // Special Logic for 100% Fill: If NO specialist with capacity, allow anyone with capacity (Fallback)
      let isFallback = false;
      if (candidateIds.length === 0) {
        candidateIds = teachers
          .filter(t => teacherLoad[t.id] < (t.allotted_periods || 0))
          .map(t => t.id);
        isFallback = true;
      }

      if (candidateIds.length === 0) continue; // School is literally at 100% capacity

      let selectedId;
      const isCT = candidateIds.includes(req.class_teacher_id);
      
      if (req.subject === 'Diary' && isCT) {
        selectedId = req.class_teacher_id;
      } else if (!isFallback && isCT && ctClassLoad[req.class_teacher_id] < 6) {
        // High priority: Fill Class Teacher in their OWN class until they hit 6 periods
        selectedId = req.class_teacher_id;
      } else {
        // Balance workload among candidates
        candidateIds.sort((a, b) => {
          const tA = teachers.find(x => x.id === a);
          const tB = teachers.find(x => x.id === b);
          return ((tB.allotted_periods || 0) - teacherLoad[b]) - ((tA.allotted_periods || 0) - teacherLoad[a]);
        });
        // Favor specialist if in fallback mode
        if (isFallback) {
          const specialists = candidateIds.filter(tid => {
            const t = teachers.find(x => x.id === tid);
            return (t.subjects || []).includes(req.subject);
          });
          selectedId = specialists.length > 0 ? specialists[0] : candidateIds[0];
        } else {
          selectedId = candidateIds[0];
        }
      }

      const t = teachers.find(x => x.id === selectedId);
      const remainingTeacherCap = (t.allotted_periods || 0) - teacherLoad[selectedId];
      let canTake = Math.min(req.periods_weekly, remainingTeacherCap);
      
      if (req.subject === 'Diary') {
        const remainingDiaryCap = 6 - diaryLoad[selectedId];
        canTake = Math.min(canTake, Math.max(0, remainingDiaryCap));
      }

      if (canTake <= 0) {
        // Safety: if we can't take anything but there are more candidates, try another? 
        // For simplicity, we just take 1 period if absolutely needed to avoid infinite loop
        if (isFallback && remainingTeacherCap > 0) canTake = 1; else continue;
      }

      teacherLoad[selectedId] += canTake;
      if (req.subject === 'Diary') diaryLoad[selectedId] += canTake;
      if (selectedId === req.class_teacher_id) {
        ctClassLoad[selectedId] += canTake;
      }
      
      currentAllocations.push({
        teacher_id: selectedId,
        class_id: req.class_id,
        subject: req.subject,
        periods_weekly: canTake,
        _isFallback: isFallback // Prefix with _ to indicate internal
      });
      filledCount += canTake;

      if (canTake < req.periods_weekly) {
        tempReqs.push({ ...req, periods_weekly: req.periods_weekly - canTake });
      }
    }

    if (filledCount > bestScore) {
      bestScore = filledCount;
      bestResult = currentAllocations;
      if (bestScore === totalDemand) break; 
    }
  }

  // Remove internal flags before returning
  const finalAllocations = bestResult.map(({ _isFallback, ...rest }) => rest);

  // Generate clear user-friendly warnings
  const fallbackAllocs = bestResult.filter(a => a._isFallback);
  if (fallbackAllocs.length > 0) {
    const forcedSubjects = [...new Set(fallbackAllocs.map(a => a.subject))];
    warnings.push(`Warning: Had to force assign ${forcedSubjects.join(', ')} to non-specialists to reach 100%.`);
  }

  if (bestScore < totalDemand) {
    warnings.push(`Incomplete: Only ${bestScore}/${totalDemand} periods assigned! The school is at max capacity.`);
  }

  return {
    success: true,
    allocations: finalAllocations,
    warnings
  };
}

module.exports = { autoGenerateAllocations };
