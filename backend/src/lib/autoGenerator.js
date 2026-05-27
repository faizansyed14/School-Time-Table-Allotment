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

  // Pre-calculate eligibility
  requirements.forEach(req => {
    req.eligibleTeachers = teachers.filter(t => {
      const hasSubject = (t.subjects || []).includes(req.subject);
      const levelMatch = req.class_level >= (t.min_class_level || 0) && req.class_level <= (t.max_class_level || 10);
      return hasSubject && levelMatch;
    }).map(t => t.id);
  });

  let bestResult = null;
  let bestScore = -1;

  // Multi-pass Search (Monte Carlo)
  // Try 5000 iterations to find a perfect fit
  for (let iter = 0; iter < 5000; iter++) {
    const currentAllocations = [];
    const teacherLoad = {};
    const diaryLoad = {};
    teachers.forEach(t => { teacherLoad[t.id] = 0; diaryLoad[t.id] = 0; });

    // Shuffle requirements to explore different paths
    const shuffledReqs = [...requirements].sort(() => Math.random() - 0.5);
    
    let filledCount = 0;
    for (const req of shuffledReqs) {
      let candidateIds = req.eligibleTeachers.filter(tid => {
        const t = teachers.find(x => x.id === tid);
        const hasWorkloadCap = (teacherLoad[tid] + req.periods_weekly) <= (t.allotted_periods || 0);
        if (req.subject === 'Diary') {
          return hasWorkloadCap && (diaryLoad[tid] + req.periods_weekly) <= 6;
        }
        return hasWorkloadCap;
      });

      if (candidateIds.length === 0) continue;

      // Priority: 1. Class Teacher  2. Random
      let selectedId;
      if (candidateIds.includes(req.class_teacher_id)) {
        // High probability of picking class teacher if eligible
        selectedId = Math.random() > 0.1 ? req.class_teacher_id : candidateIds[Math.floor(Math.random() * candidateIds.length)];
      } else {
        selectedId = candidateIds[Math.floor(Math.random() * candidateIds.length)];
      }

      teacherLoad[selectedId] += req.periods_weekly;
      if (req.subject === 'Diary') diaryLoad[selectedId] += req.periods_weekly;
      currentAllocations.push({
        teacher_id: selectedId,
        class_id: req.class_id,
        subject: req.subject,
        periods_weekly: req.periods_weekly
      });
      filledCount += req.periods_weekly;
    }

    if (filledCount > bestScore) {
      bestScore = filledCount;
      bestResult = currentAllocations;
      if (bestScore === totalDemand) break; // Found perfect 100%
    }
  }

  // If even after 5000 runs we aren't at 100%, do a greedy fallback to fill gaps
  if (bestScore < totalDemand) {
    const assignedKeys = new Set(bestResult.map(a => `${a.class_id}|${a.subject}`));
    const remaining = requirements.filter(r => !assignedKeys.has(r.key));
    
    const teacherLoad = {};
    teachers.forEach(t => { teacherLoad[t.id] = 0; });
    bestResult.forEach(a => { teacherLoad[a.teacher_id] += a.periods_weekly; });

    for (const req of remaining) {
      // Find ANY teacher with capacity, priority to specialists
      const candidates = [...teachers].sort((a, b) => {
        const specA = (a.subjects || []).includes(req.subject) ? 1 : 0;
        const specB = (b.subjects || []).includes(req.subject) ? 1 : 0;
        if (specA !== specB) return specB - specA;
        return ((b.allotted_periods || 0) - teacherLoad[b.id]) - ((a.allotted_periods || 0) - teacherLoad[a.id]);
      });

      const lucky = candidates[0];
      teacherLoad[lucky.id] += req.periods_weekly;
      bestResult.push({
        teacher_id: lucky.id,
        class_id: req.class_id,
        subject: req.subject,
        periods_weekly: req.periods_weekly
      });
      warnings.push(`FORCED: ${req.subject} in ${req.class_name} assigned to ${lucky.name} to reach 100%.`);
    }
  }

  return {
    success: true,
    allocations: bestResult,
    warnings
  };
}

module.exports = { autoGenerateAllocations };
